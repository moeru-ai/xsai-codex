import assert from 'node:assert/strict'

import { test } from 'node:test'

import { generateText, streamText, tool } from '@xsai/text'

import { createCodex } from '../src'
import { auth, completion, sse, tokens } from './helpers'

void test('xsAI beta model sends Codex-compatible requests and streams text', async () => {
  let requestBody: Record<string, unknown> | undefined
  const codex = await createCodex({
    auth: auth(),
    fetch: async (request) => {
      assert.equal(request.url, 'https://chatgpt.com/backend-api/codex/responses')
      assert.equal(request.headers.get('Authorization'), `Bearer ${auth().access}`)
      assert.equal(request.headers.get('chatgpt-account-id'), 'account')
      assert.equal(request.headers.get('OpenAI-Beta'), 'responses=experimental')
      assert.equal(request.headers.get('accept'), 'text/event-stream')
      assert.equal(request.headers.get('originator'), 'test-app')
      assert.equal(request.headers.get('User-Agent'), 'test-agent')
      assert.equal(request.headers.get('session_id'), 'session')
      assert.equal(request.headers.get('x-client-request-id'), 'session')
      requestBody = await request.json() as Record<string, unknown>
      return sse([
        { content_index: 0, delta: 'Hello', output_index: 0, type: 'response.output_text.delta' },
        completion('response.done'),
      ])
    },
    originator: 'test-app',
    sessionId: 'session',
    userAgent: 'test-agent',
  })
  const { result, stream } = streamText(codex('gpt-6.1-sol'), {
    input: 'Hi',
    maxOutputTokens: 100,
    providerOptions: { responses: { parallelToolCalls: false, store: true } },
    reasoningEffort: 'low',
  })
  const events = await Array.fromAsync(stream)
  assert(events.some(event => event.type === 'text.delta' && event.delta === 'Hello'))
  assert.equal((await result).text, 'Hello')
  assert.equal(requestBody?.model, 'gpt-6.1-sol')
  assert.equal(requestBody?.stream, true)
  assert.equal(requestBody?.store, false)
  assert.equal(requestBody?.instructions, 'You are a helpful assistant.')
  assert(!Object.hasOwn(requestBody, 'max_output_tokens'))
  assert.equal(requestBody?.parallel_tool_calls, false)
  assert.deepEqual(requestBody?.reasoning, { effort: 'low' })
  assert.deepEqual(requestBody?.include, ['reasoning.encrypted_content'])
})

void test('generateText preserves tools, history, images, reasoning and structured output', async () => {
  const codex = await createCodex({
    auth: auth(),
    fetch: async (request) => {
      const body = await request.json() as Record<string, unknown>
      assert.equal(body.instructions, 'Custom instructions')
      assert.deepEqual(body.tool_choice, { name: 'lookup', type: 'function' })
      assert.equal((body.tools as { name: string }[])[0].name, 'lookup')
      assert.equal((body.text as { format: { type: string } }).format.type, 'json_schema')
      assert.deepEqual(body.input, [
        { content: [{ image_url: 'https://example.com/image.png', type: 'input_image' }], role: 'user', type: 'message' },
        { encrypted_content: 'encrypted', id: 'reasoning-id', summary: [], type: 'reasoning' },
        { arguments: '{"query":"test"}', call_id: 'call-id', id: 'tool-id', name: 'lookup', type: 'function_call' },
        { call_id: 'call-id', output: 'result', type: 'function_call_output' },
      ])
      return sse([completion('response.completed', '{"answer":"yes"}')])
    },
  })
  const result = await generateText(codex('custom-model'), {
    input: [
      { content: [{ data: 'https://example.com/image.png', type: 'image' }], role: 'user' },
      { content: [
        { content: [{ text: 'encrypted', type: 'encrypted' }], id: 'reasoning-id', type: 'reasoning' },
        { arguments: '{"query":"test"}', callId: 'call-id', id: 'tool-id', name: 'lookup', type: 'tool-call' },
      ], role: 'assistant' },
      { content: [{ callId: 'call-id', output: 'result', type: 'tool-result' }], role: 'user' },
    ],
    instructions: 'Custom instructions',
    outputFormat: { properties: { answer: { type: 'string' } }, type: 'object' },
    toolChoice: { name: 'lookup' },
    tools: [{ inputSchema: { schema: { properties: { query: { type: 'string' } }, type: 'object' } }, name: 'lookup' }],
  })
  assert.equal(result.text, '{"answer":"yes"}')
})

void test('model refreshes at invocation time and coalesces concurrent refreshes across models', async (t) => {
  let refreshCount = 0
  let updates = 0
  let sent = 0
  let release!: () => void
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    refreshCount++
    assert.equal(new URLSearchParams(String(init.body)).get('refresh_token'), 'refresh-token')
    await barrier
    return Response.json(tokens())
  })
  const codex = await createCodex({
    auth: auth(0),
    fetch: async () => {
      sent++
      return sse([completion()])
    },
    onAuthUpdate: async (next) => {
      updates++
      assert.equal(next.refresh, 'rotated-refresh-token')
      assert.equal(next.accountId, 'account')
    },
  })
  const firstModel = codex('gpt-6-luna')
  const secondModel = codex('gpt-6.1-sol')
  assert.equal(refreshCount, 0)
  const requests = [generateText(firstModel, { input: 'Hi' }), generateText(secondModel, { input: 'Hi' })]
  await new Promise(resolve => setImmediate(resolve))
  const concurrentRefreshes = refreshCount
  release()
  assert.deepEqual((await Promise.all(requests)).map(result => result.text), ['Hello', 'Hello'])
  assert.equal(concurrentRefreshes, 1)
  assert.equal(updates, 1)
  assert.equal(sent, 2)
})

