import asyncio
import base64
import hashlib
import hmac
import json
import os
import tempfile
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


MAX_UPLOAD_BYTES = 12 * 1024 * 1024
OVERSIZE_DETAIL = "Audio file is too large"

# ACRCloud status.code 中表示"没识别到"的码，映射 404；
# 其余（配额耗尽 3003/3015、密钥错误 3001、服务端错误等）映射 502。
ACRLOUD_NO_MATCH_CODES = {1001}

# 共享密钥：前端构建期注入、请求带 X-App-Token，后端校验。
# 留空则放行（方便本地开发），公网部署务必设置。
APP_ACCESS_TOKEN = os.getenv("APP_ACCESS_TOKEN", "").strip()
# 按 IP 限流：每个 IP 每分钟最多多少次付费请求（<=0 关闭）。
RATE_LIMIT_PER_MIN = int(os.getenv("RATE_LIMIT_PER_MIN", "30") or "30")
RATE_LIMIT_WINDOW_SEC = 60

_rate_lock = asyncio.Lock()
_rate_hits: dict[str, deque[float]] = defaultdict(deque)


app = FastAPI(title="Lyrics Assistant API")


@app.middleware("http")
async def limit_upload_size(request: Request, call_next):
  # 在 body 被解析/落盘之前就按 Content-Length 拦掉超大请求，
  # 避免攻击者用大上传撑爆内存/磁盘（此时鉴权依赖还没运行）。
  content_length = request.headers.get("content-length")
  if content_length:
    try:
      declared = int(content_length)
    except ValueError:
      declared = -1
    if declared > MAX_UPLOAD_BYTES:
      return JSONResponse(status_code=413, content={"detail": OVERSIZE_DETAIL})

  return await call_next(request)


def get_client_ip(request: Request) -> str:
  # Railway / nginx 会把真实来源放在 X-Forwarded-For，取第一个
  forwarded = request.headers.get("x-forwarded-for")
  if forwarded:
    return forwarded.split(",")[0].strip()
  return request.client.host if request.client else "unknown"


def verify_app_token(x_app_token: str | None = Header(default=None)) -> None:
  if not APP_ACCESS_TOKEN:
    return
  if not x_app_token or not hmac.compare_digest(x_app_token, APP_ACCESS_TOKEN):
    raise HTTPException(status_code=401, detail="Invalid or missing app token")


async def enforce_rate_limit(request: Request) -> None:
  if RATE_LIMIT_PER_MIN <= 0:
    return

  ip = get_client_ip(request)
  now = time.time()
  cutoff = now - RATE_LIMIT_WINDOW_SEC

  async with _rate_lock:
    hits = _rate_hits[ip]
    while hits and hits[0] < cutoff:
      hits.popleft()

    if len(hits) >= RATE_LIMIT_PER_MIN:
      retry_after = max(1, int(hits[0] + RATE_LIMIT_WINDOW_SEC - now))
      raise HTTPException(
        status_code=429,
        detail="Too many requests",
        headers={"Retry-After": str(retry_after)},
      )

    hits.append(now)


async def guard(request: Request, _token: None = Depends(verify_app_token)) -> None:
  # 先校验 token（廉价拒绝未授权），再对授权请求做按 IP 限流
  await enforce_rate_limit(request)

app.add_middleware(
  CORSMiddleware,
  allow_origins=os.getenv("CORS_ALLOW_ORIGINS", "*").split(","),
  allow_credentials=False,
  allow_methods=["GET", "POST", "OPTIONS"],
  allow_headers=["*"],
)


class LyricsCandidateSong(BaseModel):
  title: str = Field(max_length=200)
  artist: str = Field(max_length=200)
  album: str | None = Field(default=None, max_length=200)
  durationSec: int | None = Field(default=None, ge=0, le=86400)


class LyricsCandidateRequest(BaseModel):
  song: LyricsCandidateSong


@app.get("/health")
async def health() -> dict[str, str]:
  return {"status": "ok"}


@app.post("/api/lyrics/candidates")
async def create_lyrics_candidates(
  payload: LyricsCandidateRequest,
  _guard: None = Depends(guard),
) -> dict[str, Any]:
  return {
    "candidates": await get_ai_lyrics_candidates(payload.song),
  }


