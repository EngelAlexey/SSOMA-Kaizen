import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSIONS_FILE = path.join(__dirname, "sessions.json");

export function loadSessions() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return new Map();
    const raw = fs.readFileSync(SESSIONS_FILE, "utf8");
    const data = JSON.parse(raw);
    return new Map(Object.entries(data));
  } catch (e) {
    console.error("Error cargando sessions:", e);
    return new Map();
  }
}

export function saveSessions(sessions) {
  try {
    const obj = Object.fromEntries(sessions);
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), "utf8");
  } catch (e) {
    console.error("Error guardando sessions:", e);
  }
}
