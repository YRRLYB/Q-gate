
import { useEffect, useMemo, useState } from "react";
import YAML from "yaml";
import { api } from "../api";
import { starterQuizTemplate } from "../data/quizTemplate";
import { Frame, StatusPill } from "../layout";
import { useSiteSettings } from "../site";

type FeedbackTone = "neutral" | "success" | "error";
type EditorMode = "visual" | "yaml";
type StudioSection = "quiz" | "site";
type QuestionType = "single" | "multiple" | "text";
type QuestionGroup = "objective" | "subjective";
type TextInputStyle = "short" | "essay";
type ExamMode = "open_book" | "closed_book";
type SelectionMode = "fixed" | "random";
type MediaType = "image" | "audio" | "video";

type EditorMedia = {
  type: MediaType;
  url: string;
  caption: string;
};

type EditorQuestion = {
  id: string;
  type: QuestionType;
  group: QuestionGroup;
  points: number;
  prompt: string;
  description: string;
  placeholder: string;
  inputStyle: TextInputStyle;
  media?: EditorMedia;
  options: Array<{ key: string; text: string }>;
  answer: string[];
};

type EditorQuiz = {
  meta: {
    slug: string;
    title: string;
    subtitle: string;
    description: string;
    passScore: number;
    durationSec: number;
    shuffleQuestions: boolean;
    examMode: ExamMode;
    requireFullscreen: boolean;
    selectionMode: SelectionMode;
    drawCount?: number;
    drawSingleCount?: number;
    drawMultipleCount?: number;
    drawTextCount?: number;
  };
  questions: EditorQuestion[];
};

function explainAdminError(error: unknown, action: string) {
  const message = error instanceof Error ? error.message : `${action}失败`;

  if (message === "unauthorized") {
    return "管理会话不可用，或者当前密码与运行中的 API 配置不一致。请确认 apps/api/.env 里的 ADMIN_PASSWORD 是否正确；如果你刚修改过它，需要先重启 API 服务。";
  }

  if (message === "yaml_required") {
    return "题库 YAML 不能为空。";
  }

  return message;
}

function toOptionKey(index: number) {
  return index < 26 ? String.fromCharCode(65 + index) : `O${index + 1}`;
}

function getDefaultGroup(type: QuestionType): QuestionGroup {
  return type === "text" ? "subjective" : "objective";
}

function sanitizeOptionalCount(value: number | undefined) {
  if (!Number.isFinite(value) || !value || value < 0) {
    return undefined;
  }

  return Math.floor(value);
}

function createQuestion(type: QuestionType, index: number): EditorQuestion {
  const base: EditorQuestion = {
    id: `rule_${String(index + 1).padStart(2, "0")}`,
    type,
    group: getDefaultGroup(type),
    points: 10,
    prompt: "",
    description: "",
    placeholder: "",
    inputStyle: "essay",
    options: [],
    answer: []
  };

  if (type === "text") {
    return {
      ...base,
      placeholder: "请输入答案关键词或简答内容",
      answer: [""]
    };
  }

  return {
    ...base,
    inputStyle: "short",
    options: [0, 1, 2, 3].map((item) => ({
      key: toOptionKey(item),
      text: ""
    })),
    answer: type === "single" ? ["A"] : []
  };
}

function normalizeQuestion(raw: any, index: number): EditorQuestion {
  const type: QuestionType = raw?.type === "multiple" || raw?.type === "text" ? raw.type : "single";
  const options = Array.isArray(raw?.options)
    ? raw.options.map((option: any, optionIndex: number) => ({
        key: String(option?.key ?? toOptionKey(optionIndex)),
        text: String(option?.text ?? "")
      }))
    : [];
  const answer = Array.isArray(raw?.answer) ? raw.answer.map((item: unknown) => String(item ?? "")) : [];
  const media = raw?.media && typeof raw.media === "object"
    ? {
        type: raw.media.type === "audio" || raw.media.type === "video" ? raw.media.type : "image",
        url: String(raw.media.url ?? ""),
        caption: String(raw.media.caption ?? "")
      }
    : undefined;

  return {
    id: String(raw?.id ?? `rule_${String(index + 1).padStart(2, "0")}`),
    type,
    group: raw?.group === "subjective" ? "subjective" : raw?.group === "objective" ? "objective" : getDefaultGroup(type),
    points: Number(raw?.points ?? 10),
    prompt: String(raw?.prompt ?? ""),
    description: String(raw?.description ?? ""),
    placeholder: String(raw?.placeholder ?? ""),
    inputStyle: raw?.inputStyle === "short" ? "short" : "essay",
    media: media?.url ? media : undefined,
    options: type === "text" ? [] : options.length > 0 ? options : createQuestion(type, index).options,
    answer: answer.length > 0 ? answer : createQuestion(type, index).answer
  };
}

function parseEditorQuiz(source: string): EditorQuiz {
  const raw = YAML.parse(source) as any;

  if (!raw || typeof raw !== "object") {
    throw new Error("YAML 根节点必须是对象。请检查 meta 和 questions 缩进。");
  }

  const questions = Array.isArray(raw.questions)
    ? raw.questions.map((question: any, index: number) => normalizeQuestion(question, index))
    : [];

  return {
    meta: {
      slug: String(raw.meta?.slug ?? "mc-whitelist"),
      title: String(raw.meta?.title ?? "未命名题库"),
      subtitle: String(raw.meta?.subtitle ?? ""),
      description: String(raw.meta?.description ?? ""),
      passScore: Number(raw.meta?.passScore ?? 70),
      durationSec: Number(raw.meta?.durationSec ?? 900),
      shuffleQuestions: Boolean(raw.meta?.shuffleQuestions),
      examMode: raw.meta?.examMode === "open_book" ? "open_book" : "closed_book",
      requireFullscreen: Boolean(raw.meta?.requireFullscreen),
      selectionMode: raw.meta?.selectionMode === "random" ? "random" : "fixed",
      drawCount: sanitizeOptionalCount(Number(raw.meta?.drawCount ?? 0)),
      drawSingleCount: sanitizeOptionalCount(Number(raw.meta?.drawSingleCount ?? 0)),
      drawMultipleCount: sanitizeOptionalCount(Number(raw.meta?.drawMultipleCount ?? 0)),
      drawTextCount: sanitizeOptionalCount(Number(raw.meta?.drawTextCount ?? 0))
    },
    questions: questions.length > 0 ? questions : [createQuestion("single", 0)]
  };
}

