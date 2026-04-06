"""
experiment_history.py — 전체 실험 이력 누적 피드백 집계 서비스

모든 이전 Run의 양성/음성 피드백을 축적하여
Phase 2 (설계)와 Phase 6 (전략)에 풍부한 컨텍스트를 제공한다.
"""
import json
import logging
from database import get_db
from services.delta import get_run_scores

logger = logging.getLogger(__name__)

# 토큰 예산: 한국어+영문 혼합 기준 ~4 chars/token
DEFAULT_MAX_TOKEN_BUDGET = 2000
CHARS_PER_TOKEN = 4


async def build_experiment_history(
    task_id: int,
    current_run_id: int,
    max_token_budget: int = DEFAULT_MAX_TOKEN_BUDGET,
) -> dict:
    """전체 실험 이력을 집계하여 GPT 주입용 텍스트로 반환.

    Returns:
        {
            "score_timeline": str,
            "best_run_summary": str,
            "effective_patterns": str,
            "regression_patterns": str,
            "accumulated_constraints": str,
            "chronically_wrong": str,
            "full_text": str,
        }
    """
    empty = {
        "score_timeline": "",
        "best_run_summary": "",
        "effective_patterns": "",
        "regression_patterns": "",
        "accumulated_constraints": "",
        "chronically_wrong": "",
        "full_text": "",
    }

    # 1) 전체 completed runs 점수 추이
    history_runs = await get_run_scores(task_id, current_run_id)
    if not history_runs:
        return empty

    total_runs = len(history_runs)

    # 2) Phase 6 output_data 수집 (양성/음성/제약)
    phase6_data = await _collect_phase6_outputs(task_id)

    # 3) 만성 오답 케이스 집계
    chronically_wrong = await _find_chronically_wrong(task_id, current_run_id)

    # 4) 최고 성적 Run 요약
    best_run_summary = await _get_best_run_summary(task_id, current_run_id)

    # 5) 섹션별 텍스트 생성
    char_budget = max_token_budget * CHARS_PER_TOKEN

    score_timeline = _build_score_timeline(history_runs, phase6_data)
    effective_patterns = _build_pattern_list(phase6_data, "effective", history_runs)
    regression_patterns = _build_pattern_list(phase6_data, "harmful", history_runs)
    accumulated_constraints = _build_constraints(phase6_data)
    chronically_wrong_text = _format_chronically_wrong(chronically_wrong)

    # 6) 토큰 예산에 맞춰 full_text 조립
    full_text = _assemble_full_text(
        total_runs=total_runs,
        score_timeline=score_timeline,
        best_run_summary=best_run_summary,
        effective_patterns=effective_patterns,
        regression_patterns=regression_patterns,
        accumulated_constraints=accumulated_constraints,
        chronically_wrong_text=chronically_wrong_text,
        char_budget=char_budget,
    )

    return {
        "score_timeline": score_timeline,
        "best_run_summary": best_run_summary,
        "effective_patterns": effective_patterns,
        "regression_patterns": regression_patterns,
        "accumulated_constraints": accumulated_constraints,
        "chronically_wrong": chronically_wrong_text,
        "full_text": full_text,
    }


# ─── 내부 함수 ──────────────────────────────────────────────────────────────


async def _collect_phase6_outputs(task_id: int) -> list[dict]:
    """Task의 모든 completed Phase 6 output_data를 run_number 순으로 수집."""
    db = await get_db()
    try:
        async with db.execute(
            """SELECT r.run_number, r.id as run_id, r.score_total,
                      pr.output_data
               FROM phase_results pr
               JOIN runs r ON r.id = pr.run_id
               WHERE r.task_id=? AND pr.phase=6 AND pr.status='completed'
               ORDER BY r.run_number""",
            (task_id,)
        ) as cursor:
            rows = await cursor.fetchall()

        results = []
        for row in rows:
            row = dict(row)
            output_data = row.get("output_data")
            if not output_data:
                continue
            try:
                parsed = json.loads(output_data)
            except Exception:
                continue
            results.append({
                "run_number": row["run_number"],
                "run_id": row["run_id"],
                "score_total": row["score_total"],
                "effective": parsed.get("effective", []),
                "harmful": parsed.get("harmful", []),
                "constraints": parsed.get("constraints", ""),
                "next_direction": parsed.get("next_direction", ""),
            })
        return results
    finally:
        await db.close()


