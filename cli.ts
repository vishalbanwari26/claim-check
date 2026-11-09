import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { mastra } from './src/mastra'
import { readAllConfirmed, readInferred, retractConfirmed } from './src/mastra/ledger'
import { pendingFor, startRun, submitDecisions } from './src/mastra/review'
import { reviewUrl } from './src/mastra/view'
import { flagStepOutput, type Decision, type Report, type ReviewView } from './src/mastra/schemas'
import type { z } from 'zod'

const workflow = mastra.getWorkflow('claim-check')

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    candidate: { type: 'string', default: 'ines-varga' },
    job: { type: 'string', default: 'quillbeam-ai-engineer' },
    reviewer: { type: 'string', default: 'candidate' },
    decisions: { type: 'string' },
    reason: { type: 'string', default: '' },
  },
})
const [command, arg, target] = positionals

const showClaim = (c: z.infer<typeof flagStepOutput>['claims'][number]) => {
  console.log(`  ${c.id} [${c.agentVerdict}] ${c.text}`)
  console.log(`     agent says: ${c.agentReason}`)
  for (const e of c.citedEvidence) console.log(`     evidence ${e.id}: ${e.text.split('\n')[0]}`)
}

const showPending = (p: ReviewView) => {
  console.log(`\nFLAGGED, needs a human decision (${p.flagged.length}):`)
  p.flagged.forEach(showClaim)
  console.log(`\nAGENT THINKS SUPPORTED, not verified until you approve (${p.supportedAwaitingApproval.length}):`)
  p.supportedAwaitingApproval.forEach(showClaim)
  if (p.uncheckedSentences.length) {
    console.log('\nNO CLAIM TAKEN FROM THESE SENTENCES, read them yourself:')
    for (const s of p.uncheckedSentences) console.log(`  S${s.n}: ${s.text}`)
  }
  for (const problem of p.problems) console.log(`\nPROBLEM: ${problem}`)
}

const showReport = (r: Report) => {
  console.log('\nRESULT')
  for (const c of r.claims) {
    const who = c.decidedBy ? `by ${c.decidedBy}` : 'nobody signed off'
    console.log(`  ${c.status.padEnd(12)} ${c.id} ${c.text} (${who})`)
    if (c.correctedFact) console.log(`  ${''.padEnd(12)}    correct fact: ${c.correctedFact}`)
  }
  console.log(`\nCounts: ${JSON.stringify(r.counts)}. Facts added to memory: ${r.factsAdded.join(', ') || 'none'}.`)
}

const askDecisions = async (p: ReviewView) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const decisions: Decision[] = []
  for (const c of p.flagged.filter(c => !p.decided.some(d => d.claimId === c.id))) {
    console.log()
    showClaim(c)
    const answer = (await rl.question('  [a]pprove as true, [c]orrect, [r]eject, [s]kip for now: ')).trim().toLowerCase()
    if (answer === 'a') decisions.push({ claimId: c.id, action: 'approve' })
    if (answer === 'r') decisions.push({ claimId: c.id, action: 'reject' })
    if (answer === 'c') decisions.push({ claimId: c.id, action: 'correct', correctedFact: await rl.question('  What is actually true? ') })
  }
  const approveSupported =
    p.supportedAwaitingApproval.length > 0 &&
    (await rl.question(`\nApprove the ${p.supportedAwaitingApproval.length} claims the agent thinks are supported? [y/N] `)).trim().toLowerCase() === 'y'
  rl.close()
  return { reviewer: flags.reviewer!, decisions, approveSupported }
}

if (command === 'check' && arg) {
  const { runId, pending } = await startRun(workflow, {
    draft: readFileSync(arg, 'utf8'), candidateId: flags.candidate!, jobId: flags.job!,
  })
  showPending(pending)
  console.log(`\nStopped for review. Nothing is verified yet. This process can exit, the run is saved.`)
  console.log(`Run id: ${runId}\nNext:   npm run review -- ${runId}\nPage:   ${reviewUrl(runId)}`)
} else if (command === 'review') {
  if (!arg) {
    const { runs } = await workflow.listWorkflowRuns({ status: 'suspended' })
    console.log(runs.length ? runs.map(r => `${r.runId}  ${r.updatedAt}`).join('\n') : 'No runs waiting for review.')
  } else {
    const pending = await pendingFor(workflow, arg)
    const resumeData = flags.decisions ? JSON.parse(readFileSync(flags.decisions, 'utf8')) : await (showPending(pending), askDecisions(pending))
    const outcome = await submitDecisions(workflow, arg, resumeData)
    if (outcome.done) showReport(outcome.report)
    else showPending(outcome.pending)
  }
} else if (command === 'facts' && arg === 'retract' && target) {
  const fact = await retractConfirmed(flags.candidate!, target, { by: flags.reviewer!, reason: flags.reason! })
  console.log(`Retracted ${fact.id}: ${fact.text}\nFirst confirmed by ${fact.confirmedBy} in run ${fact.runId}. Later runs will not use it as evidence.`)
  console.log('Earlier runs that relied on it are unchanged, so check those drafts again.')
} else if (command === 'facts' && !arg) {
  const all = await readAllConfirmed(flags.candidate!)
  const confirmed = all.filter(f => !f.retracted)
  console.log(`CONFIRMED BY A HUMAN, used as evidence (${confirmed.length}):`)
  for (const f of confirmed) console.log(`  ${f.id} [${f.source}, ${f.confirmedBy}] ${f.text}`)
  const retracted = all.filter(f => f.retracted)
  if (retracted.length) console.log(`\nRETRACTED, no longer used as evidence (${retracted.length}):`)
  for (const f of retracted) console.log(`  ${f.id} [${f.source}, ${f.confirmedBy}] ${f.text}\n     retracted by ${f.retracted!.by}: ${f.retracted!.reason}`)
  const inferred = await readInferred(flags.candidate!)
  console.log(`\nINFERRED BY THE AGENT, never used as evidence (${inferred.length}, showing the last 10):`)
  for (const i of inferred.slice(-10)) console.log(`  ${i.runId.slice(0, 8)} ${i.claimId} [${i.verdict}] ${i.claimText}`)
} else {
  console.log('Usage:\n  npm run check -- <draft file>\n  npm run review [-- <run id> [--decisions file.json]]\n  npm run facts\n  npm run facts -- retract <fact id> --reviewer <name> --reason <why>')
  process.exitCode = 1
}
