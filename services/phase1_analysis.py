import asyncio
import json
import os
from collections import Counter
from datetime import datetime
from typing import AsyncGenerator
from database import get_db
from services.gpt_client import call_gpt, get_task_gpt_config, get_task_type, get_task_labels
from services.judge_api import JudgeAPIError, validate_generation_task
from services.phase4_judge import _exact_match_classify
from services.sse_helpers import log_event, progress_event, result_event, done_event, case_event, LogCollector

PROMPT_PATH = "prompts/phase1_analysis.txt"
PROMPT_PATH_CLASSIFICATION = "prompts/phase1_analysis_classification.txt"
CONCURRENT = 5   # 동시 GPT 호출 수


def load_prompt() -> str:
    with open(PROMPT_PATH, "r", encoding="utf-8") as f:
        return f.read()


def load_prompt_classification() -> str:
    with open(PROMPT_PATH_CLASSIFICATION, "r", encoding="utf-8") as f:
        return f.read()


def _format_label_list(labels: list) -> str:
    """라벨 리스트를 프롬프트 삽입용 문자열로."""
    if not labels:
        return "(라벨 집합 미지정)"
    return "[" + ", ".join(f'"{l}"' for l in labels) + "]"


def _format_label_definitions(defs: dict) -> str:
    """라벨 정의 dict를 프롬프트 삽입용 텍스트로."""
    if not defs:
        return "(라벨 정의 미지정)"
    lines = []
    for k, v in defs.items():
        lines.append(f'- "{k}": {v}')
    return "\n".join(lines)


def _detect_eval_field(cases: list) -> str:
    """JSON 케이스에서 오답/정답/과답 값이 들어있는 필드명 자동 감지."""
    eval_values = {"오답", "과답", "정답", "평가실패"}
    for field in ("evaluation", "answer_evaluation", "judge_result", "judge", "result"):
        if any(str(c.get(field, "")) in eval_values for c in cases[:20]):
            return field
    # fallback: 첫 케이스의 모든 필드 스캔
    if cases:
        for key, val in cases[0].items():
            if str(val) in eval_values:
                return key
    return "evaluation"


def _detect_reason_field(cases: list) -> str:
    """Judge reason/explanation 필드명 자동 감지."""
    for field in ("reason", "answer_evaluation_reason", "judge_reason", "evaluation_reason", "rationale", "explanation", "comment"):
        if any(isinstance(c.get(field), str) and c.get(field, "").strip() for c in cases[:10]):
            return field
    return "reason"


async def _call_gpt_case_classification(
    case: dict, prompt_template: str,
    label_list_text: str, label_defs_text: str,
    current_prompt: str = "", generation_task: str = "",
    intermediate_outputs: str = "",
    gpt_config: dict | None = None,
    reasoning: str = "high",
) -> dict:
    """분류 케이스 단일 분석. DB 조작 없음."""
    case_prompt = prompt_template.format(
        stt=case.get("stt", ""),
        reference=case.get("reference", ""),
        keywords=case.get("keywords", ""),
        generated=case.get("generated", ""),
        case_id=case.get("id", ""),
        current_prompt=current_prompt,
        generation_task=generation_task,
        intermediate_outputs=intermediate_outputs or "(중간 출력 없음)",
        label_list=label_list_text,
        label_definitions=label_defs_text,
    )
    raw = await call_gpt([{"role": "user", "content": case_prompt}], reasoning=reasoning, **(gpt_config or {}))
    result = _extract_json(raw)
    result["case_id"] = str(case.get("id", ""))
    return result


async def _call_gpt_case(case: dict, prompt_template: str, eval_field: str, reason_field: str,
                         current_prompt: str = "", generation_task: str = "",
                         intermediate_outputs: str = "",
                         gpt_config: dict | None = None,
                         reasoning: str = "high") -> dict:
    """단일 케이스 GPT 분석. DB 조작 없음 — asyncio.gather에서 병렬 실행 가능."""
    case_prompt = prompt_template.format(
        stt=case.get("stt", ""),
        reference=case.get("reference", ""),
        keywords=case.get("keywords", ""),
        generated=case.get("generated", ""),
        judge_evaluation=case.get(eval_field, ""),
        judge_reason=case.get(reason_field, ""),
        case_id=case.get("id", ""),
        current_prompt=current_prompt,
        generation_task=generation_task,
        intermediate_outputs=intermediate_outputs or "(중간 출력 없음)",
    )
    raw = await call_gpt([{"role": "user", "content": case_prompt}], reasoning=reasoning, **(gpt_config or {}))
    result = _extract_json(raw)
    result["case_id"] = str(case.get("id", ""))  # case_id 항상 보장
    return result


