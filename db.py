"""
db.py
-----
SQLite persistence layer for the AI Image Reviewer.

Tables:
  - clients:    named clients, each with an optional branding logo and notes.
  - categories: per-client image categories (Reel/Animation, Flyer, etc.) --
                each client gets their own independent set, seeded with
                DEFAULT_CATEGORIES when the client is created.
  - criteria:   review checklist items, each belonging to one category
                (and, redundantly, to that category's client).
  - reviews:    saved review results (score, verdict, summary, checks, action
                items) plus a snapshot of the criteria/category/client
                actually used at review time (so editing them later doesn't
                rewrite history) and a path to the saved image on disk.

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

# Default image categories every new client is seeded with. Editable/
# extensible per client afterwards via the "+ Add Category" control on the
# Manage Clients page -- this list is just the starting point.
DEFAULT_CATEGORIES = [
    "Reel/Animation",
    "Flyer",
    "Photo Resize",
    "Carousel",
    "Story/IG Cover",
    "Profile Logo",
]


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


def _table_columns(conn, table: str) -> set:
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _migrate_schema(conn):
    """Additive, idempotent schema migrations for installs created before
    the categories feature existed. Never drops or renames columns, so it's
    always safe to run against a real, already-populated database."""
    criteria_cols = _table_columns(conn, "criteria")
    if "category_id" not in criteria_cols:
        conn.execute("ALTER TABLE criteria ADD COLUMN category_id INTEGER")

    review_cols = _table_columns(conn, "reviews")
    if "category_id" not in review_cols:
        conn.execute("ALTER TABLE reviews ADD COLUMN category_id INTEGER")
    if "category_name_snapshot" not in review_cols:
        conn.execute("ALTER TABLE reviews ADD COLUMN category_name_snapshot TEXT")


def _seed_default_categories(conn, client_id: int):
    for i, name in enumerate(DEFAULT_CATEGORIES):
        conn.execute(
            "INSERT INTO categories (client_id, name, position) VALUES (?, ?, ?)",
            (client_id, name, i),
        )


def _migrate_existing_clients(conn):
    """For clients created before categories existed: seed the default
    categories if they have none yet, and move any criteria that predate
    categories into a "General" category so nothing is lost."""
    clients = conn.execute("SELECT id FROM clients").fetchall()
    for row in clients:
        client_id = row["id"]

        cat_count = conn.execute(
            "SELECT COUNT(*) AS c FROM categories WHERE client_id = ?", (client_id,)
        ).fetchone()["c"]
        if cat_count == 0:
            _seed_default_categories(conn, client_id)

        orphaned = conn.execute(
            "SELECT id FROM criteria WHERE client_id = ? AND category_id IS NULL",
            (client_id,),
        ).fetchall()
        if not orphaned:
            continue

        general = conn.execute(
            "SELECT id FROM categories WHERE client_id = ? AND name = 'General'",
            (client_id,),
        ).fetchone()
        if general:
            general_id = general["id"]
        else:
            next_pos = conn.execute(
                "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM categories WHERE client_id = ?",
                (client_id,),
            ).fetchone()["p"]
            cur = conn.execute(
                "INSERT INTO categories (client_id, name, position) VALUES (?, 'General', ?)",
                (client_id, next_pos),
            )
            general_id = cur.lastrowid

        conn.execute(
            "UPDATE criteria SET category_id = ? WHERE client_id = ? AND category_id IS NULL",
            (general_id, client_id),
        )


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

            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0
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
        _migrate_schema(conn)
        _migrate_existing_clients(conn)


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
        cat_rows = conn.execute(
            "SELECT * FROM categories WHERE client_id = ? ORDER BY position, id",
            (client_id,),
        ).fetchall()
        categories = []
        for cat in cat_rows:
            cat_dict = dict(cat)
            crit_rows = conn.execute(
                "SELECT * FROM criteria WHERE category_id = ? ORDER BY position, id",
                (cat_dict["id"],),
            ).fetchall()
            cat_dict["criteria"] = [dict(c) for c in crit_rows]
            categories.append(cat_dict)
        client["categories"] = categories
        return client


def create_client(name: str, notes: str = "") -> dict:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO clients (name, notes, created_at) VALUES (?, ?, ?)",
            (name, notes, _now()),
        )
        client_id = cur.lastrowid
        _seed_default_categories(conn, client_id)
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


# ---------- Categories ----------

def list_categories(client_id: int) -> list:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM categories WHERE client_id = ? ORDER BY position, id",
            (client_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_category(category_id: int) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM categories WHERE id = ?", (category_id,)).fetchone()
        return dict(row) if row else None


def create_category(client_id: int, name: str) -> dict:
    with get_conn() as conn:
        next_pos = conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM categories WHERE client_id = ?",
            (client_id,),
        ).fetchone()["p"]
        cur = conn.execute(
            "INSERT INTO categories (client_id, name, position) VALUES (?, ?, ?)",
            (client_id, name, next_pos),
        )
        row = conn.execute("SELECT * FROM categories WHERE id = ?", (cur.lastrowid,)).fetchone()
        return dict(row)


def update_category(category_id: int, name: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE categories SET name = ? WHERE id = ?", (name, category_id))


def delete_category(category_id: int) -> None:
    with get_conn() as conn:
        # criteria.category_id has no DB-level cascade (added via ALTER), so
        # clean those up explicitly before removing the category itself.
        conn.execute("DELETE FROM criteria WHERE category_id = ?", (category_id,))
        conn.execute("DELETE FROM categories WHERE id = ?", (category_id,))


# ---------- Criteria ----------

def add_criterion(category_id: int, text: str) -> dict:
    with get_conn() as conn:
        cat = conn.execute("SELECT client_id FROM categories WHERE id = ?", (category_id,)).fetchone()
        client_id = cat["client_id"] if cat else None
        next_pos = conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM criteria WHERE category_id = ?",
            (category_id,),
        ).fetchone()["p"]
        cur = conn.execute(
            "INSERT INTO criteria (client_id, category_id, text, position) VALUES (?, ?, ?, ?)",
            (client_id, category_id, text, next_pos),
        )
        row = conn.execute("SELECT * FROM criteria WHERE id = ?", (cur.lastrowid,)).fetchone()
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
    category_id=None,
    category_name_snapshot=None,
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
                client_id, client_name_snapshot, category_id, category_name_snapshot,
                original_filename, image_path, score, verdict, summary,
                action_items_json, checks_json, criteria_snapshot_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                client_id,
                client_name_snapshot,
                category_id,
                category_name_snapshot,
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


def list_reviews(limit: int = 100, client_id=None, category_id=None) -> list:
    with get_conn() as conn:
        clauses = []
        params = []
        if client_id is not None:
            clauses.append("client_id = ?")
            params.append(client_id)
        if category_id is not None:
            clauses.append("category_id = ?")
            params.append(category_id)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)
        rows = conn.execute(
            f"SELECT * FROM reviews {where} ORDER BY id DESC LIMIT ?", params
        ).fetchall()
        return [_row_to_review(r) for r in rows]


def delete_review(review_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM reviews WHERE id = ?", (review_id,))
