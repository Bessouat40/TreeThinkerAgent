from __future__ import annotations

import os
from typing import Optional


from mistralai import Mistral

from app.backend.core.agent.llm import LLM
from app.backend.core.models.prompt import SYSTEM_PROMPT


class MistralLLM(LLM):
    def __init__(self, model_name: str):
        super().__init__(model_name)

    def init_client(self):
        """
        Initialize the Mistral API client using the API key from the environment.
        """
        api_key = os.getenv("MISTRAL_API_KEY")
        if not api_key:
            raise RuntimeError("MISTRAL_API_KEY is not set in the environment.")
        client = Mistral(api_key=api_key)
        return client

    def has_native_tool_calling(self) -> bool:
        """
        Return True if the provider natively supports tool/function calling.
        False here because we inject tools manually via the system prompt.
        """
        return False

    def generate(self, user_input: str, system_prompt: Optional[str] = None) -> str:
        """
        Send a message to the Mistral model and return the generated text
        (expected to be a JSON string that follows the Agent schema).
        """
        system_prompt = system_prompt or self._compose_system_prompt(SYSTEM_PROMPT)
        resp = self.client.chat.complete(
            model=self.model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_input},
            ],
        )
        return resp.choices[0].message.content
