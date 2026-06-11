from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, HttpUrl


# ── Request schemas ───────────────────────────────────────────────────────────

class AnalyzeCompetitorRequest(BaseModel):
    url: HttpUrl
    force_refresh: bool = False


class GenerateContentRequest(BaseModel):
    keyword: str
    competitor_context: str | None = None


# ── Nested payloads ───────────────────────────────────────────────────────────

class PricingTier(BaseModel):
    name: str
    price: str
    features: list[str]


class KeywordOpportunity(BaseModel):
    keyword: str
    difficulty: int          # 0-100
    estimated_volume: int
    intent: str              # informational | navigational | commercial | transactional


class OutlineSection(BaseModel):
    heading: str
    sub_headings: list[str]


# ── AI structured output schemas (sent to Claude as JSON Schema) ──────────────

COMPETITOR_ANALYSIS_JSON_SCHEMA: dict = {
    "type": "object",
    "required": ["pricing_model", "pricing_tiers", "core_features", "weaknesses", "seo_score", "keyword_opportunities"],
    "properties": {
        "pricing_model": {
            "type": "string",
            "enum": ["freemium", "subscription", "usage-based", "one-time", "enterprise", "unknown"]
        },
        "pricing_tiers": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["name", "price", "features"],
                "properties": {
                    "name": {"type": "string"},
                    "price": {"type": "string"},
                    "features": {"type": "array", "items": {"type": "string"}}
                }
            }
        },
        "core_features": {"type": "array", "items": {"type": "string"}, "maxItems": 10},
        "weaknesses": {"type": "array", "items": {"type": "string"}, "maxItems": 5},
        "seo_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "keyword_opportunities": {
            "type": "array",
            "maxItems": 3,
            "items": {
                "type": "object",
                "required": ["keyword", "difficulty", "estimated_volume", "intent"],
                "properties": {
                    "keyword": {"type": "string"},
                    "difficulty": {"type": "integer", "minimum": 0, "maximum": 100},
                    "estimated_volume": {"type": "integer"},
                    "intent": {"type": "string", "enum": ["informational", "navigational", "commercial", "transactional"]}
                }
            }
        }
    }
}

CONTENT_DRAFT_JSON_SCHEMA: dict = {
    "type": "object",
    "required": ["title", "outline", "intro_paragraph", "word_count_est"],
    "properties": {
        "title": {"type": "string"},
        "outline": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["heading", "sub_headings"],
                "properties": {
                    "heading": {"type": "string"},
                    "sub_headings": {"type": "array", "items": {"type": "string"}}
                }
            }
        },
        "intro_paragraph": {"type": "string"},
        "word_count_est": {"type": "integer"}
    }
}


# ── Response schemas ──────────────────────────────────────────────────────────

class CompetitorAnalysisResult(BaseModel):
    run_id: uuid.UUID
    competitor_id: uuid.UUID
    url: str
    pricing_model: str
    pricing_tiers: list[PricingTier]
    core_features: list[str]
    weaknesses: list[str]
    seo_score: int
    keyword_opportunities: list[KeywordOpportunity]
    tokens_used: int
    analyzed_at: datetime


class ContentDraftResult(BaseModel):
    draft_id: uuid.UUID
    target_keyword: str
    title: str
    outline: list[OutlineSection]
    intro_paragraph: str
    word_count_est: int


class CompetitorListItem(BaseModel):
    id: uuid.UUID
    url: str
    name: str | None
    added_at: datetime
    last_analyzed: datetime | None
    seo_score: int | None

    model_config = {"from_attributes": True}
