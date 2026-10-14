import assert from 'node:assert/strict'

import { test } from 'node:test'

import { authorizeCodexHeadless, refreshCodexAccessToken } from '../src'
import { auth, jwt, tokens } from './helpers'

void test('device login polls pending states and exchanges the authorization code', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const expected = ['/api/accounts/deviceauth/usercode', '/api/accounts/deviceauth/token', '/api/accounts/deviceauth/token', '/oauth/token']
  t.mock.method(globalThis, 'fetch', async (input: Request | string, init?: RequestInit) => {
    const request = new Request(input, init)
    assert.equal(new URL(request.url).pathname, expected[calls])
    assert.equal(request.method, 'POST')
    calls++
    if (calls === 1) {
      assert.equal(request.headers.get('Content-Type'), 'application/json')
      assert.match(request.headers.get('User-Agent')!, /^xsai-codex\//)
      assert.deepEqual(await request.json(), { client_id: 'app_EMoamEEZ73f0CkXaXp7hrann' })
      return Response.json({ device_auth_id: 'device', interval: 'invalid', user_code: 'USER-CODE' })
    }
    if (calls === 2 || calls === 3) {
      assert.equal(request.headers.get('Content-Type'), 'application/json')
      assert.deepEqual(await request.json(), { device_auth_id: 'device', user_code: 'USER-CODE' })
    }
    if (calls === 2)
      return new Response('', { status: 403 })
    if (calls === 3)
      return Response.json({ authorization_code: 'code', code_verifier: 'verifier' })
    assert.equal(request.headers.get('Content-Type'), 'application/x-www-form-urlencoded')
    const body = new URLSearchParams(await request.text())
    assert.equal(body.get('grant_type'), 'authorization_code')
    assert.equal(body.get('code_verifier'), 'verifier')
    assert.equal(body.get('redirect_uri'), 'https://auth.openai.com/deviceauth/callback')
    return Response.json(tokens())
  })
  const login = authorizeCodexHeadless({
    onUserCode: (info) => {
      assert.equal(info.userCode, 'USER-CODE')
      assert.equal(info.interval, 5000)
      assert.equal(info.url, 'https://auth.openai.com/codex/device')
    },
  })
  await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(8000)
  assert.equal((await login).accountId, 'account')
  assert.equal(calls, 4)
})

void test('device login supports cancellation, expiration and terminal errors', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 })
  let polls = 0
  let disabled = false
  t.mock.method(globalThis, 'fetch', async (input: Request | string) => {
    const url = typeof input === 'string' ? input : input.url
    if (disabled)
      return new Response('Device login disabled', { status: 400 })
    if (url.endsWith('/usercode'))
      return Response.json({ device_auth_id: 'device', expires_in: 1, interval: 1, user_code: 'CODE' })
    polls++
    return new Response('', { status: 404 })
  })
  const login = authorizeCodexHeadless()
  const rejected = assert.rejects(login, /expired/)
  await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(4000)
  await rejected
  assert.equal(polls, 1)
  const controller = new AbortController()
  const cancelled = authorizeCodexHeadless({ signal: controller.signal })
  const cancelledCheck = assert.rejects(cancelled, /Cancelled/)
  await new Promise(resolve => setImmediate(resolve))
  controller.abort(new Error('Cancelled'))
  await cancelledCheck
  disabled = true
  await assert.rejects(authorizeCodexHeadless(), /Device login disabled/)
})

void test('refresh preserves unrotated refresh tokens and rejects incomplete token responses', async (t) => {
  let response: unknown = { access_token: auth().access, expires_in: 1800 }
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.equal(new URLSearchParams(String(init.body)).get('grant_type'), 'refresh_token')
    return Response.json(response)
  })
  assert.equal((await refreshCodexAccessToken('original')).refresh, 'original')
  for (const incomplete of [{ expires_in: 1 }, { access_token: 'access' }, { access_token: 'access', expires_in: -1 }]) {
    response = incomplete
    await assert.rejects(refreshCodexAccessToken('original'), /access token|expiration/)
  }
})

void test('OAuth forms preserve escaped tokens and token errors are not treated as pending device polls', async (t) => {
  const refresh = 'refresh+with/&special=characters'
  let deviceLogin = false
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (input: Request | string, init?: RequestInit) => {
    const request = new Request(input, init)
    if (!deviceLogin) {
      assert.equal(request.headers.get('Content-Type'), 'application/x-www-form-urlencoded')
      const body = new URLSearchParams(await request.text())
      assert.equal(body.get('refresh_token'), refresh)
      assert.equal(body.get('client_id'), 'app_EMoamEEZ73f0CkXaXp7hrann')
      return Response.json(tokens())
    }
    calls++
    if (calls === 1)
      return Response.json({ device_auth_id: 'device', user_code: 'CODE' })
    if (calls === 2)
      return Response.json({ authorization_code: 'approved', code_verifier: 'verifier' })
    return new Response('OAuth exchange denied', { status: 403 })
  })
  await refreshCodexAccessToken(refresh)
  deviceLogin = true
  await assert.rejects(authorizeCodexHeadless(), /OAuth exchange denied/)
  assert.equal(calls, 3)
})

void test('account ID comes from access token before ID token; an organization is not an account', async (t) => {
  let response: Record<string, unknown> = {
    ...tokens(),
    id_token: jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'wrong-account' } }),
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json(response))
  assert.equal((await refreshCodexAccessToken('refresh')).accountId, 'account')
  response = { ...tokens(), access_token: jwt({ organizations: [{ id: 'org' }] }), id_token: 'opaque' }
  assert.equal((await refreshCodexAccessToken('refresh')).accountId, undefined)
  response = { ...tokens(), access_token: 'opaque', id_token: jwt({ chatgpt_account_id: 'fallback' }) }
  assert.equal((await refreshCodexAccessToken('refresh')).accountId, 'fallback')
})
