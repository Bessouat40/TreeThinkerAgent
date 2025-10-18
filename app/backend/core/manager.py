from __future__ import annotations
import json
from typing import Any, Dict, Optional, List, Set
from dataclasses import dataclass, field
import re

from app.backend.core.llm import LLM
from app.backend.core.tool import extract_json_str
from app.backend.core.retry import RetryPolicy, retry_call
import uuid

def _generate_node_id(existing_ids: Set[str]) -> str:
    while True:
        new_id = f"node_{str(uuid.uuid4())[:8]}"
        if new_id not in existing_ids:
            return new_id

@dataclass
class ToolNode:
    id: str
    name: str
    args: Dict[str, Any]
    depends_on: List[str] = field(default_factory=list)
    status: str = "pending"
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

@dataclass
class AgentState:
    nodes: Dict[str, ToolNode] = field(default_factory=dict)
    final: Optional[Dict[str, Any]] = None
    step: int = 0
    trace: List[Dict[str, Any]] = field(default_factory=list)

_PATH_SEG = re.compile(r"([^\[]+)(\[(\d+)\])?")

def _json_path_get(obj: Any, path: str) -> Any:
    cur = obj
    for part in re.split(r"\.(?![^\[]*\])", path):
        m = _PATH_SEG.match(part)
        if not m:
            raise KeyError(f"Bad path segment '{part}' in '{path}'")
        key = m.group(1)
        idx = m.group(3)
        cur = cur[key]
        if idx is not None:
            cur = cur[int(idx)]
    return cur

def _resolve_placeholders(value: Any, env: Dict[str, Any]) -> Any:
    if isinstance(value, str):
        pattern = r"\$\{node:([^.}]+)\.([^}]+)\}"
        def repl(m):
            nid, path = m.group(1), m.group(2)
            if nid not in env:
                raise KeyError(f"Missing node result for '{nid}'")
            return _json_path_get(env[nid], path)
        replaced = re.sub(pattern, lambda m: str(repl(m)), value)
        return replaced
    if isinstance(value, list):
        return [_resolve_placeholders(v, env) for v in value]
    if isinstance(value, dict):
        return {k: _resolve_placeholders(v, env) for k, v in value.items()}
    return value

@dataclass
class AgentManagerConfig:
    max_loops: int = 6
    llm_retry: RetryPolicy = field(default_factory=lambda: RetryPolicy(attempts=3, initial_backoff_s=0.4))
    tool_retry: RetryPolicy = field(default_factory=lambda: RetryPolicy(attempts=2, initial_backoff_s=0.2))

