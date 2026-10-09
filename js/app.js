/**
 * app.js: the AI Review page. Pick client and category, add images, review them as a batch.
 * Batch state lives in memory; every finished review is also saved to History by the backend.
 */
(() => {
  const { h, V, vk, V_TO_KEY } = UI;
  const $ = (id) => document.getElementById(id);
  UI.mountShell('review');

  const state = { clients: [], client: null, categoryId: null, images: [], selId: null, running: false, next: 1 };
  const clientSel = $('client-select'), catSel = $('category-select');

  // ---------- setup: client, category, criteria ----------
  const criteria = () => {
    const c = state.client;
    if (!c) return [];
    const cat = c.categories.find((x) => x.id === state.categoryId);
    return [...c.base_criteria, ...(cat ? cat.criteria : [])].map((x) => x.text);
  };
  const locked = () => state.images.some((i) => i.state !== 'pending');

  async function loadClients() {
    try { state.clients = await UI.api('api/clients'); } catch (e) { UI.toast(e.message); }
    clientSel.replaceChildren(h('option', { value: '' }, 'Choose…'), ...state.clients.map((c) => h('option', { value: c.id }, c.name)));
    const saved = Number(localStorage.getItem('reviewer.client'));
    if (saved && state.clients.some((c) => c.id === saved)) { clientSel.value = saved; await pickClient(saved); }
  }

  async function pickClient(id) {
    state.client = id ? await UI.api(`api/clients/${id}`) : null;
    state.categoryId = null;
    try { localStorage.setItem('reviewer.client', id || ''); } catch (e) { /* private mode */ }
    const cats = state.client ? state.client.categories : [];
    catSel.replaceChildren(h('option', { value: '' }, 'Choose…'), ...cats.map((c) => h('option', { value: c.id }, c.name)));
    catSel.disabled = !cats.length;
    renderBar();
  }

  clientSel.addEventListener('change', () => pickClient(Number(clientSel.value) || null).catch((e) => UI.toast(e.message)));
  catSel.addEventListener('change', () => { state.categoryId = Number(catSel.value) || null; renderBar(); });

  function renderBar() {
    $('bar-tile').replaceChildren(state.client ? UI.monogram(state.client) : h('span', { class: 'mono-tile', style: 'background:var(--s3)' }, '?'));
    clientSel.disabled = catSel.disabled = locked();
    if (!state.client) catSel.disabled = true;
    const n = criteria().length, edit = $('edit-criteria');
    edit.hidden = !state.client;
    if (state.client) edit.href = `clients.html?client=${state.client.id}${state.categoryId ? `&category=${state.categoryId}` : ''}`;
    let meta = 'Choose a client and category to load the criteria.';
    if (state.client && !state.categoryId) meta = 'Now choose a category.';
    else if (state.categoryId) meta = n ? `${n} ${n === 1 ? "criterion" : "criteria"} · ready for proofing at 80+ · ${state.images.length} image${state.images.length === 1 ? '' : 's'}` : 'This category has no criteria yet. Use Edit criteria to add some.';
    $('bar-meta').textContent = meta;
    updateReviewBtn();
  }

  function updateReviewBtn() {
    const pending = state.images.filter((i) => i.state === 'pending').length;
    const btn = $('review-btn');
    btn.textContent = state.running ? 'Reviewing…' : pending ? `Review ${pending} image${pending === 1 ? '' : 's'}` : 'Review images';
    btn.disabled = state.running || !pending || !state.categoryId || !criteria().length;
  }

  // ---------- adding images ----------
  function addFiles(list) {
    const files = [...list].filter((f) => f.type.startsWith('image/'));
    const added = files.map((file) => ({ id: state.next++, file, url: URL.createObjectURL(file), state: 'pending', result: null }));
    state.images.push(...added);
    if (state.selId == null && added.length) state.selId = added[0].id;
    $('drop-text').textContent = state.images.length ? `Drop images or a folder · ${state.images.length} added` : 'Drop images or a folder';
    renderAll();
    return added;
  }
  $('pick-files').addEventListener('click', () => $('file-input').click());
  $('pick-folder').addEventListener('click', () => $('folder-input').click());
  $('file-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('folder-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer) addFiles(e.dataTransfer.files); });

  // ---------- reviewing ----------
  async function reviewOne(img) {
    img.state = 'reviewing'; renderAll();
    const r = await ReviewEngine.reviewImage(img.file, criteria(), img.file.name, state.client.id, state.categoryId);
    img.result = r; img.state = r.error ? 'error' : 'done';
    renderAll();
  }
  async function reviewList(list) {
    if (state.running || !state.categoryId) return;
    state.running = true; renderAll();
    for (const img of list) await reviewOne(img);
    state.running = false; renderAll();
  }
  $('review-btn').addEventListener('click', () => reviewList(state.images.filter((i) => i.state === 'pending')));

  $('new-batch').addEventListener('click', async () => {
    if (state.running) return;
    if (state.images.some((i) => i.state === 'pending') && !(await UI.confirm('Start a new batch?', 'Images that have not been reviewed yet will be removed from this list.', 'Start new batch'))) return;
    state.images.forEach((i) => URL.revokeObjectURL(i.url));
    state.images = []; state.selId = null;
    $('drop-text').textContent = 'Drop images or a folder';
    renderAll();
  });

  // ---------- results ----------
  const vkOf = (img) => (img.state === 'done' ? vk(img.result.verdict) : null);

  function renderTally() {
    const done = state.images.filter((i) => i.state === 'done');
    $('tally').hidden = !done.length;
    if (!done.length) return;
    const rows = ['ready', 'needs', 'fails'].map((k) => ({ k, n: done.filter((i) => vkOf(i) === k).length }));
    const word = { ready: 'ready for proofing', needs: 'need revisions', fails: 'fail' };
    $('tally').replaceChildren(
      h('div', { class: 'counts' }, rows.map((r) => h('span', {}, h('i', { style: `background:${V[r.k].color}` }), h('b', {}, String(r.n)), word[r.k]))),
      h('div', { class: 'seg' }, rows.filter((r) => r.n).map((r) => h('span', { style: `flex:${r.n};background:${V[r.k].color}` }))));
  }

  function renderGrid() {
    $('empty').hidden = state.images.length > 0;
    $('grid').replaceChildren(...state.images.map((img) => {
      const k = vkOf(img);
      const status = img.state === 'reviewing' ? h('span', { class: 'pill idle' }, h('span', { class: 'spin' }), 'Reviewing')
        : img.state === 'pending' ? h('span', { class: 'pill idle' }, 'Not reviewed')
        : img.state === 'error' ? h('span', { class: 'pill fails' }, 'Review failed')
        : [h('span', { class: `pill ${k}` }, V[k].label), h('span', { class: 'score', style: `color:${V[k].color}` }, String(img.result.score))];
      return h('button', { type: 'button', class: `tile${img.id === state.selId ? ' sel' : ''}`, onclick: () => { state.selId = img.id; renderGrid(); renderDetail(); } },
        h('div', { class: 'im', style: `background-image:url("${img.url}")` }),
        h('div', { class: 'tb' }, h('span', { class: 'fname', title: img.file.name }, img.file.name), h('div', { class: 'row', style: 'gap:8px' }, status)));
    }));
  }

  async function override(img, k) {
    const id = img.result.review_id;
    if (!id) return UI.toast('This review was not saved, so it cannot be changed.');
    try { await UI.send('PUT', `api/reviews/${id}/verdict`, { verdict: V_TO_KEY[k] }); img.result.verdict = V_TO_KEY[k]; renderAll(); UI.toast(`Marked ${V[k].label}`); }
    catch (e) { UI.toast(e.message); }
  }

  function renderDetail() {
    const box = $('detail'), img = state.images.find((i) => i.id === state.selId);
    if (!img) { box.replaceChildren(h('div', { class: 'meta', style: 'margin:auto;text-align:center' }, 'Select an image to see how it scored on each criterion.')); return; }
    if (img.state === 'pending' || img.state === 'reviewing') {
      box.replaceChildren(
        h('div', { class: 'd-img' }, h('img', { src: img.url, alt: '' })),
        h('span', { class: 'fname' }, img.file.name),
        h('div', { class: 'meta' }, img.state === 'pending' ? 'Not reviewed yet.' : 'Reviewing this image…'));
      return;
    }
    const r = img.result;
    const rerun = () => { img.state = 'pending'; reviewList([img]); };
    DetailView.render(box, { imageUrl: img.url, filename: img.file.name, score: r.score, vk: vk(r.verdict), error: !!r.error, summary: r.summary, checks: r.checks }, {
      rerun,
      override: (k) => override(img, k),
      upload: () => $('fix-input').click(),
    });
  }
  $('fix-input').addEventListener('change', (e) => {
    const added = addFiles(e.target.files); e.target.value = '';
    if (added.length) { state.selId = added[0].id; reviewList(added); }
  });

  function renderAll() { renderBar(); renderTally(); renderGrid(); renderDetail(); }

  renderAll();
  loadClients().then(renderAll);
})();