void test('refresh failure is retryable and fallback account ID survives refresh', async (t) => {
  let attempts = 0
  t.mock.method(globalThis, 'fetch', async () => {
    attempts++
    return attempts === 1 ? new Response('refresh unavailable', { status: 503 }) : Response.json({ ...tokens(), access_token: 'opaque' })
  })
  const codex = await createCodex({
    auth: { ...auth(0), accountId: 'saved-account' },
    fetch: async (request) => {
      assert.equal(request.headers.get('chatgpt-account-id'), 'saved-account')
      return sse([completion()])
    },
  })
  await assert.rejects(generateText(codex('gpt-6-luna'), { input: 'Hi' }), /503/)
  assert.equal((await generateText(codex('gpt-6-luna'), { input: 'Hi' })).text, 'Hello')
  assert.equal(attempts, 2)
})

void test('OpenAI and OpenResponses SSE errors, failed responses, HTTP errors and truncation propagate', async () => {
  const cases = [
    { pattern: /Too many requests/, response: () => sse([{ code: 'rate_limit', message: 'Too many requests', type: 'error' }]) },
    { pattern: /Nested error/, response: () => sse([{ error: { code: 'server_error', message: 'Nested error', param: null, type: 'server_error' }, type: 'error' }]) },
    { pattern: /Model failed/, response: () => sse([{ response: { error: { message: 'Model failed' }, output: [], status: 'failed' }, type: 'response.failed' }]) },
    { pattern: /401/, response: () => new Response('Not authorized', { status: 401 }) },
    { pattern: /terminal|truncat|ended|end/i, response: () => sse([{ type: 'response.created' }]) },
  ]
  for (const { pattern, response } of cases) {
    const codex = await createCodex({ auth: auth(), fetch: async () => response() })
    await assert.rejects(generateText(codex('gpt-6-luna'), { input: 'Hi' }), pattern)
  }
})

void test('native xsAI preserves raw Codex done events and handles missing status and DONE sentinel', async () => {
  const event = completion('response.done', '你好')
  delete (event.response as Record<string, unknown>).status
  const codex = await createCodex({
    auth: auth(),
    fetch: async () => {
      const response = sse([event], 1)
      return new Response(new ReadableStream<Uint8Array>({
        start: async (controller) => {
          for await (const chunk of response.body!)
            controller.enqueue(chunk)
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
          controller.close()
        },
      }), { headers: response.headers })
    },
  })
  const { result, stream } = streamText(codex('gpt-6-luna'), { includeRawEvents: true, input: 'Hi' })
  const events = await Array.fromAsync(stream)
  assert.deepEqual(events.find(event => event.type === 'raw')?.detail, event)
  assert.equal((await result).text, '你好')
})

void test('pre-aborted calls and missing account IDs fail before sending inference', async () => {
  const codex = await createCodex({ auth: auth(0), fetch: async () => {
    throw new Error('Must not send')
  } })
  const controller = new AbortController()
  controller.abort(new Error('Cancelled'))
  await assert.rejects(generateText(codex('gpt-6-luna'), { input: 'Hi', signal: controller.signal }), /Cancelled/)
  const missing = await createCodex({ auth: { ...auth(), access: 'opaque' }, fetch: async () => {
    throw new Error('Must not send')
  } })
  await assert.rejects(generateText(missing('gpt-6-luna'), { input: 'Hi' }), /account ID/)
})

void test('xsAI tool loop replays a Codex tool call and its result', async () => {
  let requests = 0
  let executions = 0
  const codex = await createCodex({
    auth: auth(),
    fetch: async (request) => {
      const body = await request.json() as { input: Record<string, unknown>[] }
      requests++
      if (requests === 1) {
        return sse([{
          response: {
            output: [{ arguments: '{"query":"test"}', call_id: 'call', id: 'tool', name: 'lookup', type: 'function_call' }],
            status: 'completed',
          },
          type: 'response.done',
        }])
      }
      assert.deepEqual(body.input.at(-1), { call_id: 'call', output: 'found', type: 'function_call_output' })
      return sse([completion()])
    },
  })
  const result = await generateText(codex('gpt-6.1-sol'), {
    input: 'Look up test',
    tools: [tool({
      execute: (input) => {
        executions++
        assert.deepEqual(input, { query: 'test' })
        return 'found'
      },
      inputSchema: { properties: { query: { type: 'string' } }, type: 'object' },
      name: 'lookup',
    })],
  })
  assert.equal(result.text, 'Hello')
  assert.equal(executions, 1)
  assert.equal(requests, 2)
})

void test('in-flight inference cancellation reaches the fetch request', async () => {
  const controller = new AbortController()
  const codex = await createCodex({
    auth: auth(),
    fetch: async (request) => {
      const aborted = new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
      })
      controller.abort(new Error('Inference cancelled'))
      return aborted
    },
  })
  await assert.rejects(generateText(codex('gpt-6-luna'), { input: 'Hi', signal: controller.signal }), /Inference cancelled/)
})
