/**
 * history.js
 * ----------
 * UI wiring for the Previous Reviews page: lists saved reviews (from the
 * SQLite-backed /api/reviews endpoint), lets you filter by client, and
 * opens the same detail view used on the main Review page (via
 * detailView.js) with a delete option added.
 */

(() => {
  const clientFilter = document.getElementById('history-client-filter');
  const emptyState = document.getElementById('history-empty-state');
  const galleryEl = document.getElementById('history-gallery');
  const detailPanel = document.getElementById('detail-panel');
  const detailBody = document.getElementById('detail-body');
  const detailClose = document.getElementById('detail-close');

  const STATUS_CLASS = {
    approved: 'status-approved',
    rejected: 'status-rejected',
    needs_review: 'status-review',
  };

  let reviews = [];

  async function loadClientOptions() {
    try {
      const res = await fetch('/api/clients');
      if (!res.ok) return;
      const clients = await res.json();
      clients.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        clientFilter.appendChild(opt);
      });
    } catch (err) {
      // Silent — filter just won't have client options.
    }
  }

  async function loadReviews() {
    const clientId = clientFilter.value;
    const url = clientId ? `/api/reviews?client_id=${encodeURIComponent(clientId)}` : '/api/reviews';
    try {
      const res = await fetch(url);
      reviews = res.ok ? await res.json() : [];
    } catch (err) {
      reviews = [];
    }
    renderGallery();
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleString();
    } catch (err) {
      return iso;
    }
  }

  function renderGallery() {
    emptyState.hidden = reviews.length > 0;
    galleryEl.innerHTML = '';

    reviews.forEach((r) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.addEventListener('click', () => openDetail(r));

      const thumb = document.createElement('img');
      thumb.className = 'card-thumb';
      thumb.src = r.image_url;
      thumb.alt = r.original_filename;

      const body = document.createElement('div');
      body.className = 'card-body';

      const name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = r.original_filename;

      const pill = document.createElement('span');
      pill.className = `status-pill ${STATUS_CLASS[r.verdict] || 'status-review'}`;
      pill.textContent = `${DetailView.STATUS_LABELS[r.verdict] || r.verdict} · ${r.score}%`;

      const meta = document.createElement('div');
      meta.className = 'hint';
      meta.textContent = `${r.client_name_snapshot || 'No client'} · ${formatDate(r.created_at)}`;

      body.appendChild(name);
      body.appendChild(pill);
      body.appendChild(meta);
      card.appendChild(thumb);
      card.appendChild(body);
      galleryEl.appendChild(card);
    });
  }

  function openDetail(r) {
    DetailView.render(detailBody, {
      imageUrl: r.image_url,
      filename: r.original_filename,
      score: r.score,
      verdict: r.verdict,
      summary: r.summary,
      checks: r.checks,
      actionItems: r.action_items,
      metaLine: `${r.client_name_snapshot || 'No client'} · Reviewed ${formatDate(r.created_at)}`,
      footerNote: 'Saved review from history. The criteria used at review time are preserved even if this client\'s criteria have changed since.',
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.style.marginTop = '14px';
    deleteBtn.style.width = '100%';
    deleteBtn.textContent = 'Delete this review';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('Delete this saved review and its image? This cannot be undone.')) return;
      await fetch(`/api/reviews/${r.id}`, { method: 'DELETE' });
      detailPanel.hidden = true;
      await loadReviews();
    });
    detailBody.appendChild(deleteBtn);

    detailPanel.hidden = false;
  }

  detailClose.addEventListener('click', () => { detailPanel.hidden = true; });
  clientFilter.addEventListener('change', loadReviews);

  loadClientOptions();
  loadReviews();
})();
