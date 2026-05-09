import type { CodexAuthTokens } from '../src/index'

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { cwd, env, exit, loadEnvFile } from 'node:process'

import { confirm, intro, isCancel, log, note, outro, spinner } from '@clack/prompts'
import { responses } from '@xsai-ext/responses'

import { authorizeCodexHeadless, createCodex } from '../src/index'

const ENV_PATH = resolve(cwd(), '.env.local')
const CODEX_ENV_KEYS = [
  'CODEX_ACCESS_TOKEN',
  'CODEX_REFRESH_TOKEN',
  'CODEX_EXPIRES_AT',
  'CODEX_ACCOUNT_ID',
]

const authFromEnv = (): CodexAuthTokens | undefined => {
  const access = env.CODEX_ACCESS_TOKEN
  const refresh = env.CODEX_REFRESH_TOKEN
  const expiresAt = env.CODEX_EXPIRES_AT

  if (access === undefined || refresh === undefined || expiresAt === undefined) {
    return undefined
  }

  const expires = Date.parse(expiresAt)

  if (Number.isNaN(expires)) {
    return undefined
  }

  return {
    access,
    ...(env.CODEX_ACCOUNT_ID !== undefined && env.CODEX_ACCOUNT_ID.length > 0 && { accountId: env.CODEX_ACCOUNT_ID }),
    expires,
    refresh,
  }
}

const readEnv = async (): Promise<string> => {
  try {
    return await readFile(ENV_PATH, 'utf8')
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return ''
    }

    throw error
  }
}

const loadLocalEnv = (): void => {
  try {
    loadEnvFile(ENV_PATH)
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return
    }

    log.warn(error instanceof Error ? `Failed to load .env.local: ${error.message}` : 'Failed to load .env.local.')
  }
}

const quoteEnvValue = (value: string): string => JSON.stringify(value)

const toEnvEntries = (auth: CodexAuthTokens): Record<string, string> => ({
  CODEX_ACCESS_TOKEN: auth.access,
  ...(auth.accountId !== undefined && auth.accountId.length > 0 && { CODEX_ACCOUNT_ID: auth.accountId }),
  CODEX_EXPIRES_AT: new Date(auth.expires).toISOString(),
  CODEX_REFRESH_TOKEN: auth.refresh,
})

const mergeEnv = (env: string, entries: Record<string, string>): string => {
  const lines = env.split(/\r?\n/)
  const filtered = lines.filter((line) => {
    const key = /^([A-Z0-9_]+)=/.exec(line)?.[1]

    return key === undefined || !CODEX_ENV_KEYS.includes(key)
  })
  const trimmed = filtered.join('\n').trimEnd()
  const nextLines = Object.entries(entries).map(([key, value]) => `${key}=${quoteEnvValue(value)}`)

  return `${trimmed.length > 0 ? `${trimmed}\n\n` : ''}${nextLines.join('\n')}\n`
}

const persistAuth = async (existingEnv: string, auth: CodexAuthTokens): Promise<void> => {
  await writeFile(ENV_PATH, mergeEnv(existingEnv, toEnvEntries(auth)))
}

const runDemo = async (auth: CodexAuthTokens, existingEnv: string): Promise<string> => {
  let latestAuth = auth
  const codex = await createCodex({
    auth,
    onAuthUpdate: async (nextAuth) => {
      latestAuth = nextAuth
      await persistAuth(existingEnv, nextAuth)
    },
  })
  const result = responses({
    ...(await codex('gpt-5.4-mini')),
    input: 'Hello!',
    instructions: 'You\'re a helpful assistant.',
    // maxOutputTokens: 80,
    reasoning: { effort: 'none' },
    store: false,
  })

  const text = await Array.fromAsync(result.textStream).then(chunks => chunks.join(''))

  if (latestAuth !== auth) {
    Object.assign(auth, latestAuth)
  }

  return text
}

const signIn = async (): Promise<CodexAuthTokens> => {
  const s = spinner()

  s.start('Waiting for Codex authorization')

  try {
    const auth = await authorizeCodexHeadless({
      onUserCode: ({ instructions }) => {
        s.stop('Open the authorization page')
        note(instructions, 'Codex device login')
        s.start('Waiting for authorization')
      },
    })

    s.stop('Authorization complete')

    return auth
  }
  catch (error) {
    s.error('Authorization failed')
    throw error
  }
}

intro('xsAI Codex Example')

loadLocalEnv()

const existingEnv = await readEnv()
const existingAuth = authFromEnv()

try {
  if (existingAuth !== undefined) {
    log.info('Found Codex auth in .env.local. Trying it first.')

    try {
      const text = await runDemo(existingAuth, existingEnv)

      note(text, 'gpt-5.4-mini')
      outro('Existing Codex auth works.')
      exit(0)
    }
    catch (error) {
      log.warn(error instanceof Error ? `Existing Codex auth failed: ${error.message}` : 'Existing Codex auth failed.')
    }
  }

  if (existingAuth !== undefined) {
    const retry = await confirm({
      initialValue: true,
      message: 'Sign in again and overwrite .env.local?',
    })

    if (isCancel(retry) || !retry) {
      log.warn('Auth was not changed.')
      exit(0)
    }
  }

  const auth = await signIn()

  await persistAuth(existingEnv, auth)

  log.success(`Saved Codex auth to ${ENV_PATH}`)

  const text = await runDemo(auth, existingEnv)

  note(text, 'gpt-5.4-mini')
  outro('Codex auth is ready.')
}
catch (error) {
  log.error(error instanceof Error ? error.message : String(error))
  exit(1)
}
