import {
  CODEX_CLIENT_ID,
  CODEX_DEFAULT_USER_AGENT,
  CODEX_DEVICE_AUTH_URL,
  CODEX_DEVICE_REDIRECT_URL,
  CODEX_DEVICE_TOKEN_URL,
  CODEX_DEVICE_URL,
  CODEX_OAUTH_POLLING_SAFETY_MARGIN_MS,
  CODEX_TOKEN_URL,
} from './const'

export interface CodexAuthTokens {
  access: string
  accountId?: string
  expires: number
  refresh: string
}

export interface CodexHeadlessAuthorizeOptions {
  onUserCode?: (info: CodexUserCodeInfo) => Promise<void> | void
  signal?: AbortSignal
}

export interface CodexIdTokenClaims {
  'chatgpt_account_id'?: string
  'email'?: string
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string
  }
  'organizations'?: Array<{ id: string }>
}

export interface CodexTokenResponse {
  access_token: string
  expires_in?: number
  id_token?: string
  refresh_token?: string
}

export interface CodexUserCodeInfo {
  instructions: string
  interval: number
  url: string
  userCode: string
}

interface CodexDeviceAuthResponse {
  device_auth_id: string
  interval?: number | string
  user_code: string
}

interface CodexDeviceTokenResponse {
  authorization_code: string
  code_verifier: string
}

const sleep = async (ms: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) {
    throw signal.reason
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)

    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })
}

const formatResponseError = async (message: string, response: Response): Promise<string> => {
  const body = await response.text().catch(() => '')
  const details = body.trim().slice(0, 500)

  return details.length > 0
    ? `${message}: ${response.status} ${details}`
    : `${message}: ${response.status}`
}

const jsonFetch = async <T>(
  url: string,
  init: RequestInit,
  errorMessage: string,
): Promise<T> => {
  const response = await fetch(url, init)

  if (!response.ok) {
    throw new Error(await formatResponseError(errorMessage, response))
  }

  return response.json() as Promise<T>
}

export const parseJwtClaims = (token: string): CodexIdTokenClaims | undefined => {
  const parts = token.split('.')

  if (parts.length !== 3) {
    return undefined
  }

  try {
    const payload = parts[1]
    const bytes = Uint8Array.fromBase64(payload, { alphabet: 'base64url' })

    return JSON.parse(new TextDecoder().decode(bytes)) as CodexIdTokenClaims
  }
  catch {
    return undefined
  }
}

export const extractAccountIdFromClaims = (claims: CodexIdTokenClaims): string | undefined => (
  claims.chatgpt_account_id
  ?? claims['https://api.openai.com/auth']?.chatgpt_account_id
  ?? claims.organizations?.[0]?.id
)

export const extractAccountId = (tokens: Pick<CodexTokenResponse, 'access_token' | 'id_token'>): string | undefined => {
  if (tokens.id_token !== undefined && tokens.id_token.length > 0) {
    const claims = parseJwtClaims(tokens.id_token)
    const accountId = claims === undefined ? undefined : extractAccountIdFromClaims(claims)

    if (accountId !== undefined && accountId.length > 0) {
      return accountId
    }
  }

  const claims = parseJwtClaims(tokens.access_token)

  return claims === undefined ? undefined : extractAccountIdFromClaims(claims)
}

export const toCodexAuthTokens = (
  tokens: CodexTokenResponse,
  options: {
    accountId?: string
    refreshToken?: string
  } = {},
): CodexAuthTokens => {
  const accountId = options.accountId ?? extractAccountId(tokens)
  const refresh = tokens.refresh_token ?? options.refreshToken

  if (refresh === undefined || refresh.length === 0) {
    throw new Error('Codex token response did not include a refresh token.')
  }

  return {
    access: tokens.access_token,
    ...(accountId !== undefined && accountId.length > 0 && { accountId }),
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    refresh,
  }
}

export const refreshCodexAccessToken = async (
  refreshToken: string,
): Promise<CodexAuthTokens> => {
  const tokens = await jsonFetch<CodexTokenResponse>(
    CODEX_TOKEN_URL,
    {
      body: new URLSearchParams({
        client_id: CODEX_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    },
    'Codex token refresh failed',
  )

  return toCodexAuthTokens(tokens, { refreshToken })
}

export const authorizeCodexHeadless = async (
  options: CodexHeadlessAuthorizeOptions = {},
): Promise<CodexAuthTokens> => {
  const deviceData = await jsonFetch<CodexDeviceAuthResponse>(
    CODEX_DEVICE_AUTH_URL,
    {
      body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': CODEX_DEFAULT_USER_AGENT,
      },
      method: 'POST',
      signal: options.signal,
    },
    'Failed to initiate Codex device authorization',
  )
  const interval = Math.max(Number.parseInt(String(deviceData.interval ?? 5)), 1) * 1000

  await options.onUserCode?.({
    instructions: `Open ${CODEX_DEVICE_URL} and enter code: ${deviceData.user_code}`,
    interval,
    url: CODEX_DEVICE_URL,
    userCode: deviceData.user_code,
  })

  while (true) {
    const response = await fetch(CODEX_DEVICE_TOKEN_URL, {
      body: JSON.stringify({
        device_auth_id: deviceData.device_auth_id,
        user_code: deviceData.user_code,
      }),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': CODEX_DEFAULT_USER_AGENT,
      },
      method: 'POST',
      signal: options.signal,
    })

    if (response.ok) {
      const deviceToken = await response.json() as CodexDeviceTokenResponse
      const tokens = await jsonFetch<CodexTokenResponse>(
        CODEX_TOKEN_URL,
        {
          body: new URLSearchParams({
            client_id: CODEX_CLIENT_ID,
            code: deviceToken.authorization_code,
            code_verifier: deviceToken.code_verifier,
            grant_type: 'authorization_code',
            redirect_uri: CODEX_DEVICE_REDIRECT_URL,
          }).toString(),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          method: 'POST',
          signal: options.signal,
        },
        'Codex token exchange failed',
      )

      return toCodexAuthTokens(tokens)
    }

    if (response.status !== 403 && response.status !== 404) {
      throw new Error(await formatResponseError('Codex device authorization failed', response))
    }

    await sleep(interval + CODEX_OAUTH_POLLING_SAFETY_MARGIN_MS, options.signal)
  }
}
