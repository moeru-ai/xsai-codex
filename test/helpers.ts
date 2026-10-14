import type { CodexAuthTokens } from '../src'

import { Buffer } from 'node:buffer'

export const jwt = (claims: unknown): string => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`

export const auth = (expires = Date.now() + 3_600_000): CodexAuthTokens => ({
  access: jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'account' } }),
  expires,
  refresh: 'refresh-token',
})

export const tokens = (): Record<string, unknown> => ({
  access_token: auth().access,
  expires_in: 3600,
  refresh_token: 'rotated-refresh-token',
})

export const completion = (type = 'response.completed', text = 'Hello'): Record<string, unknown> => ({
  response: {
    id: 'response-id',
    output: [{ content: [{ text, type: 'output_text' }], id: 'message-id', role: 'assistant', type: 'message' }],
    status: 'completed',
    usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
  },
  type,
})

export const sse = (events: unknown[], chunkSize = 7): Response => {
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''))
  let offset = 0
  return new Response(new ReadableStream<Uint8Array>({
    pull: (controller) => {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize))
      offset += chunkSize
    },
  }), { headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'test-id' } })
}
