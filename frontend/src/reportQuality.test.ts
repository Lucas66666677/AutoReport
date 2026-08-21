import { describe, expect, it } from 'vitest'
import { analyzeReportQuality } from './reportQuality'

describe('analyzeReportQuality', () => {
  it('flags units, references, captions and unfinished placeholders', () => {
    const checks = analyzeReportQuality(`
# 實驗報告
## 數據
| x | y |
|---|---|
| 1 | 2 |
![plot](https://example.com/plot.png)
TODO: 待補
`)
    const byId = Object.fromEntries(checks.map((check) => [check.id, check.passed]))

    expect(byId.units).toBe(false)
    expect(byId.captions).toBe(false)
    expect(byId.references).toBe(false)
    expect(byId.placeholders).toBe(false)
  })

  it('accepts explicit scientific units and traceable references', () => {
    const checks = analyzeReportQuality(`
# 實驗報告
## 實驗目的
量測電壓。
## 實驗原理
$V = IR$
## 實驗步驟
1. 接線
## 數據
表 1：量測結果
| 電壓 | 電流 |
|---|---|
| 5 V | 2 mA |
## 結果分析
誤差與趨勢符合預期。
![圖 1：量測曲線](https://example.com/plot.png)
## 結論
本實驗完成電壓與電流量測，並討論儀器不確定度與可能限制。結論回扣實驗目的與量測趨勢。
## 參考資料
[1] https://example.com/spec
`)
    const byId = Object.fromEntries(checks.map((check) => [check.id, check.passed]))

    expect(byId.units).toBe(true)
    expect(byId.captions).toBe(true)
    expect(byId.references).toBe(true)
    expect(byId.placeholders).toBe(true)
  })
})
