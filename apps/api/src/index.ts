import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import {
  ADMIN_COOKIE_NAME,
  createAdminCookie,
  createExpiredAdminCookie,
  issueAdminSession,
  readCookie,
  verifyAdminSession
} from "./adminAuth.js";
import {
  consumeVerificationCode,
  createAttemptRecord,
  finalizeAttempt,
  getAttemptById,
  getAttemptByVerificationCodeHash,
  getQuizBySlug,
  hasActiveVerificationCodeHash,
  listQuizzes,
  parseQuizYaml,
  syncSeedQuizFromFile,
  watchSeedQuizFile
} from "./db.js";
import {
  adminLoginSchema,
  answerSubmissionSchema,
  createAnswerSignature,
  hashQq,
  normalizeAnswerValue,
  normalizePlayerName,
  normalizeTextAnswer,
  startAttemptSchema,
  verifyTokenSchema
} from "./schema.js";
import { hashVerificationCode, issueVerificationCode, verifyVerificationCode } from "./security.js";
import {
  getSiteSettings,
  parseSiteSettingsYaml,
  readSiteSettingsYaml,
  syncSiteSettingsFromFile,
  watchSiteSettingsFile,
  writeSiteSettingsYaml
} from "./site.js";

const app = Fastify({ logger: true });

try {
  const quiz = syncSeedQuizFromFile();

  if (quiz) {
    app.log.info({ slug: quiz.meta.slug }, "seed quiz loaded from yaml");
  }
} catch (error) {
  app.log.error(error, "failed to load seed quiz from yaml on startup");
}

try {
  const siteSettings = syncSiteSettingsFromFile();

  if (siteSettings) {
    app.log.info({ brand: siteSettings.brand.name }, "site settings loaded from yaml");
  }
} catch (error) {
  app.log.error(error, "failed to load site settings from yaml on startup");
}

watchSeedQuizFile({
  onReload(slug) {
    app.log.info({ slug }, "seed quiz hot reloaded from yaml");
  },
  onError(error) {
    app.log.error(error, "failed to hot reload seed quiz from yaml");
  }
});

watchSiteSettingsFile({
  onReload() {
    app.log.info("site settings hot reloaded from yaml");
  },
  onError(error) {
    app.log.error(error, "failed to hot reload site settings from yaml");
  }
});

function cloneQuestion(question: NonNullable<ReturnType<typeof getQuizBySlug>>["questions"][number]) {
  return {
    ...question,
    media: question.media ? { ...question.media } : undefined,
    options: question.options ? question.options.map((option) => ({ ...option })) : undefined,
    answer: [...question.answer],
    answerDisplay: [...question.answerDisplay]
  };
}

function shuffleArray<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}

function selectRandomQuestions(quiz: NonNullable<ReturnType<typeof getQuizBySlug>>) {
  const bank = quiz.questions.map(cloneQuestion);
  const selected: typeof bank = [];
  const pickedIds = new Set<string>();

  const pickFrom = (type: "single" | "multiple" | "text", count?: number) => {
    if (!count || count <= 0) {
      return;
    }

    const candidates = shuffleArray(bank.filter((question) => question.type === type && !pickedIds.has(question.id))).slice(0, count);
    candidates.forEach((question) => {
      pickedIds.add(question.id);
      selected.push(question);
    });
  };

  pickFrom("single", quiz.meta.drawSingleCount);
  pickFrom("multiple", quiz.meta.drawMultipleCount);
  pickFrom("text", quiz.meta.drawTextCount);

  if (quiz.meta.drawCount && selected.length < quiz.meta.drawCount) {
    const remaining = shuffleArray(bank.filter((question) => !pickedIds.has(question.id))).slice(0, quiz.meta.drawCount - selected.length);
    remaining.forEach((question) => {
      pickedIds.add(question.id);
      selected.push(question);
    });
  }

  if (selected.length === 0) {
    if (quiz.meta.drawCount) {
      return shuffleArray(bank).slice(0, quiz.meta.drawCount);
    }

    return shuffleArray(bank);
  }

  return quiz.meta.shuffleQuestions ? shuffleArray(selected) : selected;
}

