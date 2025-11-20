import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import OpenAI from "openai";
import { loadSessions, saveSessions } from "./sessions.js";
import { downloadFileFromDrive } from "./googleDrive.js";
import { extendThreadVectorStores } from "./vectorstore.js";
import { ensureUploadDir, listStoredFiles, deleteExpiredFiles } from "./storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const MAX_UPLOAD_SIZE_MB = parseInt(process.env.MAX_UPLOAD_SIZE_MB || "10", 10);
const MAX_UPLOAD_FILES = parseInt(process.env.MAX_UPLOAD_FILES || "5", 10);
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "40mb";

const ALLOWED_MIMETYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "application/pdf"
];

const upload = multer({
  dest: path.join(__dirname, "uploads"),
  limits: {
    fileSize: MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    files: MAX_UPLOAD_FILES
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMETYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const error = new Error("UNSUPPORTED_FILE_TYPE");
      error.type = "UNSUPPORTED_FILE_TYPE";
      cb(error);
    }
  }
});

app.use(
  cors({
    origin: [
      "https://ssoma-kaizen-web.onrender.com",
      "http://localhost:5173",
      "http://localhost:3000"
    ],
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.options("*", cors());

app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

const ASSISTANT_ID = process.env.ASSISTANT_ID;
const FILE_TTL_DAYS = parseInt(process.env.FILE_TTL_DAYS || "180", 10);
const MAX_COMPLETION_TOKENS = parseInt(process.env.MAX_COMPLETION_TOKENS || "256", 10);
const FAST_MODE_MODEL = process.env.FAST_MODE_MODEL || "gpt-4.1-mini";

const FAST_MODE_SYSTEM_PROMPT = `Eres SSOMA – Kaizen, un asistente de soporte especializado en:
- Salud, Seguridad Ocupacional y Ambiente (SSOMA) en construcción.
- Recursos Humanos en Costa Rica y su normativa laboral.
- Uso de la plataforma Kaizen (AppSheet) y sus módulos.
Responde solo sobre esos temas. 
Si la consulta no está relacionada con salud ocupacional, recursos humanos o Kaizen responde exactamente:
"Esta consulta no está relacionada con la gestión de salud ocupacional, recursos humanos o el uso de la aplicación Kaizen."
Sé claro, directo y concreto; usa uno o dos párrafos y, solo si hace falta, una lista corta de pasos.`;

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const sessions = loadSessions();

const handleUpload = (req, res, next) => {
  upload.array("files")(req, res, err => {
    if (!err) return next();

    if (err.type === "UNSUPPORTED_FILE_TYPE") {
      return res.status(400).json({
        error: "unsupported_file_type",
        message: "El tipo de archivo no es compatible. Solo se permiten imágenes (JPG, PNG, WEBP) y archivos PDF."
      });
    }

    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "file_too_large",
        message: `El archivo es demasiado grande. El tamaño máximo permitido es de ${MAX_UPLOAD_SIZE_MB} MB.`
      });
    }

    return res.status(500).json({
      error: "upload_failed",
      message: "Ocurrió un error al procesar los archivos adjuntos."
    });
  });
};

function sanitizeFilename(name) {
  if (!name || typeof name !== "string") return String(Date.now());
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

async function materializeInlineFiles(inlineFiles) {
  if (!Array.isArray(inlineFiles) || inlineFiles.length === 0) return [];
  const results = [];
  for (const f of inlineFiles) {
    try {
      if (!f) continue;
      const filename = sanitizeFilename(f.filename || f.name || "file");
      const base64 = typeof f.base64 === "string" ? f.base64 : null;
      if (!base64) continue;

      let mime = null;
      let payload = base64;
      const match = base64.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mime = match[1];
        payload = match[2];
      }

      const buffer = Buffer.from(payload, "base64");
      if (buffer.length > MAX_UPLOAD_SIZE_MB * 1024 * 1024) {
        continue;
      }

      const uploadsDir = path.join(__dirname, "uploads");
      const finalName = `${Date.now()}-${filename}`;
      const filePath = path.join(uploadsDir, finalName);
      await fs.promises.writeFile(filePath, buffer);

      results.push({
        path: filePath,
        originalname: filename,
        mimetype: mime || "application/octet-stream",
        size: buffer.length
      });
    } catch {
    }
  }
  return results;
}

