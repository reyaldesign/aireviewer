/**
 * common.js: shared helpers for every page (sidebar, API calls, dialogs, verdict labels).
 * All URLs are relative so the app works at / and under /aireviewer/.
 */
const UI = (() => {
  // Stored verdicts are approved / needs_review / rejected. The UI calls them:
  const V = {
    ready: { label: 'Ready for proofing', short: 'Ready', color: 'var(--ready)' },
    needs: { label: 'Needs revisions', short: 'Needs revisions', color: 'var(--needs)' },
    fails: { label: 'Fails', short: 'Fails', color: 'var(--fails)' },
  };
  const KEY_TO_V = { approved: 'ready', needs_review: 'needs', rejected: 'fails' };
  const V_TO_KEY = { ready: 'approved', needs: 'needs_review', fails: 'rejected' };
  const vk = (storedVerdict) => KEY_TO_V[storedVerdict] || 'needs';
  const ICON = { pass: '✓', warn: '!', fail: '✕' };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c)); });
    return el;
  }

  async function api(path, opts) {
    const res = await fetch(path, opts);
    if (!res.ok) {
      let detail = res.statusText;
      try { detail = (await res.json()).detail || detail; } catch (e) { /* not json */ }
      throw new Error(detail);
    }
    return res.json();
  }
  const send = (method, path, body) => api(path, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });

  function toast(msg) {
    const t = h('div', { class: 'toast' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 2200);
  }

  async function copy(text, okMsg) {
    try { await navigator.clipboard.writeText(text); toast(okMsg || 'Copied'); }
    catch (e) { toast('Could not copy'); }
  }

  function dialog({ title, body, input, confirmLabel = 'OK', danger = false }) {
    return new Promise((resolve) => {
      const field = input != null ? h('input', { class: 'field', value: input.value || '', placeholder: input.placeholder || '' }) : null;
      const close = (v) => { modal.remove(); resolve(v); };
      const ok = h('button', { class: `btn ${danger ? 'danger' : 'red'}`, onclick: () => close(field ? field.value.trim() || null : true) }, confirmLabel);
      const modal = h('div', { class: 'modal', onclick: (e) => { if (e.target === modal) close(field ? null : false); } },
        h('div', { class: 'box', role: 'dialog' },
          h('h2', {}, title), body ? h('p', {}, body) : null, field,
          h('div', { class: 'acts' }, h('button', { class: 'btn ghost', onclick: () => close(field ? null : false) }, 'Cancel'), ok)));
      document.body.append(modal);
      (field || ok).focus();
      modal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close(field ? null : false);
        if (e.key === 'Enter' && field) ok.click();
      });
    });
  }
  const confirm = (title, body, confirmLabel = 'Delete') => dialog({ title, body, confirmLabel, danger: true });
  const ask = (title, value, confirmLabel = 'Save', placeholder = '') => dialog({ title, input: { value, placeholder }, confirmLabel });

  // Client tile: logo if there is one, otherwise initials on a colour picked from the name.
  function monogram(client, big) {
    const name = (client && client.name) || '?';
    const hue = [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    const tile = h('span', { class: `mono-tile${big ? ' lg' : ''}`, style: `background:hsl(${hue} 62% 42%)` }, initials);
    if (client && client.logo_path) { tile.textContent = ''; tile.style.background = 'var(--s3)'; tile.append(h('img', { src: `uploads/${client.logo_path}`, alt: '' })); }
    return tile;
  }

  function fixList(filename, checks) {
    const items = (checks || []).filter((c) => c.status !== 'pass');
    if (!items.length) return `${filename}: no fixes needed.`;
    return `${filename}\n` + items.map((c) => `- ${c.criterion}: ${c.comment}`).join('\n');
  }

  function mountShell(active) {
    const nav = (href, key, icon, label) => h('a', { class: `nav${active === key ? ' active' : ''}`, href }, h('i', { class: icon }), label);
    const dot = h('span', { class: 'dot' });
    const status = h('span', {}, 'Checking…');
    document.getElementById('side').append(
      h('div', { class: 'brand' }, 'Reyal Design', h('small', {}, 'AI Review')),
      nav('./', 'review', 'diamond', 'AI Review'),
      nav('history.html', 'history', 'clock', 'History'),
      nav('clients.html', 'clients', 'person', 'Clients'),
      h('div', { class: 'side-foot' }, dot, status));
    api('api/health').then((d) => {
      dot.classList.toggle('ok', d.connected);
      status.textContent = d.connected ? `Claude connected` : 'No API key set';
      status.title = d.connected ? d.model : 'Add ANTHROPIC_API_KEY to .env on the server and restart.';
    }).catch(() => { status.textContent = 'Backend unreachable'; });
  }

  return { V, vk, V_TO_KEY, ICON, h, api, send, toast, copy, confirm, ask, monogram, fixList, mountShell };
})();
