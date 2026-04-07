import asyncio
import json
import logging
from datetime import datetime
from typing import AsyncGenerator
from database import get_db
from services.gpt_client import call_gpt, get_task_gpt_config, get_task_sim_config
from services.delta import compute_learning_rate, count_completed_runs
from services.experiment_history import build_experiment_history
from services.sse_helpers import log_event, result_event, done_event, LogCollector
from services.phase4_judge import (
    _classify_from_text as _classify_judge_text,
    _extract_json as _extract_judge_json,
)

logger = logging.getLogger(__name__)

STRATEGY_PROMPT_PATH = "prompts/phase2_strategy.txt"
CANDIDATE_PROMPT_PATH = "prompts/phase2_candidate.txt"
REPAIR_PROMPT_PATH = "prompts/phase2_repair.txt"
JUDGE_SYSTEM_PROMPT_PATH = "prompts/phase4_judge.txt"
JUDGE_USER_PROMPT_PATH = "prompts/phase4_judge_user.txt"
ANCHORS_DIR = "prompts/anchors"

NODE_LABELS = ["A", "B", "C"]


# ─── 프롬프트 로더 ──────────────────────────────────────────────────────────

def _load_prompt(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


# ─── 공유 유틸 (기존 유지) ──────────────────────────────────────────────────

def _build_candidates_with_nodes(saved_candidates: list) -> list:
    """DB rows → node_prompts 배열 변환 (BUG-7 공유 로직)"""
    result = []
    for cand in saved_candidates:
        node_prompts = []
        for label, content_key, reason_key in [
            ("A", "node_a_prompt", "node_a_reasoning"),
            ("B", "node_b_prompt", "node_b_reasoning"),
            ("C", "node_c_prompt", "node_c_reasoning"),
        ]:
            if cand.get(content_key):
                node_prompts.append({
                    "label": label,
                    "content": cand[content_key],
                    "system_prompt": cand.get(f"node_{label.lower()}_system_prompt") or "",
                    "user_prompt": cand.get(f"node_{label.lower()}_user_prompt") or "",
                    "input_vars": json.loads(cand.get(f"node_{label.lower()}_input_vars") or "[]"),
                    "output_var": cand.get(f"node_{label.lower()}_output_var") or "",
                    "reasoning": bool(cand.get(reason_key)),
                })
        result.append({
            "id": cand["id"],
            "run_id": cand.get("run_id"),
            "candidate_label": cand["candidate_label"],
            "mode": cand.get("mode", "explore"),
            "node_count": cand.get("node_count", len(node_prompts)),
            "design_rationale": cand.get("design_rationale", ""),
            "nodes": node_prompts,
        })
    return result


def _extract_json(text: str) -> dict:
    if not text:
        return {}
    import re
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        try:
            return json.loads(fence.group(1))
        except Exception:
            pass
    try:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
    except Exception:
        pass
    return {}


async def _mark_phase_failed(run_id: int, phase: int):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE phase_results SET status='failed', completed_at=? WHERE run_id=? AND phase=?",
            (datetime.utcnow().isoformat(), run_id, phase)
        )
        await db.execute("UPDATE runs SET status='failed' WHERE id=?", (run_id,))
        await db.commit()
    finally:
        await db.close()


# ─── Step 0: converge 모드 이전 최적 프롬프트 조회 ──────────────────────────

async def _get_best_previous_candidates(task_id: int, current_run_id: int) -> str:
    """이전 최고 score_total run의 prompt_candidates를 system/user 분리하여 텍스트로 반환."""
    db = await get_db()
    try:
        async with db.execute(
            """SELECT id, run_number, score_total, selected_candidate_id FROM runs
               WHERE task_id=? AND id != ? AND score_total IS NOT NULL
               AND status IN ('completed','phase4_done','phase5_done','phase6_done')
               ORDER BY score_total DESC LIMIT 1""",
            (task_id, current_run_id)
        ) as cursor:
            best_run = await cursor.fetchone()

        if not best_run:
            return ""

        best_run = dict(best_run)

        # 선택된 후보만 반환 (없으면 전체)
        if best_run.get("selected_candidate_id"):
            async with db.execute(
                "SELECT * FROM prompt_candidates WHERE id=?",
                (best_run["selected_candidate_id"],)
            ) as cursor:
                candidates = [dict(row) for row in await cursor.fetchall()]
        else:
            async with db.execute(
                "SELECT * FROM prompt_candidates WHERE run_id=? ORDER BY candidate_label",
                (best_run["id"],)
            ) as cursor:
                candidates = [dict(row) for row in await cursor.fetchall()]

        if not candidates:
            return ""

        lines = [f"[이전 최고 성적 Run #{best_run['run_number']} — score_total={best_run['score_total']}%]"]
        for c in candidates:
            lines.append(f"\n후보 {c['candidate_label']} (node_count={c['node_count']}):")
            for label in NODE_LABELS:
                lbl = label.lower()
                prompt_key = f"node_{lbl}_prompt"
                if not c.get(prompt_key):
                    continue
                sys_p = c.get(f"node_{lbl}_system_prompt") or ""
                usr_p = c.get(f"node_{lbl}_user_prompt") or ""
                output_var = c.get(f"node_{lbl}_output_var") or ""
                input_vars = c.get(f"node_{lbl}_input_vars") or "[]"
                reasoning = "ON" if c.get(f"node_{lbl}_reasoning") else "OFF"

                header = f"  노드 {label} (reasoning: {reasoning}"
                if output_var:
                    header += f", output: {output_var}"
                if input_vars and input_vars != "[]":
                    header += f", input: {input_vars}"
                header += "):"
                lines.append(header)

                if sys_p:
                    lines.append(f"    [SYSTEM] {sys_p}")
                if usr_p:
                    lines.append(f"    [USER] {usr_p}")
                if not sys_p and not usr_p:
                    lines.append(f"    {c[prompt_key]}")
        return "\n".join(lines)
    finally:
        await db.close()


# ─── Step 0-b: 이전 Run Phase 6 피드백 조회 ──────────────────────────────────

def _parse_phase6_output(output_data: str) -> str:
    """Phase 6 output_data JSON에서 피드백 텍스트를 추출."""
    try:
        p6 = json.loads(output_data)
    except Exception:
        return ""

    parts = []

    # backprop: 케이스 레벨 delta 귀인 분석 (가장 상세한 인과 분석)
    backprop = p6.get("backprop", "")
    if backprop:
        parts.append(f"[이전 Run Phase 6 — 프롬프트 변경→결과 인과 분석]\n{backprop}")

    next_dir = p6.get("next_direction", "")
    if next_dir:
        parts.append(f"[이전 Run Phase 6 — 다음 방향]\n{next_dir}")

    effective = p6.get("effective", [])
    if effective:
        parts.append("[효과적 요소]\n" + "\n".join(f"- {e}" for e in effective))

    harmful = p6.get("harmful", [])
    if harmful:
        parts.append("[해로운 요소]\n" + "\n".join(f"- {h}" for h in harmful))

    constraints = p6.get("constraints", "")
    if constraints:
        parts.append(f"[반드시 유지할 요소]\n{constraints}")

    return "\n\n".join(parts)


