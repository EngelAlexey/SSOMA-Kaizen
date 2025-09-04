import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { google } from 'googleapis';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Timeout amplio
app.use((req, res, next) => {
  res.setTimeout(120000, () => {});
  next();
});

// 🔐 API Key interna opcional (usa X-API-Key)
const API_TOKEN = process.env.INTERNAL_API_TOKEN || null;
app.use((req, res, next) => {
  if (!API_TOKEN) return next();
  const incoming = req.header('X-API-Key');
  if (incoming !== API_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ASSISTANT_ID = process.env.ASSISTANT_ID;

// ===== Persistencia simple de sesiones (local) =====
const SESSIONS_FILE = process.env.SESSIONS_FILE || path.join(process.cwd(), 'sessions.json');
function loadSessions() {
  try { return new Map(JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'))); }
  catch { return new Map(); }
}
function saveSessions(map) {
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify([...map]), 'utf-8'); }
  catch (e) { console.error('ERR saveSessions', e); }
}
const sessions = loadSessions(); // session_id -> thread_id

// ===== Estado de archivos en memoria (solo metadatos) =====
const CACHE_DIR = process.env.CACHE_DIR || path.join(os.tmpdir(), 'ssoma-cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const fileStore = new Map();        // source_id -> {filename,mime,localPath,origin,openai_file_id}
const fileIdToSourceId = new Map(); // openai_file_id -> source_id
const STARTED_AT = new Date().toISOString();

// ===== Helpers =====
const isImageMime = (mime = '') => /^image\//.test(mime);
const guessMime = (filename = '') => {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    pdf: 'application/pdf', txt: 'text/plain'
  };
  return map[ext] || 'application/octet-stream';
};
const makeSourceId = () => `src_${crypto.randomUUID()}`;
const saveToCache = (buffer, filename, mime, origin) => {
  const safe = filename.replace(/[^\w.\-]/g, '_');
  const source_id = makeSourceId();
  const localPath = path.join(CACHE_DIR, `${source_id}__${safe}`);
  fs.writeFileSync(localPath, buffer);
  const meta = { source_id, filename: safe, mime, localPath, origin, openai_file_id: null };
  fileStore.set(source_id, meta);
  return meta;
};

// ===== Google Drive (opcional) =====
const DRIVE_ROOT_FOLDER_ID = process.env.DRIVE_ROOT_FOLDER_ID || null;
let drive = null;
function initDriveClientIfPossible() {
  if (drive) return drive;
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  let creds;
  if (json) creds = JSON.parse(json);
  else if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    creds = {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }
  if (!creds) return null;
  const auth = new google.auth.JWT(
    creds.client_email, undefined, creds.private_key,
    ['https://www.googleapis.com/auth/drive.readonly']
  );
  drive = google.drive({ version: 'v3', auth });
  return drive;
}
async function resolveDriveRelativePath(relativePath) {
  if (!DRIVE_ROOT_FOLDER_ID) throw new Error('DRIVE_ROOT_FOLDER_ID no configurado');
  const drv = initDriveClientIfPossible();
  if (!drv) throw new Error('Credenciales de Google Drive no configuradas');

  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  let parentId = DRIVE_ROOT_FOLDER_ID, fileId = null, mimeType = null;

  for (let i = 0; i < parts.length; i++) {
    const name = parts[i].replace(/'/g, "\\'");
    const isLast = i === parts.length - 1;
    const q = `name = '${name}' and '${parentId}' in parents and trashed = false`;
    const resp = await drv.files.list({ q, fields: 'files(id,name,mimeType)', pageSize: 5 });
    if (!resp.data.files?.length) throw new Error(`No se encontró "${name}" bajo ${parentId}`);
    const item = resp.data.files[0];
    if (isLast) { fileId = item.id; mimeType = item.mimeType; }
    else {
      if (item.mimeType !== 'application/vnd.google-apps.folder') throw new Error(`"${name}" no es carpeta`);
      parentId = item.id;
    }
  }
  return { fileId, mimeType };
}
async function downloadDriveFile(fileId) {
  const drv = initDriveClientIfPossible();
  if (!drv) throw new Error('Credenciales de Google Drive no configuradas');
  const resp = await drv.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  return Buffer.from(resp.data);
}

// ===== Helpers de subida a OpenAI Files =====
async function uploadBufferToOpenAI(buffer, filename, mime, originMeta) {
  const meta = saveToCache(buffer, filename, mime, originMeta);
  const tmpPath = path.join(os.tmpdir(), `${Date.now()}-${crypto.randomUUID()}-${meta.filename}`);
  fs.writeFileSync(tmpPath, buffer);
  const file = await client.files.create({ file: fs.createReadStream(tmpPath), purpose: 'assistants' });
  fs.unlinkSync(tmpPath);
  meta.openai_file_id = file.id;
  fileIdToSourceId.set(file.id, meta.source_id);
  return { file_id: file.id, source_id: meta.source_id, mime: meta.mime };
}

// ===================================================================
// ÚNICO ENDPOINT DE CONSULTA: POST /chat/query
// Acepta:
//  - session_id (req) / thread_id (opt, tiene prioridad si llega)
//  - text | message (opt)
//  - files: [{filename, base64}] (opt)
//  - urls: [{url, filename?}] (opt)
//  - drive_paths: [{relative_path}] (opt)
// Rechaza si (no hay texto) Y (no hay adjuntos).
// ===================================================================
app.post('/chat/query', async (req, res) => {
  try {
    const {
      session_id,
      thread_id: clientThreadId,
      text, message,
      files = [],
      urls = [],
      drive_paths = [],
      meta
    } = req.body;

    const effectiveText = (typeof message === 'string' && message.length) ? message : (text || '');
    const hasAnyFile = (files?.length || 0) + (urls?.length || 0) + (drive_paths?.length || 0) > 0;

    if (!session_id) return res.status(400).json({ error: 'session_id requerido' });
    if (!effectiveText && !hasAnyFile) {
      return res.status(400).json({ error: 'Debe enviar mensaje y/o adjuntos' });
    }

    // 1) Determinar thread (prioridad al que mande el cliente)
    let thread_id = clientThreadId || sessions.get(session_id);
    if (!thread_id) {
      const thread = await client.beta.threads.create();
      thread_id = thread.id;
      console.log(`🧵 Nueva sesión por /chat/query: ${session_id} -> ${thread_id}`);
    }
    // Sincronizar persistencia si cambió
    if (sessions.get(session_id) !== thread_id) {
      sessions.set(session_id, thread_id);
      saveSessions(sessions);
      console.log(`🔗 Mapeo actualizado: ${session_id} -> ${thread_id}`);
    }

    // 2) Subir adjuntos (si hay) → obtener file_ids
    const allFileIds = [];

    // 2.a) Base64 inline
    for (const f of files) {
      if (!f?.filename || !f?.base64) continue;
      const mime = guessMime(f.filename);
      const buff = Buffer.from(f.base64, 'base64');
      const { file_id } = await uploadBufferToOpenAI(buff, f.filename, mime, { type: 'base64-inline' });
      allFileIds.push(file_id);
    }

    // 2.b) URLs públicas
    for (const u of urls) {
      if (!u?.url) continue;
      const resp = await fetch(u.url);
      if (!resp.ok) throw new Error(`No se pudo descargar URL: ${u.url} (${resp.status})`);
      const ab = await resp.arrayBuffer();
      const buff = Buffer.from(ab);
      const mime = resp.headers.get('content-type') || (u.filename ? guessMime(u.filename) : 'application/octet-stream');
      const fname = u.filename || (new URL(u.url)).pathname.split('/').pop() || 'archivo';
      const { file_id } = await uploadBufferToOpenAI(buff, fname, mime, { type: 'url', url: u.url });
      allFileIds.push(file_id);
    }

    // 2.c) Drive (ruta relativa AppSheet)
    for (const d of drive_paths) {
      if (!d?.relative_path) continue;
      const { fileId, mimeType } = await resolveDriveRelativePath(d.relative_path);
      const buff = await downloadDriveFile(fileId);
      const fname = d.relative_path.split('/').pop().replace(/\\/g, '/');
      const mime = mimeType && !mimeType.startsWith('application/vnd.google-apps') ? mimeType : guessMime(fname);
      const { file_id } = await uploadBufferToOpenAI(buff, fname, mime, { type: 'drive', drive_path: d.relative_path });
      allFileIds.push(file_id);
    }

    // 3) Armar contenido (text + image_file) y attachments
    const imageFiles = [];
    const otherFiles = [];
    for (const id of allFileIds) {
      const source_id = fileIdToSourceId.get(id);
      const metaL = source_id ? fileStore.get(source_id) : null;
      const mime = metaL?.mime || '';
      if (isImageMime(mime)) imageFiles.push(id);
      else otherFiles.push(id);
    }

    const content = [];
    if (effectiveText) content.push({ type: 'text', text: effectiveText });
    for (const id of imageFiles) {
      content.push({ type: 'image_file', image_file: { file_id: id } });
    }
    const attachments = otherFiles.map(id => ({
      file_id: id,
      tools: [{ type: 'file_search' }],
    }));

    console.log(`💬 /chat/query -> session=${session_id} thread=${thread_id} text=${!!effectiveText} imgs=${imageFiles.length} docs=${otherFiles.length}`);

    // 4) Crear mensaje y ejecutar run
    await client.beta.threads.messages.create(thread_id, {
      role: 'user',
      content,
      attachments,
      metadata: meta || undefined,
    });

    const run = await client.beta.threads.runs.createAndPoll(thread_id, { assistant_id: ASSISTANT_ID });
    console.log(`▶️ run ${run.id} status=${run.status}`);

    if (run.status !== 'completed') {
      return res.status(200).json({
        session_id, thread_id, status: run.status,
        error: run.last_error?.message || 'Run no completado',
        required_action: run.required_action || null
      });
    }

    // 5) Respuesta
    const list = await client.beta.threads.messages.list(thread_id);
    const assistantMsg = list.data.filter(m => m.role === 'assistant').sort((a, b) => b.created_at - a.created_at)[0];
    const reply = assistantMsg?.content?.map(c => c.text?.value).filter(Boolean).join('\n') || '';

    res.json({
      session_id, thread_id, status: run.status, reply, reason: 'ok',
      files_used: [
        ...imageFiles.map(id => ({ file_id: id, source_id: fileIdToSourceId.get(id), kind: 'image' })),
        ...otherFiles.map(id => ({ file_id: id, source_id: fileIdToSourceId.get(id), kind: 'doc' }))
      ]
    });
  } catch (e) {
    console.error('ERR /chat/query', e);
    res.status(500).json({ error: e.message || 'Error en chat/query' });
  }
});

app.post('/session/reset', async (req, res) => {
  try {
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id requerido' });

    const now = Date.now();
    const last = lastReset.get(session_id) || 0;
    if (now - last < 1000) {  // debouncer 1s
      const existing = sessions.get(session_id);
      return res.json({ session_id, thread_id: existing, notice: 'reset debounced' });
    }
    lastReset.set(session_id, now);

    const thread = await client.beta.threads.create();
    sessions.set(session_id, thread.id);
    saveSessions(sessions);
    console.log(`♻️ Reset sesión: ${session_id} -> ${thread.id}`);
    res.json({ session_id, thread_id: thread.id });
  } catch (e) {
    console.error('ERR /session/reset', e);
    res.status(500).json({ error: 'Error reiniciando sesión' });
  }
});


// Debug (desactiva en prod)
app.get('/debug/state', (req, res) => {
  res.json({
    started_at: STARTED_AT,
    sessions: Array.from(sessions.entries()).map(([sid, tid]) => ({ session_id: sid, thread_id: tid })),
    files: Array.from(fileStore.values()).map(({ source_id, filename, mime, origin, openai_file_id }) => ({
      source_id, filename, mime, origin, openai_file_id
    }))
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ SSOMA chat server (unified query) en http://localhost:${port}`));