function createAttemptQuiz(quiz: NonNullable<ReturnType<typeof getQuizBySlug>>) {
  const selectedQuestions = quiz.meta.selectionMode === "random" ? selectRandomQuestions(quiz) : quiz.questions.map(cloneQuestion);
  const finalQuestions = quiz.meta.selectionMode === "fixed" && quiz.meta.shuffleQuestions ? shuffleArray(selectedQuestions) : selectedQuestions;

  const publicQuestions = finalQuestions.map((question, index) => ({
    id: question.id,
    type: question.type,
    group: question.group,
    prompt: question.prompt,
    description: question.description,
    placeholder: question.placeholder,
    inputStyle: question.inputStyle,
    points: question.points,
    index,
    media: question.media,
    options: question.options
  }));

  return {
    publicQuiz: {
      ...quiz.meta,
      questionBankSize: quiz.questionBankSize,
      displayQuestionCount: publicQuestions.length,
      questions: publicQuestions
    },
    snapshot: {
      meta: {
        ...quiz.meta,
        questionBankSize: quiz.questionBankSize,
        displayQuestionCount: publicQuestions.length
      },
      questions: finalQuestions.map(cloneQuestion)
    }
  };
}

function toPublicQuizPreview(quiz: NonNullable<ReturnType<typeof getQuizBySlug>>) {
  return {
    ...quiz.meta,
    questionBankSize: quiz.questionBankSize,
    displayQuestionCount: quiz.displayQuestionCount,
    questions: quiz.questions.map((question, index) => ({
      id: question.id,
      type: question.type,
      group: question.group,
      prompt: question.prompt,
      description: question.description,
      placeholder: question.placeholder,
      inputStyle: question.inputStyle,
      points: question.points,
      index,
      media: question.media,
      options: question.options
    }))
  };
}

function createUniqueVerificationCode() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const issued = issueVerificationCode();

    if (!hasActiveVerificationCodeHash(issued.codeHash)) {
      return issued;
    }
  }

  throw new Error("verification_code_generation_failed");
}

type SnapshotQuestion = NonNullable<ReturnType<typeof getQuizBySlug>>["questions"][number];

function formatSubmittedAnswer(question: SnapshotQuestion, submitted: string | string[] | undefined) {
  if (question.type === "text") {
    return Array.isArray(submitted) ? (submitted[0] ?? "未作答") : (submitted ?? "未作答");
  }

  const selectedKeys = Array.isArray(submitted) ? submitted : submitted ? [submitted] : [];

  if (selectedKeys.length === 0) {
    return "未作答";
  }

  return selectedKeys
    .map((key) => {
      const option = question.options?.find((item: { key: string; text: string }) => item.key === key);
      return option ? `${option.key}. ${option.text}` : key;
    })
    .join(" / ");
}

function isLanHostname(hostname: string) {
  const normalized = hostname.toLowerCase();

  if (["localhost", "127.0.0.1", "::1"].includes(normalized) || normalized.endsWith(".local")) {
    return true;
  }

  if (/^[a-z0-9-]+$/i.test(normalized) && !normalized.includes(".")) {
    return true;
  }

  const ipv4Match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) {
    return false;
  }

  const octets = ipv4Match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

const parsedAllowedOrigins = config.appOrigins
  .map((origin) => {
    try {
      const parsed = new URL(origin);
      return {
        origin: parsed.origin,
        hostname: parsed.hostname
      };
    } catch {
      return null;
    }
  })
  .filter(Boolean) as Array<{ origin: string; hostname: string }>;

const allowedOrigins = new Set(parsedAllowedOrigins.map((item) => item.origin));
const allowLanOrigins = parsedAllowedOrigins.some((item) => isLanHostname(item.hostname));

await app.register(cors, {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    try {
      const parsedOrigin = new URL(origin);
      const normalizedOrigin = parsedOrigin.origin;

      if (allowedOrigins.has(normalizedOrigin) || (allowLanOrigins && isLanHostname(parsedOrigin.hostname))) {
        callback(null, true);
        return;
      }

      callback(new Error("origin_not_allowed"), false);
    } catch {
      callback(new Error("invalid_origin"), false);
    }
  },
  credentials: true
});

await app.register(rateLimit, {
  max: 40,
  timeWindow: "1 minute"
});

function isAdminAuthorized(headers: Record<string, unknown>) {
  return verifyAdminSession(readCookie(headers, ADMIN_COOKIE_NAME));
}

function assertAdminRequest(headers: Record<string, unknown>, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) {
  if (!isAdminAuthorized(headers)) {
    reply.code(401).send({ message: "unauthorized" });
    return false;
  }

  return true;
}

app.get("/api/health", async () => ({
  ok: true
}));

