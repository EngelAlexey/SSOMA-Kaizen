import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
import 'dotenv/config';

const MANUAL_KAIZEN = `
MATRIZ DE USO KAIZEN:
1. PERMISOS: Inicio > Permisos > +Agregar. Niveles: Contribuir/Administrar.
2. EMPRESAS: Inicio > Empresas > +Agregar. Clientes/Proveedores.
3. HORARIOS: Inicio > Horarios. Modalidad Semanal/Bisemanal. Configurar tolerancias.
4. PROYECTOS: Inicio > Proyectos. Vincular GPS.
5. USUARIOS: Inicio > Usuarios. Correo Google.
6. PARÁMETROS: Configuración anual CCSS/Renta.
7. CENTROS DE COSTOS: Distribución contable.
8. PUESTOS: Operativo/Administrativo. Salarios y factores extras.
9. PERSONAL: Expediente 360, Contratos, Fotos.
10. RELOJ APP: Licencia dispositivo. Marcas QR o Faciales.
11. ASISTENCIAS: Registro marcas. Botón RECALC obligatorio al editar.
12. ACCIONES PERSONAL: Incapacidades, Vacaciones.
13. AJUSTES: Préstamos/Bonos.
14. PLANILLAS: Crear > Resumen > Recalc > Enviar.
15. COMPROBANTES: Envío por email/whatsapp.
`;

const REGLAMENTO_SSOMA = `
NORMATIVA SSOMA CR:
- Alturas: >1.8m requiere arnés.
- Excavaciones: >1.5m requiere entibado.
- EPP: Casco, botas, chaleco, gafas (Art 81).
- Riesgo Eléctrico: Bloqueo y etiquetado.
`;

const PROJECT_ID = process.env.PROJECT_ID || 'causal-binder-459316-v6';
const LOCATION = process.env.LOCATION || 'us-central1';
const MODEL_ID = 'gemini-2.0-flash-001';

const FACE_API_URL = process.env.FACE_API_URL;
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const safeDelete = (filePath) => {
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
};

async function validateFileSecurity(filePath, mimeType) {
  const buffer = fs.readFileSync(filePath);
  
  const signatures = {
    'image/jpeg': [0xFF, 0xD8, 0xFF],
    'image/png': [0x89, 0x50, 0x4E, 0x47],
    'application/pdf': [0x25, 0x50, 0x44, 0x46],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [0x50, 0x4B, 0x03, 0x04],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [0x50, 0x4B, 0x03, 0x04]
  };

  const header = buffer.subarray(0, 4);
  if (signatures[mimeType]) {
    if (!signatures[mimeType].every((byte, index) => header[index] === byte)) {
        throw new Error(`Firma digital inválida para ${mimeType}`);
    }
  }

  if (mimeType.match(/text|json|csv/)) {
    const content = buffer.toString('utf-8').toLowerCase();
    const dangerous = ['<script', 'eval(', 'exec(', 'powershell', 'cmd.exe', 'system('];
    if (dangerous.some(cmd => content.includes(cmd))) {
        throw new Error("Contenido malicioso detectado");
    }
  }
  return true;
}

