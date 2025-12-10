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
    this.documentsByThread = new Map();
  }

  createDocId() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
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

  isDocumentLikeFile(file) {
    if (!file) {
      return false;
    }
    const mime = (file.mimetype || file.type || "").toLowerCase();
    const name = (file.originalname || file.filename || file.name || "").toLowerCase();
    if (
      mime === "application/pdf" ||
      mime === "text/plain" ||
      mime === "text/csv" ||
      mime === "application/json" ||
      mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mime === "application/vnd.ms-excel"
    ) {
      return true;
    }
    if (
      name.endsWith(".pdf") ||
      name.endsWith(".txt") ||
      name.endsWith(".csv") ||
      name.endsWith(".json") ||
      name.endsWith(".xlsx") ||
      name.endsWith(".xls")
    ) {
      return true;
    }
    return false;
  }

  buildDocPartsFromMemory(docs) {
    if (!Array.isArray(docs) || docs.length === 0) {
      return [];
    }
    const sorted = [...docs].sort((a, b) => {
      const ca = a.createdAt || 0;
      const cb = b.createdAt || 0;
      return ca - cb;
    });
    const maxDocs = 3;
    const recent = sorted.slice(Math.max(0, sorted.length - maxDocs));
    const parts = [];
    for (const doc of recent) {
      const name = doc.name || "Document";
      if (doc.kind === "text" && doc.text) {
        parts.push({
          text: `Relevant content from document "${name}":\n${doc.text}`
        });
      } else if (doc.kind === "inlineData" && doc.data && doc.mimeType) {
        parts.push({
          inlineData: {
            data: doc.data,
            mimeType: doc.mimeType
          }
        });
      }
    }
    return parts;
  }

  async isDocFollowUp(message, memory = { summary: "", messages: [] }, docs = []) {
    if (!message) {
      return false;
    }
    if (!Array.isArray(docs) || docs.length === 0) {
      return false;
    }
    const historyText = this.formatHistory(memory.messages);
    const names = docs.map(d => d.name).filter(Boolean);
    let prompt = `
You will receive a user message inside an ongoing conversation with a SSOMA assistant that already has one or more documents attached.
Your task is to decide whether the message is asking about the content of those documents, including questions about calculations, amounts, results, columns or rows, even if the user does not mention the document by name.
Be tolerant of synonyms and minor spelling mistakes. Only if the message is too ambiguous or unreadable should you treat it as NOT related to the documents.
Respond with a single word only: YES if the message refers to the content of the documents, or NO if it is about something else (for example a direct database query, a greeting, or a theoretical question).
`.trim();
    if (names.length > 0) {
      prompt += `

Documents already available in this conversation:
${names.map(n => `- ${n}`).join("\n")}`;
    }
    if (memory.summary && memory.summary.trim().length > 0) {
      prompt += `

Previous conversation summary:
${memory.summary.trim()}`;
    }
    if (historyText && historyText.trim().length > 0) {
      prompt += `

Recent conversation history:
${historyText.trim()}`;
    }
    prompt += `

Current user message:
"${message}"
`.trim();
    try {
      const result = await model.generateContent(prompt);
      const raw = result.response.text() || "";
      const norm = raw.trim().toUpperCase();
      if (norm.startsWith("Y")) {
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error in isDocFollowUp:", error);
      return false;
    }
  }

  async handleUserMessage(userMessage, databaseId, options = {}) {
    const text = typeof userMessage === "string" ? userMessage.trim() : "";
    const files = Array.isArray(options.files) ? options.files : [];
    const hasText = text.length > 0;

    const imageFiles = files.filter(f => this.isImageLikeFile(f));
    const documentFiles = files.filter(f => this.isDocumentLikeFile(f) && !this.isImageLikeFile(f));
    const unsupportedFiles = files.filter(
      f => !this.isImageLikeFile(f) && !this.isDocumentLikeFile(f)
    );

    const threadId = options.threadId || null;

    let memory = { summary: "", messages: [] };
    let persistedDocs = [];

    if (threadId) {
      const stored = this.documentsByThread.get(threadId);
      if (Array.isArray(stored) && stored.length > 0) {
        persistedDocs = stored;
      }
    }

    if (threadId && databaseId) {
      try {
        const rawHistory = await getChatHistory(threadId, databaseId, 80);
        memory = await this.buildConversationMemory(rawHistory);
      } catch (error) {
        console.error("Error building conversation memory:", error);
      }
    }

    try {
      if (imageFiles.length > 0 && documentFiles.length === 0) {
        console.log("[Chat][Images] Image files received:", imageFiles.map(f => ({
          fieldname: f.fieldname,
          mimetype: f.mimetype,
          size: f.size,
          path: f.path || null,
          hasBuffer: !!f.buffer
        })));
        return await this.handleImageQuery(text, databaseId, imageFiles, options, memory);
      }

      if (documentFiles.length > 0 && imageFiles.length === 0) {
        console.log("[Chat][Docs] Document files received:", documentFiles.map(f => ({
          fieldname: f.fieldname,
          mimetype: f.mimetype,
          size: f.size,
          path: f.path || null,
          hasBuffer: !!f.buffer
        })));
        return await this.handleDocumentQuery(text, databaseId, documentFiles, { ...options }, memory);
      }

      if (documentFiles.length > 0 && imageFiles.length > 0) {
        console.log("[Chat][Docs+Images] Mixed files received:", {
          images: imageFiles.map(f => ({
            fieldname: f.fieldname,
            mimetype: f.mimetype,
            size: f.size
          })),
          docs: documentFiles.map(f => ({
            fieldname: f.fieldname,
            mimetype: f.mimetype,
            size: f.size
          }))
        });
        return await this.handleDocumentQuery(text, databaseId, documentFiles, { ...options }, memory);
      }

      if (!hasText && unsupportedFiles.length > 0 && imageFiles.length === 0 && documentFiles.length === 0) {
        return "Por ahora puedo analizar imágenes y documentos en formatos PDF, TXT, CSV, JSON y Excel (XLSX/XLS). El archivo enviado no es compatible con el análisis directo.";
      }

      if (!hasText && files.length > 0 && imageFiles.length === 0 && documentFiles.length === 0) {
        return "Por ahora puedo analizar imágenes y documentos en formatos PDF, TXT, CSV, JSON y Excel (XLSX/XLS). Adjunta un archivo compatible o acompaña el archivo con una pregunta concreta.";
      }

      if (!hasText && files.length === 0) {
        return "Escribe una consulta o adjunta un archivo (imagen o documento compatible) para que pueda ayudarte.";
      }

      if (hasText && imageFiles.length === 0 && documentFiles.length === 0 && persistedDocs.length > 0) {
        const isFollowUp = await this.isDocFollowUp(text, memory, persistedDocs);
        if (isFollowUp) {
          return await this.handleDocFollowUpQuery(text, databaseId, persistedDocs, memory);
        }
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
      console.error("Error in handleUserMessage:", error);
      return "Lo siento, ocurrió un error interno al procesar tu mensaje.";
    }
  }

  async determineIntent(message, memory = { summary: "", messages: [] }) {
    const historyText = this.formatHistory(memory.messages);
    let prompt = `
Classify the following message into one category: "DATA_QUERY" or "GENERAL".
Use "DATA_QUERY" when the user is asking to query, filter, count, list or summarize information stored in the database (records, indicators, reports, statistics).
Use "GENERAL" for greetings, conceptual questions, explanations, text drafting or when it is not clearly a request for database data.
Be tolerant of synonyms and minor spelling mistakes. Only if the message is too ambiguous or unreadable should you classify it as GENERAL so the assistant can ask for clarification.
`.trim();

    if (memory.summary && memory.summary.trim().length > 0) {
      prompt += `

Previous conversation summary:
${memory.summary.trim()}`;
    }

    if (historyText && historyText.trim().length > 0) {
      prompt += `

Recent conversation messages:
${historyText.trim()}`;
    }

    prompt += `

Current user message:
"${message}"

Respond with exactly one of the two words: DATA_QUERY or GENERAL.
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
      console.error("Error in determineIntent:", error);
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
      console.error("Error getting database tables:", error);
    }

    const historyText = this.formatHistory(memory.messages);
    const contextParts = [];

    if (memory.summary && memory.summary.trim().length > 0) {
      contextParts.push("Previous conversation summary between the user and the assistant:\n" + memory.summary.trim());
    }

    if (historyText && historyText.trim().length > 0) {
      contextParts.push(
        "Recent conversation history. Use it to interpret references like \"those records\", \"the deactivated person\", \"the previous report\" or \"the last query\":\n" +
          historyText.trim()
      );
    }

    if (availableTables) {
      contextParts.push("TABLES AVAILABLE IN THIS DATABASE:\n" + availableTables);
    }

    if (schemaContext) {
      contextParts.push("DETAILED SCHEMA OF THE KAIZEN SYSTEM:\n" + schemaContext);
    }

    const fullContext = contextParts.join("\n\n");

    const sqlPrompt = `
You are an expert in MySQL SQL for the Kaizen SSOMA system.
Your task is to generate a single read-only SQL statement (SELECT) that answers the user's question.

Client database ID: "${databaseId}"

Context:
${fullContext}

Rules:
1. Use only tables that exist in the list "TABLES AVAILABLE IN THIS DATABASE".
2. Use the Kaizen schema context to choose correct columns and respect described data types.
3. Do not invent table or column names. If there are no suitable tables to answer the question, respond exactly with: NO_VALID_SQL.
4. The statement must be a complete SELECT ending with a semicolon.
5. Do not use DML or DDL instructions such as INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, GRANT or REVOKE.
6. Whenever the schema allows it, include a WHERE condition that restricts the query to the client whose identifier is "${databaseId}", using the appropriate database identifier column (for example DatabaseID or another specified in the schema).
7. When the schema indicates that a status field is numeric (for example 1 for active and 0 for inactive), use those numeric values instead of text like 'Activo' or 'Inactivo'.
8. If the question refers to results from earlier in this same conversation (for example: "What is the name of the deactivated person?", "And the list of inactive ones?", "And the names?"), reuse the same table and logical conditions that were used before when it makes sense, and generate a SELECT that returns the matching records. If there is more than one possible record, return a list of all rows that satisfy the criteria.
9. Be tolerant of synonyms and minor spelling mistakes. Only if the message is too ambiguous or unreadable should you respond exactly with NO_VALID_SQL instead of trying to build an unsafe query.

User question:
"${message}"

Return only the SQL statement, or the word NO_VALID_SQL if you cannot generate a valid query.
`.trim();

    try {
      const result = await model.generateContent(sqlPrompt);
      const raw = result.response.text() || "";
      const upperRaw = raw.trim().toUpperCase();

      let sql = null;
      let invalidOrAmbiguous = false;

      if (upperRaw.includes("NO_VALID_SQL")) {
        invalidOrAmbiguous = true;
      } else {
        sql = this.extractFirstSqlStatement(raw);
      }

      if (!sql) {
        sql = this.buildFallbackSql(message, databaseId);
      }

      if (!sql) {
        if (invalidOrAmbiguous) {
          return "No logro identificar claramente qué información de la base de datos necesitas. Intenta reformular tu pregunta con más detalle o con menos abreviaturas.";
        }
        return "No existe una tabla adecuada en la base de datos para responder exactamente a esa pregunta.";
      }

      let finalSql = sql;
      try {
        if (sqlEngine && typeof sqlEngine.validateSecurity === "function") {
          finalSql = sqlEngine.validateSecurity(sql, databaseId);
        }
      } catch (error) {
        console.error("Error in SQL security validation:", error);
        return "La consulta generada no es segura y no se ejecutará.";
      }

      if (availableTableNames.length > 0) {
        const allowed = new Set(availableTableNames.map(name => name.toUpperCase()));
        const regex = /\bFROM\s+([`"]?)([a-zA-Z0-9_]+)\1|\bJOIN\s+([`"]?)([a-zA-Z0-9_]+)\3/gi;
        let match;
        while ((match = regex.exec(finalSql)) !== null) {
          const table = (match[2] || match[4] || "").toUpperCase();
          if (table && !allowed.has(table)) {
            console.warn("Table not allowed in generated SQL:", table);
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
You are a virtual assistant specialized in SSOMA and you respond to non-technical users.
Always answer in the same language as the user's message.
Take the conversation context into account to keep answers consistent.
Be tolerant of synonyms and minor spelling mistakes; if the question is still too ambiguous, ask the user to restate it with more detail.

Conversation context:
${explainContext || "(no additional context)"}

Current user question:
"${message}"

Database results in JSON:
${JSON.stringify(dbResults)}

Write a clear explanation of these data that the user can easily understand.
If there are no results, explain this politely and mention possible reasons.
`.trim();

      const explainResult = await model.generateContent(explainPrompt);
      return explainResult.response.text();
    } catch (error) {
      console.error("Error in handleDataQuery:", error);
      return "Lo siento, hubo un problema al ejecutar la consulta en la base de datos.";
    }
  }

  async handleGeneralQuery(message, memory = { summary: "", messages: [] }) {
    const historyText = this.formatHistory(memory.messages);
    let prompt = `
You are a virtual assistant specialized in Occupational Health and Safety (SSOMA) and in the Kaizen software.
Always answer in the same language as the user's message.
Give clear, practical, action-oriented answers. When useful, organize information into steps or bullet points.
Be tolerant of synonyms and minor spelling mistakes. Only if the message is too ambiguous or unreadable should you ask the user to clarify the question before continuing.
`.trim();

    if (memory.summary && memory.summary.trim().length > 0) {
      prompt += `

Previous conversation summary:
${memory.summary.trim()}`;
    }

    if (historyText && historyText.trim().length > 0) {
      prompt += `

Recent conversation history:
${historyText.trim()}`;
    }

    prompt += `

User message:
"${message}"
`.trim();

    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      console.error("Error in handleGeneralQuery:", error);
      return "Lo siento, no puedo responder a eso ahora.";
    }
  }

  async handleImageQuery(message, databaseId, imageFiles, options = {}, memory = { summary: "", messages: [] }) {
    const hasText = typeof message === "string" && message.trim().length > 0;
    const historyText = this.formatHistory(memory.messages);
    let instruction;

    if (hasText) {
      instruction = `
You are an expert in Occupational Health and Safety (SSOMA).
Analyze the provided image in the context of the user's question.
Follow the user's instructions as the highest priority and use the image as the main source of information.
Answer in the same language as the user's message.
Be tolerant of synonyms and minor spelling mistakes. If the question is too ambiguous or unreadable, ask the user to clarify what they need from the image.
`.trim();
    } else {
      instruction = `
You are an expert in Occupational Health and Safety (SSOMA).
Analyze the provided image in detail and at least describe:
1) The activity the person or people are performing.
2) The visible PPE (personal protective equipment), listing each element.
3) The present risks and sources of harm.
4) Any substandard acts or conditions you observe.
5) Concrete recommendations to improve safety.
When later text messages are provided about this image, answer in the same language as those messages.
Be tolerant of synonyms and minor spelling mistakes in later questions about this image.
`.trim();
    }

    if (memory.summary && memory.summary.trim().length > 0) {
      instruction += `

