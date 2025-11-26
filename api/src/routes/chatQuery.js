import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
import 'dotenv/config';

// --- BASE DE CONOCIMIENTO ---
const MANUAL_KAIZEN = `
[RESUMEN MANUAL KAIZEN]
1. SEGURIDAD (Permisos, Roles). 2. EMPRESAS (Clientes, Contratistas). 3. HORARIOS (Jornadas, Tolerancias).
4. PROYECTOS (Ubicación, Configuración). 5. USUARIOS (Accesos web). 6. PARÁMETROS (CCSS, Renta).
7. CENTROS COSTOS (Contabilidad). 8. PUESTOS (Salarios, Factores). 9. PERSONAL (Expedientes, Contratos).
10. RELOJ (Marcas QR/Facial). 11. ASISTENCIAS (Cálculo horas). 12. ACCIONES (Incapacidades, Vacaciones).
13. AJUSTES (Deducciones/Bonos). 14. PLANILLAS (Pago, Recalc). 15. COMPROBANTES (Envío).
`;

const REGLAMENTO_SSOMA = `
[NORMATIVA SSOMA CR]
- Alturas >1.8m: Arnés obligatorio. - Zanjas >1.5m: Entibado.
- EPP: Casco, Botas, Chaleco. - Electricidad: Bloqueo/Etiquetado.
`;

// --- CONFIGURACIÓN ---
const PROJECT_ID = process.env.PROJECT_ID || 'causal-binder-459316-v6';
const LOCATION = process.env.LOCATION || 'us-central1';
const MODEL_ID = 'gemini-1.5-flash-001'; // Modelo estable para documentos
const FACE_API_URL = process.env.FACE_API_URL;
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const safeDelete = (filePath) => {
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
};

