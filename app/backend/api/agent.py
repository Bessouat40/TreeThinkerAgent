from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.backend.api.tools.web import fetch_url, web_search
from app.backend.core.mistralLlm import MistralLLM
from app.backend.core.manager import AgentManager, AgentManagerConfig
from app.backend.core.tool import tool

router = APIRouter(prefix="/agent", tags=["Agent"])

class AddArgs(BaseModel):
    a: int
    b: int

@tool("add_a_b", AddArgs, "Add two integers and return their sum")
def add_a_b(args: AddArgs) -> dict:
    return {"sum": args.a + args.b}


class AgentRequest(BaseModel):
    query: str


@router.post("/run")
async def run_agent(req: AgentRequest):
    # try:
    llm = MistralLLM(model_name="mistral-medium-2508")
    llm.register_decorated_tool(add_a_b)
    llm.register_decorated_tool(web_search)
    llm.register_decorated_tool(fetch_url)

    cfg = AgentManagerConfig(max_loops=4)
    manager = AgentManager(llm, cfg)

    state = manager.run(req.query)
    return {
        "final": state.final,
        "nodes": {nid: n.__dict__ for nid, n in state.nodes.items()},
        "trace": state.trace,
    }
    # except Exception as e:
    #     raise HTTPException(status_code=500, detail=str(e))
