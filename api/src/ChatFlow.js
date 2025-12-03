import fs from 'fs';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { query } from './db.js';
import { sqlEngine, kb, translator } from './CoreSystem.js';
import { manualIndex } from './KnowledgeIndex.js';
import { updateThreadState, getThreadState } from '../sessions.js';

const AI_API_KEY = process.env.GEMINI_API_KEY;
let genAI = null;
let model = null;

if (AI_API_KEY) {
    genAI = new GoogleGenerativeAI(AI_API_KEY);
    // Configuración estricta para SQL
    model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-001" }, { apiVersion: 'v1beta' });
}

function cleanMessage(text) {
    const greetings = /^(hola|buenos días|buenas noches|qué tal|buenas|saludos|disculpa|por favor|te pido|quiero saber|dame la lista de)\W*/i;
    let cleanedText = text.replace(greetings, '').trim();
    if (cleanedText.length === 0) return text;
    return cleanedText;
}

class LLMService {
    async callAI(messages, temperature = 0, files = []) {
        if (!model) return null;

        try {
            const systemMessage = messages.find(m => m.role === 'system');
            const userMessage = messages.find(m => m.role === 'user');
            const userParts = [{ text: userMessage.content }];

            if (files.length > 0) {
                // Lógica de archivos (visión)
            }

            const requestModel = systemMessage 
                ? genAI.getGenerativeModel({ 
                    model: "gemini-2.0-flash-001", 
                    systemInstruction: systemMessage.content
                  }, { apiVersion: 'v1beta' })
                : model;

            const result = await requestModel.generateContent({
                contents: [{ role: 'user', parts: userParts }],
                generationConfig: { temperature, maxOutputTokens: 2000 }
            });

            const response = await result.response;
            return response.text();
        } catch (error) {
            console.error("Gemini Error:", error.message);
            return null;
        }
    }
}

class LocalInferenceEngine {
    analyzeRequest(text) {
        const lower = text.toLowerCase();
        let topic = 'GENERAL';
        
        if (lower.includes('asist') || lower.includes('entr') || lower.includes('marcas')) topic = 'ATTENDANCE';
        else if (lower.includes('person') || lower.includes('emplead') || lower.includes('usuario')) topic = 'STAFF';
        else if (lower.includes('proyect')) topic = 'PROJECTS';
        else if (lower.includes('seguridad') || lower.includes('epp')) topic = 'SSOMA';

        const dataKeywords = ['cuant', 'quien', 'lista', 'nombre', 'dame', 'mostrar', 'ver', 'cuales'];
        const manualKeywords = ['como', 'pasos', 'registrar', 'crear', 'hago', 'instrucciones'];

        let mode = 'NARRATIVE';
        if (dataKeywords.some(kw => lower.includes(kw))) mode = 'SQL';
        if (manualKeywords.some(kw => lower.includes(kw))) mode = 'MANUAL';
        
        const greetings = ['hola', 'buenos dias', 'buenas'];
        if (greetings.includes(cleanMessage(lower))) mode = 'CHAT';

        return { topic, mode };
    }
}

export class ChatOrchestrator {
    constructor() {
        this.ai = new LLMService();
        this.localEngine = new LocalInferenceEngine();
        translator.loadDictionary({ 'stName': 'Colaborador' });
    }

    async handleUserMessage(userMessage, context) {
        try {
            const threadId = context.threadId || 'default';
            const { topic, mode } = this.localEngine.analyzeRequest(userMessage);
            
            // Si es SQL, obligamos a buscar el esquema
            let executeSql = (mode === 'SQL') && (!context.files || context.files.length === 0);
            if (!context.databaseId) executeSql = false;

            if (mode === 'CHAT') return "¡Hola! Soy el asistente virtual de Kaizen. ¿En qué puedo ayudarte?";

            if (executeSql) {
                const dynamicSchema = kb.getSchemaForTopic(topic);
                
                // PROMPT REFORZADO PARA SQL
                const systemContent = `
Eres un Generador SQL experto para MySQL.
TU TAREA: Generar una consulta SQL válida basada en el esquema proporcionado.

ESQUEMA DE BASE DE DATOS (Solo usa estas tablas):
${dynamicSchema}

CLIENTE ACTUAL ID: '${context.databaseId}'

REGLAS CRÍTICAS:
1. Todas las tablas tienen una columna 'DatabaseID'. DEBES agregar 'WHERE DatabaseID = "${context.databaseId}"' en tu consulta.
2. Si buscas personas activas en rhStaff, usa 'stStatus = 1'.
3. NO inventes columnas. Usa solo las del esquema.
4. Retorna SOLO el código SQL, sin markdown (sin \`\`\`sql).
`;
                const userPrompt = `Genera SQL para: "${cleanMessage(userMessage)}"`;

                let generatedSQL = await this.ai.callAI(
                    [{ role: "system", content: systemContent }, { role: "user", content: userPrompt }]
                );

                // Limpieza agresiva del output
                generatedSQL = generatedSQL.replace(/```sql/g, '').replace(/```/g, '').trim();

                if (generatedSQL.toUpperCase().startsWith('SELECT')) {
                    console.log("⚡ SQL Generado:", generatedSQL);
                    
                    try {
                        sqlEngine.validateSecurity(generatedSQL, context.databaseId);
                        const dbRows = await query(generatedSQL);
                        
                        if (dbRows.length > 0) {
                            // ÉXITO: Interpretar datos
                            const interpretationSystem = `
Eres KaizenGPT. Analiza estos datos JSON y responde la pregunta del usuario de forma natural y ejecutiva.
Usa formato de lista si hay varios registros.
`;
                            return await this.ai.callAI([
                                { role: "system", content: interpretationSystem },
                                { role: "user", content: `Pregunta: ${userMessage}\nDatos: ${JSON.stringify(dbRows)}` }
                            ]);
                        } else {
                            return "No encontré registros que coincidan con tu búsqueda en la base de datos.";
                        }
                    } catch (sqlErr) {
                        console.error("SQL Error:", sqlErr);
                        return "Hubo un error técnico al consultar la base de datos.";
                    }
                } else {
                    // Si la IA no devolvió SQL, devolvemos lo que dijo (quizás pidió aclaración)
                    return generatedSQL;
                }
            }

            // Fallback: Manuales (Si no es SQL)
            const manualChapter = manualIndex.getManualContent(topic);
            const manualSystem = `Eres un experto en soporte Kaizen. Responde usando este manual:\n${manualChapter}`;
            return await this.ai.callAI([{ role: "system", content: manualSystem }, { role: "user", content: userMessage }]);

        } catch (error) {
            console.error("Orchestrator Error:", error);
            return "Ocurrió un error inesperado.";
        }
    }
}