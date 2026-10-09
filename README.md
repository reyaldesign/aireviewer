# AI Image Reviewer

A browser-based tool where Claude reviews uploaded images against a custom
checklist you define, instead of a human reviewing them manually.

## Screens (new UI)

Built from the Reyal Proof design handoff (option 1a). All URLs are relative, so it runs at `/` or under `/aireviewer/`.

- **AI Review** (`index.html`): pick client and category, drop images, review the batch. Results are a grid with a detail panel. Verdicts: Ready for proofing (80+), Needs revisions (50-79), Fails (under 50). Each criterion is pass, warn or fail.
- **History** (`history.html`): saved reviews grouped by day, filter by status, client, category, or file name.
- **Clients** (`clients.html`): per-client criteria. Criteria for every category sit on top, each category adds its own. Drag to reorder.
- "Send to proofing" is shown but disabled until this lives inside Reyal Proof.
- Criteria saved before this version are one long line per category. Re-enter them as separate rows on the Clients screen.

## What it does

- Upload images (file picker, folder select, or drag-and-drop).
- Define your own review criteria in the sidebar — add, edit, or remove
  checklist items.
- Click "Review All Images" to have Claude grade each pending image against
  your current criteria list, with a live progress bar.
- Click any reviewed image to see: its score and verdict (Approved / Needs
  Review / Rejected), a plain-language summary of *why* Claude reached that
  verdict, a "what needs to be fixed" action-item list, and a full
  criteria-by-criteria breakdown with pass/fail and comments.
- **Experimental:** for failed criteria tied to a specific spot in the image
  (like a misspelled word), Claude estimates a location and the image gets a
  circled marker there — hover a circle to see which issue it's pointing at.
  This is a best-effort visual estimate from the model, not a measured
  bounding box, so treat it as a helpful pointer rather than pixel-precise.
- A Token Usage panel in the sidebar tracks cumulative requests, input/output
  tokens, and an estimated cost for the current server session (this counter
  still resets on restart; only reviews/clients are persisted).
- **Clients:** a "Manage Clients" page where you can create clients and
  upload a branding logo. Select a client on the main Review page to
  auto-load their criteria for that batch — every review in the batch is
  tagged with that client.
- **Image categories:** each client has their own set of image categories
  (Reel/Animation, Flyer, Photo Resize, Carousel, Story/IG Cover, Profile
  Logo by default, plus a "+ Add Category" button for more), and each
  category has its own criteria. On the Review page, picking a client then
  a category loads that category's criteria automatically.
- **Previous Reviews:** every review (image, score, verdict, summary, action
  items, and the exact criteria used at the time) is saved to a local
  database, so it survives a server restart or page reload. The "Previous
  Reviews" page lists all of them, filterable by client, with the same
  detail view as the main page plus a delete option.

## File structure

```
index.html            Main Review page (upload, criteria, gallery, detail panel)
clients.html           Manage Clients page (per-client criteria + branding logo)
history.html           Previous Reviews page (saved review history)
css/styles.css         All styling
js/app.js              Review page wiring (upload, criteria, client picker, gallery)
js/reviewEngine.js     Sends the image + criteria to the backend; never throws
js/detailView.js       Shared "review detail" renderer used by both index.html and history.html
js/clients.js          Manage Clients page wiring
js/history.js          Previous Reviews page wiring
server.py              FastAPI backend: serves the front-end, calls Claude's vision API, exposes the clients/criteria/reviews API
db.py                  SQLite persistence layer (clients, criteria, reviews)
requirements.txt       Python dependencies
.env.example            Template for your API key and settings (copy to .env, never commit .env)
data/                   Created on first run — SQLite database + saved review images/logos (gitignored)
```

## 1. Get an Anthropic API key

1. Go to **https://console.anthropic.com** and sign up or log in. Note this
   is separate from a Claude.ai / Cowork login — a Claude Enterprise or Pro
   plan does not include API access, and vice versa.
2. Open **Settings -> API Keys** and click **Create Key**.
3. Copy the key (it's only shown once) — this requires billing to be set up
   on the console account to make actual API calls.

## 2. Set up the backend

```bash
cd "path/to/Claude - Image Reviewer Web Project"
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# open .env and paste your real key into ANTHROPIC_API_KEY=
```

## 3. Run it

```bash
uvicorn server:app --reload --port 8000
```

If `uvicorn` isn't recognized on your PATH, run it through Python instead:

```bash
python -m uvicorn server:app --reload --port 8000
```

Open **http://localhost:8000** (not by double-clicking `index.html`
directly — it needs the backend to serve it). Upload images, edit your
criteria, click "Review All Images."

