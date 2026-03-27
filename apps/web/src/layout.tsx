import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useSiteSettings } from "./site";

const UI_THEME_KEY = "review_ui_theme";
const THEME_ANIMATION_MS = 640;
const THEME_OPTIONS = ["sky", "night"] as const;
type UiTheme = (typeof THEME_OPTIONS)[number];

function useUiTheme() {
  const [theme, setTheme] = useState<UiTheme>(() => {
    if (typeof window === "undefined") {
      return "sky";
    }

    const saved = window.localStorage.getItem(UI_THEME_KEY);
    return saved === "night" ? "night" : "sky";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(UI_THEME_KEY, theme);
  }, [theme]);

  return [theme, setTheme] as const;
}

function nextTheme(theme: UiTheme): UiTheme {
  return theme === "sky" ? "night" : "sky";
}

function ShellHeader({ showNav = true }: { showNav?: boolean }) {
  const [theme, setTheme] = useUiTheme();
  const [isAnimating, setIsAnimating] = useState(false);
  const [transitionPhase, setTransitionPhase] = useState<"idle" | "launch" | "settle">("idle");
  const [overlayTheme, setOverlayTheme] = useState<UiTheme>(theme);
  const { settings } = useSiteSettings();
  const timerRefs = useRef<number[]>([]);
  const targetTheme = nextTheme(theme);
  const themeIcon = theme === "sky" ? "☾" : "☀";
  const themeLabel = targetTheme === "night" ? "切换到夜航" : "切换到晴空";

  useEffect(() => {
    return () => {
      timerRefs.current.forEach((timer) => window.clearTimeout(timer));
      timerRefs.current = [];
    };
  }, []);

  function handleThemeToggle() {
    if (isAnimating) {
      return;
    }

    timerRefs.current.forEach((timer) => window.clearTimeout(timer));
    timerRefs.current = [];
    setOverlayTheme(targetTheme);
    setIsAnimating(true);
    setTransitionPhase("launch");

    timerRefs.current.push(window.setTimeout(() => {
      setTheme(targetTheme);
      setTransitionPhase("settle");
    }, Math.round(THEME_ANIMATION_MS * 0.52)));

    timerRefs.current.push(window.setTimeout(() => {
      setTransitionPhase("idle");
      setIsAnimating(false);
    }, THEME_ANIMATION_MS + 260));
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" />
            {settings.brand.name}
          </Link>
          <div className="topbar-actions">
            {showNav ? (
              <nav className="topnav" aria-label="页面导航">
                <Link to="/" className="icon-button topnav-home" title="返回首页" aria-label="返回首页">
                  <span aria-hidden="true">⌂</span>
                </Link>
              </nav>
            ) : null}
            <button
              type="button"
              title={themeLabel}
              aria-label={themeLabel}
              className={`icon-button theme-toggle ${isAnimating ? "is-animating" : ""}`}
              onClick={handleThemeToggle}
            >
              <span className="theme-toggle-core" aria-hidden="true">{themeIcon}</span>
              <span className="theme-toggle-wave" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      <div
        aria-hidden="true"
        className={`theme-transition-overlay ${transitionPhase !== "idle" ? "is-active" : ""} phase-${transitionPhase} to-${overlayTheme}`}
      >
        <div className="theme-transition-stage">
          <span className="theme-transition-sun" />
          <span className="theme-transition-moon" />
        </div>
      </div>
    </>
  );
}

export function Frame({
  eyebrow,
  title,
  subtitle,
  aside,
  copyExtra,
  heroClassName,
  children
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  aside?: ReactNode;
  copyExtra?: ReactNode;
  heroClassName?: string;
  children: ReactNode;
}) {
  const { settings } = useSiteSettings();

  return (
    <div className="page-shell">
      <div className="bg-text-layer" aria-hidden="true">{settings.brand.systemText}</div>
      <div className="background-grid" />
      <ShellHeader />

      <main className="page-content">
        <section className={`hero-panel ${heroClassName ?? ""}`.trim()}>
          <div className="hero-copy">
            <span className="eyebrow"><span aria-hidden="true" style={{color: 'var(--accent)'}}>{'//'} </span>{eyebrow}</span>
            <h1 data-text={title}>{title}</h1>
            <p>{subtitle}</p>
            {copyExtra ? <div className="hero-copy-extra">{copyExtra}</div> : null}
          </div>
          {aside ? <div className="hero-aside">{aside}</div> : null}
        </section>
        {children}
      </main>
    </div>
  );
}

export function StatusPill({ label }: { label: string }) {
  return <span className="status-pill"><span aria-hidden="true" style={{opacity: 0.5}}>{'['}</span>{label}<span aria-hidden="true" style={{opacity: 0.5}}>{']'}</span></span>;
}

export function LoadingStage({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="page-shell loading-shell">
      <div className="background-grid" />
      <section className="loading-overlay">
        <div className="loading-overlay-card">
          <div className="loading-spinner" aria-hidden="true">
            <span className="loading-spinner-ring" />
            <span className="loading-spinner-core" />
          </div>
          <span className="eyebrow">{label}</span>
          <h1>正在加载</h1>
          <p>{hint}</p>
        </div>
      </section>
    </div>
  );
}