const VISUAL_TEMPLATE = parseEditorQuiz(starterQuizTemplate);

function toYamlDocument(editor: EditorQuiz) {
  return {
    meta: {
      slug: editor.meta.slug,
      title: editor.meta.title,
      ...(editor.meta.subtitle.trim() ? { subtitle: editor.meta.subtitle.trim() } : {}),
      ...(editor.meta.description.trim() ? { description: editor.meta.description.trim() } : {}),
      passScore: editor.meta.passScore,
      durationSec: editor.meta.durationSec,
      shuffleQuestions: editor.meta.shuffleQuestions,
      examMode: editor.meta.examMode,
      requireFullscreen: editor.meta.requireFullscreen,
      selectionMode: editor.meta.selectionMode,
      ...(editor.meta.selectionMode === "random" && editor.meta.drawCount ? { drawCount: editor.meta.drawCount } : {}),
      ...(editor.meta.selectionMode === "random" && editor.meta.drawSingleCount ? { drawSingleCount: editor.meta.drawSingleCount } : {}),
      ...(editor.meta.selectionMode === "random" && editor.meta.drawMultipleCount ? { drawMultipleCount: editor.meta.drawMultipleCount } : {}),
      ...(editor.meta.selectionMode === "random" && editor.meta.drawTextCount ? { drawTextCount: editor.meta.drawTextCount } : {})
    },
    questions: editor.questions.map((question) => {
      const base = {
        id: question.id,
        type: question.type,
        group: question.group,
        points: question.points,
        prompt: question.prompt,
        ...(question.description.trim() ? { description: question.description.trim() } : {}),
        ...(question.type === "text" && question.placeholder.trim() ? { placeholder: question.placeholder.trim() } : {}),
        ...(question.type === "text" ? { inputStyle: question.inputStyle } : {}),
        ...(question.media?.url.trim()
          ? {
              media: {
                type: question.media.type,
                url: question.media.url.trim(),
                ...(question.media.caption.trim() ? { caption: question.media.caption.trim() } : {})
              }
            }
          : {})
      };

      if (question.type === "text") {
        return {
          ...base,
          answer: question.answer.map((item) => item.trim()).filter(Boolean)
        };
      }

      return {
        ...base,
        options: question.options.map((option, index) => ({
          key: option.key.trim() || toOptionKey(index),
          text: option.text
        })),
        answer: question.answer.map((item) => item.trim()).filter(Boolean)
      };
    })
  };
}

function stringifyEditorQuiz(editor: EditorQuiz) {
  return YAML.stringify(toYamlDocument(editor));
}

function getTypeLabel(type: QuestionType) {
  return type === "single" ? "单选" : type === "multiple" ? "多选" : "文本";
}

function getGroupLabel(group: QuestionGroup) {
  return group === "objective" ? "客观" : "主观";
}

function getExamModeLabel(mode: ExamMode) {
  return mode === "open_book" ? "开卷" : "闭卷";
}

function getSelectionPreview(meta: EditorQuiz["meta"], questionCount: number) {
  if (meta.selectionMode === "fixed") {
    return `固定整卷 · ${questionCount} 题`;
  }

  const total = meta.drawCount ?? [meta.drawSingleCount ?? 0, meta.drawMultipleCount ?? 0, meta.drawTextCount ?? 0]
    .filter((count) => count > 0)
    .reduce((sum, count) => sum + count, 0);

  return total > 0 ? `随机抽题 · ${total} 题` : "随机抽题";
}

function getSiteSettingsPreview(source: string) {
  try {
    const raw = YAML.parse(source) as any;
    return {
      data: {
        brandName: String(raw?.brand?.name ?? ""),
        adminName: String(raw?.brand?.adminName ?? ""),
        homeTitle: String(raw?.home?.title ?? ""),
        entryTitle: String(raw?.entry?.fallbackTitle ?? "")
      },
      error: ""
    };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "YAML 解析失败"
    };
  }
}