async def _get_prev_run_feedback(base_run_id: int, task_id: int) -> tuple[str, int | None]:
    """이전 Run의 Phase 6 피드백을 가져온다.

    Returns:
        (feedback_text, source_run_id) — 피드백을 찾은 Run ID를 함께 반환.
        피드백이 없으면 ("", None).

    탐색 순서:
      1순위: base_run_id의 Phase 6 (직접 이전 Run)
      2순위: base_run_id 체인을 따라 올라감 (base_run_id의 base_run_id → ...)
      3순위: 같은 Task에서 가장 최근 완료된 Phase 6
    """
    db = await get_db()
    try:
        # 1순위: base_run_id의 Phase 6
        async with db.execute(
            "SELECT output_data FROM phase_results WHERE run_id=? AND phase=6 AND status='completed'",
            (base_run_id,)
        ) as cursor:
            row = await cursor.fetchone()

        if row and row["output_data"]:
            feedback = _parse_phase6_output(row["output_data"])
            if feedback:
                return feedback, base_run_id

        logger.info(f"base_run_id={base_run_id}의 Phase 6 피드백이 비어있음 — 체인/폴백 탐색 시작")

        # 2순위: base_run_id 체인을 따라 올라감 (최대 10단계)
        current_id = base_run_id
        for _ in range(10):
            async with db.execute(
                "SELECT base_run_id FROM runs WHERE id=?", (current_id,)
            ) as cursor:
                chain_row = await cursor.fetchone()
            if not chain_row or not chain_row["base_run_id"]:
                break
            ancestor_id = chain_row["base_run_id"]
            async with db.execute(
                "SELECT output_data FROM phase_results WHERE run_id=? AND phase=6 AND status='completed'",
                (ancestor_id,)
            ) as cursor:
                ancestor_row = await cursor.fetchone()
            if ancestor_row and ancestor_row["output_data"]:
                feedback = _parse_phase6_output(ancestor_row["output_data"])
                if feedback:
                    logger.info(f"체인 상위 Run #{ancestor_id}에서 Phase 6 피드백 발견")
                    return feedback, ancestor_id
            current_id = ancestor_id

        # 3순위: 같은 Task에서 가장 최근 완료된 Phase 6 (base_run_id 제외)
        async with db.execute(
            """SELECT pr.run_id, pr.output_data
               FROM phase_results pr
               JOIN runs r ON r.id = pr.run_id
               WHERE r.task_id=? AND pr.phase=6 AND pr.status='completed'
               ORDER BY r.run_number DESC LIMIT 5""",
            (task_id,)
        ) as cursor:
            fallback_rows = await cursor.fetchall()

        for fb_row in fallback_rows:
            if fb_row["output_data"]:
                feedback = _parse_phase6_output(fb_row["output_data"])
                if feedback:
                    logger.info(f"폴백: Task 내 Run #{fb_row['run_id']}에서 Phase 6 피드백 발견")
                    return feedback, fb_row["run_id"]

        logger.warning(f"Task {task_id}에서 유효한 Phase 6 피드백을 찾지 못함")
        return "", None
    finally:
        await db.close()


# ─── Step 1: 전략 수립 ──────────────────────────────────────────────────────

def _load_anchor_guide(filename: str) -> str:
    """prompts/anchors/ 폴더에서 앵커 가이드 파일 내용을 로드."""
    if not filename:
        return ""
    import os
    path = os.path.join(ANCHORS_DIR, filename)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    except FileNotFoundError:
        logger.warning(f"앵커 가이드 파일을 찾을 수 없습니다: {path}")
        return ""


def _build_strategy_input(
    task: dict, phase1_summary: dict, experiment_history: str,
    learning_rate: str, converge_text: str,
    improvable_count: int, total_count: int,
    prev_run_feedback: str = "",
    user_guide: str = "",
    anchor_guide: str = "",
) -> str:
    template = _load_prompt(STRATEGY_PROMPT_PATH)

    scores = phase1_summary.get("scores", {})
    bucket_counts = phase1_summary.get("bucket_counts", {})
    error_pattern_ranking = phase1_summary.get("error_pattern_ranking", [])
    top_issues = phase1_summary.get("top_issues", [])
    recommended_focus = phase1_summary.get("recommended_focus", "")

    converge_context = ""
    if converge_text:
        converge_context = f"[converge 모드 — 이전 최고 성적 참조]\n{converge_text}"

    user_guide_section = ""
    if user_guide:
        user_guide_section = f"[사용자 전략 가이드 — 반드시 준수]\n{user_guide}"

    # Reference 요약 기준 (Phase 1에서 분석된 상담사의 핵심 내용 선별 기준)
    ref_criteria = phase1_summary.get("reference_summary_criteria", "")
    common_gaps = phase1_summary.get("common_content_gaps", "")
    reference_criteria_section = ""
    if ref_criteria:
        reference_criteria_section = f"[Reference 요약 기준 — 상담사가 어떤 내용을 포함/생략하는지]\n{ref_criteria}"
        if common_gaps:
            reference_criteria_section += f"\n\n[Generated가 자주 빠뜨리거나 불필요하게 추가하는 내용 패턴]\n{common_gaps}"

    anchor_guide_section = ""
    if anchor_guide:
        anchor_guide_section = f"[앵커 가이드 — 프롬프트 설계 시 반드시 참조]\n{anchor_guide}"

    return template.format(
        generation_task=task.get("generation_task", "불편사항 요약"),
        bucket_counts=json.dumps(bucket_counts, ensure_ascii=False),
        error_pattern_ranking=json.dumps(error_pattern_ranking[:10], ensure_ascii=False),
        top_issues=json.dumps(top_issues, ensure_ascii=False),
        recommended_focus=recommended_focus,
        scores=json.dumps(scores, ensure_ascii=False),
        improvable_count=improvable_count,
        total=total_count,
        experiment_history=experiment_history,
        learning_rate=learning_rate,
        converge_context=converge_context,
        prev_run_feedback=prev_run_feedback,
        user_guide=user_guide_section,
        reference_criteria=reference_criteria_section,
        anchor_guide=anchor_guide_section,
    )


