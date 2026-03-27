import type { QuizListItem, SiteSettings, StartAttemptResponse, SubmitResponse } from "./types";

function resolveApiBase() {
  const configured = import.meta.env.VITE_API_BASE as string | undefined;

  if (typeof window === "undefined") {
    return configured?.trim() || "http://localhost:4100/api";
  }

  const fallback = `${window.location.protocol}//${window.location.hostname}:4100/api`;
  const raw = configured?.trim() || fallback;

  try {
    const url = new URL(raw);
    const currentHost = window.location.hostname;
    const currentProtocol = window.location.protocol;
    const isLocalTarget = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);

    if (isLocalTarget) {
      url.hostname = currentHost;
      url.protocol = currentProtocol;
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}

const API_BASE = resolveApiBase();

async function request<T>(path: string, init?: RequestInit) {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {})
      }
    });
  } catch {
    throw new Error(`无法连接到 Q-gate API：${API_BASE}`);
  }

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.detail ?? payload?.message ?? "request_failed");
  }

  return payload as T;
}

export const api = {
  getSiteSettings() {
    return request<SiteSettings>("/public/site-settings");
  },
  listQuizzes() {
    return request<{ items: QuizListItem[] }>("/public/quizzes");
  },
  getQuiz(slug: string) {
    return request<StartAttemptResponse["quiz"]>(`/public/quizzes/${slug}`);
  },
  startAttempt(input: { quizSlug: string; qq: string; playerName: string }) {
    return request<StartAttemptResponse>("/public/start", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  submitAttempt(attemptId: string, answers: Record<string, string | string[]>) {
    return request<SubmitResponse>(`/public/attempts/${attemptId}/submit`, {
      method: "POST",
      body: JSON.stringify({ answers })
    });
  },
  adminLogin(password: string) {
    return request<{ ok: true; expiresAt: number }>("/admin/session", {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ password })
    });
  },
  adminLogout() {
    return request<{ ok: true }>("/admin/session", {
      method: "DELETE",
      credentials: "include"
    });
  },
  importQuiz(yaml: string) {
    return request<{ ok: true }>("/admin/quizzes/import", {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ yaml })
    });
  },
  listAdminQuizzes() {
    return request<{ items: QuizListItem[] }>("/admin/quizzes", {
      credentials: "include"
    });
  },
  getAdminSeedYaml() {
    return request<{ yaml: string }>("/admin/seed", {
      credentials: "include"
    });
  },
  getAdminSiteSettingsYaml() {
    return request<{ yaml: string }>("/admin/site-settings", {
      credentials: "include"
    });
  },
  importSiteSettings(yaml: string) {
    return request<{ ok: true }>("/admin/site-settings/import", {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ yaml })
    });
  }
};

export function sessionKey(attemptId: string) {
  return `mqg_attempt_${attemptId}`;
}

export function resultKey(attemptId: string) {
  return `mqg_result_${attemptId}`;
}
