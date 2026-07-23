"""
server.py
---------
Small FastAPI backend for the AI Image Reviewer.

Responsibilities:
  1. Serve the existing front-end (index.html, css/, js/) exactly as-is.
  2. Expose POST /api/review, which sends an image + your criteria list to
     Claude's vision API and returns a structured grading result, including
     a plain-language summary of the verdict, a list of action items, and
     (experimental) an approximate on-image location for failed criteria.
  3. Expose GET /api/usage, which reports cumulative token usage and an
     estimated cost for this server process (in-memory only, resets on
     restart — consistent with the rest of the app having no persistence).

Setup (see README.md for the full walkthrough):
  python3 -m venv venv && source venv/bin/activate      # or venv\Scripts\activate on Windows
  pip install -r requirements.txt
  cp .env.example .env       # then paste your ANTHROPIC_API_KEY into .env
  uvicorn server:app --reload --port 8000

Then open http://localhost:8000
"""

import json
import os
from pathlib import Path

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()

API_KEY = os.getenv("ANTHROPIC_API_KEY")
MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-5")

# Recent Claude models (including claude-sonnet-5) don't accept temperature,
# top_p, or top_k, so we can't force bit-for-bit determinism that way. The
# closest lever available is `effort`, which controls how thoroughly the
# model reasons before answering. "high" is the model's own recommended
# default for quality-sensitive tasks and pairs well with a moderate
# max_tokens budget. "max" reasons even more but can consume tens of
# thousands of tokens on internal thinking alone — if you raise this to
# "max" or "xhigh", raise MAX_OUTPUT_TOKENS a lot too, or responses will get
# cut off before finishing (see max_tokens note below).
EFFORT_LEVEL = os.getenv("CLAUDE_EFFORT", "high")

# Token budget for each review response, including Claude's internal
# reasoning (adaptive thinking) plus the final JSON answer. If you raise
# CLAUDE_EFFORT to "xhigh" or "max", raise this too, or responses risk being
# truncated mid-thought before the JSON is written.
MAX_OUTPUT_TOKENS = int(os.getenv("CLAUDE_MAX_TOKENS", "8192"))

# List pricing per million tokens. Defaults reflect claude-sonnet-5
# introductory pricing (through 2026-08-31) per
# https://platform.claude.com/docs/en/about-claude/pricing — override via
# .env if you change CLAUDE_MODEL or pricing changes.
PRICE_PER_MTOK_INPUT = float(os.getenv("PRICE_PER_MTOK_INPUT", "2.0"))
PRICE_PER_MTOK_OUTPUT = float(os.getenv("PRICE_PER_MTOK_OUTPUT", "10.0"))

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="AI Image Reviewer")

client = anthropic.Anthropic(api_key=API_KEY) if API_KEY else None

# In-memory usage counter for this server process. Resets on restart.
USAGE = {"requests": 0, "input_tokens": 0, "output_tokens": 0}


@app.get("/api/health")
def health():
    """Lets the front-end badge show real status instead of a hardcoded label."""
    return {
        "connected": client is not None,
        "model": MODEL,
        "key_configured": bool(API_KEY),
    }


@app.get("/api/usage")
def usage():
    """Cumulative token usage and estimated cost since this server started."""
    input_cost = USAGE["input_tokens"] / 1_000_000 * PRICE_PER_MTOK_INPUT
    output_cost = USAGE["output_tokens"] / 1_000_000 * PRICE_PER_MTOK_OUTPUT
    return {
        "requests": USAGE["requests"],
        "input_tokens": USAGE["input_tokens"],
        "output_tokens": USAGE["output_tokens"],
        "estimated_cost_usd": round(input_cost + output_cost, 4),
        "model": MODEL,
    }


class ReviewRequest(BaseModel):
    image_base64: str  # raw base64 image data, no "data:image/...;base64," prefix
    media_type: str  # e.g. "image/png", "image/jpeg"
    criteria: list[str]


