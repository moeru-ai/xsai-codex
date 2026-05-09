import type { ResponsesOptions } from '@xsai-ext/responses'

import type { CodexModels } from '../types/models'
import type { CodexAuthTokens } from './auth'

import { refreshCodexAccessToken } from './auth'
import {
  CODEX_BASE_URL,
  CODEX_DEFAULT_ORIGINATOR,
  CODEX_DEFAULT_USER_AGENT,
  CODEX_DUMMY_API_KEY,
  CODEX_TOKEN_REFRESH_MARGIN_MS,
} from './const'

export interface CreateCodexOptions {
  auth?: (() => CodexAuthTokens | Promise<CodexAuthTokens>) | CodexAuthTokens
  onAuthUpdate?: (auth: CodexAuthTokens) => Promise<void> | void
  originator?: string
  sessionId?: string
  userAgent?: string
}

export type CreateCodexResult = (model: CodexModels | (string & {})) => Promise<Pick<ResponsesOptions, 'apiKey' | 'baseURL' | 'headers' | 'model'>>

export const createCodex = async (options: CreateCodexOptions = {}): Promise<CreateCodexResult> => {
  let currentAuth = typeof options.auth === 'function'
    ? await options.auth()
    : options.auth

  const resolveAuth = async (): Promise<CodexAuthTokens | undefined> => {
    if (currentAuth === undefined && typeof options.auth === 'function') {
      currentAuth = await options.auth()
    }

    if (currentAuth !== undefined) {
      if (currentAuth.expires - CODEX_TOKEN_REFRESH_MARGIN_MS <= Date.now()) {
        const refreshed = await refreshCodexAccessToken(currentAuth.refresh)
        currentAuth = {
          ...refreshed,
          accountId: refreshed.accountId ?? currentAuth.accountId,
        }
        await options.onAuthUpdate?.(currentAuth)
      }
    }

    return currentAuth
  }

  return async (model) => {
    const auth = await resolveAuth()

    return {
      apiKey: auth === undefined ? undefined : CODEX_DUMMY_API_KEY,
      baseURL: CODEX_BASE_URL,
      headers: {
        ...(auth !== undefined && { Authorization: `Bearer ${auth.access}` }),
        ...(auth?.accountId !== undefined && auth.accountId.length > 0 && { 'ChatGPT-Account-Id': auth.accountId }),
        'originator': options.originator ?? CODEX_DEFAULT_ORIGINATOR,
        'User-Agent': options.userAgent ?? CODEX_DEFAULT_USER_AGENT,
        ...(options.sessionId !== undefined && options.sessionId.length > 0 && { session_id: options.sessionId }),
      },
      model,
    }
  }
}
