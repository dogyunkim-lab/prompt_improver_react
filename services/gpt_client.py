import re
import logging
from functools import lru_cache
from openai import AsyncOpenAI
from config import GPT_API_BASE, GPT_API_KEY, GPT_MODEL

logger = logging.getLogger(__name__)


def _build_extra_body(model_name: str, reasoning: str) -> dict:
    """모델 타입에 따라 적절한 extra_body를 생성."""
    model_lower = (model_name or "").lower()
    if "qwen" in model_lower:
        # Qwen 3.5: enable_thinking on/off (high/medium→True, low→False)
        enable = reasoning.lower() != "low"
        return {"chat_template_kwargs": {"enable_thinking": enable}}
    else:
        # GPT 계열: reasoning_effort (high/medium/low)
        return {"reasoning_effort": reasoning}


# api_key가 비어있으면 openai 클라이언트가 오류를 내므로 기본값 설정
_client = AsyncOpenAI(
    base_url=GPT_API_BASE,
    api_key=GPT_API_KEY if GPT_API_KEY else "none",
)


@lru_cache(maxsize=16)
def _get_client(api_base: str, api_key: str) -> AsyncOpenAI:
    """per-task 오버라이드용 클라이언트 (LRU 캐시 재사용)."""
    return AsyncOpenAI(base_url=api_base, api_key=api_key or "none")


async def call_gpt(messages: list, reasoning: str = "high", timeout: float = 180.0,
                   *, api_base: str | None = None, api_key: str | None = None,
                   model: str | None = None) -> str:
    client = _get_client(api_base, api_key) if api_base else _client
    use_model = model or GPT_MODEL
    use_base = api_base or GPT_API_BASE
    extra_body = _build_extra_body(use_model, reasoning)
    is_qwen = "qwen" in (use_model or "").lower()
    tag = "Qwen" if is_qwen else "GPT"
    if is_qwen:
        thinking_flag = "on" if extra_body.get("chat_template_kwargs", {}).get("enable_thinking") else "off"
        logger.info(f"[{tag}] POST {use_base}/chat/completions  model={use_model}  thinking={thinking_flag}")
    else:
        logger.info(f"[{tag}] POST {use_base}/chat/completions  model={use_model}  reasoning={reasoning}")
    try:
        response = await client.chat.completions.create(
            model=use_model,
            messages=messages,
            extra_body=extra_body,
            timeout=timeout,
        )
        content = response.choices[0].message.content
        # Qwen thinking 모드: <think>...</think> 태그 제거 (downstream JSON 파싱 오류 방지)
        if is_qwen and content and "<think>" in content:
            content = re.sub(r"<think>.*?</think>\s*", "", content, flags=re.DOTALL)
        return content
    except Exception as e:
        msg = f"{tag} 호출 오류 — {use_base}  {type(e).__name__}: {e}"
        logger.error(msg)
        raise RuntimeError(msg) from e


async def get_task_gpt_config(run_id: int) -> dict:
    """run_id에서 task의 GPT 설정 조회. 없으면 빈 dict 반환."""
    from database import get_db
    db = await get_db()
    try:
        async with db.execute(
            """SELECT t.gpt_api_base, t.gpt_api_key, t.gpt_model
               FROM runs r JOIN tasks t ON t.id = r.task_id
               WHERE r.id=?""",
            (run_id,)
        ) as cursor:
            row = await cursor.fetchone()
        if not row:
            return {}
        cfg = {}
        if row["gpt_api_base"]:
            cfg["api_base"] = row["gpt_api_base"]
        if row["gpt_api_key"]:
            cfg["api_key"] = row["gpt_api_key"]
        if row["gpt_model"]:
            cfg["model"] = row["gpt_model"]
        return cfg
    finally:
        await db.close()


async def get_task_type(run_id: int) -> str:
    """run_id에서 task의 task_type 조회. 기본값은 'summarization'."""
    from database import get_db
    db = await get_db()
    try:
        async with db.execute(
            """SELECT t.task_type FROM runs r JOIN tasks t ON t.id = r.task_id WHERE r.id=?""",
            (run_id,)
        ) as cursor:
            row = await cursor.fetchone()
        if not row:
            return "summarization"
        tt = row["task_type"] if "task_type" in row.keys() else None
        if tt in ("summarization", "classification"):
            return tt
        return "summarization"
    finally:
        await db.close()


async def get_task_labels(run_id: int) -> dict:
    """run_id에서 task의 classification 라벨 메타데이터 조회.
    Returns: {"label_list": [..], "label_definitions": {..}}
    값이 없거나 파싱 실패 시 빈 list/dict 반환.
    """
    import json as _json
    from database import get_db
    db = await get_db()
    try:
        async with db.execute(
            """SELECT t.label_list, t.label_definitions
               FROM runs r JOIN tasks t ON t.id = r.task_id
               WHERE r.id=?""",
            (run_id,)
        ) as cursor:
            row = await cursor.fetchone()
        if not row:
            return {"label_list": [], "label_definitions": {}}
        labels = []
        defs = {}
        try:
            ll = row["label_list"] if "label_list" in row.keys() else None
            if ll:
                parsed = _json.loads(ll)
                if isinstance(parsed, list):
                    labels = [str(x) for x in parsed if str(x).strip()]
        except Exception:
            labels = []
        try:
            ld = row["label_definitions"] if "label_definitions" in row.keys() else None
            if ld:
                parsed = _json.loads(ld)
                if isinstance(parsed, dict):
                    defs = {str(k): str(v) for k, v in parsed.items()}
        except Exception:
            defs = {}
        return {"label_list": labels, "label_definitions": defs}
    finally:
        await db.close()


async def get_task_sim_config(run_id: int) -> dict:
    """run_id에서 task의 시뮬레이션(생성) 모델 설정 조회. 없으면 빈 dict 반환."""
    from database import get_db
    db = await get_db()
    try:
        async with db.execute(
            """SELECT t.sim_api_base, t.sim_api_key, t.sim_model
               FROM runs r JOIN tasks t ON t.id = r.task_id
               WHERE r.id=?""",
            (run_id,)
        ) as cursor:
            row = await cursor.fetchone()
        if not row:
            return {}
        cfg = {}
        if row["sim_api_base"]:
            cfg["api_base"] = row["sim_api_base"]
        if row["sim_api_key"]:
            cfg["api_key"] = row["sim_api_key"]
        if row["sim_model"]:
            cfg["model"] = row["sim_model"]
        return cfg
    finally:
        await db.close()
