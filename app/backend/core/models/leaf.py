from dataclasses import dataclass, field
from typing import List, Optional

from app.backend.core.models.tool_calls import ToolCall

@dataclass
class LlmLeaf:
    description: str
    tool_calls: List[ToolCall] = field(default_factory=list)

@dataclass
class Leaf:
    id: str
    description: str
    parent_leaf: str
    child_leaves: List[str]
    tool_calls: List[ToolCall] = field(default_factory=list)
