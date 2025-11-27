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
ESQUEMA DE BASE DE DATOS (MULTI-TENANT):

NOTA CRÍTICA: TODAS las tablas operativas (rh...) tienen la columna 'DatabaseID' que DEBE usarse para filtrar por cliente.

1. rhStaff (Personal):
   - FILTRO OBLIGATORIO: DatabaseID (Ej: 'KZN', 'CPV')
   - StaffID, stCode, stName, stFirstsurname, stSecondsurname.
   - stStatus (1=Activo, 0=Inactivo).
   - stEmail, stPhone, JobpositionID.

2. rhClockV (Marcajes):
   - FILTRO OBLIGATORIO: DatabaseID
   - ClockID, StaffID, ckTimestamp, ckType.

3. rhAttendances (Asistencias):
   - FILTRO OBLIGATORIO: DatabaseID
   - AttendanceID, atDate, StaffID, atHours.

4. rhActions (Acciones Personal):
   - FILTRO OBLIGATORIO: DatabaseID
   - ActionID, acType, StartDate, EndDate.

5. daDashboard (Sistema):
   - daClientPrefix (Equivalente a DatabaseID en esta tabla), daClientName.
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

const tools = [
  {
    functionDeclarations: [
      {
        name: "consultar_base_datos",
        description: "Ejecuta SQL SELECT. OBLIGATORIA para datos. DEBE filtrar por DatabaseID.",
        parameters: {
          type: "OBJECT",
          properties: {
            sql_query: {
              type: "STRING",
              description: "Consulta SQL SELECT incluyendo 'WHERE DatabaseID = ...'"
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
[CONTEXTO DE SEGURIDAD]
- Cliente: ${datosLicencia.empresa}
- Prefijo (DatabaseID): "${clientPrefix}"
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
          ERES SSOMA-KAIZEN.
          
          REGLAS DE SEGURIDAD SQL (CRÍTICO):
          1. Estás en una base de datos COMPARTIDA (Multi-tenant).
          2. La columna para separar clientes es 'DatabaseID'.
          3. TODA consulta a tablas 'rh...' (rhStaff, rhClockV, etc.) DEBE incluir: WHERE DatabaseID = '${clientPrefix}'
          
          EJEMPLO CORRECTO:
          SELECT COUNT(*) FROM rhStaff WHERE stStatus = 1 AND DatabaseID = '${clientPrefix}'
          
          EJEMPLO PROHIBIDO (Hackeo):
          SELECT COUNT(*) FROM rhStaff WHERE stStatus = 1
          
          Si no usas DatabaseID = '${clientPrefix}', estarás mezclando datos de otros clientes.
          
          Esquema: ${DB_SCHEMA}
          
          [MANUAL KAIZEN]
          ${MANUAL_KAIZEN}
          
          [NORMATIVA SSOMA]
          ${REGLAMENTO_SSOMA}
        `}]
      },
      generationConfig: { maxOutputTokens: 2048, temperature: 0.0 },
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
      ]
    });

    const parts = [];
    let contextStr = `${contextoCliente}\n${text || "Analiza lo siguiente:"}`;
    
    if (projectId) contextStr += `\n[Proyecto ID: ${projectId}]`;
    if (faceResults.length > 0) contextStr += `\n[Personal: ${JSON.stringify(faceResults)}]`;
    
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
            
            // VALIDACIÓN DE SEGURIDAD ESTRICTA EN SERVIDOR
            // 1. Solo SELECT
            // 2. Debe contener 'DATABASEID'
            // 3. Debe contener el prefijo del cliente
            
            let securityError = null;
            if (!sqlUpper.startsWith('SELECT')) {
                securityError = "ERROR: Solo se permiten consultas SELECT.";
            } else if (!sqlUpper.includes("DATABASEID")) {
                securityError = "ERROR CRÍTICO: Falta filtrar por 'DatabaseID'.";
            } else if (!sqlUpper.includes(`'${clientPrefix.toUpperCase()}'`) && !sqlUpper.includes(`"${clientPrefix.toUpperCase()}"`)) {
                securityError = `ERROR CRÍTICO: Debes filtrar por DatabaseID = '${clientPrefix}'`;
            }

            if (securityError) {
                result = await chat.sendMessage([{
                    functionResponse: { name: "consultar_base_datos", response: { result: securityError } }
                }]);
            } else {
                try {
                    console.log(`🗄️ SQL: ${sql}`);
                    const dbRows = await query(sql);
                    console.log(`✅ Filas: ${dbRows.length}`);
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
    res.status(500).json({ success: false, error: 'ai_error', message: "Error interno." });
  } finally {
    setTimeout(() => { filesToDelete.forEach(p => safeDelete(p)); }, 1000);
  }
}