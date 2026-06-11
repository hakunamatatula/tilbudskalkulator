import { BarChart3, Globe, Layers, TrendingUp } from "lucide-react";
import { MetricsCard } from "@/components/dashboard/MetricsCard";
import { CompetitorList } from "@/components/dashboard/CompetitorList";
import { AnalyzeForm } from "@/components/dashboard/AnalyzeForm";
import { api } from "@/lib/api";
import type { CompetitorListItem } from "@/lib/types";

async function getCompetitors(): Promise<CompetitorListItem[]> {
  try {
    return await api.listCompetitors();
  } catch {
    return [];
  }
}

export default async function DashboardPage() {
  const competitors = await getCompetitors();

  const avgSeoScore =
    competitors.length > 0
      ? Math.round(
          competitors.reduce((sum, c) => sum + (c.seo_score ?? 0), 0) / competitors.length
        )
      : null;

  const analyzed = competitors.filter((c) => c.last_analyzed !== null).length;

  return (
    <div className="px-8 py-8 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Competitor Intelligence</h1>
        <p className="text-sm text-gray-500 mt-1">
          AI-powered analysis of your competitive landscape
        </p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricsCard
          title="Competitors Tracked"
          value={competitors.length}
          icon={Globe}
          subtitle="active monitors"
        />
        <MetricsCard
          title="Avg. Competitor SEO Score"
          value={avgSeoScore !== null ? `${avgSeoScore}/100` : "–"}
          icon={BarChart3}
          trend={avgSeoScore !== null && avgSeoScore < 60 ? "up" : "neutral"}
          trendLabel={avgSeoScore !== null && avgSeoScore < 60 ? "Opportunity gap identified" : undefined}
        />
        <MetricsCard
          title="Keyword Opportunities"
          value={competitors.length * 3}
          icon={TrendingUp}
          subtitle="across all competitors"
        />
        <MetricsCard
          title="Analyses Run"
          value={analyzed}
          icon={Layers}
          subtitle="of tracked competitors"
        />
      </div>

      {/* On-demand analysis form */}
      <section>
        <h2 className="text-base font-semibold text-gray-800 mb-3">
          On-Demand Analysis
        </h2>
        <AnalyzeForm />
      </section>

      {/* Competitor list */}
      <section>
        <h2 className="text-base font-semibold text-gray-800 mb-3">
          Competitor Monitoring List
        </h2>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <CompetitorList initial={competitors} />
        </div>
      </section>
    </div>
  );
}
