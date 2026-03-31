import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, watchFile } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { config } from "./config.js";
import {
  QuizDocument,
  QuizMedia,
  QuizQuestion,
  createAnswerSignature,
  normalizeAnswerValue,
  normalizeQuestionGroup,
  normalizeTextAnswer,
  quizDocumentSchema,
} from "./schema.js";

export type StoredQuestion = {
  id: string;
  type: QuizQuestion["type"];
  group: "objective" | "subjective";
  prompt: string;
  description?: string;
  placeholder?: string;
  inputStyle?: "short" | "essay";
  points: number;
  media?: QuizMedia;
  options?: Array<{ key: string; text: string }>;
  answer: string[];
  answerDisplay: string[];
  answerMode: "exact" | "containsAll";
  orderIndex: number;
};

export type StoredQuizMeta = QuizDocument["meta"] & { updatedAt: string };

export type StoredQuiz = {
  meta: StoredQuizMeta;
  sourceYaml: string;
  questions: StoredQuestion[];
};

export type AttemptQuizSnapshot = {
  meta: Omit<StoredQuizMeta, "updatedAt"> & {
    questionBankSize: number;
    displayQuestionCount: number;
  };
  questions: StoredQuestion[];
};

export type AttemptRecord = {
  id: string;
  quizSlug: string;
  qqHash: string;
  qqMask: string | null;
  playerName: string;
  startedAt: string;
  submittedAt: string | null;
  status: "active" | "passed" | "failed";
  score: number | null;
  verificationCodeHash: string | null;
  verificationExpiresAt: number | null;
  verificationStatus: "issued" | "consumed" | null;
  quizSnapshot?: AttemptQuizSnapshot;
};

type RuntimeState = {
  quizzes: Record<string, StoredQuiz>;
  attempts: Record<
    string,
    AttemptRecord & { proofJti?: string | null; proofStatus?: string | null }
  >;
};

type QuizRow = {
  slug: string;
  meta_json: string;
  source_yaml: string;
  questions_json: string;
  updated_at: string;
};

type AttemptRow = {
  id: string;
  quiz_slug: string;
  qq_hash: string;
  qq_mask: string | null;
  player_name: string;
  started_at: string;
  submitted_at: string | null;
  status: AttemptRecord["status"];
  score: number | null;
  verification_code_hash: string | null;
  verification_expires_at: number | null;
  verification_status: AttemptRecord["verificationStatus"];
  quiz_snapshot_json: string | null;
};

const legacyStatePath = join(config.dataDir, "state.json");

mkdirSync(config.dataDir, { recursive: true });