class AgentManager:
    def __init__(self, llm: LLM, config: Optional[AgentManagerConfig] = None):
        self.llm = llm
        self.cfg = config or AgentManagerConfig()

    def _plan(self, user_query: str, extra_context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        context_block = ""
        if extra_context:
            context_block = "\n\nContext (JSON):\n" + json.dumps(extra_context, ensure_ascii=False)
        prompt = f"{user_query}{context_block}"
        raw = retry_call(self.llm.generate, prompt, policy=self.cfg.llm_retry)
        clean = extract_json_str(raw)
        return json.loads(clean)

    def _validate_plan(self, plan: Dict[str, Any], state: AgentState) -> None:
        if not isinstance(plan, dict):
            raise ValueError("Plan is not a JSON object.")
        if "tool_calls" not in plan:
            raise ValueError("Plan missing 'tool_calls'.")

        valid_names = {t["name"] for t in self.llm.get_tools_spec()}
        for tc in plan["tool_calls"]:
            if tc["name"] not in valid_names:
                raise ValueError(f"Unknown tool '{tc['name']}' in plan.")

    def _execute_ready(self, state: AgentState) -> bool:
        progressed = False
        for n in state.nodes.values():
            if n.status == "pending":
                if any(state.nodes[d].status == "error" for d in n.depends_on):
                    n.status = "error"
                    n.error = "One or more dependencies failed."
                    progressed = True

        ready = [
            n for n in state.nodes.values()
            if n.status == "pending" and all(state.nodes[d].status == "done" for d in n.depends_on)
        ]
        for node in ready:
            node.status = "running"
            env = {nid: n.result for nid, n in state.nodes.items() if n.status == "done"}
            try:
                resolved_args = _resolve_placeholders(node.args, env)
                result = retry_call(self.llm.run_tool, node.name, resolved_args, policy=self.cfg.tool_retry)
                node.result = result
                node.status = "done"
                progressed = True
            except Exception as e:
                node.error = str(e)
                node.status = "error"
                progressed = True

        return progressed

    def _execute_stepwise_with_replan(self, user_query: str, state: AgentState, context: Dict[str, Any]) -> bool:
        progressed = False

        while True:
            ready = [
                n for n in state.nodes.values()
                if n.status == "pending" and all(state.nodes[d].status == "done" for d in n.depends_on)
            ]
            if not ready:
                break

            for node in ready:
                node.status = "running"
                env = {nid: n.result for nid, n in state.nodes.items() if n.status == "done"}
                try:
                    resolved_args = _resolve_placeholders(node.args, env)
                    result = retry_call(self.llm.run_tool, node.name, resolved_args, policy=self.cfg.tool_retry)
                    node.result = result
                    node.status = "done"
                    progressed = True

                    plan = self._plan(
                        user_query,
                        extra_context={
                            "node_results": {nid: n.result for nid, n in state.nodes.items() if n.result is not None},
                            **context,
                        },
                    )
                    self._validate_plan(plan, state)

                    id_remap = {}
                    for tc in plan.get("tool_calls", []):
                        old_id = tc["id"]
                        if old_id in state.nodes:
                            new_id = _generate_node_id(set(state.nodes.keys()) | set(id_remap.values()))
                            id_remap[old_id] = new_id
                        else:
                            id_remap[old_id] = old_id

                    for tc in plan.get("tool_calls", []):
                        new_id = id_remap[tc["id"]]
                        new_deps = [id_remap.get(dep, dep) for dep in tc.get("depends_on", [])]
                        if new_id not in state.nodes:
                            state.nodes[new_id] = ToolNode(
                                id=new_id,
                                name=tc["name"],
                                args=tc.get("args", {}),
                                depends_on=new_deps,
                            )

                    if plan.get("final") is not None:
                        state.final = plan["final"]
                        state.trace.append({"step": state.step, "event": "final-from-llm", "final": state.final})
                        return True

                except Exception as e:
                    node.error = str(e)
                    node.status = "error"
                    progressed = True

        return progressed

    def run(self, user_query: str, initial_context: Optional[Dict[str, Any]] = None) -> AgentState:
        state = AgentState()
        context = dict(initial_context or {})
        for step in range(self.cfg.max_loops):
            state.step = step

            plan = self._plan(
                user_query,
                extra_context={
                    "node_results": {nid: n.result for nid, n in state.nodes.items() if n.result is not None},
                    **context,
                },
            )
            self._validate_plan(plan, state)

            id_remap = {}
            for tc in plan.get("tool_calls", []):
                old_id = tc["id"]
                if old_id in state.nodes:
                    new_id = _generate_node_id(set(state.nodes.keys()) | set(id_remap.values()))
                    id_remap[old_id] = new_id
                else:
                    id_remap[old_id] = old_id

            for tc in plan.get("tool_calls", []):
                new_id = id_remap[tc["id"]]
                new_deps = [id_remap.get(dep, dep) for dep in tc.get("depends_on", [])]
                if new_id not in state.nodes:
                    state.nodes[new_id] = ToolNode(
                        id=new_id,
                        name=tc["name"],
                        args=tc.get("args", {}),
                        depends_on=new_deps,
                    )

            if plan.get("final") is not None and all(n.status in ("done", "error") for n in state.nodes.values()):
                state.final = plan["final"]
                state.trace.append({"step": step, "event": "final-from-llm", "final": state.final})
                break

            progressed = True
            while progressed:
                progressed = self._execute_stepwise_with_replan(user_query, state, context)

            state.trace.append({
                "step": step,
                "event": "executed",
                "node_status": {nid: n.status for nid, n in state.nodes.items()},
            })

            pending = any(n.status == "pending" for n in state.nodes.values())

            if not pending and plan.get("final") is None:
                tool_results = {nid: n.result for nid, n in state.nodes.items() if n.result is not None}
                final_prompt = (
                    "You planned and executed tools. "
                    "Based on the following tool results (JSON), return ONLY a JSON object of the form:\n"
                    '{ "final": { "answer": "..." } }\n'
                    "No markdown.\n\n"
                    f"{json.dumps(tool_results, ensure_ascii=False)}"
                )
                raw = retry_call(self.llm.generate, final_prompt, policy=self.cfg.llm_retry)
                clean = extract_json_str(raw)
                final_payload = json.loads(clean)
                if isinstance(final_payload, dict) and "final" in final_payload:
                    state.final = final_payload["final"]
                    state.trace.append({"step": step, "event": "finalized", "final": state.final})
                    break

            if not pending and state.final is None:
                continue

            if not pending and state.final is None:
                state.trace.append({"step": step, "event": "stalled"})
                break

        errors = {
            nid: {
                "tool": n.name,
                "args": n.args,
                "error": n.error
            }
            for nid, n in state.nodes.items() if n.status == "error"
        }
        if errors:
            state.trace.append({"step": state.step, "event": "summary-errors", "errors": errors})

        print(state)
        return state