"""
experiment_history.py — 전체 실험 이력 누적 피드백 집계 서비스 (증거 기반)

모든 이전 Run의 양성/음성 피드백을 **실제 케이스 증거**(case_deltas + case_results)와
함께 축적하여, Phase 2 (설계)와 Phase 6 (전략)에 검증 가능한 컨텍스트를 제공한다.
"""
import json
import logging
from database import get_db
from services.delta import get_run_scores

logger = logging.getLogger(__name__)

DEFAULT_MAX_TOKEN_BUDGET = 2000
CHARS_PER_TOKEN = 4


async def build_experiment_history(
    task_id: int,
    current_run_id: int,
    max_token_budget: int = DEFAULT_MAX_TOKEN_BUDGET,
) -> dict:
    """전체 실험 이력을 증거 기반으로 집계하여 GPT 주입용 텍스트로 반환."""
    empty = {
        "score_timeline": "",
        "best_run_summary": "",
        "effective_patterns": "",
        "regression_patterns": "",
        "accumulated_constraints": "",
        "chronically_wrong": "",
        "full_text": "",
    }

    history_runs = await get_run_scores(task_id, current_run_id)
    if not history_runs:
        return empty

    total_runs = len(history_runs)
    char_budget = max_token_budget * CHARS_PER_TOKEN

    # 데이터 수집 (DB에서 1차 데이터 직접 조회)
    phase6_data = await _collect_phase6_outputs(task_id)
    run_transitions = await _collect_run_transitions(task_id, current_run_id)
    chronically_wrong_cases = await _find_chronically_wrong_detailed(task_id, current_run_id)
    best_run_summary = await _get_best_run_summary(task_id, current_run_id)

    # 섹션별 텍스트 생성 (증거 포함)
    score_timeline = _build_score_timeline(history_runs, phase6_data)
    effective_patterns = _build_grounded_patterns(run_transitions, phase6_data, "improved")
    regression_patterns = _build_grounded_patterns(run_transitions, phase6_data, "regressed")
    accumulated_constraints = _build_grounded_constraints(phase6_data)
    chronically_wrong_text = _format_chronically_wrong_detailed(chronically_wrong_cases)

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


# ─── 데이터 수집 (DB 1차 데이터) ────────────────────────────────────────────


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


async def _collect_run_transitions(task_id: int, current_run_id: int) -> list[dict]:
    """각 Run 전환의 개선/회귀 케이스를 실제 case_results 증거와 함께 수집.

    case_deltas 테이블에서 improved/regressed 케이스를 가져오고,
    각 케이스의 reference, generated, error_pattern 스니펫을 case_results에서 조회.
    """
    db = await get_db()
    try:
        async with db.execute(
            """SELECT cd.from_run_id, cd.to_run_id, cd.case_id,
                      cd.prev_evaluation, cd.curr_evaluation, cd.delta_type,
                      r_from.run_number as from_run_number,
                      r_to.run_number as to_run_number,
                      r_from.score_total as from_score,
                      r_to.score_total as to_score
               FROM case_deltas cd
               JOIN runs r_from ON r_from.id = cd.from_run_id
               JOIN runs r_to ON r_to.id = cd.to_run_id
               WHERE cd.task_id=? AND cd.to_run_id != ?
                 AND cd.delta_type IN ('improved', 'regressed')
               ORDER BY r_to.run_number""",
            (task_id, current_run_id)
        ) as cursor:
            all_deltas = [dict(row) for row in await cursor.fetchall()]

        # to_run_id별로 그룹핑
        transitions_map = {}
        for d in all_deltas:
            key = d["to_run_id"]
            if key not in transitions_map:
                transitions_map[key] = {
                    "from_run_number": d["from_run_number"],
                    "to_run_number": d["to_run_number"],
                    "from_score": d["from_score"],
                    "to_score": d["to_score"],
                    "to_run_id": key,
                    "improved": [],
                    "regressed": [],
                }
            transitions_map[key][d["delta_type"]].append(d)

        # 각 전환의 상위 케이스에 case_results 증거 붙이기
        for to_run_id, trans in transitions_map.items():
            for dtype in ["improved", "regressed"]:
                for case_delta in trans[dtype][:3]:  # 전환당 최대 3개
                    async with db.execute(
                        """SELECT stt, reference, generated, error_pattern
                           FROM case_results WHERE run_id=? AND case_id=?""",
                        (to_run_id, case_delta["case_id"])
                    ) as cursor:
                        cr = await cursor.fetchone()
                    if cr:
                        cr = dict(cr)
                        case_delta["reference_snippet"] = (cr.get("reference") or "")[:80]
                        case_delta["generated_snippet"] = (cr.get("generated") or "")[:80]
                        case_delta["error_pattern"] = cr.get("error_pattern") or ""

        return sorted(transitions_map.values(), key=lambda t: t["to_run_number"])
    finally:
        await db.close()