async def _call_strategy_step(prompt: str, max_retries: int = 1, gpt_config: dict | None = None, reasoning: str = "high") -> dict | None:
    """Step 1: GPT에 전략 수립 요청. 실패 시 max_retries만큼 재시도."""
    for attempt in range(max_retries + 1):
        try:
            raw = await call_gpt([{"role": "user", "content": prompt}], reasoning=reasoning, **(gpt_config or {}))
            result = _extract_json(raw)
            candidates = result.get("candidates", [])
            if not candidates:
                logger.warning(f"[Step1] attempt {attempt+1}: candidates 비어있음")
                continue
            # 기본 검증: 각 후보에 필수 필드 있는지
            valid = True
            for c in candidates:
                if not c.get("label") or not c.get("node_count") or not c.get("node_roles"):
                    valid = False
                    break
                if len(c.get("node_roles", [])) != c["node_count"]:
                    valid = False
                    break
            if valid:
                return result
            logger.warning(f"[Step1] attempt {attempt+1}: 구조 검증 실패")
        except Exception as e:
            logger.warning(f"[Step1] attempt {attempt+1} 오류: {e}")
    return None


# ─── Step 2: 후보별 프롬프트 생성 ────────────────────────────────────────────

def _select_cases_for_candidate(
    focus_patterns: list, improvable_cases: list, max_cases: int = 5
) -> list:
    """focus_patterns에 매칭되는 케이스 우선 선별, 부족하면 빈도순 보충."""
    selected = []
    selected_ids = set()

    # focus_patterns 매칭 우선
    for case in improvable_cases:
        if len(selected) >= max_cases:
            break
        case_pattern = case.get("error_pattern", "")
        if case_pattern and any(fp in case_pattern for fp in focus_patterns):
            if case["case_id"] not in selected_ids:
                selected.append(case)
                selected_ids.add(case["case_id"])

    # 부족하면 빈도순(리스트 순서) 보충
    for case in improvable_cases:
        if len(selected) >= max_cases:
            break
        if case["case_id"] not in selected_ids:
            selected.append(case)
            selected_ids.add(case["case_id"])

    return selected


def _format_cases_text(cases: list) -> str:
    """대표 케이스를 프롬프트에 삽입 가능한 텍스트로 변환."""
    lines = []
    for i, c in enumerate(cases, 1):
        stt = (c.get("stt") or "")[:500]
        ref = (c.get("reference") or "")[:300]
        gen = (c.get("generated") or "")[:300]
        lines.append(f"--- 케이스 {i} (ID: {c['case_id']}) ---")
        lines.append(f"Reference 요약 기준: {c.get('reference_criteria', 'N/A')}")
        lines.append(f"요약 내용 차이: {c.get('content_gap', 'N/A')}")
        lines.append(f"오류 패턴: {c.get('error_pattern', 'N/A')}")
        lines.append(f"분석: {c.get('analysis_summary', 'N/A')}")
        lines.append(f"누락 지시: {c.get('missing_instruction', 'N/A')}")
        lines.append(f"위반 지시: {c.get('violated_instruction', 'N/A')}")
        lines.append(f"개선 제안: {c.get('improvement_suggestion', 'N/A')}")
        lines.append(f"STT: {stt}")
        lines.append(f"정답(Reference): {ref}")
        lines.append(f"생성(Generated): {gen}")
        lines.append("")
    return "\n".join(lines) if lines else "(대표 케이스 없음)"


async def _generate_single_candidate(
    strategy_candidate: dict, design_summary: str,
    task: dict, improvable_cases: list,
    max_retries: int = 1,
    user_guide: str = "",
    reference_style_profile: str = "",
    anchor_guide: str = "",
    retry_feedback: str = "",
    gpt_config: dict | None = None,
    reasoning: str = "high",
) -> dict | None:
    """Step 2: 개별 후보의 노드 프롬프트 생성. 실패 시 재시도."""
    label = strategy_candidate["label"]
    node_count = strategy_candidate["node_count"]
    focus_patterns = strategy_candidate.get("focus_patterns", [])

    # 대표 케이스 선별
    rep_cases = _select_cases_for_candidate(focus_patterns, improvable_cases)
    cases_text = _format_cases_text(rep_cases)

    user_guide_section = ""
    if user_guide:
        user_guide_section = f"\n[사용자 전략 가이드 — 반드시 준수]\n{user_guide}\n"

    reference_criteria_section = ""
    if reference_style_profile:
        reference_criteria_section = f"\n[Reference 요약 기준 — LLM이 이 기준에 맞게 요약하도록 프롬프트를 작성하라]\n{reference_style_profile}\n"

    anchor_guide_section = ""
    if anchor_guide:
        anchor_guide_section = f"\n[앵커 가이드 — 프롬프트 설계 시 반드시 참조]\n{anchor_guide}\n"

    template = _load_prompt(CANDIDATE_PROMPT_PATH)
    prompt = template.format(
        generation_task=task.get("generation_task", "불편사항 요약"),
        candidate_label=label,
        strategy_name=strategy_candidate.get("strategy_name", ""),
        node_count=node_count,
        node_roles=json.dumps(strategy_candidate.get("node_roles", []), ensure_ascii=False),
        node_reasoning_config=json.dumps(strategy_candidate.get("node_reasoning_config", []), ensure_ascii=False),
        rationale=strategy_candidate.get("rationale", ""),
        focus_patterns=json.dumps(focus_patterns, ensure_ascii=False),
        design_summary=design_summary,
        representative_cases=cases_text,
        user_guide=user_guide_section,
        reference_criteria=reference_criteria_section,
        anchor_guide=anchor_guide_section,
    )

    # 재시도 시 1차 실패 피드백 주입
    if retry_feedback:
        prompt += f"\n\n[Mini-validation 1차 실패 피드백 — 반드시 반영]\n{retry_feedback}\n위 실패를 반복하지 않도록 프롬프트를 근본적으로 개선하라. JSON만 출력하라."

    for attempt in range(max_retries + 1):
        try:
            raw = await call_gpt([{"role": "user", "content": prompt}], reasoning=reasoning, **(gpt_config or {}))
            result = _extract_json(raw)
            nodes = result.get("nodes", [])
            if nodes:
                return {
                    "label": label,
                    "node_count": node_count,
                    "rationale": strategy_candidate.get("rationale", ""),
                    "focus_patterns": focus_patterns,
                    "node_roles": strategy_candidate.get("node_roles", []),
                    "node_reasoning_config": strategy_candidate.get("node_reasoning_config", []),
                    "nodes": nodes,
                }
            logger.warning(f"[Step2] 후보 {label} attempt {attempt+1}: nodes 비어있음")
        except Exception as e:
            logger.warning(f"[Step2] 후보 {label} attempt {attempt+1} 오류: {e}")
    return None


# ─── Step 3: 검증 + 보정 ────────────────────────────────────────────────────

