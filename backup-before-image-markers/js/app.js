/**
 * app.js
 * ------
 * UI wiring for the AI Image Reviewer. All state is in-memory only (no
 * persistence, no backend) — reloading the page resets everything.
 */

(() => {
  const DEFAULT_CRITERIA = [
    'Image is in focus and not blurry',
    'Lighting is even, with no harsh shadows or blown highlights',
    'Composition is balanced (subject framed well, not awkwardly cropped)',
    'No unwanted watermarks, text overlays, or logos are visible',
    'Overall resolution/quality is suitable for publishing'
  ];

  const state = {
    criteria: [...DEFAULT_CRITERIA],
    images: [] // { id, file, url, status, result }
  };

  let idCounter = 0;

  // ---------- DOM refs ----------
  const criteriaListEl = document.getElementById('criteria-list');
  const criteriaForm = document.getElementById('criteria-form');
  const criteriaInput = document.getElementById('criteria-input');

  const fileInput = document.getElementById('file-input');
  const folderInput = document.getElementById('folder-input');
  const uploadDrop = document.getElementById('upload-drop');

  const reviewAllBtn = document.getElementById('review-all-btn');
  const progressWrap = document.getElementById('progress-wrap');
  const progressFill = document.getElementById('progress-fill');
  const progressLabel = document.getElementById('progress-label');

  const emptyState = document.getElementById('empty-state');
  const galleryEl = document.getElementById('gallery');

  const detailPanel = document.getElementById('detail-panel');
  const detailBody = document.getElementById('detail-body');
  const detailClose = document.getElementById('detail-close');

  // ---------- Criteria management ----------
  function renderCriteria() {
    criteriaListEl.innerHTML = '';
    state.criteria.forEach((text, index) => {
      const li = document.createElement('li');
      li.className = 'criteria-item';

      const input = document.createElement('input');
      input.type = 'text';
      input.value = text;
      input.addEventListener('change', () => {
        state.criteria[index] = input.value.trim() || text;
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.innerHTML = '&times;';
      removeBtn.title = 'Remove criterion';
      removeBtn.addEventListener('click', () => {
        state.criteria.splice(index, 1);
        renderCriteria();
      });

      li.appendChild(input);
      li.appendChild(removeBtn);
      criteriaListEl.appendChild(li);
    });
  }

  criteriaForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = criteriaInput.value.trim();
    if (!value) return;
    state.criteria.push(value);
    criteriaInput.value = '';
    renderCriteria();
  });

  // ---------- Image ingestion ----------
  function addFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    files.forEach((file) => {
      state.images.push({
        id: ++idCounter,
        file,
        url: URL.createObjectURL(file),
        status: 'pending',
        result: null
      });
    });
    renderGallery();
    updateReviewAllButton();
  }

  fileInput.addEventListener('change', (e) => addFiles(e.target.files));
  folderInput.addEventListener('change', (e) => addFiles(e.target.files));

  ['dragenter', 'dragover'].forEach(evt =>
    uploadDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      uploadDrop.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach(evt =>
    uploadDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      uploadDrop.classList.remove('dragover');
    })
  );
  uploadDrop.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });
  uploadDrop.addEventListener('click', (e) => {
    // Avoid double-triggering when the hidden input itself is clicked.
    if (e.target !== fileInput) fileInput.click();
  });

  // ---------- Gallery rendering ----------
  const STATUS_LABELS = {
    pending: 'Pending',
    reviewing: 'Reviewing…',
    approved: 'Approved',
    rejected: 'Rejected',
    needs_review: 'Needs Review'
  };

  const STATUS_CLASS = {
    pending: 'status-pending',
    reviewing: 'status-reviewing',
    approved: 'status-approved',
    rejected: 'status-rejected',
    needs_review: 'status-review'
  };

  function renderGallery() {
    emptyState.hidden = state.images.length > 0;
    galleryEl.innerHTML = '';

    state.images.forEach((img) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.addEventListener('click', () => openDetail(img.id));

      const thumb = document.createElement('img');
      thumb.className = 'card-thumb';
      thumb.src = img.url;
      thumb.alt = img.file.name;

      const body = document.createElement('div');
      body.className = 'card-body';

      const name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = img.file.name;

      const pill = document.createElement('span');
      pill.className = `status-pill ${STATUS_CLASS[img.status]}`;
      if (img.status === 'reviewing') {
        pill.innerHTML = '<span class="spin"></span> Reviewing…';
      } else {
        pill.textContent = img.status === 'approved' || img.status === 'rejected' || img.status === 'needs_review'
          ? `${STATUS_LABELS[img.status]} · ${img.result.score}%`
          : STATUS_LABELS[img.status];
      }

      body.appendChild(name);
      body.appendChild(pill);
      card.appendChild(thumb);
      card.appendChild(body);
      galleryEl.appendChild(card);
    });
  }

  function updateReviewAllButton() {
    const hasPending = state.images.some(i => i.status === 'pending');
    reviewAllBtn.disabled = !hasPending;
  }

  // ---------- Review flow ----------
  async function reviewSingle(img) {
    img.status = 'reviewing';
    renderGallery();

    const result = await ReviewEngine.reviewImage(img.file, state.criteria);

    img.result = result;
    img.status = result.verdict; // 'approved' | 'rejected' | 'needs_review'
    renderGallery();
    updateUsageWidget();
  }

  reviewAllBtn.addEventListener('click', async () => {
    const pending = state.images.filter(i => i.status === 'pending');
    if (!pending.length) return;

    reviewAllBtn.disabled = true;
    progressWrap.hidden = false;
    let done = 0;

    for (const img of pending) {
      progressLabel.textContent = `${done} / ${pending.length}`;
      await reviewSingle(img);
      done += 1;
      progressFill.style.width = `${(done / pending.length) * 100}%`;
      progressLabel.textContent = `${done} / ${pending.length}`;
    }

    setTimeout(() => {
      progressWrap.hidden = true;
      progressFill.style.width = '0%';
    }, 800);

    updateReviewAllButton();
  });

  // ---------- Detail panel ----------
  function openDetail(id) {
    const img = state.images.find(i => i.id === id);
    if (!img) return;

    detailBody.innerHTML = '';

    const image = document.createElement('img');
    image.className = 'detail-img';
    image.src = img.url;
    detailBody.appendChild(image);

    const name = document.createElement('p');
    name.className = 'detail-name';
    name.textContent = img.file.name;
    detailBody.appendChild(name);

    if (img.status === 'pending') {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Not reviewed yet. Click "Review All Images" in the sidebar.';
      detailBody.appendChild(hint);
    } else if (img.status === 'reviewing') {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'The AI reviewer is analyzing this image…';
      detailBody.appendChild(hint);
    } else {
      const score = document.createElement('div');
      score.className = 'detail-score';
      score.textContent = `${img.result.score}%`;
      detailBody.appendChild(score);

      const verdict = document.createElement('div');
      verdict.className = 'detail-verdict';
      verdict.textContent = `Verdict: ${STATUS_LABELS[img.status]}`;
      detailBody.appendChild(verdict);

      // "Why" — the AI's plain-language explanation for this verdict.
      if (img.result.summary) {
        const summaryEl = document.createElement('p');
        summaryEl.className = 'detail-summary';
        summaryEl.textContent = img.result.summary;
        detailBody.appendChild(summaryEl);
      }

      const checksHeading = document.createElement('h3');
      checksHeading.className = 'detail-subheading';
      checksHeading.textContent = 'Criteria breakdown';
      detailBody.appendChild(checksHeading);

      const list = document.createElement('ul');
      list.className = 'check-list';
      img.result.checks.forEach((c) => {
        const li = document.createElement('li');
        li.className = 'check-item';

        const icon = document.createElement('span');
        icon.className = `check-icon ${c.pass ? 'pass' : 'fail'}`;
        icon.textContent = c.pass ? '✓' : '✕';

        const textWrap = document.createElement('div');
        textWrap.className = 'check-text';
        const strong = document.createElement('strong');
        strong.textContent = c.criterion;
        const comment = document.createElement('div');
        comment.className = 'check-comment';
        comment.textContent = c.comment;
        textWrap.appendChild(strong);
        textWrap.appendChild(comment);

        li.appendChild(icon);
        li.appendChild(textWrap);
        list.appendChild(li);
      });
      detailBody.appendChild(list);

      // "What needs to be fixed" — prefer the AI's own action items; fall
      // back to deriving them from failed checks if the backend didn't
      // supply any (e.g. an older cached response).
      const actionItems = (img.result.action_items && img.result.action_items.length)
        ? img.result.action_items
        : img.result.checks.filter(c => !c.pass).map(c => c.comment || c.criterion);

      const actionHeading = document.createElement('h3');
      actionHeading.className = 'detail-subheading';
      actionHeading.textContent = 'What needs to be fixed';
      detailBody.appendChild(actionHeading);

      if (actionItems.length) {
        const actionList = document.createElement('ul');
        actionList.className = 'action-list';
        actionItems.forEach((item) => {
          const li = document.createElement('li');
          li.textContent = item;
          actionList.appendChild(li);
        });
        detailBody.appendChild(actionList);
      } else {
        const okNote = document.createElement('p');
        okNote.className = 'hint';
        okNote.textContent = 'No issues found — this image meets all criteria.';
        detailBody.appendChild(okNote);
      }

      const note = document.createElement('div');
      note.className = 'detail-note';
      note.textContent = 'Reviewed by Claude via the local backend. If this looks like a connection error rather than a real review, check the status badge at the top of the page and README.md.';
      detailBody.appendChild(note);
    }

    detailPanel.hidden = false;
  }

  detailClose.addEventListener('click', () => { detailPanel.hidden = true; });

  // ---------- Token usage widget ----------
  const usageRequestsEl = document.getElementById('usage-requests');
  const usageInputEl = document.getElementById('usage-input');
  const usageOutputEl = document.getElementById('usage-output');
  const usageCostEl = document.getElementById('usage-cost');

  async function updateUsageWidget() {
    try {
      const res = await fetch('/api/usage');
      if (!res.ok) return;
      const data = await res.json();
      usageRequestsEl.textContent = data.requests.toLocaleString();
      usageInputEl.textContent = data.input_tokens.toLocaleString();
      usageOutputEl.textContent = data.output_tokens.toLocaleString();
      usageCostEl.textContent = `$${data.estimated_cost_usd.toFixed(4)}`;
    } catch (err) {
      // Silent — the connection badge already surfaces backend issues.
    }
  }

  // ---------- Backend status badge ----------
  const statusBadge = document.getElementById('ai-status-badge');

  async function checkBackendStatus() {
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error('bad response');
      const data = await res.json();

      if (data.connected) {
        statusBadge.textContent = `Claude Connected (${data.model})`;
        statusBadge.title = 'The backend has a Claude API key configured and is ready to review images.';
        statusBadge.classList.add('badge-connected');
      } else {
        statusBadge.textContent = 'Backend running — no API key configured';
        statusBadge.title = 'server.py is running but ANTHROPIC_API_KEY is missing from .env. See README.md.';
        statusBadge.classList.remove('badge-connected');
      }
    } catch (err) {
      statusBadge.textContent = 'Backend unreachable — Stub Mode';
      statusBadge.title = 'Could not reach /api/health. Make sure you started uvicorn and are viewing this page at http://localhost:8000 (not by opening index.html directly).';
      statusBadge.classList.remove('badge-connected');
    }
  }

  // ---------- Init ----------
  renderCriteria();
  renderGallery();
  updateReviewAllButton();
  checkBackendStatus();
  updateUsageWidget();
})();
