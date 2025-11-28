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
INSTRUCCIONES TÉCNICAS SQL (SOLO PARA USO INTERNO DE LA HERRAMIENTA):
- Entorno Multi-Tenant (Varios clientes en la misma tabla).
- FILTRO OBLIGATORIO DE SEGURIDAD: 'DatabaseID'.
- JAMÁS reveles nombres de tablas o columnas al usuario.

TABLAS DISPONIBLES PARA CONSULTAS (SOLO SELECT):

1. rhStaff (Personal y Colaboradores):
   - COLUMNAS: DatabaseID, StaffID, stCode, stName (Nombre), stFirstsurname, stSecondsurname, stStatus (1=Activo), stEmail, stPhone, JobpositionID, stIncome (Fecha Ingreso).

2. rhClockV (Marcajes de Reloj):
   - COLUMNAS: DatabaseID, ClockID, StaffID, ckTimestamp (Fecha/Hora exacta), ckType (Entrada/Salida), ckLocation.

3. rhAttendances (Asistencias Procesadas/Cálculo de Horas):
   - COLUMNAS: DatabaseID, AttendanceID, atDate, StaffID, atHours (Horas trabajadas), atEntrance, atDeparture.

4. rhActions (Acciones de Personal, Vacaciones, Incapacidades):
   - COLUMNAS: DatabaseID, ActionID, StaffID, acDate, acType (Ej: 'Vacaciones', 'Incapacidad'), StartDate, EndDate, acStatus.

5. rhAdjustments (Ajustes Salariales, Bonos, Deducciones):
   - COLUMNAS: DatabaseID, AdjustmentID, StaffID, adDate, adType, adAmount (Monto), adObservations.
`;

const MANUAL_KAIZEN = `
[BASE DE CONOCIMIENTO - MANUAL DE USUARIO Y NORMATIVA]

1. APP KAIZEN - GUÍA RÁPIDA:
   - PERMISOS: Se gestionan en Inicio > Permisos. Niveles: Contribuir o Administrar.
   - EMPRESAS: Registro de terceros en Inicio > Empresas.
   - USUARIOS: El acceso es mediante correo Google (G-Suite).
   - PERSONAL: Para crear un colaborador se requiere Expediente, Foto y Contrato firmado.
   - ASISTENCIAS: Si editas una marca manual, es obligatorio usar el botón 'RECALC' para actualizar las horas.
   - PLANILLAS: Flujo: Crear > Resumen > Recalc > Enviar a Pago.

2. NORMATIVA LABORAL Y CÁLCULOS (COSTA RICA):
   - IMPUESTO DE RENTA: Se calcula sobre el salario bruto excedente de la base exenta definida por Hacienda. Es una tarifa progresiva (10%, 15%, 20%, 25%). No depende de la base de datos, es una norma legal.
   - CCSS (CAJA): La deducción obrera es del 10.67% sobre el salario reportado.
   - HORAS EXTRAS: Se pagan a tiempo y medio (1.5x) sobre el valor de la hora ordinaria.
   - AGUINALDO: Promedio de salarios brutos desde Diciembre del año anterior a Noviembre del actual, dividido entre 12.

