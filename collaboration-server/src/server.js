import 'dotenv/config'
import { Server } from '@hocuspocus/server'
import { createClient } from '@supabase/supabase-js'
import * as Y from 'yjs'

const PORT = Number.parseInt(process.env.PORT || '1234', 10)
const HOST = process.env.HOST || '0.0.0.0'
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const YJS_STORE_DEBOUNCE_MS = Number.parseInt(
  process.env.YJS_STORE_DEBOUNCE_MS || '2000',
  10,
)
const YJS_STORE_MAX_DEBOUNCE_MS = Number.parseInt(
  process.env.YJS_STORE_MAX_DEBOUNCE_MS || '10000',
  10,
)
const YTEXT_NAME = 'monaco-or-textarea'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean),
)

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
}
if (!Number.isFinite(PORT) || PORT <= 0) {
  throw new Error('PORT must be a positive integer')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

function assertDocumentName(documentName) {
  if (!UUID_PATTERN.test(documentName)) {
    throw new Error('Invalid document room')
  }
}

function assertAllowedOrigin(requestHeaders) {
  const origin = requestHeaders.get('origin')?.replace(/\/$/, '')
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    throw new Error('Origin is not allowed')
  }
}

function byteaToUint8Array(value) {
  if (!value) return null
  if (value instanceof Uint8Array) return value
  if (typeof value !== 'string') throw new Error('Unsupported Yjs state format')

  const hex = value.startsWith('\\x') ? value.slice(2) : value
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error('Invalid PostgreSQL bytea value')
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}

function uint8ArrayToBytea(value) {
  return `\\x${Buffer.from(value).toString('hex')}`
}

async function getAuthenticatedUser(token) {
  if (!token) throw new Error('Authentication token is required')
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) throw new Error('Invalid or expired authentication token')
  return data.user
}

async function getDocumentPermission(documentId, user) {
  const { data: document, error: documentError } = await supabase
    .from('documents')
    .select('id,user_id,workspace_id,is_trashed')
    .eq('id', documentId)
    .maybeSingle()
  if (documentError) throw documentError
  if (!document || document.is_trashed) return null
  if (document.user_id === user.id) return { role: 'owner', document }

  if (document.workspace_id) {
    const { data: member, error: memberError } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', document.workspace_id)
      .eq('user_id', user.id)
      .in('role', ['owner', 'editor'])
      .maybeSingle()
    if (memberError) throw memberError
    if (member) return { role: member.role, document }
  }

  const normalizedEmail = user.email?.trim().toLowerCase()
  if (normalizedEmail) {
    const { data: collaborator, error: collaboratorError } = await supabase
      .from('document_collaborators')
      .select('role')
      .eq('document_id', documentId)
      .ilike('user_email', normalizedEmail)
      .eq('role', 'edit')
      .maybeSingle()
    if (collaboratorError) throw collaboratorError
    if (collaborator) return { role: 'editor', document }
  }

  return null
}

async function authenticateConnection(documentName, token, requestHeaders) {
  assertDocumentName(documentName)
  assertAllowedOrigin(requestHeaders)

  const user = await getAuthenticatedUser(token)
  const permission = await getDocumentPermission(documentName, user)
  if (!permission) throw new Error('You do not have edit access to this document')

  const userMetadata = user.user_metadata || {}
  return {
    userId: user.id,
    email: user.email || '',
    name:
      userMetadata.full_name ||
      userMetadata.name ||
      user.email ||
      'AutoLabReport user',
    avatar: userMetadata.avatar_url || '',
    role: permission.role,
  }
}

async function loadStoredDocument(documentName) {
  const { data: stored, error: storedError } = await supabase
    .from('collaboration_documents')
    .select('ydoc_state')
    .eq('document_id', documentName)
    .maybeSingle()
  if (storedError) throw storedError

  const update = byteaToUint8Array(stored?.ydoc_state)
  if (update?.length) return update

  const { data: document, error: documentError } = await supabase
    .from('documents')
    .select('content')
    .eq('id', documentName)
    .single()
  if (documentError) throw documentError

  const initialDocument = new Y.Doc()
  const initialContent = String(document.content || '')
  if (initialContent) initialDocument.getText(YTEXT_NAME).insert(0, initialContent)
  return Y.encodeStateAsUpdate(initialDocument)
}

async function storeYjsState(documentName, document) {
  assertDocumentName(documentName)
  const state = Y.encodeStateAsUpdate(document)
  const { error } = await supabase.from('collaboration_documents').upsert(
    {
      document_id: documentName,
      ydoc_state: uint8ArrayToBytea(state),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'document_id' },
  )
  if (error) throw error
}

async function writeFinalMarkdown(documentName, document) {
  await storeYjsState(documentName, document)
  const markdown = document.getText(YTEXT_NAME).toString()
  const { error } = await supabase
    .from('documents')
    .update({
      content: markdown,
      updated_at: new Date().toISOString(),
    })
    .eq('id', documentName)
  if (error) throw error
}

const server = new Server({
  port: PORT,
  address: HOST,
  debounce: YJS_STORE_DEBOUNCE_MS,
  maxDebounce: YJS_STORE_MAX_DEBOUNCE_MS,

  async onAuthenticate({ documentName, token, requestHeaders }) {
    return authenticateConnection(documentName, token, requestHeaders)
  },

  async onTokenSync({
    documentName,
    token,
    requestHeaders,
    connectionConfig,
  }) {
    const context = await authenticateConnection(
      documentName,
      token,
      requestHeaders,
    )
    connectionConfig.readOnly = false
    return context
  },

  async beforeHandleAwareness({ context, states }) {
    if (!context) throw new Error('Missing authenticated connection context')
    for (const state of states.values()) {
      const requestedUser =
        state.user && typeof state.user === 'object' ? state.user : {}
      state.user = {
        ...requestedUser,
        id: context.userId,
        name: context.name,
        avatar: context.avatar,
      }
    }
  },

  async onLoadDocument({ documentName }) {
    assertDocumentName(documentName)
    return loadStoredDocument(documentName)
  },

  async onStoreDocument({ documentName, document }) {
    await storeYjsState(documentName, document)
  },

  async onDisconnect({ clientsCount, documentName, document }) {
    if (clientsCount === 0) {
      await writeFinalMarkdown(documentName, document)
    }
  },

  async onRequest({ request, response }) {
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ status: 'ok', service: 'collaboration' }))
      throw new Error('HTTP request handled')
    }
  },

  async onListen({ port }) {
    console.log(`AutoLabReport collaboration server listening on ${HOST}:${port}`)
  },
})

server.listen()

async function shutdown(signal) {
  console.log(`${signal} received, flushing collaboration documents`)
  await server.destroy()
  process.exit(0)
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
