import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
import 'dotenv/config';

const MANUAL_KAIZEN = `
MATRIZ DE USO KAIZEN (CONFIDENCIAL):
1. PERMISOS: Inicio > Permisos > +Agregar. Define roles y nivel de acceso (Contribuir/Administrar).
2. EMPRESAS: Inicio > Empresas. Registra Clientes, Proveedores y Contratistas.
3. HORARIOS: Inicio > Horarios. Configura jornadas (Diurna/Mixta/Nocturna) y tolerancias de entrada.
4. PROYECTOS: Inicio > Proyectos. Vincula ubicación GPS y horario base.
5. USUARIOS: Inicio > Usuarios. Crea accesos web con correo Google y asigna roles.
6. PARÁMETROS: Inicio > Parámetros. Actualiza % CCSS y tramos de Renta anualmente.
7. CENTROS DE COSTOS: Inicio > Centros Costos. Para distribución contable.
8. PUESTOS: Inicio > Puestos. Define si es Operativo (Hora) o Administrativo (Mes) y factores de extras.
9. PERSONAL: Registro 360°. Foto biométrica, contratos PDF y generación de QR.
10. RELOJ APP: Ingreso con licencia. Métodos: QR (Campo), Marca Rápida (Oficina), Terminal (Historial).
11. ASISTENCIAS: Procesa marcas. Si editas horas manualmente, PRESIONA 'RECALC' obligatoriamente.
12. ACCIONES PERSONAL: Registra incapacidades, vacaciones y permisos. Afecta planilla.
13. AJUSTES: Préstamos (Cobrar) o Bonos (Pagar).
14. PLANILLAS: Cálculo final. Crear > Resumen > Recalc (si hubo cambios) > Enviar.
15. COMPROBANTES: Envío de colillas de pago por correo/WhatsApp.
`;

const REGLAMENTO_SSOMA = `
PRINCIPIOS DE SEGURIDAD (CRITERIO TÉCNICO):
- ALTURAS: Trabajo sobre 1.8m requiere arnés y línea de vida anclada.
- EXCAVACIONES: Zanjas >1.5m requieren entibado o talud escalonado.
- EPP BÁSICO: Casco, chaleco reflectivo y botas de seguridad son obligatorios en obra.
- ELÉCTRICO: Todo tablero debe tener tapa y señalización de riesgo.
- ANDAMIOS: Deben tener bases niveladas, barandas y accesos seguros.
`;

const PROJECT_ID = process.env.PROJECT_ID || 'causal-binder-459316-v6';
const LOCATION = process.env.LOCATION || 'us-central1';
const MODEL_ID = 'gemini-1.5-flash-002';

const vertex_ai = new VertexAI({ project: PROJECT_ID, location: LOCATION });

const generativeModel = vertex_ai.preview.getGenerativeModel({
  model: MODEL_ID,
  systemInstruction: {
    parts: [{ text: `
      Eres SSOMA-Kaizen, un auditor experto en seguridad (Costa Rica) y soporte técnico de la app Kaizen.
      
      TU CONOCIMIENTO BASE:
      --- MANUAL APP ---
      ${MANUAL_KAIZEN}
      --- REGLAMENTO ---
      ${REGLAMENTO_SSOMA}
      
      PROTOCOLOS:
      1. Si ves una IMAGEN: Analiza riesgos (EPP, Alturas, Orden) según el Reglamento.
      2. Si preguntan por la APP: Guía paso a paso citando la ruta (Inicio > Módulo).
      3. Si preguntas por PERSONAL: Usa los datos del reconocimiento facial si están disponibles.
      4. AUDITORÍA DOCUMENTAL: Si recibes archivos (PDF/Excel/CSV), analiza cálculos y busca inconsistencias.
      5. SEGURIDAD: Si detectas riesgo grave, inicia con "⚠️ ALERTA DE SEGURIDAD".
    `}]
  },
  generationConfig: {
    maxOutputTokens: 2048,
    temperature: 0.2,
  },
  safetySettings: [
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
  ]
});

const FACE_API_URL = process.env.FACE_API_URL || 'https://facerecognition-kgjd.onrender.com';
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

