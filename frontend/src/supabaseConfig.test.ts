import { describe, expect, it, vi } from 'vitest'

import {
  PLACEHOLDER_SUPABASE_ANON_KEY,
  PLACEHOLDER_SUPABASE_URL,
  describeSupabaseAnonKeyProblem,
  describeSupabaseUrlProblem,
  probeProjectResponds,
} from './supabaseConfig'

describe('describeSupabaseUrlProblem', () => {
  it('accepts a real project URL', () => {
    expect(describeSupabaseUrlProblem('https://abcdefghijklmnop.supabase.co')).toBeNull()
  })

  it('rejects an empty value, which ships a bundle with no Supabase client', () => {
    expect(describeSupabaseUrlProblem(undefined)).toMatch(/empty/)
    expect(describeSupabaseUrlProblem('   ')).toMatch(/empty/)
  })

  it('rejects the .env.example template', () => {
    expect(describeSupabaseUrlProblem(PLACEHOLDER_SUPABASE_URL)).toMatch(/template/)
  })

  it('rejects a non-https origin', () => {
    expect(describeSupabaseUrlProblem('http://abcdefghijklmnop.supabase.co')).toMatch(/not https/)
  })

  it('rejects a value that is not a URL', () => {
    expect(describeSupabaseUrlProblem('abcdefghijklmnop.supabase.co')).toMatch(/not a URL/)
  })
})

describe('describeSupabaseAnonKeyProblem', () => {
  it('accepts a key that is not the template', () => {
    expect(describeSupabaseAnonKeyProblem('sb_publishable_something')).toBeNull()
  })

  it('rejects an empty key and the template', () => {
    expect(describeSupabaseAnonKeyProblem('')).toMatch(/empty/)
    expect(describeSupabaseAnonKeyProblem(PLACEHOLDER_SUPABASE_ANON_KEY)).toMatch(/template/)
  })
})

describe('probeProjectResponds', () => {
  const url = 'https://abcdefghijklmnop.supabase.co'

  it('treats any HTTP response as proof the project exists', async () => {
    // A gated /auth/v1/health answers 401 without an apikey. That is a live
    // project, and requiring 200 would fail builds against healthy ones.
    for (const status of [200, 401, 404]) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status }))
      await expect(probeProjectResponds(url, { fetchImpl: fetchImpl as never })).resolves.toEqual({
        responded: true,
      })
    }
  })

  it('reports a deleted project, whose host stops resolving', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))
    const outcome = await probeProjectResponds(url, { fetchImpl: fetchImpl as never, attempts: 2 })

    expect(outcome).toEqual({ responded: false, reason: 'getaddrinfo ENOTFOUND' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('retries once so a transient blip does not fail an otherwise correct build', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(new Response('', { status: 200 }))

    await expect(probeProjectResponds(url, { fetchImpl: fetchImpl as never })).resolves.toEqual({
      responded: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('probes the project it was given, and sends no key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    await probeProjectResponds(`${url}/`, { fetchImpl: fetchImpl as never })

    const [requested, init] = fetchImpl.mock.calls[0]
    expect(requested).toBe(`${url}/auth/v1/health`)
    expect(init).not.toHaveProperty('headers')
  })
})
