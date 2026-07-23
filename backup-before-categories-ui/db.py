"""
db.py
-----
SQLite persistence layer for the AI Image Reviewer.

Three tables:
  - clients:  named clients, each with an optional branding logo and notes.
  - criteria: review checklist items, each belonging to one client.
  - reviews:  saved review results (score, verdict, summary, checks, action
              items) plus a snapshot of the criteria actually used at review
              time (so editing a client's criteria later doesn't rewrite
              history) and a path to the saved image on disk.

Uses plain sqlite3 (Python standard library) -- the only extra dependency
this feature needs is python-multipart, for file uploads in server.py.
"""

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

BASE_DIR = Path(__file__).resolve().parent

# The database and saved images live in a "data" folder inside this project
# folder by default. If you ever move this project into a folder that syncs
# with OneDrive/Dropbox/Google Drive again, override REVIEWER_DATA_DIR to
# point somewhere NOT synced -- SQLite needs real file locking, and cloud
# sync clients can cause "database is locked" errors or silent corruption.
DATA_DIR = Path(os.getenv("REVIEWER_DATA_DIR", str(BASE_DIR / "data")))
DB_PATH = DATA_DIR / "reviewer.db"
UPLOADS_DIR = DATA_DIR / "uploads"
LOGOS_DIR = UPLOADS_DIR / "logos"
REVIEWS_DIR = UPLOADS_DIR / "reviews"

for _dir in (UPLOADS_DIR, LOGOS_DIR, REVIEWS_DIR):
    _dir.mkdir(parents=True, exist_ok=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS clients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                logo_path TEXT,
                notes TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS criteria (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                text TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
                client_name_snapshot TEXT,
                original_filename TEXT NOT NULL,
                image_path TEXT NOT NULL,
                score INTEGER NOT NULL,
                verdict TEXT NOT NULL,
                summary TEXT,
                action_items_json TEXT NOT NULL DEFAULT '[]',
                checks_json TEXT NOT NULL DEFAULT '[]',
                criteria_snapshot_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL
            );
            """
        )


# ---------- Clients ----------

def list_clients() -> list:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM clients ORDER BY name COLLATE NOCASE").fetchall()
        return [dict(r) for r in rows]


def get_client(client_id: int) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM clients WHERE id = ?", (client_id,)).fetchone()
        if not row:
            return None
        client = dict(row)
        crit_rows = conn.execute(
            "SELECT * FROM criteria WHERE client_id = ? ORDER BY position, id",
            (client_id,),
        ).fetchall()
        client["criteria"] = [dict(c) for c in crit_rows]
        return client


def create_client(name: str, notes: str = "") -> dict:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO clients (name, notes, created_at) VALUES (?, ?, ?)",
            (name, notes, _now()),
        )
        client_id = cur.lastrowid
    return get_client(client_id)


def update_client(client_id: int, name: Optional[str] = None, notes: Optional[str] = None) -> Optional[dict]:
    fields, values = [], []
    if name is not None:
        fields.append("name = ?")
        values.append(name)
    if notes is not None:
        fields.append("notes = ?")
        values.append(notes)
    if not fields:
        return get_client(client_id)
    values.append(client_id)
    with get_conn() as conn:
        conn.execute(f"UPDATE clients SET {', '.join(fields)} WHERE id = ?", values)
    return get_client(client_id)


def set_client_logo(client_id: int, logo_path: str) -> Optional[dict]:
    with get_conn() as conn:
        conn.execute("UPDATE clients SET logo_path = ? WHERE id = ?", (logo_path, client_id))
    return get_client(client_id)


def delete_client(client_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))


# ---------- Criteria ----------

def add_criterion(client_id: int, text: str) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM criteria WHERE client_id = ?",
            (client_id,),
        ).fetchone()
        next_pos = row["next_pos"]
        cur = conn.execute(
            "INSERT INTO criteria (client_id, text, position) VALUES (?, ?, ?)",
            (client_id, text, next_pos),
        )
        criterion_id = cur.lastrowid
        row = conn.execute("SELECT * FROM criteria WHERE id = ?", (criterion_id,)).fetchone()
        return dict(row)


def update_criterion(criterion_id: int, text: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE criteria SET text = ? WHERE id = ?", (text, criterion_id))


def delete_criterion(criterion_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM criteria WHERE id = ?", (criterion_id,))


# ---------- Reviews ----------

def save_review(
    *,
    client_id,
    client_name_snapshot,
    original_filename: str,
    image_path: str,
    score: int,
    verdict: str,
    summary: str,
    action_items: list,
    checks: list,
    criteria_snapshot: list,
) -> dict:
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO reviews (
                client_id, client_name_snapshot, original_filename, image_path,
                score, verdict, summary, action_items_json, checks_json,
                criteria_snapshot_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                client_id,
                client_name_snapshot,
                original_filename,
                image_path,
                score,
                verdict,
                summary,
                json.dumps(action_items),
                json.dumps(checks),
                json.dumps(criteria_snapshot),
                _now(),
            ),
        )
        review_id = cur.lastrowid
    return get_review(review_id)


def _row_to_review(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["action_items"] = json.loads(d.pop("action_items_json") or "[]")
    d["checks"] = json.loads(d.pop("checks_json") or "[]")
    d["criteria_snapshot"] = json.loads(d.pop("criteria_snapshot_json") or "[]")
    return d


def get_review(review_id: int) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM reviews WHERE id = ?", (review_id,)).fetchone()
        return _row_to_review(row) if row else None


def list_reviews(limit: int = 100, client_id=None) -> list:
    with get_conn() as conn:
        if client_id is not None:
            rows = conn.execute(
                "SELECT * FROM reviews WHERE client_id = ? ORDER BY id DESC LIMIT ?",
                (client_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM reviews ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        return [_row_to_review(r) for r in rows]


def delete_review(review_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM reviews WHERE id = ?", (review_id,))
