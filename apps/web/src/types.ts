export type QuizMedia = {
  type: "image" | "audio" | "video";
  url: string;
  caption?: string;
};

export type QuizListItem = {
  slug: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  passScore: number;
  durationSec: number;
  shuffleQuestions: number | boolean;
  updatedAt?: string;
};

export type PublicQuestion = {
  id: string;
  type: "single" | "multiple" | "text";
  group: "objective" | "subjective";
  prompt: string;
  description?: string;
  placeholder?: string;
  inputStyle?: "short" | "essay";
  points: number;
  index: number;
  media?: QuizMedia;
  options?: Array<{ key: string; text: string }>;
};

export type PublicQuiz = {
  slug: string;
  title: string;
  subtitle?: string;
  description?: string;
  passScore: number;
  durationSec: number;
  shuffleQuestions?: boolean;
  examMode: "open_book" | "closed_book";
  requireFullscreen: boolean;
  selectionMode: "fixed" | "random";
  drawCount?: number;
  drawSingleCount?: number;
  drawMultipleCount?: number;
  drawTextCount?: number;
  questionBankSize?: number;
  displayQuestionCount?: number;
  questions: PublicQuestion[];
};

export type StartAttemptResponse = {
  attemptId: string;
  quiz: PublicQuiz;
};

export type SubmitResponse = {
  passed: boolean;
  score: number;
  maxScore: number;
  passScore: number;
  earnedPointsTotal: number;
  totalPoints: number;
  verificationCode?: string;
  expiresAt?: number;
  graded: Array<{
    id: string;
    prompt: string;
    correct: boolean;
    earnedPoints: number;
    points: number;
    submittedAnswer: string;
    correctAnswer: string;
  }>;
};

export type SessionRecord = {
  attemptId: string;
  quiz: PublicQuiz;
  playerName: string;
  qq: string;
  startedAt: number;
};

export type SiteSettings = {
  brand: {
    name: string;
    systemText: string;
    adminName: string;
  };
  media: {
    homeHeroImage: string;
    homeInsetImage: string;
    entryHeroImage: string;
  };
  home: {
    eyebrow: string;
    title: string;
    subtitle: string;
    loadingHint: string;
    entryListTitle: string;
    entryCardHint: string;
    flowSteps: [string, string, string];
    highlights: Array<{ title: string; body: string }>;
    metrics: [string, string, string];
  };
  entry: {
    eyebrow: string;
    fallbackTitle: string;
    fallbackSubtitle: string;
    loadingHint: string;
    bindingTitle: string;
    bindingExplain: string;
    startButton: string;
    flowSteps: [string, string, string];
    warning: { title: string; body: string };
    bindingNote: { title: string; body: string };
    confirmAvatar: string;
    confirmPrivacy: string;
  };
  session: {
    eyebrow: string;
    subtitle: string;
    loadingHint: string;
    lostTitle: string;
    lostSubtitle: string;
    lostBackLabel: string;
    navTitle: string;
    submitHint: string;
    submitButton: string;
    fullscreenTitle: string;
    fullscreenBody: string;
    fullscreenButton: string;
    resumeButton: string;
  };
  result: {
    eyebrow: string;
    passTitle: string;
    failTitle: string;
    passSubtitle: string;
    failSubtitle: string;
    copyButton: string;
    copiedButton: string;
    homeButton: string;
    retryButton: string;
    reviewTitle: string;
    noWrongTitle: string;
    noWrongBody: string;
  };
  admin: {
    eyebrow: string;
    title: string;
    subtitle: string;
    loginTitle: string;
    loginSubtitle: string;
    loginButton: string;
    logoutButton: string;
    siteSettingsTitle: string;
    siteSettingsNote: string;
  };
};
