from dataclasses import dataclass, field
from typing import Any, Dict

@dataclass
class ToolCall:
    tool_name: str
    args: Dict[str, Any] = field(default_factory=dict)
    result: str = ""

    def __str__(self) -> str:
        args_lines = "\n".join(f"  - {k}: {v}" for k, v in self.args.items()) or "  - No arguments"
        result_line = self.result.strip() or "No result"

        return (
            f"Tool used: {self.tool_name}\n"
            f"Arguments:\n{args_lines}\n"
            f"Result:\n{result_line}\n"
        )
