import { describe, expect, it } from 'vitest'
import {
  describeApiBaseUrlProblem,
  LOCAL_DEV_API_BASE_URL,
  normalizeApiBaseUrl,
  resolveApiBaseUrl,
} from './apiConfig'

describe('production API origin validation', () => {
  it('accepts a real HTTPS backend origin', () => {
    expect(describeApiBaseUrlProblem('https://api.autolabreport.com')).toBeNull()
    expect(describeApiBaseUrlProblem('https://autoreport.onrender.com/v1')).toBeNull()
    expect(describeApiBaseUrlProblem('  https://api.autolabreport.com/  ')).toBeNull()
  })

  it('rejects a missing or blank value', () => {
    expect(describeApiBaseUrlProblem(undefined)).toMatch(/missing or blank/)
    expect(describeApiBaseUrlProblem('')).toMatch(/missing or blank/)
    expect(describeApiBaseUrlProblem('   ')).toMatch(/missing or blank/)
  })

  it('rejects loopback origins copied from .env.example', () => {
    expect(describeApiBaseUrlProblem('http://localhost:8000')).toMatch(/loopback/)
    expect(describeApiBaseUrlProblem('https://localhost:8000')).toMatch(/loopback/)
    expect(describeApiBaseUrlProblem('http://127.0.0.1:8000')).toMatch(/loopback/)
    expect(describeApiBaseUrlProblem('http://127.1.2.3:8000')).toMatch(/loopback/)
    expect(describeApiBaseUrlProblem('http://0.0.0.0:8000')).toMatch(/loopback/)
    expect(describeApiBaseUrlProblem('http://[::1]:8000')).toMatch(/loopback/)
    expect(describeApiBaseUrlProblem('https://API.LOCALHOST')).toMatch(/loopback/)
  })

  it('rejects values that are not absolute http(s) URLs', () => {
    expect(describeApiBaseUrlProblem('api.autolabreport.com')).toMatch(/not an absolute URL/)
    expect(describeApiBaseUrlProblem('/api')).toMatch(/not an absolute URL/)
    expect(describeApiBaseUrlProblem('ws://api.autolabreport.com')).toMatch(/not an http\(s\) URL/)
  })

  it('rejects plaintext HTTP and origins carrying a query or fragment', () => {
    expect(describeApiBaseUrlProblem('http://api.autolabreport.com')).toMatch(/not HTTPS/)
    expect(describeApiBaseUrlProblem('https://api.autolabreport.com?token=x')).toMatch(/query string or fragment/)
    expect(describeApiBaseUrlProblem('https://api.autolabreport.com#frag')).toMatch(/query string or fragment/)
  })
})

describe('normalizeApiBaseUrl', () => {
  it('trims whitespace and trailing slashes', () => {
    expect(normalizeApiBaseUrl('  https://api.autolabreport.com//  ')).toBe('https://api.autolabreport.com')
    expect(normalizeApiBaseUrl(undefined)).toBe('')
  })
})

describe('resolveApiBaseUrl', () => {
  it('prefers the configured origin in every mode', () => {
    expect(resolveApiBaseUrl({ VITE_API_URL: 'https://api.autolabreport.com/', DEV: true })).toBe(
      'https://api.autolabreport.com',
    )
    expect(resolveApiBaseUrl({ VITE_API_URL: 'https://api.autolabreport.com', DEV: false })).toBe(
      'https://api.autolabreport.com',
    )
  })

  it('keeps the local backend fallback for development only', () => {
    expect(resolveApiBaseUrl({ DEV: true })).toBe(LOCAL_DEV_API_BASE_URL)
    expect(resolveApiBaseUrl({ VITE_API_URL: '   ', DEV: true })).toBe(LOCAL_DEV_API_BASE_URL)
    expect(resolveApiBaseUrl({ DEV: false })).toBe('')
  })
})
