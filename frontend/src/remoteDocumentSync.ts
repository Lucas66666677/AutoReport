// Keeping an open cloud report in step with changes made somewhere else -- ChatGPT
// through the remote MCP server (backend/mcp_remote.py), or another tab.
//
// The page saves whole documents. Before this the last save simply won: an open tab
// kept showing the old text, and its next save quietly undid the other change. Now a
// save only lands on the version the tab last saw. If the report moved on in between,
// the other version is kept in the version history before the student's own typing is
// saved over it; and an open tab with nothing unsaved just shows the newer text.

import { createDocumentVersion, versionToRow, type DocumentVersion } from './documentVersions'

export const REMOTE_CHECK_INTERVAL_MS = 8000
export const REMOTE_VERSION_NOTE = '在其他地方的修改（例如 AI app）'
export const REMOTE_APPLIED_TOAST = '這份報告在其他地方更新了（例如 AI app），已顯示最新內容。'
export const REMOTE_KEPT_TOAST = '這份報告在其他地方也被修改了（例如 AI app）。對方的版本已存到版本歷史，你的修改會照常儲存。'

/** What the page lends the background check, fresh from each render. */
export type RemoteSyncActions = {
  /** The open report's text as the editor holds it, or null while the editor is not up. */
  localText: () => string | null
  hasUnsavedLocalChanges: (documentId: string) => boolean
  show: (documentId: string, content: string, updatedAt: string | null) => void
  keep: (documentId: string, content: string) => Promise<void>
}

/** The version of a document this tab last saw saved. */
export type KnownVersion = { documentId: string | null; updatedAt: string | null }

/** Whether two timestamps name the same instant, whatever their spelling. */
export function sameInstant(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return !left && !right
  const a = Date.parse(left)
  const b = Date.parse(right)
  return Number.isFinite(a) && a === b
}

export type RemoteChange = 'unchanged' | 'apply' | 'conflict'

export function decideRemoteChange({
  knownUpdatedAt,
  remoteUpdatedAt,
  remoteContent,
  localContent,
  hasUnsavedLocalChanges,
}: {
  knownUpdatedAt: string | null
  remoteUpdatedAt: string | null
  remoteContent: string
  localContent: string
  hasUnsavedLocalChanges: boolean
}): RemoteChange {
  if (knownUpdatedAt !== null && sameInstant(knownUpdatedAt, remoteUpdatedAt)) return 'unchanged'
  if (remoteContent === localContent) return 'unchanged'
  return hasUnsavedLocalChanges ? 'conflict' : 'apply'
}

export type GuardedSave = {
  /** Save, only over `onlyIfUpdatedAt` when one is given. */
  update: (onlyIfUpdatedAt: string | null) => Promise<'saved' | 'missed'>
  fetchRemote: () => Promise<{ content: string; updatedAt: string | null } | null>
  keepRemoteVersion: (content: string) => Promise<void>
}

const NO_ACCESS = '文件不存在或目前帳號沒有編輯權限'

/**
 * Save `content` over the version this tab last saw. If the report changed elsewhere in
 * between, that version goes to the history first, then this tab's content -- the
 * student's own typing -- is saved. Resolves to whether another version was kept.
 */
export async function saveOverKnownVersion(
  content: string,
  knownUpdatedAt: string | null,
  save: GuardedSave,
): Promise<{ keptRemote: boolean }> {
  if ((await save.update(knownUpdatedAt)) === 'saved') return { keptRemote: false }
  if (knownUpdatedAt === null) throw new Error(NO_ACCESS)
  const remote = await save.fetchRemote()
  // Unchanged since this tab saw it, yet not saved: the student lost edit rights.
  if (!remote || sameInstant(remote.updatedAt, knownUpdatedAt)) throw new Error(NO_ACCESS)
  let keptRemote = false
  if (remote.content !== content) {
    await save.keepRemoteVersion(remote.content)
    keptRemote = true
  }
  if ((await save.update(null)) !== 'saved') throw new Error(NO_ACCESS)
  return { keptRemote }
}

type VersionTable = {
  from: (table: 'document_versions') => {
    insert: (rows: ReturnType<typeof versionToRow>[]) => PromiseLike<{ error: { message?: string } | null }>
  }
}

/** Put another copy of a document into its cloud version history; returns the version. */
export async function keepVersionInHistory(
  client: VersionTable,
  document: { id: string; title: string },
  content: string,
  userId: string,
): Promise<DocumentVersion> {
  const version = createDocumentVersion(document, content, REMOTE_VERSION_NOTE)
  const { error } = await client.from('document_versions').insert([versionToRow(version, userId)])
  if (error) throw new Error(error.message || '版本歷史儲存失敗')
  return version
}
