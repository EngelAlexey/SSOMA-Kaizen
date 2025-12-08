import { query } from "./db.js";

/**
 * Asegura que exista un registro de hilo en daChatThread
 * y lo asocia a un prefijo (cliente) y a una "licencia" (ID string de usuario/licencia).
 */
export async function ensureChatThread(
  databaseId,
  threadId,
  licenseId = null,
  assistantId = null
) {
  if (!databaseId || !threadId) return;

  // Aquí licenseId es STRING (UUID, código, etc.). Ya no lo convertimos a número.
  const sql = `
    INSERT INTO daChatThread (ctClientPrefix, ctLicenseID, ctThreadID, ctAssistantID)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      ctClientPrefix = VALUES(ctClientPrefix),
      ctLicenseID   = VALUES(ctLicenseID),
      ctAssistantID = VALUES(ctAssistantID)
  `;
  const params = [databaseId, licenseId, threadId, assistantId];

  try {
    await query(sql, params);
  } catch (error) {
    console.error("Error asegurando hilo de chat:", error);
  }
}

/**
 * Guarda un mensaje (user/model) en daChatMessages.
 * Antes de insertar, se asegura que el hilo exista.
 */
export async function saveChatMessage(
  threadId,
  databaseId,
  role,
  content,
  licenseId = null,
  assistantId = null
) {
  if (!threadId || !databaseId) return;
  if (!content || typeof content !== "string") return;

  const normalizedRole =
    role === "model" || role === "assistant" ? "model" : "user";

  try {
    await ensureChatThread(databaseId, threadId, licenseId, assistantId);
  } catch (error) {
    console.error("Error asegurando hilo antes de guardar mensaje:", error);
  }

  const sql = `
    INSERT INTO daChatMessages (ctThreadID, cmRole, cmContent, cmCreatedAt)
    VALUES (?, ?, ?, NOW())
  `;
  const params = [threadId, normalizedRole, content];

  try {
    await query(sql, params);
  } catch (error) {
    console.error("Error guardando mensaje de chat:", error);
  }
}

/**
 * Devuelve el historial de un hilo como lo espera ChatFlow:
 * [{ role: 'user'|'model', parts: [{ text: '...' }] }, ...]
 */
export async function getChatHistory(threadId, databaseId, limit = 40) {
  if (!threadId || !databaseId) return [];

  const numericLimit = Number(limit);
  const finalLimit =
    Number.isFinite(numericLimit) && numericLimit > 0
      ? Math.floor(numericLimit)
      : 40;

  const sql = `
    SELECT m.cmRole, m.cmContent
    FROM daChatMessages m
    INNER JOIN daChatThread t ON m.ctThreadID = t.ctThreadID
    WHERE m.ctThreadID = ? AND t.ctClientPrefix = ?
    ORDER BY m.cmCreatedAt ASC
    LIMIT ${finalLimit}
  `;
  const params = [threadId, databaseId];

  try {
    const rows = await query(sql, params);
    if (!Array.isArray(rows)) return [];

    return rows.map((row) => ({
      role:
        row.cmRole === "model" || row.cmRole === "assistant"
          ? "model"
          : "user",
      parts: [{ text: String(row.cmContent || "") }]
    }));
  } catch (error) {
    console.error("Error obteniendo historial de chat:", error);
    return [];
  }
}

/**
 * Devuelve el dueño de un hilo (licenseId + prefijo).
 * Útil para validar acceso a un threadId.
 */
export async function getThreadOwner(threadId) {
  if (!threadId) return null;

  const sql = `
    SELECT ctLicenseID, ctClientPrefix
    FROM daChatThread
    WHERE ctThreadID = ?
    LIMIT 1
  `;

  try {
    const rows = await query(sql, [threadId]);
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0];
  } catch (error) {
    console.error("Error obteniendo dueño del hilo:", error);
    return null;
  }
}

/**
 * (Para futuro multi-dispositivo) Listar hilos del usuario/licencia.
 * licenseId es STRING (mismo formato que guardas en ctLicenseID).
 */
export async function getUserThreads(licenseId, clientPrefix, limit = 50) {
  if (!licenseId || !clientPrefix) return [];

  const numericLimit = Number(limit);
  const finalLimit =
    Number.isFinite(numericLimit) && numericLimit > 0
      ? Math.floor(numericLimit)
      : 50;

  const sql = `
    SELECT 
      t.ctThreadID,
      t.ctAssistantID,
      t.ctCreatedAt,
      (
        SELECT cmContent
        FROM daChatMessages m
        WHERE m.ctThreadID = t.ctThreadID AND m.cmRole = 'user'
        ORDER BY m.cmCreatedAt ASC
        LIMIT 1
      ) AS firstMessage,
      (
        SELECT MAX(m2.cmCreatedAt)
        FROM daChatMessages m2
        WHERE m2.ctThreadID = t.ctThreadID
      ) AS lastActivity
    FROM daChatThread t
    WHERE t.ctLicenseID = ? AND t.ctClientPrefix = ?
    ORDER BY lastActivity DESC, t.ctCreatedAt DESC
    LIMIT ${finalLimit}
  `;

  try {
    const rows = await query(sql, [licenseId, clientPrefix]);
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.error("Error obteniendo hilos del usuario:", error);
    return [];
  }
}

/**
 * (Para futuro multi-dispositivo) Mensajes de un hilo validando dueño.
 * licenseId es STRING igual que ctLicenseID.
 */
export async function getThreadMessages(
  threadId,
  licenseId,
  clientPrefix,
  limit = 200
) {
  if (!threadId || !licenseId || !clientPrefix) return [];

  const numericLimit = Number(limit);
  const finalLimit =
    Number.isFinite(numericLimit) && numericLimit > 0
      ? Math.floor(numericLimit)
      : 200;

  const sql = `
    SELECT m.cmRole, m.cmContent, m.cmCreatedAt
    FROM daChatMessages m
    INNER JOIN daChatThread t ON m.ctThreadID = t.ctThreadID
    WHERE m.ctThreadID = ?
      AND t.ctLicenseID = ?
      AND t.ctClientPrefix = ?
    ORDER BY m.cmCreatedAt ASC
    LIMIT ${finalLimit}
  `;

  try {
    const rows = await query(sql, [threadId, licenseId, clientPrefix]);
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.error("Error obteniendo mensajes del hilo:", error);
    return [];
  }
}