export async function handleChatQuery(req, res) {
  const filesToDelete = [];

  try {
    const { text, projectId } = req.body || {};
    const uploads = [];
    
    if (req.files && req.files.length > 0) {
      req.files.forEach(f => {
        uploads.push(f);
        filesToDelete.push(f.path);
      });
    }
    
    if (req.body.files && Array.isArray(req.body.files)) {
      for (const f of req.body.files) {
        if (f.base64) {
          const ext = f.filename ? path.extname(f.filename) : '.bin';
          const tmpPath = path.join(UPLOAD_DIR, `b64-${Date.now()}-${Math.random()}${ext}`);
          fs.writeFileSync(tmpPath, Buffer.from(f.base64, 'base64'));
          uploads.push({ 
            path: tmpPath, 
            mimetype: f.mimetype || 'application/octet-stream', 
            originalname: f.filename || 'archivo' 
          });
          filesToDelete.push(tmpPath);
        }
      }
    }

    const validFiles = [];
    for (const file of uploads) {
      try {
        await validateFileSecurity(file.path, file.mimetype);
        validFiles.push(file);
      } catch (e) {
        console.error(`Archivo rechazado: ${file.originalname} - ${e.message}`);
      }
    }

    let faceResults = [];
    if (validFiles.length > 0 && FACE_API_URL) {
      const images = validFiles.filter(f => f.mimetype.startsWith('image/'));
      for (const img of images) {
        try {
          const stream = fs.createReadStream(img.path);
          const formData = new FormData();
          formData.append('file', stream);
          const resp = await axios.post(`${FACE_API_URL}/identify_staff_from_image`, formData, { 
            headers: formData.getHeaders(), timeout: 6000 
          });
          if (!resp.data.error) faceResults.push({ file: img.originalname, ...resp.data });
          stream.destroy();
        } catch (e) {}
      }
    }

    const vertex_ai = new VertexAI({ project: PROJECT_ID, location: LOCATION });
    const model = vertex_ai.preview.getGenerativeModel({
      model: MODEL_ID,
      systemInstruction: {
        parts: [{ text: `
          ERES SSOMA-KAIZEN.
          
          TUS OBJETIVOS:
          1. FILTRO DE CONTENIDO (GATEKEEPER):
             - Analiza el contenido del texto y los archivos adjuntos.
             - TEMAS PERMITIDOS: Recursos Humanos, Planillas, Leyes Laborales CR, Seguridad Ocupacional (SSOMA), Construcción, Plataforma Kaizen.
             - SI EL CONTENIDO NO ES PERTINENTE (Ej: Cocina, Deportes, Tareas escolares, Código ajeno):
               Responde ÚNICAMENTE: "⚠️ CONTENIDO NO PERMITIDO: El archivo o consulta no está relacionado con la gestión de SSOMA, RRHH o Kaizen." y detén el análisis.

          2. ANÁLISIS TÉCNICO:
             - Si es DOC/PDF/EXCEL: Realiza una auditoría buscando errores de cálculo, inconsistencias con el reglamento o el manual.
             - Si es FOTO: Busca riesgos de seguridad según normativa.
             - Si es PREGUNTA APP: Guía con rutas exactas del manual.

          [MANUAL KAIZEN]
          ${MANUAL_KAIZEN}
          
          [NORMATIVA]
          ${REGLAMENTO_SSOMA}
        `}]
      },
      generationConfig: { maxOutputTokens: 2048, temperature: 0.1 },
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
      ]
    });

    const parts = [];
    const promptText = text || "Analiza los archivos adjuntos bajo criterio de auditoría.";
    
    let contextStr = `Consulta: ${promptText}`;
    if (projectId) contextStr += `\nProyecto: ${projectId}`;
    if (faceResults.length > 0) contextStr += `\nPersonal: ${JSON.stringify(faceResults)}`;

    parts.push({ text: contextStr });

    for (const file of validFiles) {
      const buffer = fs.readFileSync(file.path);
      const isText = file.mimetype.match(/text|json|csv/);
      
      if (isText) {
        parts.push({ text: `\n--- ARCHIVO: ${file.originalname} ---\n${buffer.toString('utf-8')}\n--- FIN ---\n` });
      } else {
        parts.push({
          inlineData: {
            mimeType: file.mimetype,
            data: buffer.toString('base64')
          }
        });
      }
    }

    if (parts.length === 0 && !text) {
       return res.json({ success: false, reply: "No se recibieron datos válidos para procesar." });
    }

    console.log(`🤖 Enviando a Gemini 2.0 (${validFiles.length} archivos)...`);
    
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: parts }]
    });

    const response = await result.response;
    const reply = response.candidates?.[0]?.content?.parts?.[0]?.text || "Sin respuesta.";

    res.json({
      success: true,
      reply,
      faceResults,
      tokensUsed: response.usageMetadata?.totalTokenCount || 0
    });

  } catch (error) {
    console.error('🔥 Error:', error.message);
    res.status(500).json({ success: false, error: 'server_error', message: error.message });
  } finally {
    setTimeout(() => {
      filesToDelete.forEach(p => safeDelete(p));
    }, 1000);
  }
}