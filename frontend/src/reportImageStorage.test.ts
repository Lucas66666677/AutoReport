import { describe, expect, it } from 'vitest'
import {
  createPrivateReportImageUrl,
  parseLegacyPublicReportImagePath,
  parsePrivateReportImagePath,
} from './reportImageStorage'

describe('private report image URLs', () => {
  it('round-trips a private storage path without exposing a public URL', () => {
    const path = 'user-id/document-id/量測 圖.png'
    expect(parsePrivateReportImagePath(createPrivateReportImageUrl(path))).toBe(path)
  })

  it('rejects traversal paths', () => {
    expect(parsePrivateReportImagePath('supabase-image://..%2Fsecret.png')).toBeNull()
  })

  it('recognizes legacy public report image URLs for signed-url migration', () => {
    expect(
      parseLegacyPublicReportImagePath(
        'https://project.supabase.co/storage/v1/object/public/report_images/u%2Fd%2Fplot.png',
        'https://project.supabase.co',
      ),
    ).toBe('u/d/plot.png')
  })
})