def _validate_candidate(candidate: dict) -> list:
    """후보의 노드 검증. 누락된 노드 라벨 리스트 반환."""
    node_count = candidate["node_count"]
    nodes = candidate.get("nodes", [])
    expected_labels = NODE_LABELS[:node_count]

    existing_labels = set()
    for n in nodes:
        lbl = n.get("node_label", "")
        # system_prompt 또는 user_prompt가 있으면 prompt로 인정 (하위 호환)
        has_prompt = (
            n.get("prompt", "").strip()
            or n.get("system_prompt", "").strip()
            or n.get("user_prompt", "").strip()
        )
        if lbl and has_prompt:
            existing_labels.add(lbl)

    return [lbl for lbl in expected_labels if lbl not in existing_labels]


async def _repair_candidate(
    candidate: dict, missing_labels: list, task: dict,
    gpt_config: dict | None = None,
    reasoning: str = "high",
) -> dict:
    """누락된 노드만 GPT에 보정 요청."""
    # 기존 노드 텍스트 구성
    existing_text_parts = []
    for n in candidate.get("nodes", []):
        sys_p = n.get("system_prompt", "")
        usr_p = n.get("user_prompt", "")
        prompt_text = n.get("prompt", "")
        display = (sys_p + "\n" + usr_p).strip() if sys_p or usr_p else prompt_text
        if display.strip():
            existing_text_parts.append(
                f"노드 {n['node_label']}: {display[:300]}..."
            )
    existing_nodes_text = "\n".join(existing_text_parts) if existing_text_parts else "(없음)"

    template = _load_prompt(REPAIR_PROMPT_PATH)
    prompt = template.format(
        generation_task=task.get("generation_task", "불편사항 요약"),
        candidate_label=candidate["label"],
        node_count=candidate["node_count"],
        node_roles=json.dumps(candidate.get("node_roles", []), ensure_ascii=False),
        node_reasoning_config=json.dumps(candidate.get("node_reasoning_config", []), ensure_ascii=False),
        rationale=candidate.get("rationale", ""),
        existing_nodes=existing_nodes_text,
        missing_labels=", ".join(missing_labels),
    )

    try:
        # repair는 한 단계 낮은 reasoning 사용
        repair_reasoning = {"high": "medium", "medium": "low", "low": "low"}.get(reasoning, "medium")
        raw = await call_gpt([{"role": "user", "content": prompt}], reasoning=repair_reasoning, **(gpt_config or {}))
        result = _extract_json(raw)
        repaired = result.get("repaired_nodes", [])

        # 기존 nodes에 보정된 노드 병합
        existing_map = {n["node_label"]: n for n in candidate["nodes"] if n.get("node_label")}
        for rn in repaired:
            lbl = rn.get("node_label", "")
            has_prompt = (
                rn.get("prompt", "").strip()
                or rn.get("system_prompt", "").strip()
                or rn.get("user_prompt", "").strip()
            )
            if lbl in missing_labels and has_prompt:
                existing_map[lbl] = rn

        # 올바른 순서로 재조립
        candidate["nodes"] = [
            existing_map[lbl] for lbl in NODE_LABELS[:candidate["node_count"]]
            if lbl in existing_map
        ]
        return candidate
    except Exception as e:
        logger.warning(f"[Step3] 후보 {candidate['label']} 보정 실패: {e}")
        return candidate


# ─── Mini-Validation (Phase 2 내 간이 검증) ────────────────────────────────

import re as _re

class SafeDict(dict):
    """format_map용: 알 수 없는 {var}는 그대로 유지, KeyError 방지."""
    def __missing__(self, key):
        return '{' + key + '}'


def _dify_to_python_vars(text: str) -> str:
    """Dify 스타일 {{var}} → Python format 스타일 {var} 변환.
    GPT가 생성한 프롬프트는 Dify 변수 규칙(이중 중괄호)을 따르므로
    시뮬레이션 시 Python format_map이 치환할 수 있도록 단일 중괄호로 변환한다."""
    return _re.sub(r'\{\{(\w+)\}\}', r'{\1}', text)


async def _select_validation_cases(
    run_id: int, improvable_cases: list, max_cases: int = 3
) -> list[dict]:
    """Phase 1 오답 케이스 중 validation용 케이스 선별.
    DB에서 full stt/reference/keywords/generation_task 조회."""
    if not improvable_cases:
        return []

    # 우선순위: prompt_missing > error_pattern 빈도순(리스트 순서)
    sorted_cases = sorted(
        improvable_cases,
        key=lambda c: (0 if c.get("bucket") == "prompt_missing" else 1),
    )
    selected = sorted_cases[:max_cases]

    case_ids = [c["case_id"] for c in selected]
    if not case_ids:
        return []

    db = await get_db()
    try:
        placeholders = ",".join("?" for _ in case_ids)
        async with db.execute(
            f"""SELECT case_id, stt, reference, keywords, generation_task
                FROM case_results WHERE run_id=? AND case_id IN ({placeholders})""",
            [run_id] + case_ids,
        ) as cursor:
            rows = {row["case_id"]: dict(row) for row in await cursor.fetchall()}

        result = []
        for c in selected:
            db_row = rows.get(c["case_id"])
            if db_row:
                result.append(db_row)
        return result
    finally:
        await db.close()


def _build_retry_feedback(candidates: list) -> str:
    """Mini-validation 전체 실패 시, 재시도에 주입할 피드백 텍스트 생성."""
    lines = [
        "아래는 1차 시도에서 각 후보가 생성한 결과와 Judge 판정이다. 모든 후보가 실패했다.",
        "이 실패 원인을 분석하고, 동일 오류가 반복되지 않도록 프롬프트를 근본적으로 개선하라.",
        "",
    ]
    for cand in candidates:
        label = cand.get("label", "")
        mv = cand.get("mini_validation", {})
        details = mv.get("details", [])
        lines.append(f"후보 {label}:")
        for d in details:
            case_id = d.get("case_id", "")
            eval_result = d.get("evaluation", "평가실패")
            preview = (d.get("generated_preview") or "")[:200]
            lines.append(f"  - 케이스 {case_id}: 판정={eval_result}")
            if preview:
                lines.append(f"    생성 결과: \"{preview}\"")
        lines.append("")
    return "\n".join(lines)


