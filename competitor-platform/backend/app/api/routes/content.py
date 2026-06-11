import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.competitor import ContentDraft
from app.schemas.analysis import ContentDraftResult, GenerateContentRequest, OutlineSection
from app.services.content_generator import generate_content_draft

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/content", tags=["content"])


@router.post("/generate", response_model=ContentDraftResult, status_code=status.HTTP_201_CREATED)
async def generate_content(
    body: GenerateContentRequest,
    db: AsyncSession = Depends(get_db),
) -> ContentDraftResult:
    try:
        draft_data = await generate_content_draft(
            keyword=body.keyword,
            competitor_context=body.competitor_context,
        )
    except Exception as exc:
        logger.exception("Content generation failed for keyword '%s'", body.keyword)
        raise HTTPException(status_code=502, detail=f"Content generation failed: {exc}") from exc

    draft = ContentDraft(
        target_keyword=body.keyword,
        title=draft_data.title,
        outline=draft_data.outline,
        intro_paragraph=draft_data.intro_paragraph,
        word_count_est=draft_data.word_count_est,
    )
    draft.id = draft_data.draft_id
    db.add(draft)
    await db.commit()

    return ContentDraftResult(
        draft_id=draft_data.draft_id,
        target_keyword=body.keyword,
        title=draft_data.title,
        outline=[OutlineSection(**s) for s in draft_data.outline],
        intro_paragraph=draft_data.intro_paragraph,
        word_count_est=draft_data.word_count_est,
    )
