import { ChatOrchestrator } from "../ChatFlow.js";
import { saveChatMessage } from "../chatMemory.js";

const chatOrchestrator = new ChatOrchestrator();

function collectFilesFromRequest(req) {
  const collected = [];

  if (Array.isArray(req.files)) {
    for (const f of req.files) {
      if (f) {
        collected.push(f);
      }
    }
  } else if (req.files && typeof req.files === "object") {
    const values = Object.values(req.files);
    for (const entry of values) {
      if (Array.isArray(entry)) {
        for (const f of entry) {
          if (f) {
            collected.push(f);
          }
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
    const rawMessage =
      typeof req.body.query === "string" ? req.body.query : req.body.message;
    const message = typeof rawMessage === "string" ? rawMessage.trim() : "";

    const files = collectFilesFromRequest(req);
    const hasFiles = files.length > 0;

    let databaseId = req.body.databaseId;
    if (!databaseId && req.userContext && req.userContext.prefix) {
      databaseId = req.userContext.prefix;
    }

    const threadId = req.body.threadId || null;
    const userId =
      req.body.userId ||
      (req.userContext && req.userContext.userId) ||
      "Guest";

    if (!message && !hasFiles) {
      return res.status(400).json({
        success: false,
        error: "El mensaje o al menos un archivo son requeridos."
      });
    }

    const logMessage = message && message.length > 0 ? message : "[solo archivo]";
    console.log(
      `[Chat] User: ${userId} | DB: ${databaseId || "None"} | Msg: ${logMessage}`
    );
    console.log(`[Chat][Files] Adjuntos recibidos: ${files.length}`);

    const reply = await chatOrchestrator.handleUserMessage(message, databaseId, {
      files,
      threadId,
      userContext: req.userContext
    });

    if (threadId && databaseId) {
      const userContent =
        message && message.length > 0
          ? message
          : "Mensaje sin texto, con archivos adjuntos.";
      try {
        await saveChatMessage(threadId, databaseId, "user", userContent);
        if (typeof reply === "string" && reply.trim().length > 0) {
          await saveChatMessage(threadId, databaseId, "model", reply);
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
