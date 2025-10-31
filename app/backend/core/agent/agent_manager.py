import json
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, TypeAdapter
from app.backend.core.agent.llm import LLM
from app.backend.core.models.tool_calls import ToolCall
from app.backend.core.reasoningTree.reasoning_tree import ReasoningTree

import re

def strip_json_markdown(response: str) -> str:
    return re.sub(r"^```(?:json)?\n|\n```$", "", response.strip())

class PlannedStep(BaseModel):
    description: str
    tool_calls: List[Dict[str, Any]] = Field(default_factory=list)


class AgentManager:

    def __init__(self, user_input: str, llm: LLM):
        self.user_input = user_input
        self.reasoning_tree = ReasoningTree(user_input)
        self.llm = llm
        self.final_answer: Optional[str] = None

    def run(self) -> Dict[str, Any]:
        context = self.reasoning_tree.get_reasoning_tree_context()
        self.plan(context, parent_leaf_id="leaf_0")
        final_answer = self.finalize()
        return {
            "reasoning_tree": self.reasoning_tree.to_dict(),
            "final_answer": final_answer,
        }

    def plan(self, context: str, parent_leaf_id: str, max_branch_len: int = 5):
        response = self.llm.generate(context)
        cleaned = strip_json_markdown(response)
        try:
            data = json.loads(cleaned)
            steps = TypeAdapter(List[PlannedStep]).validate_python(data)
        except Exception:
            return
        if not steps:
            return

        for step in steps:
            tool_calls = [ToolCall(tool_name=tc['tool_name'], args=tc['args']) for tc in step.tool_calls]
            for call in tool_calls:
                call.result = self.llm.run_tool(call.tool_name, call.args)

            FILL_RESULT_PROMPT = """
            You are an autonomous reasoning agent.

            The listed tools have already been executed successfully. Using the prior context, the current reasoning step description, and the tool results, produce a concise and coherent outcome for this step.

            Respond with a short, informative paragraph only. Do not include JSON, code fences, or explanations of your process.
            """
            tool_results_text = "\n".join(f"{call.tool_name}: {call.result}" for call in tool_calls)

            user_input = f"""
            PREVIOUS CONTEXT:
            {context}

            STEP DESCRIPTION:
            {step.description}

            TOOL RESULTS:
            {tool_results_text}

            What conclusion or synthesis should be recorded for this step?
            """

            result = self.llm.generate(user_input=user_input.strip(), system_prompt=FILL_RESULT_PROMPT.strip())

            new_leaf_id = self.reasoning_tree.add_leaf(
                description=step.description,
                parent_leaf=parent_leaf_id,
                tool_calls=tool_calls,
                result=result
            )

            branch_depth = self.reasoning_tree.get_branch_depth(new_leaf_id)
            if branch_depth >= max_branch_len:
                continue

            enriched_context = self.reasoning_tree.get_leaf_context(new_leaf_id)
            self.plan(enriched_context, parent_leaf_id=new_leaf_id, max_branch_len=max_branch_len)

    def finalize(self) -> str:
        """Generate the final answer based on every terminal leaf."""
        leaves = self.reasoning_tree.get_reasoning_tree_context()

        FINAL_PROMPT = f"""
        You are a deep research agent responding to the user's original request: {self.user_input}.
        Use the reasoning tree summary below to craft a professional, well-structured final report.
        """

        final_answer = self.llm.generate(
            user_input=leaves,
            system_prompt=FINAL_PROMPT.strip()
        )

        self.reasoning_tree.add_leaf(
            description="Final answer",
            parent_leaf="leaf_0",
            tool_calls=[],
            result=final_answer
        )
        self.final_answer = final_answer
        return final_answer