async def _find_chronically_wrong_detailed(task_id: int, current_run_id: int) -> list[dict]:
    """3회+ 오답인 case_id의 상세 정보 (stt, reference, generated, error_pattern 포함)."""
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
               LIMIT 10""",
            (task_id, current_run_id)
        ) as cursor:
            chronic_cases = [dict(row) for row in await cursor.fetchall()]

        # 각 만성 오답 케이스의 최근 case_results 상세 조회
        for case in chronic_cases:
            async with db.execute(
                """SELECT cr.stt, cr.reference, cr.generated, cr.error_pattern, cr.reason
                   FROM case_results cr
                   JOIN runs r ON r.id = cr.run_id
                   WHERE r.task_id=? AND cr.case_id=?
                   ORDER BY r.run_number DESC LIMIT 1""",
                (task_id, case["case_id"])
            ) as cursor:
                latest = await cursor.fetchone()
            if latest:
                latest = dict(latest)
                case["stt_snippet"] = (latest.get("stt") or "")[:120]
                case["reference_snippet"] = (latest.get("reference") or "")[:120]
                case["generated_snippet"] = (latest.get("generated") or "")[:120]
                case["error_pattern"] = latest.get("error_pattern") or ""
                case["reason"] = latest.get("reason") or ""

        return chronic_cases
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
            """SELECT node_count,
                      node_a_system_prompt, node_a_user_prompt,
                      node_b_system_prompt, node_b_user_prompt,
                      node_c_system_prompt, node_c_user_prompt
               FROM prompt_candidates WHERE id=?""",
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
                parts.append(f"  Node {label.upper()}: {combined[:200]}")
        return "\n".join(parts)
    finally:
        await db.close()


# ─── 텍스트 포맷팅 (증거 기반) ──────────────────────────────────────────────


def _build_score_timeline(history_runs: list[dict], phase6_data: list[dict]) -> str:
    """점수 추이 + 변경 요약 어노테이션."""
    direction_map = {p6["run_number"]: p6.get("next_direction", "") for p6 in phase6_data}

    lines = []
    prev_score = None
    best_score = 0
    best_run = None
    worst_score = 100
    worst_run = None

    if len(history_runs) > 10:
        old_runs = history_runs[:-10]
        recent_runs = history_runs[-10:]
        old_scores = [
            f"Run {r['run_number']}: {round((r['score_total'] or 0)*100, 1)}%"
            for r in old_runs
        ]
        lines.append(f"(이전 {len(old_runs)}회 요약) " + " → ".join(old_scores))
        lines.append("")
        display_runs = recent_runs
        for r in old_runs:
            s = round((r['score_total'] or 0) * 100, 1)
            if s > best_score:
                best_score, best_run = s, r['run_number']
            if s < worst_score:
                worst_score, worst_run = s, r['run_number']
    else:
        display_runs = history_runs

    for r in display_runs:
        score = round((r['score_total'] or 0) * 100, 1)
        if prev_score is not None:
            diff = score - prev_score
            diff_str = f" ({'+' if diff >= 0 else ''}{diff:.1f})"
        else:
            diff_str = " (baseline)"

        annotation = ""
        direction = direction_map.get(r['run_number'], "")
        if direction:
            annotation = f" — {direction[:50]}"

        lines.append(f"Run {r['run_number']}: {score}%{diff_str}{annotation}")
        prev_score = score

        if score > best_score:
            best_score, best_run = score, r['run_number']
        if score < worst_score:
            worst_score, worst_run = score, r['run_number']

    if best_run is not None:
        lines.append(
            f"★ Best: Run {best_run} ({best_score}%) | Worst: Run {worst_run} ({worst_score}%)"
        )

    return "\n".join(lines)


def _build_grounded_patterns(
    transitions: list[dict], phase6_data: list[dict], delta_type: str
) -> str:
    """증거 기반 양성/음성 패턴 구축.

    Phase 6의 분석(2차 판단)을 참고로 표시하되,
    실제 case_deltas의 evaluation 변화 + case_results의 reference/generated 스니펫을
    1차 증거로 함께 제공한다.
    """
    p6_by_run = {p6["run_number"]: p6 for p6 in phase6_data}
    p6_key = "effective" if delta_type == "improved" else "harmful"

    relevant = [t for t in transitions if t.get(delta_type)]
    if not relevant:
        return ""

    # 최근 5개 전환만
    relevant = relevant[-5:]

    lines = []
    for trans in relevant:
        from_score = round((trans["from_score"] or 0) * 100, 1)
        to_score = round((trans["to_score"] or 0) * 100, 1)
        diff = to_score - from_score
        diff_str = f"{'+' if diff >= 0 else ''}{diff:.1f}"
        case_count = len(trans[delta_type])

        header = f"• Run {trans['from_run_number']}→{trans['to_run_number']} ({diff_str}%, {delta_type} {case_count}건)"
        lines.append(header)

        # Phase 6 분석 참고 (있으면, 2차 판단임을 명시)
        p6 = p6_by_run.get(trans["to_run_number"])
        if p6:
            items = p6.get(p6_key, [])
            if items:
                p6_summary = "; ".join(str(i)[:60] for i in items[:2])
                lines.append(f"  Phase6 분석: {p6_summary}")

        # 1차 증거: 실제 케이스의 evaluation 변화 + ref/gen 스니펫
        for case in trans[delta_type][:2]:
            ref = case.get("reference_snippet", "")
            gen = case.get("generated_snippet", "")
            err = case.get("error_pattern", "")
            case_line = f"  [{case['case_id']}] {case['prev_evaluation']}→{case['curr_evaluation']}"
            if err:
                case_line += f" ({err})"
            lines.append(case_line)
            if ref:
                lines.append(f"    ref: \"{ref}\"")
            if gen:
                lines.append(f"    gen: \"{gen}\"")

    return "\n".join(lines)


def _build_grounded_constraints(phase6_data: list[dict]) -> str:
    """전 Run에서 축적된 제약을 출처 Run 번호와 함께 정리."""
    constraints = []
    seen = set()
    for p6 in phase6_data:
        c = p6.get("constraints", "")
        if c and isinstance(c, str):
            for line in c.strip().split("\n"):
                line = line.strip().lstrip("- ").strip()
                if line and line[:30] not in seen:
                    seen.add(line[:30])
                    constraints.append((line, p6["run_number"]))

    if not constraints:
        return ""

    return "\n".join(f"- {text} (Run {rn}에서 확인)" for text, rn in constraints[:5])


def _format_chronically_wrong_detailed(cases: list[dict]) -> str:
    """만성 오답 케이스를 stt/reference/generated/error_pattern과 함께 포맷."""
    if not cases:
        return ""

    lines = []
    for c in cases[:5]:
        header = f"• {c['case_id']} ({c['wrong_count']}회 오답)"
        err = c.get("error_pattern", "")
        if err:
            header += f" [{err}]"
        lines.append(header)

        stt = c.get("stt_snippet", "")
        ref = c.get("reference_snippet", "")
        gen = c.get("generated_snippet", "")
        if stt:
            lines.append(f"  stt: \"{stt}\"")
        if ref:
            lines.append(f"  ref: \"{ref}\"")
        if gen:
            lines.append(f"  gen(최근): \"{gen}\"")

    return "\n".join(lines)


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

    # 우선순위: 점수추이 > 양성증거 > 음성증거 > 제약 > 만성오답 > 최고Run
    sections = []
    if score_timeline:
        sections.append(("[점수 추이]", score_timeline))
    if effective_patterns:
        sections.append(("[누적 양성 피드백 — 증거 기반]", effective_patterns))
    if regression_patterns:
        sections.append(("[누적 음성 피드백 — 증거 기반]", regression_patterns))
    if accumulated_constraints:
        sections.append(("[축적 제약 — 반드시 유지]", accumulated_constraints))
    if chronically_wrong_text:
        sections.append(("[만성 오답 — 상세]", chronically_wrong_text))
    if best_run_summary:
        sections.append(("[최고 성적 Run 프롬프트 핵심]", best_run_summary))

    if not sections:
        return ""

    result = header
    remaining = char_budget - len(header)

    for title, content in sections:
        section_text = f"\n{title}\n{content}\n"
        if len(section_text) <= remaining:
            result += section_text
            remaining -= len(section_text)
        else:
            truncated = section_text[:remaining - 10] + "\n(...truncated)"
            result += truncated
            break

    return result.strip()
