import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { LibSQLStore } from '@mastra/libsql'

// `mastra dev` runs the server from a build folder, so a relative path would give Studio
// and the CLI two different databases. Walking up to our package.json gives them one.
export const projectRoot = () => {
  for (let dir = process.cwd(); dir !== dirname(dir); dir = dirname(dir)) {
    const pkg = join(dir, 'package.json')
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).name === 'claim-check') return dir
  }
  throw new Error(`Not inside the claim-check project: ${process.cwd()}`)
}

const defaultUrl = () => {
  const dir = join(projectRoot(), '.data')
  mkdirSync(dir, { recursive: true })
  return `file:${join(dir, 'claim-check.db')}`
}

export const storage = new LibSQLStore({ id: 'claim-check', url: process.env.CLAIM_CHECK_DB ?? defaultUrl() })
