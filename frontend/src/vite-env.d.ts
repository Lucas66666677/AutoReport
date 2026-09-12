/// <reference types="vite/client" />

// monaco-editor's package exports map is `"./*": "./*"` with no `types` condition, so
// TypeScript cannot resolve the deep ESM entry points even though the files ship in the
// package. Declaring them keeps the trimmed imports in monacoSetup.ts: pulling the whole
// of `monaco-editor` instead would bundle every language this app never edits.

declare module 'monaco-editor/esm/vs/editor/editor.api' {
  export * from 'monaco-editor'
}

// Side-effect only: all editor contributions, and the one language we edit.
declare module 'monaco-editor/esm/vs/editor/editor.all'
declare module 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution'
