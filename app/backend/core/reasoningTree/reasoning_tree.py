from typing import Any, Dict, List

from pydantic import BaseModel, Field
from app.backend.core.models.leaf import Leaf
from app.backend.core.models.tool_calls import ToolCall

class AddLeafArgs(BaseModel):
    description: str = Field(..., description="Text describing the reasoning step")
    tool_calls: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="List of tools to execute alongside their arguments",
    )

class ReasoningTree:
    def __init__(self, user_input: str) -> None:
        self.leaves: Dict[str, Leaf] = {}

        root_leaf = Leaf(
            id="leaf_0",
            description=user_input,
            parent_leaf=None,
            tool_calls=[],
            child_leaves=[],
            result=""
        )
        self.leaves[root_leaf.id] = root_leaf

    def __len__(self):
        return len(self.leaves)
    
    def __str__(self):
        return "\n".join(
            f"{leaf.id}: {leaf.description}" for leaf in self.leaves.values()
        )
    
    def to_dict(self) -> dict:
        return {leaf_id: leaf.to_dict() for leaf_id, leaf in self.leaves.items()}

    def get_branch_depth(self, leaf_id: str) -> int:
        """Return the depth (number of edges) between the root and the leaf."""
        depth = 0
        cur = self.leaves.get(leaf_id)
        while cur and cur.parent_leaf is not None:
            depth += 1
            cur = self.leaves.get(cur.parent_leaf)
        return depth

    def add_leaf(self, description: str, parent_leaf: str, tool_calls: List[ToolCall], result: str) -> str:
        leaf_number = len(self.leaves)
        new_id = f"leaf_{leaf_number}"
        while new_id in self.leaves:
            leaf_number += 1
            new_id = f"leaf_{leaf_number}"

        new_leaf = Leaf(
            id=new_id, description=description, parent_leaf=parent_leaf,
            tool_calls=tool_calls, child_leaves=[], result=result
        )
        self.leaves[new_id] = new_leaf
        if parent_leaf in self.leaves:
            self.leaves[parent_leaf].child_leaves.append(new_id)
        return new_id


    def get_leaf_context(self, leaf_id: str) -> str:
        if leaf_id not in self.leaves:
            return "Leaf not found."

        leaf = self.leaves[leaf_id]

        if leaf.parent_leaf is None:
            return str(leaf)

        parent_context = self.get_leaf_context(leaf.parent_leaf)
        return f"{parent_context}\n\n→ {str(leaf)}".strip()

    def get_last_leaves(self) -> List[Leaf]:
        return [leaf for leaf in self.leaves.values() if not leaf.child_leaves]

    def get_reasoning_tree_context(self) -> str:
        return "\n\n====================\n\n".join(
            self.get_leaf_context(leaf.id) for leaf in self.get_last_leaves()
        )
