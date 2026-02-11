"""
Improved Reasoning Tree with:
- Strict structural validation (no orphan nodes, no cycles, consistent parent/child refs)
- Integrated KnowledgeBase for cross-branch knowledge sharing
- Depth/breadth budgets
- Robust serialization with schema versioning
"""

import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from pydantic import BaseModel, Field, field_validator

from app.backend.core.models.tool_calls import ToolCall
from app.backend.core.models.leaf import Leaf

# If you place knowledge_base.py in core/models/ adjust import accordingly
from app.backend.core.models.knowledge import KnowledgeBase, Fact


# ─────────────────────────────────────────────────────────
# Budget / limits configuration
# ─────────────────────────────────────────────────────────

@dataclass
class TreeBudget:
    """Hard limits to prevent runaway reasoning."""
    max_total_nodes: int = 50
    max_branch_depth: int = 6
    max_children_per_node: int = 8
    max_total_tool_calls: int = 100
    timeout_seconds: float = 300.0  # 5 minutes

    def to_dict(self) -> Dict[str, Any]:
        return {
            "max_total_nodes": self.max_total_nodes,
            "max_branch_depth": self.max_branch_depth,
            "max_children_per_node": self.max_children_per_node,
            "max_total_tool_calls": self.max_total_tool_calls,
            "timeout_seconds": self.timeout_seconds,
        }


class BudgetExhausted(Exception):
    """Raised when the tree hits a budget limit."""
    pass


# ─────────────────────────────────────────────────────────
# Validation errors
# ─────────────────────────────────────────────────────────

class TreeValidationError(Exception):
    """Raised when a structural invariant is violated."""
    pass


# ─────────────────────────────────────────────────────────
# Reasoning Tree (improved)
# ─────────────────────────────────────────────────────────

TREE_SCHEMA_VERSION = 2

