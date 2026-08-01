import { PDFParse } from "pdf-parse";

/**
 * Extract plain text from a file buffer by MIME type.
 * - text/plain, text/markdown → content as-is (utf-8).
 * - application/pdf → pdf-parse; on any failure an empty string is returned
 *   (the caller still publishes pmos.files.text_extracted).
 * - everything else → empty string (no OCR for binary types yet).
 */
export async function extractText(mimeType: string, buffer: Buffer): Promise<string> {
  if (mimeType === "text/plain" || mimeType === "text/markdown") {
    return buffer.toString("utf8");
  }
  if (mimeType === "application/pdf") {
    let parser: PDFParse | null = null;
    try {
      parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      return result?.text ?? "";
    } catch {
      return "";
    } finally {
      await parser?.destroy().catch(() => {});
    }
  }
  return "";
}
