from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import json
import os
from database import get_db


def _normalize_label_list(value: Any) -> Optional[str]:
    """label_list 입력을 JSON 문자열로 정규화. None이면 None 반환."""
    if value is None:
        return None
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return json.dumps([], ensure_ascii=False)
        # 콤마/줄바꿈 분리도 허용
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list):
                return json.dumps([str(x).strip() for x in parsed if str(x).strip()], ensure_ascii=False)
        except Exception:
            pass
        items = [t.strip() for t in s.replace("\n", ",").split(",") if t.strip()]
        return json.dumps(items, ensure_ascii=False)
    if isinstance(value, list):
        return json.dumps([str(x).strip() for x in value if str(x).strip()], ensure_ascii=False)
    return json.dumps([], ensure_ascii=False)


def _decode_task_row(row: Dict[str, Any]) -> Dict[str, Any]:
    """DB row의 label_list/label_definitions JSON 문자열을 list/dict로 파싱."""
    if "label_list" in row and isinstance(row.get("label_list"), str):
        try:
            row["label_list"] = json.loads(row["label_list"])
        except Exception:
            row["label_list"] = []
    if "label_definitions" in row and isinstance(row.get("label_definitions"), str):
        try:
            row["label_definitions"] = json.loads(row["label_definitions"])
        except Exception:
            row["label_definitions"] = {}
    return row


def _normalize_label_definitions(value: Any) -> Optional[str]:
    """label_definitions 입력을 JSON 문자열로 정규화."""
    if value is None:
        return None
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return json.dumps({}, ensure_ascii=False)
        try:
            parsed = json.loads(s)
            if isinstance(parsed, dict):
                return json.dumps({str(k): str(v) for k, v in parsed.items()}, ensure_ascii=False)
        except Exception:
            pass
        # "라벨: 정의" 줄 단위 파싱 폴백
        defs = {}
        for line in s.splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                k, v = k.strip(), v.strip()
                if k:
                    defs[k] = v
        return json.dumps(defs, ensure_ascii=False)
    if isinstance(value, dict):
        return json.dumps({str(k): str(v) for k, v in value.items()}, ensure_ascii=False)
    return json.dumps({}, ensure_ascii=False)

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

ANCHORS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "prompts", "anchors")


@router.get("/anchors/list")
async def list_anchors():
    """prompts/anchors/ 디렉토리의 .txt 파일 목록 반환."""
    if not os.path.isdir(ANCHORS_DIR):
        return []
    files = sorted(
        f for f in os.listdir(ANCHORS_DIR)
        if f.endswith(".txt") and os.path.isfile(os.path.join(ANCHORS_DIR, f))
    )
    return [{"filename": f, "name": f.rsplit(".", 1)[0]} for f in files]


class TaskCreate(BaseModel):
    name: str
    description: Optional[str] = None
    generation_task: Optional[str] = None
    task_type: Optional[str] = None  # 'summarization' | 'classification'
    gpt_api_base: Optional[str] = None
    gpt_api_key: Optional[str] = None
    gpt_model: Optional[str] = None
    sim_api_base: Optional[str] = None
    sim_api_key: Optional[str] = None
    sim_model: Optional[str] = None
    anchor_guide_file: Optional[str] = None
    # Classification 전용
    label_list: Optional[Any] = None          # list[str] | str(콤마/JSON)
    label_definitions: Optional[Any] = None   # dict[str,str] | str(JSON/줄단위)


@router.get("")
async def list_tasks():
    db = await get_db()
    try:
        async with db.execute("SELECT * FROM tasks ORDER BY created_at DESC") as cursor:
            tasks = [_decode_task_row(dict(row)) for row in await cursor.fetchall()]
        for task in tasks:
            async with db.execute(
                "SELECT id, run_number, status, score_total, start_mode, base_run_id, created_at FROM runs WHERE task_id=? ORDER BY run_number",
                (task["id"],)
            ) as cursor:
                task["runs"] = [dict(row) for row in await cursor.fetchall()]
        return tasks
    finally:
        await db.close()


@router.post("")
async def create_task(body: TaskCreate):
    db = await get_db()
    try:
        task_type = body.task_type if body.task_type in ("summarization", "classification") else "summarization"
        label_list_json = _normalize_label_list(body.label_list) if task_type == "classification" else None
        label_defs_json = _normalize_label_definitions(body.label_definitions) if task_type == "classification" else None
        async with db.execute(
            "INSERT INTO tasks (name, description, generation_task, task_type, gpt_api_base, gpt_api_key, gpt_model, sim_api_base, sim_api_key, sim_model, anchor_guide_file, label_list, label_definitions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (body.name, body.description, body.generation_task, task_type, body.gpt_api_base, body.gpt_api_key, body.gpt_model, body.sim_api_base, body.sim_api_key, body.sim_model, body.anchor_guide_file, label_list_json, label_defs_json)
        ) as cursor:
            task_id = cursor.lastrowid
        await db.commit()
        async with db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)) as cursor:
            return _decode_task_row(dict(await cursor.fetchone()))
    finally:
        await db.close()


