import express from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

import { handleChatQuery } from './src/routes/chatQuery.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const MAX_UPLOAD_SIZE_MB = parseInt(process.env.MAX_UPLOAD_SIZE_MB || '10', 10);
const MAX_UPLOAD_FILES = parseInt(process.env.MAX_UPLOAD_FILES || '5', 10);

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

app.use(cors());
app.use(express.json({ limit: `${MAX_UPLOAD_SIZE_MB}mb` }));
app.use(express.urlencoded({ extended: true, limit: `${MAX_UPLOAD_SIZE_MB}mb` }));

// Configuración de Multer
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const unique = `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
    cb(null, unique);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    files: MAX_UPLOAD_FILES
  },
  fileFilter: (_, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg'];
    if (!allowed.includes(file.mimetype)) {
      const err = new Error('invalid_file_type');
      err.code = 'INVALID_FILE_TYPE';
      return cb(err);
    }
    cb(null, true);
  }
});

// Endpoint principal del chat con análisis de imagen y reconocimiento facial
app.post('/chat/query', upload.array('files'), handleChatQuery);

// Middleware de errores global
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE' || err.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'payload_too_large',
      message: 'El archivo es demasiado grande. Intenta con una imagen más ligera o comprimida.'
    });
  }
  if (err.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({ error: 'invalid_file_type', message: 'Solo se permiten imágenes JPG o PNG.' });
  }
  console.error('Error no controlado:', err);
  return res.status(500).json({ error: 'server_error', message: 'Ocurrió un error inesperado en el servidor.' });
});

app.listen(PORT, () => console.log(`Servidor SSOMA-Kaizen ejecutándose en puerto ${PORT}`));