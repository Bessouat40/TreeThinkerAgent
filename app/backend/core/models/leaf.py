from dataclasses import dataclass, field
from typing import Any, Dict, List

from app.backend.core.models.tool_calls import ToolCall, ToolResult

@dataclass
class LlmLeaf:
    description: str
    tool_results: List[ToolResult]
    tool_calls: List[ToolCall] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "description": self.description,
            "tool_calls": [tc.to_dict() for tc in self.tool_calls]
        }

@dataclass
class Leaf:
    id: str
    description: str
    result: str
    parent_leaf: str
    child_leaves: List[str]
    tool_calls: List[ToolCall] = field(default_factory=list)

    def __str__(self) -> str:
        parts = [f"Leaf(id={self.id})", f"desc={self.description}", f"result={self.result}"]
        if self.parent_leaf:
            parts.append(f"parent={self.parent_leaf}")
        if self.child_leaves:
            parts.append(f"children={self.child_leaves}")
        if self.tool_calls:
            parts.append(str(self.tool_calls))
        return " | ".join(parts)