async def _find_chronically_wrong(task_id: int, current_run_id: int) -> list[str]:
    """3회+ 연속 오답인 case_id 목록을 반환."""
    db = await get_db()
    try:
        async with db.execute(
            """SELECT cr.case_id, COUNT(*) as wrong_count
               FROM case_results cr
               JOIN runs r ON r.id = cr.run_id
               WHERE r.task_id=? AND r.id != ?
                 AND cr.evaluation = '오답'
                 AND r.status IN ('completed','phase4_done','phase5_done','phase6_done')
               GROUP BY cr.case_id
               HAVING COUNT(*) >= 3
               ORDER BY COUNT(*) DESC
               LIMIT 20""",
            (task_id, current_run_id)
        ) as cursor:
            rows = await cursor.fetchall()
        return [f"{row['case_id']}({row['wrong_count']}회)" for row in rows]
    finally:
        await db.close()


async def _get_best_run_summary(task_id: int, current_run_id: int) -> str:
    """최고 score_total Run의 핵심 프롬프트 요약."""
    db = await get_db()
    try:
        async with db.execute(
            """SELECT id, run_number, score_total, selected_candidate_id
               FROM runs
               WHERE task_id=? AND id != ? AND score_total IS NOT NULL
                 AND status IN ('completed','phase4_done','phase5_done','phase6_done')
               ORDER BY score_total DESC LIMIT 1""",
            (task_id, current_run_id)
        ) as cursor:
            best = await cursor.fetchone()

        if not best:
            return ""

        best = dict(best)
        score_pct = round((best["score_total"] or 0) * 100, 1)
        header = f"Best Run #{best['run_number']} ({score_pct}%)"

        if not best.get("selected_candidate_id"):
            return header

        async with db.execute(
            "SELECT node_count, node_a_system_prompt, node_a_user_prompt, node_b_system_prompt, node_b_user_prompt, node_c_system_prompt, node_c_user_prompt FROM prompt_candidates WHERE id=?",
            (best["selected_candidate_id"],)
        ) as cursor:
            cand = await cursor.fetchone()

        if not cand:
            return header

        cand = dict(cand)
        parts = [header]
        for label in ["a", "b", "c"]:
            sys_p = cand.get(f"node_{label}_system_prompt") or ""
            usr_p = cand.get(f"node_{label}_user_prompt") or ""
            combined = (sys_p + " " + usr_p).strip()
            if combined:
                # 핵심만 200자 이내로 요약
                parts.append(f"  Node {label.upper()}: {combined[:200]}")
        return "\n".join(parts)
    finally:
        await db.close()


def _build_score_timeline(history_runs: list[dict], phase6_data: list[dict]) -> str:
    """점수 추이 + 변경 요약 어노테이션."""
    # Phase 6 next_direction을 run_number로 인덱싱
    direction_map = {}
    for p6 in phase6_data:
        direction_map[p6["run_number"]] = p6.get("next_direction", "")

    lines = []
    prev_score = None
    best_score = 0
    best_run = None
    worst_score = 100
    worst_run = None

    # 10개 초과 시 오래된 것 요약
    if len(history_runs) > 10:
        old_runs = history_runs[:-10]
        recent_runs = history_runs[-10:]
        old_scores = [f"Run {r['run_number']}: {round((r['score_total'] or 0)*100, 1)}%" for r in old_runs]
        lines.append(f"(이전 {len(old_runs)}회 요약) " + " → ".join(old_scores))
        lines.append("")
        display_runs = recent_runs
        # best/worst는 전체에서 계산
        for r in old_runs:
            s = round((r['score_total'] or 0) * 100, 1)
            if s > best_score:
                best_score = s
                best_run = r['run_number']
            if s < worst_score:
                worst_score = s
                worst_run = r['run_number']
    else:
        display_runs = history_runs

    for r in display_runs:
        score = round((r['score_total'] or 0) * 100, 1)
        diff_str = ""
        if prev_score is not None:
            diff = score - prev_score
            diff_str = f" ({'+' if diff >= 0 else ''}{diff:.1f})"
        else:
            diff_str = " (baseline)"

        annotation = ""
        direction = direction_map.get(r['run_number'], "")
        if direction:
            # 50자 이내로 축약
            annotation = f" — {direction[:50]}"

        lines.append(f"Run {r['run_number']}: {score}%{diff_str}{annotation}")
        prev_score = score

        if score > best_score:
            best_score = score
            best_run = r['run_number']
        if score < worst_score:
            worst_score = score
            worst_run = r['run_number']

    if best_run is not None:
        lines.append(f"★ Best: Run {best_run} ({best_score}%) | Worst: Run {worst_run} ({worst_score}%)")

    return "\n".join(lines)


