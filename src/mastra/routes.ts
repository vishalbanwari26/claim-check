import { registerApiRoute } from '@mastra/core/server'
import type { MiddlewareHandler } from '@mastra/core/server'
import { parseDecisions } from './decisions'
import { isLocalSameOrigin } from './guard'
import { reviewPage } from './page'
import { pendingFor, startRun, submitDecisions } from './review'
import type { Workflow } from './review'
import { workflowInput } from './schemas'
import { summarizeRun } from './view'

// Every review route answers only requests made from this machine by a page served from here.
export const localOnly: MiddlewareHandler = async (c, next) => {
  if (!isLocalSameOrigin(c.req.header('origin'), c.req.header('host'))) return c.json({ error: 'Not allowed from this origin' }, 403)
  await next()
}

type Context = Parameters<MiddlewareHandler>[0]

export const statusFor = (message: string) => (message.startsWith('No run') ? 404 : message.includes('not suspended') ? 409 : 500) as 404 | 409 | 500

const fail = (c: Context, e: unknown) => {
  const message = e instanceof Error ? e.message : String(e)
  return c.json({ error: message }, statusFor(message))
}

const workflowOf = (c: Context) => c.get('mastra').getWorkflow('claim-check') as Workflow

// Runs waiting for a human, newest information first is left to the page.
export const listRunsRoute = registerApiRoute('/review/runs', {
  method: 'GET',
  middleware: localOnly,
  handler: async c => {
    try {
      const workflow = workflowOf(c)
      const { runs } = await workflow.listWorkflowRuns({ status: 'suspended' })
      const states = await Promise.all(runs.map(r => workflow.getWorkflowRunById(r.runId)))
      return c.json(states.filter(Boolean).map(s => summarizeRun(s!)))
    } catch (e) {
      return fail(c, e)
    }
  },
})

export const getRunRoute = registerApiRoute('/review/runs/:id', {
  method: 'GET',
  middleware: localOnly,
  handler: async c => {
    try {
      return c.json(await pendingFor(workflowOf(c), c.req.param('id')))
    } catch (e) {
      return fail(c, e)
    }
  },
})

export const startRunRoute = registerApiRoute('/review/runs', {
  method: 'POST',
  middleware: localOnly,
  handler: async c => {
    const input = workflowInput.safeParse(await c.req.json().catch(() => null))
    if (!input.success) return c.json({ error: input.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400)
    try {
      return c.json(await startRun(workflowOf(c), input.data))
    } catch (e) {
      return fail(c, e)
    }
  },
})

// The only route that can lead to confirmed facts being written: it hands a validated
// submission to the workflow's human-review step, which decides whether everything is decided.
export const submitDecisionsRoute = registerApiRoute('/review/runs/:id/decisions', {
  method: 'POST',
  middleware: localOnly,
  handler: async c => {
    const parsed = parseDecisions(await c.req.json().catch(() => null))
    if (!parsed.ok) return c.json({ error: parsed.error }, 400)
    try {
      // Check the run first. Mastra's resume would otherwise create an empty run for an unknown id.
      const workflow = workflowOf(c)
      await pendingFor(workflow, c.req.param('id'))
      return c.json(await submitDecisions(workflow, c.req.param('id'), parsed.data))
    } catch (e) {
      return fail(c, e)
    }
  },
})

export const pageRoute = registerApiRoute('/review', {
  method: 'GET',
  middleware: localOnly,
  handler: async c => c.html(reviewPage),
})

export const reviewRoutes = [pageRoute, listRunsRoute, getRunRoute, startRunRoute, submitDecisionsRoute]
