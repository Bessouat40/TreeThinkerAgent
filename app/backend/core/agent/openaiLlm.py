from __future__ import annotations

import os
from typing import Optional

from openai import OpenAI

from app.backend.core.agent.llm import LLM
from app.backend.core.models.prompt import SYSTEM_PROMPT


class OpenAILLM(LLM):
    def __init__(self, model_name: str, provider_url: Optional[str] = None, api_key: Optional[str] = None):
        super().__init__(model_name, provider_url=provider_url, api_key=api_key)

    def init_client(self):
        """
        Initialize the OpenAI API client using the provided API key (if any),
        otherwise fall back to the environment variable. If provider_url is set,
        use it as the base URL for the client.
        """
        api_key = self.api_key or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set in the environment or provided in the request.")

        client = OpenAI(
            api_key=api_key,
            base_url=self.provider_url if self.provider_url else "https://api.openai.com/v1"
        )
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