// --- VALIDACIÓN DE SEGURIDAD MEJORADA ---
async function validateFileSecurity(filePath, mimeType) {
  const buffer = fs.readFileSync(filePath);
  
  // Firmas digitales (Magic Numbers)
  const signatures = {
    'image/jpeg': [0xFF, 0xD8, 0xFF],
    'image/png': [0x89, 0x50, 0x4E, 0x47],
    'application/pdf': [0x25, 0x50, 0x44, 0x46],
    // DOCX y XLSX son archivos ZIP en realidad (Empiezan con PK..)
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [0x50, 0x4B, 0x03, 0x04],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [0x50, 0x4B, 0x03, 0x04]
  };

  const header = buffer.subarray(0, 4);
  
  // 1. Validar Firma
  if (signatures[mimeType]) {
    const isValid = signatures[mimeType].every((byte, index) => header[index] === byte);
    if (!isValid) throw new Error(`Firma de archivo corrupta o falsa para ${mimeType}`);
  }

  // 2. Validar Contenido Malicioso en Texto
  if (mimeType.match(/text|json|csv/)) {
    const content = buffer.toString('utf-8').toLowerCase();
    if (content.match(/<script|eval\(|exec\(|powershell|cmd\.exe/)) {
        throw new Error("Código malicioso detectado en archivo de texto.");
    }
  }
  return true;
}

export async function handleChatQuery(req, res) {
  const filesToDelete = [];

  try {
    const { text, projectId } = req.body || {};
    const uploads = [];
    
    // Procesar archivos entrantes
    const rawFiles = [].concat(req.files || []).concat(req.body.files || []);
    
    // Manejo unificado de archivos (Multer y Base64)
    for (const f of rawFiles) {
      let filePath, mime, originalName;
      
      if (f.path) { // Viene de Multer
        filePath = f.path;
        mime = f.mimetype;
        originalName = f.originalname;
      } else if (f.base64) { // Viene de Base64
        const ext = f.filename ? path.extname(f.filename) : '.bin';
        filePath = path.join(UPLOAD_DIR, `b64-${Date.now()}-${Math.random().toString(36).substr(2,9)}${ext}`);
        fs.writeFileSync(filePath, Buffer.from(f.base64, 'base64'));
        mime = f.mimetype || 'application/octet-stream';
        originalName = f.filename || 'archivo';
      }

      if (filePath) {
        uploads.push({ path: filePath, mimetype: mime, originalname: originalName });
        filesToDelete.push(filePath);
      }
    }

    // Validar Seguridad
    const validFiles = [];
    for (const file of uploads) {
      try {
        await validateFileSecurity(file.path, file.mimetype);
        validFiles.push(file);
      } catch (e) {
        console.error(`❌ Archivo rechazado (${file.originalname}): ${e.message}`);
      }
    }

    // Reconocimiento Facial (Solo imágenes)
    let faceResults = [];
    if (validFiles.length > 0 && FACE_API_URL) {
      const images = validFiles.filter(f => f.mimetype.startsWith('image/'));
      for (const img of images) {
        try {
          const stream = fs.createReadStream(img.path);
          const formData = new FormData();
          formData.append('file', stream);
          const resp = await axios.post(`${FACE_API_URL}/identify_staff_from_image`, formData, { 
            headers: formData.getHeaders(), timeout: 5000 
          });
          if (!resp.data.error) faceResults.push({ file: img.originalname, ...resp.data });
        } catch (e) {}
      }
    }

    // --- PREPARAR CEREBRO VERTEX AI ---
    const vertex_ai = new VertexAI({ project: PROJECT_ID, location: LOCATION });
    const model = vertex_ai.getGenerativeModel({
      model: MODEL_ID,
      systemInstruction: {
        parts: [{ text: `
          ERES SSOMA-KAIZEN (Auditor y Soporte Técnico).
          
          TU MISIÓN:
          1. FILTRO DE CONTENIDO (IMPORTANTE):
             Antes de responder, analiza el contenido del archivo adjunto o la pregunta.
             - ¿Es sobre Recursos Humanos, Planillas, Leyes Laborales? -> PROCESAR.
             - ¿Es sobre Seguridad (SSOMA), Construcción, Riesgos? -> PROCESAR.
             - ¿Es sobre el uso de la plataforma Kaizen? -> PROCESAR.
             - ¿Es otro tema (Cocina, Deportes, Poesía, Tareas escolares)? -> RECHAZAR.
             
             SI EL CONTENIDO NO ES PERTINENTE, RESPONDE ÚNICAMENTE:
             "⚠️ CONTENIDO NO VÁLIDO: El archivo o consulta no está relacionado con la gestión de RH, Seguridad Ocupacional o la plataforma Kaizen."

          2. AUDITORÍA DOCUMENTAL:
             Si el archivo es válido (ej. una planilla excel, un reporte docx), búscalo errores, inconsistencias o cálculos mal hechos según el Manual.

          [CONTEXTO APP]
          ${MANUAL_KAIZEN}
          
          [REGLAMENTO SSOMA]
          ${REGLAMENTO_SSOMA}
        `}]
      },
      generationConfig: { maxOutputTokens: 2048, temperature: 0.2 },
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
      ]
    });

    // Construir Prompt Multimodal
    const parts = [];
    const promptText = text || "Analiza los archivos adjuntos bajo los criterios de auditoría.";
    parts.push({ text: `Consulta: ${promptText}\nDatos Faciales: ${JSON.stringify(faceResults)}` });

    for (const file of validFiles) {
      const buffer = fs.readFileSync(file.path);
      const isText = file.mimetype.match(/text|json|csv/);
      
      if (isText) {
        parts.push({ text: `\n--- ARCHIVO (${file.originalname}) ---\n${buffer.toString('utf-8')}\n--- FIN ---\n` });
      } else {
        // Para PDF, DOCX, XLSX, Imágenes -> Enviamos como Inline Data
        parts.push({
          inlineData: {
            mimeType: file.mimetype,
            data: buffer.toString('base64')
          }
        });
      }
    }

    console.log(`🤖 Enviando a Gemini (${validFiles.length} archivos)...`);
    
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: parts }]
    });

    const response = await result.response;
    const reply = response.candidates?.[0]?.content?.parts?.[0]?.text || "Sin respuesta de la IA.";

    res.json({ success: true, reply, faceResults });

  } catch (error) {
    console.error('🔥 Error:', error.message);
    res.status(500).json({ success: false, error: 'server_error', message: error.message });
  } finally {
    setTimeout(() => {
      filesToDelete.forEach(p => safeDelete(p));
    }, 1000);
  }
}