async function validateFileSecurity(filePath, mimeType) {
  const buffer = fs.readFileSync(filePath);
  
  const signatures = {
    'image/jpeg': [0xFF, 0xD8, 0xFF],
    'image/png': [0x89, 0x50, 0x4E, 0x47],
    'application/pdf': [0x25, 0x50, 0x44, 0x46], 
    'application/zip': [0x50, 0x4B, 0x03, 0x04] 
  };

  const header = buffer.subarray(0, 4);
  let isValidSignature = false;

  if (signatures[mimeType]) {
    isValidSignature = signatures[mimeType].every((byte, index) => header[index] === byte);
  } else if (mimeType.includes('text') || mimeType.includes('json') || mimeType.includes('csv') || mimeType.includes('spreadsheet')) {
    isValidSignature = true; 
  }

  if (!isValidSignature) {
    throw new Error(`SECURITY_ALERT: El archivo dice ser ${mimeType} pero su firma digital no coincide. Posible ejecutable oculto.`);
  }

  if (mimeType.includes('text') || mimeType.includes('json') || mimeType.includes('csv')) {
    const content = buffer.toString('utf-8').toLowerCase();
    const dangerousPatterns = [
      '<script', 'javascript:', 'vbscript:', 'powershell', 'cmd.exe', '/bin/sh', 
      'eval(', 'exec(', 'system(', 'base64_decode', 'shell_exec',
      'ignore all previous instructions', 'olvida todas las instrucciones'
    ];

    const foundThreat = dangerousPatterns.find(pattern => content.includes(pattern));
    if (foundThreat) {
      throw new Error(`SECURITY_ALERT: Contenido malicioso o inyección de prompt detectada: "${foundThreat}".`);
    }
  }

  return true;
}

export async function handleChatQuery(req, res) {
  const tempPaths = [];
  
  try {
    const { text, projectId } = req.body || {};
    
    const uploads = [];
    if (Array.isArray(req.body?.files)) {
      for (const f of req.body.files) {
        if (!f?.base64) continue;
        const ext = path.extname(f.filename || '') || '.jpg';
        const tmpPath = path.join(UPLOAD_DIR, `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
        fs.writeFileSync(tmpPath, Buffer.from(f.base64, 'base64'));
        tempPaths.push(tmpPath);
        uploads.push({ filename: f.filename, path: tmpPath, mimetype: f.mimetype || 'image/jpeg' });
      }
    }
    
    if (Array.isArray(req.files)) {
      req.files.forEach(f => {
        tempPaths.push(f.path);
        uploads.push(f);
      });
    }

    const validFiles = [];
    for (const file of uploads) {
      try {
        await validateFileSecurity(file.path, file.mimetype);
        validFiles.push(file);
      } catch (securityError) {
        console.error(`❌ ARCHIVO BLOQUEADO (${file.filename}):`, securityError.message);
      }
    }

    let faceResults = [];
    if (validFiles.length > 0 && FACE_API_URL) {
      for (const file of validFiles) {
        if (!file.mimetype.startsWith('image/')) continue;
        
        const formData = new FormData();
        formData.append('file', fs.createReadStream(file.path));
        try {
          const faceRes = await axios.post(`${FACE_API_URL}/identify_staff_from_image`, formData, {
            headers: formData.getHeaders(),
            timeout: 10000
          });
          if (faceRes.data && !faceRes.data.error) {
             faceResults.push({ file: file.filename, ...faceRes.data });
          }
        } catch (err) {}
      }
    }

    const parts = [];
    
    let promptFinal = text || "Analiza los documentos o imágenes adjuntos.";
    if (faceResults.length > 0) {
      promptFinal += `\n\n[SISTEMA]: Personal identificado: ${JSON.stringify(faceResults)}.`;
    }
    if (projectId) promptFinal += `\nProyecto ID: ${projectId}`;

    parts.push({ text: promptFinal });

    for (const file of validFiles) {
      const fileBuffer = fs.readFileSync(file.path);
      
      const isTextBased = file.mimetype.includes('text') || file.mimetype.includes('json') || file.mimetype.includes('csv');
      
      if (isTextBased) {
        const textContent = fileBuffer.toString('utf-8');
        parts.push({ text: `\n--- CONTENIDO ARCHIVO: ${file.filename} ---\n${textContent}\n--- FIN ARCHIVO ---\n` });
      } else {
        parts.push({
          inlineData: {
            mimeType: file.mimetype,
            data: fileBuffer.toString('base64')
          }
        });
      }
    }

    if (parts.length === 0) {
        return res.json({ success: false, message: "No se pudo procesar la solicitud por falta de contenido válido." });
    }

    const result = await generativeModel.generateContent({
      contents: [{ role: 'user', parts: parts }]
    });

    const response = await result.response;
    const reply = response.candidates[0].content.parts[0].text;

    tempPaths.forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {} });

    return res.json({
      success: true,
      reply: reply,
      message: reply,
      faceResults,
      tokensUsed: response.usageMetadata?.totalTokenCount || 0
    });

  } catch (error) {
    tempPaths.forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {} });

    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: error.message || 'Error procesando la solicitud con IA.'
    });
  }
}