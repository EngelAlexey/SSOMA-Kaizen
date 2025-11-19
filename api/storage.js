// api/storage.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, "uploads");

export function ensureUploadDir() {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

export async function listStoredFiles() {
  try {
    ensureUploadDir();
    const files = await fs.promises.readdir(uploadsDir);
    const result = [];

    for (const name of files) {
      const fullPath = path.join(uploadsDir, name);
      const stats = await fs.promises.stat(fullPath);
      if (!stats.isFile()) continue;

      result.push({
        name,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      });
    }

    return result;
  } catch (e) {
    console.error("listStoredFiles error:", e);
    return [];
  }
}

export async function deleteExpiredFiles(ttlDays) {
  try {
    ensureUploadDir();
    const files = await fs.promises.readdir(uploadsDir);
    const deleted = [];

    const ttlMs = (ttlDays || 0) * 24 * 60 * 60 * 1000;
    const now = Date.now();

    for (const name of files) {
      const fullPath = path.join(uploadsDir, name);
      const stats = await fs.promises.stat(fullPath);
      if (!stats.isFile()) continue;

      if (ttlMs > 0 && now - stats.mtimeMs > ttlMs) {
        await fs.promises.unlink(fullPath);
        deleted.push(name);
      }
    }

    return deleted;
  } catch (e) {
    console.error("deleteExpiredFiles error:", e);
    return [];
  }
}
