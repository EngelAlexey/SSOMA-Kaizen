import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
import { randomUUID } from 'crypto';
import 'dotenv/config';
import { validarLicencia, registrarHilo, query, guardarMensaje, obtenerHistorial } from '../db.js';

const LICENCIA_DEV = 'KZN-DFA8-A9C5-BE6D-11F0';

const DB_SCHEMA = `
INSTRUCCIONES TÉCNICAS SQL (USO EXCLUSIVO INTERNO):
- Entorno: Multi-Tenant.
- FILTRO OBLIGATORIO: 'DatabaseID' en el WHERE de CADA tabla consultada.
- RELACIONES (JOINS): La columna 'StaffID' es la clave única que conecta 'rhStaff' con todas las demás tablas.

TABLAS Y COLUMNAS:

1. rhStaff (Maestra de Personal):
   - PK: StaffID
   - Columnas: DatabaseID, StaffID, stCode (Código), stName, stFirstsurname, stSecondsurname, stStatus (1=Activo), stEmail, stPhone, stIncome (Fecha Ingreso), JobpositionID.

2. rhAttendances (Asistencias):
   - FK: StaffID
   - Columnas: DatabaseID, AttendanceID, atDate, StaffID, atHours, atEntrance, atDeparture.

3. rhActions (Historial de Acciones/RRHH):
   - FK: StaffID
   - Columnas: DatabaseID, ActionID, StaffID, acDate, acType (Ej: 'Vacaciones', 'Incapacidad', 'Amonestación'), StartDate, EndDate, acStatus.

4. rhAdjustments (Ajustes Salariales/Bonos):
   - FK: StaffID
   - Columnas: DatabaseID, AdjustmentID, StaffID, adDate, adType, adAmount, adObservations.

5. rhClockV (Marcas Crudas de Reloj):
   - FK: StaffID
   - Columnas: DatabaseID, ClockID, StaffID, ckTimestamp, ckType, ckLocation.
`;

const MANUAL_KAIZEN = `
[BASE DE CONOCIMIENTO - NO USAR SQL PARA ESTO]

1. USO DE APP KAIZEN:
   - PERMISOS: Inicio > Permisos.
   - USUARIOS: Login con Google.
   - PERSONAL: Requiere expediente completo.
   - ASISTENCIAS: Editar requiere 'RECALC'.

2. NORMATIVA LABORAL (CR):
   - RENTA: Escala progresiva sobre exceso de base exenta.
   - CCSS: 10.67% deducción obrera.
   - HORAS EXTRAS: Valor 1.5x.
   - AGUINALDO: Promedio salarios brutos / 12.

3. SEGURIDAD (SSOMA):
   - Alturas >1.8m: Arnés obligatorio.
   - Zanjas >1.5m: Entibado.
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

const tools = [
  {
    functionDeclarations: [
      {
        name: "consultar_base_datos",
        description: "Ejecuta SQL SELECT. Úsala para obtener datos puntuales, listas o perfiles completos de colaboradores uniendo tablas.",
        parameters: {
          type: "OBJECT",
          properties: {
            sql_query: {
              type: "STRING",
              description: "Consulta SQL SELECT. Soporta JOINs. Debe incluir 'WHERE DatabaseID = ...'"
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
          try { await registrarHilo(clientPrefix, datosLicencia.licencia_id, threadId, 'SSOMA-AI'); } catch (e) {}
      }

      contextoCliente = `