SYSTEM_PROMPT = (
    "You are a meticulous image review assistant. You are given an image and "
    "a checklist of review criteria.\n\n"
    "Work through this carefully before writing your final answer:\n"
    "1. First, describe briefly what you actually see in the image. If any "
    "criterion relates to text, spelling, wording, or labels, transcribe the "
    "exact text visible in the image as precisely as you can before judging "
    "it — do not assume or guess what the text says.\n"
    "2. For EACH criterion, decide pass or fail based only on what you "
    "directly observed in step 1, and give a one-sentence comment explaining "
    "why. If a detail is unclear or ambiguous, look again rather than "
    "assuming it is correct.\n"
    "3. For each criterion that FAILS, also estimate WHERE in the image the "
    "problem is visually located, if it corresponds to a specific spot "
    "(such as a misspelled word, a particular object, or a specific area) "
    "rather than a property of the whole image (such as overall blur or "
    "resolution). Give this as a \"location\" field: "
    "{\"x\": <0.0-1.0>, \"y\": <0.0-1.0>} marking the approximate center of "
    "the issue, where x=0 is the left edge of the image, x=1 is the right "
    "edge, y=0 is the top, and y=1 is the bottom. This is a best-effort "
    "visual estimate, not a precise measurement — do your best but it is "
    "OK to be approximate. If the issue does not correspond to a specific "
    "location, omit the \"location\" field entirely for that check.\n"
    "4. Compute an overall score from 0-100 based on the proportion of "
    "criteria passed, and an overall verdict: 'approved' if score >= 80, "
    "'needs_review' if score is between 50 and 79, or 'rejected' if score < "
    "50.\n\n"
    "Keep your reasoning concise — a few sentences of observation is enough, "
    "you do not need to write a long essay before answering.\n\n"
    "Also include a \"summary\" field: 1-3 sentences in plain language "
    "explaining WHY you reached this verdict, referencing the specific "
    "criteria that drove the decision.\n\n"
    "Also include an \"action_items\" field: a list of short, concrete "
    "strings describing exactly what needs to be fixed for this image to "
    "pass review. Base this only on criteria that failed. Use an empty list "
    "if the verdict is 'approved' and nothing needs fixing.\n\n"
    "Respond with ONLY valid JSON, no markdown code fences, no extra "
    "commentary, in exactly this shape (the \"location\" field is optional "
    "per check and should be omitted, not null, when there isn't one):\n"
    '{"score": <int 0-100>, "verdict": "approved|needs_review|rejected", '
    '"summary": "<string>", "action_items": ["<string>", ...], '
    '"checks": [{"criterion": "<string>", "pass": <bool>, "comment": '
    '"<string>", "location": {"x": <0.0-1.0>, "y": <0.0-1.0>}}]}'
)


def fallback_result(message: str) -> dict:
    return {
        "score": 0,
        "verdict": "needs_review",
        "summary": message,
        "action_items": [],
        "checks": [{"criterion": "AI review", "pass": False, "comment": message}],
    }


def extract_json(raw_text: str) -> dict:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if "\n" in text:
            text = text.split("\n", 1)[1]
    return json.loads(text)


def sanitize_checks(checks: list) -> list:
    """Validate/clean the optional per-check location field so bad data from
    the model (out-of-range values, wrong types) never reaches the front end."""
    cleaned = []
    for c in checks if isinstance(checks, list) else []:
        if not isinstance(c, dict):
            continue
        entry = {
            "criterion": c.get("criterion", ""),
            "pass": bool(c.get("pass", False)),
            "comment": c.get("comment", ""),
        }
        loc = c.get("location")
        if isinstance(loc, dict) and "x" in loc and "y" in loc:
            try:
                x, y = float(loc["x"]), float(loc["y"])
                if 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0:
                    entry["location"] = {"x": x, "y": y}
            except (TypeError, ValueError):
                pass
        cleaned.append(entry)
    return cleaned


@app.post("/api/review")
def review_image(req: ReviewRequest):
    if not client:
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY is not set on the server. Add it to .env and restart uvicorn.",
        )

    criteria_text = "\n".join(f"- {c}" for c in req.criteria) or "- General image quality"

    # Note: `temperature` is intentionally omitted. Recent Claude models
    # (including claude-sonnet-5) reject it with a 400 invalid_request_error.
    # We use `effort` + careful step-by-step prompting for consistency
    # instead — see EFFORT_LEVEL comment above.
    try:
        message = client.messages.create(
            model=MODEL,
            max_tokens=MAX_OUTPUT_TOKENS,
            system=SYSTEM_PROMPT,
            output_config={"effort": EFFORT_LEVEL},
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": req.media_type,
                                "data": req.image_base64,
                            },
                        },
                        {
                            "type": "text",
                            "text": f"Review criteria:\n{criteria_text}",
                        },
                    ],
                }
            ],
        )
    except anthropic.APIStatusError as e:
        return fallback_result(f"Claude API error ({e.status_code}): {e.message}")
    except Exception as e:  # noqa: BLE001 - surface any unexpected error to the UI, not a 500 page
        return fallback_result(f"Unexpected error calling Claude: {e}")

    # Record usage now that we know the call actually happened (and was
    # billed), regardless of whether we can parse the response below.
    if message.usage:
        USAGE["requests"] += 1
        USAGE["input_tokens"] += message.usage.input_tokens
        USAGE["output_tokens"] += message.usage.output_tokens

    if message.stop_reason == "max_tokens":
        return fallback_result(
            f"Claude's response was cut off before finishing (hit the "
            f"{MAX_OUTPUT_TOKENS}-token limit at effort='{EFFORT_LEVEL}'). "
            "Raise CLAUDE_MAX_TOKENS in .env, or lower CLAUDE_EFFORT, and try again."
        )

    try:
        raw_text = "".join(
            block.text for block in message.content if block.type == "text"
        )
        result = extract_json(raw_text)

        result.setdefault("score", 0)
        result.setdefault("verdict", "needs_review")
        result.setdefault("summary", "")
        result.setdefault("action_items", [])
        result["checks"] = sanitize_checks(result.get("checks", []))
        return result

    except json.JSONDecodeError:
        return fallback_result("The AI response could not be parsed as JSON. Try reviewing again.")


# Serve the existing front-end untouched.
app.mount("/css", StaticFiles(directory=BASE_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=BASE_DIR / "js"), name="js")


@app.get("/")
def index():
    return FileResponse(BASE_DIR / "index.html")
