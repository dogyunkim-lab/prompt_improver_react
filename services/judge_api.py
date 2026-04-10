"""LLM Judge API 클라이언트 모듈.

Judge API 사양 (api_explain.md 기준):
  POST {JUDGE_API_URL}
  body: {
    input_file: 절대 경로 (xlsx, 'id','stt','generated','reference','keywords' 컬럼 필수)
    generation_task: 8개 enum 중 하나
    output_dir: 절대 경로 (해당 폴더에 merged_final.json 생성됨)
    generated_header: 기본 'generated'
    model: 기본 'gpt-oss-120b-25'
    workers: 기본 5
  }

흐름:
  1) cases_to_xlsx(...)  → 입력 xlsx 작성
  2) call_judge_api(...) → API 호출 (동기 HTTP, 내부 retry 포함)
  3) read_merged_final(...) → merged_final.json 파싱
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Iterable

import httpx
from openpyxl import Workbook

from config import (
    JUDGE_API_MODEL,
    JUDGE_API_TIMEOUT,
    JUDGE_API_URL,
    JUDGE_API_WORKERS,
    JUDGE_IO_DIR,
)


# api_explain.md 의 Literal 정의와 동일
GENERATION_TASK_ENUM: tuple[str, ...] = (
    "고객발화요약",
    "상담사발화요약",
    "상담내용요약",
    "민원내용",
    "요구사항",
    "불편사항",
    "개선요청사항",
    "상담제목",
)


class JudgeAPIError(RuntimeError):
    """Judge API 호출 실패."""


def validate_generation_task(value: str | None) -> str:
    """task.generation_task 가 Judge API enum에 포함되는지 검증.

    포함되면 그대로 반환. 아니면 JudgeAPIError 발생 (메시지에 enum 목록 포함).
    """
    s = (value or "").strip()
    if s not in GENERATION_TASK_ENUM:
        raise JudgeAPIError(
            f"generation_task '{s or '(빈 값)'}'은(는) Judge API에서 지원하지 않습니다. "
            f"다음 중 하나로 설정하세요: {', '.join(GENERATION_TASK_ENUM)}"
        )
    return s


def ensure_io_dir(sub: str) -> Path:
    """JUDGE_IO_DIR/<sub>/ 디렉토리를 만들어 절대 경로 반환."""
    base = Path(JUDGE_IO_DIR).resolve()
    target = base / sub
    target.mkdir(parents=True, exist_ok=True)
    return target


def cases_to_xlsx(cases: Iterable[dict], output_path: str | Path) -> str:
    """case_results 행 (dict 목록)을 Judge API 입력 xlsx로 변환.

    필요 컬럼: id, stt, generated, reference, keywords
    - id 는 case_id 값을 사용 (DB의 case_id 컬럼)
    """
    wb = Workbook()
    ws = wb.active
    ws.title = "cases"
    headers = ["id", "stt", "generated", "reference", "keywords"]
    ws.append(headers)

    count = 0
    for c in cases:
        cid = c.get("case_id") or c.get("id") or ""
        row = [
            str(cid),
            c.get("stt") or "",
            c.get("generated") or "",
            c.get("reference") or "",
            c.get("keywords") or "",
        ]
        # openpyxl 셀 길이 제한 안전 컷
        row = [
            (v[:32000] if isinstance(v, str) and len(v) > 32000 else v)
            for v in row
        ]
        ws.append(row)
        count += 1

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    return str(out.resolve())


async def call_judge_api(
    *,
    input_file: str,
    generation_task: str,
    output_dir: str,
    generated_header: str = "generated",
    model: str | None = None,
    workers: int | None = None,
    request_id: str | None = None,
    timeout: int | None = None,
) -> dict:
    """Judge API 호출. 응답 dict 반환.

    실패 시 JudgeAPIError 발생.

    주의: JudgeRequest 의 'id' 필드는 **case ID 필터** (--id 인자) 입니다.
    내부 추적용 request_id 를 절대 'id' 로 보내면 안 됩니다.
    request_id 는 클라이언트 측 로깅 용도로만 사용됩니다.
    """
    body: dict = {
        "input_file": input_file,
        "generation_task": generation_task,
        "output_dir": output_dir,
        "generated_header": generated_header,
        "model": model or JUDGE_API_MODEL,
        "workers": workers or JUDGE_API_WORKERS,
    }
    # request_id 는 의도적으로 body 에 포함하지 않습니다 (위 docstring 참고).
    _ = request_id

    use_timeout = timeout or JUDGE_API_TIMEOUT
    try:
        async with httpx.AsyncClient(timeout=use_timeout) as client:
            resp = await client.post(JUDGE_API_URL, json=body)
    except httpx.HTTPError as e:
        raise JudgeAPIError(f"Judge API 통신 실패: {type(e).__name__}: {e}") from e

    if resp.status_code >= 400:
        # API 측 에러 메시지 노출
        detail = ""
        try:
            detail = resp.json().get("detail", "")
        except Exception:
            detail = resp.text[:500]
        raise JudgeAPIError(
            f"Judge API 오류 (HTTP {resp.status_code}): {detail}"
        )

    try:
        return resp.json()
    except Exception as e:
        raise JudgeAPIError(f"Judge API 응답 파싱 실패: {e}") from e


def read_merged_final(output_dir: str | Path) -> tuple[dict, list[dict]]:
    """output_dir/merged_final.json 파싱.

    Returns: (summary, cases)
      cases: [{id, generation_task, stt, reference, keywords, generated,
               answer_evaluation, answer_evaluation_reason, ...}, ...]
    """
    path = Path(output_dir) / "merged_final.json"
    if not path.exists():
        raise JudgeAPIError(f"merged_final.json 이 생성되지 않았습니다: {path}")

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        raise JudgeAPIError(f"merged_final.json 파싱 실패: {e}") from e

    summary = data.get("summary", {}) or {}
    cases = data.get("cases", []) or []
    if not isinstance(cases, list):
        raise JudgeAPIError("merged_final.json 의 'cases' 가 list가 아닙니다.")
    return summary, cases


async def run_judge_for_cases(
    *,
    cases: list[dict],
    generation_task: str,
    sub_dir: str,
    request_id: str | None = None,
) -> tuple[list[dict], dict]:
    """high-level 헬퍼: cases → xlsx → API → merged_final.json → cases 반환.

    sub_dir: JUDGE_IO_DIR 하위의 작업 폴더명 (예: 'phase4/run_12_20260410_120000').
    """
    work_dir = ensure_io_dir(sub_dir)
    input_path = work_dir / "input.xlsx"

    # I/O는 동기이므로 기본 executor로 위임
    loop = asyncio.get_running_loop()
    abs_input = await loop.run_in_executor(None, cases_to_xlsx, cases, str(input_path))

    await call_judge_api(
        input_file=abs_input,
        generation_task=generation_task,
        output_dir=str(work_dir.resolve()),
        request_id=request_id,
    )

    summary, judge_cases = await loop.run_in_executor(
        None, read_merged_final, str(work_dir.resolve())
    )
    return judge_cases, summary
