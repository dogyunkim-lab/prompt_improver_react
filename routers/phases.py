import asyncio
import json
import logging
from datetime import datetime
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from database import get_db
from services.phase1_analysis import run_phase1
from services.phase2_design import run_phase2
from services.phase3_dify import run_phase3, verify_dify_connection  # noqa
from services.phase4_judge import run_phase4
from services.phase6_strategy import run_phase6
from services.delta import aggregate_scores, compute_and_save_deltas

logger = logging.getLogger(__name__)

router = APIRouter(tags=["phases"])


class PhaseRunBody(BaseModel):
    reasoning: str = "high"

# 각 run_id별 스트림 큐 저장
_stream_queues: dict[int, dict[int, asyncio.Queue]] = {}
# 실행 중인 백그라운드 태스크 (run_id, phase) → Task
_running_tasks: dict[tuple, asyncio.Task] = {}
# SSE 이벤트 로그 버퍼 — 새로고침 시 리플레이용
_event_buffers: dict[tuple, list] = {}


def get_queue(run_id: int, phase: int) -> asyncio.Queue:
    if run_id not in _stream_queues:
        _stream_queues[run_id] = {}
    if phase not in _stream_queues[run_id]:
        _stream_queues[run_id][phase] = asyncio.Queue()
    return _stream_queues[run_id][phase]


async def _run_and_queue(generator, run_id: int, phase: int):
    from services.sse_helpers import log_event as _le, done_event as _de
    key = (run_id, phase)
    _event_buffers[key] = []
    q = get_queue(run_id, phase)
    try:
        async for event in generator:
            _event_buffers.setdefault(key, []).append(event)
            await q.put(event)
    except asyncio.CancelledError:
        # 제너레이터 명시적 종료 → 내부 finally 블록에서 pending tasks 정리
        try:
            await generator.aclose()
        except Exception:
            pass
        cancel_ev1 = _le("warn", "사용자가 Phase를 중단했습니다.")
        cancel_ev2 = _de("cancelled")
        _event_buffers.setdefault(key, []).extend([cancel_ev1, cancel_ev2])
        await q.put(cancel_ev1)
        await q.put(cancel_ev2)
        try:
            db = await get_db()
            await db.execute(
                "UPDATE phase_results SET status='cancelled', completed_at=? WHERE run_id=? AND phase=?",
                (datetime.utcnow().isoformat(), run_id, phase)
            )
            await db.execute("UPDATE runs SET status='failed' WHERE id=?", (run_id,))
            await db.commit()
            await db.close()
        except Exception:
            pass
    except Exception as e:
        logger.exception(f"[Phase {phase} / run {run_id}] 백그라운드 태스크 예외: {e}")
        # 예외 시에도 done(failed) 이벤트 전송 — 프론트엔드 stuck 방지
        err_ev1 = _le("error", f"Phase {phase} 내부 오류: {e}")
        err_ev2 = _de("failed")
        _event_buffers.setdefault(key, []).extend([err_ev1, err_ev2])
        await q.put(err_ev1)
        await q.put(err_ev2)
    finally:
        await q.put(None)
        _running_tasks.pop(key, None)
        # 버퍼는 유지 — 늦게 연결하는 클라이언트가 리플레이 가능
        # 다음 실행 시 _run_and_queue 시작부에서 초기화됨


def _create_phase_task(generator, run_id: int, phase: int) -> asyncio.Task:
    # 재실행 시 fresh queue 생성 (stale 이벤트/None 센티널 방지)
    if run_id not in _stream_queues:
        _stream_queues[run_id] = {}
    _stream_queues[run_id][phase] = asyncio.Queue()

    task = asyncio.create_task(_run_and_queue(generator, run_id, phase))
    _running_tasks[(run_id, phase)] = task


