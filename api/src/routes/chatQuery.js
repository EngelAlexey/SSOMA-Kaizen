import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const FACE_API_URL = process.env.FACE_API_URL || 'https://ssoma-kaizen-api.onrender.com';

export async function handleChatQuery(req, res) {
  try {
    const { text, projectId, staffId, clockId } = req.body;
    const files = req.files || [];

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
        } catch (err) {
          console.error('Error en reconocimiento facial:', err.message);
          faceResults.push({ file: file.filename, error: 'no_face_detected' });
        }
      }
    }

    // Construcción del prompt con contexto
    const prompt = `Analiza la siguiente imagen y responde:\n1. Qué acto(s) inseguro(s) observas.\n2. Qué riesgos podrían causar.\n3. Qué medidas preventivas o correctivas aplicar.\n\nContexto adicional:\nProyecto ID: ${projectId || 'N/A'}\nReloj ID: ${clockId || 'N/A'}\nResultados del reconocimiento facial: ${JSON.stringify(faceResults, null, 2)}\n`;

    // Enviar imágenes al asistente para análisis visual
    const attachments = files.map(f => fs.createReadStream(path.join('uploads', f.filename)));

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Eres SSOMA-Kaizen, un asistente experto en salud ocupacional y construcción.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
    });

    const reply = completion.choices[0].message.content;

    return res.json({
      success: true,
      message: reply,
      faceResults
    });
  } catch (error) {
    console.error('Error en handleChatQuery:', error);
    return res.status(500).json({ error: 'server_error', message: error.message });
  }
}