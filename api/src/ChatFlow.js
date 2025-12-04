import { GoogleGenerativeAI } from "@google/generative-ai";
import { query } from "./db.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-001" });

export class ChatOrchestrator {
  constructor() {
    this.history = [];
  }

  async handleUserMessage(userMessage, databaseId) {
    try {
      if (!databaseId) {
        return await this.handleGeneralQuery(userMessage);
      }

      const intent = await this.determineIntent(userMessage);

      if (intent === 'DATA_QUERY') {
        return await this.handleDataQuery(userMessage, databaseId);
      } else {
        return await this.handleGeneralQuery(userMessage);
      }
    } catch (error) {
      console.error(error);
      return "Lo siento, ocurrió un error interno al procesar tu mensaje.";
    }
  }

  async determineIntent(message) {
    const prompt = `
      Clasifica el siguiente mensaje en una categoría: "DATA_QUERY" (si pide datos, conteos, listas, estados de la base de datos) o "GENERAL" (saludos, preguntas generales, ayuda).
      Mensaje: "${message}"
      Responde SOLO con la categoría.
    `;

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim().toUpperCase();
      if (text.includes("DATA_QUERY")) return "DATA_QUERY";
      return "GENERAL";
    } catch (e) {
      return "GENERAL";
    }
  }

  async handleDataQuery(message, databaseId) {
    const sqlPrompt = `
      Eres un experto en SQL MySQL. Genera una consulta SQL válida.
      ID Cliente: "${databaseId}"
      
      Reglas Estrictas:
      1. TODAS las tablas deben tener el prefijo "${databaseId}_". Ejemplo: Si buscas usuarios, la tabla es "${databaseId}_akUsers".
      2. No uses markdown. No uses bloques de código.
      3. No des explicaciones. Devuelve SOLO el SQL.
      
      Esquema base (agrega el prefijo "${databaseId}_" a todo):
      - akUsers (usID, usName, usLicense, usStatus, usType)
      
      Pregunta: "${message}"
      SQL:
    `;

    try {
      const result = await model.generateContent(sqlPrompt);
      let sqlQuery = result.response.text();
      
      sqlQuery = sqlQuery.replace(/```sql/gi, '').replace(/```/g, '').trim();
      
      const sqlMatch = sqlQuery.match(/(SELECT|INSERT|UPDATE|DELETE|SHOW|COUNT)[\s\S]*?;/i);
      if (sqlMatch) {
        sqlQuery = sqlMatch[0];
      }

      console.log(`SQL Ejecutado: ${sqlQuery}`);

      const dbResults = await query(sqlQuery);

      const naturalResponsePrompt = `
        Pregunta: "${message}"
        Resultados DB: ${JSON.stringify(dbResults)}
        Responde al usuario amablemente resumiendo estos datos.
      `;
      
      const finalRes = await model.generateContent(naturalResponsePrompt);
      return finalRes.response.text();

    } catch (error) {
      console.error(error);
      return "No pude consultar los datos. Verifica que tu consulta sea válida para los datos disponibles.";
    }
  }

  async handleGeneralQuery(message) {
    try {
        const prompt = `
            Eres un asistente virtual experto en SSOMA.
            Consulta: "${message}"
            Responde de manera útil y profesional.
        `;
        
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (e) {
        return "Lo siento, no puedo responder a eso ahora.";
    }
  }
}