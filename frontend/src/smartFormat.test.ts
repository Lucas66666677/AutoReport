import { describe, expect, it } from 'vitest'
import { smartFormat } from './smartFormat'

describe('smartFormat (改為 Word 格式)', () => {
  it('never glues a sentence to the heading after it', () => {
    const source = '## 實驗原理\n請整理主要定律、公式與電路模型。\n\n## 實驗器材\n'
    expect(smartFormat(source)).toBe(source)
  })

  it('keeps English in parentheses', () => {
    expect(smartFormat('根據歐姆定律 (Ohm Law) 計算。\n')).toBe('根據歐姆定律 (Ohm Law) 計算。\n')
    expect(smartFormat('量測 RC 電路（RC circuit）。\n')).toBe('量測 RC 電路（RC circuit）。\n')
  })

  it('does not turn numbers at the start of a line into list items', () => {
    expect(smartFormat('-5 V 為最低電壓\n2.5 mA 為平均電流\n')).toBe('-5 V 為最低電壓\n2.5 mA 為平均電流\n')
  })

  it('adds the missing space after list and heading markers', () => {
    expect(smartFormat('-量測電壓\n1.記錄結果\n##結論\n')).toBe('- 量測電壓\n1. 記錄結果\n## 結論\n')
  })

  it('removes spaces around full-width punctuation within a line', () => {
    expect(smartFormat('電壓為 12 V ，電流 3 mA 。\n')).toBe('電壓為 12 V，電流 3 mA。\n')
  })

  it('leaves tables and fenced code untouched', () => {
    const source = '| 量 , 測 | 值 |\n|---|---|\n| -5 | 2.5 |\n\n```python\nx = [1 , 2]\n-y\n```\n'
    expect(smartFormat(source)).toBe(source)
  })

  it('keeps horizontal rules, bold and italic markers intact', () => {
    expect(smartFormat('---\n**重點**\n*斜體*\n')).toBe('---\n**重點**\n*斜體*\n')
  })

  it('collapses extra blank lines and trailing whitespace', () => {
    expect(smartFormat('# 題目\n\n\n\n內容   \n\n\n')).toBe('# 題目\n\n內容\n')
  })

  it('is idempotent', () => {
    const once = smartFormat('-量測 ，記錄 。\n\n\n##結論\n** 重點 **\n')
    expect(smartFormat(once)).toBe(once)
  })
})
