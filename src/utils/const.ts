import { version } from '../../package.json'

export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const CODEX_ISSUER = 'https://auth.openai.com'
export const CODEX_TOKEN_URL = `${CODEX_ISSUER}/oauth/token`
export const CODEX_DEVICE_AUTH_URL = `${CODEX_ISSUER}/api/accounts/deviceauth/usercode`
export const CODEX_DEVICE_TOKEN_URL = `${CODEX_ISSUER}/api/accounts/deviceauth/token`
export const CODEX_DEVICE_URL = `${CODEX_ISSUER}/codex/device`
export const CODEX_DEVICE_REDIRECT_URL = `${CODEX_ISSUER}/deviceauth/callback`

export const CODEX_OAUTH_POLLING_SAFETY_MARGIN_MS = 3000
export const CODEX_TOKEN_REFRESH_MARGIN_MS = 60_000
export const CODEX_DUMMY_API_KEY = 'codex-oauth'
export const CODEX_DEFAULT_ORIGINATOR = 'xsai-codex'
export const CODEX_DEFAULT_USER_AGENT = `xsai-codex/${version}`

export const CODEX_BASE_URL
  = 'https://chatgpt.com/backend-api/codex/'
