import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const REQUIRED_MARKER = 'AUTOLABREPORT_STAGING'
const TEST_PREFIX = 'e2e_rls_'
const KNOWN_NON_STAGING_PROJECT_REFS = new Set([
  'xddzdpmjgptvvpprnchp',
  ...String(process.env.SUPABASE_PRODUCTION_PROJECT_REFS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
])

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function client(url, key) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
}

function safeMessage(error) {
  if (!error) return 'unknown error'
  const message = String(error.message || error)
  return message
    .replace(/eyJ[A-Za-z0-9._-]+/g, '[redacted-token]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
}

function must(result, label) {
  if (result.error) throw new Error(`${label}: ${safeMessage(result.error)}`)
  return result.data
}

function expectDenied(result, label) {
  if (result.error) return
  if (Array.isArray(result.data) && result.data.length === 0) return
  throw new Error(`${label}: request unexpectedly succeeded`)
}

function pass(label) {
  process.stdout.write(`PASS ${label}\n`)
}

const url = required('SUPABASE_STAGING_URL')
const anonKey = required('SUPABASE_STAGING_ANON_KEY')
const serviceRoleKey = required('SUPABASE_STAGING_SERVICE_ROLE_KEY')
const projectRef = required('SUPABASE_STAGING_PROJECT_REF')
const marker = required('SUPABASE_STAGING_MARKER')
const target = new URL(url)

assert(marker === REQUIRED_MARKER, `SUPABASE_STAGING_MARKER must equal ${REQUIRED_MARKER}`)
assert(target.protocol === 'https:', 'Staging URL must use HTTPS')
assert(target.pathname === '/' || target.pathname === '', 'Staging URL must not contain a path')
assert(target.hostname === `${projectRef}.supabase.co`, 'Project ref does not match the staging URL')
assert(!KNOWN_NON_STAGING_PROJECT_REFS.has(projectRef), 'Refusing known production or non-staging project')
assert(anonKey !== serviceRoleKey, 'Anon and service-role keys must be different')

process.stdout.write(`Target project ref: ${projectRef}\n`)
process.stdout.write(`Target hostname: ${target.hostname}\n`)
process.stdout.write(`Safety marker: ${marker}\n`)

const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const admin = client(url, serviceRoleKey)
const anonymous = client(url, anonKey)
const createdUsers = []
const documentIds = []
const storagePaths = []
let testFailure = null

async function createTestUser(role) {
  const email = `${TEST_PREFIX}${role}_${runId}@example.com`
  const password = `Rls!${randomUUID()}Aa9`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { test_prefix: TEST_PREFIX, test_run: runId, role },
  })
  if (error) throw new Error(`create ${role} account: ${safeMessage(error)}`)
  assert(data.user?.id, `create ${role} account returned no user id`)
  createdUsers.push({ id: data.user.id, email, role })

  const roleClient = client(url, anonKey)
  const signIn = await roleClient.auth.signInWithPassword({ email, password })
  must(signIn, `email/password sign-in (${role})`)
  assert(signIn.data.user?.id === data.user.id, `wrong user restored for ${role}`)
  return { id: data.user.id, email, password, client: roleClient, session: signIn.data.session }
}

async function createDocument(actor, title, overrides = {}) {
  assert(title.startsWith(TEST_PREFIX), 'Refusing to create a document without the test prefix')
  const row = must(
    await actor.client
      .from('documents')
      .insert({ user_id: actor.id, title, content: `${TEST_PREFIX}content`, ...overrides })
      .select('*')
      .single(),
    `create ${title}`,
  )
  documentIds.push(row.id)
  return row
}

async function readDocument(actor, id) {
  return actor.from('documents').select('*').eq('id', id)
}

async function assertDocumentField(id, field, expected, label) {
  const row = must(
    await admin.from('documents').select(field).eq('id', id).single(),
    label,
  )
  assert(row[field] === expected, `${label}: ${field} changed unexpectedly`)
}

async function cleanup() {
  const failures = []

  if (storagePaths.length) {
    const result = await admin.storage.from('report_images').remove(storagePaths)
    if (result.error) failures.push(`storage cleanup: ${safeMessage(result.error)}`)
  }

  if (documentIds.length) {
    const result = await admin
      .from('documents')
      .delete()
      .in('id', documentIds)
      .like('title', `${TEST_PREFIX}%`)
    if (result.error) failures.push(`document cleanup: ${safeMessage(result.error)}`)
  }

  for (const user of [...createdUsers].reverse()) {
    if (!user.email.startsWith(TEST_PREFIX)) {
      failures.push(`refused cleanup for non-test ${user.role} account`)
      continue
    }
    const result = await admin.auth.admin.deleteUser(user.id)
    if (result.error) failures.push(`account cleanup (${user.role}): ${safeMessage(result.error)}`)
  }

  if (failures.length) throw new Error(failures.join('; '))
}

