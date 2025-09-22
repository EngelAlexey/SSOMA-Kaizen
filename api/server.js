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
const FILE_TTL_DAYS = parseInt(process.env.FILE_TTL_DAYS || '180', 10);

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

// Debouncer para /session/reset
const lastReset = new Map();

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

// ===== Google Drive (opcional, para rutas relativas) =====
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

async function resolveDriveRelativePath(relativePath, rootFolderId = DRIVE_ROOT_FOLDER_ID) {
  if (!rootFolderId) throw new Error('DRIVE_ROOT_FOLDER_ID no configurado');
  const drv = initDriveClientIfPossible();
  if (!drv) throw new Error('Credenciales de Google Drive no configuradas');

  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  let parentId = rootFolderId, fileId = null, mimeType = null;

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

// ====== Fallback público SIN credenciales (máxima velocidad) ======
function publicDriveDownloadURL(fileId) {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`;
}
function parseFilenameFromContentDisposition(cd = '') {
  const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd);
  if (m && m[1]) {
    try { return decodeURIComponent(m[1]).trim(); } catch { return m[1].trim(); }
  }
  return null;
}
const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
function sniffImageMime(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const b = buffer;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}
function ensureNameAndMime({ fileId, providedName, headerName, mime, buffer }) {
  let outMime = mime || '';
  const sniff = sniffImageMime(buffer);
  const finalImageMime = sniff || (outMime && outMime.startsWith('image/') ? outMime : null);
  let name = providedName || headerName || fileId;
  if (finalImageMime) {
    outMime = finalImageMime;
    const ext = EXT_BY_MIME[finalImageMime] || 'jpg';
    if (!/\.(jpe?g|png|gif|webp)$/i.test(name)) name = `${name}.${ext}`;
  } else {
    outMime = outMime || 'application/octet-stream';
  }
  return { name, mime: outMime };
}
async function downloadPublicDrive(fileId) {
  const url = publicDriveDownloadURL(fileId);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`No se pudo descargar público: ${resp.status}`);
  const mime = resp.headers.get('content-type') || 'application/octet-stream';
  const cd = resp.headers.get('content-disposition') || '';
  const headerName = parseFilenameFromContentDisposition(cd);
  const ab = await resp.arrayBuffer();
  return { buffer: Buffer.from(ab), mime, name: headerName || fileId };
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

// ====== Extender TTL de vector stores del thread y auto-recover ======
async function extendThreadVectorStores(thread_id) {
  try {
    const thr = await client.beta.threads.retrieve(thread_id);
    const vsIds = thr?.tool_resources?.file_search?.vector_store_ids || [];
    for (const vsId of vsIds) {
      try {
        // SDK puede exponer beta.vectorStores o vector_stores
        if (client.beta?.vectorStores?.update) {
          await client.beta.vectorStores.update(vsId, {
            expires_after: { anchor: 'last_active_at', days: FILE_TTL_DAYS }
          });
        } else if (client.vector_stores?.update) {
          await client.vector_stores.update(vsId, {
            expires_after: { anchor: 'last_active_at', days: FILE_TTL_DAYS }
          });
        }
      } catch (_) {}
    }
  } catch (_) {}
}

// ===================================================================
// ÚNICO ENDPOINT DE CONSULTA: POST /chat/query
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
      drive_ids = [],
      meta
    } = req.body;

    const effectiveText = (typeof message === 'string' && message.length) ? message : (text || '');
    const hasAnyFile = (files?.length || 0) + (urls?.length || 0) + (drive_paths?.length || 0) + (drive_ids?.length || 0) > 0;

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

    // 2.d) Drive IDs directos (rápido)
    for (const d of drive_ids) {
      if (!d?.file_id) continue;
      const drv = initDriveClientIfPossible();

      if (drv) {
        const metaG = await drv.files.get({ fileId: d.file_id, fields: 'name,mimeType' });
        const media = await drv.files.get({ fileId: d.file_id, alt: 'media' }, { responseType: 'arraybuffer' });
        const buff = Buffer.from(media.data);
        const ensured = ensureNameAndMime({
          fileId: d.file_id,
          providedName: d.filename,
          headerName: metaG?.data?.name || null,
          mime: metaG?.data?.mimeType || '',
          buffer: buff
        });
        const { file_id } = await uploadBufferToOpenAI(buff, ensured.name, ensured.mime, { type: 'drive-id', file_id: d.file_id });
        allFileIds.push(file_id);
      } else {
        const pub = await downloadPublicDrive(d.file_id);
        const ensured = ensureNameAndMime({
          fileId: d.file_id,
          providedName: d.filename,
          headerName: pub.name,
          mime: pub.mime,
          buffer: pub.buffer
        });
        const { file_id } = await uploadBufferToOpenAI(pub.buffer, ensured.name, ensured.mime, { type: 'drive-id-public', file_id: d.file_id });
        allFileIds.push(file_id);
      }
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

    // 🔒 Mantener vivos los vector stores del hilo
    await extendThreadVectorStores(thread_id);

    // ▶️ Ejecutar con auto-recuperación si el vector store ya expiró
    let run;
    try {
      run = await client.beta.threads.runs.createAndPoll(thread_id, { assistant_id: ASSISTANT_ID });
    } catch (e) {
      const msg = String(e?.error?.message || e.message || '');
      if (/Vector store .* is expired/i.test(msg)) {
        const thread = await client.beta.threads.create();
        const newId = thread.id;
        sessions.set(session_id, newId);
        saveSessions(sessions);
        console.warn(`♻️ Thread expirado. Migrando ${thread_id} -> ${newId}`);

        await client.beta.threads.messages.create(newId, {
          role: 'user', content, attachments, metadata: meta || undefined
        });
        await extendThreadVectorStores(newId);
        run = await client.beta.threads.runs.createAndPoll(newId, { assistant_id: ASSISTANT_ID });
        thread_id = newId;
      } else {
        throw e;
      }
    }

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
    if (now - last < 1000) {
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

// === Visualización directa desde Drive ===
app.get(['/drive/view/:fileId', '/google.drive/view/:fileId'], async (req, res) => {
  try {
    const drv = initDriveClientIfPossible();
    const { fileId } = req.params;

    if (drv) {
      const meta = await drv.files.get({ fileId, fields: 'name,mimeType' });
      const media = await drv.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
      const buff = Buffer.from(media.data);
      const ensured = ensureNameAndMime({
        fileId,
        providedName: meta?.data?.name || null,
        headerName: meta?.data?.name || null,
        mime: meta?.data?.mimeType || '',
        buffer: buff
      });
      res.setHeader('Content-Type', ensured.mime);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(ensured.name)}"`);
      res.setHeader('Cache-Control', 'public, max-age=600');
      res.end(buff);
    } else {
      const pub = await downloadPublicDrive(fileId);
      const ensured = ensureNameAndMime({
        fileId,
        providedName: null,
        headerName: pub.name,
        mime: pub.mime,
        buffer: pub.buffer
      });
      res.setHeader('Content-Type', ensured.mime);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(ensured.name)}"`);
      res.setHeader('Cache-Control', 'public, max-age=600');
      res.end(pub.buffer);
    }
  } catch (e) {
    console.error('ERR /drive/view', e);
    res.status(500).json({ error: e.message || 'Error mostrando archivo de Drive' });
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