def _make_stream_response(run_id: int, phase: int):
    """SSE 스트림 응답 생성 — 버퍼 리플레이 후 큐 읽기 (중복 방지)."""
    q = get_queue(run_id, phase)
    key = (run_id, phase)

    async def generator():
        # 1) 버퍼 스냅샷 — 현재까지 축적된 이벤트
        buf = list(_event_buffers.get(key, []))
        buf_len = len(buf)

        # 2) 큐에서 버퍼에 해당하는 만큼 drain (중복 방지)
        drained = 0
        while drained < buf_len and not q.empty():
            try:
                item = q.get_nowait()
                drained += 1
                if item is None:
                    # 이미 완료된 Phase — 버퍼만 보내고 종료
                    for event in buf:
                        yield event
                    return
            except asyncio.QueueEmpty:
                break

        # 3) 버퍼 리플레이 (페이지 새로고침 시 이전 이벤트 복원)
        for event in buf:
            yield event

        # 4) 새 이벤트 수신 (버퍼에 없는 것만)
        while True:
            item = await q.get()
            if item is None:
                break
            yield item

    return StreamingResponse(generator(), media_type="text/event-stream",
                              headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── 중단 엔드포인트 ────────────────────────────────────────────────────────────

@router.post("/api/runs/{run_id}/phase/{phase}/cancel")
async def cancel_phase(run_id: int, phase: int):
    key = (run_id, phase)
    task = _running_tasks.get(key)
    if task and not task.done():
        task.cancel()
        return {"ok": True}
    return {"ok": False, "detail": "실행 중인 Phase가 없습니다"}


# ── Phase 1 ──────────────────────────────────────────────────────────────────

@router.post("/api/runs/{run_id}/phase/1/run")
async def trigger_phase1(run_id: int, body: PhaseRunBody = PhaseRunBody()):
    db = await get_db()
    try:
        async with db.execute("SELECT id FROM runs WHERE id=?", (run_id,)) as cursor:
            if not await cursor.fetchone():
                raise HTTPException(status_code=404, detail="Run not found")
    finally:
        await db.close()
    get_queue(run_id, 1)
    logger.info(f"[Phase 1] run_id={run_id}, reasoning={body.reasoning}")
    _create_phase_task(run_phase1(run_id, reasoning=body.reasoning), run_id, 1)
    return {"ok": True}


@router.get("/api/runs/{run_id}/phase/1/stream")
async def stream_phase1(run_id: int):
    return _make_stream_response(run_id, 1)


# ── Phase 2 ──────────────────────────────────────────────────────────────────

@router.post("/api/runs/{run_id}/phase/2/run")
async def trigger_phase2(run_id: int, body: PhaseRunBody = PhaseRunBody()):
    db = await get_db()
    try:
        async with db.execute(
            "SELECT status FROM phase_results WHERE run_id=? AND phase=1",
            (run_id,)
        ) as cursor:
            row = await cursor.fetchone()
        if not row or row["status"] != "completed":
            raise HTTPException(status_code=400, detail="Phase 1이 완료되지 않았습니다.")
    finally:
        await db.close()
    logger.info(f"[Phase 2] run_id={run_id}, reasoning={body.reasoning}")
    _create_phase_task(run_phase2(run_id, reasoning=body.reasoning), run_id, 2)
    return {"ok": True}


@router.get("/api/runs/{run_id}/phase/2/stream")
async def stream_phase2(run_id: int):
    return _make_stream_response(run_id, 2)


# ── 후보 선택 (Phase 2→3) ────────────────────────────────────────────────────

class SelectCandidateBody(BaseModel):
    candidate_id: int


@router.post("/api/runs/{run_id}/select-candidate")
async def select_candidate(run_id: int, body: SelectCandidateBody):
    db = await get_db()
    try:
        async with db.execute("SELECT id FROM runs WHERE id=?", (run_id,)) as cur:
            if not await cur.fetchone():
                raise HTTPException(status_code=404, detail="Run not found")
        async with db.execute(
            "SELECT id FROM prompt_candidates WHERE id=? AND run_id=?",
            (body.candidate_id, run_id)
        ) as cur:
            if not await cur.fetchone():
                raise HTTPException(status_code=404, detail="Candidate not found")
        await db.execute(
            "UPDATE runs SET selected_candidate_id=? WHERE id=?",
            (body.candidate_id, run_id)
        )
        await db.execute(
            "DELETE FROM dify_connections WHERE run_id=?", (run_id,)
        )
        await db.commit()
        return {"ok": True, "selected_candidate_id": body.candidate_id}
    finally:
        await db.close()


# ── 커스텀 후보 저장 ─────────────────────────────────────────────────────────

@router.post("/api/runs/{run_id}/custom-candidate")
async def save_custom_candidate(run_id: int, body: dict):
    """사용자가 직접 작성한 커스텀 후보를 저장하고 자동 선택한다."""
    db = await get_db()
    try:
        async with db.execute("SELECT id FROM runs WHERE id=?", (run_id,)) as cur:
            if not await cur.fetchone():
                raise HTTPException(status_code=404, detail="Run not found")

        nodes = body.get("nodes", [])
        node_count = body.get("node_count", len(nodes))
        if not nodes or node_count < 1 or node_count > 3:
            raise HTTPException(status_code=400, detail="노드는 1~3개여야 합니다.")

        # 기존 custom 후보 삭제 (run당 1개만)
        await db.execute(
            "DELETE FROM prompt_candidates WHERE run_id=? AND mode='custom'",
            (run_id,),
        )

        # flat 컬럼 매핑
        fields: dict[str, dict] = {"a": {}, "b": {}, "c": {}}
        for n in nodes:
            lbl = n.get("label", "").lower()
            if lbl in fields:
                sys_p = n.get("system_prompt", "")
                usr_p = n.get("user_prompt", "")
                combined = (sys_p + "\n\n" + usr_p).strip()
                fields[lbl] = {
                    "prompt": combined,
                    "system_prompt": sys_p,
                    "user_prompt": usr_p,
                    "input_vars": json.dumps(n.get("input_vars", []), ensure_ascii=False),
                    "output_var": n.get("output_var", ""),
                    "reasoning": 1 if n.get("reasoning") else 0,
                }

        async with db.execute(
            """INSERT INTO prompt_candidates
               (run_id, candidate_label, mode, workflow_spec, node_count,
                node_a_prompt, node_b_prompt, node_c_prompt,
                node_a_system_prompt, node_a_user_prompt, node_a_input_vars, node_a_output_var,
                node_b_system_prompt, node_b_user_prompt, node_b_input_vars, node_b_output_var,
                node_c_system_prompt, node_c_user_prompt, node_c_input_vars, node_c_output_var,
                node_a_reasoning, node_b_reasoning, node_c_reasoning, design_rationale)
               VALUES (?,?,?,?,?, ?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?, ?)""",
            (
                run_id, "custom", "custom", "", node_count,
                fields["a"].get("prompt"), fields["b"].get("prompt"), fields["c"].get("prompt"),
                fields["a"].get("system_prompt"), fields["a"].get("user_prompt"),
                fields["a"].get("input_vars"), fields["a"].get("output_var"),
                fields["b"].get("system_prompt"), fields["b"].get("user_prompt"),
                fields["b"].get("input_vars"), fields["b"].get("output_var"),
                fields["c"].get("system_prompt"), fields["c"].get("user_prompt"),
                fields["c"].get("input_vars"), fields["c"].get("output_var"),
                fields["a"].get("reasoning", 0), fields["b"].get("reasoning", 0),
                fields["c"].get("reasoning", 0),
                "사용자 커스텀 후보",
            ),
        ) as cursor:
            new_id = cursor.lastrowid

        # 자동 선택 + dify 연결 리셋
        await db.execute("UPDATE runs SET selected_candidate_id=? WHERE id=?", (new_id, run_id))
        await db.execute("DELETE FROM dify_connections WHERE run_id=?", (run_id,))
        await db.commit()

        return {"ok": True, "candidate_id": new_id}
    finally:
        await db.close()


# ── Phase 3 ──────────────────────────────────────────────────────────────────

class DifyConnectBody(BaseModel):
    candidate_id: Optional[int] = None
    object_id: str          # Phase 2 설계 기반으로 생성한 Dify 워크플로우 고유 ID
    label: Optional[str] = None


@router.post("/api/runs/{run_id}/phase/3/connect")
async def connect_dify(run_id: int, body: DifyConnectBody):
    db = await get_db()
    try:
        verified, message = await verify_dify_connection(body.object_id)
        status = "verified" if verified else "failed"
        now = datetime.utcnow().isoformat() if verified else None

        # 같은 run의 기존 연결 삭제 후 새로 삽입 (재시도 지원)
        await db.execute("DELETE FROM dify_connections WHERE run_id=?", (run_id,))
        async with db.execute(
            """INSERT INTO dify_connections (run_id, candidate_id, object_id, label, status, verified_at)
               VALUES (?,?,?,?,?,?)""",
            (run_id, body.candidate_id, body.object_id, body.label, status, now)
        ) as cursor:
            conn_id = cursor.lastrowid
        await db.commit()
        return {"id": conn_id, "status": status, "verified": verified, "message": message}
    finally:
        await db.close()


@router.post("/api/runs/{run_id}/phase/3/execute")
async def execute_phase3(run_id: int):
    db = await get_db()
    try:
        async with db.execute(
            "SELECT status FROM phase_results WHERE run_id=? AND phase=2",
            (run_id,)
        ) as cursor:
            row = await cursor.fetchone()
        if not row or row["status"] != "completed":
            raise HTTPException(status_code=400, detail="Phase 2가 완료되지 않았습니다.")

        async with db.execute(
            "SELECT id FROM dify_connections WHERE run_id=? AND status='verified'",
            (run_id,)
        ) as cursor:
            if not await cursor.fetchone():
                raise HTTPException(status_code=400, detail="검증된 Dify 연결이 없습니다.")
    finally:
        await db.close()
    _create_phase_task(run_phase3(run_id), run_id, 3)
    return {"ok": True}


@router.get("/api/runs/{run_id}/phase/3/stream")
async def stream_phase3(run_id: int):
    return _make_stream_response(run_id, 3)


# ── Phase 4 ──────────────────────────────────────────────────────────────────

@router.post("/api/runs/{run_id}/phase/4/run")
async def trigger_phase4(run_id: int):
    db = await get_db()
    try:
        async with db.execute(
            "SELECT status FROM phase_results WHERE run_id=? AND phase=3",
            (run_id,)
        ) as cursor:
            row = await cursor.fetchone()
        if not row or row["status"] != "completed":
            raise HTTPException(status_code=400, detail="Phase 3이 완료되지 않았습니다.")
        # generated가 실제로 존재하는지 확인 (Phase 3 부분 실패 대응)
        async with db.execute(
            "SELECT COUNT(*) as cnt FROM case_results WHERE run_id=? AND generated IS NOT NULL AND generated != ''",
            (run_id,)
        ) as cursor:
            gen_count = (await cursor.fetchone())["cnt"]
        if gen_count == 0:
            raise HTTPException(status_code=400, detail="Phase 3에서 생성된 요약이 없습니다. Phase 3을 다시 실행하세요.")
    finally:
        await db.close()
    _create_phase_task(run_phase4(run_id), run_id, 4)
    return {"ok": True}


@router.get("/api/runs/{run_id}/phase/4/stream")
async def stream_phase4(run_id: int):
    return _make_stream_response(run_id, 4)


# ── Phase 5 ──────────────────────────────────────────────────────────────────

@router.get("/api/runs/{run_id}/phase/5")
async def get_phase5(run_id: int):
    db = await get_db()
    try:
        async with db.execute("SELECT * FROM runs WHERE id=?", (run_id,)) as cursor:
            run = await cursor.fetchone()
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        run = dict(run)

        scores = await aggregate_scores(run_id)

        async with db.execute(
            "SELECT * FROM runs WHERE task_id=? AND score_total IS NOT NULL ORDER BY run_number",
            (run["task_id"],)
        ) as cursor:
            task_history = [
                {"run_id": r["id"], "run_number": r["run_number"],
                 "score_total": round((r["score_total"] or 0) * 100, 1),
                 "start_mode": r["start_mode"]}
                for r in await cursor.fetchall()
            ]

        # Delta가 없으면 on-the-fly 계산 (Phase 4에서 누락된 경우 보완)
        async with db.execute(
            "SELECT COUNT(*) as cnt FROM case_deltas WHERE to_run_id=?", (run_id,)
        ) as cursor:
            delta_exists = (await cursor.fetchone())["cnt"] > 0

        if not delta_exists:
            # 이전 Run 탐색: 1순위 base_run_id, 2순위 가장 최근 완료 Run
            prev_run_id = None
            if run.get("base_run_id"):
                prev_run_id = run["base_run_id"]
            else:
                async with db.execute(
                    """SELECT id FROM runs WHERE task_id=? AND id != ?
                       AND status IN ('completed','phase4_done','phase5_done','phase6_done')
                       ORDER BY run_number DESC LIMIT 1""",
                    (run["task_id"], run_id)
                ) as cursor:
                    prev_row = await cursor.fetchone()
                if prev_row:
                    prev_run_id = prev_row["id"]
            if prev_run_id:
                logger.info(f"Phase 5: Run {run_id}의 Delta 없음 — Run {prev_run_id}과 비교하여 on-the-fly 계산")
                await compute_and_save_deltas(run["task_id"], prev_run_id, run_id)

        async with db.execute(
            "SELECT delta_type, COUNT(*) as cnt FROM case_deltas WHERE to_run_id=? GROUP BY delta_type",
            (run_id,)
        ) as cursor:
            delta_rows = {r["delta_type"]: r["cnt"] for r in await cursor.fetchall()}

        async with db.execute(
            """SELECT d.case_id, d.prev_evaluation, d.curr_evaluation, c.reason
               FROM case_deltas d LEFT JOIN case_results c ON c.run_id=? AND c.case_id=d.case_id
               WHERE d.to_run_id=? AND d.delta_type='regressed'""",
            (run_id, run_id)
        ) as cursor:
            regressed_cases = [
                {"case_id": r["case_id"], "prev": r["prev_evaluation"],
                 "curr": r["curr_evaluation"], "reason": r["reason"] or ""}
                for r in await cursor.fetchall()
            ]

        async with db.execute(
            """SELECT case_id, stt, reference, generated, evaluation, reason, intermediate_outputs
               FROM case_results WHERE run_id=? ORDER BY rowid""",
            (run_id,)
        ) as cursor:
            cases_rows = [dict(row) for row in await cursor.fetchall()]

        # 케이스별 delta 조회 (이전 판정 → 현재 판정)
        async with db.execute(
            "SELECT case_id, from_run_id, prev_evaluation, curr_evaluation, delta_type FROM case_deltas WHERE to_run_id=?",
            (run_id,)
        ) as cursor:
            delta_map = {r["case_id"]: dict(r) for r in await cursor.fetchall()}

        # 이전 Run의 generated 조회 (delta 비교용)
        prev_generated_map = {}
        prev_run_ids = set(d["from_run_id"] for d in delta_map.values() if d.get("from_run_id"))
        for prev_rid in prev_run_ids:
            async with db.execute(
                "SELECT case_id, generated FROM case_results WHERE run_id=?",
                (prev_rid,)
            ) as cursor:
                for row in await cursor.fetchall():
                    prev_generated_map[row["case_id"]] = row["generated"] or ""

        goal_achieved = scores["score_total"] >= 95.0

        cases_with_delta = []
        for c in cases_rows:
            d = delta_map.get(c["case_id"])
            io = {}
            try:
                if c.get("intermediate_outputs"):
                    io = json.loads(c["intermediate_outputs"])
            except Exception:
                pass
            cases_with_delta.append({
                "id": c["case_id"], "evaluation": c["evaluation"] or "",
                "reason": c["reason"] or "", "stt": c["stt"] or "",
                "reference": c["reference"] or "", "generated": c["generated"] or "",
                "prev_judge": d["prev_evaluation"] if d else None,
                "prev_generated": prev_generated_map.get(c["case_id"]) or "",
                "delta_type": d["delta_type"] if d else None,
                "intermediate_outputs": io,
            })

        # task_type 조회 (UI 표시 분기용)
        async with db.execute(
            "SELECT task_type FROM tasks WHERE id=?", (run["task_id"],)
        ) as cursor:
            t_row = await cursor.fetchone()
        task_type = (t_row["task_type"] if t_row and "task_type" in t_row.keys() else None) or "summarization"

        # BUG-3: 프론트 기대 구조로 전면 수정
        output = {
            "scores": {
                "correct_plus_over": scores["score_total"],
                "correct": scores["score_correct"],
                "over": scores["score_over"],
                "wrong": scores.get("score_wrong", round(100 - scores["score_correct"] - scores["score_over"], 1)),
            },
            "task_type": task_type,
            "delta": {
                "improve": delta_rows.get("improved", 0),
                "regress": delta_rows.get("regressed", 0),
                "same": delta_rows.get("unchanged", 0),
            },
            "trend": {
                "labels": [f"Run {r['run_number']}" for r in task_history],
                "values": [r["score_total"] for r in task_history],
            },
            "regressed_cases": [
                {
                    "id": r["case_id"],
                    "prev_judge": r["prev"],
                    "curr_judge": r["curr"],
                    "reason": r["reason"],
                }
                for r in regressed_cases
            ],
            "goal_achieved": goal_achieved,
            "gap_to_goal": round(max(0, 95.0 - scores["score_total"]), 1),
            "cases": cases_with_delta,
        }

        await db.execute(
            """INSERT INTO phase_results (run_id, phase, status, output_data, started_at, completed_at)
               VALUES (?,5,'completed',?,?,?)
               ON CONFLICT(run_id, phase) DO UPDATE SET status='completed', output_data=excluded.output_data, completed_at=excluded.completed_at""",
            (run_id, json.dumps(output), datetime.utcnow().isoformat(), datetime.utcnow().isoformat())
        )
        await db.execute("UPDATE runs SET status='phase5_done' WHERE id=?", (run_id,))
        await db.commit()

        return output
    finally:
        await db.close()


# ── Phase 6 ──────────────────────────────────────────────────────────────────

@router.post("/api/runs/{run_id}/phase/6/run")
async def trigger_phase6(run_id: int, body: PhaseRunBody = PhaseRunBody()):
    db = await get_db()
    try:
        async with db.execute(
            "SELECT status FROM phase_results WHERE run_id=? AND phase=4",
            (run_id,)
        ) as cursor:
            row = await cursor.fetchone()
        if not row or row["status"] != "completed":
            raise HTTPException(status_code=400, detail="Phase 4가 완료되지 않았습니다.")
    finally:
        await db.close()
    logger.info(f"[Phase 6] run_id={run_id}, reasoning={body.reasoning}")
    _create_phase_task(run_phase6(run_id, reasoning=body.reasoning), run_id, 6)
    return {"ok": True}


@router.get("/api/runs/{run_id}/phase/6/stream")
async def stream_phase6(run_id: int):
    return _make_stream_response(run_id, 6)
