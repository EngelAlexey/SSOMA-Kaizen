import mysql from 'mysql2/promise';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

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

const certPath = process.env.MYSQL_SSL_CA_PATH || './certs/server-ca.pem';
const absoluteCertPath = path.resolve(process.cwd(), certPath);

if (fs.existsSync(absoluteCertPath)) {
  console.log(`🔒 SSL Configurado: ${absoluteCertPath}`);
  dbConfig.ssl = {
    ca: fs.readFileSync(absoluteCertPath),
    rejectUnauthorized: process.env.MYSQL_SSL_REJECT_UNAUTHORIZED === 'true'
  };
}

const pool = mysql.createPool(dbConfig);

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

export async function validarLicencia(licencia) {
  const sql = `
    SELECT 
      l.id AS licencia_id,
      c.prefix AS client_prefix,
      c.nombre AS empresa,
      u.nombre AS usuario_asignado
    FROM licencias l
    JOIN clientes c ON l.cliente_id = c.id
    LEFT JOIN usuarios u ON l.usuario_id = u.id
    WHERE l.codigo = ? AND l.estado = 'ACTIVA'
  `;
  
  const rows = await query(sql, [licencia]);
  return rows.length > 0 ? rows[0] : null;
}

export async function registrarHilo(clientPrefix, licenseId, threadId, assistantId) {
  const sql = `
    INSERT INTO daChatThread 
    (ctClientPrefix, ctLicenseID, ctThreadID, ctAssistantID, ctCreatedAt)
    VALUES (?, ?, ?, ?, NOW())
  `;
  await query(sql, [clientPrefix, licenseId, threadId, assistantId]);
}