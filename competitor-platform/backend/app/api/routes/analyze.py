import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.competitor import AnalysisResult, AnalysisRun, Competitor
from app.schemas.analysis import (
    AnalyzeCompetitorRequest,
    CompetitorAnalysisResult,
    CompetitorListItem,
    KeywordOpportunity,
    PricingTier,
)
from app.services import ai_agent, scraper

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analyze", tags=["analyze"])


@router.post("/competitor", response_model=CompetitorAnalysisResult, status_code=status.HTTP_200_OK)
async def analyze_competitor(
    body: AnalyzeCompetitorRequest,
    db: AsyncSession = Depends(get_db),
) -> CompetitorAnalysisResult:
    url_str = str(body.url)

    # Upsert competitor row
    result = await db.execute(select(Competitor).where(Competitor.url == url_str))
    competitor = result.scalar_one_or_none()
    if competitor is None:
        competitor = Competitor(url=url_str)
        db.add(competitor)
        await db.flush()

    # Skip re-analysis if fresh result exists and force_refresh is False
    if not body.force_refresh and competitor.last_analyzed:
        latest_run_result = await db.execute(
            select(AnalysisResult)
            .join(AnalysisRun)
            .where(AnalysisRun.competitor_id == competitor.id, AnalysisRun.status == "completed")
            .order_by(AnalysisResult.created_at.desc())
            .limit(1)
        )
        cached = latest_run_result.scalar_one_or_none()
        if cached:
            return _build_response(url_str, competitor, cached, cached.run)

    # Create a new run
    run = AnalysisRun(competitor_id=competitor.id, status="running")
    db.add(run)
    await db.flush()

    try:
        scraped = await scraper.scrape(url_str)
        run.raw_scraped_text = scraped.main_text

        ai_result = await ai_agent.analyze_competitor(
            scraped.as_prompt_text(max_chars=12_000)
        )

        analysis = AnalysisResult(
            run_id=run.id,
            competitor_id=competitor.id,
            pricing_model=ai_result.data["pricing_model"],
            pricing_tiers=ai_result.data["pricing_tiers"],
            core_features=ai_result.data["core_features"],
            weaknesses=ai_result.data["weaknesses"],
            seo_score=ai_result.data["seo_score"],
            keyword_opportunities=ai_result.data["keyword_opportunities"],
            raw_ai_response=ai_result.data,
        )
        db.add(analysis)

        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)
        run.tokens_used = ai_result.tokens_used
        competitor.last_analyzed = datetime.now(timezone.utc)
        competitor.name = competitor.name or _derive_name(url_str)

        await db.commit()
        await db.refresh(analysis)
        await db.refresh(run)

        return _build_response(url_str, competitor, analysis, run)

    except Exception as exc:
        logger.exception("Analysis failed for %s", url_str)
        run.status = "failed"
        run.error_message = str(exc)
        await db.commit()
        raise HTTPException(status_code=502, detail=f"Analysis failed: {exc}") from exc


@router.get("/competitors", response_model=list[CompetitorListItem])
async def list_competitors(db: AsyncSession = Depends(get_db)) -> list[CompetitorListItem]:
    rows = await db.execute(select(Competitor).where(Competitor.is_active.is_(True)))
    competitors = rows.scalars().all()

    items = []
    for c in competitors:
        latest = await db.execute(
            select(AnalysisResult.seo_score)
            .join(AnalysisRun)
            .where(AnalysisRun.competitor_id == c.id, AnalysisRun.status == "completed")
            .order_by(AnalysisResult.created_at.desc())
            .limit(1)
        )
        seo = latest.scalar_one_or_none()
        items.append(
            CompetitorListItem(
                id=c.id,
                url=c.url,
                name=c.name,
                added_at=c.added_at,
                last_analyzed=c.last_analyzed,
                seo_score=seo,
            )
        )
    return items


# ── Helpers ──────────────────────────────────────────────────────────────────

def _build_response(
    url: str, competitor: Competitor, analysis: AnalysisResult, run: AnalysisRun
) -> CompetitorAnalysisResult:
    return CompetitorAnalysisResult(
        run_id=run.id,
        competitor_id=competitor.id,
        url=url,
        pricing_model=analysis.pricing_model or "unknown",
        pricing_tiers=[PricingTier(**t) for t in (analysis.pricing_tiers or [])],
        core_features=analysis.core_features or [],
        weaknesses=analysis.weaknesses or [],
        seo_score=analysis.seo_score or 0,
        keyword_opportunities=[KeywordOpportunity(**k) for k in (analysis.keyword_opportunities or [])],
        tokens_used=run.tokens_used or 0,
        analyzed_at=analysis.created_at,
    )


def _derive_name(url: str) -> str:
    from urllib.parse import urlparse
    host = urlparse(url).netloc
    return host.removeprefix("www.")
