import fs from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { query } from "./db.js";
import { kb, sqlEngine } from "./CoreSystem.js";
import { getChatHistory } from "./chatMemory.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-001" });

export class ChatOrchestrator {
  constructor() {
    this.history = [];
  }

  isImageLikeFile(file) {
    if (!file) {
      return false;
    }
    const mime = (file.mimetype || file.type || "").toLowerCase();
    const name = (file.originalname || file.filename || file.name || "").toLowerCase();
    if (mime.startsWith("image/")) {
      return true;
    }
    if (name.match(/\.(png|jpe?g|webp|bmp|gif)$/i)) {
      return true;
    }
    return false;
  }

  async handleUserMessage(userMessage, databaseId, options = {}) {
    const text = typeof userMessage === "string" ? userMessage.trim() : "";
    const files = Array.isArray(options.files) ? options.files : [];
    const hasText = text.length > 0;
    const imageFiles = files.filter(f => this.isImageLikeFile(f));
    const otherFiles = files.filter(f => !this.isImageLikeFile(f));
    const threadId = options.threadId || null;

    let memory = { summary: "", messages: [] };

    if (threadId && databaseId) {
      try {
        const rawHistory = await getChatHistory(threadId, databaseId, 80);
        memory = await this.buildConversationMemory(rawHistory);
      } catch (error) {
        console.error("Error construyendo memoria de conversación:", error);
      }
    }

    try {
      if (imageFiles.length > 0) {
        console.log("[Chat][Images] Archivos de imagen recibidos:", imageFiles.map(f => ({
          fieldname: f.fieldname,
          mimetype: f.mimetype,
          size: f.size,
          path: f.path || null,
          hasBuffer: !!f.buffer
        })));
        return await this.handleImageQuery(text, databaseId, imageFiles, options, memory);
      }

      if (!hasText && otherFiles.length > 0) {
        return "Por ahora solo puedo analizar imágenes. Adjunta una imagen compatible o acompaña el archivo con una pregunta concreta.";
      }

      if (!hasText) {
        return "Escribe una consulta o adjunta una imagen para que pueda ayudarte.";
      }

      if (!databaseId) {
        return await this.handleGeneralQuery(text, memory);
      }

      const intent = await this.determineIntent(text, memory);

      if (intent === "DATA_QUERY") {
        return await this.handleDataQuery(text, databaseId, memory);
      }

      return await this.handleGeneralQuery(text, memory);
    } catch (error) {
      console.error("Error en handleUserMessage:", error);
      return "Lo siento, ocurrió un error interno al procesar tu mensaje.";
    }
  }

  async determineIntent(message, memory = { summary: "", messages: [] }) {
    const historyText = this.formatHistory(memory.messages);
    let prompt = `
Clasifica el siguiente mensaje en una categoría: "DATA_QUERY" o "GENERAL".
Usa "DATA_QUERY" cuando el usuario pida consultar, filtrar, contar, listar o resumir información almacenada en la base de datos (registros, indicadores, reportes, estadísticas).
Usa "GENERAL" para saludos, preguntas conceptuales, solicitudes de explicación, redacción de textos o cuando no sea claro que necesita datos de la base de datos.
`.trim();

    if (memory.summary && memory.summary.trim().length > 0) {
      prompt += `

Resumen previo de la conversación:
${memory.summary.trim()}`;
    }

    if (historyText && historyText.trim().length > 0) {
      prompt += `

Mensajes recientes de la conversación:
${historyText.trim()}`;
    }

    prompt += `

Mensaje actual del usuario:
"${message}"

Responde SOLO con una de las dos palabras: DATA_QUERY o GENERAL.
`.trim();

    try {
      const result = await model.generateContent(prompt);
      const raw = result.response.text() || "";
      const normalized = raw.trim().toUpperCase();
      if (normalized.includes("DATA_QUERY")) {
        return "DATA_QUERY";
      }
      return "GENERAL";
    } catch (error) {
      console.error("Error en determineIntent:", error);
      return "GENERAL";
    }
  }