app.get("/api/public/site-settings", async (_request, reply) => {
  const siteSettings = getSiteSettings();

  if (!siteSettings) {
    return reply.code(404).send({ message: "site_settings_not_found" });
  }

  return siteSettings;
});

app.get("/api/public/quizzes", async () => ({
  items: listQuizzes()
}));

app.get("/api/public/quizzes/:slug", async (request, reply) => {
  const params = request.params as { slug: string };
  const quiz = getQuizBySlug(params.slug);

  if (!quiz) {
    return reply.code(404).send({ message: "quiz_not_found" });
  }

  return toPublicQuizPreview(quiz);
});

app.post("/api/public/start", async (request, reply) => {
  const payload = startAttemptSchema.parse(request.body);
  const quiz = getQuizBySlug(payload.quizSlug);

  if (!quiz) {
    return reply.code(404).send({ message: "quiz_not_found" });
  }

  const attemptId = `att_${randomUUID()}`;
  const playerName = normalizePlayerName(payload.playerName);
  const attemptQuiz = createAttemptQuiz(quiz);

  createAttemptRecord({
    id: attemptId,
    quizSlug: payload.quizSlug,
    qqHash: hashQq(payload.qq),
    playerName,
    startedAt: new Date().toISOString(),
    quizSnapshot: attemptQuiz.snapshot
  });

  return {
    attemptId,
    quiz: attemptQuiz.publicQuiz
  };
});

app.post("/api/public/attempts/:attemptId/submit", async (request, reply) => {
  const params = request.params as { attemptId: string };
  const payload = answerSubmissionSchema.parse(request.body);
  const attempt = getAttemptById(params.attemptId);

  if (!attempt) {
    return reply.code(404).send({ message: "attempt_not_found" });
  }

  if (attempt.status !== "active") {
    return reply.code(409).send({ message: "attempt_closed" });
  }

  const snapshot = attempt.quizSnapshot;
  const quiz = getQuizBySlug(attempt.quizSlug);
  const runtimeQuiz = snapshot
    ? snapshot
    : quiz
      ? { meta: { ...quiz.meta, questionBankSize: quiz.questionBankSize, displayQuestionCount: quiz.displayQuestionCount }, questions: quiz.questions }
      : null;

  if (!runtimeQuiz) {
    return reply.code(404).send({ message: "quiz_not_found" });
  }

  const totalPoints = runtimeQuiz.questions.reduce((sum, question) => sum + question.points, 0);
  let earnedPointsTotal = 0;
  const graded = runtimeQuiz.questions.map((question) => {
    const submitted = payload.answers[question.id];
    let accepted = false;

    if (question.answerMode === "containsAll") {
      const normalizedText = normalizeTextAnswer(Array.isArray(submitted) ? (submitted[0] ?? "") : (submitted ?? ""));
      accepted = question.answer.every((fragment) => normalizedText.includes(fragment));
    } else {
      const normalized = normalizeAnswerValue(question.type, submitted ?? "");
      const signature = createAnswerSignature(normalized);
      accepted = question.answer.includes(signature);
    }

    const earnedPoints = accepted ? question.points : 0;
    earnedPointsTotal += earnedPoints;

    return {
      id: question.id,
      prompt: question.prompt,
      correct: accepted,
      earnedPoints,
      points: question.points,
      submittedAnswer: formatSubmittedAnswer(question, submitted),
      correctAnswer: question.answerDisplay.join(" / ")
    };
  });

  const score = Math.round((earnedPointsTotal / totalPoints) * 100);
  const passed = score >= runtimeQuiz.meta.passScore;

  if (!passed) {
    finalizeAttempt({
      attemptId: attempt.id,
      status: "failed",
      score,
      submittedAt: new Date().toISOString()
    });

    return {
      passed: false,
      score,
      maxScore: 100,
      passScore: runtimeQuiz.meta.passScore,
      earnedPointsTotal,
      totalPoints,
      graded
    };
  }

  const issued = createUniqueVerificationCode();

  finalizeAttempt({
    attemptId: attempt.id,
    status: "passed",
    score,
    submittedAt: new Date().toISOString(),
    verificationCodeHash: issued.codeHash,
    verificationExpiresAt: issued.expiresAt
  });

  return {
    passed: true,
    score,
    maxScore: 100,
    passScore: runtimeQuiz.meta.passScore,
    earnedPointsTotal,
    totalPoints,
    verificationCode: issued.code,
    expiresAt: issued.expiresAt,
    graded
  };
});

