import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { handleChatQuery } from './src/routes/chatQuery.js';

console.clear();
console.log('🚀 INICIANDO SERVIDOR SSOMA-KAIZEN...');

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) {
  console.error('❌ ERROR FATAL: No definiste GOOGLE_APPLICATION_CREDENTIALS en el archivo .env');
  process.exit(1);
}

const absoluteKeyPath = path.resolve(keyPath);
if (!fs.existsSync(absoluteKeyPath)) {
  console.error(`❌ ERROR FATAL: El archivo de credenciales NO existe en: ${absoluteKeyPath}`);
  process.exit(1);
} else {
  console.log(`✅ Credenciales encontradas: ${path.basename(keyPath)}`);
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
    const unique = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, unique);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/webp',
      'application/pdf',
      'text/csv', 'text/plain',
      'application/json',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('INVALID_FILE_TYPE'));
  }
});

app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'SSOMA-Kaizen API', 
    ai_model: 'Gemini 1.5 Flash',
    time: new Date().toISOString()
  });
});

app.post('/chat/query', upload.array('files'), handleChatQuery);

app.use((err, req, res, next) => {
  console.error('🔥 Error del Servidor:', err.message);
  
  if (err.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({ error: 'Tipo de archivo no permitido.' });
  }
  
  res.status(500).json({ 
    success: false, 
    error: 'server_error', 
    message: err.message 
  });
});

app.listen(PORT, () => {
  console.log(`\n✅ SERVIDOR LISTO EN: http://localhost:${PORT}`);
  console.log(`📡 Endpoint de Chat: http://localhost:${PORT}/chat/query`);
});