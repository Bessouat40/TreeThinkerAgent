from __future__ import annotations

from typing import Optional
from ollama import chat, ChatResponse

from app.backend.core.agent.llm import LLM
from app.backend.core.models.prompt import SYSTEM_PROMPT


class OllamaLLM(LLM):
    def __init__(self, model_name: str):
        super().__init__(model_name)

    def init_client(self):
        """
        Ollama doesn't require explicit client initialization.
        Just ensure the local Ollama server is running.
        """
        return None

    def has_native_tool_calling(self) -> bool:
        """
        Ollama does not yet support native function/tool calling.
        We inject tools manually through the prompt.
        """
        return False

    def generate(self, user_input: str, system_prompt: Optional[str] = None) -> str:
        """
        Sends a message to the Ollama model using the official Python API
        and returns the full generated text.
        """
        system_prompt = system_prompt or self._compose_system_prompt(SYSTEM_PROMPT)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_input},
        ]

        try:
            response: ChatResponse = chat(
                model=self.model_name,
                messages=messages,
            )
            return response["message"]["content"].strip()
        except Exception as e:
            raise RuntimeError(f"Ollama generation failed: {e}")
