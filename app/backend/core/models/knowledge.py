"""
Shared Knowledge Base for the Reasoning Tree.

Provides a structured fact store that all nodes can read from and write to,
enabling cross-branch knowledge sharing and preventing redundant work.
"""

import json
import re
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set


class FactType(str, Enum):
    """Categories of facts for filtering and relevance scoring."""
    NUMERIC = "numeric"       # prices, dates, quantities
    ENTITY = "entity"         # names, places, organizations
    FINDING = "finding"       # research conclusions
    CONSTRAINT = "constraint" # user requirements, limits
    URL = "url"               # discovered useful URLs
    SUMMARY = "summary"       # condensed info from a source


@dataclass
class Fact:
    """A single piece of knowledge extracted from a reasoning step."""
    key: str
    value: Any
    fact_type: FactType
    source_leaf_id: str
    confidence: float = 1.0       # 0.0 to 1.0
    tags: Set[str] = field(default_factory=set)
    timestamp: float = field(default_factory=time.time)
    supersedes: Optional[str] = None  # key of a fact this one replaces

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "value": self.value,
            "fact_type": self.fact_type.value,
            "source_leaf_id": self.source_leaf_id,
            "confidence": self.confidence,
            "tags": sorted(self.tags),
            "timestamp": self.timestamp,
            "supersedes": self.supersedes,
        }

    def __str__(self) -> str:
        return f"[{self.fact_type.value}] {self.key}: {self.value} (confidence={self.confidence:.1f}, source={self.source_leaf_id})"


class KnowledgeBase:
    """
    Shared knowledge store for the reasoning tree.

    Design principles:
    - Facts are append-mostly: new facts can supersede old ones but nothing is deleted.
    - Every fact is traceable to a source leaf.
    - Retrieval supports filtering by type, tags, and relevance to a query.
    - The KB can be serialized/deserialized alongside the reasoning tree.
    """

    def __init__(self) -> None:
        self._facts: Dict[str, Fact] = {}
        self._tag_index: Dict[str, Set[str]] = {}  # tag -> set of fact keys
        self._source_index: Dict[str, Set[str]] = {}  # leaf_id -> set of fact keys

    def __len__(self) -> int:
        return len(self._facts)

    def add_fact(self, fact: Fact) -> str:
        """
        Add a fact to the knowledge base.

        If the fact supersedes another, the old fact's confidence is reduced
        but it remains in the store for traceability.
        """
        if fact.supersedes and fact.supersedes in self._facts:
            old = self._facts[fact.supersedes]
            old.confidence *= 0.3  # demote but keep for history

        self._facts[fact.key] = fact

        # Update tag index
        for tag in fact.tags:
            if tag not in self._tag_index:
                self._tag_index[tag] = set()
            self._tag_index[tag].add(fact.key)

        # Update source index
        src = fact.source_leaf_id
        if src not in self._source_index:
            self._source_index[src] = set()
        self._source_index[src].add(fact.key)

        return fact.key

    def add_facts_bulk(self, facts: List[Fact]) -> List[str]:
        """Add multiple facts at once."""
        return [self.add_fact(f) for f in facts]

    def get_fact(self, key: str) -> Optional[Fact]:
        return self._facts.get(key)

    def get_all_facts(self) -> List[Fact]:
        """Return all facts sorted by timestamp (newest first)."""
        return sorted(self._facts.values(), key=lambda f: f.timestamp, reverse=True)

    def get_facts_by_type(self, fact_type: FactType) -> List[Fact]:
        return [f for f in self._facts.values() if f.fact_type == fact_type]

    def get_facts_by_tag(self, tag: str) -> List[Fact]:
        keys = self._tag_index.get(tag, set())
        return [self._facts[k] for k in keys if k in self._facts]

    def get_facts_by_source(self, leaf_id: str) -> List[Fact]:
        keys = self._source_index.get(leaf_id, set())
        return [self._facts[k] for k in keys if k in self._facts]

    def search_facts(
        self,
        query: str,
        fact_types: Optional[List[FactType]] = None,
        min_confidence: float = 0.3,
        max_results: int = 20,
    ) -> List[Fact]:
        """
        Simple keyword-based search across fact keys, values, and tags.
        Returns facts sorted by relevance (keyword overlap + confidence).
        """
        query_tokens = set(query.lower().split())
        if not query_tokens:
            return []

        scored: List[tuple] = []
        for fact in self._facts.values():
            if fact.confidence < min_confidence:
                continue
            if fact_types and fact.fact_type not in fact_types:
                continue

            # Build searchable text from fact
            searchable = f"{fact.key} {fact.value} {' '.join(fact.tags)}".lower()
            search_tokens = set(searchable.split())

            overlap = len(query_tokens & search_tokens)
            if overlap == 0:
                continue

            # Score = token overlap ratio * confidence
            relevance = (overlap / len(query_tokens)) * fact.confidence
            scored.append((relevance, fact))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [f for _, f in scored[:max_results]]

    def get_context_for_step(
        self,
        step_description: str,
        max_facts: int = 15,
        min_confidence: float = 0.4,
    ) -> str:
        """
        Build a concise knowledge context string to inject into the LLM prompt
        for a new reasoning step.

        Combines:
        1. High-confidence facts matching the step description
        2. Recent constraints and findings (always relevant)
        """
        # Always include constraints (user requirements)
        constraints = [
            f for f in self.get_facts_by_type(FactType.CONSTRAINT)
            if f.confidence >= min_confidence
        ]

        # Search for relevant facts
        relevant = self.search_facts(
            step_description,
            min_confidence=min_confidence,
            max_results=max_facts,
        )

        # Merge, deduplicate, limit
        seen_keys: Set[str] = set()
        merged: List[Fact] = []
        for fact in constraints + relevant:
            if fact.key not in seen_keys:
                seen_keys.add(fact.key)
                merged.append(fact)

        merged = merged[:max_facts]

        if not merged:
            return ""

        lines = ["## Known Facts (from previous reasoning steps)"]
        for fact in merged:
            lines.append(f"- {fact}")
        lines.append("")
        lines.append(
            "Use these facts to avoid redundant research and ensure consistency. "
            "If any fact seems outdated or contradicted by new findings, note it explicitly."
        )
        return "\n".join(lines)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "facts": {k: v.to_dict() for k, v in self._facts.items()},
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "KnowledgeBase":
        kb = cls()
        for key, fact_data in data.get("facts", {}).items():
            fact = Fact(
                key=fact_data["key"],
                value=fact_data["value"],
                fact_type=FactType(fact_data["fact_type"]),
                source_leaf_id=fact_data["source_leaf_id"],
                confidence=fact_data.get("confidence", 1.0),
                tags=set(fact_data.get("tags", [])),
                timestamp=fact_data.get("timestamp", time.time()),
                supersedes=fact_data.get("supersedes"),
            )
            kb.add_fact(fact)
        return kb


