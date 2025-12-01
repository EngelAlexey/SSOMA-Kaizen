import { query } from './db.js';
import { sqlEngine, kb, translator } from './CoreSystem.js';

const AI_API_KEY = process.env.AI_API_KEY || ''; 
const AI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent';

// Función para limpiar el mensaje de ruido antes de generar SQL
function cleanMessage(text) {
    const greetings = /^(hola|buenos días|buenas noches|qué tal|buenas|saludos|disculpa|por favor|te pido|quiero saber|dame la lista de)\W*/i;
    let cleanedText = text.replace(greetings, '').trim();
    
    // Si la limpieza deja el mensaje vacío, usamos el original
    if (cleanedText.length === 0) return text;
    return cleanedText;
}

class LLMService {
    async callAI(messages, temperature = 0) {
        if (!AI_API_KEY) {
            console.warn("⚠️ AI_API_KEY no detectada. Cambiando a Motor de Inferencia Local.");
            return null; 
        }

        const systemMessage = messages.find(m => m.role === 'system');
        const userMessage = messages.find(m => m.role === 'user');

        const payload = {
            contents: [{
                role: 'user',
                parts: [{ text: userMessage.content }]
            }],
            generationConfig: {
                temperature: temperature,
                maxOutputTokens: 2000
            }
        };

        if (systemMessage) {
            payload.systemInstruction = {
                parts: [{ text: systemMessage.content }]
            };
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
            console.error("Error conectando con Gemini:", error.message);
            return null; 
        }
    }
}

class LocalInferenceEngine {
    detectIntent(text) {
        const lower = text.toLowerCase();
        
        const isProject = lower.includes('proyect') || lower.includes('obra') || lower.includes('construc');
        const isAttendance = lower.includes('asist') || lower.includes('entr') || lower.includes('marcA') || lower.includes('hora') || lower.includes('lleg');
        const isCount = lower.includes('cuant') || lower.includes('total') || lower.includes('resumen');
        
        const isDataQuery = isCount || lower.includes('quien') || lower.includes('lista') || lower.includes('nombre');
        const isProcedureQuery = lower.includes('como se') || lower.includes('como puedo') || lower.includes('pasos') || lower.includes('registrar');
        
        let entity = null;
        if (isDataQuery) { 
            const commonWords = ['a', 'que', 'hora', 'dime', 'el', 'la', 'de', 'hoy', 'entro', 'marco', 'marcaron', 'personas', 'cuantas', 'quienes', 'el', 'la', 'los', 'las', 'un', 'una'];
            const words = lower.split(' ').filter(w => !commonWords.includes(w) && w.length > 2);
            if (words.length > 0 && !lower.includes('proyectos') && !lower.includes('activos')) {
                entity = words.join(' ');
            }
        }

        if (isProject && isDataQuery) return { type: 'PROJECTS', entity };
        if (isAttendance && isDataQuery) return { type: 'ATTENDANCE', entity };
        if (isDataQuery) return { type: 'STAFF_COUNT', entity };

        if (isAttendance && isProcedureQuery) return { type: 'PROCEDURE_ATTENDANCE', entity };
        
        return { type: 'UNKNOWN' };
    }

    generateSQL(intent, context) {
        switch (intent.type) {
            case 'PROJECTS':
                return sqlEngine.getActiveProjectsStrategy(context.databaseId);
            case 'ATTENDANCE': 
            case 'ATTENDANCE_INDIVIDUAL':
                return sqlEngine.getEntranceLogStrategy(intent.entity, context.databaseId);
            case 'STAFF_COUNT':
                return sqlEngine.countDailyMarksStrategy(context.databaseId);
            default:
                return null;
        }
    }

    formatResponse(intent, rows) {
        if (!rows || rows.length === 0) return "No encontré registros que coincidan con tu búsqueda en la base de datos.";

        if (intent.type === 'PROJECTS') {
            const list = rows.map(p => `- ${p.pjTitle || 'Sin Título'} (${p.pjCode || 'S/C'})`).join('\n');
            return `🏗️ **Proyectos Activos Encontrados:**\n${list}`;
        }
        if (intent.type === 'ATTENDANCE_INDIVIDUAL') {
            const r = rows[0];
            const time = new Date(r.ckTimestamp).toLocaleTimeString();
            return `✅ **${r.stName}** registró su entrada hoy a las **${time}**.\n(Tipo: ${r.ckType})`;
        }
        if (intent.type === 'ATTENDANCE' || intent.type === 'STAFF_COUNT') {
             return `📊 **Reporte de Asistencia:**\nHoy se han registrado un total de **${rows[0].total}** colaboradores.`;
        }
        return JSON.stringify(rows);
    }
}

export class ChatOrchestrator {
    constructor() {
        this.ai = new LLMService();
        this.localEngine = new LocalInferenceEngine();
        
        translator.loadDictionary({
            'stName': 'Colaborador',
            'ckTimestamp': 'Hora',
            'pjTitle': 'Proyecto',
            'pjCode': 'Código'
        });
    }

