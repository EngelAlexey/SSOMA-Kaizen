import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
import { randomUUID } from 'crypto';
import 'dotenv/config';
import { validarLicencia, registrarHilo, query } from '../db.js';

const LICENCIA_DEV = 'KZN-DFA8-A9C5-BE6D-11F0';

const DB_SCHEMA = `
ESQUEMA DE BASE DE DATOS (SOLO LECTURA):
- rhStaff: ID, StaffCode, FirstName, LastName, Department, Position, Status
- rhClockV: ClockID, StaffID, DateTime, Type (IN/OUT), DeviceID
- rhAttendances: ID, StaffID, Date, CheckIn, CheckOut, WorkedHours
- rhActions: ActionID, StaffID, Type (Vacation/Medical), StartDate, EndDate
- rhAdjustments: AdjID, StaffID, Amount, Reason, Date
- daDashboard: Información del cliente y licencia
- daChatThread: Historial de conversaciones
`;

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

const tools = [
  {
    functionDeclarations: [
      {
        name: "consultar_base_datos",
        description: "Ejecuta una consulta SQL SELECT para obtener datos. ESTRICTAMENTE SOLO LECTURA.",
        parameters: {
          type: "OBJECT",
          properties: {
            sql_query: {
              type: "STRING",
              description: "Consulta SQL SELECT. Ejemplo: SELECT * FROM rhStaff WHERE Status='Active'"
            }
          },
          required: ["sql_query"]
        }
      }
    ]
  }
];

export async function handleChatQuery(req, res) {
  const filesToDelete = [];
  let { text, license, projectId, threadId } = req.body;

  const licenciaActual = license || LICENCIA_DEV;
  let contextoCliente = "";
  let clientPrefix = null;
  let isNewThread = !threadId;
  
  if (!threadId) threadId = randomUUID();

  try {
    const datosLicencia = await validarLicencia(licenciaActual);
    
    if (datosLicencia) {
      clientPrefix = datosLicencia.client_prefix;
      
      if (isNewThread) {
          try {
              await registrarHilo(clientPrefix, datosLicencia.licencia_id, threadId, 'SSOMA-AI');
          } catch (errDB) {}
      }

      contextoCliente = `
[CONTEXTO DE SEGURIDAD Y DATOS]
- Cliente: ${datosLicencia.empresa}
- Prefijo DB: "${clientPrefix}"
- Usuario ID: ${datosLicencia.licencia_id}
`;
    } else {
      return res.status(401).json({ success: false, error: "ACCESO DENEGADO" });
    }
  } catch (dbError) {
    return res.status(500).json({ error: "Error de seguridad en base de datos." });
  }

  try {
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
      } catch (e) {}
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
          
          REGLAS CRÍTICAS DE BASE DE DATOS:
          1. TU ACCESO ES ESTRICTAMENTE DE SOLO LECTURA (SELECT).
          2. ESTÁ PROHIBIDO EJECUTAR SENTENCIAS UPDATE, DELETE, INSERT, DROP O ALTER.
          3. Si el usuario solicita modificar, eliminar o crear datos (ej: "Borra la asistencia", "Cambia la hora", "Crea un empleado"), DEBES RECHAZAR LA SOLICITUD explicando que no tienes permisos de escritura.
          4. Solo usa 'consultar_base_datos' para responder preguntas informativas.

          ESQUEMA DISPONIBLE:
          ${DB_SCHEMA}
          
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
    let contextStr = `${contextoCliente}\n${text || "Analiza lo siguiente:"}`;
    
    if (projectId) contextStr += `\n[Proyecto ID: ${projectId}]`;
    if (faceResults.length > 0) contextStr += `\n[Personal Identificado: ${JSON.stringify(faceResults)}]`;
    
    parts.push({ text: contextStr });

    for (const file of validFiles) {
      const buffer = fs.readFileSync(file.path);
      
      if (file.mimetype.includes('spreadsheet') || file.mimetype.includes('excel') || file.mimetype.includes('word') || file.originalname.endsWith('.xlsx')) {
          return res.json({ 
              success: false, 
              reply: "No pude analizar el archivo Excel (.xlsx)." 
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
    
    const chat = model.startChat({ tools: tools });

    let result = await chat.sendMessage(parts);
    let response = await result.response;
    let functionCalls = response.functionCalls();

    while (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0];
        
        if (call.name === "consultar_base_datos") {
            const sql = call.args.sql_query || "";
            
            if (!sql.trim().toUpperCase().startsWith('SELECT')) {
                const securityMsg = "ERROR DE SEGURIDAD: Solo se permiten consultas SELECT. UPDATE/DELETE/INSERT están bloqueados.";
                result = await chat.sendMessage([{
                    functionResponse: { name: "consultar_base_datos", response: { result: securityMsg } }
                }]);
            } else {
                try {
                    const dbRows = await query(sql);
                    const dbResult = JSON.stringify(dbRows).substring(0, 15000);
                    
                    result = await chat.sendMessage([{
                        functionResponse: { name: "consultar_base_datos", response: { result: dbResult } }
                    }]);
                } catch (err) {
                    result = await chat.sendMessage([{
                        functionResponse: { name: "consultar_base_datos", response: { error: err.message } }
                    }]);
                }
            }
        }
        response = await result.response;
        functionCalls = response.functionCalls();
    }

    const reply = response.candidates?.[0]?.content?.parts?.[0]?.text || "Sin respuesta.";

    res.json({
      success: true,
      reply,
      threadId,
      clientPrefix,
      tokensUsed: response.usageMetadata?.totalTokenCount || 0
    });

  } catch (error) {
    console.error('Error:', error.message);
    
    let userMessage = "Ocurrió un error interno en el servidor.";
    if (error.message.includes('400') || error.message.includes('INVALID_ARGUMENT')) {
       userMessage = "Error de formato en los archivos adjuntos.";
    }

    res.status(500).json({ success: false, error: 'ai_error', message: userMessage });
  } finally {
    setTimeout(() => {
      filesToDelete.forEach(p => safeDelete(p));
    }, 1000);
  }
}