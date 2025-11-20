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
const ALLOWED_MIMETYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "application/pdf",
];

const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    files: MAX_UPLOAD_FILES,
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMETYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const error = new Error("UNSUPPORTED_FILE_TYPE");
      error.type = "UNSUPPORTED_FILE_TYPE";
      cb(error);
    }
  },
});


app.use(
  cors({
    origin: [
      "https://ssoma-kaizen-web.onrender.com",
      "http://localhost:5173",
      "http://localhost:3000",
    ],
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.options("*", cors());


app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const ASSISTANT_ID = process.env.ASSISTANT_ID;
const FILE_TTL_DAYS = parseInt(process.env.FILE_TTL_DAYS || "180", 10);
const MAX_COMPLETION_TOKENS = parseInt(process.env.MAX_COMPLETION_TOKENS || "256", 10);
const FAST_MODE_MODEL = process.env.FAST_MODE_MODEL || "gpt-4.1-mini";

const FAST_MODE_SYSTEM_PROMPT = `Eres SSOMA – Kaizen, un asistente de soporte especializado en:
- Salud, Seguridad Ocupacional y Ambiente (SSOMA) en construcción.
- Recursos Humanos en Costa Rica y su normativa laboral.
- Uso de la plataforma Kaizen (AppSheet) y sus módulos.
Responde solo sobre: jornadas, salarios, aguinaldo, liquidaciones y prestaciones en Costa Rica; gestión de personal, proyectos, empresas y puestos en Kaizen; accidentes, hallazgos, sanciones, capacitaciones y gestión documental SSOMA; análisis de imágenes y documentos de seguridad.
Si la consulta no está relacionada con salud ocupacional, recursos humanos o Kaizen responde exactamente:
"Esta consulta no está relacionada con la gestión de salud ocupacional, recursos humanos o el uso de la aplicación Kaizen."
Sé claro, directo y concreto (uno o dos párrafos y, si hace falta, una lista corta de pasos).`;

const sessions = loadSessions();

const handleUpload = (req, res, next) => {
  upload.array("files")(req, res, (err) => {
    if (!err) return next();

    if (err.type === "UNSUPPORTED_FILE_TYPE") {
      return res.status(400).json({
        error: "unsupported_file_type",
        message:
          "El tipo de archivo no es compatible. Solo se permiten imágenes (JPG, PNG, WEBP) y archivos PDF.",
      });
    }

    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "file_too_large",
        message: `El archivo es demasiado grande. El tamaño máximo permitido es de ${MAX_UPLOAD_SIZE_MB} MB.`,
      });
    }

    console.error("Error en subida de archivos:", err);
    return res.status(500).json({
      error: "upload_failed",
      message: "Ocurrió un error al procesar los archivos adjuntos.",
    });
  });
};


app.post("/chat/query", handleUpload, async (req, res) => {
  try {
    const {
      session_id,
      thread_id: clientThreadId,
      text,
      message,
      urls = [],
      drive_paths = [],
      drive_ids = [],
      meta,
    } = req.body;

    const effectiveText =
      typeof message === "string" && message.length ? message : text || "";
    const trimmedText = (effectiveText || "").trim();

    const uploadedFiles = req.files || [];

    const hasAnyFile =
      (uploadedFiles.length || 0) +
        (urls?.length || 0) +
        (drive_paths?.length || 0) +
        (drive_ids?.length || 0) >
      0;

    if (!session_id) {
      return res.status(400).json({ error: "session_id requerido" });
    }
    if (!trimmedText && !hasAnyFile) {
      return res
        .status(400)
        .json({ error: "Debe enviar mensaje y/o adjuntos" });
    }

    if (!hasAnyFile && trimmedText.length > 0 && trimmedText.length <= 2)
      return res.json({
        session_id,
        thread_id: clientThreadId || sessions.get(session_id) || null,
        status: "skipped",
        reply: "Necesito un poco más de contexto para poder ayudarte.",
        reason: "too_short",
      });

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
      !mentionsDocsOrFiles;

    if (eligibleForFastMode) {
      const completion = await client.chat.completions.create({
        model: FAST_MODE_MODEL,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        messages: [
          { role: "system", content: FAST_MODE_SYSTEM_PROMPT },
          { role: "user", content: trimmedText },
        ],
      });
      const reply = completion.choices?.[0]?.message?.content?.trim() || "";
      return res.json({
        session_id,
        thread_id: null,
        status: "completed",
        reply,
        reason: "fast_mode",
      });
    }

    let thread_id = existingThreadId;
    if (!thread_id) {
      const thread = await client.beta.threads.create();
      thread_id = thread.id;
    }

    if (sessions.get(session_id) !== thread_id) {
      sessions.set(session_id, thread_id);
      saveSessions(sessions);
    }

    const allFileIds = [];
    for (const f of uploadedFiles) {
      const file = await client.files.create({
        file: fs.createReadStream(f.path),
        purpose: "assistants",
      });
      allFileIds.push(file.id);
    }

    for (const url of urls || []) {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const tmpPath = path.join(__dirname, "uploads", path.basename(url.split("?")[0]));
      const buffer = await resp.arrayBuffer();
      fs.writeFileSync(tmpPath, Buffer.from(buffer));
      const file = await client.files.create({
        file: fs.createReadStream(tmpPath),
        purpose: "assistants",
      });
      allFileIds.push(file.id);
    }

    for (const driveId of drive_ids || []) {
      const downloaded = await downloadFileFromDrive(driveId);
      if (!downloaded) continue;
      const file = await client.files.create({
        file: fs.createReadStream(downloaded),
        purpose: "assistants",
      });
      allFileIds.push(file.id);
    }

    const attachments = allFileIds.length
      ? allFileIds.map((id) => ({ file_id: id }))
      : undefined;

    const content = trimmedText ? [{ type: "text", text: trimmedText }] : undefined;

    await client.beta.threads.messages.create(thread_id, {
      role: "user",
      content,
      attachments,
      metadata: meta || undefined,
    });

    await extendThreadVectorStores(thread_id);

    let run;
    try {
      run = await client.beta.threads.runs.createAndPoll(thread_id, {
        assistant_id: ASSISTANT_ID,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
      });
    } catch (e) {
      const msg = String(e?.error?.message || e.message || "");
      if (/Vector store .* is expired/i.test(msg)) {
        const thread = await client.beta.threads.create();
        const newId = thread.id;
        sessions.set(session_id, newId);
        saveSessions(sessions);
        await client.beta.threads.messages.create(newId, {
          role: "user",
          content,
          attachments,
          metadata: meta || undefined,
        });
        await extendThreadVectorStores(newId);
        run = await client.beta.threads.runs.createAndPoll(newId, {
          assistant_id: ASSISTANT_ID,
          max_completion_tokens: MAX_COMPLETION_TOKENS,
        });
        thread_id = newId;
      } else throw e;
    }

    const messages = await client.beta.threads.messages.list(thread_id);
    const lastMessage = messages.data.find((m) => m.role === "assistant");
    const reply = lastMessage?.content?.[0]?.text?.value || "";

    res.json({
      session_id,
      thread_id,
      status: run.status,
      reply,
      reason: "assistant_mode",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: "session_id requerido" });
    sessions.delete(session_id);
    saveSessions(sessions);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

ensureUploadDir();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