async def _simulate_workflow_for_case(
    candidate: dict, case: dict, sim_config: dict | None = None
) -> str:
    """후보의 multi-node workflow를 시뮬레이션 모델(sim_config)로 실행.
    Dify 워크플로우와 동일하게 입력 → LLM Node 1 → LLM Node 2 → ... → 최종 답변 순서로 실행.
    각 노드의 output_var가 다음 노드의 input_vars로 전달된다.
    마지막 노드 결과(pool['generated'])를 반환."""
    pool = {
        "stt": case.get("stt", ""),
        "reference": case.get("reference", ""),
        "keywords": case.get("keywords", ""),
        "generation_task": case.get("generation_task", ""),
    }

    nodes = candidate.get("nodes", [])
    last_result = ""

    for i, node in enumerate(nodes):
        node_label = node.get("node_label", NODE_LABELS[i] if i < len(NODE_LABELS) else f"N{i}")
        sys_prompt = (node.get("system_prompt") or "").strip()
        usr_prompt = (node.get("user_prompt") or "").strip()

        # 프롬프트가 없으면 legacy prompt 필드 사용
        if not sys_prompt and not usr_prompt:
            legacy = (node.get("prompt") or "").strip()
            if legacy:
                usr_prompt = legacy

        # Dify 스타일 {{var}} → Python {var} 변환 후 변수 치환
        sys_norm = _dify_to_python_vars(sys_prompt)
        usr_norm = _dify_to_python_vars(usr_prompt)
        sys_rendered = sys_norm.format_map(SafeDict(**pool)) if sys_norm else ""
        usr_rendered = usr_norm.format_map(SafeDict(**pool)) if usr_norm else ""

        messages = []
        if sys_rendered:
            messages.append({"role": "system", "content": sys_rendered})
        if usr_rendered:
            messages.append({"role": "user", "content": usr_rendered})

        if not messages:
            logger.warning(f"[mini-sim] 노드 {node_label}: 프롬프트 비어있음 — 스킵")
            continue

        logger.info(f"[mini-sim] 노드 {node_label} 실행 (input_vars: {node.get('input_vars', [])})")
        result = await call_gpt(messages, reasoning="low", **(sim_config or {}))
        last_result = result

        # output_var에 결과 저장 → 다음 노드에서 사용 가능
        output_var = node.get("output_var", "")
        if output_var:
            pool[output_var] = result
            logger.info(f"[mini-sim] 노드 {node_label} → pool['{output_var}'] 저장 ({len(result)}자)")

    # 최종 결과를 generated로도 저장
    pool["generated"] = last_result
    return last_result


async def _mini_judge(
    case: dict, generated: str,
    judge_sys: str, judge_user_tmpl: str,
    gpt_config: dict | None = None,
) -> tuple[str, str]:
    """Phase 4 Judge 프롬프트로 간이 판정. (evaluation, reason) 튜플 반환."""
    try:
        user_content = judge_user_tmpl.format(
            stt=case.get("stt", ""),
            generation_task=case.get("generation_task", ""),
            reference=case.get("reference", ""),
            keywords=case.get("keywords", ""),
            generated=generated,
        )
    except KeyError:
        user_content = judge_user_tmpl.format_map(SafeDict(
            stt=case.get("stt", ""),
            generation_task=case.get("generation_task", ""),
            reference=case.get("reference", ""),
            keywords=case.get("keywords", ""),
            generated=generated,
        ))

    messages = []
    if judge_sys:
        messages.append({"role": "system", "content": judge_sys})
    messages.append({"role": "user", "content": user_content})

    try:
        raw = await call_gpt(messages, reasoning="low", **(gpt_config or {}))
        result = _extract_judge_json(raw)
        evaluation = result.get("rating", "평가실패")
        reason = result.get("reason", "")
        if evaluation == "평가실패":
            evaluation, _ = _classify_judge_text(raw)
            reason = reason or raw[:200]
        return evaluation, reason
    except Exception as e:
        logger.warning(f"[mini-judge] 판정 실패: {e}")
        return "평가실패", str(e)


async def _run_mini_validation(
    candidates: list, validation_cases: list,
    gpt_config: dict | None = None,
    sim_config: dict | None = None,
    concurrency: int = 5,
) -> list[dict]:
    """모든 후보에 대해 validation_cases로 시뮬+판정 수행.
    - 워크플로우 시뮬레이션: sim_config (생성 모델, 예: qwen3.5-35B-A3B)
    - Judge 판정: gpt_config (분석 모델, 예: gpt-oss-120B)
    각 후보에 mini_validation 필드를 부착하고, pass_rate 내림차순 정렬하여 반환."""
    # Judge 프롬프트 1회 로드
    try:
        judge_sys = _load_prompt(JUDGE_SYSTEM_PROMPT_PATH)
        judge_user_tmpl = _load_prompt(JUDGE_USER_PROMPT_PATH)
    except FileNotFoundError:
        logger.warning("[mini-validation] Judge 프롬프트 파일 없음 — validation 스킵")
        return candidates

    if not judge_user_tmpl:
        logger.warning("[mini-validation] Judge user 프롬프트 비어있음 — validation 스킵")
        return candidates

    semaphore = asyncio.Semaphore(concurrency)

    async def _evaluate_one(candidate: dict, case: dict) -> dict:
        async with semaphore:
            try:
                # 워크플로우 시뮬레이션은 sim_config (생성 모델) 사용
                generated = await _simulate_workflow_for_case(candidate, case, sim_config)
                # Judge 판정은 gpt_config (분석 모델) 사용
                evaluation, reason = await _mini_judge(case, generated, judge_sys, judge_user_tmpl, gpt_config)
                return {
                    "case_id": case.get("case_id", ""),
                    "evaluation": evaluation,
                    "reason": reason,
                    "stt": case.get("stt", ""),
                    "reference": case.get("reference", ""),
                    "generated_preview": generated[:200] if generated else "",
                }
            except Exception as e:
                logger.warning(f"[mini-validation] 후보 {candidate.get('label')}, 케이스 {case.get('case_id')} 실패: {e}")
                return {
                    "case_id": case.get("case_id", ""),
                    "evaluation": "평가실패",
                    "reason": "",
                    "stt": case.get("stt", ""),
                    "reference": case.get("reference", ""),
                    "generated_preview": "",
                    "error": str(e),
                }

    for candidate in candidates:
        tasks = [_evaluate_one(candidate, case) for case in validation_cases]
        details = await asyncio.gather(*tasks, return_exceptions=True)

        # 예외 처리
        clean_details = []
        for d in details:
            if isinstance(d, Exception):
                clean_details.append({"case_id": "", "evaluation": "평가실패", "error": str(d)})
            else:
                clean_details.append(d)

        total = len(clean_details)
        passed = sum(1 for d in clean_details if d["evaluation"] in ("정답", "과답"))
        pass_rate = round(passed / total, 2) if total > 0 else 0.0

        candidate["mini_validation"] = {
            "pass_rate": pass_rate,
            "passed": passed,
            "total": total,
            "details": clean_details,
        }

    # pass_rate 내림차순 정렬
    candidates.sort(key=lambda c: c.get("mini_validation", {}).get("pass_rate", 0), reverse=True)
    return candidates


# ─── DB 저장 ──────────────────────────────────────────────────────────────