# ─────────────────────────────────────────────────────────
# Fact extraction prompt and parser
# ─────────────────────────────────────────────────────────

FACT_EXTRACTION_PROMPT = """
You are a fact extraction engine. Given a reasoning step description and its result,
extract the key facts as a JSON array.

Each fact must have:
- "key": short unique identifier (snake_case, e.g. "flight_price_paris_madrid")
- "value": the actual information (string or number)
- "fact_type": one of "numeric", "entity", "finding", "constraint", "url", "summary"
- "tags": list of relevant keywords for searchability
- "confidence": float 0.0-1.0 (how certain is this fact?)

Rules:
- Extract 0 to 8 facts. Only extract genuinely useful, reusable information.
- Prefer specific, concrete facts over vague summaries.
- If the result contains URLs that were useful, extract them as "url" type facts.
- If the result contradicts a known fact, note it with confidence < 0.5.
- Return ONLY a JSON array, no other text.

Example output:
[
  {"key": "cheapest_flight_paris_madrid", "value": "90 EUR with Vueling", "fact_type": "numeric", "tags": ["flight", "paris", "madrid", "price"], "confidence": 0.9},
  {"key": "madrid_avg_hotel_price", "value": "85-120 EUR per night", "fact_type": "numeric", "tags": ["hotel", "madrid", "price"], "confidence": 0.7}
]
"""


def parse_extracted_facts(
    raw_response: str,
    source_leaf_id: str,
) -> List[Fact]:
    """
    Parse the LLM's fact extraction response into Fact objects.
    Tolerant of malformed output — returns whatever could be parsed.
    """
    # Strip markdown fences
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw_response.strip())
    cleaned = re.sub(r"\s*```$", "", cleaned).strip()

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        # Try to find a JSON array in the response
        match = re.search(r"\[[\s\S]*\]", cleaned)
        if not match:
            return []
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return []

    if not isinstance(data, list):
        return []

    facts: List[Fact] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        try:
            fact = Fact(
                key=str(item.get("key", "")).strip(),
                value=item.get("value", ""),
                fact_type=FactType(item.get("fact_type", "finding")),
                source_leaf_id=source_leaf_id,
                confidence=float(item.get("confidence", 0.8)),
                tags=set(item.get("tags", [])),
            )
            if fact.key:  # skip facts without a key
                facts.append(fact)
        except (ValueError, KeyError):
            continue

    return facts