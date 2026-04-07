import logging
from functools import lru_cache
from openai import AsyncOpenAI
from config import GPT_API_BASE, GPT_API_KEY, GPT_MODEL

logger = logging.getLogger(__name__)

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
    logger.info(f"[GPT] POST {use_base}/chat/completions  model={use_model}  reasoning={reasoning}")
    try:
        response = await client.chat.completions.create(
            model=use_model,
            messages=messages,
            extra_body={"reasoning_effort": reasoning},
            timeout=timeout,
        )
        return response.choices[0].message.content
    except Exception as e:
        msg = f"GPT 호출 오류 — {use_base}  {type(e).__name__}: {e}"
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
