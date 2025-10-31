"""Manual smoke-tests for the HTTP tools."""

from app.backend.api.tools.web import WebSearchArgs, FetchURLArgs, fetch_url, web_search


args = WebSearchArgs(query="flight to Madrid")
result = web_search(args)

url = "https://www.travelandvoyage.com/post/madrid-ultimate-itinerary"
url_args = FetchURLArgs(url=url)
result2 = fetch_url(url_args)

print(result)
print(result2)
