import type { CompetitorAnalysisResult, CompetitorListItem, ContentDraftResult } from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  analyzeCompetitor: (url: string, forceRefresh = false) =>
    post<CompetitorAnalysisResult>("/api/analyze/competitor", { url, force_refresh: forceRefresh }),

  listCompetitors: () => get<CompetitorListItem[]>("/api/analyze/competitors"),

  generateContent: (keyword: string, competitorContext?: string) =>
    post<ContentDraftResult>("/api/content/generate", {
      keyword,
      competitor_context: competitorContext ?? null,
    }),
};
