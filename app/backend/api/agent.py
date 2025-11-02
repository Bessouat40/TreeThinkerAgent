"""HTTP endpoints that expose the research agent."""
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.backend.api.tools.web import fetch_url, web_search
from app.backend.core.agent.agent_manager import AgentManager
from app.backend.core.agent.llm import LLM
from app.backend.core.agent.mistralLlm import MistralLLM
from app.backend.core.agent.ollamaLlm import OllamaLLM
from app.backend.core.agent.openaiLlm import OpenAILLM
from app.backend.core.agent.tool import tool


router = APIRouter(tags=["Agent"])


class AddArgs(BaseModel):
    a: int
    b: int


@tool("add_a_b", AddArgs, "Add two integers and return their sum")
def add_a_b(args: AddArgs) -> dict:
    """Simple example tool used for testing the tool registration pipeline."""
    return {"sum": args.a + args.b}


class AgentRequest(BaseModel):
    query: str
    llmProvider: Optional[str] = None
    providerUrl: Optional[str] = None
    modelName: Optional[str] = None
    apiKey: Optional[str] = None


def _build_llm(
    provider_override: Optional[str] = None,
    provider_url: Optional[str] = None,
    model_name_override: Optional[str] = None,
    api_key_override: Optional[str] = None,
) -> LLM:
    """Build the LLM backend based on environment configuration or provided overrides.

    Args:
        provider_override: optional provider name (e.g. 'openai', 'mistral', 'ollama')
        provider_url: optional provider URL (kept on the instance for callers to use)
        model_name_override: optional model name to use for the provider
    """
    provider = (provider_override or os.getenv("LLM_PROVIDER", "openai")).lower()

    if provider == "mistral":
        model_name = model_name_override or os.getenv("MISTRAL_MODEL", "mistral-medium-2508")
        inst = MistralLLM(model_name=model_name, provider_url=provider_url, api_key=api_key_override)
        return inst

    elif provider == "ollama":
        model_name = model_name_override or os.getenv("OLLAMA_MODEL", "gemma3:12b")
        inst = OllamaLLM(model_name=model_name, provider_url=provider_url, api_key=api_key_override)
        return inst

    model_name = model_name_override or os.getenv("OPENAI_MODEL", "gpt-4o")
    inst = OpenAILLM(model_name=model_name, provider_url=provider_url, api_key=api_key_override)
    return inst


@router.post("/run")
async def run_agent(req: AgentRequest):
    """Run the autonomous research agent for the provided query."""
    try:
        llm = _build_llm(
            provider_override=(req.llmProvider or None),
            provider_url=(req.providerUrl or None),
            model_name_override=(req.modelName or None),
            api_key_override=(req.apiKey or None),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to initialize language model: {exc}") from exc

    for tool_fn in (web_search, fetch_url, add_a_b):
        llm.register_decorated_tool(tool_fn)

    manager = AgentManager(user_input=req.query, llm=llm)
    try:
        result = manager.run()
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Agent execution failed: {exc}") from exc
