import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  resolve(moduleDir, "../.env"),
  resolve(process.cwd(), "apps/api/.env"),
  resolve(process.cwd(), ".env"),
];

for (const candidate of envCandidates) {
  if (existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4100),
  APP_ORIGIN: z.string().default("http://localhost:5173"),
  ADMIN_KEY: z.string().min(8).optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  TOKEN_SECRET: z.string().min(24),
  DATA_DIR: z.string().default("./data/runtime"),
  QUIZ_SEED_FILE: z.string().default("./data/starter-quiz.yaml"),
  SITE_SETTINGS_FILE: z.string().default("./data/site-settings.yaml"),
  TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(20),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  ATTEMPT_RETRY_COOLDOWN_MINUTES: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(15),
  ATTEMPT_MAX_PER_WINDOW: z.coerce.number().int().positive().default(5),
  ATTEMPT_WINDOW_HOURS: z.coerce.number().int().positive().default(24),
});

const parsed = envSchema.parse(process.env);
const adminPassword = parsed.ADMIN_PASSWORD?.trim() || parsed.ADMIN_KEY?.trim();

if (!adminPassword) {
  throw new Error(
    "Q-gate requires ADMIN_PASSWORD (or legacy ADMIN_KEY) to be set before startup.",
  );
}

const forbiddenAdminPasswords = new Set([
  "change-me",
  "replace-with-your-password",
  "review-key-080806",
  "change-this-admin-password-now",
]);

if (forbiddenAdminPasswords.has(adminPassword)) {
  throw new Error(
    "Q-gate refuses to start with a known default admin password. Set a unique ADMIN_PASSWORD first.",
  );
}

const tokenSecret = parsed.TOKEN_SECRET.trim();
const forbiddenTokenSecrets = new Set([
  "replace-with-a-long-random-string",
  "replace-with-a-very-long-random-secret",
  "change-this-token-secret-to-a-long-random-value",
]);

if (forbiddenTokenSecrets.has(tokenSecret)) {
  throw new Error(
    "Q-gate refuses to start with a placeholder TOKEN_SECRET. Set a long random secret first.",
  );
}

const dataDir = resolve(process.cwd(), parsed.DATA_DIR);
mkdirSync(dataDir, { recursive: true });
const avatarCacheDir = resolve(dataDir, "avatar-cache");
mkdirSync(avatarCacheDir, { recursive: true });

export const config = {
  port: parsed.PORT,
  appOrigins: parsed.APP_ORIGIN.split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  adminPassword,
  tokenSecret,
  dataDir,
  avatarCacheDir,
  quizSeedFile: resolve(process.cwd(), parsed.QUIZ_SEED_FILE),
  runtimeDbFile: resolve(dataDir, "runtime.sqlite"),
  siteSettingsFile: resolve(process.cwd(), parsed.SITE_SETTINGS_FILE),
  tokenTtlMinutes: parsed.TOKEN_TTL_MINUTES,
  adminSessionTtlHours: parsed.ADMIN_SESSION_TTL_HOURS,
  attemptRetryCooldownMinutes: parsed.ATTEMPT_RETRY_COOLDOWN_MINUTES,
  attemptMaxPerWindow: parsed.ATTEMPT_MAX_PER_WINDOW,
  attemptWindowHours: parsed.ATTEMPT_WINDOW_HOURS,
};
