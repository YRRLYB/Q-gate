import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, sessionKey } from "../api";
import { Frame, LoadingStage, StatusPill } from "../layout";
import { useSiteSettings } from "../site";
import type { PublicQuiz, SessionRecord } from "../types";
import { preloadImages } from "../utils/preload";

const RESTART_NOTICE_KEY = "mqg_restart_notice";

export function QuizEntryPage() {
  const { slug = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState<PublicQuiz | null>(null);
  const [qq, setQq] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [confirmAvatar, setConfirmAvatar] = useState(false);
  const [confirmPrivacy, setConfirmPrivacy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [heroReady, setHeroReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { settings } = useSiteSettings();
  const heroImage = useMemo(
    () => `${settings.media.entryHeroImage}${settings.media.entryHeroImage.includes("?") ? "&" : "?"}t=${Date.now()}`,
    [settings.media.entryHeroImage]
  );

  useEffect(() => {
    api
      .getQuiz(slug)
      .then((payload) => setQuiz(payload))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    let cancelled = false;

    void preloadImages([heroImage]).then(() => {
      if (!cancelled) {
        setHeroReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [heroImage]);

  useEffect(() => {
    setConfirmAvatar(false);
  }, [qq]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get("restart");
    const fromStorage = sessionStorage.getItem(RESTART_NOTICE_KEY);
    if (fromStorage) {
      setError(fromStorage);
      sessionStorage.removeItem(RESTART_NOTICE_KEY);
      return;
    }

    if (fromQuery === "security") {
      setError("本次作答的安全校验触发次数已达上限，请重新绑定后再次开始答题。");
    }
  }, [location.search]);

  const normalizedQq = qq.trim();
  const normalizedPlayerName = playerName.trim();
  const validQq = useMemo(() => /^[1-9]\d{4,11}$/.test(normalizedQq), [normalizedQq]);
  const avatarUrl = validQq ? `https://q1.qlogo.cn/g?b=qq&nk=${normalizedQq}&s=640` : "";
  const canStart = validQq && normalizedPlayerName.length >= 3 && confirmAvatar && confirmPrivacy && !submitting;

  async function handleStart() {
    if (!canStart) {
      return;
    }

    try {
      setSubmitting(true);
      setError("");
      const started = await api.startAttempt({ quizSlug: slug, qq: normalizedQq, playerName: normalizedPlayerName });
      const record: SessionRecord = {
        attemptId: started.attemptId,
        quiz: started.quiz,
        playerName: normalizedPlayerName,
        qq: normalizedQq,
        startedAt: Date.now()
      };
      sessionStorage.setItem(sessionKey(started.attemptId), JSON.stringify(record));
      navigate(`/quiz/${slug}/session/${started.attemptId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "start_failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !heroReady) {
    return <LoadingStage label="ENTRY / PRELOAD" hint={settings.entry.loadingHint} />;
  }

  return (
    <Frame
      eyebrow={settings.entry.eyebrow}
      title={quiz?.title ?? settings.entry.fallbackTitle}
      subtitle={quiz?.description ?? settings.entry.fallbackSubtitle}
      heroClassName="hero-panel-compact hero-panel-entry hero-panel-entry-refined"
      copyExtra={
        <div className="hero-mini-points hero-mini-points-entry hero-mini-points-entry-refined">
          {settings.entry.flowSteps.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      }
      aside={
        quiz ? (
          <div className="hero-entry-summary hero-entry-summary-compact hero-entry-summary-lite">
            <div className="hero-info-card hero-info-card-polished hero-entry-quickstats hero-entry-quickstats-lite">
              <span>{quiz.passScore} 分及格</span>
              <span>{Math.round(quiz.durationSec / 60)} 分钟</span>
              <span>{quiz.requireFullscreen ? "需全屏作答" : "常规作答"}</span>
            </div>
            <div className="home-highlight-card hero-copy-card entry-summary-card entry-summary-card-lite">
              <strong>提交前确认一次</strong>
              <p>{settings.entry.bindingExplain}</p>
            </div>
          </div>
        ) : null
      }
    >
      <section className="content-grid content-grid-single">
        <article className="card card-large identity-card polished-card identity-card-refined">
          {error ? <p className="error-text">{error}</p> : null}
          {quiz ? (
            <div className="entry-workspace entry-workspace-refined entry-workspace-stacked">
              <div className="entry-main-stack entry-main-stack-refined">
                <div className="section-head">
                  <StatusPill label="绑定信息" />
                  <h2>{settings.entry.bindingTitle}</h2>
                </div>

                <div className="binding-composer">
                  <div className="binding-form-column">
                    <label className="field field-qq-main">
                      <span>QQ 号</span>
                      <input value={qq} onChange={(event) => setQq(event.target.value)} placeholder="例如 123456789" inputMode="numeric" />
                      <small className="field-hint">这个 QQ 会作为进群申请的校验依据，填错会导致验证码无法用于你的申请。</small>
                    </label>

                    <div className={`avatar-card inline-avatar-card ${validQq ? "is-ready" : ""}`}>
                      <div className="avatar-card-head entry-avatar-head-simple">
                        <strong>{validQq ? "QQ 头像实时预览" : "输入 QQ 后会在这里实时显示头像"}</strong>
                        <p>{validQq ? `请确认 ${normalizedQq} 就是你准备进群申请时使用的 QQ。` : "头像会跟随 QQ 输入实时更新，确认无误后再继续。"}</p>
                      </div>
                      {validQq ? (
                        <div className="entry-avatar-focus inline-avatar-focus">
                          <img src={avatarUrl} alt="QQ 头像预览" className="avatar-preview inline-avatar-image" loading="eager" />
                          <div className="entry-avatar-copy entry-avatar-copy-balanced inline-avatar-copy">
                            <p>QQ：{normalizedQq}</p>
                            <p className="muted">确认无误后勾选下方确认项再开始。</p>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <label className="field field-player-main">
                      <span>Minecraft 用户名</span>
                      <input value={playerName} onChange={(event) => setPlayerName(event.target.value)} placeholder="例如 MyPlayer" />
                      <small className="field-hint">建议填写你实际申请入服时会使用的游戏账号。</small>
                    </label>
                  </div>

                  <aside className="binding-visual-column">
                    <div className="entry-side-visual entry-side-visual-refined entry-side-visual-inline framed-media-card">
                      <img src={heroImage} alt="Q-gate 社区氛围插画" className="hero-side-image" loading="eager" fetchPriority="high" />
                    </div>
                    <div className="warning-box floating-panel entry-side-note entry-side-note-inline">
                      <strong>{settings.entry.warning.title}</strong>
                      <p>{settings.entry.warning.body}</p>
                    </div>
                  </aside>
                </div>

                <div className="consent-list consent-list-entry">
                  <label className="checkbox-row checkbox-row-polished">
                    <input type="checkbox" checked={confirmAvatar} onChange={(event) => setConfirmAvatar(event.target.checked)} disabled={!validQq} />
                    <span>{settings.entry.confirmAvatar}</span>
                  </label>
                  <label className="checkbox-row checkbox-row-polished">
                    <input type="checkbox" checked={confirmPrivacy} onChange={(event) => setConfirmPrivacy(event.target.checked)} />
                    <span>{settings.entry.confirmPrivacy}</span>
                  </label>
                </div>

                <div className="note-box privacy-note-box privacy-note-box-refined">
                  <strong>{settings.entry.bindingNote.title}</strong>
                  <p>{settings.entry.bindingNote.body}</p>
                </div>

                <button className="primary-button primary-button-entry" disabled={!canStart} onClick={handleStart}>
                  {submitting ? "正在创建答题会话…" : settings.entry.startButton}
                </button>
              </div>
            </div>
          ) : null}
        </article>
      </section>
    </Frame>
  );
}
