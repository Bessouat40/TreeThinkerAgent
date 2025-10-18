from __future__ import annotations
from typing import Any, Callable, Optional, Type, TypeVar, Dict
from pydantic import BaseModel
from app.backend.core.llm import LLM

import json
import re

class JSONExtractError(ValueError):
    """Raised when no valid JSON object can be extracted from LLM output."""

def extract_json_str(
    text: str,
    *,
    require_braces: bool = False,
    max_scan_chars: int = 200_000,
) -> str:
    """
    Extract a JSON object string from an LLM response that may include markdown
    code fences or extra text.

    Strategy:
      1) Strip leading/trailing markdown fences if present (```json ... ```).
      2) If the remaining string parses as JSON → return it.
      3) Otherwise, search for the first '{ ... }' block and validate it.

    Args:
        text: Raw LLM response.
        require_braces: If True, enforce that the cleaned output starts with '{'
                        and ends with '}' (stricter mode).
        max_scan_chars: Safety cap for regex scanning.

    Returns:
        A JSON string representing a single JSON object.

    Raises:
        JSONExtractError: If no valid JSON object can be extracted.
    """
    s = text.strip()

    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\s*", "", s, count=1)
        s = re.sub(r"\s*```$", "", s, count=1).strip()

    if require_braces and not (s.startswith("{") and s.endswith("}")):
        pass

    try:
        json.loads(s)
        if not require_braces or (s.startswith("{") and s.endswith("}")):
            return s
    except json.JSONDecodeError:
        pass

    snippet = s[:max_scan_chars]
    m = re.search(r"\{[\s\S]*\}", snippet)
    if not m:
        raise JSONExtractError("No JSON object found in model output.")

    candidate = m.group(0)

    try:
        json.loads(candidate)
    except json.JSONDecodeError as e:
        raise JSONExtractError(f"Found a JSON-looking block but parsing failed: {e}") from e

    return candidate


ArgsModelT = TypeVar("ArgsModelT", bound=BaseModel)

def tool(name: str, args_model: Type[ArgsModelT], description: Optional[str] = None):
    """
    Decorator to declare a function as a tool callable by the agent.

    Usage:
        @tool("web_search", WebArgs, "Search the web")
        def web_search(args: WebArgs) -> dict: 
            ...

    The decorated function must accept a single Pydantic model instance (args)
    and return a JSON-serializable dict (the tool result).
    """
    def decorator(func: Callable[[ArgsModelT], Dict[str, Any]]):
        func.__tool_name__ = name
        func.__tool_args_model__ = args_model
        func.__tool_description__ = description
        return func
    return decorator
