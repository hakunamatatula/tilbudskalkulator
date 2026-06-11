"""
AI Agent — calls Claude to produce a structured competitor analysis JSON.
Uses output_config with json_schema to guarantee a parseable response.
"""

import json
import logging

import anthropic

from app.core.config import settings
from app.schemas.analysis import COMPETITOR_ANALYSIS_JSON_SCHEMA

logger = logging.getLogger(__name__)

_client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

_SYSTEM_PROMPT = """\
You are an expert competitive intelligence analyst and SEO strategist.
Given scraped content from a competitor's website, you will produce a structured analysis.
Be precise and evidence-based — only report what the scraped content supports.
For any field with insufficient evidence, use sensible defaults or "unknown".\
"""

_USER_PROMPT_TEMPLATE = """\
Analyze the following competitor website content and extract the requested information.

{scraped_content}

Produce a JSON analysis following the provided schema exactly.
Focus on:
1. Identifying the pricing model and any explicit pricing tiers.
2. Listing the top 10 core product features.
3. Identifying up to 5 observable weaknesses (missing features, poor UX signals, limited content depth).
4. Estimating an SEO score (0–100) based on: meta tags, heading structure, content depth, and keyword density.
5. Recommending 3 high-value SEO keyword opportunities this competitor is NOT well-optimised for.\
"""


class AIAnalysisResult:
    __slots__ = ("data", "tokens_used")

    def __init__(self, data: dict, tokens_used: int) -> None:
        self.data = data
        self.tokens_used = tokens_used


async def analyze_competitor(scraped_content: str) -> AIAnalysisResult:
    prompt = _USER_PROMPT_TEMPLATE.format(scraped_content=scraped_content)

    response = _client.messages.create(
        model="claude-opus-4-8",
        max_tokens=4096,
        thinking={"type": "adaptive"},
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
        output_config={
            "format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "competitor_analysis",
                    "schema": COMPETITOR_ANALYSIS_JSON_SCHEMA,
                    "strict": True,
                },
            }
        },
    )

    tokens_used = response.usage.input_tokens + response.usage.output_tokens

    # Extract the text block (json_schema mode always returns a single text block)
    text_content = next(b for b in response.content if b.type == "text")
    data = json.loads(text_content.text)

    logger.info("Competitor analysis complete. Tokens used: %d", tokens_used)
    return AIAnalysisResult(data=data, tokens_used=tokens_used)
