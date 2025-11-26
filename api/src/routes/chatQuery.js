import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
import 'dotenv/config';

const MANUAL_KAIZEN = `
MATRIZ DE USO KAIZEN (RESUMEN):
1. PERMISOS: Inicio > Permisos > +Agregar.
2. EMPRESAS: Inicio > Empresas.
3. HORARIOS: Inicio > Horarios.
4. PROYECTOS: Inicio > Proyectos.
5. USUARIOS: Inicio > Usuarios.
6. PARÁMETROS: Inicio > Parámetros.
7. CENTROS DE COSTOS: Inicio > Centros Costos.
8. PUESTOS: Inicio > Puestos.
9. PERSONAL: Expediente, Foto, Contratos.
10. RELOJ APP: Licencia, QR, Marca Rápida.
11. ASISTENCIAS: Revisar y Recalcular.
12. ACCIONES PERSONAL: Incapacidades/Permisos.
13. AJUSTES: Préstamos/Bonos.
14. PLANILLAS: Crear > Resumen > Enviar.
15. COMPROBANTES: Envío por correo.
`;

const REGLAMENTO_SSOMA = `
SEGURIDAD (CRITERIO TÉCNICO):
- ALTURAS: >1.8m requiere arnés.
- EXCAVACIONES: >1.5m requiere entibado.
- EPP: Casco, Chaleco, Botas.
- ELÉCTRICO: Tableros cerrados.
- ANDAMIOS: Bases niveladas y barandas.
`;

const PROJECT_ID = process.env.PROJECT_ID || 'causal-binder-459316-v6';
const LOCATION = process.env.LOCATION || 'us-central1';
const MODEL_ID = 'gemini-1.5-flash-002';
const FACE_API_URL = process.env.FACE_API_URL;
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const safeDelete = (filePath) => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.warn(`⚠️ No se pudo borrar temporal: ${path.basename(filePath)}`);
  }
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

    console.log(`📝 Consulta: "${text?.substring(0, 30)}..." | Archivos: ${uploads.length}`);

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
          Eres SSOMA-Kaizen, experto en seguridad y soporte AppSheet.
          
          [MANUAL APP]
          ${MANUAL_KAIZEN}
          
          [REGLAMENTO]
          ${REGLAMENTO_SSOMA}
          
          INSTRUCCIONES:
          - App: Cita ruta exacta.
          - Seguridad: Cita reglamento.
          - Si ves a alguien identificado: "${JSON.stringify(faceResults)}", úsalo en tu reporte.
          - Alerta: Si hay riesgo mortal, inicia con "⚠️ PELIGRO".
        `}]
      },
      generationConfig: { maxOutputTokens: 1024, temperature: 0.2 },
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
      ]
    });

    const parts = [];
    let promptFinal = text || "Analiza la información adjunta.";
    if (projectId) promptFinal += ` [Proyecto: ${projectId}]`;
    
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

    console.log('🤖 Enviando a Gemini...');
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
      message: 'Ocurrió un error interno. Revisa la consola del servidor.',
      details: error.message 
    });
  } finally {
    setTimeout(() => {
      filesToDelete.forEach(p => safeDelete(p));
    }, 1000); 
  }
}