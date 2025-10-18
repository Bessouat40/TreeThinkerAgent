from __future__ import annotations
import random
import time
from dataclasses import dataclass
from typing import Callable, Type, Tuple, Any

@dataclass
class RetryPolicy:
    attempts: int = 3
    initial_backoff_s: float = 0.25
    max_backoff_s: float = 4.0
    multiplier: float = 2.0
    jitter: bool = True
    retry_on: Tuple[Type[BaseException], ...] = (Exception,)

def retry_call(fn: Callable, *args, policy: RetryPolicy, **kwargs) -> Any:
    """
    Execute fn with retries on specified exceptions using exponential backoff.
    """
    backoff = policy.initial_backoff_s
    last_exc = None
    for i in range(policy.attempts):
        try:
            return fn(*args, **kwargs)
        except policy.retry_on as e:
            last_exc = e
            if i == policy.attempts - 1:
                break
            sleep_s = backoff
            if policy.jitter:
                sleep_s = min(policy.max_backoff_s, backoff) * random.uniform(0.7, 1.3)
            time.sleep(sleep_s)
            backoff = min(policy.max_backoff_s, backoff * policy.multiplier)
    raise last_exc
