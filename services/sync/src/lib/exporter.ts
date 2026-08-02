import { join } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { syncFolders } from "../db/schema.js";

export interface ExportedNote {
  id?: string;
  title?: string;
  tags?: string[];
  createdAt?: string;
  isArchived?: boolean;
  bodyMd?: string;
}

function frontmatter(line: string): string {
  return `---\n${line}\n---\n`;
}

function escapeYaml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/** Deterministic markdown document for a note (note id in filename keeps re-exports stable). */
function noteToMarkdown(note: ExportedNote): string {
  const title = note.title ?? "Untitled";
  const tags = Array.isArray(note.tags) ? note.tags : [];
  const fm = [
    `title: "${escapeYaml(title)}"`,
    `tags: [${tags.map((t) => `"${escapeYaml(String(t))}"`).join(", ")}]`,
    note.id ? `note_id: "${note.id}"` : null,
    note.isArchived ? `archived: true` : null,
  ].filter(Boolean).join("\n");
  return `${frontmatter(fm)}\n${note.bodyMd ?? ""}\n`;
}

export function noteFilename(noteId: string): string {
  return `${noteId}.md`;
}

/** Find folders configured for auto-export (explicitly autoExport: true). */
export async function autoExportFolders(): Promise<Array<{ id: string; path: string }>> {
  const rows = await db.select().from(syncFolders).where(eq(syncFolders.autoExport, true));
  return rows.map((r) => ({ id: r.id, path: r.path }));
}

/**
 * Write every note change to each auto-export folder. Idempotent: file is keyed by
 * note id and fully overwritten, so processing a duplicate event yields the same bytes.
 */
export async function writeNoteExport(note: ExportedNote): Promise<number> {
  if (!note.id) return 0;
  const folders = await autoExportFolders();
  const file = noteFilename(note.id);
  const content = noteToMarkdown(note);
  let count = 0;
  for (const folder of folders) {
    try {
      await mkdir(folder.path, { recursive: true });
      await writeFile(join(folder.path, file), content, "utf8");
      count += 1;
    } catch {
      // Folder may be missing or unwritable — skip silently (best-effort sync).
    }
  }
  return count;
}

/** Remove a note's export file from every auto-export folder. */
export async function deleteNoteExport(noteId: string | undefined): Promise<number> {
  if (!noteId) return 0;
  const folders = await autoExportFolders();
  const file = noteFilename(noteId);
  let count = 0;
  for (const folder of folders) {
    try {
      await rm(join(folder.path, file), { force: true });
      count += 1;
    } catch {
      // Best-effort — missing file is treated as success.
    }
  }
  return count;
}