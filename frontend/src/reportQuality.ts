export type ReportCheckItem = {
  id: string
  label: string
  description: string
  passed: boolean
  location: string
  suggestion: string
}

export function analyzeReportQuality(markdown: string): ReportCheckItem[] {
  const normalized = markdown.toLowerCase()
  const hasHeading = (patterns: string[]) =>
    patterns.some((pattern) => new RegExp(`^#{1,3}\\s*.*${pattern}`, 'im').test(markdown))
  const firstLineMatching = (pattern: RegExp) => {
    const index = markdown.split(/\r?\n/).findIndex((line) => pattern.test(line))
    return index >= 0 ? `第 ${index + 1} 行` : '全文'
  }
  const headingLocation = (patterns: string[]) => {
    const escaped = patterns.map((pattern) => pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    return firstLineMatching(new RegExp(`^#{1,3}\\s*.*(?:${escaped.join('|')})`, 'i'))
  }
  const tableCount = (markdown.match(/^\|.+\|$/gm) ?? []).length
  const bodyText = markdown.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, '')
  const hasFigure = /!\[[^\]]*]\([^)]+\)|```mermaid|```python/i.test(markdown)
  const hasNumberWithUnit = /[-+]?\d+(?:\.\d+)?\s*(?:%|°[CFK]|[kMmunpµμ]?(?:m|s|g|A|V|W|J|N|Pa|Hz|Ω|mol|L))(?![A-Za-z])/u.test(markdown)
  const hasPlaceholder = /\bTODO\b|待補|待填|請在此|示例資料|\bTBD\b/i.test(markdown)
  const emptySectionMatch = /^#{1,3}\s+([^\n]+)\s*\n\s*(?=#{1,3}\s|$)/m.exec(markdown)
  const suspiciousClaimMatch = /完全證明|毫無誤差|零誤差|百分之百準確|100%\s*(?:準確|符合)/i.exec(markdown)
  const figureReferenceCount = (markdown.match(/(?:圖|figure)\s*\d+/gi) ?? []).length

  return [
    {
      id: 'purpose',
      label: '實驗目的',
      description: '報告需要清楚交代本次實驗要驗證或量測的目標。',
      passed: hasHeading(['實驗目的', '目的', '預習目標']),
      location: headingLocation(['實驗目的', '目的', '預習目標']),
      suggestion: '新增「實驗目的」段落，列出 2-3 個可驗證目標。',
    },
    {
      id: 'theory',
      label: '理論與公式',
      description: '應包含原理說明、核心公式或模型假設。',
      passed: hasHeading(['實驗原理', '理論', '背景']) && /\$[^$]+\$|\\\(|\\\[/.test(markdown),
      location: headingLocation(['實驗原理', '理論', '背景']),
      suggestion: '補上「實驗原理」並用 KaTeX 寫出至少一個核心公式。',
    },
    {
      id: 'procedure',
      label: '實驗步驟',
      description: '步驟應能讓讀者重現量測流程。',
      passed: hasHeading(['實驗步驟', '流程', '方法']) && /^\s*\d+\.\s+/m.test(markdown),
      location: headingLocation(['實驗步驟', '流程', '方法']),
      suggestion: '用編號清單整理實驗流程，避免只寫成一段敘述。',
    },
    {
      id: 'data',
      label: '數據紀錄',
      description: '至少應有原始數據表、量測欄位或計算結果。',
      passed: hasHeading(['數據', '資料', '原始數據']) && tableCount >= 2,
      location: headingLocation(['數據', '資料', '原始數據']),
      suggestion: '加入 Markdown 表格，包含理論值、實測值與誤差欄位。',
    },
    {
      id: 'analysis',
      label: '結果分析',
      description: '需要說明數據趨勢、誤差來源與是否符合預期。',
      passed:
        hasHeading(['結果分析', '討論', '誤差']) &&
        ['誤差', '不確定度', '偏差', '趨勢'].some((keyword) => normalized.includes(keyword)),
      location: headingLocation(['結果分析', '討論', '誤差']),
      suggestion: '在分析段落補上誤差來源、趨勢判讀與可能改進方法。',
    },
    {
      id: 'visuals',
      label: '圖表與示意',
      description: '圖、Mermaid 或 Python 圖表能讓結果更容易檢查。',
      passed: hasFigure,
      location: firstLineMatching(/!\[[^\]]*]\([^)]+\)|```(?:mermaid|python)/i),
      suggestion: '加入一張圖、Mermaid 流程圖，或 Python 繪圖程式碼區塊。',
    },
    {
      id: 'units',
      label: '數字與單位',
      description: '實驗數值應清楚標示單位，避免只留下無法判讀的數字。',
      passed: hasNumberWithUnit,
      location: firstLineMatching(/[-+]?\d+(?:\.\d+)?/),
      suggestion: '檢查表格、公式與結果段落，替主要量測數值補上正確單位。',
    },
    {
      id: 'captions',
      label: '圖表標題',
      description: '圖與表應有可辨識的編號或說明，便於正文引用。',
      passed:
        (!hasFigure || /!\[(?:圖|figure)\s*\d+\s*[:：]/i.test(markdown)) &&
        (tableCount < 2 || /(?:表|table)\s*\d+\s*[:：]/i.test(markdown)),
      location: firstLineMatching(/!\[[^\]]*]\([^)]+\)|^\|.+\|$/i),
      suggestion: '為圖表加入「圖 1：…」或「表 1：…」標題，並在正文中說明。',
    },
    {
      id: 'references',
      label: '參考資料',
      description: '引用的理論、規格或外部資料應留下可追溯來源。',
      passed:
        hasHeading(['參考資料', '參考文獻', 'references']) &&
        /https?:\/\/|doi\s*:|\[[0-9]+\]/i.test(markdown),
      location: headingLocation(['參考資料', '參考文獻', 'references']),
      suggestion: '新增「參考資料」並列出教材、儀器規格、論文或可靠網址。',
    },
    {
      id: 'placeholders',
      label: '未完成標記',
      description: '提交前不應殘留 TODO、待補或示例資料等占位文字。',
      passed: !hasPlaceholder,
      location: firstLineMatching(/\bTODO\b|待補|待填|請在此|示例資料|\bTBD\b/i),
      suggestion: '搜尋 TODO、待補、待填與示例資料，補齊內容或明確刪除。',
    },
    {
      id: 'empty-sections',
      label: '空白章節',
      description: '有標題但沒有正文的章節通常代表報告尚未完成。',
      passed: !emptySectionMatch,
      location: emptySectionMatch ? firstLineMatching(new RegExp(emptySectionMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))) : '全文',
      suggestion: '補上該章節內容；如果老師不要求這一節，請明確刪除標題。',
    },
    {
      id: 'figure-references',
      label: '正文引用圖表',
      description: '圖表除了標題，也應在正文中被引用與解釋。',
      passed: !hasFigure || figureReferenceCount >= 2,
      location: firstLineMatching(/!\[[^\]]*]\([^)]+\)|```(?:mermaid|python)/i),
      suggestion: '在結果或討論段落加入「如圖 1 所示」，並解釋圖表趨勢。',
    },
    {
      id: 'conclusion-consistency',
      label: '結論對應結果',
      description: '結論應回扣量測結果、誤差或趨勢，而不是只重述目的。',
      passed:
        hasHeading(['結論']) &&
        /(?:結論|conclusion)[\s\S]{0,1200}(?:結果|數據|誤差|趨勢|符合|不符合)/i.test(markdown),
      location: headingLocation(['結論']),
      suggestion: '在結論中引用一項主要結果，並說明是否支持實驗目的與限制。',
    },
    {
      id: 'unsupported-claims',
      label: '疑似無依據結論',
      description: '過度絕對的結論可能超出現有數據可以支持的範圍。',
      passed: !suspiciousClaimMatch,
      location: suspiciousClaimMatch ? firstLineMatching(new RegExp(suspiciousClaimMatch[0], 'i')) : '全文',
      suggestion: '改用與數據相符的保守表述，並補上不確定度、限制或引用來源。',
    },
    {
      id: 'conclusion',
      label: '結論',
      description: '結論應回扣目的，交代最終結果與限制。',
      passed: hasHeading(['結論']) && bodyText.length > 240,
      location: headingLocation(['結論']),
      suggestion: '補上「結論」，用 1-2 段回扣目的、結果與限制。',
    },
  ]
}