export function StudioPage() {
  const { settings } = useSiteSettings();
  const [adminPasswordInput, setAdminPasswordInput] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [section, setSection] = useState<StudioSection>("quiz");
  const [mode, setMode] = useState<EditorMode>("visual");
  const [editor, setEditor] = useState<EditorQuiz>(VISUAL_TEMPLATE);
  const [yamlText, setYamlText] = useState(stringifyEditorQuiz(VISUAL_TEMPLATE));
  const [siteYamlText, setSiteYamlText] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feedbackTone, setFeedbackTone] = useState<FeedbackTone>("neutral");
  const [quizItems, setQuizItems] = useState<Array<{ slug: string; title: string; updatedAt?: string }>>([]);
  const [autoLoadedContent, setAutoLoadedContent] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setCheckingAuth(true);
    void api
      .adminLogout()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setAuthenticated(false);
          setAutoLoadedContent(false);
          setCheckingAuth(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authenticated || autoLoadedContent) {
      return;
    }

    setAutoLoadedContent(true);
    void loadSeedYaml();
    void loadSiteYaml();
  }, [authenticated, autoLoadedContent]);

  const previewResult = useMemo(() => {
    try {
      return { data: parseEditorQuiz(yamlText), error: "" };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err.message : "YAML 解析失败" };
    }
  }, [yamlText]);

  const preview = previewResult.data;
  const sitePreviewResult = useMemo(() => getSiteSettingsPreview(siteYamlText), [siteYamlText]);
  const totalPoints = useMemo(() => editor.questions.reduce((sum, question) => sum + Number(question.points || 0), 0), [editor.questions]);
  const objectiveCount = useMemo(() => editor.questions.filter((question) => question.group === "objective").length, [editor.questions]);
  const subjectiveCount = useMemo(() => editor.questions.filter((question) => question.group === "subjective").length, [editor.questions]);

  function updateFeedback(text: string, tone: FeedbackTone) {
    setFeedback(text);
    setFeedbackTone(tone);
  }

  function commitEditor(next: EditorQuiz) {
    setEditor(next);
    setYamlText(stringifyEditorQuiz(next));
  }

  function ensureAuthenticated() {
    if (authenticated) {
      return true;
    }

    updateFeedback("请先完成管理员登录，再读取或发布工作台内容。", "error");
    return false;
  }

  async function handleAdminLogin() {
    if (!adminPasswordInput.trim()) {
      updateFeedback("请输入 apps/api/.env 中当前启用的 ADMIN_PASSWORD。", "error");
      return;
    }

    try {
      updateFeedback("正在建立管理会话…", "neutral");
      await api.adminLogin(adminPasswordInput);
      setAuthenticated(true);
      setCheckingAuth(false);
      setAutoLoadedContent(false);
      setAdminPasswordInput("");
      updateFeedback("登录成功，工作台会话已建立。", "success");
    } catch (err) {
      updateFeedback(explainAdminError(err, "登录工作台"), "error");
    }
  }

  async function handleAdminLogout() {
    try {
      await api.adminLogout();
    } finally {
      setAuthenticated(false);
      setAutoLoadedContent(false);
      updateFeedback("已退出工作台会话。", "neutral");
    }
  }

  function updateMeta<K extends keyof EditorQuiz["meta"]>(key: K, value: EditorQuiz["meta"][K]) {
    commitEditor({
      ...editor,
      meta: {
        ...editor.meta,
        [key]: value
      }
    });
  }

  function updateQuestion(index: number, updater: (question: EditorQuestion) => EditorQuestion) {
    commitEditor({
      ...editor,
      questions: editor.questions.map((question, questionIndex) => (questionIndex === index ? updater(question) : question))
    });
  }

  function resetFromTemplate() {
    commitEditor(VISUAL_TEMPLATE);
    setMode("visual");
    updateFeedback("已恢复为默认模板，你可以继续可视化编辑。", "success");
  }

  function syncYamlToVisual() {
    try {
      const parsed = parseEditorQuiz(yamlText);
      setEditor(parsed);
      setMode("visual");
      updateFeedback("YAML 已同步到可视化编辑器。", "success");
    } catch (err) {
      updateFeedback(err instanceof Error ? err.message : "YAML 解析失败", "error");
    }
  }

  async function loadAdminQuizzes() {
    if (!ensureAuthenticated()) {
      return;
    }

    try {
      updateFeedback("正在读取服务端题集…", "neutral");
      const payload = await api.listAdminQuizzes();
      setQuizItems(payload.items.map((item) => ({ slug: item.slug, title: item.title, updatedAt: item.updatedAt })));
      updateFeedback(`已读取 ${payload.items.length} 份题集。`, "success");
    } catch (err) {
      updateFeedback(explainAdminError(err, "读取题集"), "error");
    }
  }

  async function loadSeedYaml() {
    if (!ensureAuthenticated()) {
      return;
    }

    try {
      updateFeedback("正在读取当前 YAML…", "neutral");
      const payload = await api.getAdminSeedYaml();
      setYamlText(payload.yaml);

      try {
        setEditor(parseEditorQuiz(payload.yaml));
        updateFeedback("当前题库已同步到可视化编辑器。", "success");
      } catch (parseError) {
        setMode("yaml");
        updateFeedback(
          parseError instanceof Error
            ? `服务端当前 YAML 有格式问题，已切到 YAML 高级模式。${parseError.message}`
            : "服务端当前 YAML 有格式问题，已切到 YAML 高级模式。",
          "error"
        );
      }

      await loadAdminQuizzes();
    } catch (err) {
      updateFeedback(explainAdminError(err, "读取 YAML"), "error");
    }
  }

  async function loadSiteYaml() {
    if (!ensureAuthenticated()) {
      return;
    }

    try {
      const payload = await api.getAdminSiteSettingsYaml();
      setSiteYamlText(payload.yaml);
    } catch (err) {
      updateFeedback(explainAdminError(err, "读取站点文案"), "error");
    }
  }

  async function publishQuiz() {
    if (!ensureAuthenticated()) {
      return;
    }

    try {
      updateFeedback("正在发布题集…", "neutral");
      const safeYaml = mode === "visual" ? stringifyEditorQuiz(editor) : yamlText;
      if (mode === "visual") {
        setYamlText(safeYaml);
      }
      await api.importQuiz(safeYaml);
      updateFeedback("发布成功，当前题库已经写入服务端并热更新。", "success");
      await loadAdminQuizzes();
    } catch (err) {
      updateFeedback(explainAdminError(err, "发布题库"), "error");
    }
  }

  async function publishSiteSettings() {
    if (!ensureAuthenticated()) {
      return;
    }

    try {
      updateFeedback("正在发布站点文案…", "neutral");
      await api.importSiteSettings(siteYamlText);
      updateFeedback("站点文案已发布，刷新页面后即可看到最新品牌与文案。", "success");
    } catch (err) {
      updateFeedback(explainAdminError(err, "发布站点文案"), "error");
    }
  }

  function addQuestion(type: QuestionType) {
    commitEditor({
      ...editor,
      questions: [...editor.questions, createQuestion(type, editor.questions.length)]
    });
  }

  function removeQuestion(index: number) {
    const nextQuestions = editor.questions.filter((_, questionIndex) => questionIndex !== index);
    commitEditor({
      ...editor,
      questions: nextQuestions.length > 0 ? nextQuestions : [createQuestion("single", 0)]
    });
  }

  function duplicateQuestion(index: number) {
    const source = editor.questions[index];
    const clone: EditorQuestion = {
      ...source,
      id: `rule_${String(editor.questions.length + 1).padStart(2, "0")}`,
      media: source.media ? { ...source.media } : undefined,
      options: source.options.map((option) => ({ ...option })),
      answer: [...source.answer]
    };

    const nextQuestions = [...editor.questions];
    nextQuestions.splice(index + 1, 0, clone);
    commitEditor({ ...editor, questions: nextQuestions });
  }

  function renumberQuestionIds() {
    commitEditor({
      ...editor,
      questions: editor.questions.map((question, index) => ({
        ...question,
        id: `rule_${String(index + 1).padStart(2, "0")}`
      }))
    });
    updateFeedback("题目 ID 已按顺序重新编号。", "success");
  }

  function distributePointsToHundred() {
    if (editor.questions.length === 0) {
      return;
    }

    const count = editor.questions.length;
    const base = Math.floor(100 / count);
    let remainder = 100 - base * count;

    commitEditor({
      ...editor,
      questions: editor.questions.map((question) => {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) {
          remainder -= 1;
        }
        return { ...question, points: base + extra };
      })
    });
    updateFeedback("已按总分 100 自动均分到当前题目。", "success");
  }

  function moveQuestion(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= editor.questions.length) {
      return;
    }

    const nextQuestions = [...editor.questions];
    [nextQuestions[index], nextQuestions[target]] = [nextQuestions[target], nextQuestions[index]];
    commitEditor({ ...editor, questions: nextQuestions });
  }

  function changeQuestionType(index: number, type: QuestionType) {
    updateQuestion(index, (question) => {
      if (type === "text") {
        return {
          ...question,
          type,
          group: question.group,
          placeholder: question.placeholder || "请输入答案关键词或简答内容",
          inputStyle: question.inputStyle || "essay",
          options: [],
          answer: question.answer.length > 0 ? question.answer : [""]
        };
      }

      return {
        ...question,
        type,
        group: question.group,
        inputStyle: "short",
        options: question.options.length > 0 ? question.options : createQuestion(type, index).options,
        answer: type === "single" ? [question.answer[0] || "A"] : question.answer.filter(Boolean)
      };
    });
  }

  function addOption(questionIndex: number) {
    updateQuestion(questionIndex, (question) => ({
      ...question,
      options: [...question.options, { key: toOptionKey(question.options.length), text: "" }]
    }));
  }

  function updateOption(questionIndex: number, optionIndex: number, field: "key" | "text", value: string) {
    updateQuestion(questionIndex, (question) => ({
      ...question,
      options: question.options.map((option, currentIndex) => currentIndex === optionIndex ? { ...option, [field]: value } : option)
    }));
  }

  function removeOption(questionIndex: number, optionIndex: number) {
    updateQuestion(questionIndex, (question) => {
      const removedKey = question.options[optionIndex]?.key;
      const nextOptions = question.options.filter((_, currentIndex) => currentIndex !== optionIndex);
      const nextAnswer = question.answer.filter((item) => item !== removedKey);
      return {
        ...question,
        options: nextOptions.length > 0 ? nextOptions : createQuestion(question.type === "text" ? "single" : question.type, questionIndex).options,
        answer: question.type === "single" ? [nextAnswer[0] || nextOptions[0]?.key || "A"] : nextAnswer
      };
    });
  }

  function toggleAnswer(questionIndex: number, optionKey: string) {
    updateQuestion(questionIndex, (question) => {
      if (question.type === "single") {
        return { ...question, answer: [optionKey] };
      }

      return {
        ...question,
        answer: question.answer.includes(optionKey)
          ? question.answer.filter((item) => item !== optionKey)
          : [...question.answer, optionKey]
      };
    });
  }

  function updateKeyword(questionIndex: number, keywordIndex: number, value: string) {
    updateQuestion(questionIndex, (question) => ({
      ...question,
      answer: question.answer.map((item, currentIndex) => currentIndex === keywordIndex ? value : item)
    }));
  }

  function addKeyword(questionIndex: number) {
    updateQuestion(questionIndex, (question) => ({ ...question, answer: [...question.answer, ""] }));
  }

  function removeKeyword(questionIndex: number, keywordIndex: number) {
    updateQuestion(questionIndex, (question) => {
      const nextAnswer = question.answer.filter((_, currentIndex) => currentIndex !== keywordIndex);
      return { ...question, answer: nextAnswer.length > 0 ? nextAnswer : [""] };
    });
  }

  function updateMedia(questionIndex: number, field: keyof EditorMedia, value: string) {
    updateQuestion(questionIndex, (question) => ({
      ...question,
      media: {
        type: question.media?.type ?? "image",
        url: question.media?.url ?? "",
        caption: question.media?.caption ?? "",
        [field]: value
      } as EditorMedia
    }));
  }

  function toggleMedia(questionIndex: number) {
    updateQuestion(questionIndex, (question) => ({
      ...question,
      media: question.media ? undefined : { type: "image", url: "", caption: "" }
    }));
  }

  if (checkingAuth) {
    return (
      <Frame eyebrow={settings.admin.eyebrow} title={settings.admin.title} subtitle={settings.admin.subtitle}>
        <section className="content-grid content-grid-single">
          <article className="card card-large polished-card">
            <div className="section-head">
              <StatusPill label="Session" />
              <h2>正在检查管理会话</h2>
            </div>
            <p className="muted">工作台正在清理旧登录状态，并要求本次进入重新验证管理员密码。</p>
          </article>
        </section>
      </Frame>
    );
  }

  if (!authenticated) {
    return (
      <Frame
        eyebrow={settings.admin.eyebrow}
        title={settings.admin.title}
        subtitle={settings.admin.subtitle}
        aside={
          <div className="hero-info-card hero-info-card-polished studio-aside-balance">
            <span>{settings.brand.adminName}</span>
            <span>{settings.admin.siteSettingsTitle}</span>
            <span>{settings.admin.siteSettingsNote}</span>
          </div>
        }
      >
        <section className="content-grid studio-grid studio-grid-wide">
          <article className="card card-large polished-card">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleAdminLogin();
              }}
            >
              <div className="section-head">
                <StatusPill label="Login" />
                <h2>{settings.admin.loginTitle}</h2>
              </div>
              <p className="muted">{settings.admin.loginSubtitle}</p>
              <input
                type="text"
                className="auth-autofill-helper"
                value={settings.brand.adminName}
                autoComplete="username"
                readOnly
                tabIndex={-1}
                aria-hidden="true"
              />
              <label className="field">
                <span>管理员密码</span>
                <input
                  type="password"
                  name="password"
                  value={adminPasswordInput}
                  onChange={(event) => setAdminPasswordInput(event.target.value)}
                  placeholder="请填写 apps/api/.env 中当前启用的 ADMIN_PASSWORD"
                  autoComplete="current-password"
                />
                <small className="field-hint">每次重新进入工作台都会要求再次登录；浏览器仍然可以帮你记住这个密码输入框。</small>
              </label>
              {feedback ? <p className={`admin-feedback is-${feedbackTone}`}>{feedback}</p> : null}
              <div className="button-row">
                <button type="submit" className="primary-button">{settings.admin.loginButton}</button>
              </div>
            </form>
          </article>

          <article className="card polished-card studio-side-panel">
            <div className="section-head studio-side-head">
              <div className="studio-side-head-copy">
                <StatusPill label="Brand" />
                <h2>{settings.brand.adminName}</h2>
              </div>
            </div>
            <p className="muted">{settings.admin.siteSettingsNote}</p>
            <div className="hero-info-card compact studio-side-stats studio-side-stats-rich">
              <span>{settings.brand.name}</span>
              <span>{settings.home.title}</span>
              <span>{settings.entry.fallbackTitle}</span>
              <span>{settings.result.passTitle}</span>
            </div>
          </article>
        </section>
      </Frame>
    );
  }

  return (
    <Frame
      eyebrow={settings.admin.eyebrow}
      title={settings.admin.title}
      subtitle={settings.admin.subtitle}
      aside={
        <div className="hero-info-card hero-info-card-polished studio-aside-balance">
          <span>{section === "quiz" ? getSelectionPreview(editor.meta, editor.questions.length) : settings.admin.siteSettingsTitle}</span>
          <span>{section === "quiz" ? `${objectiveCount} 客观题 / ${subjectiveCount} 主观题` : settings.brand.name}</span>
          <span>{section === "quiz" ? `${getExamModeLabel(editor.meta.examMode)} · ${editor.meta.requireFullscreen ? "要求全屏" : "常规模式"}` : settings.home.title}</span>
        </div>
      }
    >
      <section className={`content-grid studio-grid studio-grid-wide ${previewCollapsed ? "is-preview-collapsed" : ""}`}>
        <article className="card card-large polished-card">
          <div className="section-head">
            <StatusPill label="Workspace" />
            <h2>{section === "quiz" ? "题库编辑与发布" : settings.admin.siteSettingsTitle}</h2>
          </div>

          <div className="button-row admin-actions-row admin-actions-row-wide">
            <button className={`tab-button ${section === "quiz" ? "is-active" : ""}`} onClick={() => setSection("quiz")}>题库编辑</button>
            <button className={`tab-button ${section === "site" ? "is-active" : ""}`} onClick={() => setSection("site")}>{settings.admin.siteSettingsTitle}</button>
            <button className="secondary-button" onClick={handleAdminLogout}>{settings.admin.logoutButton}</button>
          </div>

          {section === "quiz" ? (
            <>
              <div className="button-row admin-actions-row admin-actions-row-wide">
                <button className="secondary-button" onClick={loadSeedYaml}>读取当前题库</button>
                <button className="secondary-button" onClick={loadAdminQuizzes}>刷新题集列表</button>
                <button className="secondary-button" onClick={resetFromTemplate}>恢复模板</button>
              </div>

              <div className="editor-mode-tabs">
                <button className={`tab-button ${mode === "visual" ? "is-active" : ""}`} onClick={() => setMode("visual")}>可视化出题</button>
                <button className={`tab-button ${mode === "yaml" ? "is-active" : ""}`} onClick={() => setMode("yaml")}>YAML 高级模式</button>
              </div>

              {mode === "visual" ? (
            <div className="visual-editor-shell">
              <section className="editor-section">
                <div className="section-head">
                  <StatusPill label="Quiz Meta" />
                  <h2>题库信息</h2>
                </div>
                <div className="meta-grid editor-meta-grid-wide">
                  <label className="field">
                    <span>题库 slug</span>
                    <input value={editor.meta.slug} onChange={(event) => updateMeta("slug", event.target.value)} />
                  </label>
                  <label className="field">
                    <span>题库标题</span>
                    <input value={editor.meta.title} onChange={(event) => updateMeta("title", event.target.value)} />
                  </label>
                  <label className="field">
                    <span>副标题</span>
                    <input value={editor.meta.subtitle} onChange={(event) => updateMeta("subtitle", event.target.value)} />
                  </label>
                  <label className="field">
                    <span>题库描述</span>
                    <input value={editor.meta.description} onChange={(event) => updateMeta("description", event.target.value)} />
                  </label>
                  <label className="field">
                    <span>及格分</span>
                    <input type="number" value={editor.meta.passScore} onChange={(event) => updateMeta("passScore", Number(event.target.value || 0))} />
                  </label>
                  <label className="field">
                    <span>答题时长（秒）</span>
                    <input type="number" value={editor.meta.durationSec} onChange={(event) => updateMeta("durationSec", Number(event.target.value || 0))} />
                  </label>
                  <label className="field">
                    <span>考试模式</span>
                    <select className="editor-select" value={editor.meta.examMode} onChange={(event) => updateMeta("examMode", event.target.value as ExamMode)}>
                      <option value="closed_book">闭卷</option>
                      <option value="open_book">开卷</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>组卷方式</span>
                    <select className="editor-select" value={editor.meta.selectionMode} onChange={(event) => updateMeta("selectionMode", event.target.value as SelectionMode)}>
                      <option value="fixed">固定整卷</option>
                      <option value="random">随机抽题</option>
                    </select>
                  </label>
                  <label className="checkbox-row editor-toggle-row">
                    <input type="checkbox" checked={editor.meta.shuffleQuestions} onChange={(event) => updateMeta("shuffleQuestions", event.target.checked)} />
                    <span>开启题目乱序</span>
                  </label>
                  <label className="checkbox-row editor-toggle-row">
                    <input type="checkbox" checked={editor.meta.requireFullscreen} onChange={(event) => updateMeta("requireFullscreen", event.target.checked)} />
                    <span>要求全屏作答</span>
                  </label>
                </div>

                {editor.meta.selectionMode === "random" ? (
                  <div className="meta-grid editor-meta-grid-wide">
                    <label className="field">
                      <span>总抽题数</span>
                      <input type="number" value={editor.meta.drawCount ?? ""} onChange={(event) => updateMeta("drawCount", sanitizeOptionalCount(Number(event.target.value || 0)))} placeholder="留空则按题型抽题数汇总" />
                    </label>
                    <label className="field">
                      <span>单选抽题数</span>
                      <input type="number" value={editor.meta.drawSingleCount ?? ""} onChange={(event) => updateMeta("drawSingleCount", sanitizeOptionalCount(Number(event.target.value || 0)))} />
                    </label>
                    <label className="field">
                      <span>多选抽题数</span>
                      <input type="number" value={editor.meta.drawMultipleCount ?? ""} onChange={(event) => updateMeta("drawMultipleCount", sanitizeOptionalCount(Number(event.target.value || 0)))} />
                    </label>
                    <label className="field">
                      <span>文本抽题数</span>
                      <input type="number" value={editor.meta.drawTextCount ?? ""} onChange={(event) => updateMeta("drawTextCount", sanitizeOptionalCount(Number(event.target.value || 0)))} />
                    </label>
                  </div>
                ) : null}
              </section>

              <section className="editor-section">
                <div className="section-head">
                  <StatusPill label="Question Bank" />
                  <h2>题目编辑</h2>
                </div>
                <div className="hero-info-card compact editor-summary-strip editor-summary-strip-wide">
                  <span>{editor.questions.length} 题</span>
                  <span>总分 {totalPoints}</span>
                  <span>{editor.meta.passScore} 分及格</span>
                  <span>{getSelectionPreview(editor.meta, editor.questions.length)}</span>
                </div>

                <div className="question-editor-list">
                  {editor.questions.map((question, index) => (
                    <section key={`${question.id}-${index}`} className="question-editor-card">
                      <div className="question-editor-head">
                        <div>
                          <span className="question-index">{String(index + 1).padStart(2, "0")}</span>
                        </div>
                        <div className="question-editor-title">
                          <h3>{question.prompt || `未命名题目 ${index + 1}`}</h3>
                          <div className="editor-question-tags">
                            <span className="editor-tag">{getGroupLabel(question.group)}</span>
                            <span className="editor-tag">{getTypeLabel(question.type)}</span>
                            <span className="editor-tag">{question.points} 分</span>
                            {question.media?.url ? <span className="editor-tag">媒体题</span> : null}
                          </div>
                        </div>
                        <div className="question-editor-actions">
                          <button className="secondary-button" onClick={() => moveQuestion(index, -1)} disabled={index === 0}>上移</button>
                          <button className="secondary-button" onClick={() => moveQuestion(index, 1)} disabled={index === editor.questions.length - 1}>下移</button>
                          <button className="secondary-button" onClick={() => duplicateQuestion(index)}>复制</button>
                          <button className="secondary-button danger-button" onClick={() => removeQuestion(index)}>删除</button>
                        </div>
                      </div>

                      <div className="meta-grid meta-grid-tight editor-question-grid">
                        <label className="field">
                          <span>题目 ID</span>
                          <input value={question.id} onChange={(event) => updateQuestion(index, (current) => ({ ...current, id: event.target.value }))} />
                        </label>
                        <label className="field">
                          <span>题型</span>
                          <select className="editor-select" value={question.type} onChange={(event) => changeQuestionType(index, event.target.value as QuestionType)}>
                            <option value="single">单选题</option>
                            <option value="multiple">多选题</option>
                            <option value="text">文本题</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>作答分类</span>
                          <select className="editor-select" value={question.group} onChange={(event) => updateQuestion(index, (current) => ({ ...current, group: event.target.value as QuestionGroup }))}>
                            <option value="objective">客观题</option>
                            <option value="subjective">主观题</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>分值</span>
                          <input type="number" value={question.points} onChange={(event) => updateQuestion(index, (current) => ({ ...current, points: Number(event.target.value || 0) }))} />
                        </label>
                      </div>

                      <label className="field">
                        <span>题目内容</span>
                        <input value={question.prompt} onChange={(event) => updateQuestion(index, (current) => ({ ...current, prompt: event.target.value }))} />
                      </label>
                      <label className="field">
                        <span>题目说明</span>
                        <input value={question.description} onChange={(event) => updateQuestion(index, (current) => ({ ...current, description: event.target.value }))} placeholder="可以写题型提示、阅卷提示或作答限制" />
                      </label>

                      {question.type === "text" ? (
                        <div className="meta-grid meta-grid-tight editor-question-grid">
                          <label className="field">
                            <span>输入提示</span>
                            <input value={question.placeholder} onChange={(event) => updateQuestion(index, (current) => ({ ...current, placeholder: event.target.value }))} />
                          </label>
                          <label className="field">
                            <span>作答样式</span>
                            <select className="editor-select" value={question.inputStyle} onChange={(event) => updateQuestion(index, (current) => ({ ...current, inputStyle: event.target.value as TextInputStyle }))}>
                              <option value="short">短答</option>
                              <option value="essay">富文本长答</option>
                            </select>
                          </label>
                        </div>
                      ) : null}

                      <div className="answer-editor-block">
                        <div className="answer-editor-head">
                          <strong>多媒体</strong>
                          <button className={`secondary-button ${question.media ? "danger-button" : ""}`} onClick={() => toggleMedia(index)}>
                            {question.media ? "移除媒体" : "添加媒体"}
                          </button>
                        </div>
                        {question.media ? (
                          <div className="meta-grid editor-media-grid">
                            <label className="field">
                              <span>媒体类型</span>
                              <select className="editor-select" value={question.media.type} onChange={(event) => updateMedia(index, "type", event.target.value)}>
                                <option value="image">图片</option>
                                <option value="audio">音频</option>
                                <option value="video">视频</option>
                              </select>
                            </label>
                            <label className="field">
                              <span>媒体地址</span>
                              <input value={question.media.url} onChange={(event) => updateMedia(index, "url", event.target.value)} placeholder="支持 https://...、/media/xxx、./assets/xxx" />
                            </label>
                            <label className="field editor-media-span">
                              <span>媒体说明</span>
                              <input value={question.media.caption} onChange={(event) => updateMedia(index, "caption", event.target.value)} placeholder="可写题图说明、听力说明或视频提示" />
                            </label>
                          </div>
                        ) : (
                          <p className="muted">当前题目为纯文本。需要图、音频或视频时再开启即可；支持 http 地址和站内资源路径。</p>
                        )}
                      </div>

                      {question.type === "text" ? (
                        <div className="answer-editor-block">
                          <div className="answer-editor-head">
                            <strong>判定关键词 / 短语</strong>
                            <button className="secondary-button" onClick={() => addKeyword(index)}>新增关键词</button>
                          </div>
                          <div className="keyword-list">
                            {question.answer.map((item, keywordIndex) => (
                              <div key={`${question.id}-kw-${keywordIndex}`} className="option-editor-row">
                                <input className="editor-input-grow" value={item} onChange={(event) => updateKeyword(index, keywordIndex, event.target.value)} placeholder="例如 联系管理员" />
                                <button className="secondary-button danger-button" onClick={() => removeKeyword(index, keywordIndex)}>删除</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="answer-editor-block">
                          <div className="answer-editor-head">
                            <strong>选项与正确答案</strong>
                            <button className="secondary-button" onClick={() => addOption(index)}>新增选项</button>
                          </div>
                          <div className="option-editor-list">
                            {question.options.map((option, optionIndex) => {
                              const selected = question.answer.includes(option.key);
                              return (
                                <div key={`${question.id}-option-${optionIndex}`} className="option-editor-row option-editor-row-rich">
                                  <button className={`answer-pick ${selected ? "is-selected" : ""}`} onClick={() => toggleAnswer(index, option.key)} type="button">
                                    {question.type === "single" ? (selected ? "单选答案" : "设为答案") : selected ? "已选中" : "选择"}
                                  </button>
                                  <input className="editor-option-key" value={option.key} onChange={(event) => updateOption(index, optionIndex, "key", event.target.value)} placeholder="A" />
                                  <input className="editor-input-grow" value={option.text} onChange={(event) => updateOption(index, optionIndex, "text", event.target.value)} placeholder="填写选项内容" />
                                  <button className="secondary-button danger-button" onClick={() => removeOption(index, optionIndex)}>删除</button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </section>
                  ))}
                </div>

                <div className="studio-bottom-bar polished-card">
                  <div className="question-add-row question-add-row-bottom question-add-row-bottom-wide">
                    <button className="secondary-button" onClick={() => addQuestion("single")}>新增单选题</button>
                    <button className="secondary-button" onClick={() => addQuestion("multiple")}>新增多选题</button>
                    <button className="secondary-button" onClick={() => addQuestion("text")}>新增文本题</button>
                    <button className="secondary-button" onClick={renumberQuestionIds}>一键重排题号</button>
                    <button className="secondary-button" onClick={distributePointsToHundred}>按 100 分均分</button>
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <div className="yaml-editor-shell">
              <div className="button-row admin-actions-row admin-actions-row-wide">
                <button className="secondary-button" onClick={syncYamlToVisual}>同步到可视化编辑器</button>
              </div>
              <label className="field">
                <span>题库 YAML</span>
                <textarea className="studio-editor" value={yamlText} onChange={(event) => setYamlText(event.target.value)} />
              </label>
              {previewResult.error ? <p className="error-text">{previewResult.error}</p> : null}
            </div>
          )}

              <div className="note-box admin-note-box">
                <strong>发布说明</strong>
                <p>可视化模式会自动生成合法 YAML。发布时题库会先校验，再写回服务端文件并热更新到正式答题入口。</p>
              </div>
              {feedback ? <p className={`admin-feedback is-${feedbackTone}`}>{feedback}</p> : null}
              <div className="button-row">
                <button className="primary-button" onClick={publishQuiz}>发布题库</button>
              </div>
            </>
          ) : (
            <>
              <div className="button-row admin-actions-row admin-actions-row-wide">
                <button className="secondary-button" onClick={loadSiteYaml}>读取当前文案</button>
              </div>
              <div className="yaml-editor-shell">
                <label className="field">
                  <span>站点文案 YAML</span>
                  <textarea className="studio-editor" value={siteYamlText} onChange={(event) => setSiteYamlText(event.target.value)} />
                </label>
              </div>
              <div className="note-box admin-note-box">
                <strong>{settings.admin.siteSettingsTitle}</strong>
                <p>{settings.admin.siteSettingsNote}</p>
              </div>
              {feedback ? <p className={`admin-feedback is-${feedbackTone}`}>{feedback}</p> : null}
              <div className="button-row">
                <button className="primary-button" onClick={publishSiteSettings}>发布站点文案</button>
              </div>
            </>
          )}
        </article>

        <article className={`card polished-card studio-side-panel ${previewCollapsed ? "is-collapsed" : ""}`}>
          <div className="section-head studio-side-head">
            <div className="studio-side-head-copy">
              <StatusPill label={section === "quiz" ? "实时预览" : "Brand Preview"} />
              <h2>{section === "quiz" ? (preview?.meta.title ?? editor.meta.title) : (sitePreviewResult.data?.brandName || settings.brand.name)}</h2>
            </div>
            <button
              type="button"
              className={`studio-collapse-button ${previewCollapsed ? "is-collapsed" : ""}`}
              aria-label={previewCollapsed ? "展开实时预览" : "收起实时预览"}
              aria-expanded={!previewCollapsed}
              onClick={() => setPreviewCollapsed((current) => !current)}
            >
              <span aria-hidden="true">{previewCollapsed ? "‹" : "›"}</span>
            </button>
          </div>

          {previewCollapsed ? (
            <div className="studio-side-collapsed">
              <span>{section === "quiz" ? `${preview?.questions.length ?? editor.questions.length} 题` : (sitePreviewResult.data?.brandName || settings.brand.name)}</span>
              <span>{section === "quiz" ? `${preview?.meta.passScore ?? editor.meta.passScore} 分线` : settings.admin.siteSettingsTitle}</span>
              <span>{section === "quiz" ? `${quizItems.length} 份题集` : settings.brand.adminName}</span>
            </div>
          ) : (
            <>
              {section === "quiz" && previewResult.error ? <p className="error-text">{previewResult.error}</p> : null}
              {section === "site" && sitePreviewResult.error ? <p className="error-text">{sitePreviewResult.error}</p> : null}
              {section === "quiz" && preview ? (
                <>
                  <p className="muted">{preview.meta.description || "暂无描述"}</p>
                  <div className="hero-info-card compact studio-side-stats studio-side-stats-rich">
                    <span>{preview.meta.passScore} 分及格</span>
                    <span>{Math.round(preview.meta.durationSec / 60)} 分钟</span>
                    <span>{getExamModeLabel(preview.meta.examMode)}</span>
                    <span>{preview.meta.requireFullscreen ? "要求全屏" : "非全屏"}</span>
                    <span>{getSelectionPreview(preview.meta, preview.questions.length)}</span>
                    <span>{preview.questions.length} 题入库</span>
                  </div>
                  <div className="score-badges score-badges-rich studio-preview-badges">
                    {preview.questions.map((question, index) => (
                      <span key={`${question.id}-${index}`} className="badge-preview">
                        {question.id} · {getGroupLabel(question.group)} · {getTypeLabel(question.type)} · {question.points} 分
                      </span>
                    ))}
                  </div>
                </>
              ) : null}

              {section === "site" && sitePreviewResult.data ? (
                <>
                  <p className="muted">{settings.admin.siteSettingsNote}</p>
                  <div className="hero-info-card compact studio-side-stats studio-side-stats-rich">
                    <span>{sitePreviewResult.data.brandName || settings.brand.name}</span>
                    <span>{sitePreviewResult.data.adminName || settings.brand.adminName}</span>
                    <span>{sitePreviewResult.data.homeTitle || settings.home.title}</span>
                    <span>{sitePreviewResult.data.entryTitle || settings.entry.fallbackTitle}</span>
                  </div>
                </>
              ) : null}

              <div className="note-box studio-side-note studio-side-note-accent">
                <strong>{section === "quiz" ? "当前题库摘要" : settings.admin.siteSettingsTitle}</strong>
                <p>{section === "quiz" ? "右侧会持续显示题量、抽题方式、主客观比例和强制全屏状态，长题库编辑时不容易失焦。" : settings.admin.siteSettingsNote}</p>
              </div>

              {section === "quiz" ? (
                <>
                  <div className="section-head section-head-spaced">
                    <StatusPill label="已发布" />
                    <h2>服务端题集</h2>
                  </div>
                  <div className="stack-list studio-side-list">
                    {quizItems.length === 0 ? (
                      <div className="note-box studio-side-note">
                        <strong>暂未读取题集</strong>
                        <p>读取一次服务端题集后，这里就会出现已发布内容。</p>
                      </div>
                    ) : null}
                    {quizItems.map((item) => (
                      <div key={item.slug} className="quiz-card static">
                        <div>
                          <h3>{item.title}</h3>
                          <p>{item.slug}</p>
                        </div>
                        <div className="quiz-meta">
                          <span>{item.updatedAt ? new Date(item.updatedAt).toLocaleString("zh-CN") : "未同步"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}
        </article>
      </section>
    </Frame>
  );
}



