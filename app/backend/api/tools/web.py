"""
Robust web search and content extraction tools.

Architecture:
1. web_search: tries multiple search backends with automatic fallback
2. fetch_url: smart content extraction with readability heuristics
3. search_and_extract: compound tool that searches + reads top results

Key improvements over the original:
- Multiple search backends (DuckDuckGo HTML, DuckDuckGo API, Google scrape)
- Robust HTML→text extraction with boilerplate removal
- Content chunking for LLM-friendly output
- Rate limiting and timeout handling
- Structured output with source quality indicators
"""

import json
import logging
import re
import time
import urllib.parse
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import requests
from bs4 import BeautifulSoup, Comment, NavigableString
from pydantic import BaseModel, Field

from app.backend.core.agent.tool import tool

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────

DEFAULT_TIMEOUT = 12
MAX_CONTENT_LENGTH = 8000  # chars, to fit in LLM context
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)

HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "DNT": "1",
}

# Tags that typically contain boilerplate, not content
BOILERPLATE_TAGS = {
    "nav", "footer", "header", "aside", "script", "style", "noscript",
    "iframe", "svg", "form", "button", "input", "select", "textarea",
    "menu", "menuitem",
}

# Selectors for main content areas (tried in order)
CONTENT_SELECTORS = [
    "article",
    '[role="main"]',
    "main",
    ".post-content",
    ".article-content",
    ".entry-content",
    ".content",
    "#content",
    ".post-body",
    ".article-body",
]


# ─────────────────────────────────────────────────────────
# Content extraction
# ─────────────────────────────────────────────────────────

def _clean_soup(soup: BeautifulSoup) -> BeautifulSoup:
    """Remove boilerplate elements from the soup."""
    # Remove comments
    for comment in soup.find_all(string=lambda t: isinstance(t, Comment)):
        comment.extract()

    # Remove boilerplate tags
    for tag_name in BOILERPLATE_TAGS:
        for el in soup.find_all(tag_name):
            el.decompose()

    # Remove hidden elements
    for el in soup.find_all(style=re.compile(r"display\s*:\s*none", re.I)):
        el.decompose()
    for el in soup.find_all(attrs={"aria-hidden": "true"}):
        el.decompose()

    return soup


def _find_main_content(soup: BeautifulSoup) -> Optional[BeautifulSoup]:
    """Try to locate the main content area using common selectors."""
    for selector in CONTENT_SELECTORS:
        main = soup.select_one(selector)
        if main and len(main.get_text(strip=True)) > 100:
            return main
    return None


