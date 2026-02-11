"""
Improved AgentManager with:
- Knowledge extraction after each step (feeds the shared KB)
- Retry with self-correction on JSON parse failures
- Budget-aware planning (agent sees remaining budget)
- Proper error propagation and logging
"""

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from pydantic import BaseModel, Field, TypeAdapter

from app.backend.core.agent.llm import LLM
from app.backend.core.models.tool_calls import ToolCall
from app.backend.core.reasoningTree.reasoning_tree import ReasoningTree, TreeBudget, BudgetExhausted
from app.backend.core.models.knowledge import (
    FACT_EXTRACTION_PROMPT,
    parse_extracted_facts,
)

logger = logging.getLogger(__name__)


def strip_json_markdown(response: str) -> str:
    return re.sub(r"^```(?:json)?\n|\n```$", "", response.strip())


class PlannedStep(BaseModel):
    description: str
    tool_calls: List[Dict[str, Any]] = Field(default_factory=list)


class AgentManager:

    MAX_PARSE_RETRIES = 2
    MAX_TOOL_RETRIES = 1

    def __init__(
        self,
        user_input: str,
        llm: LLM,
        budget: Optional[TreeBudget] = None,
    ):
        self.user_input = user_input
        self.reasoning_tree = ReasoningTree(user_input, budget=budget)
        self.llm = llm
        self.final_answer: Optional[str] = None

    # ── Helpers ──────────────────────────────────────────

    def _edge_count(self) -> int:
        return sum(len(leaf.child_leaves) for leaf in self.reasoning_tree.leaves.values())

    def _snapshot(self, latest_leaf_id: Optional[str] = None) -> Dict[str, Any]:
        tree_dict = self.reasoning_tree.to_dict()
        # Extract just the leaves dict for the reasoning_tree key (frontend expects leaf_id -> leaf)
        leaves_dict = tree_dict.get("leaves", {})

        payload: Dict[str, Any] = {
            "reasoning_tree": leaves_dict,
            "final_answer": self.final_answer,
            "knowledge_base": self.reasoning_tree.knowledge_base.to_dict(),
            "metadata": {
                "query": self.user_input,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "node_count": len(self.reasoning_tree.leaves),
                "edge_count": self._edge_count(),
                "budget": self.reasoning_tree.budget_summary,
                "knowledge_facts": len(self.reasoning_tree.knowledge_base),
            },
        }
        if latest_leaf_id and latest_leaf_id in self.reasoning_tree.leaves:
            payload["latest_leaf_id"] = latest_leaf_id
            payload["latest_leaf"] = self.reasoning_tree.leaves[latest_leaf_id].to_dict()
        return payload

    def _emit_update(
        self,
        on_update: Optional[Callable[[Dict[str, Any]], None]],
        latest_leaf_id: Optional[str] = None,
    ) -> None:
        if callable(on_update):
            try:
                on_update(self._snapshot(latest_leaf_id=latest_leaf_id))
            except Exception:
                logger.exception("on_update callback failed")

    # ── JSON parsing with retry ──────────────────────────

    def _parse_plan_response(self, response: str, context: str) -> List[PlannedStep]:
        """
        Parse the LLM planning response into steps.
        Retries with self-correction if parsing fails.
        """
        last_error = None

        for attempt in range(1 + self.MAX_PARSE_RETRIES):
            cleaned = strip_json_markdown(response)
            try:
                data = json.loads(cleaned)
                return TypeAdapter(List[PlannedStep]).validate_python(data)
            except Exception as e:
                last_error = e
                if attempt < self.MAX_PARSE_RETRIES:
                    logger.warning(
                        f"Plan parse failed (attempt {attempt + 1}): {e}. "
                        f"Asking LLM to fix..."
                    )
                    correction_prompt = (
                        "Your previous response was not valid JSON. "
                        f"The error was: {e}\n\n"
                        f"Your response was:\n{response[:2000]}\n\n"
                        "Please return ONLY a valid JSON array of planning steps. "
                        "No markdown, no explanation, just the JSON array."
                    )
                    response = self.llm.generate(
                        user_input=correction_prompt,
                        system_prompt=(
                            "You must fix your previous JSON output. "
                            "Return ONLY a valid JSON array."
                        ),
                    )

        logger.error(f"Plan parse failed after {self.MAX_PARSE_RETRIES + 1} attempts: {last_error}")
        return []

    # ── Tool execution with retry ────────────────────────

    def _execute_tool_call(self, call: ToolCall) -> Any:
        """Execute a single tool call with retry on failure."""
        for attempt in range(1 + self.MAX_TOOL_RETRIES):
            try:
                result = self.llm.run_tool(call.tool_name, call.args)
                return result
            except Exception as e:
                if attempt < self.MAX_TOOL_RETRIES:
                    logger.warning(
                        f"Tool '{call.tool_name}' failed (attempt {attempt + 1}): {e}. Retrying..."
                    )
                else:
                    logger.error(f"Tool '{call.tool_name}' failed permanently: {e}")
                    return {"error": str(e), "tool": call.tool_name}

    # ── Knowledge extraction ─────────────────────────────

    def _extract_and_store_knowledge(
        self,
        leaf_id: str,
        description: str,
        result: str,
    ) -> int:
        """
        Ask the LLM to extract key facts from a step's result,
        then store them in the shared knowledge base.
        Returns the number of facts extracted.
        """
        if not result or len(result.strip()) < 20:
            return 0

        user_input = (
            f"Step description: {description}\n\n"
            f"Step result:\n{result[:3000]}"
        )

        try:
            raw = self.llm.generate(
                user_input=user_input,
                system_prompt=FACT_EXTRACTION_PROMPT.strip(),
            )
            facts = parse_extracted_facts(raw, source_leaf_id=leaf_id)
            self.reasoning_tree.knowledge_base.add_facts_bulk(facts)
            logger.info(f"Extracted {len(facts)} facts from {leaf_id}")
            return len(facts)
        except Exception:
            logger.exception(f"Fact extraction failed for {leaf_id}")
            return 0

    # ── Context building ─────────────────────────────────

    def _build_planning_context(self, base_context: str) -> str:
        """
        Enrich the base context with budget info and KB summary.
        This lets the agent make informed decisions about how deep to go.
        """
        budget = self.reasoning_tree.budget_summary
        budget_line = (
            f"\n\n## Budget Status\n"
            f"- Nodes: {budget['nodes_used']}/{budget['nodes_max']}\n"
            f"- Tool calls: {budget['tool_calls_used']}/{budget['tool_calls_max']}\n"
            f"- Time: {budget['elapsed_seconds']}s / {budget['timeout_seconds']}s\n"
            f"Plan efficiently. If budget is tight, prefer fewer, higher-impact steps."
        )
        return base_context + budget_line

    # ── Main loop ────────────────────────────────────────

    def run(
        self,
        on_update: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        context = self.reasoning_tree.get_reasoning_tree_context()
        try:
            self.plan(context, parent_leaf_id="leaf_0", on_update=on_update)
        except BudgetExhausted as e:
            logger.warning(f"Budget exhausted during planning: {e}")
        self.finalize(on_update=on_update)
        return self._snapshot()

    def plan(
        self,
        context: str,
        parent_leaf_id: str,
        max_branch_len: int = 5,
        on_update: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> None:
        # Budget check before even calling the LLM
        try:
            self.reasoning_tree.check_budget(parent_leaf_id=parent_leaf_id)
        except BudgetExhausted as e:
            logger.info(f"Skipping plan for {parent_leaf_id}: {e}")
            return

        enriched_context = self._build_planning_context(context)
        response = self.llm.generate(enriched_context)
        steps = self._parse_plan_response(response, context)

        if not steps:
            return

        for step in steps:
            # Budget check before each step
            try:
                self.reasoning_tree.check_budget(parent_leaf_id=parent_leaf_id)
            except BudgetExhausted as e:
                logger.info(f"Budget exhausted mid-plan: {e}")
                return

            # Execute tool calls
            tool_calls = [
                ToolCall(tool_name=tc["tool_name"], args=tc["args"])
                for tc in step.tool_calls
                if "tool_name" in tc and "args" in tc
            ]

            try:
                self.reasoning_tree.check_tool_budget(len(tool_calls))
            except BudgetExhausted:
                logger.info("Tool call budget exhausted, skipping tools for this step")
                tool_calls = []

            for call in tool_calls:
                call.result = self._execute_tool_call(call)

            # Synthesize step result
            result = self._synthesize_step_result(context, step.description, tool_calls)

            # Add to tree
            try:
                new_leaf_id = self.reasoning_tree.add_leaf(
                    description=step.description,
                    parent_leaf=parent_leaf_id,
                    tool_calls=tool_calls,
                    result=result,
                )
            except Exception as e:
                logger.error(f"Failed to add leaf: {e}")
                continue

            self._emit_update(on_update, latest_leaf_id=new_leaf_id)

            # Extract knowledge from this step's result
            self._extract_and_store_knowledge(new_leaf_id, step.description, result)

            # Recurse if depth allows
            branch_depth = self.reasoning_tree.get_branch_depth(new_leaf_id)
            if branch_depth >= max_branch_len:
                continue

            child_context = self.reasoning_tree.get_leaf_context(new_leaf_id)
            self.plan(
                child_context,
                parent_leaf_id=new_leaf_id,
                max_branch_len=max_branch_len,
                on_update=on_update,
            )

    def _synthesize_step_result(
        self,
        context: str,
        description: str,
        tool_calls: List[ToolCall],
    ) -> str:
        """Generate a concise result for a reasoning step."""
        FILL_RESULT_PROMPT = (
            "You are an autonomous reasoning agent. "
            "The listed tools have already been executed successfully. "
            "Using the prior context, the current reasoning step description, "
            "and the tool results, produce a concise and coherent outcome for this step.\n\n"
            "Respond with a short, informative paragraph only. "
            "Do not include JSON, code fences, or explanations of your process."
        )

        tool_results_text = "\n".join(
            f"{call.tool_name}: {call.result}" for call in tool_calls
        ) or "(no tools were called)"

        # Include relevant KB facts in the synthesis context
        kb_context = self.reasoning_tree.knowledge_base.get_context_for_step(
            description, max_facts=8
        )

        user_input = (
            f"PREVIOUS CONTEXT:\n{context}\n\n"
            f"STEP DESCRIPTION:\n{description}\n\n"
            f"TOOL RESULTS:\n{tool_results_text}"
        )
        if kb_context:
            user_input += f"\n\n{kb_context}"
        user_input += "\n\nWhat conclusion or synthesis should be recorded for this step?"

        return self.llm.generate(
            user_input=user_input.strip(),
            system_prompt=FILL_RESULT_PROMPT,
        )

    def finalize(
        self,
        on_update: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> str:
        """Generate the final answer using the structured tree summary + KB."""
        summary = self.reasoning_tree.get_structured_summary()
        leaves_context = self.reasoning_tree.get_reasoning_tree_context()

        # Include top KB facts in the final synthesis
        all_facts = self.reasoning_tree.knowledge_base.get_all_facts()
        facts_text = ""
        if all_facts:
            top_facts = [f for f in all_facts if f.confidence >= 0.5][:25]
            facts_text = "\n\n## Key Facts Discovered\n" + "\n".join(
                f"- {f}" for f in top_facts
            )

        FINAL_PROMPT = (
            f"You are a deep research agent responding to: {self.user_input}\n\n"
            "Use the reasoning tree summary and discovered facts below to craft "
            "a professional, well-structured final report.\n"
            "Cite specific findings from the reasoning steps where relevant."
        )

        final_input = (
            f"## Reasoning Tree\n{leaves_context}"
            f"{facts_text}\n\n"
            f"## Tree Statistics\n"
            f"- Branches explored: {summary['total_branches']}\n"
            f"- Total steps: {summary['total_nodes']}\n"
            f"- Facts discovered: {summary['knowledge_facts']}"
        )

        final_answer = self.llm.generate(
            user_input=final_input,
            system_prompt=FINAL_PROMPT.strip(),
        )

        final_leaf_id = self.reasoning_tree.add_leaf(
            description="Final answer",
            parent_leaf="leaf_0",
            tool_calls=[],
            result=final_answer,
        )
        self.final_answer = final_answer
        self._emit_update(on_update, latest_leaf_id=final_leaf_id)
        return final_answer