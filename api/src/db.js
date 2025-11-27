import mysql from 'mysql2/promise';
import 'dotenv/config';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

export async function query(sql, params) {
    try {
        const [results, ] = await pool.execute(sql, params);
        console.log("Database query executed successfully.");
        return results; 
    } catch (error) {
        console.error("Database query error:", error);
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