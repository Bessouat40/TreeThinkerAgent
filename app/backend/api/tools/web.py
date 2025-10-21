import json
from pydantic import BaseModel, Field
import requests
from bs4 import BeautifulSoup
import urllib.parse
import requests
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field

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
        links = soup.find_all('a', class_='result-link')

        results = []
        for link in links:
            title = link.get_text(strip=True)
            raw_url = link.get('href')
            clean_url = urllib.parse.parse_qs(
                urllib.parse.urlparse(raw_url).query
            ).get('uddg', [None])[0]
            if not clean_url:
                continue

            desc = ""
            tr = link.find_parent('tr')
            if tr:
                tr_next = tr.find_next_sibling('tr')
                if tr_next:
                    td = tr_next.find('td', class_='result-snippet')
                    if td:
                        desc = td.get_text(strip=True)

            results.append({
                "title": title,
                "url": clean_url,
                "snippet": desc
            })

            if len(results) >= args.max_results:
                break

        return json.loads(json.dumps({"results": results}))

    except Exception as e:
        return {"error": str(e)}

class FetchURLArgs(BaseModel):
    url: str = Field(..., description="URL d'une page web à lire")

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
