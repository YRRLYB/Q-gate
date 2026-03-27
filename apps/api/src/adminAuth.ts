import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

export const ADMIN_COOKIE_NAME = "qgate_admin";

type AdminSessionPayload = {
  exp: number;
  nonce: string;
};

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string) {
  return createHmac("sha256", config.tokenSecret)
    .update(`admin:${payload}`)
    .digest("base64url");
}

export function issueAdminSession() {
  const payload: AdminSessionPayload = {
    exp: Date.now() + config.adminSessionTtlHours * 60 * 60 * 1000,
    nonce: randomUUID()
  };

  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);

  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt: payload.exp
  };
}

export function verifyAdminSession(token: string | undefined) {
  if (!token) {
    return false;
  }

  const [encodedPayload, receivedSignature] = token.split(".");
  if (!encodedPayload || !receivedSignature) {
    return false;
  }

  const expectedSignature = signPayload(encodedPayload);
  const receivedBuffer = Buffer.from(receivedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  if (!timingSafeEqual(receivedBuffer, expectedBuffer)) {
    return false;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as Partial<AdminSessionPayload>;
    return typeof payload.exp === "number" && payload.exp > Date.now() && typeof payload.nonce === "string";
  } catch {
    return false;
  }
}

export function readCookie(headers: Record<string, unknown>, name: string) {
  const raw = typeof headers.cookie === "string" ? headers.cookie : "";
  if (!raw) {
    return undefined;
  }

  const cookies = raw.split(";").map((item) => item.trim());
  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = cookie.slice(0, separatorIndex);
    if (key !== name) {
      continue;
    }

    return cookie.slice(separatorIndex + 1);
  }

  return undefined;
}

export function createAdminCookie(token: string, expiresAt: number) {
  const maxAge = Math.max(Math.floor((expiresAt - Date.now()) / 1000), 0);
  return `${ADMIN_COOKIE_NAME}=${token}; Max-Age=${maxAge}; Path=/api; HttpOnly; SameSite=Lax; Priority=High`;
}

export function createExpiredAdminCookie() {
  return `${ADMIN_COOKIE_NAME}=; Max-Age=0; Path=/api; HttpOnly; SameSite=Lax; Priority=High`;
}
