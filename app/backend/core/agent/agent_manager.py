from app.backend.core.agent.llm import LLM
from app.backend.core.reasoningTree.reasoning_tree import ReasoningTree


class AgentManager:

    def __init__(self, user_input: str, llm: LLM):
        self.reasoning_tree = ReasoningTree(user_input)
        self.llm = llm

    def run(self):
        if len(self.reasoning_tree) == 1:
            context = self.reasoning_tree.get_reasoning_tree_context()
            self.plan(context, parent_leaf_id="leaf_0")
        else:
            self.plan_each_branch()

    def plan(self, context: str, current_leaf: str):
        prompt = f"""
        Tu es un assistant intelligent. Voici le contexte de raisonnement :
        Feuille courante : {current_leaf}
        {context}

        Quelle est la prochaine étape logique ?
        Réponds au format JSON avec description + éventuels tools à appeler.
        """

        response = self.llm.generate(prompt)
        print(f"[DEBUG] LLM response:\n{response}")

    def plan_each_branch(self):
        for leaf in self.reasoning_tree.get_last_leaves():
            context = self.reasoning_tree.get_leaf_context(leaf.id)
            self.plan(context, current_leaf=leaf.id)
