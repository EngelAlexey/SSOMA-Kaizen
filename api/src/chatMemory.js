import { query } from "./db.js";

export async function ensureChatThread(databaseId, threadId, licenseId = null, assistantId = null) {
  if (!databaseId || !threadId) {
    return;
  }
  const sql = `
    INSERT INTO daChatThread (ctClientPrefix, ctLicenseID, ctThreadID, ctAssistantID)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      ctClientPrefix = VALUES(ctClientPrefix)
  `;
  const params = [databaseId, licenseId, threadId, assistantId];
  try {
    await query(sql, params);
  } catch (error) {
    console.error("Error asegurando hilo de chat:", error);
  }
}

export async function getChatHistory(threadId, databaseId, limit = 40) {
  if (!threadId || !databaseId) {
    return [];
  }
  const numericLimit = Number(limit);
  const finalLimit = Number.isFinite(numericLimit) && numericLimit > 0 ? Math.floor(numericLimit) : 40;
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
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows.map(row => {
      const role = row.cmRole || row.cm_role || row.role || "user";
      const content = row.cmContent || row.cm_content || row.content || "";
      return { role, content };
    });
  } catch (error) {
    console.error("Error cargando historial de chat:", error);
    return [];
  }
}

export async function saveChatMessage(threadId, databaseId, role, content, licenseId = null, assistantId = null) {
  if (!threadId || !databaseId || !role || !content) {
    return;
  }

  let normalizedRole = String(role).toLowerCase();
  if (normalizedRole === "assistant") {
    normalizedRole = "model";
  }
  if (normalizedRole !== "user" && normalizedRole !== "model") {
    normalizedRole = "user";
  }

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
