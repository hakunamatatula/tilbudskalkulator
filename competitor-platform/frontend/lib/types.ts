export interface PricingTier {
  name: string;
  price: string;
  features: string[];
}

export interface KeywordOpportunity {
  keyword: string;
  difficulty: number;
  estimated_volume: number;
  intent: "informational" | "navigational" | "commercial" | "transactional";
}

export interface CompetitorAnalysisResult {
  run_id: string;
  competitor_id: string;
  url: string;
  pricing_model: string;
  pricing_tiers: PricingTier[];
  core_features: string[];
  weaknesses: string[];
  seo_score: number;
  keyword_opportunities: KeywordOpportunity[];
  tokens_used: number;
  analyzed_at: string;
}

export interface CompetitorListItem {
  id: string;
  url: string;
  name: string | null;
  added_at: string;
  last_analyzed: string | null;
  seo_score: number | null;
}

export interface OutlineSection {
  heading: string;
  sub_headings: string[];
}

export interface ContentDraftResult {
  draft_id: string;
  target_keyword: string;
  title: string;
  outline: OutlineSection[];
  intro_paragraph: string;
  word_count_est: number;
}
