import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
import 'dotenv/config';

const MANUAL_KAIZEN = `
MATRIZ DE USO KAIZEN:
1. PERMISOS: Inicio > Permisos > +Agregar. 1. Título. 2. Accesos: Agregar módulo uno por uno. Definir nivel: Contribuir o Administrar. 3. PII Visible. 4. Estado: Habilitado.
2. EMPRESAS: Inicio > Empresas > +Agregar. 1. Categoría: Cliente, Proveedor o Contratista. 2. Datos: Razón Social e ID Legal. 3. Representante.
3. HORARIOS: Paso 1: Inicio > Horarios > +Agregar. Definir Modalidad. Paso 2: En Horario Diario, agregar día por día con Hora Entrada/Salida. Paso 3: Configurar Rango entrada desde/hasta.
4. PROYECTOS: Inicio > Proyectos > +Agregar. 1. Datos: Nombre, Código, GPS. 2. Horario: Seleccionar el horario base.
5. USUARIOS: Inicio > Usuarios > +Agregar. 1. Datos: Correo Google, Nombre. 2. Tipo: Estándar o Admin. 3. Acceso: Asignar Permiso.
6. PARÁMETROS: Inicio > Parámetros. 1. CCSS: Actualizar porcentajes. 2. Renta: Actualizar tramos.
7. CENTROS DE COSTOS: Inicio > Centros de Costos > +Agregar. Definir Nombre y Código. Asociar a Proyectos.
8. PUESTOS: Inicio > Puestos > +Agregar. 1. Tipo: Operativo o Administrativo. 2. Salario Base. 3. Códigos INS/CCSS.
9. PERSONAL: Paso 1: +Agregar. Llenar Personal, Contacto, Contrato. Paso 2: Foto biométrica. Paso 3: Generar Contrato PDF/QR. Paso 4: Activar Acceso.
10. RELOJ APP: Ingreso: Digitar Licencia. Marcar QR: Escanear carnet. Marca Rápida: Seleccionar nombre. Reloj Terminal: Ver historial.
11. ASISTENCIAS: Automático por Reloj o Manual (+Agregar). Edición: Si se corrigen horas, presionar RECALC.
12. ACCIONES PERSONAL: Inicio > Acciones de personal > +Agregar. Tipo: Incapacidad, Vacaciones. Fechas.
13. AJUSTES: Inicio > Ajustes > +Agregar. Tipo: Cuenta por Cobrar o Pagar. Método: Monto o Horas.
14. PLANILLAS: Paso 1: Crear (Periodo). Paso 2: Resumen. Paso 3: Recalc (si hubo cambios). Paso 4: Enviar.
15. COMPROBANTES: Inicio > Comprobantes > +Agregar. Seleccionar Planilla. Enviar.
`;

const REGLAMENTO_SSOMA = `
NORMATIVA SEGURIDAD:
- Alturas: Arnés y línea de vida a partir de 1.8m.
- Zanjas: Entibado si profundidad > 1.5m.
- EPP Básico: Casco, chaleco, botas.
- Art 81: Gafas obligatorias contra impactos/radiación.
`;

const PROJECT_ID = process.env.PROJECT_ID || 'causal-binder-459316-v6';
const LOCATION = process.env.LOCATION || 'us-central1';
const MODEL_ID = 'gemini-2.0-flash-001';

const vertex_ai = new VertexAI({ project: PROJECT_ID, location: LOCATION });

const generativeModel = vertex_ai.preview.getGenerativeModel({
  model: MODEL_ID,
  systemInstruction: {
    parts: [{ text: `
      Eres SSOMA-Kaizen.
      
      [MANUAL KAIZEN]
      ${MANUAL_KAIZEN}
      
      [REGLAMENTO]
      ${REGLAMENTO_SSOMA}
      
      INSTRUCCIONES:
      1. App: Cita ruta del manual.
      2. Seguridad: Cita reglamento.
      3. Auditoría: Revisa documentos adjuntos buscando errores.
      4. Alerta: Inicia con "⚠️ PELIGRO" si hay riesgo vital.
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

const FACE_API_URL = process.env.FACE_API_URL;
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

async function validateFileSecurity(filePath, mimeType) {
  const buffer = fs.readFileSync(filePath);
  
  const signatures = {
    'image/jpeg': [0xFF, 0xD8, 0xFF],
    'image/png': [0x89, 0x50, 0x4E, 0x47],
    'application/pdf': [0x25, 0x50, 0x44, 0x46]
  };

  const header = buffer.subarray(0, 4);
  if (signatures[mimeType]) {
    if (!signatures[mimeType].every((byte, index) => header[index] === byte)) {
        throw new Error(`Firma digital inválida para ${mimeType}`);
    }
  }

  if (mimeType.match(/text|json|csv/)) {
    const content = buffer.toString('utf-8').toLowerCase();
    if (content.match(/<script|eval\(|exec\(|powershell|cmd\.exe/)) {
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
          const ext = f.filename ? path.extname(f.filename) : '.jpg';
          const tmpPath = path.join(UPLOAD_DIR, `b64-${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`);
          fs.writeFileSync(tmpPath, Buffer.from(f.base64, 'base64'));
          uploads.push({ 
            path: tmpPath, 
            mimetype: f.mimetype || 'image/jpeg', 
            originalname: f.filename || 'file' 
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
        console.error(`Archivo rechazado: ${file.originalname}`);
      }
    }

    let faceResults = [];
    if (validFiles.length > 0 && FACE_API_URL) {
      const imageFiles = validFiles.filter(f => f.mimetype.startsWith('image/'));
      for (const file of imageFiles) {
        try {
          const stream = fs.createReadStream(file.path);
          const formData = new FormData();
          formData.append('file', stream);
          const faceRes = await axios.post(`${FACE_API_URL}/identify_staff_from_image`, formData, {
            headers: formData.getHeaders(),
            timeout: 8000 
          });
          if (faceRes.data && !faceRes.data.error) {
             faceResults.push({ file: file.originalname, ...faceRes.data });
          }
          stream.destroy(); 
        } catch (err) {}
      }
    }

    const parts = [];
    let promptFinal = text || "Analiza el contenido adjunto.";
    
    if (projectId) promptFinal += ` [Proyecto: ${projectId}]`;
    if (faceResults.length > 0) promptFinal += ` [Personal: ${JSON.stringify(faceResults)}]`;

    parts.push({ text: promptFinal });

    for (const file of validFiles) {
      const fileBuffer = fs.readFileSync(file.path);
      const isText = file.mimetype.match(/text|json|csv|xml/);
      const isPDF = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');

      if (isText) {
        parts.push({ text: `\n[ARCHIVO: ${file.originalname}]\n${fileBuffer.toString('utf-8')}\n[FIN ARCHIVO]\n` });
      } else {
        const mimeToSend = isPDF ? 'application/pdf' : file.mimetype;
        parts.push({
          inlineData: {
            mimeType: mimeToSend,
            data: fileBuffer.toString('base64')
          }
        });
      }
    }

    const result = await generativeModel.generateContent({
      contents: [{ role: 'user', parts: parts }]
    });

    const response = await result.response;
    const reply = response.candidates?.[0]?.content?.parts?.[0]?.text || "Sin respuesta.";

    res.json({
      success: true,
      reply: reply,
      message: reply,
      faceResults,
      tokensUsed: response.usageMetadata?.totalTokenCount || 0
    });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: error.message
    });
  } finally {
    setTimeout(() => {
      filesToDelete.forEach(p => {
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {}
      });
    }, 1000); 
  }
}