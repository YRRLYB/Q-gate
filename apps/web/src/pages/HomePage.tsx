import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Frame, LoadingStage, StatusPill } from "../layout";
import { useSiteSettings } from "../site";
import type { QuizListItem } from "../types";
import { preloadImages } from "../utils/preload";

const MIN_HOME_LOADING_MS = 700;

export function HomePage() {
  const [items, setItems] = useState<QuizListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [mediaReady, setMediaReady] = useState(false);
  const [error, setError] = useState("");
  const { settings } = useSiteSettings();
  const landscapeImage = useMemo(
    () =>
      `${settings.media.homeHeroImage}${settings.media.homeHeroImage.includes("?") ? "&" : "?"}t=${Date.now()}`,
    [settings.media.homeHeroImage],
  );
  const insetLandscapeImage = useMemo(
    () =>
      `${settings.media.homeInsetImage}${settings.media.homeInsetImage.includes("?") ? "&" : "?"}t=${Date.now() + 1}`,
    [settings.media.homeInsetImage],
  );

  useEffect(() => {
    api
      .listQuizzes()
      .then((payload) => setItems(payload.items))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    void preloadImages([landscapeImage, insetLandscapeImage]).then(() => {
      const remaining = Math.max(
        MIN_HOME_LOADING_MS - (Date.now() - startedAt),
        0,
      );
      window.setTimeout(() => {
        if (!cancelled) {
          setMediaReady(true);
        }
      }, remaining);
    });

    return () => {
      cancelled = true;
    };
  }, [landscapeImage, insetLandscapeImage]);

  if (loading || !mediaReady) {
    return (
      <LoadingStage label="HOME / PRELOAD" hint={settings.home.loadingHint} />
    );
  }

  return (
    <Frame
      eyebrow={settings.home.eyebrow}
      title={settings.home.title}
      subtitle={settings.home.subtitle}
      copyExtra={
        <>
          <div className="hero-mini-points hero-mini-points-home">
            {settings.home.flowSteps.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <div className="home-highlight-grid home-highlight-grid-simple">
            {settings.home.highlights.map((item) => (
              <div key={item.title} className="home-highlight-card">
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </div>
            ))}
          </div>
        </>
      }
      aside={
        <div className="home-hero-aside home-hero-aside-tight">
          <div className="home-hero-visual framed-media-card home-hero-visual-polished">
            <img
              src={landscapeImage}
              alt="服务器入口氛围图"
              className="hero-media-image"
              loading="eager"
              fetchPriority="high"
            />
            <div className="home-hero-inset framed-media-card home-hero-inset-polished">
              <img
                src={insetLandscapeImage}
                alt="社区视觉氛围图"
                className="hero-media-image"
                loading="eager"
              />
            </div>
          </div>
          <div className="hero-info-card hero-info-card-polished home-side-metrics home-side-metrics-compact">
            {settings.home.metrics.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
      }
    >
      <section className="content-grid content-grid-single">
        <article className="card entry-card quiz-entry-panel polished-card quiz-entry-panel-tight">
          <div className="section-head">
            <StatusPill label="Entry List" />
            <h2>{settings.home.entryListTitle}</h2>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
          <div className="stack-list stack-list-tight">
            {items.map((quiz) => (
              <Link
                key={quiz.slug}
                to={`/quiz/${quiz.slug}`}
                className="quiz-card quiz-card-immersive quiz-card-accented quiz-entry-cta-card"
              >
                <div>
                  <h3>{quiz.title}</h3>
                  <p>
                    {quiz.subtitle ??
                      quiz.description ??
                      "用于 Q-gate 准入、进群申请或社区审核的答题入口。"}
                  </p>
                </div>
                <div className="quiz-card-entry-hint">
                  {settings.home.entryCardHint}
                </div>
                <div className="quiz-meta">
                  <span>{quiz.passScore} 分及格</span>
                  <span>{Math.round(quiz.durationSec / 60)} 分钟</span>
                </div>
              </Link>
            ))}
          </div>
        </article>
      </section>
    </Frame>
  );
}
