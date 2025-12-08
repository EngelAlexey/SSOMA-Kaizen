import { ChatOrchestrator } from "../ChatFlow.js";
import {
  saveChatMessage,
  getThreadOwner
} from "../chatMemory.js";

const chatOrchestrator = new ChatOrchestrator();

function collectFilesFromRequest(req) {
  const collected = [];

  if (Array.isArray(req.files)) {
    for (const f of req.files) {
      if (f) collected.push(f);
    }
  } else if (req.files && typeof req.files === "object") {
    const values = Object.values(req.files);
    for (const entry of values) {
      if (Array.isArray(entry)) {
        for (const f of entry) {
          if (f) collected.push(f);
        }
      } else if (entry) {
        collected.push(entry);
      }
    }
  }

  if (!collected.length && req.file) {
    collected.push(req.file);
  }

  return collected;
}

export async function handleChatQuery(req, res) {
  try {
    // Texto del mensaje
    const rawMessage =
      typeof req.body.query === "string" ? req.body.query : req.body.message;
    const message = typeof rawMessage === "string" ? rawMessage.trim() : "";

    // Archivos adjuntos
    const files = collectFilesFromRequest(req);
    const hasFiles = files.length > 0;

    // Identidad real del usuario (desde el token)
    const userContext = req.userContext || {};

    const licenseId =
      userContext.userId ||      
      req.body.userId ||             
      null;

    const prefixFromToken = userContext.prefix || null;
    let databaseId = prefixFromToken || req.body.databaseId || null;

    const threadId = req.body.threadId || null;

    const userForLog =
      userContext.userName ||
      licenseId ||
      "Usuario";

    if (!message && !hasFiles) {
      return res.status(400).json({
        success: false,
        error: "missing_content",
        message: "El mensaje o al menos un archivo son requeridos."
      });
    }

    if (threadId) {
      const owner = await getThreadOwner(threadId);
      if (owner) {
        const ownerLicenseId = owner.ctLicenseID;
        const ownerPrefix = owner.ctClientPrefix;

        if (
          (licenseId && ownerLicenseId && ownerLicenseId !== licenseId) ||
          (prefixFromToken && ownerPrefix && ownerPrefix !== prefixFromToken)
        ) {
          console.warn(
            `[Chat] Acceso NO AUTORIZADO al hilo ${threadId} por licencia ${licenseId} (owner licencia ${ownerLicenseId})`
          );
          return res.status(403).json({
            success: false,
            error: "unauthorized_thread",
            message: "No tienes permiso para acceder a este chat."
          });
        }

        if (ownerPrefix) {
          databaseId = ownerPrefix;
        }
      }
    }

    const logMessage =
      message && message.length > 0 ? message : "[solo archivo]";
    console.log(
      `[Chat] User: ${userForLog} | LicenseID: ${
        licenseId || "N/A"
      } | DB: ${databaseId || "None"} | Thread: ${
        threadId || "None"
      } | Msg: ${logMessage}`
    );
    console.log(`[Chat][Files] Adjuntos recibidos: ${files.length}`);

    const reply = await chatOrchestrator.handleUserMessage(message, databaseId, {
      files,
      threadId,
      userContext
    });

    if (threadId && databaseId) {
      const userContent =
        message && message.length > 0
          ? message
          : "Mensaje sin texto, con archivos adjuntos.";

      try {
        await saveChatMessage(
          threadId,
          databaseId,
          "user",
          userContent,
          licenseId,
          null 
        );

        if (typeof reply === "string" && reply.trim().length > 0) {
          await saveChatMessage(
            threadId,
            databaseId,
            "model",
            reply,
            licenseId,
            null
          );
        }
      } catch (error) {
        console.error("Error guardando historial de chat:", error);
      }
    }

    const safePreview =
      typeof reply === "string" ? reply.slice(0, 160) : "[no-text]";
    console.log("[Chat][HTTP_RESPONSE_OK]", safePreview);

    return res.json({
      success: true,
      response: reply,
      reply
    });
  } catch (error) {
    console.error("Error en handleChatQuery:", error);
    return res.status(500).json({
      success: false,
      error: "server_error",
      message: error.message || "Error interno del servidor de chat."
    });
  }
}