@router.get("/{task_id}")
async def get_task(task_id: int):
    db = await get_db()
    try:
        async with db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)) as cursor:
            task = await cursor.fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        task = _decode_task_row(dict(task))
        async with db.execute(
            "SELECT * FROM runs WHERE task_id=? ORDER BY run_number",
            (task_id,)
        ) as cursor:
            task["runs"] = [dict(row) for row in await cursor.fetchall()]
        return task
    finally:
        await db.close()


class TaskUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    generation_task: Optional[str] = None
    task_type: Optional[str] = None  # 'summarization' | 'classification'
    gpt_api_base: Optional[str] = None
    gpt_api_key: Optional[str] = None
    gpt_model: Optional[str] = None
    sim_api_base: Optional[str] = None
    sim_api_key: Optional[str] = None
    sim_model: Optional[str] = None
    anchor_guide_file: Optional[str] = None
    label_list: Optional[Any] = None
    label_definitions: Optional[Any] = None


@router.patch("/{task_id}")
async def update_task(task_id: int, body: TaskUpdate):
    db = await get_db()
    try:
        async with db.execute("SELECT id FROM tasks WHERE id=?", (task_id,)) as cursor:
            if not await cursor.fetchone():
                raise HTTPException(status_code=404, detail="Task not found")

        updates = []
        values = []
        if body.name is not None:
            updates.append("name=?")
            values.append(body.name)
        if body.description is not None:
            updates.append("description=?")
            values.append(body.description)
        if body.generation_task is not None:
            updates.append("generation_task=?")
            values.append(body.generation_task)
        if body.task_type is not None and body.task_type in ("summarization", "classification"):
            updates.append("task_type=?")
            values.append(body.task_type)
        if body.gpt_api_base is not None:
            updates.append("gpt_api_base=?")
            values.append(body.gpt_api_base)
        if body.gpt_api_key is not None:
            updates.append("gpt_api_key=?")
            values.append(body.gpt_api_key)
        if body.gpt_model is not None:
            updates.append("gpt_model=?")
            values.append(body.gpt_model)
        if body.sim_api_base is not None:
            updates.append("sim_api_base=?")
            values.append(body.sim_api_base)
        if body.sim_api_key is not None:
            updates.append("sim_api_key=?")
            values.append(body.sim_api_key)
        if body.sim_model is not None:
            updates.append("sim_model=?")
            values.append(body.sim_model)
        if body.anchor_guide_file is not None:
            updates.append("anchor_guide_file=?")
            values.append(body.anchor_guide_file)
        if body.label_list is not None:
            updates.append("label_list=?")
            values.append(_normalize_label_list(body.label_list))
        if body.label_definitions is not None:
            updates.append("label_definitions=?")
            values.append(_normalize_label_definitions(body.label_definitions))

        if updates:
            values.append(task_id)
            await db.execute(f"UPDATE tasks SET {', '.join(updates)} WHERE id=?", values)
            await db.commit()

        async with db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)) as cursor:
            return _decode_task_row(dict(await cursor.fetchone()))
    finally:
        await db.close()


@router.delete("/{task_id}")
async def delete_task(task_id: int):
    db = await get_db()
    try:
        async with db.execute("SELECT id FROM tasks WHERE id=?", (task_id,)) as cursor:
            if not await cursor.fetchone():
                raise HTTPException(status_code=404, detail="Task not found")

        # 연관 데이터 cascade 삭제 (run_id 목록 먼저 수집)
        async with db.execute("SELECT id FROM runs WHERE task_id=?", (task_id,)) as cursor:
            run_ids = [row["id"] for row in await cursor.fetchall()]

        for run_id in run_ids:
            await db.execute("DELETE FROM case_results WHERE run_id=?", (run_id,))
            await db.execute("DELETE FROM phase_results WHERE run_id=?", (run_id,))
            await db.execute("DELETE FROM prompt_candidates WHERE run_id=?", (run_id,))
            await db.execute("DELETE FROM dify_connections WHERE run_id=?", (run_id,))

        await db.execute("DELETE FROM case_deltas WHERE task_id=?", (task_id,))
        await db.execute("DELETE FROM runs WHERE task_id=?", (task_id,))
        await db.execute("DELETE FROM tasks WHERE id=?", (task_id,))

        # SQLite autoincrement 카운터 리셋 (다음 id = 현재 최대+1)
        for tbl in ("tasks", "runs", "case_results", "phase_results", "prompt_candidates", "dify_connections", "case_deltas"):
            await db.execute(
                f"UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(id), 0) FROM {tbl}) WHERE name=?",
                (tbl,)
            )

        await db.commit()
        return {"ok": True}
    finally:
        await db.close()
