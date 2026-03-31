import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, resultKey, sessionKey } from "../api";
import { Frame, LoadingStage, StatusPill } from "../layout";
import { useSiteSettings } from "../site";
import type { PublicQuestion, SessionRecord } from "../types";
import { preloadMediaAssets } from "../utils/preload";

const RESTART_NOTICE_KEY = "mqg_restart_notice";
const MAX_SECURITY_VIOLATIONS = 3;

function explainResumeError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "attempt_resume_failed";

  if (message === "attempt_closed") {
    return "这场答题已经结束，当前链接不能再继续作答。";
  }

  if (message === "attempt_not_found") {
    return "没有找到这场答题记录，请返回上一页重新开始。";
  }

  return message;
}

function formatTime(value: number) {
  const safe = Math.max(value, 0);
  const minutes = String(Math.floor(safe / 60)).padStart(2, "0");
  const seconds = String(safe % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function getQuestionTypeLabel(type: PublicQuestion["type"]) {
  return type === "single"
    ? "单选题"
    : type === "multiple"
      ? "多选题"
      : "文本题";
}

function getQuestionGroupLabel(group: PublicQuestion["group"]) {
  return group === "objective" ? "客观题" : "主观题";
}

function getExamModeLabel(mode: SessionRecord["quiz"]["examMode"]) {
  return mode === "open_book" ? "开卷" : "闭卷";
}

function QuestionMedia({ question }: { question: PublicQuestion }) {
  if (!question.media?.url) {
    return null;
  }

  return (
    <div className="question-media-block">
      {question.media.type === "image" ? (
        <img
          src={question.media.url}
          alt={question.media.caption ?? question.prompt}
          className="question-media-frame"
        />
      ) : null}
      {question.media.type === "audio" ? (
        <audio
          controls
          className="question-media-audio"
          src={question.media.url}
        />
      ) : null}
      {question.media.type === "video" ? (
        <video
          controls
          className="question-media-frame"
          src={question.media.url}
        />
      ) : null}
      {question.media.caption ? (
        <p className="question-media-caption">{question.media.caption}</p>
      ) : null}
    </div>
  );
}

type RichTextAnswerProps = {
  questionId: string;
  value: string;
  htmlValue: string;
  placeholder?: string;
  disabled: boolean;
  onChange: (payload: { text: string; html: string }) => void;
};

function RichTextAnswer({
  questionId,
  value,
  htmlValue,
  placeholder,
  disabled,
  onChange,
}: RichTextAnswerProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!editorRef.current) {
      return;
    }

    const nextHtml = htmlValue || value.replace(/\n/g, "<br />");
    if (editorRef.current.innerHTML !== nextHtml) {
      editorRef.current.innerHTML = nextHtml;
    }
  }, [htmlValue, value]);

  function syncEditor() {
    if (!editorRef.current) {
      return;
    }

    onChange({
      text: editorRef.current.innerText,
      html: editorRef.current.innerHTML,
    });
  }

  function runCommand(command: string, commandValue?: string) {
    if (disabled) {
      return;
    }

    editorRef.current?.focus();
    document.execCommand(command, false, commandValue);
    syncEditor();
  }

  return (
    <div className={`rich-answer-shell ${disabled ? "is-disabled" : ""}`}>
      <div className="rich-answer-toolbar">
        <button
          type="button"
          className="rich-tool-button"
          onClick={() => runCommand("bold")}
          disabled={disabled}
        >
          B
        </button>
        <button
          type="button"
          className="rich-tool-button"
          onClick={() => runCommand("italic")}
          disabled={disabled}
        >
          I
        </button>
        <button
          type="button"
          className="rich-tool-button"
          onClick={() => runCommand("insertUnorderedList")}
          disabled={disabled}
        >
          列表
        </button>
        <button
          type="button"
          className="rich-tool-button"
          onClick={() => runCommand("formatBlock", "blockquote")}
          disabled={disabled}
        >
          引用
        </button>
        <button
          type="button"
          className="rich-tool-button"
          onClick={() => runCommand("removeFormat")}
          disabled={disabled}
        >
          清除
        </button>
      </div>
      <div
        ref={editorRef}
        className="rich-answer-editor"
        data-placeholder={placeholder ?? "请输入答案"}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-question-id={questionId}
        onInput={syncEditor}
      />
    </div>
  );
}

