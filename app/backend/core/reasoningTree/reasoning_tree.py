from typing import Any, Dict, List

from pydantic import BaseModel, Field
from app.backend.core.agent.llm import LLM
from app.backend.core.agent.tool import tool
from app.backend.core.models.leaf import Leaf
from app.backend.core.models.tool_calls import ToolCall

class AddLeafArgs(BaseModel):
    description: str = Field(..., description="Texte décrivant l'étape de raisonnement")
    tool_calls: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Liste des tools à appeler avec leurs arguments"
    )

class ReasoningTree:
    def __init__(self, user_input: str) -> None:
        self.leaves: Dict[str, Leaf] = {}

        root_leaf = Leaf(
            id="leaf_0",
            description=user_input,
            parent_leaf=None,
            tool_calls=[],
            child_leaves=[]
        )
        self.leaves[root_leaf.id] = root_leaf

    def __len__(self):
        return len(self.leaves)

    def add_leaf(self, description: str, parent_leaf: str, tool_calls: List[ToolCall]) -> None:
        leaf_number = len(self.leaves)
        new_id = f"leaf_{leaf_number}"
        if new_id in self.leaves:
            return self.add_leaf(description, parent_leaf, tool_calls)

        new_leaf = Leaf(
            id=new_id,
            description=description,
            parent_leaf=parent_leaf,
            tool_calls=tool_calls,
            child_leaves=[]
        )
        self.leaves[new_id] = new_leaf

        if parent_leaf in self.leaves:
            self.leaves[parent_leaf].child_leaves.append(new_id)

    def get_leaf_context(self, leaf_id: str) -> str:
        if leaf_id not in self.leaves:
            return "Leaf not found."

        leaf = self.leaves[leaf_id]

        if leaf.parent_leaf is None:
            tool_context = "\n".join(str(tc) for tc in leaf.tool_calls)
            return f"{leaf.description}\n{tool_context}".strip()

        parent_context = self.get_leaf_context(leaf.parent_leaf)
        tool_context = "\n".join(str(tc) for tc in leaf.tool_calls)
        return f"{parent_context}\n\n→ {leaf.description}\n{tool_context}".strip()

    def get_last_leaves(self) -> List[Leaf]:
        return [leaf for leaf in self.leaves.values() if not leaf.child_leaves]

    def get_reasoning_tree_context(self) -> str:
        return "\n\n====================\n\n".join(
            self.get_leaf_context(leaf.id) for leaf in self.get_last_leaves()
        )
