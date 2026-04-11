import { randomBytes, scryptSync } from "crypto";

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;

/** パスワードをハッシュ化（salt:hash 形式） */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

/** パスワードを検証 */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashToVerify = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return hash === hashToVerify;
}
