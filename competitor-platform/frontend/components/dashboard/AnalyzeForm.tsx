"use client";

import { useState } from "react";
import { Loader2, Search, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import type { CompetitorAnalysisResult, ContentDraftResult } from "@/lib/types";

type Mode = "competitor" | "content";

interface Props {
  onAnalysisDone?: (result: CompetitorAnalysisResult) => void;
  onContentDone?: (result: ContentDraftResult) => void;
}

export function AnalyzeForm({ onAnalysisDone, onContentDone }: Props) {
  const [mode, setMode] = useState<Mode>("competitor");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompetitorAnalysisResult | ContentDraftResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      if (mode === "competitor") {
        const data = await api.analyzeCompetitor(input.trim());
        setResult(data);
        onAnalysisDone?.(data);
      } else {
        const data = await api.generateContent(input.trim());
        setResult(data);
        onContentDone?.(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const isAnalysis = (r: typeof result): r is CompetitorAnalysisResult =>
    !!r && "seo_score" in r;

  const isContent = (r: typeof result): r is ContentDraftResult =>
    !!r && "intro_paragraph" in r;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex gap-2 mb-5">
        {(["competitor", "content"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setResult(null); setError(null); }}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              mode === m
                ? "bg-brand-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {m === "competitor" ? "Analyze Competitor URL" : "Generate Content Draft"}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-3">
        <div className="flex-1 relative">
          {mode === "competitor" ? (
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          ) : (
            <Sparkles size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          )}
          <input
            type={mode === "competitor" ? "url" : "text"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              mode === "competitor"
                ? "https://competitor.com"
                : "Enter target keyword (e.g. \"best SEO tools 2025\")"
            }
            required
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 flex items-center gap-2"
        >
          {loading && <Loader2 size={14} className="animate-spin" />}
          {loading ? "Analyzing…" : mode === "competitor" ? "Analyze" : "Generate"}
        </button>
      </form>

      {error && (
        <p className="mt-3 text-sm text-red-500 bg-red-50 rounded-lg px-4 py-2">{error}</p>
      )}

      {result && isAnalysis(result) && (
        <AnalysisResultPanel result={result} />
      )}

      {result && isContent(result) && (
        <ContentResultPanel result={result} />
      )}
    </div>
  );
}


function AnalysisResultPanel({ result }: { result: CompetitorAnalysisResult }) {
  return (
    <div className="mt-5 border-t border-gray-100 pt-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">Analysis Complete</h3>
        <span className="text-xs text-gray-400">
          {result.tokens_used.toLocaleString()} tokens used
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="SEO Score" value={`${result.seo_score}/100`} />
        <Stat label="Pricing Model" value={result.pricing_model} />
        <Stat label="Core Features" value={result.core_features.length} />
        <Stat label="Weaknesses" value={result.weaknesses.length} />
      </div>

      {result.keyword_opportunities.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Keyword Opportunities
          </p>
          <div className="space-y-1.5">
            {result.keyword_opportunities.map((kw) => (
              <div key={kw.keyword} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                <span className="font-medium text-gray-800">{kw.keyword}</span>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span>Vol: ~{kw.estimated_volume.toLocaleString()}</span>
                  <span>KD: {kw.difficulty}</span>
                  <span className="capitalize">{kw.intent}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.weaknesses.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Weaknesses Identified
          </p>
          <ul className="space-y-1 text-sm text-gray-700">
            {result.weaknesses.map((w, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ContentResultPanel({ result }: { result: ContentDraftResult }) {
  return (
    <div className="mt-5 border-t border-gray-100 pt-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">{result.title}</h3>
        <span className="text-xs text-gray-400">~{result.word_count_est.toLocaleString()} words</span>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-gray-700 italic leading-relaxed">
        {result.intro_paragraph}
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Article Outline</p>
        <ol className="space-y-2">
          {result.outline.map((section, i) => (
            <li key={i}>
              <p className="text-sm font-medium text-gray-800">{i + 1}. {section.heading}</p>
              <ul className="ml-4 mt-1 space-y-0.5">
                {section.sub_headings.map((sh, j) => (
                  <li key={j} className="text-xs text-gray-500 before:content-['–'] before:mr-2">{sh}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2.5">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-gray-800 capitalize">{value}</p>
    </div>
  );
}
