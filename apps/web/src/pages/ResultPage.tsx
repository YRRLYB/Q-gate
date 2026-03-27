import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { resultKey } from "../api";
import { Frame } from "../layout";
import { useSiteSettings } from "../site";
import type { SubmitResponse } from "../types";

function formatCountdown(ms: number) {
  const safeSeconds = Math.max(Math.floor(ms / 1000), 0);
  const minutes = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
  const seconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function fallbackCopy(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  return copied;
}

export function ResultPage() {
  const { slug = "", attemptId = "" } = useParams();
  const { settings } = useSiteSettings();
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [remainingMs, setRemainingMs] = useState(0);
  const [initialRemainingMs, setInitialRemainingMs] = useState(0);
  const [openedItems, setOpenedItems] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const raw = sessionStorage.getItem(resultKey(attemptId));
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw) as SubmitResponse;
    setResult(parsed);
    if (parsed.expiresAt) {
      const initial = Math.max(parsed.expiresAt - Date.now(), 0);
      setRemainingMs(initial);
      setInitialRemainingMs(initial);
    }
  }, [attemptId]);

  useEffect(() => {
    const expiresAt = result?.expiresAt;

    if (!expiresAt) {
      return;
    }

    const timer = window.setInterval(() => {
      setRemainingMs(Math.max(expiresAt - Date.now(), 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [result?.expiresAt]);

  const wrongItems = useMemo(() => result?.graded.filter((item) => !item.correct) ?? [], [result]);
  const countdownRatio = useMemo(() => {
    if (!initialRemainingMs) {
      return 100;
    }

    return Math.max(Math.min((remainingMs / initialRemainingMs) * 100, 100), 0);
  }, [initialRemainingMs, remainingMs]);

  async function copyCode() {
    if (!result?.verificationCode) {
      return;
    }

    try {
      setCopyError("");
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(result.verificationCode);
      } else {
        const copiedByFallback = fallbackCopy(result.verificationCode);
        if (!copiedByFallback) {
          throw new Error("copy_failed");
        }
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopyError("当前环境限制了自动复制，请手动长按验证码复制。");
    }
  }

  function toggleReview(id: string) {
    setOpenedItems((current) => ({ ...current, [id]: !current[id] }));
  }

  return (
    <Frame
      eyebrow={settings.result.eyebrow}
      title={result?.passed ? settings.result.passTitle : settings.result.failTitle}
      subtitle={
        result?.passed
          ? settings.result.passSubtitle
          : settings.result.failSubtitle
      }
      aside={
        result ? (
          <div className={`result-hero-aside ${result.passed ? "is-pass" : "is-fail"}`}>
            <span className="result-hero-kicker">{result.passed ? "APPLICATION READY" : "REVIEW NEEDED"}</span>
            <div className="result-hero-main">
              <strong>{result.score}</strong>
              <span>/ {result.maxScore}</span>
            </div>
            <p>{result.passed ? `已达到及格线 ${result.passScore}，可以继续完成进群申请。` : `距离及格线 ${result.passScore} 还差一点，先把错题看完再重答。`}</p>
          </div>
        ) : null
      }
    >
      <section className="content-grid content-grid-single result-layout">
        <article className="card card-large result-summary-card polished-card">
          {!result ? <p className="muted">尚未找到这次作答结果。</p> : null}
          {result ? (
            <>
              <div className="result-meta-strip">
                <span>答对点数 {result.earnedPointsTotal} / {result.totalPoints}</span>
                <span>及格线 {result.passScore}</span>
                <span>{wrongItems.length === 0 ? "本次无错题" : `错题 ${wrongItems.length} 道`}</span>
              </div>

              {result.passed ? (
                <>
                  <div className="token-panel verification-panel verification-panel-polished verification-panel-hero">
                    <div className="verification-panel-grid">
                      <div className="verification-main-block">
                        <div className="verification-meta-row">
                          <span className="review-answer-label">进群申请验证码</span>
                          <span className="verification-security-tag">安全时效中</span>
                        </div>
                        <code>{result.verificationCode}</code>
                        <p>{result.expiresAt ? `请在有效期内填写到进群申请问题。截止时间：${new Date(result.expiresAt).toLocaleString("zh-CN")}` : "验证码有效期未提供"}</p>
                      </div>
                      <div className={`verification-timer-hero ${remainingMs <= 300000 ? "is-urgent" : ""}`}>
                        <span className="verification-timer-label">安全倒计时</span>
                        <strong>{formatCountdown(remainingMs)}</strong>
                        <div className="verification-timer-track">
                          <span className="verification-timer-fill" style={{ width: `${countdownRatio}%` }} />
                        </div>
                        <p>{remainingMs <= 300000 ? "剩余时间不多了，建议现在就去填写申请问题。" : "验证码仍在有效期内，可直接用于进群申请验证。"}</p>
                      </div>
                    </div>
                  </div>
                  <div className="button-row split-actions result-action-row">
                    <button className="primary-button" type="button" onClick={copyCode}>
                      {copied ? settings.result.copiedButton : settings.result.copyButton}
                    </button>
                    <Link className="secondary-button" to="/">
                      {settings.result.homeButton}
                    </Link>
                  </div>
                  {copyError ? <p className="muted result-copy-note">{copyError}</p> : null}
                </>
              ) : (
                <div className="button-row split-actions">
                  <p className="muted">看完下面的错题解析后，再重新开一轮通常会更稳。</p>
                  <Link className="primary-button link-button" to={`/quiz/${slug}`}>
                    {settings.result.retryButton}
                  </Link>
                </div>
              )}
            </>
          ) : null}
        </article>

        {result ? (
          <article className="card result-review-card polished-card">
            <div className="section-head">
              <span className="status-pill">Review</span>
              <h2>{wrongItems.length === 0 ? settings.result.noWrongTitle : settings.result.reviewTitle}</h2>
            </div>
            {wrongItems.length === 0 ? (
              <p className="muted">{settings.result.noWrongBody}</p>
            ) : (
              <div className="review-list">
                {wrongItems.map((item, index) => {
                  const opened = Boolean(openedItems[item.id]);
                  return (
                    <section key={item.id} className={`review-card review-collapsible ${opened ? "is-open" : ""}`}>
                      <div className="review-card-head review-card-head-tight">
                        <span className="question-index">{String(index + 1).padStart(2, "0")}</span>
                        <div>
                          <h3>{item.prompt}</h3>
                          <p>{item.earnedPoints} / {item.points} 分</p>
                        </div>
                        <button className="secondary-button review-toggle" type="button" onClick={() => toggleReview(item.id)}>
                          {opened ? "收起解析" : "查看解析"}
                        </button>
                      </div>
                      {opened ? (
                        <div className="review-detail-stack">
                          <div className="review-answer-block fail">
                            <span className="review-answer-label">你的答案</span>
                            <p>{item.submittedAnswer || "未作答"}</p>
                          </div>
                          <div className="review-answer-block success">
                            <span className="review-answer-label">正确答案</span>
                            <p>{item.correctAnswer}</p>
                          </div>
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            )}
          </article>
        ) : null}
      </section>
    </Frame>
  );
}