  async handleDataQuery(message, databaseId, memory = { summary: "", messages: [] }) {
    let schemaContext = "";
    if (kb && typeof kb.schemaContext === "string") {
      schemaContext = kb.schemaContext;
    }

    let availableTables = "";
    let availableTableNames = [];

    try {
      const rows = await query("SHOW TABLES");
      if (Array.isArray(rows) && rows.length > 0) {
        const key = Object.keys(rows[0])[0];
        const names = rows.map(r => r[key]).filter(Boolean);
        if (names.length > 0) {
          availableTableNames = names;
          availableTables = names.join(", ");
        }
      }
    } catch (error) {
      console.error("Error obteniendo tablas de la base de datos:", error);
    }

    const historyText = this.formatHistory(memory.messages);
    const contextParts = [];

    if (memory.summary && memory.summary.trim().length > 0) {
      contextParts.push("Resumen previo de la conversación entre el usuario y el asistente:\n" + memory.summary.trim());
    }

    if (historyText && historyText.trim().length > 0) {
      contextParts.push("Historial reciente de la conversación entre el usuario y el asistente. Úsalo para interpretar referencias como \"estos registros\", \"la persona desactivada\", \"el reporte anterior\" o \"la consulta pasada\":\n" + historyText.trim());
    }

    if (availableTables) {
      contextParts.push("TABLAS DISPONIBLES EN ESTA BASE DE DATOS:\n" + availableTables);
    }

    if (schemaContext) {
      contextParts.push("SCHEMA DETALLADO DEL SISTEMA KAIZEN:\n" + schemaContext);
    }

    const fullContext = contextParts.join("\n\n");

    const sqlPrompt = `
Eres un experto en SQL MySQL para el sistema Kaizen de SSOMA.
Tu tarea es generar UNA sola sentencia SQL de solo lectura (SELECT) para responder a la pregunta del usuario.

Contexto de la base de datos del cliente con ID "${databaseId}":
${fullContext}

Reglas:
1. Usa exclusivamente tablas que existan en la lista de "TABLAS DISPONIBLES EN ESTA BASE DE DATOS".
2. Utiliza el contexto de esquema del sistema Kaizen para elegir columnas correctas y respetar los tipos de datos descritos allí.
3. No inventes nombres de tablas ni columnas. Si no encuentras tablas adecuadas para responder a la pregunta, responde exactamente: NO_VALID_SQL.
4. La sentencia debe ser un SELECT completo que termine con punto y coma.
5. No uses instrucciones DML o DDL como INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, GRANT ni REVOKE.
6. Siempre que el esquema lo permita, incluye una condición en la cláusula WHERE que limite la consulta al cliente cuyo identificador es "${databaseId}" utilizando la columna de identificador de base de datos correspondiente (por ejemplo DatabaseID u otra especificada en el esquema).
7. Cuando el esquema indique que un campo de estado se representa con valores numéricos (por ejemplo 1 para activo y 0 para inactivo), utiliza esos valores en la cláusula WHERE en lugar de texto como 'Activo' o 'Inactivo'.
8. Si la pregunta hace referencia a resultados anteriores de esta misma conversación (por ejemplo: "¿Cómo se llama la persona desactivada?", "Y la lista de desactivados?", "Y los nombres?"), reutiliza la misma tabla y condiciones lógicas que se usaron antes cuando sea coherente, y genera un SELECT que devuelva los registros correspondientes. Si hay más de un posible registro, devuelve una lista de todas las filas que cumplan el criterio.
9. Solo usa NO_VALID_SQL cuando realmente no exista ninguna tabla adecuada para responder, no cuando la pregunta sea ambigua pero pueda responderse devolviendo un conjunto de registros.

Pregunta del usuario:
"${message}"

Devuelve únicamente la sentencia SQL o, si no es posible generar una consulta válida, la palabra NO_VALID_SQL.
`.trim();

    try {
      const result = await model.generateContent(sqlPrompt);
      const raw = result.response.text() || "";
      const upperRaw = raw.trim().toUpperCase();

      let sql = null;
      if (!upperRaw.includes("NO_VALID_SQL")) {
        sql = this.extractFirstSqlStatement(raw);
      }

      if (!sql) {
        sql = this.buildFallbackSql(message, databaseId);
      }

      if (!sql) {
        return "No existe una tabla adecuada en la base de datos para responder exactamente a esa pregunta.";
      }

      let finalSql = sql;
      try {
        if (sqlEngine && typeof sqlEngine.validateSecurity === "function") {
          finalSql = sqlEngine.validateSecurity(sql, databaseId);
        }
      } catch (error) {
        console.error("Error en validación de seguridad SQL:", error);
        return "La consulta generada no es segura y no se ejecutará.";
      }

      if (availableTableNames.length > 0) {
        const allowed = new Set(availableTableNames.map(name => name.toUpperCase()));
        const regex = /\bFROM\s+([`"]?)([a-zA-Z0-9_]+)\1|\bJOIN\s+([`"]?)([a-zA-Z0-9_]+)\3/gi;
        let match;
        while ((match = regex.exec(finalSql)) !== null) {
          const table = (match[2] || match[4] || "").toUpperCase();
          if (table && !allowed.has(table)) {
            console.warn("Tabla no permitida en SQL generado:", table);
            return "La consulta generada hace referencia a tablas que no existen en esta base de datos. Reformula tu pregunta de otra manera o indica el módulo específico.";
          }
        }
      }

      console.log("[Chat][SQL]", finalSql);

      let dbResults;
      try {
        dbResults = await query(finalSql);
      } catch (error) {
        console.error("Database query error:", error);
        return "Hubo un error al consultar la base de datos. Verifica que la información exista en el sistema.";
      }

      const explainPieces = [];
      if (memory.summary && memory.summary.trim().length > 0) {
        explainPieces.push(memory.summary.trim());
      }
      const historyExplain = this.formatHistory(memory.messages);
      if (historyExplain && historyExplain.trim().length > 0) {
        explainPieces.push(historyExplain.trim());
      }
      const explainContext = explainPieces.join("\n\n");

      const explainPrompt = `
Eres un asistente virtual experto en SSOMA que responde a usuarios no técnicos.
Ten en cuenta el contexto de la conversación para mantener coherencia en las respuestas.

Contexto previo:
${explainContext || "(sin contexto adicional)"}

Pregunta actual del usuario:
"${message}"

Resultados de la base de datos en formato JSON:
${JSON.stringify(dbResults)}

Redacta una respuesta clara en español que explique los datos de forma comprensible.
Si no hay resultados, explícalo de forma amable e indica posibles motivos.
`.trim();

      const explainResult = await model.generateContent(explainPrompt);
      return explainResult.response.text();
    } catch (error) {
      console.error("Error en handleDataQuery:", error);
      return "Lo siento, hubo un problema al ejecutar la consulta en la base de datos.";
    }
  }

  async handleGeneralQuery(message, memory = { summary: "", messages: [] }) {
    const historyText = this.formatHistory(memory.messages);
    let prompt = `
Eres un asistente virtual experto en Seguridad y Salud Ocupacional (SSOMA) y en el uso del software Kaizen.
Responde siempre en español, de forma clara, práctica y orientada a la acción.
Cuando sea útil, organiza la información en listas o pasos.
`.trim();

    if (memory.summary && memory.summary.trim().length > 0) {
      prompt += `

Resumen previo de la conversación:
${memory.summary.trim()}`;
    }

    if (historyText && historyText.trim().length > 0) {
      prompt += `

Historial reciente de la conversación entre el usuario y el asistente:
${historyText.trim()}`;
    }

    prompt += `

Consulta del usuario:
"${message}"
`.trim();

    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      console.error("Error en handleGeneralQuery:", error);
      return "Lo siento, no puedo responder a eso ahora.";
    }
  }

  async handleImageQuery(message, databaseId, imageFiles, options = {}, memory = { summary: "", messages: [] }) {
    const hasText = typeof message === "string" && message.trim().length > 0;
    const historyText = this.formatHistory(memory.messages);
    let instruction;

    if (hasText) {
      instruction = `
Eres un experto en Seguridad y Salud Ocupacional (SSOMA).
Analiza la imagen proporcionada en el contexto de la consulta del usuario.
Sigue las instrucciones del usuario de forma prioritaria y utiliza la imagen como fuente principal de información.
`.trim();
    } else {
      instruction = `
Eres un experto en Seguridad y Salud Ocupacional (SSOMA).
Analiza detalladamente la imagen proporcionada y describe como mínimo:
1) La actividad que realiza la persona o personas.
2) El equipo de protección personal (EPP) visible, listando cada elemento.
3) Los riesgos presentes y las fuentes de daño.
4) Cualquier acto o condición subestándar que observes.
5) Recomendaciones concretas para mejorar la seguridad.
`.trim();
    }

    if (memory.summary && memory.summary.trim().length > 0) {
      instruction += `

Resumen previo de la conversación entre el usuario y el asistente:
${memory.summary.trim()}`;
    }

    if (historyText && historyText.trim().length > 0) {
      instruction += `

Historial reciente de la conversación. Si es relevante, conéctalo con lo que aparece en la imagen:
${historyText.trim()}`;
    }

    if (hasText) {
      instruction += `

Consulta actual del usuario:
"${message}"
`.trim();
    }

    const parts = [{ text: instruction }];

    for (const file of imageFiles) {
      try {
        let buffer = null;
        if (file.buffer && Buffer.isBuffer(file.buffer)) {
          buffer = file.buffer;
        } else if (file.path) {
          buffer = await fs.promises.readFile(file.path);
        }
        if (!buffer) {
          console.error("No se pudo obtener buffer de la imagen adjunta.");
          continue;
        }
        const base64 = buffer.toString("base64");
        const mimeType = file.mimetype || file.type || "image/png";
        parts.push({
          inlineData: {
            data: base64,
            mimeType
          }
        });
      } catch (error) {
        console.error("Error leyendo archivo de imagen:", error);
      }
    }

    if (parts.length === 1) {
      return "No fue posible leer la imagen adjunta. Intenta subirla nuevamente.";
    }

    try {
      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts
          }
        ]
      });
      const response = result.response;
      const text = response.text();
      console.log("[Chat][ImageResultText]", text);
      if (typeof text === "string" && text.trim().length > 0) {
        return text;
      }
      return "La imagen se procesó correctamente, pero no recibí una descripción de salida.";
    } catch (error) {
      console.error("Error en handleImageQuery:", error);
      return "Lo siento, hubo un problema al analizar la imagen.";
    }
  }

  extractFirstSqlStatement(text) {
    if (!text) {
      return null;
    }
    let cleaned = text.replace(/```sql/gi, "").replace(/```/g, "").trim();
    const match = cleaned.match(/(SELECT|INSERT|UPDATE|DELETE|SHOW|CALL)[\s\S]*?;/i);
    if (!match) {
      return null;
    }
    return match[0].trim();
  }

  formatHistory(history) {
    if (!Array.isArray(history) || history.length === 0) {
      return "";
    }
    const lines = history
      .map(entry => {
        const role = entry.role || "";
        const content = entry.content || "";
        if (!content) {
          return "";
        }
        if (role.toLowerCase() === "user") {
          return "Usuario: " + content;
        }
        if (role.toLowerCase() === "assistant" || role.toLowerCase() === "model") {
          return "Asistente: " + content;
        }
        return content;
      })
      .filter(Boolean);
    if (lines.length === 0) {
      return "";
    }
    return lines.join("\n");
  }

  async buildConversationMemory(history) {
    if (!Array.isArray(history) || history.length === 0) {
      return { summary: "", messages: [] };
    }
    const maxRecent = 16;
    const maxTotal = 80;
    let trimmed = history;
    if (trimmed.length > maxTotal) {
      trimmed = trimmed.slice(trimmed.length - maxTotal);
    }
    if (trimmed.length <= maxRecent) {
      return { summary: "", messages: trimmed };
    }
    const older = trimmed.slice(0, trimmed.length - maxRecent);
    const recent = trimmed.slice(trimmed.length - maxRecent);
    const olderText = this.formatHistory(older);
    if (!olderText || olderText.trim().length === 0) {
      return { summary: "", messages: recent };
    }
    const summaryPrompt = `
Eres un asistente especializado en resumir conversaciones entre un usuario y un asistente virtual de SSOMA.
Genera un resumen breve en español que conserve:
- El contexto general de lo que el usuario está intentando lograr.
- Los módulos, tablas o áreas del sistema Kaizen que se han mencionado.
- Las decisiones o respuestas importantes que se hayan dado.
- El estilo de comunicación relevante del usuario si aporta contexto.

Historial de conversación a resumir:
${olderText}
`.trim();
    try {
      const result = await model.generateContent(summaryPrompt);
      const summaryText = (result.response.text() || "").trim();
      return { summary: summaryText, messages: recent };
    } catch (error) {
      console.error("Error generando resumen de conversación:", error);
      return { summary: "", messages: trimmed.slice(trimmed.length - maxRecent) };
    }
  }

  buildFallbackSql(message, databaseId) {
    if (!databaseId) {
      return null;
    }
    const text = (message || "").toLowerCase();
    const safeDb = databaseId.replace(/[^a-zA-Z0-9_]/g, "");
    const mentionsPeople = /(persona|personas|colaborador|colaboradores|empleado|empleados|trabajador|trabajadores)/.test(text);
    const asksCount = /(cu[aá]ntas|cu[aá]ntos|n[uú]mero|cantidad)/.test(text);
    const mentionsInactive = /desactivad/.test(text) || /inactiv/.test(text);
    const mentionsActive = /activas?/.test(text) || /activos?/.test(text);

    if (mentionsPeople && mentionsInactive) {
      if (asksCount) {
        return `SELECT COUNT(*) AS total FROM rhStaff WHERE DatabaseID = '${safeDb}' AND stStatus = 0;`;
      }
      return `SELECT stName, stFirstsurname, stSecondsurname FROM rhStaff WHERE DatabaseID = '${safeDb}' AND stStatus = 0;`;
    }

    if (mentionsPeople && mentionsActive) {
      if (asksCount) {
        return `SELECT COUNT(*) AS total FROM rhStaff WHERE DatabaseID = '${safeDb}' AND stStatus = 1;`;
      }
      return `SELECT stName, stFirstsurname, stSecondsurname FROM rhStaff WHERE DatabaseID = '${safeDb}' AND stStatus = 1;`;
    }

    return null;
  }
}
