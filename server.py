"""
server.py
---------
FastAPI backend for the AI Image Reviewer.

Responsibilities:
  1. Serve the front-end pages (index.html, clients.html, history.html,
     css/, js/) as-is.
  2. Expose POST /api/review: sends an image + criteria list to Claude's
     vision API, returns a structured grading result, and persists the
     review (plus the image itself) to a local SQLite database so history
     survives a restart.
  3. Expose GET /api/usage: cumulative token usage/cost for this process
     (still in-memory/session-only -- not persisted).
  4. Expose CRUD endpoints for clients and their saved criteria, and for
     browsing/deleting saved review history.

See db.py for where the database and saved images actually live -- a
"data" folder inside this project folder by default (override via
REVIEWER_DATA_DIR in .env if this project ever moves back into a
OneDrive/Dropbox/Google Drive synced folder, since SQLite and cloud sync
don't mix well).

Setup (see README.md for the full walkthrough):
  python3 -m venv venv && source venv/bin/activate      # or venv\Scripts\activate on Windows
  pip install -r requirements.txt
  cp .env.example .env       # then paste your ANTHROPIC_API_KEY into .env
  uvicorn server:app --reload --port 8000

Then open http://localhost:8000
"""

import base64
import json
import os
import uuid
from pathlib import Path
from typing import List, Optional

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import db

load_dotenv()
db.init_db()

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

# In-memory usage counter for this server process. Resets on restart --
# unlike reviews/clients, this is intentionally not persisted.
USAGE = {"requests": 0, "input_tokens": 0, "output_tokens": 0}

EXT_BY_MEDIA_TYPE = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


