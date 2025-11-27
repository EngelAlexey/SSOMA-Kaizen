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

1. rhStaff (Tabla MAESTRA de Personal):
   - StaffID, stCode, stName (Nombre), stFirstsurname (1er Apellido), stSecondsurname (2do Apellido).
   - stStatus (BIT: 1 = Activo, 0 = Inactivo). IMPORTANTE: Para contar activos usar 'WHERE stStatus = 1'.
   - stEmail, stPhone, JobpositionID, CompanyID.
   - stIncome (Fecha Ingreso), stDeparture (Fecha Salida).

2. rhClockV (Marcajes/Reloj):
   - ClockID, StaffID, ckTimestamp (Fecha/Hora), ckType (Entrada/Salida).

3. rhAttendances (Asistencias Calculadas):
   - AttendanceID, atDate, StaffID, atHours (Horas trabajadas).

4. daDashboard (Clientes/Licencias):
   - LicenseID, daClientPrefix, daClientName.

5. daChatThread (Historial):
   - ctID, ctThreadID.
`;

const MANUAL_KAIZEN = `
MATRIZ DE USO KAIZEN (RESUMEN TÉCNICO):
1. PERMISOS: Inicio > Permisos > +Agregar.
2. EMPRESAS: Inicio > Empresas.
3. HORARIOS: Inicio > Horarios.
4. PROYECTOS: Inicio > Proyectos.
5. USUARIOS: Inicio > Usuarios.
6. PERSONAL: Expediente, Foto, Contratos.
`;

const REGLAMENTO_SSOMA = `
NORMATIVA SEGURIDAD (CR):
- Alturas >1.8m: Arnés y línea de vida.
- EPP: Casco, botas, chaleco, gafas.
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
  if (mimeType.match(/text|json|csv/)) {
    const content = buffer.toString('utf-8').toLowerCase();
    if (content.match(/<script|eval\(|exec\(|powershell|cmd\.exe/)) {
        throw new Error("Contenido sospechoso detectado.");
    }
  }
  return true;
}

// Definición de Herramientas más estricta
const tools = [
  {
    functionDeclarations: [
      {
        name: "consultar_base_datos",
        description: "HERRAMIENTA OBLIGATORIA para saber CUALQUIER dato numérico, lista de nombres, estado o conteo. Si el usuario pregunta 'cuántos', 'quiénes', 'lista', 'hay', DEBES ejecutar esta función.",
        parameters: {
          type: "OBJECT",
          properties: {
            sql_query: {
              type: "STRING",
              description: "Consulta SQL SELECT válida. Ej: SELECT COUNT(*) as total FROM rhStaff WHERE stStatus = 1"
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
          } catch (errDB) {
             // Ignoramos error de duplicado si ocurre, para no detener el flujo
          }
      }

      contextoCliente = `
[CONTEXTO DE SEGURIDAD]
- Cliente: ${datosLicencia.empresa}
- Prefijo DB: "${clientPrefix}"
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
          uploads.push({ path: tmpPath, mimetype: f.mimetype || 'application/octet-stream', originalname: f.filename || 'file' });
          filesToDelete.push(tmpPath);
        }
      }
    }

    const validFiles = [];
    for (const file of uploads) {
      try { await validateFileSecurity(file.path, file.mimetype); validFiles.push(file); } catch (e) {}
    }

    // Lógica facial (omitida por brevedad, se mantiene igual) ...
    let faceResults = [];

    const vertex_ai = new VertexAI({ project: PROJECT_ID, location: LOCATION });
    const model = vertex_ai.preview.getGenerativeModel({
      model: MODEL_ID,
      systemInstruction: {
        parts: [{ text: `
          ERES SSOMA-KAIZEN.
          
          ¡REGLA DE ORO - CERO ALUCINACIONES!:
          1. NO SABES NADA sobre los datos actuales (empleados, asistencias, números) a menos que consultes la base de datos.
          2. Si te preguntan "cuántos", "quiénes" o "listado", DEBES usar la herramienta 'consultar_base_datos'.
          3. PROHIBIDO inventar números. Si la herramienta falla o no devuelve datos, di: "No encontré información en la base de datos".
          4. NUNCA respondas con una cifra (como 1374) si no ejecutaste SQL primero.

          REGLAS DE SQL:
          - Tu acceso es SOLO LECTURA (SELECT).
          - Para "Activos" usa siempre: WHERE stStatus = 1
          - Esquema: ${DB_SCHEMA}
          
          [MANUAL KAIZEN]
          ${MANUAL_KAIZEN}
          
          [NORMATIVA SSOMA]
          ${REGLAMENTO_SSOMA}
        `}]
      },
      generationConfig: { maxOutputTokens: 2048, temperature: 0.0 }, // Temperatura 0 para máxima precisión
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
      ]
    });

    const parts = [];
    let contextStr = `${contextoCliente}\n${text || "Analiza lo siguiente:"}`;
    
    if (projectId) contextStr += `\n[Proyecto ID: ${projectId}]`;
    
    parts.push({ text: contextStr });

    // Procesamiento de archivos ...
    for (const file of validFiles) {
      const buffer = fs.readFileSync(file.path);
      if (file.mimetype.match(/text|json|csv|xml/)) {
        parts.push({ text: `\n--- ARCHIVO: ${file.originalname} ---\n${buffer.toString('utf-8')}\n` });
      } else if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
        parts.push({ inlineData: { mimeType: file.mimetype, data: buffer.toString('base64') } });
      }
    }

    if (parts.length === 0 && !text) return res.json({ success: false, reply: "No hay datos para procesar." });
    
    const chat = model.startChat({ tools: tools });

    console.log(`🤖 Pregunta: ${text}`);

    let result = await chat.sendMessage(parts);
    let response = await result.response;
    
    // Extracción robusta de llamadas a función
    let functionCalls = [];
    if (response.candidates?.[0]?.content?.parts) {
        functionCalls = response.candidates[0].content.parts
            .filter(part => part.functionCall)
            .map(part => part.functionCall);
    }

    // SI NO HAY LLAMADAS A FUNCIÓN, LOGUEAMOS ADVERTENCIA
    if (functionCalls.length === 0) {
        console.log("⚠️ ALERTA: La IA respondió sin consultar la BD (Posible alucinación si pidió datos).");
    }

    while (functionCalls.length > 0) {
        const call = functionCalls[0];
        
        if (call.name === "consultar_base_datos") {
            const sql = call.args.sql_query || "";
            console.log(`🗄️ SQL Generado: ${sql}`); // LOG VITAL PARA DEPURAR
            
            if (!sql.trim().toUpperCase().startsWith('SELECT')) {
                const securityMsg = "ERROR: Solo lectura permitida.";
                result = await chat.sendMessage([{
                    functionResponse: { name: "consultar_base_datos", response: { result: securityMsg } }
                }]);
            } else {
                try {
                    const dbRows = await query(sql);
                    console.log(`✅ Registros encontrados: ${dbRows.length}`); // LOG VITAL
                    const dbResult = JSON.stringify(dbRows).substring(0, 15000);
                    
                    result = await chat.sendMessage([{
                        functionResponse: { name: "consultar_base_datos", response: { result: dbResult } }
                    }]);
                } catch (err) {
                    console.error(`❌ Error SQL: ${err.message}`);
                    result = await chat.sendMessage([{
                        functionResponse: { name: "consultar_base_datos", response: { error: "Error de base de datos." } }
                    }]);
                }
            }
        }
        
        response = await result.response;
        functionCalls = [];
        if (response.candidates?.[0]?.content?.parts) {
            functionCalls = response.candidates[0].content.parts
                .filter(part => part.functionCall)
                .map(part => part.functionCall);
        }
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
    console.error('🔥 Error Fatal:', error.message);
    res.status(500).json({ success: false, error: 'ai_error', message: "Error interno del servidor." });
  } finally {
    setTimeout(() => { filesToDelete.forEach(p => safeDelete(p)); }, 1000);
  }
}