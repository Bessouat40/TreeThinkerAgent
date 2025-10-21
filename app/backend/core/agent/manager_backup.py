import json
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from app.backend.core.agent.llm import LLM
from app.backend.core.agent.tool import extract_json_str



def _generate_node_id() -> str:
    return f"node_{str(uuid.uuid4())[:8]}"


@dataclass
class ReasoningNode:
    id: str
    thought: str
    parent: Optional[str] = None
    children: List[str] = field(default_factory=list)
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    result: Optional[Dict[str, Any]] = None
    status: str = "pending"
    error: Optional[str] = None

    # Champs utiles au frontend
    name: Optional[str] = None
    args: Optional[Dict[str, Any]] = field(default_factory=dict)
    depends_on: Optional[List[str]] = field(default_factory=list)


@dataclass
class AgentState:
    nodes: Dict[str, ReasoningNode] = field(default_factory=dict)
    root: Optional[str] = None
    final: Optional[Dict[str, Any]] = None
    trace: List[Dict[str, Any]] = field(default_factory=list)


class AgentManager:
    def __init__(self, llm: LLM, max_depth: int = 6):
        self.llm = llm
        self.max_depth = max_depth
        self.state = AgentState()

    # ---------- CONTEXTE ----------
    def _build_context(self, node: Optional[ReasoningNode]) -> Dict[str, Any]:
        """Construit le contexte complet de la branche actuelle (de la racine au nœud courant)."""
        if not node:
            return {}
        branch = []
        current = node
        while current:
            branch.append({
                "thought": current.thought,
                "tool_calls": current.tool_calls,
                "result": current.result,
            })
            current = self.state.nodes.get(current.parent)
        branch.reverse()
        return {"reasoning_history": branch}

    # ---------- PLANIFICATION ----------
    def _plan(self, prompt: str, parent: Optional[ReasoningNode]) -> ReasoningNode:
        """Demande au LLM de planifier la prochaine étape de raisonnement."""
        context_json = self._build_context(parent)
        context_str = json.dumps(context_json, ensure_ascii=False, indent=2)

        full_prompt = f"""
        User request: {prompt}
        Context:
        {context_str}
        """

        raw = self.llm.generate(full_prompt)
        print("\nRAW OUTPUT:\n", raw)
        clean = extract_json_str(raw)
        plan = json.loads(clean)

        node = ReasoningNode(
            id=_generate_node_id(),
            thought=plan.get("thought", ""),
            parent=parent.id if parent else None,
            tool_calls=plan.get("tool_calls", []),
        )

        # Ajout du lien parent → enfant
        if parent:
            parent.children.append(node.id)
        else:
            self.state.root = node.id

        self.state.nodes[node.id] = node

        # Si le LLM a déjà donné une réponse finale
        if plan.get("final"):
            node.result = {"final": plan["final"]}
            node.status = "done"
            self.state.final = plan["final"]

        return node

    # ---------- EXÉCUTION RÉCURSIVE ----------
    def _execute_node(self, node: ReasoningNode, depth: int = 0):
        """Exécute un nœud et ses sous-étapes récursivement."""
        if depth > self.max_depth:
            node.error = "Max recursion depth reached"
            node.status = "error"
            return

        # Étape 1 — Exécuter les tools du nœud
        for call in node.tool_calls:
            try:
                result = self.llm.run_tool(call["name"], call["args"])
                call["result"] = result

                # Copie pour affichage frontend
                node.name = call["name"]
                node.args = call["args"]
                node.depends_on = call.get("depends_on", [])
                node.result = result
                node.status = "done"

            except Exception as e:
                call["error"] = str(e)
                node.error = str(e)
                node.status = "error"

        # Étape 2 — Planification récursive des sous-raisons
        if not node.error and (not node.result or "final" not in node.result):
            # On demande au LLM de continuer le raisonnement à partir de ce nœud
            next_plan = self._plan(
                prompt=node.result.get("text") if node.result else node.thought,
                parent=node,
            )

            # Exécuter récursivement le nœud suivant
            self._execute_node(next_plan, depth + 1)

            # Si plusieurs sous-étapes sont planifiées (branches parallèles)
            for subcall in next_plan.tool_calls:
                if subcall.get("name") and subcall.get("args") is not None:
                    sub_prompt = f"Continue reasoning for: {subcall['name']}"
                    child = self._plan(sub_prompt, parent=next_plan)
                    self._execute_node(child, depth + 1)

    # ---------- PIPELINE PRINCIPAL ----------
    def run(self, user_query: str) -> AgentState:
        root = self._plan(user_query, parent=None)
        self._execute_node(root)

        self.state.final = self._summarize_all_finals()

        self.state.trace.append({"event": "completed", "final": self.state.final})
        return self.state


    # ---------- SYNTHÈSE DES RÉPONSES ----------
    def _aggregate_all_finals(self) -> Optional[Dict[str, Any]]:
        """Concatène toutes les réponses finales des branches."""
        answers = []
        for node in self.state.nodes.values():
            if node.result and "final" in node.result:
                answers.append(node.result["final"]["answer"])
        if not answers:
            return None
        return {"answer": "\n\n".join(answers)}

    def _summarize_all_finals(self) -> Optional[Dict[str, Any]]:
        """Synthétise toutes les réponses finales via le LLM."""
        answers = []
        for node in self.state.nodes.values():
            if node.result and "final" in node.result:
                answers.append(f"- {node.result['final']['answer']}")
        if not answers:
            return None
        prompt = (
            "You are a travel assistant. Below are several partial answers generated from parallel reasoning steps about a trip to Madrid:\n\n"
            + "\n".join(answers)
            + "\n\nSynthesize these elements into a single clear, structured, and easy-to-read response suitable for a non-technical user."
        )

        summary = self.llm.generate(prompt)
        return {"answer": summary.strip()}
