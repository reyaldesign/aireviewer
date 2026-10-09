/**
 * clients.js: a client's AI criteria. Criteria that apply to every category sit on top;
 * each category adds its own. Rows are editable and drag to reorder.
 */
(() => {
  const { h, V } = UI;
  const $ = (id) => document.getElementById(id);
  UI.mountShell('clients');

  const params = new URLSearchParams(location.search);
  const S = { list: [], client: null, catId: Number(params.get('category')) || null, thr: { ready_at: 80, needs_at: 50 } };
  const run = (p) => p.catch((e) => UI.toast(e.message));

  async function loadList(selectId) {
    S.list = await UI.api('api/clients');
    const id = selectId || (S.client && S.client.id) || Number(params.get('client')) || (S.list[0] && S.list[0].id);
    await loadClient(S.list.some((c) => c.id === id) ? id : S.list[0] && S.list[0].id);
  }
  async function loadClient(id) {
    S.client = id ? await UI.api(`api/clients/${id}`) : null;
    if (S.client && !S.client.categories.some((c) => c.id === S.catId)) S.catId = S.client.categories[0] ? S.client.categories[0].id : null;
    render();
  }

  // ---------- criteria rows ----------
  function critList(items, listKey) {
    const box = h('div', { class: 'sec', style: 'gap:8px' });
    let dragEl = null;
    const saveOrder = () => run(UI.send('PUT', 'api/criteria/order', { ids: [...box.querySelectorAll('[data-id]')].map((r) => Number(r.dataset.id)) }));
    items.forEach((c) => {
      const row = h('div', { class: 'crow', 'data-id': c.id, draggable: 'true' },
        h('span', { class: 'grip', title: 'Drag to reorder' }, '⋮⋮'), h('span', { class: 'txt' }, c.text),
        h('button', { class: 'link', onclick: () => edit(row, c) }, 'Edit'),
        h('button', { class: 'link danger', onclick: () => run(UI.api(`api/criteria/${c.id}`, { method: 'DELETE' }).then(() => loadClient(S.client.id))) }, 'Remove'));
      row.addEventListener('dragstart', (e) => { dragEl = row; row.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragend', () => { row.classList.remove('drag'); dragEl = null; saveOrder(); });
      row.addEventListener('dragover', (e) => {
        if (!dragEl || dragEl === row || dragEl.parentNode !== box) return;
        e.preventDefault();
        const after = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
        box.insertBefore(dragEl, after ? row.nextSibling : row);
      });
      box.append(row);
    });
    return box;
  }

  function edit(row, c) {
    const input = h('input', { value: c.text });
    const done = async (save) => {
      const text = input.value.trim();
      if (save && text && text !== c.text) await run(UI.send('PUT', `api/criteria/${c.id}`, { text }));
      loadClient(S.client.id);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    row.replaceChildren(h('span', { class: 'grip' }, '⋮⋮'), input, h('button', { class: 'link', onclick: () => done(true) }, 'Save'), h('button', { class: 'link', onclick: () => done(false) }, 'Cancel'));
    row.draggable = false; input.focus(); input.select();
  }

  function addRow(placeholder, onAdd) {
    const input = h('input', { placeholder });
    const go = async () => { const text = input.value.trim(); if (!text) return; await run(onAdd(text)); loadClient(S.client.id); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return h('div', { class: 'addrow' }, input, h('button', { class: 'btn ghost', onclick: go }, 'Add'));
  }

  // ---------- client / category actions ----------
  async function newClient() {
    const name = await UI.ask('New client', '', 'Create', 'Client name');
    if (name) run(UI.send('POST', 'api/clients', { name }).then((c) => loadList(c.id)));
  }
  async function renameClient() {
    const name = await UI.ask('Rename client', S.client.name);
    if (name) run(UI.send('PUT', `api/clients/${S.client.id}`, { name }).then(() => loadList(S.client.id)));
  }
  async function deleteClient() {
    if (await UI.confirm(`Delete ${S.client.name}?`, 'Their categories and criteria are deleted too. Saved reviews stay in History.', 'Delete client'))
      run(UI.api(`api/clients/${S.client.id}`, { method: 'DELETE' }).then(() => { S.client = null; return loadList(); }));
  }
  async function addCategory() {
    const name = await UI.ask('New category', '', 'Add', 'Category name');
    if (name) run(UI.send('POST', `api/clients/${S.client.id}/categories`, { name }).then((c) => { S.catId = c.id; return loadClient(S.client.id); }));
  }
  async function renameCategory(cat) {
    const name = await UI.ask('Rename category', cat.name);
    if (name) run(UI.send('PUT', `api/categories/${cat.id}`, { name }).then(() => loadClient(S.client.id)));
  }
  async function deleteCategory(cat) {
    if (await UI.confirm(`Delete ${cat.name}?`, 'Its own criteria are deleted. Criteria for every category are not affected.', 'Delete category'))
      run(UI.api(`api/categories/${cat.id}`, { method: 'DELETE' }).then(() => loadClient(S.client.id)));
  }
  $('logo-input').addEventListener('change', (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file || !S.client) return;
    const fd = new FormData(); fd.append('file', file);
    run(UI.api(`api/clients/${S.client.id}/logo`, { method: 'POST', body: fd }).then(() => loadList(S.client.id)));
  });

  // ---------- page ----------
  function render() {
    const page = $('page'), c = S.client;
    if (!c) {
      page.replaceChildren(h('h1', {}, 'Clients'), h('div', { class: 'empty' }, h('div', { style: 'display:grid;gap:12px;justify-items:center' }, 'No clients yet.', h('button', { class: 'btn red', onclick: newClient }, '+ New client'))));
      return;
    }
    const cat = c.categories.find((x) => x.id === S.catId);
    const total = (x) => c.base_criteria.length + x.criteria.length;

    const header = h('div', { class: 'row between', style: 'align-items:flex-end;flex-wrap:wrap' },
      h('div', { style: 'display:grid;gap:10px' }, h('span', { class: 'crumb' }, 'Clients /'),
        h('div', { class: 'row', style: 'gap:14px' }, UI.monogram(c, true), h('h1', {}, c.name))),
      h('div', { class: 'row', style: 'flex-wrap:wrap' },
        h('select', { class: 'pill-select', 'aria-label': 'Client', onchange: (e) => run(loadClient(Number(e.target.value))) }, S.list.map((x) => h('option', { value: x.id, selected: x.id === c.id }, x.name))),
        h('button', { class: 'btn ghost', onclick: newClient }, '+ New client'),
        h('button', { class: 'link', onclick: renameClient }, 'Rename'),
        h('button', { class: 'link danger', onclick: deleteClient }, 'Delete client')));

    const cats = h('div', { class: 'cats' }, h('span', { class: 'eyebrow' }, 'Categories'),
      c.categories.map((x) => h('button', { class: `cat${x.id === S.catId ? ' on' : ''}`, onclick: () => { S.catId = x.id; render(); } }, x.name, h('em', {}, String(total(x))))),
      h('button', { class: 'cat-add', onclick: addCategory }, '+ Add category'));

    const everyCat = h('div', { class: 'sec' },
      h('div', { class: 't' }, h('b', {}, 'Every category'), h('span', {}, `Checked on all ${c.name} images`)),
      critList(c.base_criteria, 'base'),
      addRow('Add a criterion for every category…', (text) => UI.send('POST', `api/clients/${c.id}/criteria`, { text })));

    const own = cat ? h('div', { class: 'sec' },
      h('div', { class: 't' }, h('b', {}, `${cat.name} only`), h('span', {}, 'Added on top of the list above'),
        h('span', { style: 'margin-left:auto;display:flex;gap:14px' }, h('button', { class: 'link', onclick: () => renameCategory(cat) }, 'Rename'), h('button', { class: 'link danger', onclick: () => deleteCategory(cat) }, 'Delete'))),
      critList(cat.criteria, 'cat'),
      addRow(`Add a criterion for ${cat.name}…`, (text) => UI.send('POST', `api/categories/${cat.id}/criteria`, { text })))
      : h('div', { class: 'note' }, 'Add a category to give it its own criteria.');

    const { ready_at: r, needs_at: n } = S.thr;
    const settings = h('div', { class: 'col settings' },
      h('div', { class: 'panel' }, h('b', { class: 'h' }, 'Verdict thresholds'),
        h('div', { class: 'thr' }, h('span', { style: `flex:${n};background:var(--fails)` }), h('span', { style: `flex:${r - n};background:var(--needs)` }), h('span', { style: `flex:${100 - r};background:var(--ready)` })),
        h('div', { class: 'thr-l' },
          h('span', {}, h('b', { style: 'color:var(--ready)' }, `${r}+`), ' Ready for proofing'),
          h('span', {}, h('b', { style: 'color:var(--needs)' }, `${n}–${r - 1}`), ' Needs revisions'),
          h('span', {}, h('b', { style: 'color:var(--fails)' }, `Under ${n}`), ' Fails'))),
      h('div', { class: 'panel' }, h('b', { class: 'h' }, 'Brand reference'),
        h('div', { class: 'logo-box' }, c.logo_path ? h('img', { src: `uploads/${c.logo_path}`, alt: `${c.name} logo` }) : h('span', {}, 'client logo')),
        h('button', { class: 'btn ghost', onclick: () => $('logo-input').click() }, c.logo_path ? 'Replace logo' : 'Upload logo'),
        h('span', { class: 'note' }, 'Shown as the client tile. It is not yet sent to the AI as a reference.')));

    page.replaceChildren(header, h('div', { class: 'tabs' }, h('span', {}, 'AI criteria')),
      h('div', { class: 'crit' }, cats, h('div', { class: 'col' }, everyCat, own), settings));
  }

  UI.api('api/health').then((d) => { S.thr = d; }).catch(() => {}).then(() => loadList()).catch((e) => UI.toast(e.message));
})();
