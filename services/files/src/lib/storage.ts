import { access, mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Hard upload cap (contract: 50MB). */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

// services/files/ root (src/lib → ../..). Relative UPLOAD_DIR is resolved here.
const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Resolve the upload directory. UPLOAD_DIR may be absolute or relative to services/files/. */
export function resolveUploadDir(): string {
  const raw = process.env.UPLOAD_DIR ?? "./data/uploads";
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(serviceRoot, raw);
}

/** Create the upload dir (idempotent) and return its path. */
export async function ensureUploadDir(dir: string = resolveUploadDir()): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}

/** True if a stored file exists on disk. */
export async function storedFileExists(storagePath: string): Promise<boolean> {
  try {
    await access(storagePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a stored file. When `limit` is given, reads at most that many bytes
 * from the start (used to bound text extraction to ~1MB).
 */
export async function readStoredFile(storagePath: string, limit?: number): Promise<Buffer> {
  const fh = await open(storagePath, "r");
  try {
    if (limit !== undefined) {
      const buf = Buffer.alloc(limit);
      const { bytesRead } = await fh.read(buf, 0, limit, 0);
      return buf.subarray(0, bytesRead);
    }
    const { size } = await fh.stat();
    const buf = Buffer.alloc(size);
    await fh.read(buf, 0, size, 0);
    return buf;
  } finally {
    await fh.close();
  }
}

/** Best-effort physical deletion. ENOENT (already gone) is ignored. */
export async function deleteStoredFile(storagePath: string): Promise<void> {
  try {
    await unlink(storagePath);
  } catch (e) {
    const code = e instanceof Error && "code" in e ? (e as NodeJS.ErrnoException).code : undefined;
    if (code !== "ENOENT") throw e;
  }
}
