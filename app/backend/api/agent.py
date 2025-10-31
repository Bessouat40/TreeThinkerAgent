"""HTTP endpoints that expose the research agent."""
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.backend.api.tools.web import fetch_url, web_search
from app.backend.core.agent.agent_manager import AgentManager
from app.backend.core.agent.llm import LLM
from app.backend.core.agent.mistralLlm import MistralLLM
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


def _build_llm() -> LLM:
    """Build the LLM backend based on environment configuration."""
    provider = os.getenv("LLM_PROVIDER", "openai").lower()
    if provider == "mistral":
        model_name = os.getenv("MISTRAL_MODEL", "mistral-medium-2508")
        return MistralLLM(model_name=model_name)

    model_name = os.getenv("OPENAI_MODEL", "gpt-4o")
    return OpenAILLM(model_name=model_name)


@router.post("/run")
async def run_agent(req: AgentRequest):
    """Run the autonomous research agent for the provided query."""
    try:
        llm = _build_llm()
    except Exception as exc:  # pragma: no cover - defensive guardrail
        raise HTTPException(status_code=500, detail=f"Failed to initialize language model: {exc}") from exc

    for tool_fn in (web_search, fetch_url, add_a_b):
        llm.register_decorated_tool(tool_fn)

    manager = AgentManager(user_input=req.query, llm=llm)
    try:
        result = manager.run()
        return result
    except Exception as exc:  # pragma: no cover - surfaced to API clients
        raise HTTPException(status_code=500, detail=f"Agent execution failed: {exc}") from exc