Previous conversation summary:
${memory.summary.trim()}`;
    }

    if (historyText && historyText.trim().length > 0) {
      instruction += `

Recent conversation history. Connect it with what appears in the image when relevant:
${historyText.trim()}`;
    }

    if (hasText) {
      instruction += `

Current user question about the image:
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
          console.error("Could not obtain buffer from image file.");
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
        console.error("Error reading image file:", error);
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
      console.error("Error in handleImageQuery:", error);
      return "Lo siento, hubo un problema al analizar la imagen.";
    }
  }

  async handleDocumentQuery(message, databaseId, documentFiles, options = {}, memory = { summary: "", messages: [] }) {
    const hasText = typeof message === "string" && message.trim().length > 0;
    const historyText = this.formatHistory(memory.messages);
    let instruction;

    if (hasText) {
      instruction = `
You are an expert assistant in Occupational Health and Safety (SSOMA) and in the analysis of business reports and documents.
You will receive one or more attached documents.
Use the actual content of the documents as the main source of truth to answer the user's question.
If the question refers to calculations, payroll amounts, totals or indicators, explain step by step how those values are obtained from the information in the document.
Answer in the same language as the user's message.
Be tolerant of synonyms and minor spelling mistakes; only if the question is too ambiguous or unreadable should you ask the user to restate it, indicating the sheet, column or section they are referring to.
`.trim();
    } else {
      instruction = `
You are an expert assistant in Occupational Health and Safety (SSOMA) and in the analysis of business reports and documents.
Analyze the attached document in detail and provide at least:
1) A general summary of the content.
2) The most important data, tables or metrics.
3) Any inconsistencies or issues that deserve attention.
4) If there are numerical calculations (for example payroll, indicators, costs), explain in simple terms how those results are obtained.
When later text messages are provided about this document, answer in the same language as those messages.
Be tolerant of synonyms and minor spelling mistakes in later questions about this document.
`.trim();
    }

    if (memory.summary && memory.summary.trim().length > 0) {
      instruction += `

Previous conversation summary:
${memory.summary.trim()}`;
    }

    if (historyText && historyText.trim().length > 0) {
      instruction += `

Recent conversation history. Connect it with what appears in the document when relevant:
${historyText.trim()}`;
    }

    if (hasText) {
      instruction += `

Current user question related to the document:
"${message}"
`.trim();
    }

    const parts = [{ text: instruction }];
    const newDocs = [];

    for (const file of documentFiles) {
      try {
        let buffer = null;
        if (file.buffer && Buffer.isBuffer(file.buffer)) {
          buffer = file.buffer;
        } else if (file.path) {
          buffer = await fs.promises.readFile(file.path);
        }
        if (!buffer) {
          console.error("Could not obtain buffer from document file.");
          continue;
        }

        const name = (file.originalname || file.filename || file.name || "").toLowerCase();
        const mimeTypeRaw = (file.mimetype || file.type || "").toLowerCase();
        const isExcel =
          name.endsWith(".xlsx") ||
          name.endsWith(".xls") ||
          mimeTypeRaw === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
          mimeTypeRaw === "application/vnd.ms-excel";

        if (isExcel) {
          try {
            const xlsxModule = await import("xlsx");
            const xlsxLib = xlsxModule.default || xlsxModule;
            const workbook = xlsxLib.read(buffer, { type: "buffer" });
            const sheetNames = workbook.SheetNames || [];
            let combined = "";
            const maxSheets = 3;
            const maxRowsPerSheet = 200;

            for (let i = 0; i < sheetNames.length && i < maxSheets; i++) {
              const sheetName = sheetNames[i];
              const sheet = workbook.Sheets[sheetName];
              if (!sheet) {
                continue;
              }
              const rows = xlsxLib.utils.sheet_to_json(sheet, { header: 1, raw: false });
              combined += `Sheet "${sheetName}" (first rows):\n`;
              let rowCount = 0;
              for (const row of rows) {
                const cells = Array.isArray(row) ? row : [];
                const line = cells
                  .map(v => (v === undefined || v === null ? "" : String(v)))
                  .join(" | ");
                if (line.trim().length === 0) {
                  continue;
                }
                combined += line + "\n";
                rowCount++;
                if (rowCount >= maxRowsPerSheet) {
                  break;
                }
              }
              combined += "\n";
            }

            if (combined.trim().length > 0) {
              parts.push({ text: combined });
              newDocs.push({
                id: this.createDocId(),
                name: file.originalname || file.filename || file.name || "Excel document",
                mimeType: mimeTypeRaw || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                kind: "text",
                text: combined,
                createdAt: Date.now()
              });
            }
            continue;
          } catch (error) {
            console.error("Error processing Excel file:", error);
          }
        }

        const base64 = buffer.toString("base64");
        const mimeType = file.mimetype || file.type || "application/pdf";
        parts.push({
          inlineData: {
            data: base64,
            mimeType
          }
        });
        newDocs.push({
          id: this.createDocId(),
          name: file.originalname || file.filename || file.name || "Document",
          mimeType,
          kind: "inlineData",
          data: base64,
          createdAt: Date.now()
        });
      } catch (error) {
        console.error("Error reading document file:", error);
      }
    }

    if (parts.length === 1) {
      return "No fue posible leer el documento adjunto. Intenta subirlo nuevamente o envíalo en formato PDF, TXT, CSV, JSON o Excel (XLSX/XLS).";
    }

    if (options.threadId && newDocs.length > 0) {
      const existing = this.documentsByThread.get(options.threadId);
      const base = Array.isArray(existing) ? existing : [];
      const merged = base.concat(newDocs);
      const maxDocsStored = 5;
      const trimmed = merged.slice(Math.max(0, merged.length - maxDocsStored));
      this.documentsByThread.set(options.threadId, trimmed);
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
      console.log("[Chat][DocResultText]", text);
      if (typeof text === "string" && text.trim().length > 0) {
        return text;
      }
      return "El documento se procesó correctamente, pero no recibí una explicación de salida.";
    } catch (error) {
      console.error("Error in handleDocumentQuery:", error);
      return "Lo siento, hubo un problema al analizar el documento adjunto.";
    }
  }

  async handleDocFollowUpQuery(message, databaseId, docs, memory = { summary: "", messages: [] }) {
    const historyText = this.formatHistory(memory.messages);
    let instruction = `
You are an expert assistant in Occupational Health and Safety (SSOMA) and in the analysis of business reports and documents.
The user has already provided one or more documents earlier in this same conversation.
Use the information from those documents as the main source of truth to answer this new question.
If the question refers to calculations, payroll amounts, totals or indicators, explain step by step how those values are obtained from the data in the documents.
If there is more than one document, pick the one that contains the most relevant information for the question. If the question is too ambiguous, ask the user to indicate the document name, sheet or column they mean.
Answer in the same language as the user's message.
Be tolerant of synonyms and minor spelling mistakes; only if the question is too ambiguous or unreadable should you explicitly ask the user to clarify or point to the specific part of the document they care about.
`.trim();

    const names = docs.map(d => d.name).filter(Boolean);
    if (names.length > 0) {
      instruction += `

Documents available in this conversation:
${names.map(n => `- ${n}`).join("\n")}`;
    }

    if (memory.summary && memory.summary.trim().length > 0) {
      instruction += `

Previous conversation summary:
${memory.summary.trim()}`;
    }

    if (historyText && historyText.trim().length > 0) {
      instruction += `

Recent conversation history:
${historyText.trim()}`;
    }

    instruction += `

New user question about the documents:
"${message}"
`.trim();

    const parts = [{ text: instruction }];
    const docParts = this.buildDocPartsFromMemory(docs);
    if (docParts.length === 0) {
      return await this.handleGeneralQuery(message, memory);
    }
    for (const p of docParts) {
      parts.push(p);
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
      const text = result.response.text();
      console.log("[Chat][DocFollowUpResultText]", text);
      if (typeof text === "string" && text.trim().length > 0) {
        return text;
      }
      return "No pude utilizar correctamente los documentos anteriores para responder a esta pregunta. Indica el nombre del documento o la hoja a la que te refieres.";
    } catch (error) {
      console.error("Error in handleDocFollowUpQuery:", error);
      return "Lo siento, hubo un problema al usar los documentos anteriores para responder tu pregunta.";
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
You are an assistant that summarizes conversations between a user and a SSOMA virtual assistant.
Create a short summary that keeps:
- The overall goal of the user.
- The modules, tables or areas of the Kaizen system that have been mentioned.
- Important decisions or answers that were given.
- Any relevant details about the user's way of asking that might matter later.
You do not need to preserve the original language verbatim in the summary; just capture the intent.

Conversation to summarize:
${olderText}
`.trim();
    try {
      const result = await model.generateContent(summaryPrompt);
      const summaryText = (result.response.text() || "").trim();
      return { summary: summaryText, messages: recent };
    } catch (error) {
      console.error("Error generating conversation summary:", error);
      return { summary: "", messages: trimmed.slice(trimmed.length - maxRecent) };
    }
  }

  buildFallbackSql(message, databaseId) {
    if (!databaseId) {
      return null;
    }
    const text = (message || "").toLowerCase();
    const safeDb = databaseId.replace(/[^a-zA-Z0-9_]/g, "");
    const mentionsPeople = /(persona|personas|colaborador|colaboradores|empleado|empleados|trabajador|trabajadores|people|employee|employees|worker|workers)/.test(
      text
    );
    const asksCount = /(cu[aá]ntas|cu[aá]ntos|n[uú]mero|cantidad|how many|how much|number of)/.test(text);
    const mentionsInactive = /desactivad|inactiv|inactive|disabled/.test(text);
    const mentionsActive = /activas?|activos?|active/.test(text);

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
