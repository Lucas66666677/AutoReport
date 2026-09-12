// @monaco-editor/react installs Monaco on the window at runtime. The browser journey
// sets the editor's model directly rather than typing into it, because Monaco's
// auto-closing brackets rewrite `$...$` and table rows as they are typed.

declare global {
  interface Window {
    monaco: typeof import('monaco-editor')
  }
}

export {}