@app.post("/api/recognize")
async def recognize(
  audio: UploadFile = File(...),
  _guard: None = Depends(guard),
) -> dict[str, Any]:
  content = await read_capped(audio, MAX_UPLOAD_BYTES)
  if not content:
    raise HTTPException(status_code=400, detail="Empty audio file")

  suffix = guess_suffix(audio.filename, audio.content_type)
  temp_path: Path | None = None
  flac_path: Path | None = None

  print(
    "recognize upload",
    {
      "filename": audio.filename,
      "content_type": audio.content_type,
      "size": len(content),
      "suffix": suffix,
    },
    flush=True,
  )

  try:
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
      temp_file.write(content)
      temp_path = Path(temp_file.name)

    source_probe = await log_audio_probe(temp_path, "source")
    duration_sec = get_probe_duration(source_probe)
    flac_path = await normalize_audio_to_flac(temp_path)
    await log_audio_probe(flac_path, "normalized-flac")

    return await recognize_with_acrcloud(flac_path, duration_sec)
  finally:
    if temp_path:
      temp_path.unlink(missing_ok=True)
    if flac_path:
      flac_path.unlink(missing_ok=True)


async def read_capped(upload: UploadFile, max_bytes: int) -> bytes:
  # 分块读取并累计校验，一旦超过上限立即拒绝，
  # 把内存占用钉死在 max_bytes 内（兜底 Content-Length 被伪造/缺失/chunked 编码的情况）。
  chunk_size = 64 * 1024
  buffer = bytearray()
  while True:
    chunk = await upload.read(chunk_size)
    if not chunk:
      break
    buffer.extend(chunk)
    if len(buffer) > max_bytes:
      raise HTTPException(status_code=413, detail=OVERSIZE_DETAIL)

  return bytes(buffer)


def guess_suffix(filename: str | None, content_type: str | None) -> str:
  if filename and "." in filename:
    suffix = Path(filename).suffix
    if suffix:
      return suffix

  if content_type == "audio/mp4":
    return ".mp4"
  if content_type == "audio/wav":
    return ".wav"
  if content_type == "audio/mpeg":
    return ".mp3"

  return ".webm"


def get_acrcloud_config() -> dict[str, str]:
  return {
    "host": os.getenv("ACRCLOUD_HOST", "").strip(),
    "access_key": os.getenv("ACRCLOUD_ACCESS_KEY", "").strip(),
    "access_secret": os.getenv("ACRCLOUD_ACCESS_SECRET", "").strip(),
  }


