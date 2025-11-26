import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
import 'dotenv/config';

const MANUAL_KAIZEN = `
MATRIZ DE USO KAIZEN (RESUMEN TÉCNICO):
1. PERMISOS: Inicio > Permisos > +Agregar. Niveles: Contribuir/Administrar.
2. EMPRESAS: Inicio > Empresas. Registro de terceros.
3. HORARIOS: Inicio > Horarios. Configurar tolerancias de entrada/salida.
4. PROYECTOS: Inicio > Proyectos. Vincular ubicación GPS.
5. USUARIOS: Inicio > Usuarios. Acceso con correo Google.
6. PARÁMETROS: Configuración global (CCSS, Renta).
7. CENTROS DE COSTOS: Distribución contable.
8. PUESTOS: Clasificación Operativo/Administrativo.
9. PERSONAL: Expediente, Foto, Contratos.
10. RELOJ APP: Licencia, Marcas QR/Facial.
11. ASISTENCIAS: Revisión. Botón 'RECALC' obligatorio al editar.
12. ACCIONES PERSONAL: Incapacidades, Vacaciones.
13. AJUSTES: Préstamos, Bonos.
14. PLANILLAS: Crear > Resumen > Recalc > Enviar.
15. COMPROBANTES: Envío automático.
`;

const REGLAMENTO_SSOMA = `
NORMATIVA SEGURIDAD (CR):
- Alturas >1.8m: Arnés y línea de vida.
- Zanjas >1.5m: Entibado o talud.
- EPP: Casco, botas, chaleco, gafas (Art 81).
- Andamios: Bases firmes y barandas.
- Electricidad: Bloqueo y etiquetado.
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
        if (!mimeType.includes('openxmlformats')) {
        }
    }
  }

  if (mimeType.match(/text|json|csv/)) {
    const content = buffer.toString('utf-8').toLowerCase();
    if (content.match(/<script|eval\(|exec\(|powershell|cmd\.exe/)) {
        throw new Error("Contenido sospechoso detectado.");
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
      req.files.forEach(f => { uploads.push(f); filesToDelete.push(f.path); });
    }
    
    if (req.body.files && Array.isArray(req.body.files)) {
      for (const f of req.body.files) {
        if (f.base64) {
          const ext = f.filename ? path.extname(f.filename) : '.bin';
          const tmpPath = path.join(UPLOAD_DIR, `b64-${Date.now()}-${Math.random()}${ext}`);
          fs.writeFileSync(tmpPath, Buffer.from(f.base64, 'base64'));
          uploads.push({ 
            path: tmpPath, mimetype: f.mimetype || 'application/octet-stream', originalname: f.filename || 'file' 
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
        console.error(`Archivo bloqueado: ${file.originalname}`);
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
            headers: formData.getHeaders(), timeout: 5000 
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
          
          OBJETIVO: Asistir en Seguridad Ocupacional, RRHH y uso de la App Kaizen.
          
          REGLAS DE CONTENIDO:
          - Sé flexible y útil. Si la consulta es general sobre trabajo o seguridad, respóndela.
          - SOLO rechaza temas explícitamente ajenos como cocina, videojuegos, chistes o política.
          - Mensaje de rechazo: "Tema fuera de alcance: Solo puedo asistir en SSOMA, RRHH o Kaizen."

          CAPACIDADES:
          - Auditoría: Revisa documentos (PDF/CSV) buscando errores numéricos o legales.
          - Visión: Analiza fotos de obra para detectar riesgos.
          
          [MANUAL KAIZEN]
          ${MANUAL_KAIZEN}
          
          [NORMATIVA SSOMA]
          ${REGLAMENTO_SSOMA}
        `}]
      },
      generationConfig: { maxOutputTokens: 2048, temperature: 0.2 },
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
      ]
    });

    const parts = [];
    let contextStr = text || "Analiza el contenido adjunto.";
    if (projectId) contextStr += `\n[Proyecto: ${projectId}]`;
    if (faceResults.length > 0) contextStr += `\n[Personal Identificado: ${JSON.stringify(faceResults)}]`;
    
    parts.push({ text: contextStr });

    for (const file of validFiles) {
      const buffer = fs.readFileSync(file.path);
      
      if (file.mimetype.includes('spreadsheet') || file.mimetype.includes('excel') || file.mimetype.includes('word') || file.originalname.endsWith('.xlsx')) {
          return res.json({ 
              success: false, 
              reply: "No pude analizar el archivo Excel (.xlsx). El modelo actual no soporta este formato directamente. Por favor, guarda tu planilla como PDF o CSV y súbela de nuevo." 
          });
      }
      
      if (file.mimetype.match(/text|json|csv|xml/)) {
        parts.push({ text: `\n--- ARCHIVO: ${file.originalname} ---\n${buffer.toString('utf-8')}\n--- FIN ---\n` });
      } 
      else if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
        parts.push({
          inlineData: {
            mimeType: file.mimetype,
            data: buffer.toString('base64')
          }
        });
      }
    }

    if (parts.length === 0 && !text) return res.json({ success: false, reply: "No hay datos para procesar." });

    console.log(`Enviando a Gemini 2.0 (${validFiles.length} archivos)...`);
    
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
    console.error('Error:', error.message);
    
    let userMessage = "Ocurrió un error interno en el servidor.";
    
    if (error.message.includes('400') || error.message.includes('INVALID_ARGUMENT')) {
       userMessage = "Error de formato: Uno de los archivos adjuntos no es compatible o está corrupto. Intenta subir solo PDF o Imágenes.";
    }

    res.status(500).json({ success: false, error: 'ai_error', message: userMessage });
  } finally {
    setTimeout(() => {
      filesToDelete.forEach(p => safeDelete(p));
    }, 1000);
  }
}