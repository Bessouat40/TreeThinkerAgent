from __future__ import annotations

import os
from typing import Optional

from openai import OpenAI

from app.backend.core.agent.llm import LLM
from app.backend.core.models.prompt import SYSTEM_PROMPT


class OpenAILLM(LLM):
    def __init__(self, model_name: str):
        super().__init__(model_name)

    def init_client(self):
        """
        Initialize the OpenAI API client using the API key from the environment.
        """
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set in the environment.")

        client = OpenAI(api_key=api_key)
        return client

    def has_native_tool_calling(self) -> bool:
        """
        Return True if the provider natively supports tool/function calling.
        False here because we inject tools manually via the system prompt.
        """
        return False

    def generate(self, user_input: str, system_prompt: Optional[str] = None) -> str:
        """
        Send a message to the OpenAI model and return the generated text
        (expected to be a JSON string that follows the Agent schema).
        """
        system_prompt = system_prompt or self._compose_system_prompt(SYSTEM_PROMPT)

        response = self.client.responses.create(
            model=self.model_name,
            instructions=system_prompt,
            input=user_input,
        )

        return response.output_text