3. SEGURIDAD OCUPACIONAL (SSOMA):
   - TRABAJO EN ALTURAS: Obligatorio arnés y línea de vida sobre 1.8 metros.
   - ZANJAS: Requieren entibado o talud si la profundidad excede 1.5 metros.
   - EPP BÁSICO: Casco, botas de seguridad, chaleco reflectivo y gafas de protección (Art 81).
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
        description: "HERRAMIENTA SOLO PARA DATOS EN TIEMPO REAL. Úsala si preguntan: 'cuántos', 'quién', 'lista de', 'estatus de', 'asistencias de hoy'. NO LA USES para preguntas de 'cómo se calcula', 'qué es' o normativa.",
        parameters: {
          type: "OBJECT",
          properties: {
            sql_query: {
              type: "STRING",
              description: "Consulta SQL SELECT incluyendo obligatoriamente 'WHERE DatabaseID = ...'"
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
[CONTEXTO DE SESIÓN]
- Cliente Identificado: ${datosLicencia.empresa}
- Tu ID de Base de Datos (DatabaseID) es: "${clientPrefix}"
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
          ERES SSOMA-KAIZEN, asistente experto en la plataforma Kaizen, RRHH y Seguridad.
          
          PROTOCOLO DE PRIVACIDAD (ESTRICTO):
          1. CAJA NEGRA: Responde al usuario de forma natural. NUNCA expliques detalles técnicos como "Hice una consulta SQL a la tabla rhStaff". Simplemente di: "Hay 5 colaboradores".
          2. CONFIDENCIALIDAD: Jamás menciones nombres de tablas, columnas, IDs internos o la estructura de la base de datos.
          
          MODO DE OPERACIÓN (CEREBRO DUAL):
          
          MODO A: PREGUNTAS DE CONOCIMIENTO (Teoría, Normas, Cálculos Legales, Manual)
          - Si preguntan "¿Cómo se calcula la renta?", "¿Qué es una hora extra?", "¿Cómo creo un usuario?", USA TU CONOCIMIENTO y la sección [BASE DE CONOCIMIENTO] de abajo.
          - NO uses la base de datos para esto.
          
          MODO B: PREGUNTAS DE DATOS REALES (Conteos, Listados, Estado Actual)
          - Si preguntan "¿Cuántos empleados hay?", "¿Quién está de vacaciones?", "¿Marcajes de hoy?", DEBES usar la herramienta 'consultar_base_datos'.
          - REGLA SQL: Tu consulta SIEMPRE debe filtrar por: WHERE DatabaseID = '${clientPrefix}'
          
          ${DB_SCHEMA}
          
          ${MANUAL_KAIZEN}
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
    
    const chat = model.startChat({ tools: tools });

    let result = await chat.sendMessage(parts);
    let response = await result.response;
    
    let functionCalls = [];
    if (response.candidates?.[0]?.content?.parts) {
        functionCalls = response.candidates[0].content.parts
            .filter(part => part.functionCall)
            .map(part => part.functionCall);
    }

    while (functionCalls.length > 0) {
        const call = functionCalls[0];
        
        if (call.name === "consultar_base_datos") {
            const sql = call.args.sql_query || "";
            const sqlUpper = sql.toUpperCase();
            
            let securityError = null;
            if (!sqlUpper.startsWith('SELECT')) {
                securityError = "Error: Operación no permitida.";
            } else if (!sqlUpper.includes("DATABASEID")) {
                securityError = "Error: Filtro de seguridad faltante."; 
            } else if (!sqlUpper.includes(`'${clientPrefix.toUpperCase()}'`) && !sqlUpper.includes(`"${clientPrefix.toUpperCase()}"`)) {
                securityError = "Error: Acceso a datos cruzados bloqueado.";
            }

            if (securityError) {
                result = await chat.sendMessage([{
                    functionResponse: { name: "consultar_base_datos", response: { error: "No pude acceder a los datos por restricciones de seguridad." } }
                }]);
            } else {
                try {
                    const dbRows = await query(sql);
                    const dbResult = JSON.stringify(dbRows).substring(0, 20000);
                    
                    result = await chat.sendMessage([{
                        functionResponse: { name: "consultar_base_datos", response: { result: dbResult } }
                    }]);
                } catch (err) {
                    console.error(`Error SQL: ${err.message}`);
                    result = await chat.sendMessage([{
                        functionResponse: { name: "consultar_base_datos", response: { error: "Ocurrió un error técnico al consultar." } }
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
    console.error('Error:', error.message);
    res.status(500).json({ success: false, error: 'ai_error', message: "Ocurrió un error inesperado." });
  } finally {
    setTimeout(() => { filesToDelete.forEach(p => safeDelete(p)); }, 1000);
  }
}