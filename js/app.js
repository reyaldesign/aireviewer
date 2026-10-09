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
    images: [], // { id, file, url, status, result }
    clientId: null,
    categoryId: null
  };

  let idCounter = 0;
  let currentClientCategories = [];

  // ---------- DOM refs ----------
  const clientSelect = document.getElementById('client-select');
  const clientLogoPreview = document.getElementById('client-logo-preview');
  const clientLogoImg = document.getElementById('client-logo-img');
  const categorySelectWrap = document.getElementById('category-select-wrap');
  const categorySelect = document.getElementById('category-select');

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

  // ---------- Client selection ----------
  // Picking a client auto-loads their saved criteria (editable ad hoc for
  // this session) and tags every review in this batch with that client, so
  // it shows up filtered under that client in Previous Reviews.
  async function loadClientOptions() {
    try {
      const res = await fetch('api/clients');
      if (!res.ok) return;
      const clients = await res.json();
      clientSelect.innerHTML = '<option value="">No client (use criteria below)</option>';
      clients.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        clientSelect.appendChild(opt);
      });
    } catch (err) {
      // Silent — the client picker is optional; manual criteria still work.
    }
  }

  clientSelect.addEventListener('change', async () => {
    const value = clientSelect.value;
    state.clientId = value ? Number(value) : null;
    state.categoryId = null;
    clientLogoPreview.hidden = true;
    categorySelectWrap.hidden = true;
    categorySelect.innerHTML = '<option value="">Choose a category&hellip;</option>';
    currentClientCategories = [];

    if (!state.clientId) return;

    try {
      const res = await fetch(`api/clients/${state.clientId}`);
      if (!res.ok) return;
      const c = await res.json();

      if (c.logo_path) {
        clientLogoImg.src = `uploads/${c.logo_path}`;
        clientLogoPreview.hidden = false;
      }

      currentClientCategories = c.categories || [];
      if (currentClientCategories.length) {
        currentClientCategories.forEach((cat) => {
          const opt = document.createElement('option');
          opt.value = cat.id;
          opt.textContent = cat.name;
          categorySelect.appendChild(opt);
        });
        categorySelectWrap.hidden = false;
      }
    } catch (err) {
      // Silent — fall back to whatever criteria are already loaded.
    }
  });

  categorySelect.addEventListener('change', () => {
    const value = categorySelect.value;
    state.categoryId = value ? Number(value) : null;

    if (!state.categoryId) return;

    const category = currentClientCategories.find(cat => cat.id === state.categoryId);
    if (category) {
      state.criteria = (category.criteria || []).map(cr => cr.text);
      renderCriteria();
    }
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

    const result = await ReviewEngine.reviewImage(img.file, state.criteria, img.file.name, state.clientId, state.categoryId);

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

    if (img.status === 'pending' || img.status === 'reviewing') {
      detailBody.innerHTML = '';

      const image = document.createElement('img');
      image.className = 'detail-img';
      image.src = img.url;
      detailBody.appendChild(image);

      const name = document.createElement('p');
      name.className = 'detail-name';
      name.textContent = img.file.name;
      detailBody.appendChild(name);

      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = img.status === 'pending'
        ? 'Not reviewed yet. Click "Review All Images" in the sidebar.'
        : 'The AI reviewer is analyzing this image…';
      detailBody.appendChild(hint);
    } else {
      // Completed review — render via the shared DetailView so this stays
      // visually consistent with the Previous Reviews history page.
      DetailView.render(detailBody, {
        imageUrl: img.url,
        filename: img.file.name,
        score: img.result.score,
        verdict: img.status,
        summary: img.result.summary,
        checks: img.result.checks,
        actionItems: img.result.action_items,
        footerNote: 'Reviewed by Claude via the local backend. If this looks like a connection error rather than a real review, check the status badge at the top of the page and README.md.',
      });
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
      const res = await fetch('api/usage');
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
      const res = await fetch('api/health');
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
  loadClientOptions();
})();
