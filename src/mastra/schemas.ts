import { z } from 'zod'

export const workflowInput = z.object({
  draft: z.string().min(1).describe('The CV or cover letter text'),
  candidateId: z.string().regex(/^[a-z0-9-]+$/).default('ines-varga'),
  jobId: z.string().regex(/^[a-z0-9-]+$/).default('quillbeam-ai-engineer'),
})

export const sentence = z.object({ n: z.number().int(), text: z.string() })

// What the extractor returns. Nullable rather than optional, because strict JSON schema
// mode on Groq requires every field to be present.
export const extractedClaim = z.object({
  sentence: z.number().int().describe('The S number the claim came from'),
  text: z.string().describe('The claim, close to the wording of the draft'),
  kind: z.enum(['general', 'repo-language']),
  repoRef: z.string().nullable().describe('For repo-language: the project name or URL as written, else null'),
  statedLanguage: z.string().nullable().describe('For repo-language: the language the draft states, else null'),
})
export const extractorOutput = z.object({ claims: z.array(extractedClaim) })

export const claim = extractedClaim.extend({
  id: z.string(),
  sentenceText: z.string(),
})
export type Claim = z.infer<typeof claim>

export const extractStepOutput = z.object({
  sentences: z.array(sentence),
  claims: z.array(claim),
  uncheckedSentences: z.array(sentence).describe('Sentences the extractor took no claim from. Shown to the human.'),
})

export const llmVerdict = z.object({
  claimId: z.string(),
  verdict: z.enum(['supported', 'contradicted', 'no_evidence']),
  citedIds: z.array(z.string()).describe('Ids of the facts relied on, or JOB for the job ad'),
  reason: z.string(),
})
export const checkerOutput = z.object({ verdicts: z.array(llmVerdict) })
export type LlmVerdict = z.infer<typeof llmVerdict>

export const evidenceItem = z.object({ id: z.string(), text: z.string() })
export type EvidenceItem = z.infer<typeof evidenceItem>

export const repoCheck = z.object({
  repo: z.string(),
  status: z.enum(['ok', 'not_found', 'rate_limited', 'error']),
  mainLanguage: z.string().nullable(),
  detail: z.string().optional(),
})
export type RepoCheck = z.infer<typeof repoCheck>

export const checkStepOutput = extractStepOutput.extend({
  evidence: z.array(evidenceItem),
  llmVerdicts: z.array(llmVerdict),
  repoChecks: z.record(z.string(), repoCheck).describe('Claim id to GitHub result'),
})

export const agentVerdict = z.enum(['supported', 'contradicted', 'no_evidence', 'could_not_check'])

// Everything in this object is the agent's opinion. A human has not looked at it yet.
export const checkedClaim = claim.extend({
  agentVerdict,
  agentReason: z.string(),
  citedEvidence: z.array(evidenceItem),
  flagged: z.boolean(),
})
export type CheckedClaim = z.infer<typeof checkedClaim>

export const flagStepOutput = z.object({
  claims: z.array(checkedClaim),
  uncheckedSentences: z.array(sentence),
})

export const decision = z.object({
  claimId: z.string(),
  action: z.enum(['approve', 'correct', 'reject']),
  correctedFact: z.string().optional().describe('Required when action is correct'),
})
export type Decision = z.infer<typeof decision>

export const reviewResume = z.object({
  reviewer: z.string().min(1),
  decisions: z.array(decision).describe('One entry for each flagged claim. Can be sent in parts.'),
  approveSupported: z.boolean().describe('True if you read the supported claims and accept them'),
})

export const reviewSuspend = z.object({
  flagged: z.array(checkedClaim),
  supportedAwaitingApproval: z.array(checkedClaim),
  uncheckedSentences: z.array(sentence),
  decided: z.array(decision),
  problems: z.array(z.string()),
})

export const finalStatus = z.enum(['verified', 'corrected', 'rejected', 'not_verified'])

export const reportClaim = checkedClaim.extend({
  status: finalStatus,
  decidedBy: z.string().nullable(),
  correctedFact: z.string().nullable(),
})

export const report = z.object({
  claims: z.array(reportClaim),
  uncheckedSentences: z.array(sentence),
  counts: z.record(finalStatus, z.number()),
  factsAdded: z.array(z.string()),
})
export type Report = z.infer<typeof report>
