import type { z } from 'zod'
import { flagStepOutput, reviewView } from './schemas'
import { buildReviewView, unwrapSuspend } from './view'
import type { Report, reviewResume, workflowInput } from './schemas'
import type { claimCheck } from './workflows/claim-check'

export type Workflow = typeof claimCheck

export const REVIEW_STEP = 'human-review'

type SavedStep = { payload?: unknown; suspendPayload?: unknown; output?: unknown } | undefined

// The all-claims view of a paused review, from a run's steps. Runs saved before the slim payload
// kept it whole in the suspend payload. Newer runs keep every claim in the review step's input,
// which a fresh start or resume result only has as the output of the flag-claims step.
export const viewFromSteps = (steps: Record<string, unknown> | undefined) => {
  const review = steps?.[REVIEW_STEP] as SavedStep
  const suspend = review?.suspendPayload as Record<string, unknown> | undefined
  if (suspend && 'flagged' in suspend) return reviewView.parse(suspend)
  const flagOutput = (steps?.['flag-claims'] as SavedStep)?.output
  return buildReviewView(flagStepOutput.parse(review?.payload ?? flagOutput), unwrapSuspend(suspend))
}

export const pendingFor = async (workflow: Workflow, runId: string) => {
  const state = await workflow.getWorkflowRunById(runId)
  if (!state) throw new Error(`No run ${runId}`)
  if (state.status !== 'suspended') throw new Error(`Run ${runId} is ${state.status}, not suspended`)
  return viewFromSteps(state.steps)
}

export const startRun = async (workflow: Workflow, input: z.infer<typeof workflowInput>) => {
  const run = await workflow.createRun()
  const result = await run.start({ inputData: input })
  if (result.status !== 'suspended') throw new Error(`Expected to stop for review, got ${result.status}: ${JSON.stringify(result)}`)
  return { runId: run.runId, pending: viewFromSteps(result.steps) }
}

export const submitDecisions = async (workflow: Workflow, runId: string, resumeData: z.infer<typeof reviewResume>) => {
  const run = await workflow.createRun({ runId })
  const result = await run.resume({ step: REVIEW_STEP, resumeData })
  if (result.status === 'success') return { done: true as const, report: result.result as Report }
  if (result.status === 'suspended') return { done: false as const, pending: viewFromSteps(result.steps) }
  throw new Error(`Resume ended as ${result.status}: ${JSON.stringify(result)}`)
}
