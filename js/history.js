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
  const categoryFilterWrap = document.getElementById('history-category-filter-wrap');
  const categoryFilter = document.getElementById('history-category-filter');
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
      const res = await fetch('api/clients');
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

  // Categories are per-client, so the category filter only makes sense once
  // a specific client is chosen — it repopulates from that client's list.
  async function refreshCategoryFilter() {
    const clientId = clientFilter.value;
    categoryFilter.innerHTML = '<option value="">All categories</option>';
    categoryFilter.value = '';

    if (!clientId) {
      categoryFilterWrap.hidden = true;
      return;
    }

    try {
      const res = await fetch(`api/clients/${clientId}/categories`);
      if (!res.ok) return;
      const categories = await res.json();
      categories.forEach((cat) => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name;
        categoryFilter.appendChild(opt);
      });
      categoryFilterWrap.hidden = categories.length === 0;
    } catch (err) {
      categoryFilterWrap.hidden = true;
    }
  }

  async function loadReviews() {
    const clientId = clientFilter.value;
    const categoryId = categoryFilter.value;
    const params = new URLSearchParams();
    if (clientId) params.set('client_id', clientId);
    if (categoryId) params.set('category_id', categoryId);
    const url = params.toString() ? `api/reviews?${params.toString()}` : 'api/reviews';
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
      const metaParts = [r.client_name_snapshot || 'No client'];
      if (r.category_name_snapshot) metaParts.push(r.category_name_snapshot);
      metaParts.push(formatDate(r.created_at));
      meta.textContent = metaParts.join(' · ');

      body.appendChild(name);
      body.appendChild(pill);
      body.appendChild(meta);
      card.appendChild(thumb);
      card.appendChild(body);
      galleryEl.appendChild(card);
    });
  }

  function openDetail(r) {
    const metaParts = [r.client_name_snapshot || 'No client'];
    if (r.category_name_snapshot) metaParts.push(r.category_name_snapshot);
    metaParts.push(`Reviewed ${formatDate(r.created_at)}`);

    DetailView.render(detailBody, {
      imageUrl: r.image_url,
      filename: r.original_filename,
      score: r.score,
      verdict: r.verdict,
      summary: r.summary,
      checks: r.checks,
      actionItems: r.action_items,
      metaLine: metaParts.join(' · '),
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
      await fetch(`api/reviews/${r.id}`, { method: 'DELETE' });
      detailPanel.hidden = true;
      await loadReviews();
    });
    detailBody.appendChild(deleteBtn);

    detailPanel.hidden = false;
  }

  detailClose.addEventListener('click', () => { detailPanel.hidden = true; });
  clientFilter.addEventListener('change', async () => {
    await refreshCategoryFilter();
    await loadReviews();
  });
  categoryFilter.addEventListener('change', loadReviews);

  loadClientOptions();
  loadReviews();
})();