export function QuizSessionPage() {
  const { slug = "", attemptId = "" } = useParams();
  const navigate = useNavigate();
  const { settings } = useSiteSettings();
  const [record, setRecord] = useState<SessionRecord | null>(null);
  const [recordLoading, setRecordLoading] = useState(true);
  const [recordError, setRecordError] = useState("");
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [richDrafts, setRichDrafts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [timeLeft, setTimeLeft] = useState(0);
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  const [activeQuestionId, setActiveQuestionId] = useState("");
  const [isFullscreenActive, setIsFullscreenActive] = useState(false);
  const [securityViolations, setSecurityViolations] = useState(0);
  const [securityMessage, setSecurityMessage] = useState("");
  const [fullscreenStarted, setFullscreenStarted] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaNotice, setMediaNotice] = useState("");
  const questionRefs = useRef<Array<HTMLElement | null>>([]);
  const wasHiddenRef = useRef(false);

  function applyRecord(nextRecord: SessionRecord) {
    setRecord(nextRecord);
    setAnswers({});
    setRichDrafts({});
    setAutoSubmitted(false);
    setSecurityViolations(0);
    setSecurityMessage("");
    setTimeLeft(
      Math.max(
        nextRecord.quiz.durationSec -
          Math.floor((Date.now() - nextRecord.startedAt) / 1000),
        0,
      ),
    );
    setActiveQuestionId(nextRecord.quiz.questions[0]?.id ?? "");
    setIsFullscreenActive(Boolean(document.fullscreenElement));
    setFullscreenStarted(Boolean(document.fullscreenElement));
    setMediaReady(false);
    setMediaNotice("");
    setError("");
  }

  useEffect(() => {
    let cancelled = false;

    setRecord(null);
    setRecordLoading(true);
    setRecordError("");

    const raw = sessionStorage.getItem(sessionKey(attemptId));
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as SessionRecord;
        if (!cancelled) {
          applyRecord(parsed);
          setRecordLoading(false);
        }
        return () => {
          cancelled = true;
        };
      } catch {
        sessionStorage.removeItem(sessionKey(attemptId));
      }
    }

    void api
      .getAttemptSession(attemptId)
      .then((payload) => {
        if (cancelled) {
          return;
        }

        const resumedRecord: SessionRecord = {
          attemptId: payload.attemptId,
          quiz: payload.quiz,
          playerName: payload.playerName,
          qq: "",
          startedAt: new Date(payload.startedAt).getTime(),
        };

        sessionStorage.setItem(
          sessionKey(payload.attemptId),
          JSON.stringify(resumedRecord),
        );
        applyRecord(resumedRecord);
      })
      .catch((err) => {
        if (!cancelled) {
          setRecordError(explainResumeError(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRecordLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  useEffect(() => {
    if (!record) {
      return;
    }

    let cancelled = false;
    setMediaReady(false);
    setMediaNotice("");

    void preloadMediaAssets(
      record.quiz.questions
        .filter((question) => question.media?.url)
        .map((question) => ({
          type: question.media!.type,
          url: question.media!.url,
        })),
    ).then((summary) => {
      if (cancelled) {
        return;
      }

      setMediaReady(true);
      if (summary.forced > 0) {
        setMediaNotice(
          `有 ${summary.forced} 个多媒体资源在两轮预加载后仍未完全打开，Q-gate 已放行进入答题，相关资源会继续尝试加载。`,
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [record]);

  function registerViolation(message: string) {
    setSecurityViolations((current) => {
      const next = current + 1;
      setSecurityMessage(
        `${message} 当前已记录 ${next} / ${MAX_SECURITY_VIOLATIONS} 次。`,
      );
      return next;
    });
  }

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreenActive(active);

      if (active) {
        setFullscreenStarted(true);
        return;
      }

      if (record?.quiz.requireFullscreen && fullscreenStarted) {
        registerViolation("检测到你退出了全屏模式。请重新进入全屏继续作答。");
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [record, fullscreenStarted]);

  useEffect(() => {
    if (!record?.quiz.requireFullscreen) {
      return;
    }

    const handleVisibility = () => {
      if (document.hidden) {
        wasHiddenRef.current = true;
        return;
      }

      if (!wasHiddenRef.current) {
        return;
      }

      wasHiddenRef.current = false;
      registerViolation("检测到你切离了答题页面。请回到全屏环境后继续作答。");
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [record]);

  useEffect(() => {
    if (securityViolations < MAX_SECURITY_VIOLATIONS) {
      return;
    }

    sessionStorage.removeItem(sessionKey(attemptId));
    sessionStorage.setItem(
      RESTART_NOTICE_KEY,
      "安全校验触发次数已达上限，本次答题已作废，请重新绑定后再次开始。",
    );
    navigate(`/quiz/${slug}?restart=security`, { replace: true });
  }, [attemptId, navigate, securityViolations, slug]);

  useEffect(() => {
    if (!record) {
      return;
    }

    const timer = window.setInterval(() => {
      const next =
        record.quiz.durationSec -
        Math.floor((Date.now() - record.startedAt) / 1000);
      setTimeLeft(Math.max(next, 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [record]);

  useEffect(() => {
    if (!record) {
      return;
    }

    const questions = record.quiz.questions;

    function updateActiveQuestion() {
      const candidates = questionRefs.current
        .map((node, index) => {
          if (!node) {
            return null;
          }

          const rect = node.getBoundingClientRect();
          return {
            id: questions[index]?.id ?? "",
            offset: Math.abs(rect.top - 168),
          };
        })
        .filter(Boolean) as Array<{ id: string; offset: number }>;

      if (candidates.length === 0) {
        return;
      }

      candidates.sort((left, right) => left.offset - right.offset);
      setActiveQuestionId(candidates[0].id);
    }

    updateActiveQuestion();
    window.addEventListener("scroll", updateActiveQuestion, { passive: true });
    window.addEventListener("resize", updateActiveQuestion);

    return () => {
      window.removeEventListener("scroll", updateActiveQuestion);
      window.removeEventListener("resize", updateActiveQuestion);
    };
  }, [record]);

  async function requestFullscreenMode() {
    if (!record?.quiz.requireFullscreen) {
      return;
    }

    try {
      setError("");
      setSecurityMessage("");
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "fullscreen_request_failed",
      );
    }
  }

  async function handleSubmit(source: "manual" | "auto" = "manual") {
    if (!record) {
      return;
    }

    try {
      setSubmitting(true);
      if (source === "auto") {
        setError("作答时间已到，系统正在自动交卷。");
      }
      const result = await api.submitAttempt(record.attemptId, answers);
      sessionStorage.setItem(
        resultKey(record.attemptId),
        JSON.stringify(result),
      );
      navigate(`/quiz/${slug}/result/${record.attemptId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "submit_failed");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (!record || autoSubmitted || submitting || timeLeft > 0) {
      return;
    }

    setAutoSubmitted(true);
    void handleSubmit("auto");
  }, [autoSubmitted, record, submitting, timeLeft]);

  function updateSingle(id: string, value: string) {
    setAnswers((current) => ({ ...current, [id]: value }));
  }

  function updateRichText(id: string, payload: { text: string; html: string }) {
    setAnswers((current) => ({ ...current, [id]: payload.text }));
    setRichDrafts((current) => ({ ...current, [id]: payload.html }));
  }

  function updateMultiple(id: string, option: string, checked: boolean) {
    setAnswers((current) => {
      const existing = Array.isArray(current[id])
        ? [...(current[id] as string[])]
        : [];
      const next = checked
        ? [...new Set([...existing, option])]
        : existing.filter((item) => item !== option);
      return { ...current, [id]: next };
    });
  }

  function jumpToQuestion(index: number) {
    const target = questionRefs.current[index];
    if (target) {
      const top = target.getBoundingClientRect().top + window.scrollY - 136;
      window.scrollTo({ top, behavior: "smooth" });
    }
    setActiveQuestionId(record?.quiz.questions[index]?.id ?? "");
  }

  const requiresFullscreenEntry = Boolean(
    record?.quiz.requireFullscreen && !isFullscreenActive,
  );
  const locked = submitting || timeLeft <= 0 || requiresFullscreenEntry;
  const progress = useMemo(() => {
    if (!record) {
      return 0;
    }

    return Math.max(
      Math.min((timeLeft / record.quiz.durationSec) * 100, 100),
      0,
    );
  }, [record, timeLeft]);

  const answeredCount = useMemo(() => {
    if (!record) {
      return 0;
    }

    return record.quiz.questions.filter((question) => {
      const value = answers[question.id];
      return typeof value === "string"
        ? value.trim().length > 0
        : Array.isArray(value)
          ? value.length > 0
          : false;
    }).length;
  }, [answers, record]);

  const questionCount =
    record?.quiz.displayQuestionCount ?? record?.quiz.questions.length ?? 0;
  const needsSecurityOverlay = Boolean(
    record?.quiz.requireFullscreen && (!isFullscreenActive || securityMessage),
  );

  if (recordLoading) {
    return (
      <LoadingStage
        label="SESSION / LOAD"
        hint={settings.session.loadingHint}
      />
    );
  }

  if (!record) {
    return (
      <Frame
        eyebrow="SESSION / LOST"
        title={settings.session.lostTitle}
        subtitle={settings.session.lostSubtitle}
      >
        <section className="content-grid content-grid-single">
          <article className="card">
            {recordError ? <p className="error-text">{recordError}</p> : null}
            <Link to={`/quiz/${slug}`} className="ghost-link">
              {settings.session.lostBackLabel}
            </Link>
          </article>
        </section>
      </Frame>
    );
  }

  if (!mediaReady) {
    return (
      <LoadingStage
        label="SESSION / PRELOAD"
        hint={settings.session.loadingHint}
      />
    );
  }

  if (needsSecurityOverlay) {
    return (
      <div className="page-shell security-shell">
        <div className="background-grid" />
        <div className="security-overlay security-overlay-fullscreen">
          <div className="security-overlay-card security-overlay-card-compact">
            <StatusPill label="Security" />
            <h3>
              {isFullscreenActive
                ? "请先处理当前安全警告"
                : settings.session.fullscreenTitle}
            </h3>
            <p>{securityMessage || settings.session.fullscreenBody}</p>
            <div className="security-overlay-actions">
              {!isFullscreenActive ? (
                <button
                  className="primary-button"
                  onClick={() => void requestFullscreenMode()}
                >
                  {settings.session.fullscreenButton}
                </button>
              ) : null}
              {isFullscreenActive && securityMessage ? (
                <button
                  className="primary-button"
                  onClick={() => setSecurityMessage("")}
                >
                  {settings.session.resumeButton}
                </button>
              ) : null}
            </div>
            <div className="hero-mini-points security-chip-row">
              <span>已记录 {securityViolations} 次</span>
              <span>达到 {MAX_SECURITY_VIOLATIONS} 次将重新作答</span>
            </div>
            {error ? <p className="error-text">{error}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Frame
      eyebrow={settings.session.eyebrow}
      title={record.quiz.title}
      subtitle={settings.session.subtitle}
      heroClassName="hero-panel-compact hero-panel-session"
      aside={
        <div
          className={`countdown-panel ${timeLeft <= 120 ? "is-urgent" : ""}`}
        >
          <span className="countdown-label">Remaining</span>
          <strong className="countdown-value">{formatTime(timeLeft)}</strong>
          <div className="timer-track">
            <span className="timer-fill" style={{ width: `${progress}%` }} />
          </div>
          <p>
            {timeLeft <= 120
              ? "最后两分钟，请尽快检查后提交。"
              : `${record.playerName}，按自己的节奏答题就好。`}
          </p>
        </div>
      }
    >
      <section className="exam-layout-grid">
        <article className="card card-large exam-shell exam-shell-guarded">
          <div className="exam-toolbar exam-toolbar-rich">
            <div className="hero-info-card compact compact-four exam-toolbar-grid">
              <span>{questionCount} 题</span>
              <span>{record.quiz.passScore} 分及格</span>
              <span>{getExamModeLabel(record.quiz.examMode)}</span>
              <span>
                {answeredCount} / {questionCount} 已作答
              </span>
              <span>
                {record.quiz.requireFullscreen
                  ? `安全校验 ${securityViolations} / ${MAX_SECURITY_VIOLATIONS}`
                  : "常规作答"}
              </span>
            </div>
          </div>

          <div className="question-stack">
            {record.quiz.questions.map((question, index) => {
              const isRichText =
                question.type === "text" &&
                (question.group === "subjective" ||
                  question.inputStyle === "essay");
              return (
                <section
                  key={question.id}
                  ref={(node) => {
                    questionRefs.current[index] = node;
                  }}
                  className="question-card question-card-rich"
                >
                  <div className="question-head question-head-rich">
                    <span className="question-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="question-head-copy">
                      <div className="question-meta-row">
                        <span className="question-type-badge">
                          {getQuestionTypeLabel(question.type)}
                        </span>
                        <span className="question-type-badge is-soft">
                          {getQuestionGroupLabel(question.group)}
                        </span>
                        <span className="question-type-badge is-soft">
                          {question.points} 分
                        </span>
                      </div>
                      <h3>{question.prompt}</h3>
                      <p>
                        {question.description ??
                          `请完成这道${getQuestionTypeLabel(question.type)}。`}
                      </p>
                    </div>
                  </div>

                  <QuestionMedia question={question} />

                  {question.type === "text" && isRichText ? (
                    <RichTextAnswer
                      questionId={question.id}
                      value={
                        typeof answers[question.id] === "string"
                          ? (answers[question.id] as string)
                          : ""
                      }
                      htmlValue={richDrafts[question.id] ?? ""}
                      placeholder={question.placeholder ?? "请输入答案"}
                      disabled={locked}
                      onChange={(payload) =>
                        updateRichText(question.id, payload)
                      }
                    />
                  ) : null}

                  {question.type === "text" && !isRichText ? (
                    <textarea
                      className={`text-answer ${question.inputStyle === "essay" ? "is-essay" : "is-short"}`}
                      rows={question.inputStyle === "essay" ? 8 : 4}
                      placeholder={question.placeholder ?? "请输入答案"}
                      value={
                        typeof answers[question.id] === "string"
                          ? (answers[question.id] as string)
                          : ""
                      }
                      onChange={(event) =>
                        updateSingle(question.id, event.target.value)
                      }
                      disabled={locked}
                    />
                  ) : null}

                  {question.type === "single" ? (
                    <div className="option-grid option-grid-rich option-grid-clean">
                      {question.options?.map((option) => {
                        const checked = answers[question.id] === option.key;
                        return (
                          <label
                            key={option.key}
                            className={`option-card option-card-rich option-card-clean ${checked ? "is-selected" : ""}`}
                          >
                            <input
                              type="radio"
                              name={question.id}
                              checked={checked}
                              onChange={() =>
                                updateSingle(question.id, option.key)
                              }
                              disabled={locked}
                            />
                            <span className="option-key-badge">
                              {option.key}
                            </span>
                            <div className="option-copy">
                              <strong>{option.text}</strong>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  ) : null}

                  {question.type === "multiple" ? (
                    <div className="option-grid option-grid-rich option-grid-clean">
                      {question.options?.map((option) => {
                        const value = Array.isArray(answers[question.id])
                          ? (answers[question.id] as string[])
                          : [];
                        const checked = value.includes(option.key);
                        return (
                          <label
                            key={option.key}
                            className={`option-card option-card-rich option-card-clean ${checked ? "is-selected" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) =>
                                updateMultiple(
                                  question.id,
                                  option.key,
                                  event.target.checked,
                                )
                              }
                              disabled={locked}
                            />
                            <span className="option-key-badge">
                              {option.key}
                            </span>
                            <div className="option-copy">
                              <strong>{option.text}</strong>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
          {mediaNotice ? <p className="muted">{mediaNotice}</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
          <div className="button-row split-actions">
            <p className="muted">{settings.session.submitHint}</p>
            <button
              className="primary-button"
              onClick={() => void handleSubmit()}
              disabled={submitting || autoSubmitted || locked}
            >
              {submitting ? "正在提交…" : settings.session.submitButton}
            </button>
          </div>
        </article>

        <aside className="card exam-nav-card polished-card">
          <div className="section-head">
            <StatusPill label="Question Nav" />
            <h2>{settings.session.navTitle}</h2>
          </div>
          <div className="hero-info-card compact exam-nav-summary">
            <span>剩余时间 {formatTime(timeLeft)}</span>
            <span>
              已作答 {answeredCount} / {questionCount}
            </span>
            <span>当前 {activeQuestionId || "--"}</span>
          </div>
          <div className="exam-nav-grid">
            {record.quiz.questions.map((question, index) => {
              const value = answers[question.id];
              const answered =
                typeof value === "string"
                  ? value.trim().length > 0
                  : Array.isArray(value)
                    ? value.length > 0
                    : false;
              const active = activeQuestionId === question.id;
              return (
                <button
                  key={question.id}
                  className={`exam-nav-button ${answered ? "is-answered" : ""} ${active ? "is-active" : ""}`}
                  onClick={() => jumpToQuestion(index)}
                >
                  {String(index + 1).padStart(2, "0")}
                </button>
              );
            })}
          </div>
        </aside>
      </section>
    </Frame>
  );
}
