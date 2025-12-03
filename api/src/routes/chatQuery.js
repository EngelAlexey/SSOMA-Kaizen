import { ChatOrchestrator } from '../ChatFlow.js';

const orchestrator = new ChatOrchestrator();

export const handleChatQuery = async (req, res) => {
    try {
        const userMessage = req.body.message || req.body.query || ""; 
        const files = req.files || [];
        
        const userContext = req.userContext || { prefix: null, mode: 'guest' };
        const databaseId = userContext.prefix; 

        if (!userMessage.trim() && files.length === 0) {
             return res.status(400).json({ error: "Mensaje o archivo requerido" });
        }
        
        const finalMessage = userMessage.trim() || "Analiza la imagen adjunta.";

        if (!databaseId && userContext.mode !== 'guest') {
             return res.status(403).json({ error: "DatabaseID requerido (No Auth)" });
        }

        const context = { 
            databaseId: databaseId, // 'KZN'
            threadId: req.body.threadId || null,
            files: files 
        };
        
        const responseText = await orchestrator.handleUserMessage(finalMessage, context);
        
        res.json({ success: true, response: responseText });

    } catch (error) {
        console.error("Chat Query Error:", error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
};