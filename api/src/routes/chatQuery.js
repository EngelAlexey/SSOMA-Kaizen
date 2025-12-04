import { ChatOrchestrator } from '../ChatFlow.js';

const chatOrchestrator = new ChatOrchestrator();

export async function handleChatQuery(req, res) {
  try {

    const message = req.body.query || req.body.message; 
    const { databaseId, userId } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'El mensaje es requerido' });
    }

    console.log(`[Chat] User: ${userId || 'Guest'} | DB: ${databaseId || 'None'} | Msg: ${message}`);

    const reply = await chatOrchestrator.handleUserMessage(message, databaseId);

    res.json({ reply });

  } catch (error) {
    console.error("Error en handleChatQuery:", error);
    res.status(500).json({ error: 'Error interno del servidor de chat.' });
  }
}