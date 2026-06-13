export type ReportCheckItem = {
  id: string
  label: string
  description: string
  passed: boolean
  suggestion: string
}

export function analyzeReportQuality(markdown: string): ReportCheckItem[] {
  const normalized = markdown.toLowerCase()
  const hasHeading = (patterns: string[]) =>
    patterns.some((pattern) => new RegExp(`^#{1,3}\\s*.*${pattern}`, 'im').test(markdown))
  const tableCount = (markdown.match(/^\|.+\|$/gm) ?? []).length
  const bodyText = markdown.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, '')

  return [
    {
      id: 'purpose',
      label: '實驗目的',
      description: '報告需要清楚交代本次實驗要驗證或量測的目標。',
      passed: hasHeading(['實驗目的', '目的', '預習目標']),
      suggestion: '新增「實驗目的」段落，列出 2-3 個可驗證目標。',
    },
    {
      id: 'theory',
      label: '理論與公式',
      description: '應包含原理說明、核心公式或模型假設。',
      passed: hasHeading(['實驗原理', '理論', '背景']) && /\$[^$]+\$|\\\(|\\\[/.test(markdown),
      suggestion: '補上「實驗原理」並用 KaTeX 寫出至少一個核心公式。',
    },
    {
      id: 'procedure',
      label: '實驗步驟',
      description: '步驟應能讓讀者重現量測流程。',
      passed: hasHeading(['實驗步驟', '流程', '方法']) && /^\s*\d+\.\s+/m.test(markdown),
      suggestion: '用編號清單整理實驗流程，避免只寫成一段敘述。',
    },
    {
      id: 'data',
      label: '數據紀錄',
      description: '至少應有原始數據表、量測欄位或計算結果。',
      passed: hasHeading(['數據', '資料', '原始數據']) && tableCount >= 2,
      suggestion: '加入 Markdown 表格，包含理論值、實測值與誤差欄位。',
    },
    {
      id: 'analysis',
      label: '結果分析',
      description: '需要說明數據趨勢、誤差來源與是否符合預期。',
      passed:
        hasHeading(['結果分析', '討論', '誤差']) &&
        ['誤差', '不確定度', '偏差', '趨勢'].some((keyword) => normalized.includes(keyword)),
      suggestion: '在分析段落補上誤差來源、趨勢判讀與可能改進方法。',
    },
    {
      id: 'visuals',
      label: '圖表與示意',
      description: '圖、Mermaid 或 Python 圖表能讓結果更容易檢查。',
      passed: /!\[[^\]]*]\([^)]+\)|```mermaid|```python/i.test(markdown),
      suggestion: '加入一張圖、Mermaid 流程圖，或 Python 繪圖程式碼區塊。',
    },
    {
      id: 'conclusion',
      label: '結論',
      description: '結論應回扣目的，交代最終結果與限制。',
      passed: hasHeading(['結論']) && bodyText.length > 240,
      suggestion: '補上「結論」，用 1-2 段回扣目的、結果與限制。',
    },
  ]
}
