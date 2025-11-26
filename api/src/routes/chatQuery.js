import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
import 'dotenv/config';

const MANUAL_KAIZEN = `
MATRIZ DE USO KAIZEN:
1. PERMISOS (Seguridad): Inicio > Permisos > +Agregar. Define roles.
2. EMPRESAS: Inicio > Empresas. Registro de terceros.
3. HORARIOS: Inicio > Horarios. Configura jornadas y tolerancias.
4. PROYECTOS: Inicio > Proyectos. Vincula GPS y horario.
5. USUARIOS: Inicio > Usuarios. Crea accesos web.
6. PARÁMETROS: Inicio > Parámetros. CCSS y Renta.
7. CENTROS DE COSTOS: Inicio > Centros Costos.
8. PUESTOS: Inicio > Puestos. Operativo vs Admin.
9. PERSONAL: Registro 360, Foto, Contratos.
10. RELOJ APP: Licencia, QR, Marca Rápida.
11. ASISTENCIAS: Procesa marcas. Botón 'RECALC' al editar.
12. ACCIONES PERSONAL: Incapacidades, vacaciones.
13. AJUSTES: Préstamos o Bonos.
14. PLANILLAS: Crear > Resumen > Enviar.
15. COMPROBANTES: Envío por correo.
`;

const REGLAMENTO_SSOMA = `
NORMATIVA SEGURIDAD COSTA RICA:
- ALTURAS: >1.8m requiere arnés y línea de vida.
- EXCAVACIONES: >1.5m requiere entibado.
- EPP: Casco, Chaleco, Botas obligatorios.
- ACTO INSEGURO: Falla humana.
- CONDICIÓN INSEGURA: Falla del entorno.
`;

const PROJECT_ID = process.env.PROJECT_ID || 'causal-binder-459316-v6';
const LOCATION = process.env.LOCATION || 'us-central1';
const MODEL_ID = 'gemini-2.0-flash-001';

const FACE_API_URL = process.env.FACE_API_URL;
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const safeDelete = (filePath) => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {}
};

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
            originalname: f.filename || 'image.jpg' 
          });
          filesToDelete.push(tmpPath);
        }
      }
    }

    let faceResults = [];
    if (uploads.length > 0 && FACE_API_URL) {
      const imageFiles = uploads.filter(f => f.mimetype.startsWith('image/'));
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

    const vertex_ai = new VertexAI({ project: PROJECT_ID, location: LOCATION });
    
    const model = vertex_ai.preview.getGenerativeModel({
      model: MODEL_ID,
      systemInstruction: {
        parts: [{ text: `
          ## ROL Y PERFIL
          Actúa como **Kaizen GPT**, consultor experto en:
          1. Soporte App "Kaizen" (AppSheet).
          2. Seguridad Ocupacional (SSOMA) - Normativa Costa Rica.
          
          ## CONTEXTO
          [MANUAL APP]
          ${MANUAL_KAIZEN}
          
          [REGLAMENTO SSOMA]
          ${REGLAMENTO_SSOMA}
          
          ## PROTOCOLO
          1. SOPORTE APP: Usa el Manual. Cita la ruta (Inicio > Módulo).
          2. SEGURIDAD: Analiza riesgos en imágenes. Cita el Reglamento.
          3. PERSONAL: Si hay rostros identificados: "${JSON.stringify(faceResults)}", úsalos.
          4. ALERTA: Si hay riesgo mortal, inicia con "⚠️ ALERTA DE SEGURIDAD".
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

    const parts = [];
    let promptFinal = text || "Analiza la información adjunta.";
    if (projectId) promptFinal += ` [Proyecto ID: ${projectId}]`;
    
    parts.push({ text: promptFinal });

    for (const file of uploads) {
      const fileBuffer = fs.readFileSync(file.path);
      const isText = file.mimetype.match(/text|json|csv|xml/);
      
      if (isText) {
        parts.push({ text: `\n[ARCHIVO: ${file.originalname}]\n${fileBuffer.toString('utf-8')}\n[FIN ARCHIVO]\n` });
      } else {
        parts.push({
          inlineData: {
            mimeType: file.mimetype,
            data: fileBuffer.toString('base64')
          }
        });
      }
    }

    console.log(`🤖 Enviando a Vertex AI (${MODEL_ID})...`);
    
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: parts }]
    });

    const response = await result.response;
    const reply = response.candidates?.[0]?.content?.parts?.[0]?.text || "No se generó respuesta.";

    console.log('✅ Éxito.');

    res.json({
      success: true,
      reply: reply,
      message: reply,
      faceResults,
      tokensUsed: response.usageMetadata?.totalTokenCount || 0
    });

  } catch (error) {
    console.error('🔥 ERROR FATAL EN CHATQUERY:', error);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Error al conectar con el modelo de IA.',
      details: error.message 
    });
  } finally {
    setTimeout(() => {
      filesToDelete.forEach(p => safeDelete(p));
    }, 1000); 
  }
}