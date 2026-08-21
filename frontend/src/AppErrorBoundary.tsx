import { Component, type ErrorInfo, type ReactNode } from 'react'

type AppErrorBoundaryProps = {
  children: ReactNode
}

type AppErrorBoundaryState = {
  hasError: boolean
}

export default class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('AutoLabReport render failure', {
      name: error.name,
      message: error.message,
      componentStack: info.componentStack,
    })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-slate-900">
        <section
          className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-200/60"
          role="alert"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            AutoLabReport
          </p>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">畫面載入失敗</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            草稿仍保留在這台瀏覽器。請重新載入；若問題持續，請聯絡 Beta 支援窗口。
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            重新載入
          </button>
        </section>
      </main>
    )
  }
}

