-- Competitor Analysis Platform - PostgreSQL Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─────────────────────────────────────────────
-- Competitors
-- ─────────────────────────────────────────────
CREATE TABLE competitors (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    url           TEXT NOT NULL UNIQUE,
    name          TEXT,
    added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_analyzed TIMESTAMPTZ,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

-- ─────────────────────────────────────────────
-- Analysis Runs
-- ─────────────────────────────────────────────
CREATE TABLE analysis_runs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    competitor_id   UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    error_message   TEXT,
    raw_scraped_text TEXT,
    tokens_used     INTEGER
);

-- ─────────────────────────────────────────────
-- Analysis Results (structured AI output)
-- ─────────────────────────────────────────────
CREATE TABLE analysis_results (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id          UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    competitor_id   UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Pricing & Packaging
    pricing_model   TEXT,                       -- 'freemium' | 'subscription' | 'usage-based' | etc.
    pricing_tiers   JSONB,                      -- [{name, price, features[]}]

    -- Core Features
    core_features   TEXT[] NOT NULL DEFAULT '{}',

    -- Competitive weaknesses
    weaknesses      TEXT[] NOT NULL DEFAULT '{}',

    -- SEO
    seo_score       SMALLINT CHECK (seo_score BETWEEN 0 AND 100),
    keyword_opportunities JSONB,                -- [{keyword, difficulty, volume, intent}]

    -- Raw AI JSON response (for audit / reprocessing)
    raw_ai_response JSONB
);

-- ─────────────────────────────────────────────
-- Keywords
-- ─────────────────────────────────────────────
CREATE TABLE keywords (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    keyword         TEXT NOT NULL UNIQUE,
    difficulty      SMALLINT CHECK (difficulty BETWEEN 0 AND 100),
    volume          INTEGER,
    intent          TEXT CHECK (intent IN ('informational', 'navigational', 'commercial', 'transactional')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE competitor_keywords (
    competitor_id   UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
    keyword_id      UUID NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
    first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (competitor_id, keyword_id)
);

-- ─────────────────────────────────────────────
-- Content Drafts
-- ─────────────────────────────────────────────
CREATE TABLE content_drafts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    keyword_id      UUID REFERENCES keywords(id) ON DELETE SET NULL,
    target_keyword  TEXT NOT NULL,
    title           TEXT NOT NULL,
    outline         JSONB NOT NULL,             -- [{heading, sub_headings[]}]
    intro_paragraph TEXT NOT NULL,
    word_count_est  INTEGER,
    status          TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'published', 'archived')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_content_drafts_updated_at
    BEFORE UPDATE ON content_drafts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- Helper: updated_at trigger function
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────
CREATE INDEX idx_analysis_runs_competitor  ON analysis_runs(competitor_id);
CREATE INDEX idx_analysis_runs_status      ON analysis_runs(status);
CREATE INDEX idx_analysis_results_run      ON analysis_results(run_id);
CREATE INDEX idx_analysis_results_comp     ON analysis_results(competitor_id);
CREATE INDEX idx_content_drafts_keyword    ON content_drafts(target_keyword);
CREATE INDEX idx_keywords_keyword_trgm     ON keywords USING gin(keyword gin_trgm_ops);