class ReasoningTree:
    """
    A tree of reasoning steps (leaves) with structural validation,
    budget enforcement, and a shared knowledge base.
    """

    def __init__(
        self,
        user_input: str,
        budget: Optional[TreeBudget] = None,
    ) -> None:
        self.user_input = user_input
        self.budget = budget or TreeBudget()
        self.knowledge_base = KnowledgeBase()
        self._start_time = time.time()
        self._total_tool_calls = 0

        self.leaves: Dict[str, Leaf] = {}

        root_leaf = Leaf(
            id="leaf_0",
            description=user_input,
            parent_leaf=None,
            tool_calls=[],
            child_leaves=[],
            result="",
        )
        self.leaves[root_leaf.id] = root_leaf

    # ── Budget checks ────────────────────────────────────

    def check_budget(self, parent_leaf_id: Optional[str] = None) -> None:
        """
        Raise BudgetExhausted if adding a new node would exceed limits.
        Call this BEFORE adding a leaf.
        """
        elapsed = time.time() - self._start_time
        if elapsed > self.budget.timeout_seconds:
            raise BudgetExhausted(
                f"Timeout: {elapsed:.0f}s exceeds limit of {self.budget.timeout_seconds:.0f}s"
            )

        if len(self.leaves) >= self.budget.max_total_nodes:
            raise BudgetExhausted(
                f"Node limit reached: {len(self.leaves)}/{self.budget.max_total_nodes}"
            )

        if parent_leaf_id:
            depth = self.get_branch_depth(parent_leaf_id) + 1
            if depth > self.budget.max_branch_depth:
                raise BudgetExhausted(
                    f"Depth limit reached: depth {depth} > {self.budget.max_branch_depth}"
                )

            parent = self.leaves.get(parent_leaf_id)
            if parent and len(parent.child_leaves) >= self.budget.max_children_per_node:
                raise BudgetExhausted(
                    f"Children limit: {parent_leaf_id} already has "
                    f"{len(parent.child_leaves)}/{self.budget.max_children_per_node} children"
                )

    def check_tool_budget(self, n_calls: int = 1) -> None:
        """Check if we can still make tool calls."""
        if self._total_tool_calls + n_calls > self.budget.max_total_tool_calls:
            raise BudgetExhausted(
                f"Tool call limit: {self._total_tool_calls + n_calls} > "
                f"{self.budget.max_total_tool_calls}"
            )

    def register_tool_calls(self, n_calls: int) -> None:
        self._total_tool_calls += n_calls

    @property
    def elapsed_seconds(self) -> float:
        return time.time() - self._start_time

    @property
    def budget_summary(self) -> Dict[str, Any]:
        return {
            "nodes_used": len(self.leaves),
            "nodes_max": self.budget.max_total_nodes,
            "tool_calls_used": self._total_tool_calls,
            "tool_calls_max": self.budget.max_total_tool_calls,
            "elapsed_seconds": round(self.elapsed_seconds, 1),
            "timeout_seconds": self.budget.timeout_seconds,
        }

    # ── Structural validation ────────────────────────────

    def _validate_parent_exists(self, parent_leaf_id: str) -> Leaf:
        """Ensure the parent node exists."""
        parent = self.leaves.get(parent_leaf_id)
        if parent is None:
            raise TreeValidationError(
                f"Parent leaf '{parent_leaf_id}' does not exist. "
                f"Available: {list(self.leaves.keys())}"
            )
        return parent

    def _validate_no_cycle(self, new_id: str, parent_leaf_id: str) -> None:
        """Ensure adding this edge wouldn't create a cycle."""
        visited: Set[str] = set()
        current = parent_leaf_id
        while current is not None:
            if current == new_id:
                raise TreeValidationError(
                    f"Cycle detected: adding {new_id} under {parent_leaf_id} "
                    f"would create a loop"
                )
            if current in visited:
                break  # already a cycle in existing tree (shouldn't happen)
            visited.add(current)
            leaf = self.leaves.get(current)
            current = leaf.parent_leaf if leaf else None

    def validate_integrity(self) -> List[str]:
        """
        Full integrity check of the tree. Returns a list of issues found.
        Call this after import/deserialization.
        """
        issues: List[str] = []

        for leaf_id, leaf in self.leaves.items():
            # ID consistency
            if leaf.id != leaf_id:
                issues.append(f"{leaf_id}: id field mismatch (leaf.id={leaf.id})")

            # Parent reference validity
            if leaf.parent_leaf is not None and leaf.parent_leaf not in self.leaves:
                issues.append(f"{leaf_id}: parent '{leaf.parent_leaf}' does not exist")

            # Children reference validity
            for child_id in leaf.child_leaves:
                if child_id not in self.leaves:
                    issues.append(f"{leaf_id}: child '{child_id}' does not exist")
                else:
                    child = self.leaves[child_id]
                    if child.parent_leaf != leaf_id:
                        issues.append(
                            f"{leaf_id}: child '{child_id}' has parent='{child.parent_leaf}', "
                            f"expected '{leaf_id}'"
                        )

        # Check for orphans (non-root nodes with no valid parent)
        for leaf_id, leaf in self.leaves.items():
            if leaf_id == "leaf_0":
                continue
            if leaf.parent_leaf is None:
                issues.append(f"{leaf_id}: orphan node (no parent, not root)")

        # Check root exists
        if "leaf_0" not in self.leaves:
            issues.append("Missing root node 'leaf_0'")

        return issues

    def repair_integrity(self) -> List[str]:
        """
        Attempt to fix structural issues. Returns list of repairs made.
        """
        repairs: List[str] = []

        for leaf_id, leaf in list(self.leaves.items()):
            # Fix id mismatch
            if leaf.id != leaf_id:
                leaf.id = leaf_id
                repairs.append(f"Fixed id mismatch for {leaf_id}")

            # Remove references to non-existent children
            valid_children = [c for c in leaf.child_leaves if c in self.leaves]
            if len(valid_children) != len(leaf.child_leaves):
                removed = set(leaf.child_leaves) - set(valid_children)
                leaf.child_leaves = valid_children
                repairs.append(f"{leaf_id}: removed dead child refs {removed}")

            # Fix broken parent refs → attach orphans to root
            if leaf.parent_leaf is not None and leaf.parent_leaf not in self.leaves:
                old_parent = leaf.parent_leaf
                leaf.parent_leaf = "leaf_0"
                if leaf_id not in self.leaves["leaf_0"].child_leaves:
                    self.leaves["leaf_0"].child_leaves.append(leaf_id)
                repairs.append(f"{leaf_id}: re-parented from missing '{old_parent}' to root")

            # Fix parent-child bidirectional consistency
            if leaf.parent_leaf and leaf.parent_leaf in self.leaves:
                parent = self.leaves[leaf.parent_leaf]
                if leaf_id not in parent.child_leaves:
                    parent.child_leaves.append(leaf_id)
                    repairs.append(f"{leaf_id}: added to parent '{leaf.parent_leaf}' child list")

        return repairs

    # ── Core operations ──────────────────────────────────

    def __len__(self) -> int:
        return len(self.leaves)

    def add_leaf(
        self,
        description: str,
        parent_leaf: str,
        tool_calls: List[ToolCall],
        result: str,
    ) -> str:
        """
        Add a new leaf with full validation and budget checks.
        Returns the new leaf ID.
        """
        # Validate
        self.check_budget(parent_leaf_id=parent_leaf)
        parent = self._validate_parent_exists(parent_leaf)

        # Generate unique ID
        leaf_number = len(self.leaves)
        new_id = f"leaf_{leaf_number}"
        while new_id in self.leaves:
            leaf_number += 1
            new_id = f"leaf_{leaf_number}"

        self._validate_no_cycle(new_id, parent_leaf)

        # Create leaf
        new_leaf = Leaf(
            id=new_id,
            description=description,
            parent_leaf=parent_leaf,
            tool_calls=tool_calls,
            child_leaves=[],
            result=result,
        )
        self.leaves[new_id] = new_leaf
        parent.child_leaves.append(new_id)

        # Track tool calls
        self.register_tool_calls(len(tool_calls))

        return new_id

    def get_branch_depth(self, leaf_id: str) -> int:
        """Return the depth (number of edges) between the root and the leaf."""
        depth = 0
        cur = self.leaves.get(leaf_id)
        while cur and cur.parent_leaf is not None:
            depth += 1
            cur = self.leaves.get(cur.parent_leaf)
            if depth > self.budget.max_total_nodes:
                # Safety break for corrupt trees
                break
        return depth

    def get_ancestors(self, leaf_id: str) -> List[str]:
        """Return ordered list of ancestor IDs from root to parent."""
        ancestors = []
        cur = self.leaves.get(leaf_id)
        while cur and cur.parent_leaf is not None:
            ancestors.append(cur.parent_leaf)
            cur = self.leaves.get(cur.parent_leaf)
            if len(ancestors) > self.budget.max_total_nodes:
                break
        ancestors.reverse()
        return ancestors

    def get_siblings(self, leaf_id: str) -> List[str]:
        """Return IDs of sibling leaves (same parent, excluding self)."""
        leaf = self.leaves.get(leaf_id)
        if not leaf or not leaf.parent_leaf:
            return []
        parent = self.leaves.get(leaf.parent_leaf)
        if not parent:
            return []
        return [c for c in parent.child_leaves if c != leaf_id]

    def get_last_leaves(self) -> List[Leaf]:
        """Return terminal (childless) leaves."""
        return [leaf for leaf in self.leaves.values() if not leaf.child_leaves]

    # ── Context building ─────────────────────────────────

    def get_leaf_context(self, leaf_id: str) -> str:
        """
        Build context for a leaf by walking up to the root.
        Includes knowledge base facts relevant to this branch.
        """
        if leaf_id not in self.leaves:
            return "Leaf not found."

        leaf = self.leaves[leaf_id]

        # Build ancestor chain context
        if leaf.parent_leaf is None:
            chain_context = str(leaf)
        else:
            parent_context = self.get_leaf_context(leaf.parent_leaf)
            chain_context = f"{parent_context}\n\n→ {str(leaf)}"

        # Inject relevant knowledge base facts
        kb_context = self.knowledge_base.get_context_for_step(
            leaf.description,
            max_facts=10,
            min_confidence=0.4,
        )

        if kb_context:
            return f"{chain_context.strip()}\n\n{kb_context}"
        return chain_context.strip()

    def get_reasoning_tree_context(self) -> str:
        """Full context from all terminal leaves."""
        return "\n\n====================\n\n".join(
            self.get_leaf_context(leaf.id)
            for leaf in self.get_last_leaves()
        )

    def get_structured_summary(self) -> Dict[str, Any]:
        """
        Return a structured summary of the tree for the final synthesis step.
        More useful than raw context for complex trees.
        """
        branches: List[Dict[str, Any]] = []
        for terminal in self.get_last_leaves():
            path: List[Dict[str, str]] = []
            current = terminal
            while current:
                path.append({
                    "id": current.id,
                    "description": current.description,
                    "result_summary": (current.result or "")[:500],
                })
                current = self.leaves.get(current.parent_leaf) if current.parent_leaf else None
            path.reverse()
            branches.append({
                "terminal_id": terminal.id,
                "depth": len(path),
                "steps": path,
            })

        return {
            "query": self.user_input,
            "total_nodes": len(self.leaves),
            "total_branches": len(branches),
            "knowledge_facts": len(self.knowledge_base),
            "branches": branches,
            "budget": self.budget_summary,
        }

    # ── Serialization ────────────────────────────────────

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schema_version": TREE_SCHEMA_VERSION,
            "user_input": self.user_input,
            "leaves": {lid: leaf.to_dict() for lid, leaf in self.leaves.items()},
            "knowledge_base": self.knowledge_base.to_dict(),
            "budget": self.budget.to_dict(),
            "stats": {
                "total_tool_calls": self._total_tool_calls,
                "elapsed_seconds": round(self.elapsed_seconds, 1),
            },
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ReasoningTree":
        """
        Reconstruct a tree from serialized data.
        Performs integrity validation and repairs if needed.
        """
        version = data.get("schema_version", 1)
        user_input = data.get("user_input", "")

        budget_data = data.get("budget", {})
        budget = TreeBudget(**{k: v for k, v in budget_data.items() if k in TreeBudget.__dataclass_fields__})

        tree = cls(user_input=user_input, budget=budget)

        # Clear the auto-created root — we'll rebuild from data
        tree.leaves.clear()

        leaves_data = data.get("leaves", {})
        for leaf_id, leaf_data in leaves_data.items():
            tool_calls = [
                ToolCall(
                    tool_name=tc.get("tool_name", ""),
                    args=tc.get("args", {}),
                    result=tc.get("result"),
                )
                for tc in leaf_data.get("tool_calls", [])
            ]
            leaf = Leaf(
                id=leaf_data.get("id", leaf_id),
                description=leaf_data.get("description", ""),
                result=leaf_data.get("result", ""),
                parent_leaf=leaf_data.get("parent_leaf"),
                child_leaves=leaf_data.get("child_leaves", []),
                tool_calls=tool_calls,
            )
            tree.leaves[leaf_id] = leaf

        # Restore knowledge base
        if "knowledge_base" in data and version >= 2:
            tree.knowledge_base = KnowledgeBase.from_dict(data["knowledge_base"])

        # Restore stats
        stats = data.get("stats", {})
        tree._total_tool_calls = stats.get("total_tool_calls", 0)

        # Validate and repair
        issues = tree.validate_integrity()
        if issues:
            repairs = tree.repair_integrity()
            # Log but don't crash
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(f"Tree integrity issues found: {issues}")
            logger.info(f"Repairs applied: {repairs}")

        return tree