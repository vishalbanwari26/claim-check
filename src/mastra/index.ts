import { Mastra } from '@mastra/core/mastra'
import { MastraStorageExporter, Observability, SensitiveDataFilter } from '@mastra/observability'
import { claimExtractor, evidenceChecker } from './agents'
import { factMemory } from './ledger'
import { falseClaimsCaught, trueClaimsNotFlagged } from './scorers'
import { storage } from './storage'
import { checkRepoLanguage, readConfirmedFacts, readJobAd } from './tools'
import { claimCheck } from './workflows/claim-check'

export const mastra = new Mastra({
  storage,
  agents: { claimExtractor, evidenceChecker },
  // Registered under its own id. Studio's per-workflow Traces tab filters on this key, while
  // spans record the id, so a different key gives an empty tab.
  workflows: { 'claim-check': claimCheck },
  tools: { readConfirmedFacts, readJobAd, checkRepoLanguage },
  scorers: { falseClaimsCaught, trueClaimsNotFlagged },
  memory: { factMemory },
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'claim-check',
        exporters: [new MastraStorageExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
})