try {
  const owner = await createTestUser('owner')
  const editor = await createTestUser('editor')
  const viewer = await createTestUser('viewer')
  pass('staging-only Owner, Editor, and Viewer accounts created')

  const restored = client(url, anonKey)
  const restoredSession = must(
    await restored.auth.setSession({
      access_token: owner.session.access_token,
      refresh_token: owner.session.refresh_token,
    }),
    'session restore',
  )
  assert(restoredSession.user?.id === owner.id, 'session restore returned the wrong user')
  pass('Email Auth sign-in and session restore')

  const privateDoc = await createDocument(owner, `${TEST_PREFIX}private_${runId}`)
  const publicDoc = await createDocument(owner, `${TEST_PREFIX}public_${runId}`, {
    share_setting: 'view',
  })
  const editorDoc = await createDocument(owner, `${TEST_PREFIX}editor_${runId}`)
  const viewerDoc = await createDocument(owner, `${TEST_PREFIX}viewer_${runId}`)
  const deleteDoc = await createDocument(owner, `${TEST_PREFIX}delete_${runId}`)
  const unrelatedDoc = await createDocument(editor, `${TEST_PREFIX}unrelated_${runId}`)

  const editorInvite = must(
    await owner.client
      .from('document_collaborators')
      .insert({ document_id: editorDoc.id, user_email: editor.email, role: 'edit' })
      .select('*')
      .single(),
    'owner shares editor document',
  )
  const viewerInvite = must(
    await owner.client
      .from('document_collaborators')
      .insert({ document_id: viewerDoc.id, user_email: viewer.email, role: 'view' })
      .select('*')
      .single(),
    'owner shares viewer document',
  )

  must(await owner.client.from('documents').select('id').eq('id', privateDoc.id).single(), 'owner reads own document')
  must(
    await owner.client.from('documents').update({ content: `${TEST_PREFIX}owner_edit` }).eq('id', privateDoc.id).select('id').single(),
    'owner edits content',
  )
  must(
    await owner.client.from('documents').update({ title: `${TEST_PREFIX}owner_title_${runId}` }).eq('id', privateDoc.id).select('id').single(),
    'owner edits title',
  )
  must(
    await owner.client.from('documents').update({ share_setting: 'view' }).eq('id', privateDoc.id).select('id').single(),
    'owner changes sharing',
  )
  must(
    await owner.client.from('documents').update({ share_setting: 'private', is_trashed: true }).eq('id', privateDoc.id).select('id').single(),
    'owner trashes document',
  )
  must(
    await owner.client.from('documents').update({ is_trashed: false }).eq('id', privateDoc.id).select('id').single(),
    'owner restores document',
  )
  must(
    await owner.client.from('document_collaborators').update({ role: 'view' }).eq('id', editorInvite.id).select('id').single(),
    'owner changes collaborator role',
  )
  must(
    await owner.client.from('document_collaborators').update({ role: 'edit' }).eq('id', editorInvite.id).select('id').single(),
    'owner restores collaborator role',
  )
  must(await owner.client.from('documents').delete().eq('id', deleteDoc.id).select('id').single(), 'owner permanently deletes document')
  pass('Owner read, edit, title, share, trash, restore, delete, and collaborator management')

  must(await editor.client.from('documents').select('id').eq('id', editorDoc.id).single(), 'editor reads shared document')
  must(
    await editor.client.from('documents').update({ content: `${TEST_PREFIX}editor_edit` }).eq('id', editorDoc.id).select('id').single(),
    'editor edits shared content',
  )
  expectDenied(
    await editor.client.from('documents').update({ title: `${TEST_PREFIX}forbidden` }).eq('id', editorDoc.id).select('id'),
    'editor changes title',
  )
  await assertDocumentField(editorDoc.id, 'title', `${TEST_PREFIX}editor_${runId}`, 'editor title protection')
  expectDenied(
    await editor.client.from('documents').update({ user_id: editor.id }).eq('id', editorDoc.id).select('id'),
    'editor changes owner',
  )
  await assertDocumentField(editorDoc.id, 'user_id', owner.id, 'editor ownership protection')
  expectDenied(
    await editor.client.from('documents').update({ share_setting: 'view' }).eq('id', editorDoc.id).select('id'),
    'editor changes sharing',
  )
  expectDenied(
    await editor.client.from('documents').update({ is_trashed: true }).eq('id', editorDoc.id).select('id'),
    'editor trashes document',
  )
  expectDenied(
    await editor.client.from('documents').delete().eq('id', editorDoc.id).select('id'),
    'editor permanently deletes document',
  )
  expectDenied(
    await editor.client
      .from('document_collaborators')
      .insert({ document_id: editorDoc.id, user_email: viewer.email, role: 'edit' })
      .select('id'),
    'editor manages collaborators',
  )
  expectDenied(
    await editor.client.from('document_collaborators').update({ role: 'edit' }).eq('id', editorInvite.id).select('id'),
    'editor elevates collaborator role',
  )
  pass('Editor content-only access and privilege boundaries')

  must(await viewer.client.from('documents').select('id').eq('id', viewerDoc.id).single(), 'viewer reads shared document')
  for (const [field, value] of [
    ['content', `${TEST_PREFIX}viewer_forbidden`],
    ['title', `${TEST_PREFIX}viewer_title_forbidden`],
    ['share_setting', 'view'],
    ['is_trashed', true],
  ]) {
    expectDenied(
      await viewer.client.from('documents').update({ [field]: value }).eq('id', viewerDoc.id).select('id'),
      `viewer updates ${field}`,
    )
  }
  expectDenied(
    await viewer.client.from('documents').delete().eq('id', viewerDoc.id).select('id'),
    'viewer deletes document',
  )
  expectDenied(
    await viewer.client.from('document_collaborators').delete().eq('id', viewerInvite.id).select('id'),
    'viewer manages sharing',
  )
  await assertDocumentField(viewerDoc.id, 'content', `${TEST_PREFIX}content`, 'viewer content protection')
  pass('Viewer read-only access cannot be bypassed through the API')

  must(await anonymous.from('documents').select('id').eq('id', publicDoc.id).single(), 'anonymous reads public view document')
  expectDenied(await anonymous.from('documents').select('id').eq('id', privateDoc.id), 'anonymous reads private document')
  expectDenied(await anonymous.from('documents').select('id').eq('id', unrelatedDoc.id), 'anonymous reads unrelated document')
  expectDenied(
    await anonymous.from('documents').update({ content: `${TEST_PREFIX}anonymous_forbidden` }).eq('id', publicDoc.id).select('id'),
    'anonymous edits public document',
  )
  expectDenied(
    await anonymous.from('document_collaborators').select('id').eq('document_id', publicDoc.id),
    'anonymous reads collaborator list',
  )
  expectDenied(await anonymous.from('documents').select('id').eq('id', randomUUID()), 'anonymous enumerates random document id')
  const visibleToAnonymous = must(await anonymous.from('documents').select('id').like('title', `${TEST_PREFIX}%`), 'anonymous list visibility')
  assert(visibleToAnonymous.some((row) => row.id === publicDoc.id), 'public document missing from anonymous visibility')
  assert(!visibleToAnonymous.some((row) => row.id === privateDoc.id || row.id === unrelatedDoc.id), 'anonymous enumeration exposed private data')
  pass('Anonymous public-view only access and enumeration boundary')

  const ownerPath = `${owner.id}/${privateDoc.id}/${TEST_PREFIX}${runId}.png`
  const editorPath = `${editor.id}/${editorDoc.id}/${TEST_PREFIX}${runId}.png`
  const wrongOwnerPath = `${owner.id}/${editorDoc.id}/${TEST_PREFIX}wrong_${runId}.png`
  const wrongMimePath = `${owner.id}/${privateDoc.id}/${TEST_PREFIX}${runId}.txt`
  const oversizedPath = `${owner.id}/${privateDoc.id}/${TEST_PREFIX}large_${runId}.png`
  storagePaths.push(ownerPath, editorPath, wrongOwnerPath, wrongMimePath, oversizedPath)
  const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  must(
    await owner.client.storage.from('report_images').upload(ownerPath, pngBytes, { contentType: 'image/png' }),
    'owner uploads image to own path',
  )
  expectDenied(
    await editor.client.storage.from('report_images').upload(wrongOwnerPath, pngBytes, { contentType: 'image/png' }),
    'editor uploads to another user path',
  )
  must(
    await editor.client.storage.from('report_images').upload(editorPath, pngBytes, { contentType: 'image/png' }),
    'editor uploads image while document access is active',
  )
  expectDenied(
    await anonymous.storage.from('report_images').download(ownerPath),
    'anonymous directly downloads a private image',
  )
  const signed = must(
    await owner.client.storage.from('report_images').createSignedUrl(ownerPath, 60),
    'owner creates signed image URL',
  )
  const signedUrl = new URL(signed.signedUrl, url).toString()
  const signedResponse = await fetch(signedUrl)
  assert(signedResponse.ok, `signed URL returned HTTP ${signedResponse.status}`)
  expectDenied(
    await owner.client.storage.from('report_images').upload(wrongMimePath, new TextEncoder().encode('test'), { contentType: 'text/plain' }),
    'disallowed image MIME upload',
  )
  expectDenied(
    await owner.client.storage.from('report_images').upload(oversizedPath, new Uint8Array(10 * 1024 * 1024 + 1), { contentType: 'image/png' }),
    'oversized image upload',
  )
  must(await owner.client.from('document_collaborators').delete().eq('id', editorInvite.id).select('id').single(), 'owner revokes editor')
  expectDenied(
    await editor.client.storage.from('report_images').update(editorPath, pngBytes, { contentType: 'image/png' }),
    'revoked editor replaces an old image',
  )
  expectDenied(
    await editor.client.storage.from('report_images').remove([editorPath]),
    'revoked editor deletes an old image',
  )
  pass('Storage ownership, document access, signed URL, MIME, and size limits')

  const profileBefore = must(
    await owner.client.from('profiles').select('plan,ai_daily_used,stripe_customer_id').eq('id', owner.id).single(),
    'read owner profile baseline',
  )
  expectDenied(
    await owner.client
      .from('profiles')
      .update({ plan: 'pro', ai_daily_used: 999, stripe_customer_id: `${TEST_PREFIX}forbidden` })
      .eq('id', owner.id)
      .select('id'),
    'client modifies protected profile fields',
  )
  const profileAfter = must(
    await admin.from('profiles').select('plan,ai_daily_used,stripe_customer_id').eq('id', owner.id).single(),
    'verify protected profile fields',
  )
  assert(JSON.stringify(profileAfter) === JSON.stringify(profileBefore), 'protected profile fields changed')

  must(
    await admin.from('user_ai_settings').upsert({
      user_id: owner.id,
      preferred_provider: 'user_api_key',
      api_provider: 'openai',
      api_key_encrypted: `${TEST_PREFIX}ciphertext_${runId}`,
    }),
    'seed encrypted AI setting',
  )
  must(
    await owner.client.from('user_ai_settings').select('user_id').eq('user_id', owner.id).single(),
    'owner reads own encrypted AI settings row',
  )
  expectDenied(
    await viewer.client.from('user_ai_settings').select('*').eq('user_id', owner.id),
    'viewer reads another user encrypted AI settings',
  )
  expectDenied(
    await owner.client.rpc('reserve_ai_quota', { p_user_id: owner.id, p_free_limit: 10, p_pro_limit: 100 }),
    'client calls quota reservation RPC',
  )
  const reservation = must(
    await admin.rpc('reserve_ai_quota', { p_user_id: owner.id, p_free_limit: 10, p_pro_limit: 100 }),
    'service role reserves quota',
  )
  assert(reservation?.reserved === true, 'service quota reservation was not recorded')
  must(await admin.rpc('refund_ai_quota', { p_user_id: owner.id }), 'service role refunds quota')
  pass('Profiles, encrypted AI settings, and service-only quota RPC')

  const signupEmail = `${TEST_PREFIX}signup_${runId}@example.com`
  const signupPassword = `Rls!${randomUUID()}Bb8`
  const signup = await anonymous.auth.signUp({ email: signupEmail, password: signupPassword })
  must(signup, 'Email Auth registration')
  assert(signup.data.user?.id, 'Email Auth registration returned no user')
  createdUsers.push({ id: signup.data.user.id, email: signupEmail, role: 'signup-probe' })
  pass('Email Auth registration endpoint')

  must(await owner.client.auth.signOut(), 'owner logout')
  const afterLogout = await owner.client.auth.getSession()
  must(afterLogout, 'read session after logout')
  assert(afterLogout.data.session === null, 'logout left an active session')
  pass('Email Auth logout')
} catch (error) {
  testFailure = error
} finally {
  try {
    await cleanup()
    pass('cleanup removed only this run test data')
  } catch (cleanupError) {
    testFailure = testFailure
      ? new Error(`${safeMessage(testFailure)}; ${safeMessage(cleanupError)}`)
      : cleanupError
  }
}

if (testFailure) {
  process.stderr.write(`FAIL ${safeMessage(testFailure)}\n`)
  process.exitCode = 1
} else {
  process.stdout.write('Supabase staging RLS matrix completed successfully.\n')
}

