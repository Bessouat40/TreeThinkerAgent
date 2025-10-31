import json
from dataclasses import dataclass, field
from typing import Any, Dict

@dataclass
class ToolCall:
    tool_name: str
    args: Dict[str, Any] = field(default_factory=dict)
    result: Any = None

    def __str__(self) -> str:
        args_lines = "\n".join(f"  - {k}: {v}" for k, v in self.args.items()) or "  - No arguments"
        if isinstance(self.result, str):
            result_text = self.result.strip() or "No result"
        else:
            result_text = json.dumps(self.result, ensure_ascii=False, indent=2)

        return (
            f"Tool used: {self.tool_name}\n"
            f"Arguments:\n{args_lines}\n"
            f"Result:\n{result_text}\n"
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "tool_name": self.tool_name,
            "args": self.args,
            "result": self.result,
        }