async def run_phase1(run_id: int, reasoning: str = "high") -> AsyncGenerator[str, None]:
    collector = LogCollector()
    db = await get_db()
    try:
        async with db.execute("SELECT * FROM runs WHERE id=?", (run_id,)) as cursor:
            run = dict(await cursor.fetchone())

        # 요약 Task 조회 (모든 분석에서 반복 참조)
        async with db.execute("SELECT * FROM tasks WHERE id=?", (run["task_id"],)) as cursor:
            task = dict(await cursor.fetchone())
        generation_task = task.get("generation_task", "")

        # Task 유형 + 분류 라벨 메타데이터
        task_type = await get_task_type(run_id)
        is_classification = task_type == "classification"
        labels_meta = await get_task_labels(run_id) if is_classification else {"label_list": [], "label_definitions": {}}
        label_list = labels_meta.get("label_list", [])
        label_defs = labels_meta.get("label_definitions", {})
        label_list_text = _format_label_list(label_list)
        label_defs_text = _format_label_definitions(label_defs)

        # 실험별 GPT 설정 로드
        gpt_config = await get_task_gpt_config(run_id)

        # phase_result 초기화 (기존 output_data 보존)
        await db.execute(
            """INSERT INTO phase_results (run_id, phase, status, started_at)
               VALUES (?,1,'running',?)
               ON CONFLICT(run_id, phase) DO UPDATE SET status='running', started_at=excluded.started_at""",
            (run_id, datetime.utcnow().isoformat())
        )
        await db.commit()

        await db.execute("UPDATE runs SET status='phase1_running', current_phase=1 WHERE id=?", (run_id,))
        await db.commit()

        judge_file = run.get("judge_file_path")
        if not judge_file or not os.path.exists(judge_file):
            yield collector.log("error", "Judge JSON 파일이 없습니다. 먼저 업로드하세요.")
            yield done_event("failed")
            await _mark_phase_failed(run_id, 1)
            return

        # 현재 요약 프롬프트 읽기 (선택사항)
        current_prompt = ""
        prompt_file = run.get("prompt_file_path")
        if prompt_file and os.path.exists(prompt_file):
            with open(prompt_file, "r", encoding="utf-8") as f:
                current_prompt = f.read().strip()
            yield collector.log("info", f"현재 요약 프롬프트 로드 완료 ({len(current_prompt)}자)")
        else:
            yield collector.log("warn", "현재 요약 프롬프트가 제공되지 않았습니다. 프롬프트 없이 분석합니다.")

        yield collector.log("info", "Judge JSON 파일 파싱 중...")
        with open(judge_file, "r", encoding="utf-8") as f:
            judge_data = json.load(f)

        # JSON 구조 정규화: 최상위가 dict이면 내부 list를 자동 추출
        if isinstance(judge_data, dict):
            list_values = [(k, v) for k, v in judge_data.items() if isinstance(v, list)]
            if list_values:
                key, judge_data = max(list_values, key=lambda x: len(x[1]))
                yield collector.log("info", f"JSON 키 '{key}'에서 {len(judge_data)}개 케이스 추출")
            else:
                yield collector.log("error", f"JSON 형식 오류: dict에 list가 없습니다. 키 목록: {list(judge_data.keys())}")
                yield done_event("failed")
                await _mark_phase_failed(run_id, 1)
                return

        if not isinstance(judge_data, list):
            yield collector.log("error", f"JSON 형식 오류: list 또는 dict가 필요합니다. 실제 타입: {type(judge_data).__name__}")
            yield done_event("failed")
            await _mark_phase_failed(run_id, 1)
            return

        judge_data = [c for c in judge_data if isinstance(c, dict)]
        if not judge_data:
            yield collector.log("error", "JSON 파일에서 유효한 케이스(dict 형식)를 찾을 수 없습니다.")
            yield done_event("failed")
            await _mark_phase_failed(run_id, 1)
            return

        yield collector.log("info", f"감지된 필드: {list(judge_data[0].keys())}")

        # ── Task 유형별 판정 필드 결정 ────────────────────────────────────────
        if is_classification:
            yield collector.log("info", f"Task 유형: classification — 라벨 {len(label_list)}개")
            if not label_list:
                yield collector.log("warn", "라벨 집합(label_list)이 등록되지 않았습니다. Task 설정에서 라벨을 입력하세요.")
            # 분류는 LLM Judge가 아닌 텍스트 일치로 판정 → 모든 케이스에 evaluation 채워넣음
            for c in judge_data:
                ev, rs = _exact_match_classify(c.get("reference", ""), c.get("generated", ""))
                c["__cls_eval__"] = ev
                c["__cls_reason__"] = rs
            eval_field = "__cls_eval__"
            reason_field = "__cls_reason__"
        else:
            # 판정/사유 필드명 자동 감지
            eval_field = _detect_eval_field(judge_data)
            reason_field = _detect_reason_field(judge_data)
        yield collector.log("info", f"판정 필드: '{eval_field}' | 사유 필드: '{reason_field}'")

        # ── Summarization: Judge JSON 의 generation_task 를 tasks 테이블과 동기화 ──
        # Phase 2 mini-validation 의 사전 검증이 tasks.generation_task 를 enum 검사하므로,
        # Judge JSON 에 유효한 값이 있으면 tasks 에 자동 반영해 스킵을 방지한다.
        if not is_classification:
            judge_gen_tasks = [
                str(c.get("generation_task", "")).strip()
                for c in judge_data
                if str(c.get("generation_task", "")).strip()
            ]
            if judge_gen_tasks:
                most_common_gt, mc_count = Counter(judge_gen_tasks).most_common(1)[0]
                try:
                    valid_gt = validate_generation_task(most_common_gt)
                except JudgeAPIError as e:
                    yield collector.log(
                        "warn",
                        f"Judge JSON 의 generation_task '{most_common_gt}' 가 Judge API enum 에 없습니다 — Task 설정값 유지: {e}"
                    )
                else:
                    current_gt = (task.get("generation_task") or "").strip()
                    if valid_gt != current_gt:
                        await db.execute(
                            "UPDATE tasks SET generation_task=? WHERE id=?",
                            (valid_gt, run["task_id"])
                        )
                        await db.commit()
                        task["generation_task"] = valid_gt
                        generation_task = valid_gt
                        yield collector.log(
                            "info",
                            f"generation_task 동기화: '{current_gt or '(빈 값)'}' → '{valid_gt}' "
                            f"(Judge JSON {mc_count}/{len(judge_gen_tasks)}건 기준)"
                        )
            else:
                yield collector.log(
                    "warn",
                    "Judge JSON 에 generation_task 필드가 비어 있습니다 — Phase 2 mini-validation 이 스킵될 수 있습니다."
                )

        # 오답/과답 케이스 추출 (분류는 과답 개념 없음 → 오답만)
        error_values = ("오답",) if is_classification else ("오답", "과답")
        error_cases = [c for c in judge_data if c.get(eval_field) in error_values]
        total_cases = len(judge_data)
        error_count = len(error_cases)

        yield collector.log("info", f"전체 {total_cases}건 중 오답 {error_count}건 분석 시작")

        # 재실행 시 기존 케이스 데이터 삭제 (이전 파일 데이터가 남지 않도록)
        await db.execute("DELETE FROM case_results WHERE run_id=?", (run_id,))
        await db.commit()

        # 전체 케이스 case_results에 저장
        for case in judge_data:
            await db.execute(
                """INSERT OR IGNORE INTO case_results
                   (run_id, case_id, generation_task, stt, reference, keywords, generated, evaluation, reason)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (run_id, str(case.get("id", "")), case.get("generation_task", ""),
                 case.get("stt", ""), case.get("reference", ""), case.get("keywords", ""),
                 case.get("generated", ""), case.get(eval_field, ""), case.get(reason_field, ""))
            )
        await db.commit()

        await db.execute("UPDATE runs SET total_cases=? WHERE id=?", (total_cases, run_id))
        await db.commit()

        # 정답 케이스 즉시 스트리밍 (GPT 분석 불필요)
        for case in judge_data:
            if case.get(eval_field) not in error_values:
                yield case_event({
                    "id": str(case.get("id", "")),
                    "judge": case.get(eval_field, ""),
                    "bucket": "",
                    "analysis_summary": "",
                    "stt_uncertain": "",
                    "stt": case.get("stt", ""),
                    "reference": case.get("reference", ""),
                    "generated": case.get("generated", ""),
                    "judge_disagreement": case.get(reason_field, ""),
                    "hallucination": False,
                })

        if error_count == 0:
            yield collector.log("ok", "오류 케이스가 없습니다. Phase 1 완료.")
            correct_count = sum(1 for c in judge_data if c.get(eval_field) == "정답")
            over_count    = sum(1 for c in judge_data if c.get(eval_field) == "과답")
            wrong_count   = sum(1 for c in judge_data if c.get(eval_field) == "오답")
            zero_summary = {
                "bucket_counts": {}, "top_issues": [], "prompt_improvable_cases": [],
                "judge_dispute_cases": [], "recommended_focus": "오류 케이스 없음",
                "task_type": task_type,
                "scores": {
                    "correct_plus_over": round((correct_count + over_count) / total_cases * 100, 1) if total_cases else 0,
                    "correct": round(correct_count / total_cases * 100, 1) if total_cases else 0,
                    "over":    round(over_count    / total_cases * 100, 1) if total_cases else 0,
                    "wrong":   round(wrong_count   / total_cases * 100, 1) if total_cases else 0,
                    "total": total_cases,
                    "correct_count": correct_count,
                    "over_count": over_count,
                    "wrong_count": wrong_count,
                },
                "eval_chart": {
                    "labels": ["정답", "오답"] if is_classification else ["정답", "과답", "오답"],
                    "values": [correct_count, wrong_count] if is_classification else [correct_count, over_count, wrong_count],
                },
                "bucket_chart": {
                    "labels": ["STT 오류", "프롬프트 누락", "모델 동작", "Judge 이견"],
                    "values": [0, 0, 0, 0],
                },
            }
            if is_classification:
                zero_summary["confusion_matrix"] = {"labels": label_list, "matrix": []}
                zero_summary["top_confusions"] = []
                zero_summary["error_cause_counts"] = {}
                zero_summary["schema_violation_count"] = 0
            await _mark_phase_completed(run_id, 1, zero_summary)
            await db.execute("UPDATE phase_results SET log_text=? WHERE run_id=? AND phase=1",
                             (collector.get_text(), run_id))
            await db.commit()
            yield result_event(zero_summary)
            yield done_event("completed")
            return

        prompt_template = load_prompt_classification() if is_classification else load_prompt()
        case_analyses = []
        sem = asyncio.Semaphore(CONCURRENT)

        # Continue 모드: 이전 Run의 intermediate_outputs 조회
        prev_intermediate_map = {}
        if run.get("base_run_id"):
            try:
                async with db.execute(
                    "SELECT case_id, intermediate_outputs FROM case_results WHERE run_id=? AND intermediate_outputs IS NOT NULL",
                    (run["base_run_id"],)
                ) as cursor:
                    for row in await cursor.fetchall():
                        prev_intermediate_map[row["case_id"]] = row["intermediate_outputs"]
                if prev_intermediate_map:
                    yield collector.log("info", f"이전 Run의 중간 출력 {len(prev_intermediate_map)}건 로드됨")
            except Exception:
                pass  # 마이그레이션 전 DB 호환

        async def _analyze_with_sem(c):
            async with sem:
                # 이전 Run의 중간 출력 첨부
                case_intermediate = prev_intermediate_map.get(str(c.get("id", "")), "")
                if is_classification:
                    return await _call_gpt_case_classification(
                        c, prompt_template,
                        label_list_text=label_list_text,
                        label_defs_text=label_defs_text,
                        current_prompt=current_prompt,
                        generation_task=generation_task,
                        intermediate_outputs=case_intermediate,
                        gpt_config=gpt_config,
                        reasoning=reasoning,
                    )
                return await _call_gpt_case(c, prompt_template, eval_field, reason_field,
                                            current_prompt=current_prompt,
                                            generation_task=generation_task,
                                            intermediate_outputs=case_intermediate,
                                            gpt_config=gpt_config,
                                            reasoning=reasoning)

        # ── 배치 병렬 분석 ────────────────────────────────────────────────────
        done_count = 0
        for i in range(0, error_count, CONCURRENT):
            batch = error_cases[i:i + CONCURRENT]
            yield collector.log("info", f"케이스 {i+1}~{min(i+len(batch), error_count)} 병렬 분석 중...")

            outcomes = await asyncio.gather(
                *[_analyze_with_sem(c) for c in batch],
                return_exceptions=True
            )

            for case, outcome in zip(batch, outcomes):
                done_count += 1
                if isinstance(outcome, Exception):
                    yield collector.log("warn", f"케이스 {case.get('id', '?')} 분석 실패: {outcome}")
                    if is_classification:
                        result = {
                            "case_id": str(case.get("id", "")),
                            "error_cause": "prompt_missing",
                            "analysis_summary": "",
                            "key_signals_in_stt": [],
                            "missed_signals": [],
                            "overweighted_signals": [],
                            "label_in_schema": True,
                            "ref_label": case.get("reference", ""),
                            "pred_label": case.get("generated", ""),
                            "confusion_pair": f"{case.get('reference','')}→{case.get('generated','')}",
                        }
                    else:
                        result = {"case_id": str(case.get("id", "")), "bucket": "prompt_missing",
                                  "analysis_summary": "", "stt_uncertain_expressions": [],
                                  "hallucination_detected": False, "judge_agreement": True,
                                  "judge_dispute_reason": ""}
                else:
                    result = outcome

                # 필드 정규화
                stt_uncertain_list = result.get("stt_uncertain_expressions", [])
                stt_uncertain_str = (", ".join(stt_uncertain_list)
                                     if isinstance(stt_uncertain_list, list)
                                     else str(stt_uncertain_list))
                judge_disagree = ""
                if not result.get("judge_agreement", True):
                    judge_disagree = result.get("judge_dispute_reason", "")

                # 공통 분석 필드
                missing_instruction = result.get("missing_instruction", "")
                violated_instruction = result.get("violated_instruction", "")
                improvement_suggestion = result.get("improvement_suggestion", "")

                if is_classification:
                    # 분류 전용: bucket 컬럼에 error_cause를 저장 (UI 호환)
                    bucket_for_db = result.get("error_cause", "")
                    error_pattern = result.get("confusion_pair", "")
                    reference_criteria = ""  # 분류에서 미사용
                    content_gap = result.get("boundary_analysis", "")
                else:
                    bucket_for_db = result.get("bucket", "")
                    error_pattern = result.get("error_pattern", "")
                    reference_criteria = result.get("reference_criteria", "")
                    content_gap = result.get("content_gap", "")

                # ── DB 저장 (확장 필드 포함) ──
                await db.execute(
                    """UPDATE case_results
                       SET bucket=?, analysis_summary=?, stt_uncertain=?,
                           hallucination_detected=?, judge_agreement=?, judge_disagreement=?,
                           missing_instruction=?, violated_instruction=?,
                           error_pattern=?, improvement_suggestion=?,
                           reference_criteria=?, content_gap=?
                       WHERE run_id=? AND case_id=?""",
                    (bucket_for_db,
                     result.get("analysis_summary", ""),
                     stt_uncertain_str,
                     1 if result.get("hallucination_detected") else 0,
                     1 if result.get("judge_agreement", True) else 0,
                     judge_disagree,
                     missing_instruction,
                     violated_instruction,
                     error_pattern,
                     improvement_suggestion,
                     reference_criteria,
                     content_gap,
                     run_id, str(case.get("id", "")))
                )

                # 원문 텍스트도 result에 첨부 (summarize_all에서 활용)
                result["_stt"] = case.get("stt", "")
                result["_reference"] = case.get("reference", "")
                result["_generated"] = case.get("generated", "")
                result["_judge_evaluation"] = case.get(eval_field, "")
                case_analyses.append(result)

                if is_classification:
                    label_for_log = result.get("error_cause", "unknown")
                    sec = result.get("secondary_cause")
                    if sec:
                        label_for_log += f"+{sec}"
                    yield collector.log("ok", f"케이스 {case.get('id', '?')} → {label_for_log} ({result.get('confusion_pair','')})")
                    yield case_event({
                        "id": str(case.get("id", "")),
                        "judge": case.get(eval_field, ""),
                        "bucket": bucket_for_db,
                        "secondary_bucket": result.get("secondary_cause", ""),
                        "analysis_summary": result.get("analysis_summary", ""),
                        "stt_uncertain": stt_uncertain_str,
                        "stt": case.get("stt", ""),
                        "reference": case.get("reference", ""),
                        "generated": case.get("generated", ""),
                        "judge_disagreement": judge_disagree or case.get(reason_field, ""),
                        "hallucination": False,
                        "missing_instruction": missing_instruction,
                        "violated_instruction": violated_instruction,
                        "error_pattern": error_pattern,
                        "improvement_suggestion": improvement_suggestion,
                        # 분류 전용 필드
                        "ref_label": result.get("ref_label", case.get("reference", "")),
                        "pred_label": result.get("pred_label", case.get("generated", "")),
                        "confusion_pair": result.get("confusion_pair", ""),
                        "label_in_schema": result.get("label_in_schema", True),
                        "boundary_analysis": result.get("boundary_analysis", ""),
                    })
                else:
                    bucket_label = result.get("bucket", "unknown")
                    secondary = result.get("secondary_bucket")
                    if secondary:
                        bucket_label += f"+{secondary}"
                    yield collector.log("ok", f"케이스 {case.get('id', '?')} → {bucket_label}")
                    yield case_event({
                        "id": str(case.get("id", "")),
                        "judge": case.get(eval_field, ""),
                        "bucket": result.get("bucket", ""),
                        "secondary_bucket": result.get("secondary_bucket", ""),
                        "analysis_summary": result.get("analysis_summary", ""),
                        "stt_uncertain": stt_uncertain_str,
                        "stt": case.get("stt", ""),
                        "reference": case.get("reference", ""),
                        "generated": case.get("generated", ""),
                        "judge_disagreement": judge_disagree or case.get(reason_field, ""),
                        "hallucination": bool(result.get("hallucination_detected", False)),
                        "hallucination_detail": result.get("hallucination_detail", ""),
                        "missing_instruction": missing_instruction,
                        "violated_instruction": violated_instruction,
                        "error_pattern": error_pattern,
                        "improvement_suggestion": improvement_suggestion,
                    })

            await db.commit()
            yield progress_event(done_count, error_count)

        # ── 전체 패턴 요약 ────────────────────────────────────────────────────
        yield collector.log("info", "전체 패턴 요약 생성 중...")
        if is_classification:
            summary = await _summarize_all_classification(
                case_analyses, error_count,
                label_list=label_list,
                label_defs=label_defs,
                gpt_config=gpt_config,
                reasoning=reasoning,
            )
        else:
            summary = await _summarize_all(case_analyses, error_count, gpt_config=gpt_config, reasoning=reasoning)
        yield collector.log("ok", f"분석 완료 — 주요 이슈: {', '.join(summary.get('top_issues', []))}")

        # baseline 점수 추가
        correct_count = sum(1 for c in judge_data if c.get(eval_field) == "정답")
        over_count    = sum(1 for c in judge_data if c.get(eval_field) == "과답")
        wrong_count   = sum(1 for c in judge_data if c.get(eval_field) == "오답")
        summary["task_type"] = task_type
        summary["scores"] = {
            "correct_plus_over": round((correct_count + over_count) / total_cases * 100, 1) if total_cases else 0,
            "correct": round(correct_count / total_cases * 100, 1) if total_cases else 0,
            "over":    round(over_count    / total_cases * 100, 1) if total_cases else 0,
            "wrong":   round(wrong_count   / total_cases * 100, 1) if total_cases else 0,
            "total": total_cases,
            "correct_count": correct_count,
            "over_count": over_count,
            "wrong_count": wrong_count,
        }

        # 판정 분포 차트
        if is_classification:
            summary["eval_chart"] = {
                "labels": ["정답", "오답"],
                "values": [correct_count, wrong_count],
            }
            # 분류는 bucket_chart 대신 error_cause_chart 사용
            ec_counts = summary.get("error_cause_counts", {})
            summary["bucket_chart"] = {
                "labels": ["스키마 위반", "경계 혼동", "신호 누락", "신호 과대", "정의 부족", "프롬프트 부족", "모델 행동", "데이터 노이즈"],
                "values": [
                    ec_counts.get("label_unknown", 0),
                    ec_counts.get("boundary_confusion", 0),
                    ec_counts.get("signal_missed", 0),
                    ec_counts.get("signal_overweight", 0),
                    ec_counts.get("definition_gap", 0),
                    ec_counts.get("prompt_missing", 0),
                    ec_counts.get("model_behavior", 0),
                    ec_counts.get("data_noise", 0),
                ],
            }
        else:
            summary["eval_chart"] = {
                "labels": ["정답", "과답", "오답"],
                "values": [correct_count, over_count, wrong_count],
            }
            bucket_counts = summary.get("bucket_counts", {})
            summary["bucket_chart"] = {
                "labels": ["STT 오류", "프롬프트 누락", "모델 동작", "Judge 이견"],
                "values": [
                    bucket_counts.get("stt_error", 0),
                    bucket_counts.get("prompt_missing", 0),
                    bucket_counts.get("model_behavior", 0),
                    bucket_counts.get("judge_dispute", 0),
                ],
            }

        await _mark_phase_completed(run_id, 1, summary)
        await db.execute("UPDATE phase_results SET log_text=? WHERE run_id=? AND phase=1",
                         (collector.get_text(), run_id))
        await db.execute("UPDATE runs SET status='phase1_done' WHERE id=?", (run_id,))
        await db.commit()

        yield result_event(summary)
        yield done_event("completed")

    except Exception as e:
        yield collector.log("error", f"Phase 1 오류: {e}")
        yield done_event("failed")
        await _mark_phase_failed(run_id, 1)
    finally:
        await db.close()


def _extract_json(text: str) -> dict:
    """GPT 응답에서 JSON 블록 추출 (```json ... ``` 코드펜스 포함 처리)."""
    if not text:
        return {}
    # ```json ... ``` 코드펜스 제거
    import re
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        try:
            return json.loads(fence.group(1))
        except Exception:
            pass
    # 일반 JSON 추출
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end])
        except Exception:
            pass
    return {}


async def _summarize_all(case_analyses: list, n: int, gpt_config: dict | None = None, reasoning: str = "high") -> dict:
    """
    버킷별 집계는 직접 계산 (GPT 의존 없음).
    top_issues / recommended_focus만 GPT에게 요청.
    prompt_improvable_cases에 원문 텍스트 + 구체적 분석 필드를 담아 Phase 2에서 활용.
    """
    # ── 직접 집계 ──────────────────────────────────────────────────────────────
    bucket_counts = {"stt_error": 0, "prompt_missing": 0, "model_behavior": 0, "judge_dispute": 0}
    prompt_improvable = []
    judge_dispute_list = []
    error_pattern_groups = {}  # 오류 패턴별 그룹핑

    reference_criteria_samples = []
    content_gap_samples = []

    for a in case_analyses:
        b = a.get("bucket", "")
        if b in bucket_counts:
            bucket_counts[b] += 1
        # secondary_bucket도 집계
        sb = a.get("secondary_bucket")
        if sb and sb in bucket_counts:
            bucket_counts[sb] += 0.5  # 보조 원인은 0.5로 카운트

        # 오류 패턴 그룹핑
        ep = a.get("error_pattern", "")
        if ep:
            error_pattern_groups.setdefault(ep, []).append(a.get("case_id", ""))

        # Reference 요약 기준 분석 수집
        rc = a.get("reference_criteria", "")
        if rc:
            reference_criteria_samples.append(rc)
        cg = a.get("content_gap", "")
        if cg:
            content_gap_samples.append(cg)

        # 프롬프트로 개선 가능한 케이스 (prompt_missing / model_behavior)
        if b in ("prompt_missing", "model_behavior"):
            prompt_improvable.append({
                "case_id": a.get("case_id", ""),
                "bucket": b,
                "secondary_bucket": a.get("secondary_bucket"),
                "analysis_summary": a.get("analysis_summary", ""),
                "hallucination": bool(a.get("hallucination_detected", False)),
                "hallucination_detail": a.get("hallucination_detail", ""),
                "missing_instruction": a.get("missing_instruction", ""),
                "violated_instruction": a.get("violated_instruction", ""),
                "error_pattern": ep,
                "improvement_suggestion": a.get("improvement_suggestion", ""),
                "reference_criteria": a.get("reference_criteria", ""),
                "content_gap": a.get("content_gap", ""),
                # Phase 2에서 구체적 예시로 활용할 원문 텍스트
                "stt": a.get("_stt", ""),
                "reference": a.get("_reference", ""),
                "generated": a.get("_generated", ""),
            })
        # Judge 이견 케이스
        if b == "judge_dispute" or not a.get("judge_agreement", True):
            judge_dispute_list.append({
                "case_id": a.get("case_id", ""),
                "analysis_summary": a.get("analysis_summary", ""),
                "dispute_reason": a.get("judge_dispute_reason", ""),
            })

    # 오류 패턴 빈도순 정렬
    error_pattern_ranking = sorted(
        [{"pattern": k, "count": len(v), "case_ids": v} for k, v in error_pattern_groups.items()],
        key=lambda x: x["count"], reverse=True
    )

    # bucket_counts 정수화 (secondary로 인한 0.5 → 반올림)
    bucket_counts = {k: round(v) for k, v in bucket_counts.items()}

    # ── GPT: 정성적 요약만 요청 ────────────────────────────────────────────────
    # 내부 참조용 원문 필드는 제거하고 GPT에 전달
    analyses_for_gpt = []
    for a in case_analyses:
        filtered = {k: v for k, v in a.items() if not k.startswith("_")}
        analyses_for_gpt.append(filtered)

    analyses_text = json.dumps(analyses_for_gpt, ensure_ascii=False, indent=2)

    # Reference 요약 기준 샘플 텍스트 (GPT에 전달용, 최대 15개)
    ref_criteria_text = "\n".join(f"- {s}" for s in reference_criteria_samples[:15]) if reference_criteria_samples else "(없음)"
    content_gap_text = "\n".join(f"- {s}" for s in content_gap_samples[:15]) if content_gap_samples else "(없음)"

    prompt = f"""아래는 오답/과답 케이스 {n}개의 분석 데이터다.
이를 바탕으로 다음 JSON만 출력하라 (설명 없이 JSON만):
{{
  "top_issues": ["가장 자주 발생하는 오류 유형 설명 1", "설명 2", "설명 3"],
  "recommended_focus": "Phase 2 프롬프트 개선 시 가장 중요하게 다뤄야 할 방향. 구체적인 프롬프트 수정 방향을 포함하여 4~6문장으로 작성하라.",
  "reference_summary_criteria": "아래 [케이스별 Reference 요약 기준]을 종합하여, 상담사들이 공통으로 적용하는 요약 기준을 5~8문장으로 정리하라. 요약 Task의 목적에 따라 어떤 정보를 핵심으로 포함하고 어떤 정보를 생략하는지, LLM이 동일한 핵심 내용을 요약하려면 프롬프트에 어떤 지시가 필요한지를 포함하라. 문체나 종결어미 같은 표면적 형식이 아니라 내용 선별 기준에 집중하라.",
  "common_content_gaps": "아래 [요약 내용 차이 목록]을 종합하여, Generated가 Reference 대비 가장 자주 빠뜨리거나 불필요하게 추가하는 내용 패턴 3~5가지를 나열하라."
}}

[케이스별 Reference 요약 기준]
{ref_criteria_text}

[요약 내용 차이 목록]
{content_gap_text}

[분석 데이터]
{analyses_text}"""

    top_issues = []
    recommended_focus = ""
    reference_summary_criteria = ""
    common_content_gaps = ""
    try:
        raw = await call_gpt([{"role": "user", "content": prompt}], reasoning=reasoning, **(gpt_config or {}))
        gpt = _extract_json(raw)
        top_issues = gpt.get("top_issues", [])
        recommended_focus = gpt.get("recommended_focus", "")
        reference_summary_criteria = gpt.get("reference_summary_criteria", "")
        common_content_gaps = gpt.get("common_content_gaps", "")
    except Exception:
        # fallback: analysis_summary에서 대표 텍스트 추출
        top_issues = list({
            a.get("analysis_summary", "")[:60]
            for a in case_analyses[:5]
            if a.get("analysis_summary")
        })
        recommended_focus = "수동 확인 필요"

    return {
        "bucket_counts": bucket_counts,
        "top_issues": top_issues,
        "error_pattern_ranking": error_pattern_ranking,
        "prompt_improvable_cases": prompt_improvable,
        "judge_dispute_cases": judge_dispute_list,
        "recommended_focus": recommended_focus,
        "reference_summary_criteria": reference_summary_criteria,
        "common_content_gaps": common_content_gaps,
    }


async def _summarize_all_classification(
    case_analyses: list, n: int,
    label_list: list, label_defs: dict,
    gpt_config: dict | None = None, reasoning: str = "high",
) -> dict:
    """분류 전용 집계: confusion matrix, error_cause 분포, 신호 패턴, GPT 정성 요약."""
    # ── 직접 집계 ──────────────────────────────────────────────────────────────
    error_cause_counts: dict = {}
    confusion_counter: dict = {}      # "ref→pred" → count
    schema_violation_count = 0
    missed_signal_pool: list = []
    overweight_signal_pool: list = []
    prompt_improvable: list = []

    # confusion matrix 초기화 (label_list 순서 기준)
    label_idx = {l: i for i, l in enumerate(label_list)}
    n_labels = len(label_list)
    matrix = [[0 for _ in range(n_labels)] for _ in range(n_labels)] if n_labels else []

    for a in case_analyses:
        cause = a.get("error_cause", "")
        if cause:
            error_cause_counts[cause] = error_cause_counts.get(cause, 0) + 1
        sec = a.get("secondary_cause")
        if sec:
            error_cause_counts[sec] = error_cause_counts.get(sec, 0) + 0.5

        if a.get("label_in_schema") is False:
            schema_violation_count += 1

        ref_label = a.get("ref_label", "") or a.get("_reference", "")
        pred_label = a.get("pred_label", "") or a.get("_generated", "")
        if ref_label and pred_label:
            key = f"{ref_label}→{pred_label}"
            confusion_counter[key] = confusion_counter.get(key, 0) + 1
            # confusion matrix 채우기 (라벨 집합 안에 있는 경우만)
            if ref_label in label_idx and pred_label in label_idx:
                matrix[label_idx[ref_label]][label_idx[pred_label]] += 1

        # 신호 풀
        ms = a.get("missed_signals", [])
        if isinstance(ms, list):
            missed_signal_pool.extend([str(s) for s in ms if s])
        ows = a.get("overweighted_signals", [])
        if isinstance(ows, list):
            overweight_signal_pool.extend([str(s) for s in ows if s])

        # 프롬프트로 개선 가능한 케이스 (data_noise/label_unknown 제외)
        if cause not in ("data_noise",):
            prompt_improvable.append({
                "case_id": a.get("case_id", ""),
                "bucket": cause,                       # phase2 호환용
                "secondary_bucket": a.get("secondary_cause"),
                "ref_label": ref_label,
                "pred_label": pred_label,
                "confusion_pair": a.get("confusion_pair", f"{ref_label}→{pred_label}"),
                "error_cause": cause,
                "label_in_schema": a.get("label_in_schema", True),
                "key_signals_in_stt": a.get("key_signals_in_stt", []),
                "missed_signals": a.get("missed_signals", []),
                "overweighted_signals": a.get("overweighted_signals", []),
                "boundary_analysis": a.get("boundary_analysis", ""),
                "missing_instruction": a.get("missing_instruction", ""),
                "violated_instruction": a.get("violated_instruction", ""),
                "improvement_suggestion": a.get("improvement_suggestion", ""),
                "analysis_summary": a.get("analysis_summary", ""),
                "stt": a.get("_stt", ""),
                "reference": a.get("_reference", ""),
                "generated": a.get("_generated", ""),
                # phase2 호환 필드
                "error_pattern": a.get("confusion_pair", f"{ref_label}→{pred_label}"),
            })

    # error_cause_counts 정수화
    error_cause_counts = {k: round(v) for k, v in error_cause_counts.items()}

    # 혼동 쌍 빈도순
    top_confusions = sorted(
        [{"pair": k, "count": v} for k, v in confusion_counter.items()],
        key=lambda x: x["count"], reverse=True,
    )

    # 빈도 기반 신호 풀 상위
    def _top_freq(items: list, k: int = 10) -> list:
        from collections import Counter
        c = Counter(items)
        return [{"text": t, "count": cnt} for t, cnt in c.most_common(k)]

    missed_signals_top = _top_freq(missed_signal_pool, 10)
    overweighted_signals_top = _top_freq(overweight_signal_pool, 10)

    # ── GPT: 정성적 요약 ───────────────────────────────────────────────────────
    analyses_for_gpt = []
    for a in case_analyses:
        filtered = {k: v for k, v in a.items() if not k.startswith("_")}
        analyses_for_gpt.append(filtered)
    analyses_text = json.dumps(analyses_for_gpt, ensure_ascii=False, indent=2)

    label_list_text = "[" + ", ".join(f'"{l}"' for l in label_list) + "]" if label_list else "(미지정)"
    label_defs_text = "\n".join(f'- "{k}": {v}' for k, v in label_defs.items()) if label_defs else "(미지정)"

    top_confusions_text = "\n".join(f"- {x['pair']}: {x['count']}건" for x in top_confusions[:10]) or "(없음)"
    missed_signals_text = "\n".join(f"- {x['text']} ({x['count']}회)" for x in missed_signals_top[:10]) or "(없음)"
    overweight_signals_text = "\n".join(f"- {x['text']} ({x['count']}회)" for x in overweighted_signals_top[:10]) or "(없음)"

    prompt = f"""아래는 분류(classification) 오답 케이스 {n}개의 분석 데이터다.
이를 바탕으로 다음 JSON만 출력하라 (설명 없이 JSON만):
{{
  "top_issues": ["가장 자주 발생하는 분류 오류 패턴 1", "패턴 2", "패턴 3"],
  "recommended_focus": "Phase 2 프롬프트 개선 시 가장 중요하게 다뤄야 할 방향. 어떤 혼동 쌍을 해결해야 하는지, 어떤 신호 가이드를 추가해야 하는지를 포함하여 4~6문장으로 작성하라.",
  "label_definition_gaps": "라벨 정의 자체가 모호하거나 부족해 보이는 라벨들을 지목하고, 어떤 변별 기준이 추가되어야 하는지 2~4문장으로 정리하라."
}}

[라벨 집합]
{label_list_text}

[라벨 정의]
{label_defs_text}

[혼동 쌍 빈도]
{top_confusions_text}

[자주 놓친 신호]
{missed_signals_text}

[자주 과대해석된 신호]
{overweight_signals_text}

[케이스별 분석 데이터]
{analyses_text}"""

    top_issues = []
    recommended_focus = ""
    label_definition_gaps = ""
    try:
        raw = await call_gpt([{"role": "user", "content": prompt}], reasoning=reasoning, **(gpt_config or {}))
        gpt = _extract_json(raw)
        top_issues = gpt.get("top_issues", [])
        recommended_focus = gpt.get("recommended_focus", "")
        label_definition_gaps = gpt.get("label_definition_gaps", "")
    except Exception:
        top_issues = [x["pair"] for x in top_confusions[:3]]
        recommended_focus = "혼동 라벨 쌍의 변별 규칙 강화 필요"

    return {
        "task_type": "classification",
        "label_list": label_list,
        "label_definitions": label_defs,
        # Phase 2 공통 필드 호환 (bucket_counts → error_cause_counts 매핑)
        "bucket_counts": error_cause_counts,
        "error_cause_counts": error_cause_counts,
        "error_pattern_ranking": [{"pattern": x["pair"], "count": x["count"], "case_ids": []} for x in top_confusions[:10]],
        "top_confusions": top_confusions,
        "confusion_matrix": {"labels": label_list, "matrix": matrix},
        "schema_violation_count": schema_violation_count,
        "missed_signals": missed_signals_top,
        "overweighted_signals": overweighted_signals_top,
        "top_issues": top_issues,
        "recommended_focus": recommended_focus,
        "label_definition_gaps": label_definition_gaps,
        "prompt_improvable_cases": prompt_improvable,
        "judge_dispute_cases": [],   # 분류는 judge_dispute 없음
    }


async def _mark_phase_completed(run_id: int, phase: int, output_data: dict):
    db = await get_db()
    try:
        await db.execute(
            """UPDATE phase_results SET status='completed', output_data=?, completed_at=?
               WHERE run_id=? AND phase=?""",
            (json.dumps(output_data, ensure_ascii=False), datetime.utcnow().isoformat(), run_id, phase)
        )
        await db.commit()
    finally:
        await db.close()


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