@app.get("/api/health")
def health():
    """Lets the front-end badge show real status instead of a hardcoded label."""
    return {
        "connected": client is not None,
        "model": MODEL,
        "key_configured": bool(API_KEY),
        "ready_at": READY_AT,
        "needs_at": NEEDS_AT,
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


# =========================================================================
# Clients & criteria
# =========================================================================

class ClientCreate(BaseModel):
    name: str
    notes: str = ""


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None


class CategoryCreate(BaseModel):
    name: str


class CategoryUpdate(BaseModel):
    name: str


class CriterionCreate(BaseModel):
    text: str


class CriterionUpdate(BaseModel):
    text: str


@app.get("/api/clients")
def api_list_clients():
    return db.list_clients()


@app.post("/api/clients")
def api_create_client(body: ClientCreate):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Client name is required.")
    try:
        return db.create_client(name, body.notes)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not create client: {e}")


@app.get("/api/clients/{client_id}")
def api_get_client(client_id: int):
    c = db.get_client(client_id)
    if not c:
        raise HTTPException(status_code=404, detail="Client not found.")
    return c


@app.put("/api/clients/{client_id}")
def api_update_client(client_id: int, body: ClientUpdate):
    if not db.get_client(client_id):
        raise HTTPException(status_code=404, detail="Client not found.")
    return db.update_client(client_id, name=body.name, notes=body.notes)


@app.delete("/api/clients/{client_id}")
def api_delete_client(client_id: int):
    if not db.get_client(client_id):
        raise HTTPException(status_code=404, detail="Client not found.")
    db.delete_client(client_id)
    return {"deleted": True}


@app.post("/api/clients/{client_id}/logo")
async def api_upload_logo(client_id: int, file: UploadFile = File(...)):
    if not db.get_client(client_id):
        raise HTTPException(status_code=404, detail="Client not found.")
    ext = Path(file.filename or "").suffix or ".png"
    filename = f"{uuid.uuid4().hex}{ext}"
    dest = db.LOGOS_DIR / filename
    contents = await file.read()
    dest.write_bytes(contents)
    relative_path = f"logos/{filename}"
    return db.set_client_logo(client_id, relative_path)


@app.get("/api/clients/{client_id}/categories")
def api_list_categories(client_id: int):
    if not db.get_client(client_id):
        raise HTTPException(status_code=404, detail="Client not found.")
    return db.list_categories(client_id)


@app.post("/api/clients/{client_id}/categories")
def api_create_category(client_id: int, body: CategoryCreate):
    if not db.get_client(client_id):
        raise HTTPException(status_code=404, detail="Client not found.")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required.")
    return db.create_category(client_id, name)


@app.put("/api/categories/{category_id}")
def api_update_category(category_id: int, body: CategoryUpdate):
    if not db.get_category(category_id):
        raise HTTPException(status_code=404, detail="Category not found.")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required.")
    db.update_category(category_id, name)
    return {"updated": True}


@app.delete("/api/categories/{category_id}")
def api_delete_category(category_id: int):
    if not db.get_category(category_id):
        raise HTTPException(status_code=404, detail="Category not found.")
    db.delete_category(category_id)
    return {"deleted": True}


@app.post("/api/categories/{category_id}/criteria")
def api_add_criterion(category_id: int, body: CriterionCreate):
    if not db.get_category(category_id):
        raise HTTPException(status_code=404, detail="Category not found.")
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Criterion text is required.")
    return db.add_criterion(category_id, text)


class CriteriaOrder(BaseModel):
    ids: List[int]


@app.put("/api/criteria/order")
def api_order_criteria(body: CriteriaOrder):
    """Saves the drag-and-drop order of a list of criteria (ids in display order)."""
    db.set_criteria_order(body.ids)
    return {"updated": True}


@app.post("/api/clients/{client_id}/criteria")
def api_add_base_criterion(client_id: int, body: CriterionCreate):
    """A criterion checked in every category of this client."""
    if not db.get_client(client_id):
        raise HTTPException(status_code=404, detail="Client not found.")
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Criterion text is required.")
    return db.add_base_criterion(client_id, text)


@app.put("/api/criteria/{criterion_id}")
def api_update_criterion(criterion_id: int, body: CriterionUpdate):
    db.update_criterion(criterion_id, body.text.strip())
    return {"updated": True}


@app.delete("/api/criteria/{criterion_id}")
def api_delete_criterion(criterion_id: int):
    db.delete_criterion(criterion_id)
    return {"deleted": True}


# =========================================================================
# Review + history
# =========================================================================

class ReviewRequest(BaseModel):
    image_base64: str  # raw base64 image data, no "data:image/...;base64," prefix
    media_type: str  # e.g. "image/png", "image/jpeg"
    criteria: List[str]
    original_filename: str = "image"
    client_id: Optional[int] = None
    category_id: Optional[int] = None


SYSTEM_PROMPT = (
    "You are a meticulous image review assistant. You are given an image and "
    "a checklist of review criteria.\n\n"
    "Work through this carefully before writing your final answer:\n"
    "1. First, describe briefly what you actually see in the image. If any "
    "criterion relates to text, spelling, wording, or labels, transcribe the "
    "exact text visible in the image as precisely as you can before judging "
    "it — do not assume or guess what the text says.\n"
    "2. For EACH criterion, give a status based only on what you directly "
    "observed in step 1: \"pass\" (clearly met), \"warn\" (met, but with a "
    "minor weakness a designer should look at, such as small or low-contrast "
    "text), or \"fail\" (not met). Add a one-sentence comment explaining "
    "why. If a detail is unclear or ambiguous, look again rather than "
    "assuming it is correct.\n"
    "3. For each criterion that is \"warn\" or \"fail\", also estimate WHERE in the image the "
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
    "4. Compute an overall score from 0-100: each pass counts fully, each "
    "warn counts half, each fail counts zero, averaged over all criteria. "
    "The verdict is derived from your score afterwards, so do not include one.\n\n"
    "Keep your reasoning concise — a few sentences of observation is enough, "
    "you do not need to write a long essay before answering.\n\n"
    "Also include a \"summary\" field: 1-3 sentences in plain language "
    "explaining WHY you reached this score, referencing the specific "
    "criteria that drove the decision.\n\n"
    "Also include an \"action_items\" field: a list of short, concrete "
    "strings describing exactly what needs to be fixed for this image to "
    "pass review. Base this only on criteria that are warn or fail. Use an "
    "empty list if every criterion passes.\n\n"
    "Respond with ONLY valid JSON, no markdown code fences, no extra "
    "commentary, in exactly this shape (the \"location\" field is optional "
    "per check and should be omitted, not null, when there isn't one):\n"
    '{"score": <int 0-100>, '
    '"summary": "<string>", "action_items": ["<string>", ...], '
    '"checks": [{"criterion": "<string>", "status": "pass|warn|fail", "comment": '
    '"<string>", "location": {"x": <0.0-1.0>, "y": <0.0-1.0>}}]}'
)


# Verdict keys are stored as approved / needs_review / rejected; the UI shows
# them as Ready for proofing / Needs revisions / Fails.
READY_AT, NEEDS_AT = 80, 50


def verdict_for(score: int) -> str:
    return "approved" if score >= READY_AT else "needs_review" if score >= NEEDS_AT else "rejected"


def fallback_result(message: str) -> dict:
    return {
        "score": 0,
        "verdict": "needs_review",
        "error": True,
        "summary": message,
        "action_items": [],
        "checks": [{"criterion": "AI review", "status": "fail", "pass": False, "comment": message}],
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
        status = c.get("status")
        if status not in ("pass", "warn", "fail"):
            status = "pass" if c.get("pass") else "fail"
        entry = {
            "criterion": c.get("criterion", ""),
            "status": status,
            "pass": status == "pass",
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


def review_to_response(review: dict) -> dict:
    """Adds a browser-usable image URL to a review dict from the database."""
    review = dict(review)
    review["image_url"] = f"uploads/{review['image_path']}"
    return review


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
        result["score"] = max(0, min(100, int(result.get("score") or 0)))
        result["verdict"] = verdict_for(result["score"])
        result.setdefault("summary", "")
        result.setdefault("action_items", [])
        result["checks"] = sanitize_checks(result.get("checks", []))
    except (json.JSONDecodeError, TypeError, ValueError):
        result = fallback_result("The AI response could not be parsed as JSON. Try reviewing again.")

    # Persist the review + the image itself, so history survives a restart.
    try:
        ext = EXT_BY_MEDIA_TYPE.get(req.media_type, ".jpg")
        filename = f"{uuid.uuid4().hex}{ext}"
        image_bytes = base64.b64decode(req.image_base64)
        (db.REVIEWS_DIR / filename).write_bytes(image_bytes)

        client_name_snapshot = None
        if req.client_id is not None:
            existing = db.get_client(req.client_id)
            client_name_snapshot = existing["name"] if existing else None

        category_name_snapshot = None
        if req.category_id is not None:
            existing_category = db.get_category(req.category_id)
            category_name_snapshot = existing_category["name"] if existing_category else None

        saved = db.save_review(
            client_id=req.client_id,
            client_name_snapshot=client_name_snapshot,
            category_id=req.category_id,
            category_name_snapshot=category_name_snapshot,
            original_filename=req.original_filename,
            image_path=f"reviews/{filename}",
            score=result.get("score", 0),
            verdict=result.get("verdict", "needs_review"),
            summary=result.get("summary", ""),
            action_items=result.get("action_items", []),
            checks=result.get("checks", []),
            criteria_snapshot=req.criteria,
        )
        result["review_id"] = saved["id"]
    except Exception as e:  # noqa: BLE001 - a save failure shouldn't hide a real review result
        result["save_error"] = f"Review completed but could not be saved to history: {e}"

    return result


@app.get("/api/reviews")
def api_list_reviews(client_id: Optional[int] = None, category_id: Optional[int] = None, limit: int = 500):
    reviews = db.list_reviews(limit=limit, client_id=client_id, category_id=category_id)
    return [review_to_response(r) for r in reviews]


@app.get("/api/reviews/{review_id}")
def api_get_review(review_id: int):
    r = db.get_review(review_id)
    if not r:
        raise HTTPException(status_code=404, detail="Review not found.")
    return review_to_response(r)


class VerdictOverride(BaseModel):
    verdict: str  # approved | needs_review | rejected


@app.put("/api/reviews/{review_id}/verdict")
def api_override_verdict(review_id: int, body: VerdictOverride):
    if body.verdict not in ("approved", "needs_review", "rejected"):
        raise HTTPException(status_code=400, detail="Unknown verdict.")
    if not db.get_review(review_id):
        raise HTTPException(status_code=404, detail="Review not found.")
    db.update_review_verdict(review_id, body.verdict)
    return {"updated": True}


@app.delete("/api/reviews/{review_id}")
def api_delete_review(review_id: int):
    r = db.get_review(review_id)
    if not r:
        raise HTTPException(status_code=404, detail="Review not found.")
    image_file = db.UPLOADS_DIR / r["image_path"]
    if image_file.exists():
        try:
            image_file.unlink()
        except OSError:
            pass
    db.delete_review(review_id)
    return {"deleted": True}


# =========================================================================
# Static front-end
# =========================================================================

app.mount("/css", StaticFiles(directory=BASE_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=BASE_DIR / "js"), name="js")
app.mount("/uploads", StaticFiles(directory=db.UPLOADS_DIR), name="uploads")


@app.get("/")
def index():
    return FileResponse(BASE_DIR / "index.html")


@app.get("/clients.html")
def clients_page():
    return FileResponse(BASE_DIR / "clients.html")


@app.get("/history.html")
def history_page():
    return FileResponse(BASE_DIR / "history.html")
