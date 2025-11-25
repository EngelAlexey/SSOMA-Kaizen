// ==========================================
// 1. CONFIGURACIÓN INICIAL (CRÍTICO: ESTO VA PRIMERO)
// ==========================================
import 'dotenv/config'; // Carga variables de .env inmediatamente
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { handleChatQuery } from './src/routes/chatQuery.js';

// ==========================================
// 2. DIAGNÓSTICO DE ARRANQUE (Mejora Profesional)
// ==========================================
console.clear();
console.log('🚀 INICIANDO SERVIDOR SSOMA-KAIZEN...');

// Verificación de Credenciales de Google
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) {
  console.error('❌ ERROR FATAL: No definiste GOOGLE_APPLICATION_CREDENTIALS en el archivo .env');
  process.exit(1);
}

const absoluteKeyPath = path.resolve(keyPath);
if (!fs.existsSync(absoluteKeyPath)) {
  console.error(`❌ ERROR FATAL: El archivo de credenciales NO existe en: ${absoluteKeyPath}`);
  console.log('📂 Archivos en carpeta actual:', fs.readdirSync(process.cwd()));
  process.exit(1);
} else {
  console.log(`✅ Credenciales encontradas: ${path.basename(keyPath)}`);
}

// ==========================================
// 3. CONFIGURACIÓN DE EXPRESS
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

// Crear carpeta uploads si no existe
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Aumentado para imágenes HD
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Configuración de Multer (Carga de archivos)
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, unique);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_, file, cb) => {
    // LISTA DE ARCHIVOS PERMITIDOS
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/webp', // Imágenes
      'application/pdf',                       // PDFs (Planillas, Reportes)
      'text/csv', 'text/plain',                // Datos crudos
      'application/json',                      // Datos estructurados
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // Excel .xlsx
      'application/vnd.ms-excel'               // Excel .xls
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      return cb(null, true);
    }
    
    // Si no es ninguno, error
    cb(new Error('INVALID_FILE_TYPE'));
  }
});

// ==========================================
// 4. RUTAS
// ==========================================

// Ruta de "Health Check" (Para probar que el servidor vive)
app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'SSOMA-Kaizen API', 
    ai_model: 'Gemini 1.5 Flash',
    time: new Date().toISOString()
  });
});

// Endpoint del Chat (Tu cerebro IA)
app.post('/chat/query', upload.array('files'), handleChatQuery);

// Middleware de manejo de errores global
app.use((err, req, res, next) => {
  console.error('🔥 Error del Servidor:', err.message);
  
  if (err.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({ error: 'Solo se permiten imágenes.' });
  }
  
  res.status(500).json({ 
    success: false, 
    error: 'server_error', 
    message: err.message 
  });
});

// Iniciar Servidor
app.listen(PORT, () => {
  console.log(`\n✅ SERVIDOR LISTO EN: http://localhost:${PORT}`);
  console.log(`📡 Endpoint de Chat: http://localhost:${PORT}/chat/query`);
  console.log('--------------------------------------------------\n');
});