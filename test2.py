"""Quick manual script used for local debugging of the Mistral integration."""

from app.backend.api.tools.web import fetch_url, web_search
from app.backend.core.agent.agent_manager import AgentManager
from app.backend.core.agent.mistralLlm import MistralLLM


llm = MistralLLM(model_name="codestral-2508")
llm.register_decorated_tool(web_search)
llm.register_decorated_tool(fetch_url)

# Ensure tools are registered
assert llm.get_tools_spec(), "No tools registered. Ensure tools are properly decorated and registered."

am = AgentManager("I want to plan a trip to Madrid.", llm)
am.run()

print(am.reasoning_tree.get_reasoning_tree_context())
print(am.reasoning_tree.leaves)
