import { describe, it, expect } from "vitest";
import { extractText } from "../src/lib/text-extract.js";

/** Build a minimal valid one-page PDF with a single text line (proper xref offsets). */
function buildPdf(text: string): Buffer {
  const objs: string[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objs[3] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>";
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  objs[4] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  objs[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = Buffer.byteLength(pdf);
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(pdf);
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

describe("extractText", () => {
  it("returns text/plain content as-is", async () => {
    expect(await extractText("text/plain", Buffer.from("hello world"))).toBe("hello world");
  });

  it("returns text/markdown content as-is", async () => {
    expect(await extractText("text/markdown", Buffer.from("# Title\nbody"))).toBe("# Title\nbody");
  });

  it("extracts text from a valid application/pdf", async () => {
    const text = await extractText("application/pdf", buildPdf("HELLO_FROM_PDF"));
    expect(text).toContain("HELLO_FROM_PDF");
  });

  it("returns empty string when pdf parsing fails", async () => {
    expect(await extractText("application/pdf", Buffer.from("this is not a pdf"))).toBe("");
  });

  it("returns empty string for unsupported types", async () => {
    expect(await extractText("image/png", Buffer.from([1, 2, 3]))).toBe("");
    expect(await extractText("application/octet-stream", Buffer.from("x"))).toBe("");
  });
});