[SESIÓN ACTIVA]
- Cliente: ${datosLicencia.empresa}
- DatabaseID: "${clientPrefix}"
`;
    } else {
      return res.status(401).json({ success: false, error: "ACCESO DENEGADO" });
    }
  } catch (dbError) {
    return res.status(500).json({ error: "Error de seguridad en base de datos." });
  }

  try {
    const uploads = [];
    if (req.files) req.files.forEach(f => { uploads.push(f); filesToDelete.push(f.path); });
    
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

    let history = [];
    if (!isNewThread) {
        try {
            history = await obtenerHistorial(threadId);
        } catch (e) { console.error("Error historial:", e); }
    }

    const vertex_ai = new VertexAI({ project: PROJECT_ID, location: LOCATION });
    const model = vertex_ai.preview.getGenerativeModel({
      model: MODEL_ID,
      systemInstruction: {
        parts: [{ text: `
          ERES SSOMA-KAIZEN.
          
          REGLAS DE PRIVACIDAD:
          1. Para el usuario eres un experto humano. NO reveles que usas SQL, tablas, "DatabaseID" o esquemas.
          2. Si hay errores técnicos, di "No pude consultar los datos en este momento", nunca muestres el error de código.

          CEREBRO HÍBRIDO:
          A. PREGUNTAS TEÓRICAS:
             - Responde con tu CONOCIMIENTO y el MANUAL adjunto.
             - NO uses la base de datos.
          
          B. PREGUNTAS DE DATOS:
             - USA 'consultar_base_datos'.
             - SEGURIDAD: Filtra SIEMPRE: WHERE DatabaseID = '${clientPrefix}'.
             - FECHAS: Usa CURDATE() para 'hoy'.
          
          ${DB_SCHEMA}
          ${MANUAL_KAIZEN}
        `}]
      },
      generationConfig: { maxOutputTokens: 2048, temperature: 0.1 },
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
      ]
    });

    const parts = [];
    
    let contextStr = `${contextoCliente}\n${text || "Analiza lo siguiente:"}`;
    
    if (projectId) contextStr += `\n[Proyecto ID: ${projectId}]`;
    if (faceResults.length > 0) contextStr += `\n[Personal en Foto: ${JSON.stringify(faceResults)}]`;
    
    parts.push({ text: contextStr });

    for (const file of validFiles) {
      const buffer = fs.readFileSync(file.path);
      if (file.mimetype.match(/text|json|csv|xml/)) {
        parts.push({ text: `\n--- ARCHIVO: ${file.originalname} ---\n${buffer.toString('utf-8')}\n` });
      } else if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
        parts.push({ inlineData: { mimeType: file.mimetype, data: buffer.toString('base64') } });
      }
    }

    if (parts.length === 0 && !text) return res.json({ success: false, reply: "No hay datos." });
    
    const chat = model.startChat({ 
        tools: tools,
        history: history 
    });

    let result = await chat.sendMessage(parts);
    let response = await result.response;
    
    let functionCalls = [];
    if (response.candidates?.[0]?.content?.parts) {
        functionCalls = response.candidates[0].content.parts
            .filter(part => part.functionCall)
            .map(part => part.functionCall);
    }

    while (functionCalls.length > 0) {
        const responses = [];

        for (const call of functionCalls) {
            if (call.name === "consultar_base_datos") {
                const sql = call.args.sql_query || "";
                const sqlUpper = sql.toUpperCase();
                
                let queryResult;
                let securityError = null;

                if (!sqlUpper.startsWith('SELECT')) {
                    securityError = "Error: Operación no permitida (Solo SELECT).";
                } else if (!sqlUpper.includes("DATABASEID")) {
                    securityError = "Error: Filtro de seguridad faltante (DatabaseID)."; 
                } else if (!sqlUpper.includes(`'${clientPrefix.toUpperCase()}'`) && !sqlUpper.includes(`"${clientPrefix.toUpperCase()}"`)) {
                    securityError = "Error: Acceso a datos cruzados bloqueado.";
                }

                if (securityError) {
                    queryResult = { error: securityError };
                } else {
                    try {
                        const dbRows = await query(sql);
                        queryResult = { result: JSON.stringify(dbRows).substring(0, 25000) };
                    } catch (err) {
                        console.error(`Error SQL: ${err.message}`);
                        queryResult = { error: "Error técnico en consulta SQL." };
                    }
                }

                responses.push({
                    functionResponse: {
                        name: "consultar_base_datos",
                        response: queryResult
                    }
                });
            }
        }

        if (responses.length > 0) {
            result = await chat.sendMessage(responses);
            response = await result.response;
        }

        functionCalls = [];
        if (response.candidates?.[0]?.content?.parts) {
            functionCalls = response.candidates[0].content.parts
                .filter(part => part.functionCall)
                .map(part => part.functionCall);
        }
    }

    const reply = response.candidates?.[0]?.content?.parts?.[0]?.text || "Sin respuesta.";

    if (threadId && text) {
        await guardarMensaje(threadId, 'user', text);
    }
    if (threadId && reply) {
        await guardarMensaje(threadId, 'model', reply);
    }

    res.json({
      success: true,
      reply,
      threadId,
      clientPrefix,
      tokensUsed: response.usageMetadata?.totalTokenCount || 0
    });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ success: false, error: 'ai_error', message: "Ocurrió un error inesperado." });
  } finally {
    setTimeout(() => { filesToDelete.forEach(p => safeDelete(p)); }, 1000);
  }
}