app.post("/chat/query", handleUpload, async (req, res) => {
  try {
    const body = req.body || {};
    const {
      session_id,
      thread_id: clientThreadId,
      text,
      message,
      urls = [],
      drive_paths = [],
      drive_ids = [],
      meta,
      files: inlineFilesRaw
    } = body;

    const effectiveText =
      typeof text === "string" && text.trim().length > 0
        ? text
        : typeof message === "string"
        ? message
        : "";

    const trimmedText = (effectiveText || "").trim();

    const uploadedFiles = Array.isArray(req.files) ? [...req.files] : [];
    const inlineFiles = Array.isArray(inlineFilesRaw) ? inlineFilesRaw : [];

    if (inlineFiles.length > 0) {
      const extraFiles = await materializeInlineFiles(inlineFiles);
      for (const ef of extraFiles) {
        uploadedFiles.push(ef);
      }
    }

    const urlsCount = Array.isArray(urls) ? urls.length : 0;
    const drivePathsCount = Array.isArray(drive_paths) ? drive_paths.length : 0;
    const driveIdsCount = Array.isArray(drive_ids) ? drive_ids.length : 0;

    const hasAnyFile =
      (uploadedFiles.length || 0) +
        urlsCount +
        drivePathsCount +
        driveIdsCount >
      0;

    if (!session_id) {
      return res.status(400).json({ error: "session_id requerido" });
    }

    if (!trimmedText && !hasAnyFile) {
      return res
        .status(400)
        .json({ error: "Debe enviar mensaje y/o adjuntos" });
    }

    if (!hasAnyFile && trimmedText.length > 0 && trimmedText.length <= 2) {
      return res.json({
        session_id,
        thread_id: clientThreadId || sessions.get(session_id) || null,
        status: "skipped",
        reply: "Necesito un poco más de contexto para poder ayudarte.",
        reason: "too_short"
      });
    }

    const existingThreadId = clientThreadId || sessions.get(session_id) || null;
    const mentionsDocsOrFiles = trimmedText
      ? /\b(archivo|adjunto|pdf|documento|documentación|plantilla|reglamento|norma|anexo|cita textual)\b/i.test(
          trimmedText
        )
      : false;

    const eligibleForFastMode =
      !hasAnyFile &&
      !existingThreadId &&
      !!trimmedText &&
      trimmedText.length > 2 &&
      !mentionsDocsOrFiles &&
      !!FAST_MODE_MODEL;

    if (eligibleForFastMode) {
      const completion = await client.chat.completions.create({
        model: FAST_MODE_MODEL,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        messages: [
          { role: "system", content: FAST_MODE_SYSTEM_PROMPT },
          { role: "user", content: trimmedText }
        ]
      });

      const choice =
        completion.choices && completion.choices.length > 0
          ? completion.choices[0]
          : null;

      const reply =
        choice &&
        choice.message &&
        typeof choice.message.content === "string"
          ? choice.message.content.trim()
          : "";

      return res.json({
        session_id,
        thread_id: null,
        status: "completed",
        reply,
        reason: "fast_mode"
      });
    }

    let thread_id = existingThreadId;

    if (!thread_id) {
      const thread = await client.beta.threads.create();
      thread_id = thread.id;
      sessions.set(session_id, thread_id);
      saveSessions(sessions);
    }

    const allFileIds = [];

    for (const f of uploadedFiles) {
      try {
        const file = await client.files.create({
          file: fs.createReadStream(f.path),
          purpose: "assistants"
        });
        allFileIds.push(file.id);
      } catch (e) {
      }
    }

    if (Array.isArray(urls)) {
      for (const url of urls) {
        try {
          const resp = await fetch(url);
          if (!resp.ok) continue;
          const buffer = await resp.arrayBuffer();
          const namePart = path.basename((url || "").split("?")[0] || "url");
          const tmpPath = path.join(
            __dirname,
            "uploads",
            `${Date.now()}-${sanitizeFilename(namePart)}`
          );
          await fs.promises.writeFile(tmpPath, Buffer.from(buffer));
          const file = await client.files.create({
            file: fs.createReadStream(tmpPath),
            purpose: "assistants"
          });
          allFileIds.push(file.id);
        } catch (e) {
        }
      }
    }

    if (Array.isArray(drive_ids)) {
      for (const driveId of drive_ids) {
        try {
          const downloaded = await downloadFileFromDrive(driveId);
          if (!downloaded) continue;
          const file = await client.files.create({
            file: fs.createReadStream(downloaded),
            purpose: "assistants"
          });
          allFileIds.push(file.id);
        } catch (e) {
        }
      }
    }

    const attachments =
      allFileIds.length > 0
        ? allFileIds.map(id => ({ file_id: id }))
        : undefined;

    const content = trimmedText
      ? [{ type: "text", text: trimmedText }]
      : undefined;

    await client.beta.threads.messages.create(thread_id, {
      role: "user",
      content,
      attachments,
      metadata: meta || undefined
    });

    await extendThreadVectorStores(thread_id);

    let run;
    try {
      run = await client.beta.threads.runs.createAndPoll(thread_id, {
        assistant_id: ASSISTANT_ID,
        max_completion_tokens: MAX_COMPLETION_TOKENS
      });
    } catch (e) {
      const rawMessage =
        e && e.error && e.error.message
          ? String(e.error.message)
          : String(e && e.message ? e.message : e || "");
      if (/Vector store .* is expired/i.test(rawMessage)) {
        const thread = await client.beta.threads.create();
        const newId = thread.id;
        sessions.set(session_id, newId);
        saveSessions(sessions);
        await client.beta.threads.messages.create(newId, {
          role: "user",
          content,
          attachments,
          metadata: meta || undefined
        });
        await extendThreadVectorStores(newId);
        run = await client.beta.threads.runs.createAndPoll(newId, {
          assistant_id: ASSISTANT_ID,
          max_completion_tokens: MAX_COMPLETION_TOKENS
        });
        thread_id = newId;
      } else {
        throw e;
      }
    }

    const messages = await client.beta.threads.messages.list(thread_id);
    const lastMessage = messages.data.find(m => m.role === "assistant");

    let reply = "";
    if (
      lastMessage &&
      Array.isArray(lastMessage.content) &&
      lastMessage.content.length > 0 &&
      lastMessage.content[0].type === "text"
    ) {
      reply = lastMessage.content[0].text.value || "";
    }

    return res.json({
      session_id,
      thread_id,
      status: run.status,
      reply,
      reason: "assistant_mode"
    });
  } catch (err) {
    const message =
      err && err.message ? String(err.message) : String(err || "error");
    return res.status(500).json({ error: message });
  }
});

app.get("/files/list", async (req, res) => {
  try {
    const files = await listStoredFiles();
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/files/cleanup", async (req, res) => {
  try {
    const deleted = await deleteExpiredFiles(FILE_TTL_DAYS);
    res.json({ deleted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/sessions/reset", async (req, res) => {
  try {
    const { session_id } = req.body || {};
    if (!session_id) {
      return res.status(400).json({ error: "session_id requerido" });
    }
    sessions.delete(session_id);
    saveSessions(sessions);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use((err, req, res, next) => {
  if (err && err.type === "entity.too.large") {
    if (!res.headersSent) {
      return res.status(413).json({
        error: "payload_too_large",
        message:
          "El archivo o cuerpo enviado es demasiado grande. Reduce el tamaño o utiliza archivos más ligeros."
      });
    }
  }
  if (res.headersSent) {
    return next(err);
  }
  const message =
    err && err.message ? String(err.message) : String(err || "error");
  return res.status(500).json({
    error: "server_error",
    message
  });
});

ensureUploadDir();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