def get_dashscope_config() -> dict[str, str]:
  return {
    "base_url": (
      os.getenv("DASHSCOPE_BASE_URL")
      or os.getenv("BASE_URL")
      or "https://dashscope.aliyuncs.com/compatible-mode/v1"
    ).strip(),
    "api_key": (os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY") or "").strip(),
    "model": (os.getenv("DASHSCOPE_MODEL") or os.getenv("MODEL") or "deepseek-v4-flash").strip(),
  }


async def normalize_audio_to_flac(path: Path) -> Path:
  with tempfile.NamedTemporaryFile(delete=False, suffix=".flac") as temp_file:
    flac_path = Path(temp_file.name)

  await run_command(
    [
      "ffmpeg",
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      str(path),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "44100",
      "-sample_fmt",
      "s16",
      str(flac_path),
    ],
    timeout=30,
    error_status=422,
    error_prefix="Could not decode audio",
  )

  return flac_path


async def get_ai_lyrics_candidates(song: LyricsCandidateSong) -> list[dict[str, Any]]:
  config = get_dashscope_config()
  if not config["base_url"] or not config["api_key"] or not config["model"]:
    print("ai lyrics candidates skipped: DashScope is not configured", flush=True)
    return []

  endpoint = f"{config['base_url'].rstrip('/')}/chat/completions"
  prompt_payload = {
    "title": song.title,
    "artist": song.artist,
    "album": song.album,
    "durationSec": song.durationSec,
  }
  request_body = {
    "model": config["model"],
    "temperature": 0.1,
    "max_tokens": 700,
    "messages": [
      {
        "role": "system",
        "content": (
          "You clean music metadata for searching a lyric database. "
          "Return JSON only. Never provide, quote, translate, summarize, or continue song lyrics. "
          "Create up to 5 candidate search queries for LRCLIB. "
          "Prefer canonical original song artist and title over karaoke, cover, backing track, "
          "instrumental, live, remaster, radio edit, or 'in the style of' metadata."
        ),
      },
      {
        "role": "user",
        "content": (
          "Input metadata:\n"
          f"{json.dumps(prompt_payload, ensure_ascii=False)}\n\n"
          "Return JSON in this exact shape:\n"
          "{\"candidates\":[{\"artistName\":\"...\",\"trackName\":\"...\","
          "\"albumName\":null,\"durationSec\":null,\"reason\":\"...\"}]}"
        ),
      },
    ],
  }

  try:
    async with httpx.AsyncClient(timeout=20) as client:
      response = await client.post(
        endpoint,
        headers={
          "Authorization": f"Bearer {config['api_key']}",
          "Content-Type": "application/json",
        },
        json=request_body,
      )
    response.raise_for_status()
    data = response.json()
  except Exception as exc:
    print(
      "ai lyrics candidates failed",
      {
        "model": config["model"],
        "error": str(exc),
      },
      flush=True,
    )
    return []

  content = (
    data.get("choices", [{}])[0]
    .get("message", {})
    .get("content", "")
  )
  parsed = parse_ai_json(content)
  candidates = parsed.get("candidates") if isinstance(parsed, dict) else parsed

  if not isinstance(candidates, list):
    return []

  normalized: list[dict[str, Any]] = []
  for item in candidates:
    if not isinstance(item, dict):
      continue

    artist_name = clean_optional_text(item.get("artistName") or item.get("artist_name"))
    track_name = clean_optional_text(item.get("trackName") or item.get("track_name"))
    if not artist_name or not track_name:
      continue

    normalized.append(
      {
        "artistName": artist_name,
        "trackName": track_name,
        "albumName": clean_optional_text(item.get("albumName") or item.get("album_name")),
        "durationSec": clean_optional_int(item.get("durationSec") or item.get("duration")),
        "reason": clean_optional_text(item.get("reason")),
      },
    )

  print(
    "ai lyrics candidates",
    {
      "model": config["model"],
      "input_title": song.title,
      "input_artist": song.artist,
      "candidate_count": len(normalized[:5]),
    },
    flush=True,
  )
  return normalized[:5]


async def recognize_with_acrcloud(sample_path: Path, duration_sec: float | None) -> dict[str, Any]:
  config = get_acrcloud_config()
  if not config["host"] or not config["access_key"] or not config["access_secret"]:
    raise HTTPException(status_code=500, detail="Missing ACRCloud configuration")

  sample = sample_path.read_bytes()
  timestamp = str(int(time.time()))
  signature_version = "1"
  data_type = "audio"
  http_method = "POST"
  http_uri = "/v1/identify"
  string_to_sign = "\n".join(
    [
      http_method,
      http_uri,
      config["access_key"],
      data_type,
      signature_version,
      timestamp,
    ],
  )
  signature = base64.b64encode(
    hmac.new(
      config["access_secret"].encode("utf-8"),
      string_to_sign.encode("utf-8"),
      digestmod=hashlib.sha1,
    ).digest(),
  ).decode("utf-8")

  url = f"https://{config['host']}{http_uri}"
  form_data = {
    "access_key": config["access_key"],
    "sample_bytes": str(len(sample)),
    "timestamp": timestamp,
    "signature": signature,
    "data_type": data_type,
    "signature_version": signature_version,
  }
  files = {
    "sample": ("sample.flac", sample, "audio/flac"),
  }

  async with httpx.AsyncClient(timeout=20) as client:
    response = await client.post(url, data=form_data, files=files)

  if response.status_code >= 400:
    raise HTTPException(status_code=502, detail=f"ACRCloud request failed: {response.status_code}")

  try:
    data = response.json()
  except Exception:
    raise HTTPException(status_code=502, detail="ACRCloud returned non-JSON response")

  status = data.get("status") or {}
  print(
    "acrcloud response",
    {
      "code": status.get("code"),
      "msg": status.get("msg"),
      "sample_bytes": len(sample),
      "duration": duration_sec,
    },
    flush=True,
  )

  code = status.get("code")
  if code != 0:
    msg = status.get("msg") or "ACRCloud error"
    if code in ACRLOUD_NO_MATCH_CODES:
      raise HTTPException(status_code=404, detail=msg)
    raise HTTPException(status_code=502, detail=f"ACRCloud error ({code}): {msg}")

  music = data.get("metadata", {}).get("music") or []
  if not music:
    raise HTTPException(status_code=404, detail="ACRCloud no music result")

  return to_acrcloud_recognition_result(music[0], duration_sec)


async def log_audio_probe(path: Path, label: str) -> dict[str, Any] | None:
  try:
    stdout = await run_command(
      [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_name,codec_type,sample_rate,channels,duration",
        "-of",
        "json",
        str(path),
      ],
      timeout=10,
      error_status=422,
      error_prefix=f"Could not probe {label} audio",
      log_failure=False,
    )
    data = json.loads(stdout)
    print(
      "audio probe",
      {
        "label": label,
        "path": str(path),
        "size": path.stat().st_size,
        "format": data.get("format"),
        "streams": data.get("streams"),
      },
      flush=True,
    )
    return data
  except HTTPException as exc:
    print(
      "audio probe failed",
      {
        "label": label,
        "path": str(path),
        "size": path.stat().st_size if path.exists() else 0,
        "detail": exc.detail,
      },
      flush=True,
    )
    return None


def get_probe_duration(probe: dict[str, Any] | None) -> float | None:
  if not probe:
    return None

  duration = (probe.get("format") or {}).get("duration")
  parsed = parse_probe_duration(duration)
  if parsed is not None:
    return parsed

  for stream in probe.get("streams") or []:
    parsed = parse_probe_duration(stream.get("duration"))
    if parsed is not None:
      return parsed

  return None


def parse_probe_duration(value: Any) -> float | None:
  if not value or value == "N/A":
    return None
  try:
    return float(value)
  except (ValueError, TypeError):
    return None


async def run_command(
  command: list[str],
  timeout: int,
  error_status: int,
  error_prefix: str,
  log_failure: bool = True,
) -> str:
  stdout, stderr, returncode = await run_process(command, timeout)

  if returncode != 0:
    message = stderr.decode("utf-8", errors="ignore").strip()
    detail = f"{error_prefix}: {message}" if message else error_prefix
    if log_failure:
      print(
        "command failed",
        {
          "command": command,
          "returncode": returncode,
          "detail": detail,
        },
        flush=True,
      )
    raise HTTPException(status_code=error_status, detail=detail)

  return stdout.decode("utf-8", errors="replace")


async def run_process(command: list[str], timeout: int) -> tuple[bytes, bytes, int]:
  process = await asyncio.create_subprocess_exec(
    *command,
    stdout=asyncio.subprocess.PIPE,
    stderr=asyncio.subprocess.PIPE,
  )

  try:
    stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
  except asyncio.TimeoutError as exc:
    process.kill()
    await process.communicate()
    raise HTTPException(status_code=504, detail=f"{command[0]} timed out") from exc

  return stdout, stderr, process.returncode


def parse_ai_json(content: str) -> Any:
  text = content.strip()
  if text.startswith("```"):
    text = text.strip("`").strip()
    if text.lower().startswith("json"):
      text = text[4:].strip()

  try:
    return json.loads(text)
  except json.JSONDecodeError:
    start_candidates = [index for index in [text.find("{"), text.find("[")] if index >= 0]
    if not start_candidates:
      return {}

    start = min(start_candidates)
    end = max(text.rfind("}"), text.rfind("]"))
    if end <= start:
      return {}

    try:
      return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
      return {}


def clean_optional_text(value: Any) -> str | None:
  if not isinstance(value, str):
    return None

  text = value.strip()
  return text or None


def clean_optional_int(value: Any) -> int | None:
  if isinstance(value, int):
    return value

  if isinstance(value, float):
    return round(value)

  if isinstance(value, str) and value.strip().isdigit():
    return int(value.strip())

  return None


def to_acrcloud_recognition_result(result: dict[str, Any], sample_duration_sec: float | None) -> dict[str, Any]:
  now = datetime.now(timezone.utc).isoformat()
  artists = result.get("artists") or []
  artist = " / ".join(item.get("name", "") for item in artists if item.get("name")) or "未知歌手"
  album = result.get("album") or {}
  external_metadata = result.get("external_metadata") or {}
  musicbrainz = external_metadata.get("musicbrainz") or {}
  title = result.get("title") or "未知歌曲"
  score = float(result.get("score") or 0) / 100
  duration_ms = result.get("duration_ms")
  play_offset_ms = result.get("play_offset_ms") or 0
  estimated_position_ms = int(play_offset_ms)

  print(
    "acrcloud match",
    {
      "title": title,
      "artist": artist,
      "score": score,
      "sample_duration_sec": sample_duration_sec,
      "play_offset_ms": play_offset_ms,
      "estimated_position_ms": estimated_position_ms,
    },
    flush=True,
  )

  song = {
    "id": result.get("acrid") or musicbrainz.get("track", {}).get("id") or title,
    "recognitionId": result.get("acrid") or "",
    "musicBrainzRecordingId": musicbrainz.get("track", {}).get("id"),
    "title": title,
    "artist": artist,
    "album": album.get("name"),
    "durationSec": round(duration_ms / 1000) if duration_ms else None,
    "score": score,
    "matchedAt": now,
    "playbackStartedAt": now,
    "estimatedPositionMs": estimated_position_ms,
    "artworkColor": "#34d399",
  }

  return {
    "source": "acrcloud",
    "song": song,
  }
