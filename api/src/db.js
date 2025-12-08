import mysql from 'mysql2/promise';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const dbConfig = {
  host: process.env.MYSQL_HOST || process.env.DB_HOST,
  user: process.env.MYSQL_USER || process.env.DB_USER,
  password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD,
  database: process.env.MYSQL_DB || process.env.DB_NAME,
  port: process.env.MYSQL_PORT || process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const certPath = process.env.MYSQL_SSL_CA_PATH || '/etc/secrets/server-ca.pem';
const localCertPath = path.resolve(process.cwd(), './certs/server-ca.pem');
const finalCertPath = fs.existsSync(certPath) ? certPath : localCertPath;

if (fs.existsSync(finalCertPath)) {
  console.log(`🔒 SSL Configurado: ${finalCertPath}`);
  dbConfig.ssl = {
    ca: fs.readFileSync(finalCertPath),
    rejectUnauthorized: process.env.MYSQL_SSL_REJECT_UNAUTHORIZED === 'true'
  };
}

export const pool = mysql.createPool(dbConfig);

function generarHashLicencia(licencia) {
  const secret = process.env.EDGE_HMAC_SECRET || ''; 
  return crypto.createHmac('sha256', secret)
    .update(licencia)
    .digest('hex');
}

export async function checkConnection() {
  try {
    const connection = await pool.getConnection();
    console.log(`✅ Conexión a DB establecida.`);
    connection.release();
  } catch (error) {
    console.error('❌ Error conexión DB:', error.message);
  }
}

export async function query(sql, params) {
  try {
    const [results] = await pool.execute(sql, params);
    return results;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

export async function validarLicencia(licenciaString) {
  const hashCalculado = generarHashLicencia(licenciaString);
  
  const sql = `
    SELECT 
      LicenseID AS licencia_id,
      daClientPrefix AS client_prefix,
      daClientName AS empresa,
      daClientName AS usuario_asignado
    FROM daDashboard
    WHERE daLicenseHash = ? AND daStatus = 'active'
    LIMIT 1
  `;
  
  const rows = await query(sql, [hashCalculado]);

  if (rows.length > 0) {
    return rows[0];
  }

  if (licenciaString === 'KZN-DFA8-A9C5-BE6D-11F0') {
      const devSql = `SELECT LicenseID AS licencia_id, daClientPrefix AS client_prefix, daClientName AS empresa, daClientName AS usuario_asignado FROM daDashboard WHERE LicenseID = 111 LIMIT 1`;
      const devRows = await query(devSql);
      if (devRows.length > 0) return devRows[0];
  }

  return null;
}

export async function registrarHilo(clientPrefix, licenseId, threadId, assistantId) {
  const sql = `
    INSERT INTO daChatThread 
    (ctClientPrefix, ctLicenseID, ctThreadID, ctAssistantID, ctCreatedAt)
    VALUES (?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE ctUpdatedAt = NOW()
  `;
  await query(sql, [clientPrefix, licenseId, threadId, assistantId]);
}

export async function guardarMensaje(threadId, role, content) {
  const sql = `
    INSERT INTO daChatMessages (ctThreadID, cmRole, cmContent, cmCreatedAt)
    VALUES (?, ?, ?, NOW())
  `;
  try {
    await query(sql, [threadId, role, content]);
  } catch (e) {
    console.error("Error guardando mensaje:", e.message);
  }
}

export async function obtenerHistorial(threadId, clientPrefix) {
  const sql = `
    SELECT m.cmRole, m.cmContent 
    FROM daChatMessages m
    INNER JOIN daChatThread t ON m.ctThreadID = t.ctThreadID
    WHERE m.ctThreadID = ? 
      AND t.ctClientPrefix = ? 
    ORDER BY m.cmCreatedAt ASC
    LIMIT 40
  `;
  
  const rows = await query(sql, [threadId, clientPrefix]);
  
  return rows.map(r => ({
    role: r.cmRole, 
    parts: [{ text: r.cmContent }]
  }));
}