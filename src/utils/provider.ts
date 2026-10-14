import type { LanguageModel } from '@xsai/text'

import type { CodexModels } from '../types/models'
import type { CodexAuthTokens } from './auth'

import { responses } from '@xsai/text-responses'

import { extractAccountId, refreshCodexAccessToken } from './auth'
import {
  CODEX_BASE_URL,
  CODEX_DEFAULT_ORIGINATOR,
  CODEX_DEFAULT_USER_AGENT,
  CODEX_TOKEN_REFRESH_MARGIN_MS,
} from './const'

export interface CreateCodexOptions {
  auth: (() => CodexAuthTokens | Promise<CodexAuthTokens>) | CodexAuthTokens
  fetch?: (request: Request) => Promise<Response>
  onAuthUpdate?: (auth: CodexAuthTokens) => Promise<void> | void
  originator?: string
  sessionId?: string
  userAgent?: string
}

export type CreateCodexResult = (model: CodexModels | (string & {})) => LanguageModel

export const createCodex = async (options: CreateCodexOptions): Promise<CreateCodexResult> => {
  let currentAuth = typeof options.auth === 'function'
    ? await options.auth()
    : options.auth

  let refresh: Promise<void> | undefined

  return model => async (modelOptions) => {
    modelOptions.signal?.throwIfAborted()
    if (refresh !== undefined || currentAuth.expires - CODEX_TOKEN_REFRESH_MARGIN_MS <= Date.now()) {
      // OAuth refresh tokens rotate. All models from this provider share one refresh.
      refresh ??= (async () => {
        const refreshed = await refreshCodexAccessToken(currentAuth.refresh)
        currentAuth = { ...refreshed, accountId: refreshed.accountId ?? currentAuth.accountId }
        await options.onAuthUpdate?.(currentAuth)
      })().finally(() => { refresh = undefined })
      await refresh
    }
    modelOptions.signal?.throwIfAborted()
    const accountId = currentAuth.accountId ?? extractAccountId({ access_token: currentAuth.access })
    if (accountId === undefined || accountId.length === 0)
      throw new Error('Codex auth did not include a ChatGPT account ID. Please sign in again.')

    return responses({
      apiKey: currentAuth.access,
      baseURL: CODEX_BASE_URL,
      fetch: options.fetch,
      headers: {
        'Accept': 'text/event-stream',
        'ChatGPT-Account-Id': accountId,
        'OpenAI-Beta': 'responses=experimental',
        'originator': options.originator ?? CODEX_DEFAULT_ORIGINATOR,
        'session_id': options.sessionId,
        'User-Agent': options.userAgent ?? CODEX_DEFAULT_USER_AGENT,
        'x-client-request-id': options.sessionId,
      },
      model,
    })({
      ...modelOptions,
      instructions: modelOptions.instructions === undefined || modelOptions.instructions.length === 0 ? 'You are a helpful assistant.' : modelOptions.instructions,
      maxOutputTokens: undefined,
      providerOptions: {
        ...modelOptions.providerOptions,
        responses: {
          include: ['reasoning.encrypted_content'],
          ...modelOptions.providerOptions?.responses,
          store: false,
        },
      },
    })
  }
}
