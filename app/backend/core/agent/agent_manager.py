import json
from typing import Any, Dict, List
from pydantic import BaseModel, TypeAdapter
from app.backend.core.agent.llm import LLM
from app.backend.core.models.tool_calls import ToolCall
from app.backend.core.reasoningTree.reasoning_tree import ReasoningTree

import re

def strip_json_markdown(response: str) -> str:
    return re.sub(r"^```(?:json)?\n|\n```$", "", response.strip())

class PlannedStep(BaseModel):
    description: str
    tool_calls: List[Dict[str, Any]] = []


class AgentManager:

    def __init__(self, user_input: str, llm: LLM):
        self.user_input = user_input
        self.reasoning_tree = ReasoningTree(user_input)
        self.llm = llm

    def run(self):
        context = self.reasoning_tree.get_reasoning_tree_context()
        self.plan(context, parent_leaf_id="leaf_0")
        self.finalize()
        return self.reasoning_tree

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
            Tu es un agent de raisonnement autonome.

            Les outils ont été exécutés avec succès. À partir du contexte précédent, de la nouvelle étape de raisonnement, et des résultats des outils, complète l'étape avec un résumé ou une conclusion cohérente.

            Réponds uniquement par un texte clair, concis et informatif — ce sera utilisé comme champ `result` dans l’arbre de raisonnement.

            Ne mets pas de JSON, pas de balises, pas d’explication de ton raisonnement. Juste le texte final.
            """
            tool_results_text = "\n".join(f"{call.tool_name}: {call.result}" for call in tool_calls)

            user_input = f"""
            CONTEXTE PRÉCÉDENT :
            {context}

            DESCRIPTION DE L'ÉTAPE :
            {step.description}

            RÉSULTATS DES OUTILS :
            {tool_results_text}

            Que peux-tu conclure ou ajouter à cette étape ?
            """

            result = self.llm.generate(user_input=user_input.strip(), system_prompt=FILL_RESULT_PROMPT.strip())


            # ➜ on crée la feuille et on récupère son id
            new_leaf_id = self.reasoning_tree.add_leaf(
                description=step.description,
                parent_leaf=parent_leaf_id,
                tool_calls=tool_calls,
                result=result
            )

            # ➜ profondeur réelle de la branche (root→new_leaf_id)
            branch_depth = self.reasoning_tree.get_branch_depth(new_leaf_id)
            if branch_depth >= max_branch_len:
                # on coupe cette branche proprement
                continue

            # ➜ sinon, on descend sur CETTE branche uniquement
            enriched_context = self.reasoning_tree.get_leaf_context(new_leaf_id)
            self.plan(enriched_context, parent_leaf_id=new_leaf_id, max_branch_len=max_branch_len)

    def finalize(self) -> str:
        """Génère une réponse finale basée sur toutes les feuilles terminales."""
        leaves = self.reasoning_tree.get_reasoning_tree_context()

        FINAL_PROMPT = f"""
        Tu es un agent de deep research, répond à l'input utilisateur : {self.user_input}.
        Pour cela, utilise le résultat du raisonnement : {leaves}.
        Génère un rapport professionnel et structuré permettant à l'utilisateur d'avoir sa réponse.
        """

        final_answer = self.llm.generate(
            user_input=leaves,
            system_prompt=FINAL_PROMPT.strip()
        )

        self.reasoning_tree.add_leaf(
            description="Réponse finale",
            parent_leaf="leaf_0",
            tool_calls=[],
            result=final_answer
        )
