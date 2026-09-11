// Creating a cloud document without asking PostgREST to hand it back.
//
// `documents_select_closed_beta` authorises reads through
// `public.can_read_document(id)`, a STABLE SECURITY DEFINER function that looks
// the row up again by id. Postgres applies SELECT policies to the rows an
// INSERT ... RETURNING returns, and a STABLE function reads the snapshot of the
// command that called it -- which does not contain the row that command is
// inserting. So `.insert(row).select()`, which is INSERT ... RETURNING, is
// refused for the document's own owner with "new row violates row-level
// security policy", and PostgREST answers 403. Every cloud report creation
// failed that way once the closed-beta migration was applied.
//
// A plain INSERT is judged by the insert policy alone (`user_id = auth.uid()`).
// The id is chosen here so the caller can find the committed row with an
// ordinary SELECT afterwards, which the same select policy then allows.

export type InsertOutcome = PromiseLike<{ error: { message?: string } | null }>

export async function insertOwnedDocument(
  insert: (row: Record<string, unknown>) => InsertOutcome,
  fields: Record<string, unknown>,
): Promise<string> {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    // The column is a uuid primary key; an improvised id would only fail later.
    throw new Error('此瀏覽器無法產生文件識別碼，請改用最新版瀏覽器')
  }
  const id = crypto.randomUUID()
  const { error } = await insert({ ...fields, id })
  if (error) {
    // PostgREST errors are plain objects, not `Error` instances. Callers render
    // `err instanceof Error ? err.message : <generic>`, so rethrowing the object
    // would replace the database's reason with the generic text -- which is how
    // the RLS failure above stayed invisible.
    throw new Error(error.message || '資料庫拒絕了新增文件')
  }
  return id
}
