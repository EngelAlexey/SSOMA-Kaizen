import fs from 'fs';
import { query } from './db.js';
import { sqlEngine, kb, translator } from './CoreSystem.js';
import { manualIndex } from './KnowledgeIndex.js'; // Importamos el nuevo índice
import { updateThreadState, getThreadState } from '../sessions.js';

const AI_API_KEY = process.env.AI_API_KEY || ''; 
const AI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent';

function cleanMessage(text) {
    const greetings = /^(hola|buenos días|buenas noches|qué tal|buenas|saludos|disculpa|por favor|te pido|quiero saber|dame la lista de)\W*/i;
    let cleanedText = text.replace(greetings, '').trim();
    if (cleanedText.length === 0) return text;
    return cleanedText;
}

class LLMService {
    async callAI(messages, temperature = 0, files = []) {
        if (!AI_API_KEY) {
            console.warn("⚠️ AI_API_KEY no detectada.");
            return null; 
        }

        const systemMessage = messages.find(m => m.role === 'system');
        const userMessage = messages.find(m => m.role === 'user');
        const userContentParts = [{ text: userMessage.content }];

        if (files && files.length > 0) {
            for (const file of files) {
                try {
                    const fileBuffer = fs.readFileSync(file.path);
                    const base64Data = fileBuffer.toString('base64');
                    userContentParts.push({ inlineData: { mimeType: file.mimetype, data: base64Data } });
                } catch (e) {
                    console.error(`Error archivo: ${file.path}`, e);
                }
            }
        }

        const payload = {
            contents: [{ role: 'user', parts: userContentParts }],
            generationConfig: { temperature: temperature, maxOutputTokens: 2000 }
        };

        if (systemMessage) {
            payload.systemInstruction = { parts: [{ text: systemMessage.content }] };
        }

        try {
            const url = `${AI_ENDPOINT}?key=${AI_API_KEY}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error.message);
            return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        } catch (error) {
            console.error("Gemini Error:", error.message);
            return null; 
        }
    }
}

class LocalInferenceEngine {
    analyzeRequest(text) {
        const lower = text.toLowerCase();
        
        // 1. DETECCIÓN DE TEMA (Topic)
        let topic = 'GENERAL';
        if (lower.includes('asist') || lower.includes('entr') || lower.includes('reloj') || lower.includes('marcas')) topic = 'ATTENDANCE';
        else if (lower.includes('person') || lower.includes('emplead') || lower.includes('colaborador') || lower.includes('usuario')) topic = 'STAFF';
        else if (lower.includes('proyect') || lower.includes('obra')) topic = 'PROJECTS';
        else if (lower.includes('seguridad') || lower.includes('acto') || lower.includes('riesgo') || lower.includes('epp')) topic = 'SSOMA';

        // 2. DETECCIÓN DE MODO (Data vs Manual)
        // Palabras que indican consulta de base de datos
        const dataKeywords = ['cuant', 'quien', 'lista', 'nombre', 'dame', 'mostrar', 'ver', 'cuales', 'hay'];
        // Palabras que indican consulta de manual/procedimiento
        const manualKeywords = ['como', 'pasos', 'registrar', 'crear', 'hago', 'donde', 'instrucciones', 'guia'];

        let mode = 'NARRATIVE'; // Por defecto
        
        // Si tiene palabras de datos, es SQL
        if (dataKeywords.some(kw => lower.includes(kw))) {
            mode = 'SQL';
        }
        // Si tiene palabras de manual explícitas, fuerza NARRATIVE (manual)
        // Esto sobreescribe si hay conflicto (ej: "Como veo la lista" -> Manual sobre cómo ver listas)
        if (manualKeywords.some(kw => lower.includes(kw))) {
            mode = 'MANUAL'; 
        }

        return { topic, mode };
    }

    generateSQL(intent, context) {
        // Fallback local simple
        return sqlEngine.validateSecurity("SELECT * FROM rhStaff", context.databaseId); 
    }

    formatResponse(intent, rows) {
        return JSON.stringify(rows);
    }
}

export class ChatOrchestrator {
    constructor() {
        this.ai = new LLMService();
        this.localEngine = new LocalInferenceEngine();
        translator.loadDictionary({ 'stName': 'Colaborador', 'ckTimestamp': 'Hora' });
    }

    async handleUserMessage(userMessage, context) {
        try {
            const threadId = context.threadId;
            const inputFiles = context.files || [];
            const previousData = getThreadState(threadId, 'lastQueryResult');
            
            // Análisis inteligente de la solicitud
            const { topic, mode } = this.localEngine.analyzeRequest(userMessage);
            
            // Decisión final de si ejecutar SQL (Si modo es SQL y no hay archivos)
            let executeSql = (mode === 'SQL') && (inputFiles.length === 0);

            let systemContent = "";
            let userPrompt = userMessage; 

            // --- CASO 1: VISIÓN (Prioridad Máxima si hay archivos) ---
            if (inputFiles.length > 0) {
                executeSql = false;
                systemContent = `
IDENTIDAD: Auditor experto SSOMA de Kaizen.
TAREA: Analiza la imagen.
REGLAS: Solo reporta lo visible. Identifica EPP y riesgos.
`;
            
            // --- CASO 2: MEMORIA / SEGUIMIENTO ---
            } else if (previousData && (userMessage.toLowerCase().includes('mayor') || userMessage.toLowerCase().includes('menor') || userMessage.toLowerCase().includes('edad') || userMessage.toLowerCase().includes('cuál') || userMessage.toLowerCase().includes('correo'))) {
                executeSql = false;
                systemContent = `
IDENTIDAD: KaizenGPT.
TAREA: Responde usando SOLO este JSON recuperado previamente.
DATOS: ${previousData}
REGLAS: 'stBirthdate' es fecha nacimiento.
`;
                
            // --- CASO 3: CONSULTA SQL (DATA) ---
            } else if (executeSql) {
                const dynamicSchema = kb.getSchemaForTopic(topic); // Obtenemos esquema del TEMA detectado
                const cleanedMessage = cleanMessage(userMessage);
                
                systemContent = `
IDENTIDAD: KaizenGPT. Generador SQL MySQL.
ESQUEMA: ${dynamicSchema}
CLIENTE: '${context.databaseId}'
REGLAS: 
1. Filtra: WHERE DatabaseID='${context.databaseId}'.
2. Estado: stStatus = 1 (Activo).
3. PROACTIVIDAD: En rhStaff siempre SELECT: StaffID, stName, stFirstsurname, stStatus, stEmail, stPhone, stBirthdate.
SALIDA: Solo código SQL.
`;
                userPrompt = `Genera SQL para: "${cleanedMessage}".`;
                
            // --- CASO 4: MANUAL (PROCEDIMIENTOS) ---
            } else {
                // Recuperamos el capítulo del manual del TEMA detectado
                const manualChapter = manualIndex.getManualContent(topic);

                systemContent = `
IDENTIDAD: Eres KaizenGPT, experto en la plataforma Kaizen.
OBJETIVO: Guiar al usuario paso a paso.

BASE DE CONOCIMIENTO (CAPÍTULO: ${topic}):
${manualChapter}

INSTRUCCIONES:
1. Responde basándote EXCLUSIVAMENTE en el texto de arriba.
2. Si la pregunta no está en este capítulo, indícalo.
3. Sé directo e instruccional.
`;
            }

            let generatedOutput = await this.ai.callAI(
                [{ role: "system", content: systemContent }, { role: "user", content: userPrompt }],
                0.2, inputFiles 
            );

            if (generatedOutput) {
                const cleanedSQL = generatedOutput.replace(/```sql/g, '').replace(/```/g, '').trim();
                
                if (executeSql && cleanedSQL.toUpperCase().startsWith('SELECT')) {
                    
                    sqlEngine.validateSecurity(cleanedSQL, context.databaseId);
                    const dbRows = await query(cleanedSQL);
                    
                    if (dbRows && dbRows.length > 0) {
                        updateThreadState(threadId, 'lastQueryResult', JSON.stringify(dbRows));
                    }
                    
                    const interpretationSystemInstruction = `
Actúa como KaizenGPT. Convierte datos JSON a respuesta profesional.
Si está vacío, di 'No se encontraron registros'.
Usa viñetas.
Datos JSON: ${JSON.stringify(dbRows)}
`;
                    const interpretation = await this.ai.callAI([
                        { role: "system", content: interpretationSystemInstruction },
                        { role: "user", content: `Pregunta original: ${userMessage}` }
                    ]);
                    
                    return interpretation || "Sin respuesta narrativa.";
                } else {
                    return generatedOutput;
                }
            }

            return "Lo siento, no pude procesar la solicitud.";

        } catch (error) {
            console.error("Orchestrator Error:", error);
            return "Error interno.";
        }
    }
}