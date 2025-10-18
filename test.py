from app.backend.api.tools.web import web_search, WebSearchArgs


def test_web_search_basic():
    args = WebSearchArgs(query="horaires musée du Prado", max_results=10)
    result = web_search(args)

    assert isinstance(result, dict), "Le résultat doit être un dictionnaire"
    assert "results" in result, "La clé 'results' doit être présente"
    assert isinstance(result["results"], list), "'results' doit être une liste"
    assert len(result["results"]) > 0, "La liste des résultats ne doit pas être vide"

    for res in result["results"]:
        assert "title" in res, "Chaque résultat doit contenir un titre"
        assert "url" in res, "Chaque résultat doit contenir une URL"
        assert isinstance(res["title"], str) and len(res["title"]) > 0
        assert isinstance(res["url"], str) and res["url"].startswith("http")

    print(result)
    print("✅ Test passed: recherche web basique fonctionne")


if __name__ == "__main__":
    test_web_search_basic()
