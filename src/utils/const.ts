export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const CODEX_ISSUER = 'https://auth.openai.com'
export const CODEX_AUTHORIZE_URL = `${CODEX_ISSUER}/oauth/authorize`
export const CODEX_TOKEN_URL = `${CODEX_ISSUER}/oauth/token`

export const CODEX_DEFAULT_PORT = 1455
export const CODEX_FALLBACK_PORT = 1457

/** @see {@link https://github.com/openai/codex/blob/ebe75bb683b3c237aad9f039ab17b187048aa499/codex-rs/login/src/server.rs#L494} */
export const CODEX_SCOPE
  = 'openid profile email offline_access api.connectors.read api.connectors.invoke'

export const CODEX_BASE_URL
  = 'https://chatgpt.com/backend-api/codex/'
