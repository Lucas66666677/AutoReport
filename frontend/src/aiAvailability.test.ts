import { describe, expect, it } from 'vitest'
import {
  EMPTY_REPORT_BLOCK,
  EXTENSION_OFF_BLOCK,
  NO_API_KEY_BLOCK,
  QUOTA_BLOCK,
  SIGN_IN_BLOCK,
  agentBlock,
  assistBlock,
  type AiAvailabilityInput,
} from './aiAvailability'

const signedInBuiltIn: AiAvailabilityInput = {
  signedIn: true,
  preferredProvider: 'built_in',
  extensionEnabled: false,
  userApiProvider: 'none',
  quotaRemaining: 3,
}

const guest: AiAvailabilityInput = { ...signedInBuiltIn, signedIn: false, quotaRemaining: null }

describe('assistBlock', () => {
  it('lets a signed-in student with quota run', () => {
    expect(assistBlock(signedInBuiltIn)).toBeNull()
  })

  // The reported failure: a guest was shown a green 「內建 AI」 and only told after waiting.
  it('tells a guest to sign in before they start', () => {
    expect(assistBlock(guest)).toBe(SIGN_IN_BLOCK)
  })

  it('offers sign-in as the thing to do about it', () => {
    expect(assistBlock(guest)?.action).toBe('sign-in')
  })

  // The server refuses an own key for a guest too -- the key lives on the account.
  it('does not send a guest to an own API key, which needs an account as well', () => {
    expect(assistBlock({ ...guest, preferredProvider: 'user_api_key', userApiProvider: 'openai' })).toBe(
      SIGN_IN_BLOCK,
    )
  })

  it('asks for a key when own-key mode has none saved', () => {
    expect(assistBlock({ ...signedInBuiltIn, preferredProvider: 'user_api_key', userApiProvider: 'none' })).toBe(
      NO_API_KEY_BLOCK,
    )
  })

  it('runs with an own key even when built-in quota is spent', () => {
    expect(
      assistBlock({ ...signedInBuiltIn, preferredProvider: 'user_api_key', userApiProvider: 'gemini', quotaRemaining: 0 }),
    ).toBeNull()
  })

  it('blocks built-in AI once the quota is spent', () => {
    expect(assistBlock({ ...signedInBuiltIn, quotaRemaining: 0 })).toBe(QUOTA_BLOCK)
  })

  // Quota loads asynchronously after sign-in; not knowing yet is not "used up".
  it('does not claim the quota is spent before it has loaded', () => {
    expect(assistBlock({ ...signedInBuiltIn, quotaRemaining: null })).toBeNull()
  })

  it('lets the extension run without an account when it is enabled', () => {
    expect(assistBlock({ ...guest, preferredProvider: 'extension', extensionEnabled: true })).toBeNull()
  })

  it('says the extension is off when the build does not enable it', () => {
    expect(assistBlock({ ...guest, preferredProvider: 'extension', extensionEnabled: false })).toBe(
      EXTENSION_OFF_BLOCK,
    )
  })
})

describe('agentBlock', () => {
  it('lets a signed-in student with a report run', () => {
    expect(agentBlock({ ...signedInBuiltIn, reportIsEmpty: false })).toBeNull()
  })

  // The other reported failure: a disabled button that ignored clicks and said nothing.
  it('names the empty report instead of silently disabling the button', () => {
    expect(agentBlock({ ...signedInBuiltIn, reportIsEmpty: true })).toBe(EMPTY_REPORT_BLOCK)
  })

  it('puts sign-in ahead of the empty report, since it is the blocker to fix first', () => {
    expect(agentBlock({ ...guest, reportIsEmpty: true })).toBe(SIGN_IN_BLOCK)
  })

  // runAgentTask swaps extension for built-in AI, so the extension flag cannot rescue a guest.
  it('still needs an account with the extension selected, because the Agent uses built-in AI', () => {
    expect(agentBlock({ ...guest, preferredProvider: 'extension', extensionEnabled: true, reportIsEmpty: false })).toBe(
      SIGN_IN_BLOCK,
    )
  })

  it('applies the built-in quota when the extension is selected', () => {
    expect(
      agentBlock({ ...signedInBuiltIn, preferredProvider: 'extension', extensionEnabled: true, quotaRemaining: 0, reportIsEmpty: false }),
    ).toBe(QUOTA_BLOCK)
  })
})
