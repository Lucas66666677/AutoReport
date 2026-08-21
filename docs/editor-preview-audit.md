# Editor / Preview 行为审计

本文件只比较 HackMD 官方公开页面与公开文件中可观察到的行为，不推测其私有内部架构，也不复制其实现。

参考资料：

- [HackMD 功能页：Edit、View、Both 三种模式](https://hackmd.io/features)
- [HackMD 官方快捷键](https://hackmd.io/@docs/keyboard-shortcuts)
- [HackMD 发布与 View mode 说明](https://hackmd.io/how-to-publish-note)
- [HackMD 表格教学](https://hackmd.io/@docs/how-to-create-table-en)

| 项目 | HackMD 行为 | 修改前 | 修改后 |
|---|---|---|---|
| 检视模式 | 桌面提供 Edit、Both、View | 桌面固定双栏；手机仅 Edit/Preview 临时状态 | 类型安全的 Edit、Split、Preview；桌面默认 Split，并保存选择 |
| 快捷键 | Ctrl+Alt+E/B/V；macOS 使用 Ctrl+Option | 无 | 支持相同组合；唯读用户不能切回 Edit/Split |
| Split 宽度 | 两栏并列，适合持续对照 | 固定 50/50 | 25%～75% 范围内拖曳；同时保证每栏约 320px；键盘可调 |
| 小屏幕 | 单栏操作，避免双栏过窄 | 依靠独立 mobile pane 状态 | Split 在空间不足时自动显示单栏，但保留桌面比例 |
| 工具层级 | 文件操作、格式命令、工作区边界明确 | 格式工具、录制和 AI 混在左栏；AI Assist 重复 | 文件导航列、格式工具列、工作区三层分开；选区 AI 明确标为“AI 改写所选” |
| GFM 表格 | 管线表格显示为结构化表格 | 未启用 GFM，源码显示为普通文字 | 共用 remark-gfm 管线，生成 table/thead/tbody/th/td |
| 宽表格 | 在阅读区域内处理宽度 | CSS 只作用于 PDF id，且解析器没生成 table | 表格局部水平滚动，不制造页面级水平溢出 |
| 表格对齐 | 分隔列的冒号控制对齐 | 无法解析 | left/center/right 对齐保留，并有表头、边框、padding、淡色 zebra stripe |
| 任务清单 | GFM checkbox | 未启用 GFM | 共用 GFM 渲染并保留安全 checkbox 属性 |
| 数学与图表 | 编辑预览可显示数学和图表 | 编辑页、公开页各维护一份 Mermaid 配置 | 编辑、公开、PDF 前置 DOM、AI 结果共用 KaTeX/Mermaid/GFM/sanitizer 管线 |
| Mermaid 更新 | 内容变化后重新渲染，错误不应破坏全文 | 两份全局初始化状态与两套错误 UI | 单一初始化点、唯一 render id、取消过期状态写入、可读错误区 |
| 同步滚动 | Split 下编辑与预览保持对应位置 | 仅 Editor → Preview | Split 下双向按滚动比例同步，并抑制反馈循环 |
| 模式切换 | 编辑上下文应稳定 | 没有桌面模式切换 | Monaco 与 Preview 都保持挂载，只改变可见性；Yjs provider 依赖不变 |
| 唯读权限 | 阅读者进入干净阅读模式 | Monaco 仍以 readOnly 形式出现在固定双栏 | 唯读强制 Preview；按钮 disabled，快捷键也不能进入编辑模式 |
| HTML 安全 | 渲染用户 Markdown 时必须限制危险 HTML | 已有 sanitizer，但各 renderer 配置分散 | 共用 sanitizer；保留安全表格/任务清单，继续移除 script 与事件属性 |

## 仍保留的产品差异

- AutoLabReport 使用 Monaco，HackMD 公开文件说明其编辑器快捷键基于 CodeMirror；本项目没有照搬 CodeMirror keymap。
- AutoLabReport 的 PDF 是从编辑器 Preview DOM 生成，Word 则走 FastAPI + Pandoc；两者不可能在每个排版细节上完全一致。
- 滚动同步目前按整体滚动比例计算，不是逐 Markdown AST 区块映射；标题密度差异很大的长文仍可能出现轻微位置偏差。
- HackMD 支持更多扩展语法与发布模式；本次只统一 GFM、KaTeX、Mermaid、安全 HTML 和本项目现有功能。
