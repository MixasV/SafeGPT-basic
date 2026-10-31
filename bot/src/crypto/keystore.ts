import { scryptSync, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function encrypt(privateKey: string, password: string): { encrypted: string; salt: string; iv: string; authTag: string } {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(privateKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return { encrypted, salt: salt.toString("hex"), iv: iv.toString("hex"), authTag };
}

export function decrypt(encrypted: string, salt: string, iv: string, authTag: string, password: string): string {
  const key = scryptSync(password, Buffer.from(salt, "hex"), 32);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(authTag, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
