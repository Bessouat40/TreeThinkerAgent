import json
from pydantic import BaseModel, Field
import requests
from bs4 import BeautifulSoup
import urllib.parse

from app.backend.core.agent.tool import tool


class WebSearchArgs(BaseModel):
    query: str = Field(..., description="Search query")
    max_results: int = Field(5, ge=1, le=25, description="Maximum number of results")


@tool("web_search", WebSearchArgs, "Performs a web search using DuckDuckGo Lite and returns basic results")
def web_search(args: WebSearchArgs) -> dict:
    query = urllib.parse.quote(args.query)
    url = f"https://lite.duckduckgo.com/lite/?q={query}"

    headers = {
        "User-Agent": "Mozilla/5.0"
    }

    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        # DuckDuckGo Lite usually has <a class="result-link" href="/l/?uddg=..."> but structure can vary.
        # Try multiple selectors to be more tolerant.
        links = soup.select('a.result-link')
        if not links:
            links = soup.select('a')

        results = []
        for link in links:
            try:
                title = link.get_text(strip=True)
                raw_url = link.get('href') or ''

                clean_url = None
                try:
                    qs = urllib.parse.parse_qs(urllib.parse.urlparse(raw_url).query)
                    clean_url = qs.get('uddg', [None])[0]
                except Exception:
                    clean_url = None

                if not clean_url:
                    if raw_url.startswith('http://') or raw_url.startswith('https://'):
                        clean_url = raw_url
                    elif raw_url.startswith('/'):
                        clean_url = urllib.parse.urljoin('https://lite.duckduckgo.com', raw_url)

                if not clean_url:
                    continue

                desc = ''
                tr = link.find_parent('tr')
                if tr:
                    tr_next = tr.find_next_sibling('tr')
                    if tr_next:
                        td = tr_next.find('td', class_='result-snippet')
                        if td:
                            desc = td.get_text(strip=True)
                if not desc:
                    sib = link.find_next_sibling(['span', 'div'])
                    if sib:
                        desc = sib.get_text(strip=True)

                results.append({
                    'title': title,
                    'url': clean_url,
                    'snippet': desc,
                })

                if len(results) >= args.max_results:
                    break
            except Exception:
                continue

        return {'results': results}

    except Exception as e:
        return {"error": str(e)}

class FetchURLArgs(BaseModel):
    url: str = Field(..., description="URL of the webpage to read")

@tool("fetch_url", FetchURLArgs, "Fetch and clean the content of a public webpage.")
def fetch_url(args: FetchURLArgs) -> dict:
    try:
        response = requests.get(args.url, timeout=10)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        text = soup.get_text(separator="\n", strip=True)
        return json.loads(json.dumps({"text": text[:10_000]}))
    except Exception as e:
        return {"error": str(e)}
