"""
Updated API router.

Changes from original:
- Streaming payloads now include knowledge_base facts and budget info
- Added GET /api/agent/health endpoint
- Cleaned up imports
"""

import asyncio
import json
import os
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.backend.api.tools.web import fetch_url, web_search, search_and_read
from app.backend.core.agent.agent_manager import AgentManager
from app.backend.core.agent.llm import LLM
from app.backend.core.agent.mistralLlm import MistralLLM
from app.backend.core.agent.ollamaLlm import OllamaLLM
from app.backend.core.agent.openaiLlm import OpenAILLM
from app.backend.core.agent.tool import tool
from app.backend.core.reasoningTree.reasoning_tree import TreeBudget


router = APIRouter(tags=["Agent"])


# ── Example tool ──────────────────────────────────────────

class AddArgs(BaseModel):
    a: int
    b: int


@tool("add_a_b", AddArgs, "Add two integers and return their sum")
def add_a_b(args: AddArgs) -> dict:
    return {"sum": args.a + args.b}


# ── Request model ─────────────────────────────────────────

class AgentRequest(BaseModel):
    query: str
    llmProvider: Optional[str] = None
    providerUrl: Optional[str] = None
    modelName: Optional[str] = None
    apiKey: Optional[str] = None
    # Budget overrides
    maxNodes: Optional[int] = None
    maxDepth: Optional[int] = None
    maxToolCalls: Optional[int] = None
    timeoutSeconds: Optional[float] = None


# ── LLM factory ──────────────────────────────────────────

def _build_llm(
    provider_override: Optional[str] = None,
    provider_url: Optional[str] = None,
    model_name_override: Optional[str] = None,
    api_key_override: Optional[str] = None,
) -> LLM:
    provider = (provider_override or os.getenv("LLM_PROVIDER", "openai")).lower()

    if provider == "mistral":
        model_name = model_name_override or os.getenv("MISTRAL_MODEL", "mistral-medium-2508")
        return MistralLLM(model_name=model_name, provider_url=provider_url, api_key=api_key_override)
    elif provider == "ollama":
        model_name = model_name_override or os.getenv("OLLAMA_MODEL", "gemma3:12b")
        return OllamaLLM(model_name=model_name, provider_url=provider_url, api_key=api_key_override)

    model_name = model_name_override or os.getenv("OPENAI_MODEL", "gpt-4o")
    return OpenAILLM(model_name=model_name, provider_url=provider_url, api_key=api_key_override)


def _init_manager(req: AgentRequest) -> AgentManager:
    try:
        llm = _build_llm(
            provider_override=(req.llmProvider or None),
            provider_url=(req.providerUrl or None),
            model_name_override=(req.modelName or None),
            api_key_override=(req.apiKey or None),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to initialize language model: {exc}") from exc

    for tool_fn in (web_search, fetch_url, search_and_read, add_a_b):
        llm.register_decorated_tool(tool_fn)

    budget = TreeBudget(
        max_total_nodes=req.maxNodes or 50,
        max_branch_depth=req.maxDepth or 6,
        max_total_tool_calls=req.maxToolCalls or 100,
        timeout_seconds=req.timeoutSeconds or 300.0,
    )

    return AgentManager(user_input=req.query, llm=llm, budget=budget)


# ── Endpoints ─────────────────────────────────────────────

@router.get("/health")
async def health():
    return {"status": "ok"}


@router.post("/run")
async def run_agent(req: AgentRequest):
    manager = _init_manager(req)
    try:
        result = manager.run()
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Agent execution failed: {exc}") from exc


@router.post("/run-stream")
async def run_agent_stream(req: AgentRequest):
    manager = _init_manager(req)
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict] = asyncio.Queue()

    loop.call_soon(queue.put_nowait, {"type": "start", "payload": {"query": req.query}})

    def emit_update(snapshot: dict) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, {"type": "update", "payload": snapshot})

    async def worker() -> None:
        def _run() -> None:
            try:
                result = manager.run(on_update=emit_update)
                loop.call_soon_threadsafe(queue.put_nowait, {"type": "final", "payload": result})
            except Exception as exc:
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {"type": "error", "error": str(exc)},
                )
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, {"type": "done"})

        await loop.run_in_executor(None, _run)

    asyncio.create_task(worker())

    async def event_generator():
        while True:
            event = await queue.get()
            if event.get("type") == "done":
                break
            yield f"data: {json.dumps(event)}\n\n"

    headers = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=headers)