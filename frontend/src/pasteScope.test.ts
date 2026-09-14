import { describe, expect, it } from 'vitest'
import {
  densify,
  isEssentiallyImagesOnly,
  isEssentiallyOneTable,
  tableCoverage,
} from './pasteScope'

// The payload that broke it: an AI answer with a heading, prose, a table, a list and
// a closing line. Only the table used to survive the paste.
const AI_ANSWER =
  '<div><h2>RC 電路分析</h2><p>時間常數決定電容充放電的速率，這是報告裡最關鍵的一段說明。</p>' +
  '<table><thead><tr><th>t (ms)</th><th>V (V)</th></tr></thead>' +
  '<tbody><tr><td>0.0</td><td>5.00</td></tr><tr><td>2.0</td><td>4.09</td></tr></tbody></table>' +
  '<p>主要結論：</p><ol><li>擬合斜率給出 10.2 μs</li><li>與標稱值相差 2.1 %</li></ol>' +
  '<p>希望這些對你的報告有幫助，如果需要我可以再補上誤差分析。</p></div>'

const JUST_A_TABLE =
  '<table><thead><tr><th>t (ms)</th><th>V (V)</th></tr></thead>' +
  '<tbody><tr><td>0.0</td><td>5.00</td></tr><tr><td>2.0</td><td>4.09</td></tr></tbody></table>'

describe('densify', () => {
  it('ignores the whitespace a pretty-printed fragment carries', () => {
    expect(densify('  a \n\t b  ')).toBe('ab')
  })

  it('treats missing text as empty', () => {
    expect(densify(null)).toBe('')
    expect(densify(undefined)).toBe('')
  })
})

describe('isEssentiallyOneTable', () => {
  it('claims a table copied on its own', () => {
    expect(isEssentiallyOneTable(JUST_A_TABLE)).toBe(true)
  })

  // The regression, stated as a test.
  it('does NOT claim an AI answer that merely contains a table', () => {
    expect(isEssentiallyOneTable(AI_ANSWER)).toBe(false)
  })

  it('still claims a table wrapped in a caption or a little chrome', () => {
    expect(isEssentiallyOneTable(`<div><p>表一</p>${JUST_A_TABLE}</div>`)).toBe(true)
  })

  it('claims nothing when there is no table', () => {
    expect(isEssentiallyOneTable('<p>只有文字</p>')).toBe(false)
  })

  it('claims nothing for empty or junk input', () => {
    expect(isEssentiallyOneTable('')).toBe(false)
    expect(isEssentiallyOneTable('   ')).toBe(false)
  })

  it('reports coverage between the two extremes', () => {
    expect(tableCoverage(JUST_A_TABLE)).toBe(1)
    expect(tableCoverage(AI_ANSWER)).toBeGreaterThan(0)
    expect(tableCoverage(AI_ANSWER)).toBeLessThan(0.6)
  })

  it('never reports more coverage than there is text', () => {
    expect(tableCoverage(`<table><tr><td>a</td></tr></table>`)).toBeLessThanOrEqual(1)
  })
})

describe('isEssentiallyImagesOnly', () => {
  it('claims a picture copied on its own', () => {
    expect(isEssentiallyImagesOnly('<img src="https://example.test/a.png">')).toBe(true)
  })

  it('claims an image with a short caption around it', () => {
    expect(isEssentiallyImagesOnly('<figure><img src="a.png"><figcaption>圖一</figcaption></figure>')).toBe(
      true,
    )
  })

  // The other half of the regression: AI sites put icons in their markup, and one of
  // them used to be enough to discard the whole answer.
  it('does NOT claim an AI answer that merely contains an icon', () => {
    expect(isEssentiallyImagesOnly(`<div><img src="logo.png" width="16">${AI_ANSWER}</div>`)).toBe(
      false,
    )
  })

  it('claims nothing when there is no image', () => {
    expect(isEssentiallyImagesOnly('<p>只有文字</p>')).toBe(false)
  })

  it('claims nothing for empty input', () => {
    expect(isEssentiallyImagesOnly('')).toBe(false)
  })
})
