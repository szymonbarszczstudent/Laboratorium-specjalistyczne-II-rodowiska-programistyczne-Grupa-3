import { randomBytes, createHash } from "node:crypto";
import { hash, compare } from "bcryptjs";

export function hashPassword(plain: string) {
  return hash(plain, 10);
}

export function verifyPassword(plain: string, hashed: string) {
  return compare(plain, hashed);
}

export function newResetToken() {
  return randomBytes(32).toString("hex");
}

export function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
