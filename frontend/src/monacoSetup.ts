// Hand @monaco-editor/react a locally built Monaco instead of letting it fetch one.
//
// By default the package loads Monaco from the jsDelivr CDN using Monaco's AMD
// loader, which installs a global `define()` on the page. Mermaid's UMD dependencies
// then take the AMD branch and call it, and Monaco's loader rejects the anonymous
// define with "Can only have one anonymous define call per script file" -- so no
// diagram ever rendered in the editor, and the Mermaid-to-picture Word export
// silently fell back to leaving the diagram as source. The call reaches that loader
// even when `window.define` is undefined, so nothing could be worked around at
// runtime: the loader simply must not be on the page.
//
// Importing the ESM build removes it. This module is pulled in from the same lazy
// chunk as the editor, so Monaco still stays out of the initial bundle.

import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
// Every editor contribution (find, folding, bracket matching, context menu…).
import 'monaco-editor/esm/vs/editor/editor.all'
// Only the language this app edits; the full bundle would carry all of them.
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { loader } from '@monaco-editor/react'

// Markdown has no language service, so the base editor worker is all Monaco needs.
;(self as unknown as { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
}

loader.config({ monaco })

// Monaco's AMD build published this global, so the page already had it before the
// loader was replaced. Keep publishing it: dropping it would be a second, unrelated
// behaviour change riding along with this fix.
;(window as unknown as { monaco: typeof monaco }).monaco = monaco

export { monaco }
