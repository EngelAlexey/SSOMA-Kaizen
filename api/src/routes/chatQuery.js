import { ChatOrchestrator } from '../ChatFlow.js';

const orchestrator = new ChatOrchestrator();

export const handleChatQuery = async (req, res) => {
    try {
        const userMessage = req.body.message || req.body.query; 
        const databaseId = req.body.databaseId || req.body.clientPrefix; 

        if (!userMessage) return res.status(400).json({ error: "Mensaje requerido" });
        if (!databaseId) return res.status(400).json({ error: "DatabaseID requerido" });

        const context = { databaseId };
        const responseText = await orchestrator.handleUserMessage(userMessage, context);

        res.json({ success: true, response: responseText });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
};