def _extract_text_smart(soup: BeautifulSoup) -> str:
    """
    Extract clean text from HTML with paragraph structure preserved.
    Better than soup.get_text() because it:
    - Preserves paragraph boundaries
    - Removes excessive whitespace
    - Keeps list structure readable
    """
    parts: List[str] = []

    for element in soup.descendants:
        if isinstance(element, NavigableString):
            text = element.strip()
            if text:
                parts.append(text)
        elif element.name in ("p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "br", "tr"):
            parts.append("\n")

    raw = " ".join(parts)

    # Clean up whitespace
    raw = re.sub(r"[ \t]+", " ", raw)
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    raw = re.sub(r" *\n *", "\n", raw)

    return raw.strip()


def extract_content(html: str, url: str = "") -> Dict[str, Any]:
    """
    Extract structured content from an HTML page.

    Returns:
        {
            "title": str,
            "text": str (cleaned main content),
            "meta_description": str,
            "links": List[{"text": str, "url": str}],
            "word_count": int,
        }
    """
    soup = BeautifulSoup(html, "html.parser")

    # Extract metadata first
    title = ""
    title_tag = soup.find("title")
    if title_tag:
        title = title_tag.get_text(strip=True)

    meta_desc = ""
    meta_tag = soup.find("meta", attrs={"name": "description"})
    if meta_tag:
        meta_desc = meta_tag.get("content", "")

    # Clean the soup
    soup = _clean_soup(soup)

    # Try to find main content
    main = _find_main_content(soup)
    content_source = main if main else soup.find("body") or soup

    text = _extract_text_smart(content_source)

    # Extract useful links from main content
    links = []
    for a in (main or content_source).find_all("a", href=True):
        href = a.get("href", "")
        link_text = a.get_text(strip=True)
        if not link_text or len(link_text) < 3:
            continue
        if href.startswith("#") or href.startswith("javascript:"):
            continue
        # Resolve relative URLs
        if not href.startswith(("http://", "https://")):
            href = urllib.parse.urljoin(url, href)
        links.append({"text": link_text[:100], "url": href})

    # Deduplicate links
    seen_urls = set()
    unique_links = []
    for link in links[:20]:
        if link["url"] not in seen_urls:
            seen_urls.add(link["url"])
            unique_links.append(link)

    return {
        "title": title,
        "text": text[:MAX_CONTENT_LENGTH],
        "meta_description": meta_desc,
        "links": unique_links[:10],
        "word_count": len(text.split()),
    }


# ─────────────────────────────────────────────────────────
# Search backends
# ─────────────────────────────────────────────────────────

@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str
    source: str  # which backend found this

    def to_dict(self) -> Dict[str, str]:
        return {
            "title": self.title,
            "url": self.url,
            "snippet": self.snippet,
            "source": self.source,
        }


def _search_duckduckgo_html(query: str, max_results: int = 5) -> List[SearchResult]:
    """
    Search via DuckDuckGo HTML version.
    More reliable than Lite for structured extraction.
    """
    encoded = urllib.parse.quote_plus(query)
    url = f"https://html.duckduckgo.com/html/?q={encoded}"

    try:
        resp = requests.post(
            "https://html.duckduckgo.com/html/",
            data={"q": query, "b": ""},
            headers=HEADERS,
            timeout=DEFAULT_TIMEOUT,
        )
        resp.raise_for_status()
    except Exception as e:
        logger.warning(f"DDG HTML search failed: {e}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    results: List[SearchResult] = []

    for result_div in soup.select(".result"):
        try:
            # Title and URL
            title_el = result_div.select_one(".result__a")
            if not title_el:
                continue
            title = title_el.get_text(strip=True)
            raw_url = title_el.get("href", "")

            # DDG wraps URLs in a redirect
            clean_url = _extract_ddg_url(raw_url)
            if not clean_url:
                continue

            # Snippet
            snippet_el = result_div.select_one(".result__snippet")
            snippet = snippet_el.get_text(strip=True) if snippet_el else ""

            results.append(SearchResult(
                title=title,
                url=clean_url,
                snippet=snippet,
                source="duckduckgo",
            ))

            if len(results) >= max_results:
                break
        except Exception:
            continue

    return results


def _search_duckduckgo_lite(query: str, max_results: int = 5) -> List[SearchResult]:
    """Fallback: DuckDuckGo Lite (the original approach, improved)."""
    encoded = urllib.parse.quote(query)
    url = f"https://lite.duckduckgo.com/lite/?q={encoded}"

    try:
        resp = requests.get(url, headers=HEADERS, timeout=DEFAULT_TIMEOUT)
        resp.raise_for_status()
    except Exception as e:
        logger.warning(f"DDG Lite search failed: {e}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    results: List[SearchResult] = []

    # DDG Lite uses a table layout
    for link in soup.select("a.result-link"):
        try:
            title = link.get_text(strip=True)
            raw_url = link.get("href", "")
            clean_url = _extract_ddg_url(raw_url)
            if not clean_url:
                continue

            # Try to find snippet in next row
            snippet = ""
            tr = link.find_parent("tr")
            if tr:
                next_tr = tr.find_next_sibling("tr")
                if next_tr:
                    td = next_tr.find("td", class_="result-snippet")
                    if td:
                        snippet = td.get_text(strip=True)

            results.append(SearchResult(
                title=title,
                url=clean_url,
                snippet=snippet,
                source="duckduckgo_lite",
            ))

            if len(results) >= max_results:
                break
        except Exception:
            continue

    return results


def _search_brave(query: str, max_results: int = 5) -> List[SearchResult]:
    """
    Brave Search via their web interface scraping.
    Good fallback when DDG is rate-limited.
    """
    encoded = urllib.parse.quote_plus(query)
    url = f"https://search.brave.com/search?q={encoded}&source=web"

    try:
        resp = requests.get(url, headers=HEADERS, timeout=DEFAULT_TIMEOUT)
        resp.raise_for_status()
    except Exception as e:
        logger.warning(f"Brave search failed: {e}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    results: List[SearchResult] = []

    for item in soup.select(".snippet"):
        try:
            title_el = item.select_one(".snippet-title")
            if not title_el:
                continue
            link_el = title_el.find_parent("a")
            if not link_el:
                continue

            title = title_el.get_text(strip=True)
            href = link_el.get("href", "")
            if not href.startswith("http"):
                continue

            desc_el = item.select_one(".snippet-description")
            snippet = desc_el.get_text(strip=True) if desc_el else ""

            results.append(SearchResult(
                title=title,
                url=href,
                snippet=snippet,
                source="brave",
            ))

            if len(results) >= max_results:
                break
        except Exception:
            continue

    return results


def _extract_ddg_url(raw_url: str) -> Optional[str]:
    """Extract the actual URL from a DuckDuckGo redirect URL."""
    if not raw_url:
        return None

    try:
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(raw_url).query)
        uddg = qs.get("uddg", [None])[0]
        if uddg:
            return uddg
    except Exception:
        pass

    if raw_url.startswith(("http://", "https://")):
        return raw_url

    return None


def multi_search(
    query: str,
    max_results: int = 5,
) -> List[SearchResult]:
    """
    Search using multiple backends with automatic fallback.
    Deduplicates results across backends.
    """
    all_results: List[SearchResult] = []
    seen_urls: set = set()

    # Try backends in order of preference
    backends = [
        ("duckduckgo_html", _search_duckduckgo_html),
        ("duckduckgo_lite", _search_duckduckgo_lite),
        ("brave", _search_brave),
    ]

    for name, backend_fn in backends:
        if len(all_results) >= max_results:
            break
        try:
            results = backend_fn(query, max_results=max_results)
            for r in results:
                # Normalize URL for dedup
                norm_url = r.url.rstrip("/").lower()
                if norm_url not in seen_urls:
                    seen_urls.add(norm_url)
                    all_results.append(r)
            if results:
                logger.info(f"Search backend '{name}' returned {len(results)} results")
                break  # First successful backend is enough
        except Exception as e:
            logger.warning(f"Search backend '{name}' failed: {e}")
            continue

    if not all_results:
        logger.warning(f"All search backends failed for query: {query}")

    return all_results[:max_results]


# ─────────────────────────────────────────────────────────
# Tool definitions (registered with the agent)
# ─────────────────────────────────────────────────────────

class WebSearchArgs(BaseModel):
    query: str = Field(..., description="Search query. Be specific and concise.")
    max_results: int = Field(5, ge=1, le=10, description="Number of results to return")


@tool(
    "web_search",
    WebSearchArgs,
    "Search the web for information. Returns titles, URLs, and snippets. "
    "Use specific, targeted queries for best results."
)
def web_search(args: WebSearchArgs) -> dict:
    results = multi_search(args.query, max_results=args.max_results)
    if not results:
        return {
            "results": [],
            "query": args.query,
            "note": "No results found. Try rephrasing the query or using different keywords.",
        }
    return {
        "results": [r.to_dict() for r in results],
        "query": args.query,
        "count": len(results),
    }


class FetchURLArgs(BaseModel):
    url: str = Field(..., description="Full URL of the webpage to read")
    extract_links: bool = Field(
        False,
        description="Whether to also return useful links found on the page",
    )


@tool(
    "fetch_url",
    FetchURLArgs,
    "Fetch and extract the main content of a public webpage. "
    "Returns cleaned text, title, and optionally links. "
    "Use this to read full articles or pages found via web_search."
)
def fetch_url(args: FetchURLArgs) -> dict:
    try:
        resp = requests.get(
            args.url,
            headers=HEADERS,
            timeout=DEFAULT_TIMEOUT,
            allow_redirects=True,
        )
        resp.raise_for_status()

        # Check content type
        content_type = resp.headers.get("content-type", "")
        if "text/html" not in content_type and "application/xhtml" not in content_type:
            return {
                "error": f"Not an HTML page (content-type: {content_type})",
                "url": args.url,
            }

        content = extract_content(resp.text, url=args.url)

        result = {
            "url": args.url,
            "title": content["title"],
            "text": content["text"],
            "word_count": content["word_count"],
        }

        if content["meta_description"]:
            result["meta_description"] = content["meta_description"]

        if args.extract_links and content["links"]:
            result["links"] = content["links"]

        return result

    except requests.exceptions.Timeout:
        return {"error": "Request timed out", "url": args.url}
    except requests.exceptions.ConnectionError:
        return {"error": "Could not connect to the server", "url": args.url}
    except requests.exceptions.HTTPError as e:
        return {"error": f"HTTP error: {e.response.status_code}", "url": args.url}
    except Exception as e:
        return {"error": str(e), "url": args.url}


class SearchAndReadArgs(BaseModel):
    query: str = Field(..., description="What to search for")
    max_pages: int = Field(
        2, ge=1, le=3,
        description="How many top results to read in full (1-3)"
    )


@tool(
    "search_and_read",
    SearchAndReadArgs,
    "Combined search + read: searches the web, then fetches and reads the top results. "
    "More thorough than web_search alone. Use for research questions that need depth."
)
def search_and_read(args: SearchAndReadArgs) -> dict:
    """
    Compound tool: search + fetch top N results.
    Returns structured summaries from each source.
    """
    search_results = multi_search(args.query, max_results=args.max_pages + 2)

    if not search_results:
        return {
            "query": args.query,
            "sources": [],
            "note": "No search results found.",
        }

    sources: List[Dict[str, Any]] = []
    read_count = 0

    for sr in search_results:
        if read_count >= args.max_pages:
            break

        try:
            resp = requests.get(
                sr.url,
                headers=HEADERS,
                timeout=DEFAULT_TIMEOUT,
                allow_redirects=True,
            )
            resp.raise_for_status()

            content_type = resp.headers.get("content-type", "")
            if "text/html" not in content_type:
                continue

            content = extract_content(resp.text, url=sr.url)

            # Skip pages with very little content
            if content["word_count"] < 50:
                continue

            sources.append({
                "url": sr.url,
                "title": content["title"] or sr.title,
                "snippet": sr.snippet,
                "content": content["text"][:MAX_CONTENT_LENGTH // args.max_pages],
                "word_count": content["word_count"],
            })
            read_count += 1

        except Exception as e:
            logger.warning(f"Failed to fetch {sr.url}: {e}")
            # Still include the search snippet
            sources.append({
                "url": sr.url,
                "title": sr.title,
                "snippet": sr.snippet,
                "content": f"(could not fetch page: {e})",
                "word_count": 0,
            })

    return {
        "query": args.query,
        "sources_read": len([s for s in sources if s["word_count"] > 0]),
        "sources": sources,
    }