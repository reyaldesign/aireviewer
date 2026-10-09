/** history.js: saved reviews, grouped by day, with status / client / category / name filters. */
(() => {
  const { h, V, vk, V_TO_KEY } = UI;
  const $ = (id) => document.getElementById(id);
  UI.mountShell('history');

  let reviews = [];
  const f = { status: 'all', client: '', category: '', q: '' };

  const dayKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  function dayLabel(iso) {
    const d = new Date(iso), now = new Date();
    const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  }
  const clientName = (r) => r.client_name_snapshot || 'No client';
  const catName = (r) => r.category_name_snapshot || 'No category';

  function renderStatus() {
    const defs = [['all', 'All', 'var(--muted)'], ['ready', 'Ready', V.ready.color], ['needs', 'Needs revisions', V.needs.color], ['fails', 'Fails', V.fails.color]];
    $('status').replaceChildren(...defs.map(([k, label, dot]) =>
      h('button', { type: 'button', class: f.status === k ? 'on' : '', onclick: () => { f.status = k; renderStatus(); renderDays(); } }, h('i', { style: `background:${dot}` }), label)));
  }

  function fillSelect(sel, allLabel, values, current) {
    sel.replaceChildren(h('option', { value: '' }, allLabel), ...values.map((v) => h('option', { value: v }, v)));
    sel.value = current;
  }

  function renderDays() {
    const shown = reviews.filter((r) =>
      (f.status === 'all' || vk(r.verdict) === f.status) &&
      (!f.client || clientName(r) === f.client) && (!f.category || catName(r) === f.category) &&
      (!f.q || r.original_filename.toLowerCase().includes(f.q)));
    $('total').textContent = String(reviews.length);
    $('empty').hidden = shown.length > 0;
    $('empty').textContent = reviews.length ? 'No reviews match these filters.' : 'No reviews yet. Run a batch on the AI Review page.';

    const groups = new Map();
    shown.forEach((r) => { const k = dayKey(r.created_at); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
    $('days').replaceChildren(...[...groups.values()].map((items) => {
      const batches = new Set(items.map((r) => `${clientName(r)}|${catName(r)}`));
      const n = `${items.length} image${items.length === 1 ? '' : 's'}`;
      const meta = batches.size === 1 ? `${clientName(items[0])} · ${catName(items[0])} · ${n}` : `${batches.size} batches · ${n}`;
      return h('div', { class: 'day' },
        h('div', { class: 'row' }, h('h3', {}, dayLabel(items[0].created_at)), h('span', { class: 'meta' }, meta)),
        h('div', { class: 'hgrid' }, items.map((r) => {
          const k = vk(r.verdict);
          return h('button', { type: 'button', class: 'hcard', onclick: () => open(r) },
            h('div', { class: 'im', style: `background-image:url("${r.image_url}")` }, h('span', { class: 'badge', style: `background:${V[k].color}` }, String(r.score))),
            h('div', { class: 'cb' }, h('b', { style: `color:${V[k].color}` }, V[k].label), h('span', { title: r.original_filename }, `${clientName(r)} · ${catName(r)}`)));
        })));
    }));
  }

  function close() { $('drawer-root').replaceChildren(); }
  function open(r) {
    const panel = h('div', { class: 'drawer' }, h('button', { class: 'x', 'aria-label': 'Close', onclick: close }, '×'));
    const body = h('div', { style: 'display:flex;flex-direction:column;gap:14px;flex:1;min-height:0' });
    panel.append(body);
    $('drawer-root').replaceChildren(h('div', { class: 'scrim', onclick: close }), panel);
    const draw = () => DetailView.render(body, {
      imageUrl: r.image_url, filename: r.original_filename, score: r.score, vk: vk(r.verdict), summary: r.summary, checks: r.checks,
      meta: `${clientName(r)} · ${catName(r)} · ${new Date(r.created_at).toLocaleString()}`,
    }, {
      override: async (k) => {
        try { await UI.send('PUT', `api/reviews/${r.id}/verdict`, { verdict: V_TO_KEY[k] }); r.verdict = V_TO_KEY[k]; draw(); renderDays(); }
        catch (e) { UI.toast(e.message); }
      },
      remove: async () => {
        if (!(await UI.confirm('Delete this review?', 'The image and its result are removed from History. This cannot be undone.'))) return;
        try { await UI.api(`api/reviews/${r.id}`, { method: 'DELETE' }); reviews = reviews.filter((x) => x.id !== r.id); close(); refreshFilters(); renderDays(); }
        catch (e) { UI.toast(e.message); }
      },
    });
    draw();
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  function refreshFilters() {
    fillSelect($('client'), 'All clients', [...new Set(reviews.map(clientName))].sort(), f.client);
    fillSelect($('category'), 'All categories', [...new Set(reviews.map(catName))].sort(), f.category);
  }
  $('client').addEventListener('change', (e) => { f.client = e.target.value; renderDays(); });
  $('category').addEventListener('change', (e) => { f.category = e.target.value; renderDays(); });
  $('q').addEventListener('input', (e) => { f.q = e.target.value.trim().toLowerCase(); renderDays(); });

  renderStatus();
  UI.api('api/reviews').then((rows) => { reviews = rows; refreshFilters(); renderDays(); }).catch((e) => { $('empty').hidden = false; $('empty').textContent = `Could not load history: ${e.message}`; });
})();
