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

  it('rejects private IPv4 origins that only answer inside one network', () => {
    // Every one of these answers from a laptop or CI runner on the same LAN,
    // so a bad value is invisible until a real visitor loads the bundle.
    expect(describeApiBaseUrlProblem('https://10.0.0.5:8000')).toMatch(/private network address/)
    expect(describeApiBaseUrlProblem('https://172.16.0.1')).toMatch(/private network address/)
    expect(describeApiBaseUrlProblem('https://172.31.255.254')).toMatch(/private network address/)
    expect(describeApiBaseUrlProblem('https://192.168.1.50:8000')).toMatch(/private network address/)
    expect(describeApiBaseUrlProblem('https://169.254.169.254')).toMatch(/private network address/)
    expect(describeApiBaseUrlProblem('https://100.64.0.1')).toMatch(/private network address/)
    expect(describeApiBaseUrlProblem('https://0.1.2.3')).toMatch(/private network address/)
  })

  it('rejects private IPv6 origins, including IPv4-mapped ones', () => {
    expect(describeApiBaseUrlProblem('https://[fd00::1]:8000')).toMatch(/private network address/)
    expect(describeApiBaseUrlProblem('https://[FC00:0:0:0:0:0:0:1]')).toMatch(/private network address/)
    expect(describeApiBaseUrlProblem('https://[fe80::1]')).toMatch(/private network address/)
    expect(describeApiBaseUrlProblem('https://[febf::1]')).toMatch(/private network address/)
    expect(describeApiBaseUrlProblem('https://[::]')).toMatch(/private network address/)
    // `URL` rewrites the embedded quad to hex, so the check has to read hextets.
    expect(describeApiBaseUrlProblem('https://[::ffff:192.168.0.1]')).toMatch(/private network address/)
    expect(describeApiBaseUrlProblem('https://[::ffff:127.0.0.1]')).toMatch(/private network address/)
  })

  it('keeps public addresses and lookalike hostnames usable', () => {
    // Neighbours of the private ranges, and names that merely contain digits.
    expect(describeApiBaseUrlProblem('https://172.32.0.1')).toBeNull()
    expect(describeApiBaseUrlProblem('https://172.15.0.1')).toBeNull()
    expect(describeApiBaseUrlProblem('https://192.169.0.1')).toBeNull()
    expect(describeApiBaseUrlProblem('https://100.63.0.1')).toBeNull()
    expect(describeApiBaseUrlProblem('https://100.128.0.1')).toBeNull()
    expect(describeApiBaseUrlProblem('https://169.253.0.1')).toBeNull()
    expect(describeApiBaseUrlProblem('https://[2606:4700::1]')).toBeNull()
    expect(describeApiBaseUrlProblem('https://192-168-1-50.api.autolabreport.com')).toBeNull()
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
