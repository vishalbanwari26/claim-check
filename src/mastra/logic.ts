// The rules that decide what a claim's status can be. No model and no I/O in this file, so
// every rule here is a plain unit test.
import type { CheckedClaim, Claim, Decision, EvidenceItem, LlmVerdict, Report, RepoCheck } from './schemas'

export const splitSentences = (draft: string) =>
  draft
    .split(/\n+/)
    .flatMap(line => line.split(/(?<=[.!?])\s+(?=[A-Z"'(])/))
    .map(s => s.trim().replace(/^[-*•]\s+/, ''))
    .filter(Boolean)
    .map((text, i) => ({ n: i + 1, text }))

type Sentence = { n: number; text: string }

export const labelSentences = (sentences: Sentence[]) => sentences.map(s => `[S${s.n}] ${s.text}`).join('\n')

type Extracted = Omit<Claim, 'id' | 'sentenceText'>

// A claim pointing at a sentence that does not exist is the model making something up, so
// it is dropped. That sentence then shows up as unchecked instead of disappearing.
export const attachSentences = (extracted: Extracted[], sentences: Sentence[]) => {
  const byNumber = new Map(sentences.map(s => [s.n, s.text]))
  const claims: Claim[] = extracted
    .filter(c => byNumber.has(c.sentence))
    .map((c, i) => ({ ...c, id: `C${i + 1}`, sentenceText: byNumber.get(c.sentence)! }))
  const covered = new Set(claims.map(c => c.sentence))
  return { claims, uncheckedSentences: sentences.filter(s => !covered.has(s.n)) }
}

export const resolveRepo = (ref: string | null, projects: { name: string; repo: string }[]) => {
  if (!ref) return null
  const url = ref.match(/github\.com\/([\w.-]+\/[\w.-]+)/)
  if (url) return url[1].replace(/\.git$/, '')
  if (/^[\w.-]+\/[\w.-]+$/.test(ref.trim())) return ref.trim()
  const lower = ref.trim().toLowerCase()
  return projects.find(p => p.name.toLowerCase() === lower)?.repo ?? null
}

type Judged = Pick<CheckedClaim, 'agentVerdict' | 'agentReason' | 'citedEvidence'>

const judgeRepoClaim = (claim: Claim, check: RepoCheck): Judged => {
  const nope = (why: string): Judged => ({ agentVerdict: 'could_not_check', agentReason: why, citedEvidence: [] })
  if (check.status !== 'ok') return nope(`GitHub lookup for ${check.repo} returned ${check.status}.`)
  if (!check.mainLanguage) return nope(`GitHub reports no main language for ${check.repo}.`)
  const evidence = [{ id: `github:${check.repo}`, text: `GitHub reports the main language of ${check.repo} as ${check.mainLanguage}.` }]
  const same = check.mainLanguage.toLowerCase() === (claim.statedLanguage ?? '').trim().toLowerCase()
  return same
    ? { agentVerdict: 'supported', agentReason: `GitHub agrees: ${check.mainLanguage}.`, citedEvidence: evidence }
    : {
        agentVerdict: 'contradicted',
        agentReason: `The draft says ${claim.statedLanguage}, GitHub says ${check.mainLanguage}.`,
        citedEvidence: evidence,
      }
}

// Every path that is not clean support fails closed, into a flag.
const judgeGeneralClaim = (verdict: LlmVerdict | undefined, evidence: EvidenceItem[]): Judged => {
  if (!verdict) return { agentVerdict: 'no_evidence', agentReason: 'The checker returned no verdict for this claim.', citedEvidence: [] }
  const cited = evidence.filter(e => verdict.citedIds.includes(e.id))
  if (verdict.verdict === 'supported' && cited.length === 0)
    return {
      agentVerdict: 'no_evidence',
      agentReason: `The checker said supported but cited nothing real (${verdict.citedIds.join(', ') || 'no ids'}). Its reason: ${verdict.reason}`,
      citedEvidence: [],
    }
  return { agentVerdict: verdict.verdict, agentReason: verdict.reason, citedEvidence: cited }
}

export const judgeClaims = (
  claims: Claim[],
  verdicts: LlmVerdict[],
  repoChecks: Record<string, RepoCheck>,
  evidence: EvidenceItem[],
): CheckedClaim[] =>
  claims.map(claim => {
    // A language claim with no repo behind it ("I used Python for the export script") has
    // nothing to ask GitHub, so it is judged against the facts like any other claim.
    const check = repoChecks[claim.id]
    const judged = check ? judgeRepoClaim(claim, check) : judgeGeneralClaim(verdicts.find(v => v.claimId === claim.id), evidence)
    return { ...claim, ...judged, flagged: judged.agentVerdict !== 'supported' }
  })

// Keeps what is valid, reports the rest. Later decisions on a claim replace earlier ones.
export const mergeDecisions = (flagged: CheckedClaim[], prior: Decision[], incoming: Decision[]) => {
  const flaggedIds = new Set(flagged.map(c => c.id))
  const decided = new Map(prior.map(d => [d.claimId, d]))
  const problems: string[] = []
  for (const d of incoming) {
    if (!flaggedIds.has(d.claimId)) problems.push(`${d.claimId} is not a flagged claim.`)
    else if (d.action === 'correct' && !d.correctedFact?.trim()) problems.push(`${d.claimId}: "correct" needs correctedFact.`)
    else decided.set(d.claimId, d)
  }
  return { decided: [...decided.values()], problems, remaining: flagged.filter(c => !decided.has(c.id)) }
}

// The only place a claim can become verified, and it needs a reviewer's name to do it.
export const buildReport = (
  claims: CheckedClaim[],
  uncheckedSentences: Sentence[],
  decisions: Decision[],
  approveSupported: boolean,
  reviewer: string,
  factsAdded: string[],
): Report => {
  const byClaim = new Map(decisions.map(d => [d.claimId, d]))
  const reportClaims = claims.map(claim => {
    const d = byClaim.get(claim.id)
    if (d) {
      const status = d.action === 'approve' ? 'verified' as const : d.action === 'correct' ? 'corrected' as const : 'rejected' as const
      return { ...claim, status, decidedBy: reviewer, correctedFact: d.correctedFact?.trim() ?? null }
    }
    if (!claim.flagged && approveSupported) return { ...claim, status: 'verified' as const, decidedBy: reviewer, correctedFact: null }
    return { ...claim, status: 'not_verified' as const, decidedBy: null, correctedFact: null }
  })
  const counts = { verified: 0, corrected: 0, rejected: 0, not_verified: 0 }
  for (const c of reportClaims) counts[c.status]++
  return { claims: reportClaims, uncheckedSentences, counts, factsAdded }
}
