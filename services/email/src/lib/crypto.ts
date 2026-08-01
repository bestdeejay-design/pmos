import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const KEY = process.env.EMAIL_ENCRYPTION_KEY ?? "dev-key-change-me";
const IV_LEN = 12; // 96 bits — recommended for AES-GCM
const PREFIX = "enc";

function key(): Buffer {
  return createHash("sha256").update(KEY).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const [prefix, ivB64, tagB64, dataB64] = payload.split(":");
  if (prefix !== PREFIX || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("invalid encrypted payload");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return dec.toString("utf8");
}