## Clients, categories & Previous Reviews

Go to **Manage Clients** to create a client and optionally upload a
branding logo. Every new client is automatically seeded with 6 default
image categories: Reel/Animation, Flyer, Photo Resize, Carousel, Story/IG
Cover, and Profile Logo. Add criteria under each category (they're
independent — "Flyer" criteria are separate from "Carousel" criteria), and
use the **+ Add Category** button at the bottom of a client's page to add
more categories any time (rename or delete a category with the controls in
its header).

If you had clients/criteria saved before this feature existed, they were
migrated automatically: the 6 default categories were added, and your old
criteria were moved into a new "General" category so nothing was lost —
feel free to re-sort them into more specific categories afterward.

Back on the main **Review** page, pick a client from the "Client" dropdown,
then pick an "Image type" (category) — that category's criteria load
automatically (still editable ad hoc for that session), and every review in
the batch gets tagged with both the client and category so it's easy to
find later.

**Previous Reviews** lists every saved review, newest first, filterable by
client and (once a client is picked) by category. Editing a client's
criteria later does not change how past reviews are displayed — each saved
review keeps a snapshot of the exact criteria that were active when it ran.

Everything is stored in a `data/` folder that's created automatically next
to `server.py` on first run (SQLite database + the actual reviewed images
and uploaded logos). It's gitignored and not something you need to touch
directly. If you ever move this project into a OneDrive/Dropbox/Google
Drive synced folder, set `REVIEWER_DATA_DIR` in `.env` to point somewhere
NOT synced — SQLite needs real file locking, and cloud-sync clients can
cause "database is locked" errors or silent corruption.

## Getting consistent results

Recent Claude models (including `claude-sonnet-5`) don't accept the
`temperature`, `top_p`, or `top_k` parameters at all — Anthropic has moved
away from those sampling controls on newer models, so we can't force
bit-for-bit identical answers on every run the way older APIs allowed.

To get results as consistent as possible instead, `server.py`:

- Sets `output_config={"effort": "high"}` on every request (configurable
  via `CLAUDE_EFFORT` in `.env` — options are `max`, `xhigh`, `high`,
  `medium`, `low`; lower is faster/cheaper but less consistent). `high` is
  Anthropic's own recommended default for quality-sensitive tasks.
- Uses a system prompt that explicitly tells Claude to transcribe visible
  text before judging any spelling/wording criteria, rather than guessing.
- Uses a `CLAUDE_MAX_TOKENS` budget (default 8192) so Claude's internal
  reasoning has room to finish before the response is cut off.

**Important:** if you raise `CLAUDE_EFFORT` to `xhigh` or `max`, you must
also raise `CLAUDE_MAX_TOKENS` a lot (Anthropic's own guidance suggests
starting around 64000 for max-effort tasks) — otherwise Claude's internal
reasoning eats the whole token budget and the response gets cut off before
it finishes writing the JSON answer, which shows up as a "cut off before
finishing" or "could not be parsed as JSON" error on every review. This
project defaults to `high` effort specifically to avoid that failure mode
out of the box.

