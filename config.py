import os
from dotenv import load_dotenv

load_dotenv()

# 폐쇄망 gpt-oss-120B API (OpenAI-compatible)
GPT_API_BASE    = os.getenv("GPT_API_BASE", "http://내부서버주소/v1")
GPT_API_KEY     = os.getenv("GPT_API_KEY", "")
GPT_MODEL       = os.getenv("GPT_MODEL", "gpt-oss-120b-26")
GPT_REASONING   = os.getenv("GPT_REASONING", "high")   # low / medium / high

# Qwen 3.5 API (OpenAI-compatible via vLLM) — 선택적
QWEN_API_BASE  = os.getenv("QWEN_API_BASE", "")
QWEN_API_KEY   = os.getenv("QWEN_API_KEY", "")
QWEN_MODEL     = os.getenv("QWEN_MODEL", "qwen3.5-35b-a3b")

# Dify (CLIENT_ID/SECRET/BASE_URL은 고정값, object_id는 Phase 3 UI에서 워크플로우별 입력)
DIFY_CLIENT_ID     = os.getenv("DIFY_CLIENT_ID", "")
DIFY_CLIENT_SECRET = os.getenv("DIFY_CLIENT_SECRET", "")
DIFY_BASE_URL      = os.getenv("DIFY_BASE_URL", "http://내부서버주소/v1")

# LLM Judge API (Phase 4 / Phase 2 mini-validation)
# - 폐쇄망 LLM Judge 서버. 입력 xlsx → output_dir 에 merged_final.json 생성.
# - JUDGE_IO_DIR 은 개선툴과 Judge API 서버가 동일하게 접근 가능한 경로여야 함 (공유 마운트 또는 동일 호스트).
JUDGE_API_URL    = os.getenv("JUDGE_API_URL", "http://10.232.200.25:8000/judge")
JUDGE_IO_DIR     = os.getenv("JUDGE_IO_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "judge_io"))
JUDGE_API_MODEL  = os.getenv("JUDGE_API_MODEL", "gpt-oss-120b-25")
JUDGE_API_WORKERS = int(os.getenv("JUDGE_API_WORKERS", "5"))
JUDGE_API_TIMEOUT = int(os.getenv("JUDGE_API_TIMEOUT", "3600"))

# 서버
HOST = "0.0.0.0"
PORT = 8000
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "improver.db")
