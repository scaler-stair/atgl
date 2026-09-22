import "server-only";
import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;
const N = 16384;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEYLEN, { N, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, , saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !keyB64) return false;
  const key = await scryptAsync(password, Buffer.from(saltB64, "base64"));
  const expected = Buffer.from(keyB64, "base64");
  return expected.length === key.length && timingSafeEqual(expected, key);
}

/** Password policy for the secure password lifecycle (Section 5). */
export function passwordProblems(pw: string): string[] {
  const p: string[] = [];
  if (pw.length < 12) p.push("at least 12 characters");
  if (!/[A-Z]/.test(pw)) p.push("an uppercase letter");
  if (!/[a-z]/.test(pw)) p.push("a lowercase letter");
  if (!/[0-9]/.test(pw)) p.push("a number");
  if (!/[^A-Za-z0-9]/.test(pw)) p.push("a symbol");
  return p;
}

export function generateTemporaryPassword(): string {
  const raw = randomBytes(12).toString("base64").replace(/[+/=]/g, "");
  return `Tmp-${raw.slice(0, 10)}#${randomInt(10, 100)}`;
}
