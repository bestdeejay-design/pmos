import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export interface ScanResult {
  imported: number;
  files: string[];
}

async function walk(dir: string, base: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // folder may be deleted between create and scan
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, base, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(relative(base, abs));
    }
  }
}

export async function scanFolder(folderPath: string): Promise<ScanResult> {
  const files: string[] = [];
  await walk(folderPath, folderPath, files);
  files.sort();
  return { imported: files.length, files };
}

export async function readFileContent(folderPath: string, relativePath: string): Promise<string> {
  try {
    const s = await stat(join(folderPath, relativePath));
    if (!s.isFile()) return "";
    const max = 512 * 1024;
    if (s.size > max) return "";
    const buf = await readFile(join(folderPath, relativePath));
    return buf.toString("utf8").slice(0, max);
  } catch {
    return "";
  }
}

export function toRelativePath(abs: string, base: string): string {
  return relative(base, abs).split(sep).join("/");
}