async def _save_candidate_to_db(
    db, run_id: int, candidate: dict, design_mode: str
) -> None:
    """nodes[] 배열 → 기존 flat 컬럼 + 신규 system/user 컬럼 변환 후 DB 저장."""
    nodes = candidate.get("nodes", [])

    # flat 컬럼 매핑 (기존 + 신규)
    fields = {l: {} for l in ("a", "b", "c")}
    for n in nodes:
        lbl = n.get("node_label", "").lower()
        if lbl in fields:
            sys_p = n.get("system_prompt", "")
            usr_p = n.get("user_prompt", "")
            # 하위 호환: node_x_prompt = system + user 결합
            combined = (sys_p + "\n\n" + usr_p).strip() if sys_p or usr_p else n.get("prompt", "")
            fields[lbl] = {
                "prompt": combined,
                "system_prompt": sys_p,
                "user_prompt": usr_p,
                "input_vars": json.dumps(n.get("input_vars", []), ensure_ascii=False),
                "output_var": n.get("output_var", ""),
                "reasoning": 1 if n.get("reasoning") else 0,
            }

    await db.execute(
        """INSERT INTO prompt_candidates
           (run_id, candidate_label, mode, workflow_spec, node_count,
            node_a_prompt, node_b_prompt, node_c_prompt,
            node_a_system_prompt, node_a_user_prompt, node_a_input_vars, node_a_output_var,
            node_b_system_prompt, node_b_user_prompt, node_b_input_vars, node_b_output_var,
            node_c_system_prompt, node_c_user_prompt, node_c_input_vars, node_c_output_var,
            node_a_reasoning, node_b_reasoning, node_c_reasoning, design_rationale)
           VALUES (?,?,?,?,?, ?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?, ?)""",
        (
            run_id,
            candidate.get("label", "A"),
            design_mode,
            "",  # workflow_spec — 전략에서 별도로 안 씀
            candidate.get("node_count", 1),
            fields["a"].get("prompt"), fields["b"].get("prompt"), fields["c"].get("prompt"),
            fields["a"].get("system_prompt"), fields["a"].get("user_prompt"),
            fields["a"].get("input_vars"), fields["a"].get("output_var"),
            fields["b"].get("system_prompt"), fields["b"].get("user_prompt"),
            fields["b"].get("input_vars"), fields["b"].get("output_var"),
            fields["c"].get("system_prompt"), fields["c"].get("user_prompt"),
            fields["c"].get("input_vars"), fields["c"].get("output_var"),
            fields["a"].get("reasoning", 0), fields["b"].get("reasoning", 0),
            fields["c"].get("reasoning", 0),
            candidate.get("rationale", ""),
        )
    )


# ─── 메인 파이프라인 ────────────────────────────────────────────────────────

