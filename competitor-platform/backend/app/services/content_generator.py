"""
Content Draft Generator — uses Claude to produce an SEO-optimised blog post
outline + intro paragraph for a given keyword.
Streams the response to avoid timeout on large outputs.
"""

import json
import logging
import uuid

import anthropic

from app.core.config import settings
from app.schemas.analysis import CONTENT_DRAFT_JSON_SCHEMA

logger = logging.getLogger(__name__)

_client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

_SYSTEM_PROMPT = """\
You are a senior SEO content strategist with deep expertise in organic search and long-form content.
You write clear, authoritative outlines optimised for search intent and reader engagement.\
"""

_USER_PROMPT_TEMPLATE = """\
Create an SEO-optimised blog post outline and intro paragraph for the following target keyword:

Keyword: "{keyword}"
{context_block}

Requirements:
- Title: compelling, includes the exact keyword, under 65 characters.
- Outline: 5–7 H2 sections, each with 2–4 H3 sub-headings.
- Intro paragraph: 80–120 words, hooks the reader, includes the keyword naturally.
- word_count_est: realistic estimated word count for the full article.

Return JSON matching the provided schema exactly.\
"""


class ContentDraftData:
    __slots__ = ("draft_id", "title", "outline", "intro_paragraph", "word_count_est")

    def __init__(
        self,
        draft_id: uuid.UUID,
        title: str,
        outline: list[dict],
        intro_paragraph: str,
        word_count_est: int,
    ) -> None:
        self.draft_id = draft_id
        self.title = title
        self.outline = outline
        self.intro_paragraph = intro_paragraph
        self.word_count_est = word_count_est


async def generate_content_draft(keyword: str, competitor_context: str | None = None) -> ContentDraftData:
    context_block = (
        f"Competitor context (use to identify content gaps): {competitor_context}"
        if competitor_context
        else ""
    )
    prompt = _USER_PROMPT_TEMPLATE.format(keyword=keyword, context_block=context_block)

    with _client.messages.stream(
        model="claude-opus-4-8",
        max_tokens=8192,
        thinking={"type": "adaptive"},
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
        output_config={
            "format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "content_draft",
                    "schema": CONTENT_DRAFT_JSON_SCHEMA,
                    "strict": True,
                },
            }
        },
    ) as stream:
        message = stream.get_final_message()

    text_content = next(b for b in message.content if b.type == "text")
    data = json.loads(text_content.text)

    logger.info("Content draft generated for keyword '%s'.", keyword)

    return ContentDraftData(
        draft_id=uuid.uuid4(),
        title=data["title"],
        outline=data["outline"],
        intro_paragraph=data["intro_paragraph"],
        word_count_est=data["word_count_est"],
    )
