import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  resolve(moduleDir, "../.env"),
  resolve(process.cwd(), "apps/api/.env"),
  resolve(process.cwd(), ".env")
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
  ADMIN_KEY: z.string().min(6).default("change-me"),
  ADMIN_PASSWORD: z.string().min(6).optional(),
  TOKEN_SECRET: z.string().min(16).default("replace-with-a-long-random-string"),
  DATA_DIR: z.string().default("./data/runtime"),
  QUIZ_SEED_FILE: z.string().default("./data/starter-quiz.yaml"),
  SITE_SETTINGS_FILE: z.string().default("./data/site-settings.yaml"),
  TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(20),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12)
});

const parsed = envSchema.parse(process.env);

const dataDir = resolve(process.cwd(), parsed.DATA_DIR);
mkdirSync(dataDir, { recursive: true });

export const config = {
  port: parsed.PORT,
  appOrigins: parsed.APP_ORIGIN.split(",").map((item) => item.trim()).filter(Boolean),
  adminPassword: parsed.ADMIN_PASSWORD?.trim() || parsed.ADMIN_KEY,
  tokenSecret: parsed.TOKEN_SECRET,
  dataDir,
  quizSeedFile: resolve(process.cwd(), parsed.QUIZ_SEED_FILE),
  runtimeDbFile: resolve(dataDir, "runtime.sqlite"),
  siteSettingsFile: resolve(process.cwd(), parsed.SITE_SETTINGS_FILE),
  tokenTtlMinutes: parsed.TOKEN_TTL_MINUTES,
  adminSessionTtlHours: parsed.ADMIN_SESSION_TTL_HOURS
};