def _build_pattern_list(
    phase6_data: list[dict], key: str, history_runs: list[dict]
) -> str:
    """양성(effective) 또는 음성(harmful) 피드백 패턴을 누적 집계.

    중복 제거 후 최대 5개만 유지. 각 항목에 출처 Run 번호 표기.
    """
    seen = {}  # pattern_text -> [run_numbers]
    for p6 in phase6_data:
        items = p6.get(key, [])
        if isinstance(items, list):
            for item in items:
                item_str = str(item).strip()
                if not item_str:
                    continue
                # 유사도 기반 중복 제거 대신, 앞 40자 기준으로 그룹핑
                short_key = item_str[:40]
                if short_key not in seen:
                    seen[short_key] = {"text": item_str, "runs": []}
                seen[short_key]["runs"].append(p6["run_number"])

    if not seen:
        return ""

    # 빈도순 정렬, 최대 5개
    sorted_items = sorted(seen.values(), key=lambda x: len(x["runs"]), reverse=True)[:5]

    lines = []
    for item in sorted_items:
        run_refs = ", ".join(f"Run {rn}" for rn in item["runs"])
        lines.append(f"- {item['text']} (출처: {run_refs})")

    return "\n".join(lines)


def _build_constraints(phase6_data: list[dict]) -> str:
    """전 Run에서 축적된 제약을 합쳐서 중복 제거."""
    constraints_set = set()
    for p6 in phase6_data:
        c = p6.get("constraints", "")
        if c and isinstance(c, str):
            # 줄 단위로 분리해서 개별 제약으로
            for line in c.strip().split("\n"):
                line = line.strip().lstrip("- ").strip()
                if line:
                    constraints_set.add(line)

    if not constraints_set:
        return ""

    # 최대 5개
    return "\n".join(f"- {c}" for c in list(constraints_set)[:5])


def _format_chronically_wrong(items: list[str]) -> str:
    if not items:
        return ""
    return ", ".join(items)


def _assemble_full_text(
    total_runs: int,
    score_timeline: str,
    best_run_summary: str,
    effective_patterns: str,
    regression_patterns: str,
    accumulated_constraints: str,
    chronically_wrong_text: str,
    char_budget: int,
) -> str:
    """섹션별 우선순위에 따라 char_budget 내에서 full_text를 조립."""
    header = f"═══ 실험 이력 종합 ({total_runs}회 실험) ═══\n"

    # 섹션별 우선순위: score_timeline > effective > regression > constraints > chronically_wrong > best_run
    sections = []

    if score_timeline:
        sections.append(("[점수 추이]", score_timeline))
    if best_run_summary:
        sections.append(("[최고 성적 Run 프롬프트 핵심]", best_run_summary))
    if effective_patterns:
        sections.append(("[누적 양성 피드백 — 효과 확인된 패턴]", effective_patterns))
    if regression_patterns:
        sections.append(("[누적 음성 피드백 — 회귀 유발 패턴]", regression_patterns))
    if accumulated_constraints:
        sections.append(("[축적 제약 — 반드시 유지]", accumulated_constraints))
    if chronically_wrong_text:
        sections.append(("[만성 오답 — 3회+ 연속 오답]", chronically_wrong_text))

    if not sections:
        return ""

    # char_budget 내에서 최대한 포함
    result = header
    remaining = char_budget - len(header)

    for title, content in sections:
        section_text = f"\n{title}\n{content}\n"
        if len(section_text) <= remaining:
            result += section_text
            remaining -= len(section_text)
        else:
            # 잘라서라도 넣기
            truncated = section_text[:remaining - 10] + "\n(...truncated)"
            result += truncated
            break

    return result.strip()
