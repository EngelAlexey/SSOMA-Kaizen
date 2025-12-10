// api/googleDrive.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, "uploads");

async function ensureDir() {
  await fs.promises.mkdir(uploadsDir, { recursive: true });
}

export async function downloadFileFromDrive(fileId) {
  try {
    if (!fileId) return null;

    await ensureDir();

    const url = `https://drive.google.com/uc?id=${encodeURIComponent(fileId)}`;

    const resp = await fetch(url); 
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error("Error descargando desde Drive:", resp.status, body);
      return null;
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    const filename = `${fileId}-${Date.now()}`;
    const filePath = path.join(uploadsDir, filename);

    await fs.promises.writeFile(filePath, buffer);
    return filePath;
  } catch (e) {
    console.error("downloadFileFromDrive error:", e);
    return null;
  }
}
