import os
import logging
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from database import init_db
from routers import tasks, runs, phases
from config import HOST, PORT, GPT_API_BASE, GPT_MODEL, DIFY_BASE_URL

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


async def _reset_stale_running_states():
    """서버 재시작 시 'running' 상태로 남아있는 고아 phase/run을 자동 리셋."""
    from database import get_db
    db = await get_db()
    try:
        # running 상태의 phase를 failed로 리셋
        cursor = await db.execute(
            "UPDATE phase_results SET status='failed' WHERE status='running'"
        )
        stale_phases = cursor.rowcount or 0

        # phase_running 상태의 run을 직전 phase 완료 상태로 리셋
        cursor = await db.execute(
            "UPDATE runs SET status='created' WHERE status LIKE '%_running'"
        )
        stale_runs = cursor.rowcount or 0

        if stale_phases or stale_runs:
            await db.commit()
            logger.warning(
                f"고아 running 상태 리셋: phase_results {stale_phases}건, runs {stale_runs}건"
            )
    finally:
        await db.close()


@asynccontextmanager
async def lifespan(app):
    await init_db()
    await _reset_stale_running_states()
    logger.info("=" * 55)
    logger.info(f"  GPT_API_BASE : {GPT_API_BASE}")
    logger.info(f"  GPT_MODEL    : {GPT_MODEL}")
    logger.info(f"  DIFY_BASE_URL: {DIFY_BASE_URL}")
    logger.info("=" * 55)
    yield


app = FastAPI(title="Prompt Improver", lifespan=lifespan)

app.include_router(tasks.router)
app.include_router(runs.router)
app.include_router(phases.router)

app.mount("/static", StaticFiles(directory="frontend/static"), name="static")

# React build serving
FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "frontend", "dist")

if os.path.isdir(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")


@app.get("/")
async def serve_index():
    if os.path.isdir(FRONTEND_DIST):
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
    return FileResponse("frontend/index.html.bak")


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)
