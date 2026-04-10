import json
from datetime import datetime
from typing import AsyncGenerator
from database import get_db
from services.gpt_client import get_task_type
from services.delta import compute_and_save_deltas, aggregate_scores
from services.judge_api import (
    JudgeAPIError,
    run_judge_for_cases,
    validate_generation_task,
)
from services.sse_helpers import log_event, progress_event, result_event, done_event, LogCollector


def _normalize_label(text: str) -> str:
    """Classification 정답 비교용 정규화: 양끝 공백/구두점 제거 + 소문자 + 내부 공백 1칸."""
    import re
    s = (text or "").strip().lower()
    # 양끝의 흔한 구두점/괄호 제거
    s = s.strip("\"'`.,;:!?()[]{}<>「」『』〔〕【】")
    # 내부 연속 공백을 한 칸으로
    s = re.sub(r"\s+", " ", s)
    return s


def _exact_match_classify(reference: str, generated: str) -> tuple:
    """Classification 전용 텍스트 기반 정답 판정. (evaluation, reason) 튜플 반환."""
    ref = _normalize_label(reference)
    gen = _normalize_label(generated)
    if not ref:
        if not gen:
            return "정답", "reference 없음 — generated도 없음"
        return "오답", "reference 없음 — generated가 불필요한 라벨 생성"
    if not gen:
        return "오답", "라벨 없음"
    if ref == gen:
        return "정답", "라벨 일치"
    return "오답", f"라벨 불일치 (정답: {reference})"


