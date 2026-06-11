"use client";

import { useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { CompetitorListItem } from "@/lib/types";
import { api } from "@/lib/api";
import { clsx } from "clsx";

interface Props {
  initial: CompetitorListItem[];
}

function SeoScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-gray-400">–</span>;
  const color =
    score >= 70 ? "bg-green-100 text-green-700" :
    score >= 40 ? "bg-yellow-100 text-yellow-700" :
    "bg-red-100 text-red-600";
  return (
    <span className={clsx("text-xs font-semibold px-2 py-0.5 rounded-full", color)}>
      {score}
    </span>
  );
}

export function CompetitorList({ initial }: Props) {
  const [items, setItems] = useState<CompetitorListItem[]>(initial);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function handleReanalyze(url: string, id: string) {
    setLoadingId(id);
    try {
      await api.analyzeCompetitor(url, true);
      const updated = await api.listCompetitors();
      setItems(updated);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingId(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 text-sm">
        No competitors tracked yet. Use the form above to add one.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <th className="pb-3 pr-4">Competitor</th>
            <th className="pb-3 pr-4">SEO Score</th>
            <th className="pb-3 pr-4">Last Analyzed</th>
            <th className="pb-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {items.map((c) => (
            <tr key={c.id} className="hover:bg-gray-50 transition-colors">
              <td className="py-3 pr-4">
                <div className="flex items-center gap-2">
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-brand-600 hover:underline flex items-center gap-1"
                  >
                    {c.name ?? c.url}
                    <ExternalLink size={12} />
                  </a>
                </div>
                {c.name && (
                  <p className="text-xs text-gray-400 truncate max-w-xs">{c.url}</p>
                )}
              </td>
              <td className="py-3 pr-4">
                <SeoScoreBadge score={c.seo_score} />
              </td>
              <td className="py-3 pr-4 text-gray-500">
                {c.last_analyzed
                  ? new Date(c.last_analyzed).toLocaleDateString("en-GB", {
                      day: "2-digit", month: "short", year: "numeric",
                    })
                  : "Never"}
              </td>
              <td className="py-3 text-right">
                <button
                  onClick={() => handleReanalyze(c.url, c.id)}
                  disabled={loadingId === c.id}
                  className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-600 disabled:opacity-40 transition-colors"
                >
                  <RefreshCw size={13} className={loadingId === c.id ? "animate-spin" : ""} />
                  Re-analyze
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
