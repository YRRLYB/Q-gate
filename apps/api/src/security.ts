import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

export function hashVerificationCode(code: string) {
  return createHmac("sha256", config.tokenSecret)
    .update(`verify:${code}`)
    .digest("hex");
}

export function issueVerificationCode() {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");

  return {
    code,
    codeHash: hashVerificationCode(code),
    expiresAt: Date.now() + config.tokenTtlMinutes * 60 * 1000,
  };
}

export function verifyVerificationCode(code: string, expectedHash: string) {
  const receivedHash = hashVerificationCode(code);

  return timingSafeEqual(
    Buffer.from(receivedHash, "utf8"),
    Buffer.from(expectedHash, "utf8"),
  );
}
