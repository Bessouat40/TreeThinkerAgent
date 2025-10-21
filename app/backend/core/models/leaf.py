from dataclasses import dataclass, field
from typing import Any, Dict, List

from app.backend.core.models.tool_calls import ToolCall

@dataclass
class LlmLeaf:
    description: str
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
    parent_leaf: str
    child_leaves: List[str]
    tool_calls: List[ToolCall] = field(default_factory=list)