async def run_phase2(run_id: int, reasoning: str = "high") -> AsyncGenerator[str, None]:
    collector = LogCollector()
    db = await get_db()
    try:
        async with db.execute("SELECT * FROM runs WHERE id=?", (run_id,)) as cursor:
            run = dict(await cursor.fetchone())

        async with db.execute("SELECT * FROM tasks WHERE id=?", (run["task_id"],)) as cursor:
            task = dict(await cursor.fetchone())

        # 실험별 GPT 설정 로드
        gpt_config = await get_task_gpt_config(run_id)
        # 시뮬레이션(생성) 모델 설정 로드 (mini-validation용)
        sim_config = await get_task_sim_config(run_id)

        # Phase 1 결과 조회
        async with db.execute(
            "SELECT output_data FROM phase_results WHERE run_id=? AND phase=1",
            (run_id,)
        ) as cursor:
            p1_row = await cursor.fetchone()

        if not p1_row:
            yield collector.log("error", "Phase 1이 완료되지 않았습니다.")
            yield done_event("failed")
            return

        phase1_summary = json.loads(p1_row["output_data"] or "{}")

        await db.execute(
            """INSERT INTO phase_results (run_id, phase, status, started_at)
               VALUES (?,2,'running',?)
               ON CONFLICT(run_id, phase) DO UPDATE SET status='running', started_at=excluded.started_at""",
            (run_id, datetime.utcnow().isoformat())
        )
        await db.commit()
        await db.execute("UPDATE runs SET status='phase2_running', current_phase=2 WHERE id=?", (run_id,))
        await db.commit()

        # ── 준비: 모드, learning rate, 실험 이력 ──
        prev_completed = await count_completed_runs(run["task_id"], run_id)
        design_mode = "explore" if prev_completed == 0 else "converge"
        learning_rate = await compute_learning_rate(run["task_id"], run_id)

        # 전체 실험 이력 (누적 피드백 포함)
        history = await build_experiment_history(run["task_id"], run_id, max_token_budget=1500)
        experiment_history = history["full_text"] or "첫 번째 실험"

        improvable_cases = phase1_summary.get("prompt_improvable_cases", [])
        improvable_count = len(improvable_cases)

        async with db.execute(
            "SELECT COUNT(*) as cnt FROM case_results WHERE run_id=?", (run_id,)
        ) as cursor:
            total_count = (await cursor.fetchone())["cnt"]

        # converge 모드: 이전 최고 프롬프트 조회
        converge_text = ""
        if design_mode == "converge":
            converge_text = await _get_best_previous_candidates(run["task_id"], run_id)

        # 이전 Run 피드백 조회 (continue 모드)
        prev_run_feedback = ""
        if run.get("base_run_id"):
            prev_run_feedback, feedback_source_run = await _get_prev_run_feedback(
                run["base_run_id"], run["task_id"]
            )
            if prev_run_feedback:
                if feedback_source_run == run["base_run_id"]:
                    yield collector.log("info", f"이전 Run #{feedback_source_run} Phase 6 피드백 주입됨")
                else:
                    yield collector.log("info", f"이전 Run #{run['base_run_id']}의 Phase 6 없음 → Run #{feedback_source_run} 피드백으로 대체")
            else:
                yield collector.log("warn", f"이전 Run #{run['base_run_id']} 및 Task 내 Phase 6 피드백을 찾을 수 없습니다")

        # 누적 실험 피드백을 prev_run_feedback에 append
        if history.get("effective_patterns"):
            prev_run_feedback += f"\n\n[전체 실험 누적 양성 피드백]\n{history['effective_patterns']}"
        if history.get("regression_patterns"):
            prev_run_feedback += f"\n\n[전체 실험 누적 음성 피드백]\n{history['regression_patterns']}"
        if history.get("accumulated_constraints"):
            prev_run_feedback += f"\n\n[누적 제약 — 반드시 유지]\n{history['accumulated_constraints']}"

        # 사용자 전략 가이드
        user_guide = run.get("user_guide") or ""
        if user_guide:
            yield collector.log("info", f"사용자 전략 가이드 반영: {user_guide[:80]}{'...' if len(user_guide) > 80 else ''}")

        # Reference 요약 기준 프로파일
        reference_style_profile = phase1_summary.get("reference_summary_criteria", "")
        if reference_style_profile:
            yield collector.log("info", f"Reference 요약 기준 프로파일 로드됨 ({len(reference_style_profile)}자)")

        # 앵커 가이드 로드
        anchor_guide_file = task.get("anchor_guide_file", "")
        anchor_guide = ""
        if anchor_guide_file:
            anchor_guide = _load_anchor_guide(anchor_guide_file)
            if anchor_guide:
                yield collector.log("info", f"앵커 가이드 로드됨: {anchor_guide_file} ({len(anchor_guide)}자)")
            else:
                yield collector.log("warn", f"앵커 가이드 파일 로드 실패: {anchor_guide_file}")

        yield collector.log("info", f"Design mode: {design_mode}, Learning rate: {learning_rate}")

        # ════════════════════════════════════════════════════════════════════
        # Step 1/4: 전략 수립
        # ════════════════════════════════════════════════════════════════════
        yield collector.log("info", "Step 1/4: 후보 구조 전략 수립 중...")

        strategy_prompt = _build_strategy_input(
            task, phase1_summary, experiment_history,
            learning_rate, converge_text, improvable_count, total_count,
            prev_run_feedback=prev_run_feedback,
            user_guide=user_guide,
            anchor_guide=anchor_guide,
        )
        strategy_result = await _call_strategy_step(strategy_prompt, max_retries=1, gpt_config=gpt_config, reasoning=reasoning)

        if not strategy_result:
            yield collector.log("error", "전략 수립 실패 — Phase 2를 중단합니다.")
            yield done_event("failed")
            await _mark_phase_failed(run_id, 2)
            return

        strategy_candidates = strategy_result.get("candidates", [])
        design_summary = strategy_result.get("design_summary", "")

        node_desc = ", ".join(
            f"후보 {c['label']}: {c.get('strategy_name', '')} ({c['node_count']}노드)"
            for c in strategy_candidates
        )
        yield collector.log("ok", f"전략 수립 완료 — {node_desc}")

        # ════════════════════════════════════════════════════════════════════
        # Step 2/4: 후보별 프롬프트 생성 (병렬)
        # ════════════════════════════════════════════════════════════════════
        yield collector.log("info", "Step 2/4: 후보별 프롬프트 생성 중...")

        generation_tasks = [
            _generate_single_candidate(sc, design_summary, task, improvable_cases,
                                       user_guide=user_guide,
                                       reference_style_profile=reference_style_profile,
                                       anchor_guide=anchor_guide,
                                       gpt_config=gpt_config,
                                       reasoning=reasoning)
            for sc in strategy_candidates
        ]
        generation_results = await asyncio.gather(*generation_tasks, return_exceptions=True)

        generated_candidates = []
        for sc, gen_result in zip(strategy_candidates, generation_results):
            if isinstance(gen_result, Exception):
                yield collector.log("warn", f"후보 {sc['label']} 생성 실패: {gen_result}")
            elif gen_result is None:
                yield collector.log("warn", f"후보 {sc['label']} 생성 실패 — 스킵")
            else:
                node_count = len(gen_result.get("nodes", []))
                yield collector.log("ok", f"후보 {sc['label']} 생성 완료 ({node_count} 노드)")
                generated_candidates.append(gen_result)

        if not generated_candidates:
            yield collector.log("error", "모든 후보 생성 실패 — Phase 2를 중단합니다.")
            yield done_event("failed")
            await _mark_phase_failed(run_id, 2)
            return

        # ════════════════════════════════════════════════════════════════════
        # Step 3/4: 검증 및 보정
        # ════════════════════════════════════════════════════════════════════
        yield collector.log("info", "Step 3/4: 검증 및 보정 중...")

        final_candidates = []
        for cand in generated_candidates:
            missing = _validate_candidate(cand)
            if not missing:
                yield collector.log("ok", f"후보 {cand['label']}: 검증 통과")
                final_candidates.append(cand)
            else:
                yield collector.log("warn", f"후보 {cand['label']}: 노드 {', '.join(missing)} 누락 — 보정 중...")
                repaired = await _repair_candidate(cand, missing, task, gpt_config=gpt_config, reasoning=reasoning)

                # 보정 후 재검증
                still_missing = _validate_candidate(repaired)
                if not still_missing:
                    yield collector.log("ok", f"후보 {repaired['label']}: 보정 완료")
                    final_candidates.append(repaired)
                else:
                    # node_count를 실제 수로 하향 조정
                    actual_count = len([
                        n for n in repaired.get("nodes", [])
                        if (n.get("prompt", "").strip()
                            or n.get("system_prompt", "").strip()
                            or n.get("user_prompt", "").strip())
                    ])
                    if actual_count > 0:
                        repaired["node_count"] = actual_count
                        yield collector.log("warn",
                            f"후보 {repaired['label']}: 보정 불완전 — node_count를 {actual_count}로 하향 조정")
                        final_candidates.append(repaired)
                    else:
                        yield collector.log("warn", f"후보 {repaired['label']}: 보정 실패 — 스킵")

        if not final_candidates:
            yield collector.log("error", "모든 후보 검증 실패 — Phase 2를 중단합니다.")
            yield done_event("failed")
            await _mark_phase_failed(run_id, 2)
            return

        # ════════════════════════════════════════════════════════════════════
        # Step 4/4: Mini-validation
        # ════════════════════════════════════════════════════════════════════
        mini_validation_summary = {"enabled": False, "validation_case_count": 0, "candidate_results": []}

        validation_cases = await _select_validation_cases(run_id, improvable_cases, 3)
        if validation_cases:
            case_ids_str = ", ".join(c.get("case_id", "") for c in validation_cases)
            yield collector.log("info", f"검증 케이스 선별: [{case_ids_str}]")
            if sim_config:
                sim_model_name = sim_config.get("model", "default")
                yield collector.log("info", f"Step 4/4: Mini-validation 시작 — 생성 모델: {sim_model_name} ({len(validation_cases)}건 케이스, {len(final_candidates)}개 후보)")
            else:
                yield collector.log("warn", "Step 4/4: Mini-validation — 시뮬레이션 LLM 미설정, 기본 GPT로 시뮬레이션 수행")
                yield collector.log("info", f"Mini-validation 시작 ({len(validation_cases)}건 케이스, {len(final_candidates)}개 후보)")

            final_candidates = await _run_mini_validation(final_candidates, validation_cases, gpt_config=gpt_config, sim_config=sim_config)

            # 결과 로깅
            for cand in final_candidates:
                mv = cand.get("mini_validation", {})
                pr = mv.get("pass_rate", 0)
                passed = mv.get("passed", 0)
                total = mv.get("total", 0)
                yield collector.log("info", f"후보 {cand['label']}: pass_rate={int(pr * 100)}% ({passed}/{total})")
                for d in mv.get("details", []):
                    case_id = d.get("case_id", "")
                    evaluation = d.get("evaluation", "평가실패")
                    preview = (d.get("generated_preview", "") or "")[:60]
                    yield collector.log("info", f"  └ 케이스 {case_id}: {evaluation} — \"{preview}...\"")

            # 필터링: pass_rate > 0인 것만 유지
            passing = [c for c in final_candidates if c.get("mini_validation", {}).get("pass_rate", 0) > 0]

            if passing:
                filtered_count = len(final_candidates) - len(passing)
                if filtered_count > 0:
                    yield collector.log("warn", f"Mini-validation 필터링: {filtered_count}개 후보 제거 (pass_rate=0)")
                final_candidates = passing
            else:
                # ── 전체 실패 → 피드백 반영 1회 재시도 ──
                yield collector.log("warn", "모든 후보 pass_rate=0 — 실패 피드백 반영 재시도 (1회)")

                retry_feedback_text = _build_retry_feedback(final_candidates)

                # Step 2 재실행: 전략은 유지, 프롬프트만 재생성
                retry_gen_tasks = [
                    _generate_single_candidate(
                        sc, design_summary, task, improvable_cases,
                        user_guide=user_guide,
                        reference_style_profile=reference_style_profile,
                        anchor_guide=anchor_guide,
                        retry_feedback=retry_feedback_text,
                        gpt_config=gpt_config,
                        reasoning=reasoning,
                    )
                    for sc in strategy_candidates
                ]
                retry_results = await asyncio.gather(*retry_gen_tasks, return_exceptions=True)

                retry_candidates = []
                for sc, gen_result in zip(strategy_candidates, retry_results):
                    if isinstance(gen_result, Exception):
                        yield collector.log("warn", f"재시도 후보 {sc['label']} 생성 실패: {gen_result}")
                    elif gen_result is None:
                        yield collector.log("warn", f"재시도 후보 {sc['label']} 생성 실패 — 스킵")
                    else:
                        node_count = len(gen_result.get("nodes", []))
                        yield collector.log("ok", f"재시도 후보 {sc['label']} 생성 완료 ({node_count} 노드)")
                        retry_candidates.append(gen_result)

                # Step 3 재실행: 검증 및 보정
                validated_retry = []
                for cand in retry_candidates:
                    missing = _validate_candidate(cand)
                    if not missing:
                        validated_retry.append(cand)
                    else:
                        repaired = await _repair_candidate(cand, missing, task, gpt_config=gpt_config, reasoning=reasoning)
                        still_missing = _validate_candidate(repaired)
                        if not still_missing:
                            validated_retry.append(repaired)
                        else:
                            actual_count = len([
                                n for n in repaired.get("nodes", [])
                                if (n.get("system_prompt", "").strip() or n.get("user_prompt", "").strip())
                            ])
                            if actual_count > 0:
                                repaired["node_count"] = actual_count
                                validated_retry.append(repaired)

                if validated_retry:
                    # Step 4 재실행: mini-validation
                    yield collector.log("info", f"재시도 mini-validation ({len(validated_retry)}개 후보)")
                    validated_retry = await _run_mini_validation(
                        validated_retry, validation_cases,
                        gpt_config=gpt_config, sim_config=sim_config,
                    )

                    for cand in validated_retry:
                        mv = cand.get("mini_validation", {})
                        pr = mv.get("pass_rate", 0)
                        p = mv.get("passed", 0)
                        t = mv.get("total", 0)
                        yield collector.log("info", f"재시도 후보 {cand['label']}: pass_rate={int(pr * 100)}% ({p}/{t})")
                        for d in mv.get("details", []):
                            case_id = d.get("case_id", "")
                            evaluation = d.get("evaluation", "평가실패")
                            preview = (d.get("generated_preview", "") or "")[:60]
                            yield collector.log("info", f"  └ 케이스 {case_id}: {evaluation} — \"{preview}...\"")

                    retry_passing = [c for c in validated_retry if c.get("mini_validation", {}).get("pass_rate", 0) > 0]

                    if retry_passing:
                        final_candidates = retry_passing
                        yield collector.log("ok", f"재시도 성공 — {len(retry_passing)}개 후보 통과")
                    else:
                        # 재시도에서도 전체 실패 → 최선 1개 추천
                        yield collector.log("warn", "재시도에서도 모든 후보 pass_rate=0 — 재시도 후보 중 최선 1개 추천")
                        final_candidates = validated_retry[:1]
                else:
                    yield collector.log("warn", "재시도 후보 생성/검증 실패 — 1차 시도 최선 1개 유지")
                    final_candidates = final_candidates[:1]

            mini_validation_summary = {
                "enabled": True,
                "validation_case_count": len(validation_cases),
                "candidate_results": [
                    {
                        "label": c.get("label", ""),
                        "pass_rate": c.get("mini_validation", {}).get("pass_rate", 0),
                        "passed": c.get("mini_validation", {}).get("passed", 0),
                        "total": c.get("mini_validation", {}).get("total", 0),
                        "details": c.get("mini_validation", {}).get("details", []),
                    }
                    for c in final_candidates
                ],
            }

            yield collector.log("ok", f"Mini-validation 완료 — {len(final_candidates)}개 후보 최종 선정")
        else:
            yield collector.log("info", "Step 4/4: Mini-validation 스킵 (개선 가능한 오답 케이스 없음)")

        # ════════════════════════════════════════════════════════════════════
        # DB 저장
        # ════════════════════════════════════════════════════════════════════
        for cand in final_candidates:
            await _save_candidate_to_db(db, run_id, cand, design_mode)
        await db.commit()

        yield collector.log("ok", f"{len(final_candidates)}개 프롬프트 후보 설계 완료")

        # DB에서 저장된 candidates 조회 후 node_prompts 배열로 변환
        async with db.execute(
            "SELECT * FROM prompt_candidates WHERE run_id=? ORDER BY candidate_label",
            (run_id,)
        ) as cursor:
            saved_candidates = [dict(row) for row in await cursor.fetchall()]

        candidates_with_nodes = _build_candidates_with_nodes(saved_candidates)

        output = {
            "mode": design_mode,
            "learning_rate": learning_rate,
            "candidate_count": len(final_candidates),
            "design_summary": design_summary,
            "candidates": candidates_with_nodes,
            "prev_run_feedback": prev_run_feedback if prev_run_feedback else None,
            "user_guide": user_guide if user_guide else None,
            "mini_validation_summary": mini_validation_summary,
        }

        async with db.execute(
            "UPDATE phase_results SET status='completed', output_data=?, log_text=?, completed_at=? WHERE run_id=? AND phase=2",
            (json.dumps(output, ensure_ascii=False), collector.get_text(), datetime.utcnow().isoformat(), run_id)
        ):
            pass
        await db.execute("UPDATE runs SET status='phase2_done' WHERE id=?", (run_id,))
        await db.commit()

        yield result_event(output)
        yield done_event("completed")

    except Exception as e:
        yield collector.log("error", f"Phase 2 오류: {e}")
        yield done_event("failed")
        await _mark_phase_failed(run_id, 2)
    finally:
        await db.close()
