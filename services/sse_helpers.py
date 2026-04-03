import asyncio
import json
from datetime import datetime
from typing import AsyncGenerator


def ts() -> str:
    return datetime.now().strftime("%H:%M:%S")


def sse_event(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def log_event(level: str, message: str) -> str:
    return sse_event({"type": "log", "level": level, "message": message, "ts": ts()})


def progress_event(current: int, total: int) -> str:
    return sse_event({"type": "progress", "current": current, "total": total})


def result_event(data: dict) -> str:
    return sse_event({"type": "result", "data": data})


def done_event(status: str) -> str:
    return sse_event({"type": "done", "status": status})


def case_event(data: dict) -> str:
    return sse_event({"type": "case", "data": data})


class LogCollector:
    """SSE 로그를 수집하여 나중에 DB에 저장할 수 있도록 한다."""

    def __init__(self):
        self.logs: list[str] = []

    def log(self, level: str, message: str) -> str:
        """log_event()와 동일한 SSE 문자열을 반환하면서 내부에 텍스트 저장."""
        event = log_event(level, message)
        self.logs.append(f"[{ts()}] [{level}] {message}")
        return event

    def get_text(self) -> str:
        return "\n".join(self.logs)
