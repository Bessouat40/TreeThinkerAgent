import json
from pydantic import BaseModel, Field
from typing import Any, List, Dict
from app.backend.core.agent.tool import tool
from app.backend.core.models.leaf import LlmLeaf
from app.backend.core.models.tool_calls import ToolCall

class AddLeafArgs(BaseModel):
    description: str = Field(..., description="Text describing the reasoning step")
    tool_calls: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="List of tools to execute alongside their arguments",
    )

@tool("add_leaf_to_reasoning_tree", AddLeafArgs, "Prepare a reasoning step (leaf) that can be added to the reasoning tree.")
def add_leaf_to_reasoning_tree(args: AddLeafArgs) -> dict:
    try:
        tool_calls = [
            ToolCall(
                tool_name=tc["tool_name"],
                args=tc.get("args", {}),
                result=tc.get("result", "")
            )
            for tc in args.tool_calls
        ]

        leaf = LlmLeaf(args.description, tool_calls)
        return json.loads(json.dumps(leaf.to_dict()))

    except Exception as e:
        return {"status": "error", "error": str(e)}
