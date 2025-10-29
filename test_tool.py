from app.backend.api.tools.web import web_search, WebSearchArgs, FetchURLArgs, fetch_url

args = WebSearchArgs(query="vol pour Madrid")

result = web_search(args)

url = "https://www.travelandvoyage.com/post/madrid-ultimate-itinerary"

url_args = FetchURLArgs(url=url)

result2 = fetch_url(url_args)

print(result)
print(result2)