This significantly improves consistency and accuracy, especially for
detail-sensitive criteria like catching a misspelling, but it is not a
hard guarantee — occasional variation between runs on borderline images is
expected behavior from the model, not a bug in this app. If you need even
more consistency for a specific use case, consider running each image
through review 2-3 times and taking the majority verdict (not implemented
here, but straightforward to add in `js/app.js`'s `reviewSingle` function).

## Troubleshooting

- **"ANTHROPIC_API_KEY is not set"** — check `.env` exists (not just
  `.env.example`) and that uvicorn was restarted after editing it.
- **Every image comes back "Needs Review" with a connection error
  comment** — the backend isn't running, or isn't reachable at
  `/api/review`. Confirm uvicorn is running and you're loading the app
  from `http://localhost:8000`, not by opening `index.html` directly.
- **Claude API errors (401/429/etc.)** — 401 means the key is wrong or
  billing isn't set up; 429 means you're rate-limited/out of credits.
  The error detail from the API is surfaced directly in the review
  result's comment.
- **`{"detail":"Not Found"}` when loading the page** — the server is
  running but its "/" route isn't registered; this usually means
  `server.py` got truncated somehow. Check that it ends with the
  `app.mount(...)` calls and the final `@app.get("/")` route.
- **"Cut off before finishing" or "could not be parsed as JSON" on every
  review** — Claude's response hit the `CLAUDE_MAX_TOKENS` limit before it
  finished. This usually happens if you've raised `CLAUDE_EFFORT` to
  `xhigh` or `max` without also raising `CLAUDE_MAX_TOKENS`. Either lower
  the effort level back down, or raise `CLAUDE_MAX_TOKENS` substantially in
  `.env`.
- **`pip` or `uvicorn` "is not recognized"** — Python's Scripts folder
  isn't on your PATH. Use `python -m pip install ...` and
  `python -m uvicorn ...` instead.
- **`Could not import module "server"`** — uvicorn is being run from the
  wrong folder (it needs to run from directly inside this project folder,
  where `server.py` lives), or `db.py` is missing/incomplete next to it.
  `cd` into this exact folder first, confirm `dir` (or `ls`) shows both
  `server.py` and `db.py`, then run `python -m uvicorn server:app --reload
  --port 8000` again. Also make sure `python-multipart` is installed
  (`pip install -r requirements.txt` covers it) — it's needed for the
  client logo upload feature.
- **"database is locked" errors, or reviews/clients not saving** — almost
  always means `data/` (or wherever `REVIEWER_DATA_DIR` points) is inside a
  OneDrive/Dropbox/Google Drive synced folder. Move this project (or just
  the data folder, via `REVIEWER_DATA_DIR`) somewhere not synced.

## Reverting the image-marker feature

If the circled-issue markers turn out to be unreliable or you'd rather not
have them, `backup-before-image-markers/` in this folder holds a full copy
of `index.html`, `css/styles.css`, `js/app.js`, `js/reviewEngine.js`, and
`server.py` from right before this feature was added. Copy those five files
back over the current ones (overwriting them) to revert cleanly.

## Reverting the database feature

If the persistence/clients/history feature causes problems and you want to
go back to the in-memory-only version, `backup-before-database/` in this
folder holds a full copy of `index.html`, `css/styles.css`, `js/app.js`,
`js/reviewEngine.js`, `server.py`, `requirements.txt`, `README.md`, and
`.env.example` from right before this feature was added. Copy those files
back over the current ones, then also delete `clients.html`, `history.html`,
`db.py`, `js/clients.js`, `js/history.js`, `js/detailView.js`, and the
`data/` folder (the last one holds your saved reviews/images, so only
delete it if you're sure you don't want that history).

## Reverting the image categories / centered nav / bigger close button

If the per-client image categories, the centered navigation bar, or the
larger detail-panel close button need to be rolled back,
`backup-before-categories-ui/` in this folder holds a full copy of every
front-end and backend file from right before those changes (everything
except `clients.html`/`history.html`, which didn't exist to change).
Copying those files back over the current ones reverts the interface
changes; note this also reverts `db.py` to the pre-categories schema, which
means new reviews created after that point won't have `category_id` set
until you re-apply the categories update.

## Deploying to a live server

This app needs a persistent Python process and writable local disk, so it
needs a real VPS with root access (shared/serverless hosting can't run it).
See [`deploy/DEPLOY_DIGITALOCEAN.md`](deploy/DEPLOY_DIGITALOCEAN.md) for
the full walkthrough on a $6/mo DigitalOcean Droplet: server setup, a
`git push production main` deploy workflow (mirroring a Heroku-style git
deploy), a systemd service to keep the app running, an Nginx reverse
proxy, and HTTP basic auth so the app isn't publicly open. If you'd
rather use DreamHost's VPS instead, the same config files work with
[`deploy/DEPLOY_DREAMHOST.md`](deploy/DEPLOY_DREAMHOST.md). The `deploy/`
folder has the ready-to-copy config files (`gunicorn-reviewer.service`,
`nginx-reviewer.conf`, `post-receive`) referenced in both guides.

## Next iteration ideas

Exporting results (CSV/JSON), majority-vote consistency checking for
high-stakes reviews, image resizing before upload for large batches, a
retry button per image, bulk-assigning a client to already-uploaded images,
and auth if this moves beyond local/single-user use.
