import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";

const optionSchema = z.object({
  key: z.string().min(1).max(8),
  text: z.string().min(1).max(300)
});

const mediaSourceSchema = z
  .string()
  .min(1)
  .max(1000)
  .refine((value) => /^(https?:\/\/|\/|\.\/|\.\.\/|media\/|assets\/)/.test(value.trim()), {
    message: "媒体地址需使用 http(s) 链接或站内 /path、./path、../path 这类可访问资源路径。"
  });

const mediaSchema = z.object({
  type: z.enum(["image", "audio", "video"]),
  url: mediaSourceSchema,
  caption: z.string().max(160).optional()
});

const questionGroupSchema = z.enum(["objective", "subjective"]);
const textInputStyleSchema = z.enum(["short", "essay"]);

const baseQuestionSchema = z.object({
  id: z.string().min(2).max(64),
  points: z.coerce.number().int().positive().max(100),
  prompt: z.string().min(1).max(500),
  description: z.string().max(500).optional(),
  placeholder: z.string().max(160).optional(),
  group: questionGroupSchema.optional(),
  media: mediaSchema.optional()
});

const singleQuestionSchema = baseQuestionSchema.extend({
  type: z.literal("single"),
  options: z.array(optionSchema).min(2).max(8),
  answer: z.array(z.string().min(1)).length(1)
});

const multipleQuestionSchema = baseQuestionSchema.extend({
  type: z.literal("multiple"),
  options: z.array(optionSchema).min(2).max(8),
  answer: z.array(z.string().min(1)).min(1).max(8)
});

const textQuestionSchema = baseQuestionSchema.extend({
  type: z.literal("text"),
  inputStyle: textInputStyleSchema.default("essay"),
  answer: z.array(z.string().min(1).max(120)).min(1).max(8)
});

export const questionSchema = z.discriminatedUnion("type", [
  singleQuestionSchema,
  multipleQuestionSchema,
  textQuestionSchema
]);

export const quizDocumentSchema = z
  .object({
    meta: z.object({
      slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
      title: z.string().min(2).max(120),
      subtitle: z.string().max(120).optional(),
      description: z.string().max(500).optional(),
      passScore: z.coerce.number().int().min(1).max(100),
      durationSec: z.coerce.number().int().min(60).max(7200),
      shuffleQuestions: z.boolean().default(false),
      examMode: z.enum(["open_book", "closed_book"]).default("closed_book"),
      requireFullscreen: z.boolean().default(false),
      selectionMode: z.enum(["fixed", "random"]).default("fixed"),
      drawCount: z.coerce.number().int().min(1).max(100).optional(),
      drawSingleCount: z.coerce.number().int().min(0).max(100).optional(),
      drawMultipleCount: z.coerce.number().int().min(0).max(100).optional(),
      drawTextCount: z.coerce.number().int().min(0).max(100).optional()
    }),
    questions: z.array(questionSchema).min(1).max(500)
  })
  .superRefine((document, ctx) => {
    const questions = document.questions;
    const singles = questions.filter((item) => item.type === "single").length;
    const multiples = questions.filter((item) => item.type === "multiple").length;
    const texts = questions.filter((item) => item.type === "text").length;
    const { drawCount, drawSingleCount = 0, drawMultipleCount = 0, drawTextCount = 0, selectionMode } = document.meta;
    const requestedByType = drawSingleCount + drawMultipleCount + drawTextCount;

    if (selectionMode === "random") {
      if (drawCount && drawCount > questions.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["meta", "drawCount"],
          message: "随机抽题数量不能大于题库总量。"
        });
      }

      if (drawSingleCount > singles) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["meta", "drawSingleCount"],
          message: "单选抽题数量超过了单选题库存量。"
        });
      }

      if (drawMultipleCount > multiples) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["meta", "drawMultipleCount"],
          message: "多选抽题数量超过了多选题库存量。"
        });
      }

      if (drawTextCount > texts) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["meta", "drawTextCount"],
          message: "主观题抽题数量超过了文本题库存量。"
        });
      }

      if (drawCount && requestedByType > drawCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["meta", "drawCount"],
          message: "总抽题数量不能小于各题型抽题数量之和。"
        });
      }
    }
  });

export type QuizDocument = z.infer<typeof quizDocumentSchema>;
export type QuizQuestion = z.infer<typeof questionSchema>;
export type QuizMedia = z.infer<typeof mediaSchema>;

export const startAttemptSchema = z.object({
  quizSlug: z.string().min(2).max(64),
  qq: z.string().regex(/^\d{5,20}$/),
  playerName: z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9_]+$/)
});

export const answerSubmissionSchema = z.object({
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())]))
});

export const verifyTokenSchema = z.object({
  code: z.string().regex(/^\d{4,8}$/),
  qq: z.string().regex(/^\d{5,20}$/),
  playerName: z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9_]+$/)
});

export const adminLoginSchema = z.object({
  password: z.string().min(6).max(128)
});

export function normalizePlayerName(playerName: string) {
  return playerName.trim();
}

export function normalizeTextAnswer(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeQuestionGroup(question: QuizQuestion) {
  if (question.group) {
    return question.group;
  }

  return question.type === "text" ? "subjective" : "objective";
}

export function normalizeAnswerValue(type: QuizQuestion["type"], raw: string | string[]) {
  if (type === "multiple") {
    const list = Array.isArray(raw) ? raw : [raw];
    return list
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean)
      .sort()
      .join("|");
  }

  const value = Array.isArray(raw) ? raw[0] ?? "" : raw;
  return type === "text" ? normalizeTextAnswer(value) : value.trim().toUpperCase();
}

export function createAnswerSignature(value: string) {
  return createHmac("sha256", config.tokenSecret).update(value).digest("hex");
}

export function hashQq(qq: string) {
  return createHash("sha256")
    .update(`${config.tokenSecret}:${qq}`)
    .digest("hex");
}

export function stripAnswers(document: QuizDocument) {
  return {
    ...document.meta,
    questionBankSize: document.questions.length,
    displayQuestionCount:
      document.meta.selectionMode === "random"
        ? (
            document.meta.drawCount ??
            [document.meta.drawSingleCount ?? 0, document.meta.drawMultipleCount ?? 0, document.meta.drawTextCount ?? 0]
              .filter((count) => count > 0)
              .reduce((sum, count) => sum + count, 0)
          ) || document.questions.length
        : document.questions.length,
    questions: document.questions.map((question, index) => ({
      id: question.id,
      type: question.type,
      group: normalizeQuestionGroup(question),
      prompt: question.prompt,
      description: question.description,
      placeholder: question.placeholder,
      points: question.points,
      index,
      media: question.media,
      inputStyle: question.type === "text" ? question.inputStyle : undefined,
      options: "options" in question ? question.options : undefined
    }))
  };
}