const db = new DatabaseSync(config.runtimeDbFile);
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS quizzes (
    slug TEXT PRIMARY KEY,
    meta_json TEXT NOT NULL,
    source_yaml TEXT NOT NULL,
    questions_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY,
    quiz_slug TEXT NOT NULL,
    qq_hash TEXT NOT NULL,
    qq_mask TEXT,
    player_name TEXT NOT NULL,
    started_at TEXT NOT NULL,
    submitted_at TEXT,
    status TEXT NOT NULL,
    score INTEGER,
    verification_code_hash TEXT,
    verification_expires_at INTEGER,
    verification_status TEXT,
    quiz_snapshot_json TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_quizzes_updated_at ON quizzes(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_attempts_quiz_identity ON attempts(quiz_slug, qq_hash, player_name, status);
  CREATE INDEX IF NOT EXISTS idx_attempts_quiz_identity_submitted ON attempts(quiz_slug, qq_hash, player_name, submitted_at DESC);
  CREATE INDEX IF NOT EXISTS idx_attempts_verification_code_hash ON attempts(verification_code_hash);
`);

function ensureColumn(
  tableName: string,
  columnName: string,
  definition: string,
) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name?: string;
  }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

ensureColumn("attempts", "qq_mask", "qq_mask TEXT");

function parseJson<T>(value: string | null | undefined, fallback: T) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function cloneQuestion(question: StoredQuestion): StoredQuestion {
  return {
    ...question,
    media: question.media ? { ...question.media } : undefined,
    options: question.options
      ? question.options.map((option) => ({ ...option }))
      : undefined,
    answer: [...question.answer],
    answerDisplay: [...question.answerDisplay],
  };
}

function getDisplayQuestionCount(
  meta: QuizDocument["meta"],
  totalCount: number,
) {
  if (meta.selectionMode !== "random") {
    return totalCount;
  }

  const byTypeCount = [
    meta.drawSingleCount ?? 0,
    meta.drawMultipleCount ?? 0,
    meta.drawTextCount ?? 0,
  ]
    .filter((count) => count > 0)
    .reduce((sum, count) => sum + count, 0);

  return (meta.drawCount ?? byTypeCount) || totalCount;
}

function toStoredQuiz(document: QuizDocument, sourceYaml: string): StoredQuiz {
  const now = new Date().toISOString();

  return {
    meta: {
      ...document.meta,
      updatedAt: now,
    },
    sourceYaml,
    questions: document.questions.map((question, index) => {
      const answerDisplay =
        question.type === "text"
          ? [...question.answer]
          : question.options
              .filter((option) => question.answer.includes(option.key))
              .map((option) => `${option.key}. ${option.text}`);

      return {
        id: question.id,
        type: question.type,
        group: normalizeQuestionGroup(question),
        prompt: question.prompt,
        description: question.description,
        placeholder: question.placeholder,
        inputStyle: question.type === "text" ? question.inputStyle : undefined,
        points: question.points,
        media: question.media,
        options: "options" in question ? question.options : undefined,
        answer:
          question.type === "multiple"
            ? [
                createAnswerSignature(
                  normalizeAnswerValue(question.type, question.answer),
                ),
              ]
            : question.type === "text"
              ? question.answer.map((answerValue) =>
                  normalizeTextAnswer(answerValue),
                )
              : question.answer.map((answerValue) =>
                  createAnswerSignature(
                    normalizeAnswerValue(question.type, answerValue),
                  ),
                ),
        answerDisplay,
        answerMode: question.type === "text" ? "containsAll" : "exact",
        orderIndex: index,
      } satisfies StoredQuestion;
    }),
  };
}

function hydrateQuizRow(row: QuizRow | undefined) {
  if (!row) {
    return null;
  }

  const meta = parseJson<StoredQuizMeta>(row.meta_json, {
    slug: row.slug,
    title: row.slug,
    subtitle: undefined,
    description: undefined,
    passScore: 70,
    durationSec: 900,
    shuffleQuestions: false,
    examMode: "closed_book",
    requireFullscreen: false,
    selectionMode: "fixed",
    updatedAt: row.updated_at,
  });
  const questions = parseJson<StoredQuestion[]>(row.questions_json, []);

  return {
    meta: {
      ...meta,
      updatedAt: row.updated_at,
    },
    sourceYaml: row.source_yaml,
    questions: questions.map(cloneQuestion),
  } satisfies StoredQuiz;
}

function hydrateAttemptRow(row: AttemptRow | undefined) {
  if (!row) {
    return null;
  }

  const quizSnapshot = parseJson<AttemptQuizSnapshot | undefined>(
    row.quiz_snapshot_json,
    undefined,
  );

  return {
    id: row.id,
    quizSlug: row.quiz_slug,
    qqHash: row.qq_hash,
    qqMask: row.qq_mask,
    playerName: row.player_name,
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    status: row.status,
    score: row.score,
    verificationCodeHash: row.verification_code_hash,
    verificationExpiresAt: row.verification_expires_at,
    verificationStatus: row.verification_status,
    quizSnapshot: quizSnapshot
      ? {
          meta: { ...quizSnapshot.meta },
          questions: quizSnapshot.questions.map(cloneQuestion),
        }
      : undefined,
  } satisfies AttemptRecord;
}

function persistQuiz(quiz: StoredQuiz) {
  db.prepare(
    `
      INSERT INTO quizzes (slug, meta_json, source_yaml, questions_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        meta_json = excluded.meta_json,
        source_yaml = excluded.source_yaml,
        questions_json = excluded.questions_json,
        updated_at = excluded.updated_at
    `,
  ).run(
    quiz.meta.slug,
    JSON.stringify(quiz.meta),
    quiz.sourceYaml,
    JSON.stringify(quiz.questions),
    quiz.meta.updatedAt,
  );
}

function persistAttempt(attempt: AttemptRecord) {
  db.prepare(
    `
      INSERT INTO attempts (
        id,
        quiz_slug,
        qq_hash,
        qq_mask,
        player_name,
        started_at,
        submitted_at,
        status,
        score,
        verification_code_hash,
        verification_expires_at,
        verification_status,
        quiz_snapshot_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        quiz_slug = excluded.quiz_slug,
        qq_hash = excluded.qq_hash,
        qq_mask = excluded.qq_mask,
        player_name = excluded.player_name,
        started_at = excluded.started_at,
        submitted_at = excluded.submitted_at,
        status = excluded.status,
        score = excluded.score,
        verification_code_hash = excluded.verification_code_hash,
        verification_expires_at = excluded.verification_expires_at,
        verification_status = excluded.verification_status,
        quiz_snapshot_json = excluded.quiz_snapshot_json
    `,
  ).run(
    attempt.id,
    attempt.quizSlug,
    attempt.qqHash,
    attempt.qqMask,
    attempt.playerName,
    attempt.startedAt,
    attempt.submittedAt,
    attempt.status,
    attempt.score,
    attempt.verificationCodeHash,
    attempt.verificationExpiresAt,
    attempt.verificationStatus,
    attempt.quizSnapshot ? JSON.stringify(attempt.quizSnapshot) : null,
  );
}

function migrateLegacyStateIfNeeded() {
  const quizCountRow = db
    .prepare("SELECT COUNT(*) AS count FROM quizzes")
    .get() as { count?: number } | undefined;
  const attemptCountRow = db
    .prepare("SELECT COUNT(*) AS count FROM attempts")
    .get() as { count?: number } | undefined;
  const quizCount = Number(quizCountRow?.count ?? 0);
  const attemptCount = Number(attemptCountRow?.count ?? 0);

  if (quizCount > 0 || attemptCount > 0 || !existsSync(legacyStatePath)) {
    return;
  }

  const legacyState = parseJson<RuntimeState>(
    readFileSync(legacyStatePath, "utf8"),
    { quizzes: {}, attempts: {} },
  );

  db.exec("BEGIN");
  try {
    for (const quiz of Object.values(legacyState.quizzes)) {
      persistQuiz({
        meta: {
          ...quiz.meta,
          updatedAt: quiz.meta.updatedAt ?? new Date().toISOString(),
        },
        sourceYaml: quiz.sourceYaml,
        questions: quiz.questions.map(cloneQuestion),
      });
    }

    for (const attempt of Object.values(legacyState.attempts)) {
      persistAttempt({
        id: attempt.id,
        quizSlug: attempt.quizSlug,
        qqHash: attempt.qqHash,
        qqMask: attempt.qqMask ?? null,
        playerName: attempt.playerName,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt ?? null,
        status: attempt.status,
        score: attempt.score ?? null,
        verificationCodeHash: attempt.verificationCodeHash ?? null,
        verificationExpiresAt: attempt.verificationExpiresAt ?? null,
        verificationStatus: attempt.verificationStatus ?? null,
        quizSnapshot: attempt.quizSnapshot
          ? {
              meta: { ...attempt.quizSnapshot.meta },
              questions: attempt.quizSnapshot.questions.map(cloneQuestion),
            }
          : undefined,
      });
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

migrateLegacyStateIfNeeded();

export function importQuizDocument(document: QuizDocument, sourceYaml: string) {
  const storedQuiz = toStoredQuiz(document, sourceYaml);
  persistQuiz(storedQuiz);
  return getQuizBySlug(document.meta.slug);
}

export function syncSeedQuizFromFile() {
  if (!existsSync(config.quizSeedFile)) {
    return null;
  }

  const sourceYaml = readFileSync(config.quizSeedFile, "utf8");
  const parsed = quizDocumentSchema.parse(YAML.parse(sourceYaml));
  return importQuizDocument(parsed, sourceYaml);
}

export function watchSeedQuizFile(handlers?: {
  onReload?: (slug: string) => void;
  onError?: (error: Error) => void;
}) {
  if (!existsSync(config.quizSeedFile)) {
    return;
  }

  watchFile(config.quizSeedFile, { interval: 600 }, () => {
    try {
      const quiz = syncSeedQuizFromFile();

      if (quiz) {
        handlers?.onReload?.(quiz.meta.slug);
      }
    } catch (error) {
      handlers?.onError?.(
        error instanceof Error ? error : new Error("seed_reload_failed"),
      );
    }
  });
}

export function getQuizBySlug(slug: string) {
  const row = db
    .prepare("SELECT * FROM quizzes WHERE slug = ? LIMIT 1")
    .get(slug) as QuizRow | undefined;
  const quiz = hydrateQuizRow(row);

  if (!quiz) {
    return null;
  }

  return {
    meta: {
      slug: quiz.meta.slug,
      title: quiz.meta.title,
      subtitle: quiz.meta.subtitle,
      description: quiz.meta.description,
      passScore: quiz.meta.passScore,
      durationSec: quiz.meta.durationSec,
      shuffleQuestions: quiz.meta.shuffleQuestions,
      examMode: quiz.meta.examMode,
      requireFullscreen: quiz.meta.requireFullscreen,
      selectionMode: quiz.meta.selectionMode,
      drawCount: quiz.meta.drawCount,
      drawSingleCount: quiz.meta.drawSingleCount,
      drawMultipleCount: quiz.meta.drawMultipleCount,
      drawTextCount: quiz.meta.drawTextCount,
    },
    sourceYaml: quiz.sourceYaml,
    questionBankSize: quiz.questions.length,
    displayQuestionCount: getDisplayQuestionCount(
      quiz.meta,
      quiz.questions.length,
    ),
    questions: quiz.questions.map(cloneQuestion),
  };
}

export function listQuizzes() {
  const rows = db
    .prepare(
      "SELECT slug, meta_json, updated_at FROM quizzes ORDER BY updated_at DESC",
    )
    .all() as Array<Pick<QuizRow, "slug" | "meta_json" | "updated_at">>;

  return rows.map((row) => {
    const meta = parseJson<StoredQuizMeta>(row.meta_json, {
      slug: row.slug,
      title: row.slug,
      subtitle: undefined,
      description: undefined,
      passScore: 70,
      durationSec: 900,
      shuffleQuestions: false,
      examMode: "closed_book",
      requireFullscreen: false,
      selectionMode: "fixed",
      updatedAt: row.updated_at,
    });

    return {
      slug: meta.slug,
      title: meta.title,
      subtitle: meta.subtitle ?? null,
      description: meta.description ?? null,
      passScore: meta.passScore,
      durationSec: meta.durationSec,
      shuffleQuestions: meta.shuffleQuestions,
      updatedAt: row.updated_at,
    };
  });
}

export function createAttemptRecord(input: {
  id: string;
  quizSlug: string;
  qqHash: string;
  qqMask: string | null;
  playerName: string;
  startedAt: string;
  quizSnapshot?: AttemptQuizSnapshot;
}) {
  persistAttempt({
    id: input.id,
    quizSlug: input.quizSlug,
    qqHash: input.qqHash,
    qqMask: input.qqMask,
    playerName: input.playerName,
    startedAt: input.startedAt,
    submittedAt: null,
    status: "active",
    score: null,
    verificationCodeHash: null,
    verificationExpiresAt: null,
    verificationStatus: null,
    quizSnapshot: input.quizSnapshot
      ? {
          meta: { ...input.quizSnapshot.meta },
          questions: input.quizSnapshot.questions.map(cloneQuestion),
        }
      : undefined,
  });
}

export function getActiveAttemptByIdentity(input: {
  quizSlug: string;
  qqHash: string;
  playerName: string;
}) {
  const row = db
    .prepare(
      `
      SELECT *
      FROM attempts
      WHERE quiz_slug = ?
        AND qq_hash = ?
        AND LOWER(player_name) = LOWER(?)
        AND status = 'active'
      ORDER BY started_at DESC
      LIMIT 1
    `,
    )
    .get(input.quizSlug, input.qqHash, input.playerName) as
    | AttemptRow
    | undefined;

  return hydrateAttemptRow(row);
}

export function getConflictingActiveAttemptByIdentity(input: {
  quizSlug: string;
  qqHash: string;
  playerName: string;
}) {
  const row = db
    .prepare(
      `
      SELECT *
      FROM attempts
      WHERE quiz_slug = ?
        AND status = 'active'
        AND (qq_hash = ? OR LOWER(player_name) = LOWER(?))
      ORDER BY started_at DESC
      LIMIT 1
    `,
    )
    .get(input.quizSlug, input.qqHash, input.playerName) as
    | AttemptRow
    | undefined;

  return hydrateAttemptRow(row);
}

export function getBoundAttemptByIdentity(input: {
  qqHash: string;
  playerName: string;
}) {
  const row = db
    .prepare(
      `
      SELECT *
      FROM attempts
      WHERE status = 'passed'
        AND (qq_hash = ? OR LOWER(player_name) = LOWER(?))
      ORDER BY submitted_at DESC, started_at DESC
      LIMIT 1
    `,
    )
    .get(input.qqHash, input.playerName) as AttemptRow | undefined;

  return hydrateAttemptRow(row);
}

export function getAttemptById(attemptId: string) {
  const row = db
    .prepare("SELECT * FROM attempts WHERE id = ? LIMIT 1")
    .get(attemptId) as AttemptRow | undefined;
  return hydrateAttemptRow(row);
}

export function finalizeAttempt(input: {
  attemptId: string;
  submittedAt: string;
  status: "passed" | "failed";
  score: number;
  verificationCodeHash?: string;
  verificationExpiresAt?: number;
}) {
  db.prepare(
    `
      UPDATE attempts
      SET submitted_at = ?,
          status = ?,
          score = ?,
          verification_code_hash = ?,
          verification_expires_at = ?,
          verification_status = ?
      WHERE id = ?
    `,
  ).run(
    input.submittedAt,
    input.status,
    input.score,
    input.verificationCodeHash ?? null,
    input.verificationExpiresAt ?? null,
    input.verificationCodeHash ? "issued" : null,
    input.attemptId,
  );
}

export function getAttemptByVerificationCodeHash(codeHash: string) {
  const row = db
    .prepare("SELECT * FROM attempts WHERE verification_code_hash = ? LIMIT 1")
    .get(codeHash) as AttemptRow | undefined;
  return hydrateAttemptRow(row);
}

export function getLatestSubmittedAttemptByIdentity(input: {
  quizSlug: string;
  qqHash: string;
  playerName: string;
}) {
  const row = db
    .prepare(
      `
      SELECT *
      FROM attempts
      WHERE quiz_slug = ?
        AND submitted_at IS NOT NULL
        AND (qq_hash = ? OR LOWER(player_name) = LOWER(?))
      ORDER BY submitted_at DESC
      LIMIT 1
    `,
    )
    .get(input.quizSlug, input.qqHash, input.playerName) as
    | AttemptRow
    | undefined;

  return hydrateAttemptRow(row);
}

export function countSubmittedAttemptsByIdentitySince(input: {
  quizSlug: string;
  qqHash: string;
  playerName: string;
  submittedSince: string;
}) {
  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM attempts
      WHERE quiz_slug = ?
        AND submitted_at IS NOT NULL
        AND submitted_at >= ?
        AND (qq_hash = ? OR LOWER(player_name) = LOWER(?))
    `,
    )
    .get(
      input.quizSlug,
      input.submittedSince,
      input.qqHash,
      input.playerName,
    ) as { count?: number } | undefined;

  return Number(row?.count ?? 0);
}

export function listBoundAttempts(limit = 200) {
  const rows = db
    .prepare(
      `
      SELECT
        a.id,
        a.quiz_slug,
        a.qq_mask,
        a.player_name,
        a.submitted_at,
        a.score,
        a.verification_status,
        q.meta_json
      FROM attempts AS a
      LEFT JOIN quizzes AS q
        ON q.slug = a.quiz_slug
      WHERE a.status = 'passed'
        AND a.submitted_at IS NOT NULL
      ORDER BY a.submitted_at DESC, a.started_at DESC
      LIMIT ?
    `,
    )
    .all(limit) as Array<{
    id: string;
    quiz_slug: string;
    qq_mask: string | null;
    player_name: string;
    submitted_at: string;
    score: number | null;
    verification_status: AttemptRecord["verificationStatus"];
    meta_json: string | null;
  }>;

  return rows.map((row) => {
    const meta = parseJson<{ title?: string } | null>(row.meta_json, null);

    return {
      attemptId: row.id,
      quizSlug: row.quiz_slug,
      quizTitle: meta?.title ?? row.quiz_slug,
      qqMask: row.qq_mask,
      playerName: row.player_name,
      submittedAt: row.submitted_at,
      score: row.score,
      verificationStatus: row.verification_status ?? null,
      hasAvatar:
        existsSync(join(config.avatarCacheDir, `${row.id}.jpg`)) ||
        existsSync(join(config.avatarCacheDir, `${row.id}.png`)),
    };
  });
}

export function deleteBoundAttemptById(attemptId: string) {
  const result = db
    .prepare(
      `
      DELETE FROM attempts
      WHERE id = ?
        AND status = 'passed'
    `,
    )
    .run(attemptId);

  return Number(result.changes ?? 0) === 1;
}

export function hasActiveVerificationCodeHash(codeHash: string) {
  const row = db
    .prepare(
      `
      SELECT 1 AS present
      FROM attempts
      WHERE verification_code_hash = ?
        AND verification_status = 'issued'
        AND verification_expires_at > ?
      LIMIT 1
    `,
    )
    .get(codeHash, Date.now()) as { present?: number } | undefined;

  return row?.present === 1;
}

export function consumeVerificationCode(codeHash: string, now = Date.now()) {
  const result = db
    .prepare(
      `
      UPDATE attempts
      SET verification_status = 'consumed'
      WHERE verification_code_hash = ?
        AND verification_status = 'issued'
        AND verification_expires_at > ?
    `,
    )
    .run(codeHash, now);

  return Number(result.changes ?? 0) === 1;
}

export function parseQuizYaml(sourceYaml: string) {
  return quizDocumentSchema.parse(YAML.parse(sourceYaml));
}
