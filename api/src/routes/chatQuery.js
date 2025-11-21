import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const FACE_API_URL = process.env.FACE_API_URL || 'https://ssoma-kaizen-api.onrender.com';

export async function handleChatQuery(req, res) {
  try {
    const { text, projectId, staffId, clockId, session_id, thread_id } = req.body;
    const files = req.files || [];

    console.log('📝 Recibida consulta:', { text, projectId, staffId, clockId, session_id, thread_id, filesCount: files.length });

    let faceResults = [];

    if (files.length > 0) {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(file.path));

        try {
          const faceRes = await axios.post(`${FACE_API_URL}/identify_staff_from_image`, formData, {
            headers: formData.getHeaders(),
            timeout: 15000
          });
          faceResults.push({
            file: file.filename,
            ...faceRes.data
          });
          console.log('✅ Reconocimiento facial exitoso:', file.filename);
        } catch (err) {
          console.error('❌ Error en reconocimiento facial:', err.message);
          faceResults.push({ file: file.filename, error: 'no_face_detected' });
        }
      }
    }

    const messages = [
      { 
        role: 'system', 
        content: 'Eres SSOMA-Kaizen, un asistente experto en salud ocupacional y seguridad en construcción. Analiza imágenes de obras para identificar actos inseguros, riesgos y medidas preventivas.' 
      }
    ];

    const userContent = [];

    if (text) {
      userContent.push({
        type: 'text',
        text: text
      });
    }

    if (files.length > 0) {
      const promptText = `Analiza las siguientes imágenes de la obra y responde:

1. **Actos inseguros observados:** Identifica prácticas o comportamientos peligrosos.
2. **Riesgos asociados:** Explica qué accidentes o daños podrían causar.
3. **Medidas preventivas/correctivas:** Recomienda acciones específicas para mitigar los riesgos.

**Contexto adicional:**
- Proyecto ID: ${projectId || 'N/A'}
- Reloj ID: ${clockId || 'N/A'}
- Personal identificado: ${JSON.stringify(faceResults, null, 2)}

Sé específico y práctico en tus recomendaciones.`;

      userContent.push({
        type: 'text',
        text: promptText
      });

      for (const file of files) {
        const imageBuffer = fs.readFileSync(file.path);
        const base64Image = imageBuffer.toString('base64');
        const mimeType = file.mimetype || 'image/jpeg';
        
        userContent.push({
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${base64Image}`,
            detail: 'high'
          }
        });

        console.log('🖼️ Imagen agregada al análisis:', file.filename, mimeType);
      }
    } else {
      userContent.push({
        type: 'text',
        text: text || 'Hola, ¿cómo puedo ayudarte con seguridad ocupacional?'
      });
    }

    messages.push({
      role: 'user',
      content: userContent
    });

    console.log('🤖 Enviando a OpenAI...');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      temperature: 0.3,
      max_tokens: 1500
    });

    const reply = completion.choices[0].message.content;

    console.log('✅ Respuesta generada exitosamente');
    console.log('📊 Tokens usados:', completion.usage);

    files.forEach(file => {
      try {
        fs.unlinkSync(file.path);
        console.log('🗑️ Archivo temporal eliminado:', file.filename);
      } catch (err) {
        console.error('⚠️ Error al eliminar archivo:', err.message);
      }
    });

    const responseData = {
      success: true,
      reply: reply,
      message: reply,
      faceResults,
      tokensUsed: completion.usage?.total_tokens || 0,
      thread_id: thread_id || `thread_${Date.now()}`,
      session_id: session_id || 'default'
    };

    console.log('📤 Enviando respuesta al frontend');

    return res.json(responseData);

  } catch (error) {
    console.error('❌ Error en handleChatQuery:', error);
    
    if (req.files) {
      req.files.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (err) {
        }
      });
    }

    return res.status(500).json({ 
      success: false,
      error: 'server_error', 
      message: error.message,
      reply: 'Lo siento, ocurrió un error al procesar tu consulta.'
    });
  }
}