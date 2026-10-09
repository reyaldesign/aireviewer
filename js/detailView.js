/**
 * detailView.js: the review detail panel, shared by the Review page and History.
 *
 * DetailView.render(container, d, actions)
 *   d: { imageUrl, filename, score, vk ('ready'|'needs'|'fails'), error, summary, checks, meta }
 *      checks: [{ criterion, status: 'pass'|'warn'|'fail', comment, location? }]
 *   actions (all optional): { upload(), rerun(), override(vk), remove() }
 */
const DetailView = (() => {
  const { h, V, ICON } = UI;

  function image(d) {
    const wrap = h('div', { class: 'd-img' }, h('img', { src: d.imageUrl, alt: d.filename || '' }));
    (d.checks || []).forEach((c) => {
      const l = c.location;
      if (c.status !== 'pass' && l && typeof l.x === 'number' && typeof l.y === 'number') {
        wrap.append(h('span', { class: `marker${c.status === 'warn' ? ' warn' : ''}`, style: `left:${l.x * 100}%;top:${l.y * 100}%`, title: c.comment || c.criterion }));
      }
    });
    return wrap;
  }

  function render(container, d, actions = {}) {
    container.replaceChildren();
    const v = V[d.vk];
    const fixes = (d.checks || []).filter((c) => c.status !== 'pass');

    container.append(image(d));
    container.append(h('div', { class: 'd-head' },
      h('div', { style: 'display:grid;gap:4px;min-width:0' },
        h('span', { class: 'fname', style: 'color:var(--muted)', title: d.filename }, d.filename),
        d.error ? h('span', { class: 'vl fails-c d-vl' }, 'Review failed')
                : h('span', { class: 'vl', style: `color:${v.color}` }, v.label)),
      d.error ? null : h('span', { class: 'sc' }, String(d.score), h('small', {}, '/100'))));
    if (d.meta) container.append(h('div', { class: 'meta' }, d.meta));
    if (d.summary) container.append(h('p', { class: 'd-sum' }, d.summary));

    if (!d.error) {
      container.append(h('div', { class: 'checks' }, (d.checks || []).map((c) =>
        h('div', { class: 'check' },
          h('span', { class: `ic ${c.status}` }, ICON[c.status]),
          h('div', {}, h('b', {}, c.criterion), h('span', {}, c.comment))))));
    }

    const main = [];
    if (!d.error && d.vk === 'ready') {
      main.push(h('button', { class: 'btn red lg', disabled: true, title: 'Becomes available when AI Review moves into Reyal Proof' }, 'Send to proofing →'));
    } else if (!d.error && actions.upload) {
      main.push(h('button', { class: 'btn white lg', onclick: actions.upload }, 'Upload fixed version'));
    } else if (d.error && actions.rerun) {
      main.push(h('button', { class: 'btn white lg', onclick: actions.rerun }, 'Re-run review'));
    }

    const links = [];
    if (!d.error) links.push(h('button', { class: 'link', onclick: () => UI.copy(UI.fixList(d.filename, d.checks), fixes.length ? 'Fix list copied' : 'Nothing to fix, copied note') }, 'Copy fix list'));
    if (!d.error && actions.rerun) links.push(h('button', { class: 'link', onclick: actions.rerun }, 'Re-run review'));
    const overrideRow = h('div', { class: 'override', hidden: true },
      ['ready', 'needs', 'fails'].filter((k) => k !== d.vk).map((k) =>
        h('button', { class: 'btn ghost', style: `color:${V[k].color}`, onclick: () => actions.override(k) }, V[k].label)));
    if (!d.error && actions.override) links.push(h('button', { class: 'link', onclick: () => { overrideRow.hidden = !overrideRow.hidden; } }, 'Override verdict'));
    if (actions.remove) links.push(h('button', { class: 'link danger', onclick: actions.remove }, 'Delete'));

    container.append(h('div', { class: 'd-actions' }, main, h('div', { class: 'd-links' }, links), overrideRow));
  }

  return { render };
})();