    async handleUserMessage(userMessage, context) {
        try {
            const intent = this.localEngine.detectIntent(userMessage);

            const requiresSql = intent.type !== 'UNKNOWN' && !intent.type.startsWith('PROCEDURE_');

            let systemContent = "";
            let userPrompt = userMessage; 

            if (requiresSql) {
                const dynamicSchema = kb.getSchemaForIntent(intent.type);
                
                // Aplicar limpieza para que la IA solo vea la intención pura
                const cleanedMessage = cleanMessage(userMessage);
                
                systemContent = `
IDENTIDAD: Eres KaizenGPT. Tu única TAREA es generar una consulta SQL de MySQL que cumpla estrictamente con la pregunta del usuario.
PERSONALIDAD: Eres silencioso, preciso y técnico. Tu única salida debe ser el código.

========================================================
| ESQUEMA DE DATOS CRÍTICO PARA GENERACIÓN DE SQL (SELECT)
========================================================
${dynamicSchema}

CLIENTE: '${context.databaseId}'

REGLAS DE SEGURIDAD (OBLIGATORIAS): 
- NUNCA uses tablas o columnas fuera del esquema provisto.
- Filtra estrictamente por WHERE DatabaseID='${context.databaseId}'.
- Solo se permite SELECT.
- Si no puedes generar un SELECT que cumpla con el requerimiento, la SALIDA debe ser un mensaje de error claro, NO un saludo o texto conversacional.

SALIDA REQUERIDA: Proporciona SOLAMENTE el código SQL de la consulta.
`;
                // El prompt del usuario es la instrucción de SQL limpia
                userPrompt = `Genera la consulta SQL que cumpla con el requerimiento: "${cleanedMessage}".`;
                
            } else {
                // Para consultas conversacionales/narrativas, enviamos el mensaje original.
                systemContent = `
IDENTIDAD: Eres KaizenGPT, el asistente especializado de la plataforma Kaizen.
PERSONALIDAD: Profesional, proactivo y amigable. Evita emojis.

BASE DE CONOCIMIENTO: Responde basándote en reglas y procedimientos Kaizen. Tienes prohibido generar SQL.

TAREA: Responde la pregunta del usuario: "${userMessage}".

REGLAS DE SEGURIDAD: Nunca menciones bases de datos o códigos internos.

SALIDA REQUERIDA: Proporciona SOLAMENTE la respuesta narrativa.
`;
            }

            let generatedOutput = await this.ai.callAI([
                { role: "system", content: systemContent },
                { role: "user", content: userPrompt }
            ]);

            if (generatedOutput) {
                const cleanedSQL = generatedOutput.replace(/```sql/g, '').replace(/```/g, '').trim();
                
                if (requiresSql && cleanedSQL.toUpperCase().startsWith('SELECT')) {
                    
                    sqlEngine.validateSecurity(cleanedSQL, context.databaseId);
                    const dbRows = await query(cleanedSQL);
                    
                    const interpretationSystemInstruction = `
Actúa como KaizenGPT. Tu objetivo es convertir los datos JSON en una respuesta profesional, amigable y fluida para el usuario.
Tu respuesta debe ser directa, proporcionando el dato solicitado sin preguntar, ofrecer ayuda o describir el proceso de la consulta.
Si la tabla de datos JSON está vacía ([]), responde con un mensaje profesional de 'No se encontraron registros que coincidan con la búsqueda.'

REGLAS DE FORMATO:
- Siempre inicia la respuesta con una frase introductoria clara que conecte con la pregunta original (ej: 'De acuerdo con la base de datos, los colaboradores activos son:').
- Si el resultado es una lista de elementos (ej. nombres), formatéalos usando viñetas y saltos de línea para facilitar la lectura.

Datos JSON: ${JSON.stringify(dbRows)}
`;

                    const interpretation = await this.ai.callAI([
                        { role: "system", content: interpretationSystemInstruction },
                        { role: "user", content: `Pregunta original: ${userMessage}` }
                    ]);
                    
                    return interpretation || "No se pudo generar una respuesta narrativa. Por favor, reformula tu pregunta.";

                } else if (!requiresSql) {
                    return generatedOutput;
                }
            }

            console.log("🔄 Usando Motor de Inferencia Local...");
            const localIntent = this.localEngine.detectIntent(userMessage);

            if (localIntent.type === 'UNKNOWN' || localIntent.type.startsWith('PROCEDURE_')) {
                return "Lo siento, sin mi conexión neuronal completa (API Key), solo puedo responder sobre Asistencias, Conteos y Proyectos. ¿Podrías reformular?";
            }

            const localSQL = this.localEngine.generateSQL(localIntent, context);
            console.log(`⚡ SQL Local Generado: ${localSQL}`);
            
            const dbRows = await query(localSQL);
            return this.localEngine.formatResponse(localIntent, dbRows);

        } catch (error) {
            console.error("Kaizen Orchestrator Error:", error);
            return "Ocurrió un error interno procesando la solicitud. Por favor verifica los logs del servidor.";
        }
    }
}