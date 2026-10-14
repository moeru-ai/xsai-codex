import { sleepWithAbort } from '@moeru/std/sleep'
import { HttpError, sendRequest } from '@xsai/shared'

import {
  CODEX_CLIENT_ID,
  CODEX_DEFAULT_USER_AGENT,
  CODEX_DEVICE_AUTH_URL,
  CODEX_DEVICE_REDIRECT_URL,
  CODEX_DEVICE_TOKEN_URL,
  CODEX_DEVICE_URL,
  CODEX_ISSUER,
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

export interface CodexUserCodeInfo {
  instructions: string
  interval: number
  url: string
  userCode: string
}

interface CodexDeviceAuthResponse {
  device_auth_id: string
  expires_in?: number
  interval?: number | string
  user_code: string
}

interface CodexDeviceTokenResponse {
  authorization_code: string
  code_verifier: string
}

interface CodexIdTokenClaims {
  'chatgpt_account_id'?: string
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string
  }
}

interface CodexTokenResponse {
  access_token: string
  expires_in?: number
  id_token?: string
  refresh_token?: string
}

// sendRequest only serializes JSON or multipart bodies; OAuth requires URL encoding.
const requestTokens = async (body: Record<string, string>, signal?: AbortSignal): Promise<CodexTokenResponse> => {
  const response = await fetch(CODEX_TOKEN_URL, {
    body: new URLSearchParams({ client_id: CODEX_CLIENT_ID, ...body }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    signal,
  })
  if (!response.ok)
    throw new HttpError({ body: await response.text(), headers: response.headers, status: response.status })
  return response.json() as Promise<CodexTokenResponse>
}

export const extractAccountId = (tokens: Pick<CodexTokenResponse, 'access_token' | 'id_token'>): string | undefined => {
  for (const token of [tokens.access_token, tokens.id_token]) {
    if (typeof token !== 'string')
      continue
    const parts = token.split('.')
    if (parts.length !== 3)
      continue
    try {
      const bytes = Uint8Array.fromBase64(parts[1], { alphabet: 'base64url' })
      const claims = JSON.parse(new TextDecoder().decode(bytes)) as CodexIdTokenClaims
      const accountId = claims?.['https://api.openai.com/auth']?.chatgpt_account_id ?? claims?.chatgpt_account_id
      if (typeof accountId === 'string' && accountId.length > 0)
        return accountId
    }
    catch {
      // An opaque or malformed token may still have a usable ID-token fallback.
    }
  }
}

const toCodexAuthTokens = (
  tokens: CodexTokenResponse,
  refreshToken?: string,
): CodexAuthTokens => {
  const accountId = extractAccountId(tokens)
  const refresh = tokens.refresh_token ?? refreshToken

  if (typeof tokens.access_token !== 'string' || tokens.access_token.length === 0) {
    throw new Error('Codex token response did not include an access token.')
  }
  if (typeof refresh !== 'string' || refresh.length === 0) {
    throw new Error('Codex token response did not include a refresh token.')
  }
  if (typeof tokens.expires_in !== 'number' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) {
    throw new Error('Codex token response did not include a valid expiration.')
  }

  return {
    access: tokens.access_token,
    ...(accountId !== undefined && accountId.length > 0 && { accountId }),
    expires: Date.now() + tokens.expires_in * 1000,
    refresh,
  }
}

export const refreshCodexAccessToken = async (
  refreshToken: string,
  signal?: AbortSignal,
): Promise<CodexAuthTokens> => {
  const tokens = await requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken }, signal)

  return toCodexAuthTokens(tokens, refreshToken)
}

export const authorizeCodexHeadless = async (
  options: CodexHeadlessAuthorizeOptions = {},
): Promise<CodexAuthTokens> => {
  const signal = options.signal === undefined
    ? AbortSignal.timeout(15 * 60_000)
    : AbortSignal.any([options.signal, AbortSignal.timeout(15 * 60_000)])
  const httpOptions = { baseURL: CODEX_ISSUER, headers: { 'User-Agent': CODEX_DEFAULT_USER_AGENT } }
  const deviceResponse = await sendRequest({
    body: { client_id: CODEX_CLIENT_ID },
    path: CODEX_DEVICE_AUTH_URL,
    signal,
  }, httpOptions)
  const deviceData = await deviceResponse.json() as CodexDeviceAuthResponse
  const pollSeconds = Number.parseFloat(String(deviceData.interval ?? 5))
  const interval = (Number.isFinite(pollSeconds) ? Math.max(pollSeconds, 1) : 5) * 1000
  const expires = Date.now() + (deviceData.expires_in ?? 15 * 60) * 1000

  await options.onUserCode?.({
    instructions: `Open ${CODEX_DEVICE_URL} and enter code: ${deviceData.user_code}`,
    interval,
    url: CODEX_DEVICE_URL,
    userCode: deviceData.user_code,
  })

  while (true) {
    signal.throwIfAborted()
    if (Date.now() >= expires)
      throw new Error('Codex device authorization expired. Please sign in again.')
    let response: Response
    try {
      response = await sendRequest({
        body: { device_auth_id: deviceData.device_auth_id, user_code: deviceData.user_code },
        path: CODEX_DEVICE_TOKEN_URL,
        signal,
      }, httpOptions)
    }
    catch (error) {
      if (!(error instanceof HttpError) || (error.status !== 403 && error.status !== 404))
        throw error
      await sleepWithAbort(interval + CODEX_OAUTH_POLLING_SAFETY_MARGIN_MS, signal)
      continue
    }
    const deviceToken = await response.json() as CodexDeviceTokenResponse
    const tokens = await requestTokens({
      code: deviceToken.authorization_code,
      code_verifier: deviceToken.code_verifier,
      grant_type: 'authorization_code',
      redirect_uri: CODEX_DEVICE_REDIRECT_URL,
    }, signal)
    return toCodexAuthTokens(tokens)
  }
}
