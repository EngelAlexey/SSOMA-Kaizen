import { query } from './db.js';
import { sqlEngine, kb, translator } from './CoreSystem.js';

const AI_API_KEY = process.env.AI_API_KEY || ''; 
const AI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent';

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
        
        let entity = null;
        if (!isCount) {
            const commonWords = ['a', 'que', 'hora', 'dime', 'el', 'la', 'de', 'hoy', 'entro', 'marco', 'marcaron', 'personas', 'cuantas', 'quienes', 'el', 'la', 'los', 'las', 'un', 'una'];
            const words = lower.split(' ').filter(w => !commonWords.includes(w) && w.length > 2);
            if (words.length > 0 && !lower.includes('proyectos') && !lower.includes('activos')) {
                entity = words.join(' ');
            }
        }

        if (isProject) return { type: 'PROJECTS', entity };
        if (isAttendance && entity) return { type: 'ATTENDANCE_INDIVIDUAL', entity };
        if (isAttendance || isCount) return { type: 'ATTENDANCE_COUNT', entity };
        
        return { type: 'UNKNOWN' };
    }

    generateSQL(intent, context) {
        switch (intent.type) {
            case 'PROJECTS':
                return sqlEngine.getActiveProjectsStrategy(context.databaseId);
            case 'ATTENDANCE_INDIVIDUAL':
                return sqlEngine.getEntranceLogStrategy(intent.entity, context.databaseId);
            case 'ATTENDANCE_COUNT':
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
        if (intent.type === 'ATTENDANCE_COUNT') {
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
const kaizenHandbook = `
    IDENTIDAD: Eres KaizenGPT, el asistente inteligente y especializado de la plataforma Kaizen, focalizado en Recursos Humanos (RH) y Seguridad, Salud Ocupacional, y Medio Ambiente (SSOMA).
    PERSONALIDAD: Tu tono es profesional, proactivo y amigable. Evita el uso de emojis.

    BASE DE CONOCIMIENTO: Tu conocimiento se basa en las reglas y procedimientos internos de la plataforma Kaizen.
    
    ========================================================
    | ESQUEMA DE DATOS CRÍTICO PARA GENERACIÓN DE SQL (SELECT)
    ========================================================
    ${kb.getSchemaSummary()}
    
    CLIENTE: '${context.databaseId}'
    
    TAREA: Generar una respuesta de texto narrativo o una consulta SQL de MySQL para la pregunta: "${userMessage}".

    PROCESO DE RAZONAMIENTO (PASOS INTERNOS):
    1. INTENCIÓN: Determina si la pregunta requiere datos (SQL) o conocimiento narrativo (Texto).
    2. ANÁLISIS DEL ESQUEMA: Si requiere SQL, identifica la tabla o tablas necesarias en el ESQUEMA DE DATOS CRÍTICO.
    3. VALIDACIÓN DE REGLAS: Verifica que la consulta SQL incluya la cláusula WHERE DatabaseID='${context.databaseId}' y solo use SELECT.
    
    RAZONAMIENTO Y ELECCIÓN (Salida):
    - Si la pregunta requiere SQL, tu ÚNICA SALIDA debe ser el código SQL generado en el PASO 3.
    - Si la pregunta requiere una respuesta narrativa (saludos, procedimientos Kaizen, o explicaciones teóricas), tu ÚNICA SALIDA debe ser la respuesta de texto.
    
    REGLAS DE SEGURIDAD (Obligatorias): 
    - NUNCA REVELES el nombre de las tablas, columnas, el código SQL generado o el CLIENTE en la respuesta narrativa.
    
    SALIDA REQUERIDA: Proporciona SOLAMENTE el SQL o el texto narrativo.
`;

            let generatedOutput = await this.ai.callAI([
                { role: "system", content: kaizenHandbook },
                { role: "user", content: "Genera la respuesta." }
            ]);

            if (generatedOutput) {
                // Limpiamos el output para detectar si es SQL
                const cleanedSQL = generatedOutput.replace(/```sql/g, '').replace(/```/g, '').trim();
                
                if (cleanedSQL.toUpperCase().startsWith('SELECT')) {
                    
                    sqlEngine.validateSecurity(cleanedSQL, context.databaseId);
                    const dbRows = await query(cleanedSQL);
                    
                    const interpretationSystemInstruction = `
                        Actúa como KaizenGPT.
                        Tu objetivo es convertir los datos JSON en una respuesta profesional, amigable y natural, dirigida al usuario.
                        Si la tabla de datos JSON está vacía ([]), responde con un mensaje profesional de 'No se encontraron registros que coincidan con la búsqueda.'
                        Datos JSON: ${JSON.stringify(dbRows)}
                    `;

                    const interpretation = await this.ai.callAI([
                        { role: "system", content: interpretationSystemInstruction },
                        { role: "user", content: `Pregunta original: ${userMessage}` }
                    ]);
                    
                    return interpretation || "No se pudo generar una respuesta narrativa. Por favor, reformula tu pregunta.";

                } else {
                    return generatedOutput;
                }
            }

            console.log("🔄 Usando Motor de Inferencia Local...");
            const intent = this.localEngine.detectIntent(userMessage);
            
            if (intent.type === 'UNKNOWN') {
                return "Lo siento, sin mi conexión neuronal completa (API Key), solo puedo responder sobre Asistencias, Conteos y Proyectos. ¿Podrías reformular?";
            }

            const localSQL = this.localEngine.generateSQL(intent, context);
            console.log(`⚡ SQL Local Generado: ${localSQL}`);
            
            const dbRows = await query(localSQL);
            return this.localEngine.formatResponse(intent, dbRows);

        } catch (error) {
            console.error("Kaizen Orchestrator Error:", error);
            return "Ocurrió un error interno procesando la solicitud. Por favor verifica los logs del servidor.";
        }
    }
}