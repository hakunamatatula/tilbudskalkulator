"""
Web scraper — extracts main text content, meta tags, and pricing signals.

Swap the httpx + BeautifulSoup implementation for Firecrawl or Playwright
by replacing _fetch_with_httpx() with the provider's SDK call.
"""

import re

import httpx
from bs4 import BeautifulSoup

from app.core.config import settings


_PRICING_KEYWORDS = re.compile(
    r"\b(price|pricing|plan|plans|tier|tiers|subscription|per month|/mo|per year|/yr|free|freemium|enterprise|starter|pro|business)\b",
    re.IGNORECASE,
)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; CompetitorAnalysisBot/1.0; +https://example.com/bot)"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


class ScraperResult:
    __slots__ = ("url", "title", "meta_description", "main_text", "pricing_snippets", "h_tags")

    def __init__(
        self,
        url: str,
        title: str,
        meta_description: str,
        main_text: str,
        pricing_snippets: list[str],
        h_tags: list[str],
    ) -> None:
        self.url = url
        self.title = title
        self.meta_description = meta_description
        self.main_text = main_text
        self.pricing_snippets = pricing_snippets
        self.h_tags = h_tags

    def as_prompt_text(self, max_chars: int = 12_000) -> str:
        sections = [
            f"URL: {self.url}",
            f"Page Title: {self.title}",
            f"Meta Description: {self.meta_description}",
            f"Headings: {' | '.join(self.h_tags[:20])}",
            f"Pricing Snippets:\n" + "\n".join(f"- {s}" for s in self.pricing_snippets[:15]),
            f"Main Content:\n{self.main_text[:max_chars]}",
        ]
        return "\n\n".join(sections)


async def scrape(url: str) -> ScraperResult:
    html = await _fetch_with_httpx(url)
    return _parse(url, html)


async def _fetch_with_httpx(url: str) -> str:
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=settings.scrape_timeout_seconds,
        headers=_HEADERS,
    ) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.text


def _parse(url: str, html: str) -> ScraperResult:
    soup = BeautifulSoup(html, "lxml")

    # Remove noise
    for tag in soup(["script", "style", "nav", "footer", "aside", "noscript"]):
        tag.decompose()

    title = (soup.find("title") or soup.new_tag("t")).get_text(strip=True)
    meta_desc_tag = soup.find("meta", attrs={"name": re.compile("description", re.I)})
    meta_description = meta_desc_tag.get("content", "") if meta_desc_tag else ""

    h_tags = [t.get_text(strip=True) for t in soup.find_all(["h1", "h2", "h3"]) if t.get_text(strip=True)]

    main_text = " ".join(soup.get_text(separator=" ").split())

    # Pull sentences/lines that contain pricing keywords
    lines = [ln.strip() for ln in soup.get_text(separator="\n").splitlines()]
    pricing_snippets = [ln for ln in lines if ln and _PRICING_KEYWORDS.search(ln)]

    return ScraperResult(
        url=url,
        title=title,
        meta_description=meta_description,
        main_text=main_text,
        pricing_snippets=pricing_snippets,
        h_tags=h_tags,
    )
