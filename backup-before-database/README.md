# AI Image Reviewer

A browser-based tool where Claude reviews uploaded images against a custom
checklist you define, instead of a human reviewing them manually.

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
  tokens, and an estimated cost for the current server session.

No persistence — everything (reviews, usage counters) resets when you
restart the server or reload the page. That's intentional for this
iteration; see "Next iteration ideas" below.

## File structure

```
index.html          Page shell / layout
css/styles.css       All styling
js/app.js             UI state and wiring (upload, criteria, gallery, detail panel, usage widget)
js/reviewEngine.js    Sends the image + criteria to the backend; never throws
server.py             FastAPI backend: serves the front-end + calls Claude's vision API
requirements.txt      Python dependencies
.env.example           Template for your API key and settings (copy to .env, never commit .env)
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

## Reverting the image-marker feature

If the circled-issue markers turn out to be unreliable or you'd rather not
have them, `backup-before-image-markers/` in this folder holds a full copy
of `index.html`, `css/styles.css`, `js/app.js`, `js/reviewEngine.js`, and
`server.py` from right before this feature was added. Copy those five files
back over the current ones (overwriting them) to revert cleanly.

## Next iteration ideas

Persisting review results (file or database) and cumulative usage stats
across restarts, exporting results (CSV/JSON), majority-vote consistency
checking for high-stakes reviews, image resizing before upload for large
batches, a retry button per image, and auth if this moves beyond
local/single-user use.