async def run_phase4(run_id: int) -> AsyncGenerator[str, None]:
    collector = LogCollector()
    db = await get_db()
    try:
        async with db.execute("SELECT * FROM runs WHERE id=?", (run_id,)) as cursor:
            run = dict(await cursor.fetchone())

        async with db.execute(
            "SELECT * FROM case_results WHERE run_id=? AND generated IS NOT NULL AND generated != ''",
            (run_id,)
        ) as cursor:
            cases = [dict(row) for row in await cursor.fetchall()]

        if not cases:
            yield collector.log("error", "생성된 요약 데이터가 없습니다. Phase 3을 먼저 실행하세요.")
            yield done_event("failed")
            return

        await db.execute(
            """INSERT INTO phase_results (run_id, phase, status, started_at)
               VALUES (?,4,'running',?)
               ON CONFLICT(run_id, phase) DO UPDATE SET status='running', started_at=excluded.started_at""",
            (run_id, datetime.utcnow().isoformat())
        )
        await db.commit()
        await db.execute("UPDATE runs SET status='phase4_running', current_phase=4 WHERE id=?", (run_id,))
        await db.commit()

        # Task 유형 조회 (summarization | classification)
        task_type = await get_task_type(run_id)
        is_classification = task_type == "classification"

        total = len(cases)

        if is_classification:
            # ── Classification: 텍스트 일치 비교 (LLM/API 호출 없음) ──
            yield collector.log("info", f"Classification 정답 판정 시작: {total}건 (텍스트 일치 비교)")
            processed = 0
            for case in cases:
                ref = (case.get("reference") or "").strip()
                gen = (case.get("generated") or "").strip()
                evaluation, reason = _exact_match_classify(ref, gen)
                await db.execute(
                    "UPDATE case_results SET evaluation=?, reason=? WHERE run_id=? AND case_id=?",
                    (evaluation, reason, run_id, case["case_id"])
                )
                await db.commit()
                processed += 1
                yield collector.log("ok", f"판정: {evaluation}")
                yield progress_event(processed, total)
        else:
            # ── Summarization: LLM Judge API 사용 ──
            # generation_task 검증 (API enum)
            generation_task_value = ""
            for c in cases:
                if c.get("generation_task"):
                    generation_task_value = c["generation_task"]
                    break
            if not generation_task_value:
                # case에 없으면 task에서 다시 조회
                async with db.execute(
                    "SELECT t.generation_task FROM runs r JOIN tasks t ON t.id=r.task_id WHERE r.id=?",
                    (run_id,)
                ) as cursor:
                    row = await cursor.fetchone()
                generation_task_value = (row["generation_task"] if row else "") or ""

            try:
                gt = validate_generation_task(generation_task_value)
            except JudgeAPIError as e:
                yield collector.log("error", str(e))
                yield done_event("failed")
                return

            yield collector.log("info", f"Judge API 호출 시작: {total}건 (generation_task={gt})")
            yield progress_event(0, total)

            sub_dir = f"phase4/run_{run_id}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
            try:
                judge_cases, judge_summary = await run_judge_for_cases(
                    cases=cases,
                    generation_task=gt,
                    sub_dir=sub_dir,
                    request_id=f"run{run_id}",
                )
            except JudgeAPIError as e:
                yield collector.log("error", f"Judge API 실패: {e}")
                yield done_event("failed")
                return

            yield collector.log("ok", f"Judge API 응답 수신: {len(judge_cases)}건")

            # merged_final.json 의 cases 를 case_id 기준으로 매핑
            judge_map: dict[str, dict] = {}
            for jc in judge_cases:
                cid = str(jc.get("id", ""))
                if cid:
                    judge_map[cid] = jc

            unmatched = 0
            processed = 0
            for case in cases:
                cid = str(case.get("case_id", ""))
                jc = judge_map.get(cid)
                if not jc:
                    evaluation = "평가실패"
                    reason = "Judge 응답에 해당 id 없음"
                    unmatched += 1
                else:
                    evaluation = jc.get("answer_evaluation") or "평가실패"
                    reason = jc.get("answer_evaluation_reason") or ""

                await db.execute(
                    "UPDATE case_results SET evaluation=?, reason=? WHERE run_id=? AND case_id=?",
                    (evaluation, reason, run_id, case["case_id"])
                )
                processed += 1
                yield progress_event(processed, total)

            await db.commit()

            if unmatched:
                yield collector.log("warn", f"Judge 응답에 매칭되지 않은 id: {unmatched}건 → 평가실패 처리")

            if judge_summary:
                yield collector.log("info", f"Judge summary: {judge_summary}")

        # 점수 집계 (task_type 인지)
        scores = await aggregate_scores(run_id, task_type=task_type)
        if is_classification:
            yield collector.log("ok", f"점수 집계 완료 — 정답: {scores['score_correct']}% (오답:{scores['score_wrong']}%)")
        else:
            yield collector.log("ok", f"점수 집계 완료 — 정답+과답: {scores['score_total']}% (정답:{scores['score_correct']}% 과답:{scores['score_over']}%)")

        # runs 점수 업데이트
        await db.execute(
            "UPDATE runs SET score_correct=?, score_over=?, score_total=?, status='phase4_done' WHERE id=?",
            (scores["score_correct"] / 100, scores["score_over"] / 100, scores["score_total"] / 100, run_id)
        )
        await db.commit()

        # Delta 계산 (이전 완료 Run이 있으면)
        # 1순위: base_run_id (continue 모드), 2순위: 가장 최근 완료 Run
        prev_run_id = None
        if run.get("base_run_id"):
            prev_run_id = run["base_run_id"]
        else:
            async with db.execute(
                """SELECT id FROM runs WHERE task_id=? AND id != ? AND status IN ('completed','phase4_done','phase5_done','phase6_done')
                   ORDER BY run_number DESC LIMIT 1""",
                (run["task_id"], run_id)
            ) as cursor:
                prev_row = await cursor.fetchone()
            if prev_row:
                prev_run_id = prev_row["id"]

        if prev_run_id:
            yield collector.log("info", f"케이스별 Delta 계산 중... (비교 대상: Run #{prev_run_id})")
            await compute_and_save_deltas(run["task_id"], prev_run_id, run_id)
            yield collector.log("ok", "Delta 계산 완료")

        # BUG-2: 프론트 기대 필드명으로 변환 (correct_plus_over, correct, over, wrong, total)
        # classification은 over를 사용하지 않음 → correct_plus_over = correct
        frontend_scores = {
            "correct_plus_over": scores["score_total"],
            "correct": scores["score_correct"],
            "over": scores["score_over"],
            "wrong": scores.get("score_wrong", round(100 - scores["score_correct"] - scores["score_over"], 1)),
            "total": scores["total"],
            "task_type": task_type,
        }
        # 케이스 목록 조회 (프론트 테이블용)
        async with db.execute(
            """SELECT case_id, stt, reference, keywords, generation_task, generated, evaluation, reason, intermediate_outputs
               FROM case_results WHERE run_id=? ORDER BY rowid""",
            (run_id,)
        ) as cursor:
            result_cases = [dict(row) for row in await cursor.fetchall()]

        cases_list = [{
            "id": r["case_id"], "evaluation": r["evaluation"] or "",
            "reason": r["reason"] or "", "stt": r["stt"] or "",
            "reference": r["reference"] or "", "generated": r["generated"] or "",
            "keywords": r["keywords"] or "", "generation_task": r["generation_task"] or "",
            "intermediate_outputs": json.loads(r["intermediate_outputs"]) if r.get("intermediate_outputs") else {},
        } for r in result_cases]

        output = {"scores": frontend_scores, "cases": cases_list}
        await db.execute(
            "UPDATE phase_results SET status='completed', output_data=?, log_text=?, completed_at=? WHERE run_id=? AND phase=4",
            (json.dumps(output), collector.get_text(), datetime.utcnow().isoformat(), run_id)
        )
        await db.commit()

        yield result_event(output)
        yield done_event("completed")

    except Exception as e:
        yield collector.log("error", f"Phase 4 오류: {e}")
        yield done_event("failed")
        db2 = await get_db()
        try:
            await db2.execute("UPDATE phase_results SET status='failed' WHERE run_id=? AND phase=4", (run_id,))
            await db2.execute("UPDATE runs SET status='failed' WHERE id=?", (run_id,))
            await db2.commit()
        finally:
            await db2.close()
    finally:
        await db.close()