app.post("/api/integrations/verify", async (request, reply) => {
  const payload = verifyTokenSchema.parse(request.body);
  const codeHash = hashVerificationCode(payload.code);
  const attempt = getAttemptByVerificationCodeHash(codeHash);

  if (!attempt || attempt.status !== "passed") {
    return reply.code(404).send({ valid: false, status: "not_found" });
  }

  if (!attempt.verificationCodeHash || !verifyVerificationCode(payload.code, attempt.verificationCodeHash)) {
    return reply.code(400).send({ valid: false, status: "invalid" });
  }

  if (attempt.verificationStatus === "consumed") {
    return reply.code(409).send({ valid: false, status: "already_used" });
  }

  if (!attempt.verificationExpiresAt || attempt.verificationExpiresAt < Date.now()) {
    return reply.code(410).send({ valid: false, status: "expired" });
  }

  const qqMatch = attempt.qqHash === hashQq(payload.qq);
  const playerMatch = attempt.playerName === normalizePlayerName(payload.playerName);

  if (!qqMatch || !playerMatch) {
    return reply.code(403).send({ valid: false, status: "mismatch" });
  }

  consumeVerificationCode(codeHash);

  return {
    valid: true,
    status: "accepted",
    attemptId: attempt.id,
    quizSlug: attempt.quizSlug,
    score: attempt.score
  };
});

app.post(
  "/api/admin/session",
  {
    config: {
      rateLimit: {
        max: 8,
        timeWindow: "1 minute"
      }
    }
  },
  async (request, reply) => {
    const payload = adminLoginSchema.parse(request.body);

    if (payload.password !== config.adminPassword) {
      return reply.code(401).send({ message: "unauthorized" });
    }

    const issued = issueAdminSession();
    reply.header("Set-Cookie", createAdminCookie(issued.token, issued.expiresAt));

    return {
      ok: true,
      expiresAt: issued.expiresAt
    };
  }
);

app.delete("/api/admin/session", async (_request, reply) => {
  reply.header("Set-Cookie", createExpiredAdminCookie());
  return {
    ok: true
  };
});

app.get("/api/admin/quizzes", async (request, reply) => {
  if (!assertAdminRequest(request.headers as Record<string, unknown>, reply)) {
    return;
  }

  return {
    items: listQuizzes()
  };
});

app.get("/api/admin/seed", async (request, reply) => {
  if (!assertAdminRequest(request.headers as Record<string, unknown>, reply)) {
    return;
  }

  if (!existsSync(config.quizSeedFile)) {
    return reply.code(404).send({ message: "seed_not_found" });
  }

  return {
    yaml: readFileSync(config.quizSeedFile, "utf8")
  };
});

app.post("/api/admin/quizzes/import", async (request, reply) => {
  if (!assertAdminRequest(request.headers as Record<string, unknown>, reply)) {
    return;
  }

  const body = request.body as { yaml?: string };

  if (!body?.yaml) {
    return reply.code(400).send({ message: "yaml_required" });
  }

  parseQuizYaml(body.yaml);
  writeFileSync(config.quizSeedFile, body.yaml, "utf8");
  const quiz = syncSeedQuizFromFile();

  if (!quiz) {
    return reply.code(500).send({ message: "seed_sync_failed" });
  }

  return {
    ok: true,
    quiz
  };
});

app.get("/api/admin/site-settings", async (request, reply) => {
  if (!assertAdminRequest(request.headers as Record<string, unknown>, reply)) {
    return;
  }

  const yaml = readSiteSettingsYaml();
  if (!yaml) {
    return reply.code(404).send({ message: "site_settings_not_found" });
  }

  return {
    yaml
  };
});

app.post("/api/admin/site-settings/import", async (request, reply) => {
  if (!assertAdminRequest(request.headers as Record<string, unknown>, reply)) {
    return;
  }

  const body = request.body as { yaml?: string };
  if (!body?.yaml) {
    return reply.code(400).send({ message: "yaml_required" });
  }

  parseSiteSettingsYaml(body.yaml);
  const siteSettings = writeSiteSettingsYaml(body.yaml);

  return {
    ok: true,
    siteSettings
  };
});

app.setErrorHandler((error: Error & { issues?: unknown }, _request, reply) => {
  app.log.error(error);
  const validationError = Array.isArray(error.issues);
  reply.code(validationError ? 400 : 500).send({
    message: validationError ? "validation_error" : "internal_error",
    detail: error.message
  });
});

await app.listen({
  port: config.port,
  host: "0.0.0.0"
});
