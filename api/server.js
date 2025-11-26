import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { handleChatQuery } from './src/routes/chatQuery.js';

console.clear();
console.log('🚀 INICIANDO SERVIDOR SSOMA-KAIZEN (Soporte Multiformato)...');

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath || !fs.existsSync(path.resolve(keyPath))) {
  console.error('❌ ERROR FATAL: Credenciales de Google no encontradas.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    // Limpiamos el nombre para evitar caracteres raros
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
    const unique = `${Date.now()}-${Math.round(Math.random() * 1E9)}-${safeName}`;
    cb(null, unique);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // Aumentado a 20MB para documentos grandes
  fileFilter: (_, file, cb) => {
    const allowedTypes = [
      // Imágenes
      'image/jpeg', 'image/png', 'image/webp',
      // Documentos Portables
      'application/pdf',
      // Texto y Datos
      'text/csv', 'text/plain', 'application/json',
      // Microsoft Office (Word / Excel)
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',      // .xlsx
      'application/vnd.ms-excel'                                                // .xls
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('INVALID_FILE_TYPE'));
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'online', service: 'SSOMA-Kaizen API 2.0', ai_model: 'Gemini 1.5 Flash' });
});

app.post('/chat/query', upload.array('files'), handleChatQuery);

app.use((err, req, res, next) => {
  console.error('🔥 Error:', err.message);
  const status = err.message === 'INVALID_FILE_TYPE' ? 400 : 500;
  res.status(status).json({ success: false, error: err.message });
});

app.listen(PORT, () => {
  console.log(`\n✅ SERVIDOR LISTO EN: http://localhost:${PORT}`);
}); 