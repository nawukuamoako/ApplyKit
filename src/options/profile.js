/*
 * ApplyKit — "My answers": grouped lists of label/answer rows, with
 * repeatable entries for education, work, references and so on.
 * Uses globals from options.js: state, h, $, $$, save.
 */
const Profile = (() => {
  const expanded = new Set();
  let query = '';

  const aud = () => state.settings.audience || 'both';
  const visibleFor = (a) => !a || aud() === 'both' || a === aud();
  const icon = (name) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'i');
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    u.setAttribute('href', '#i-' + name);
    s.append(u);
    return s;
  };

  function choiceList(key) {
    return (AK.CHOICES[key] || []).map((c) => (typeof c === 'string' ? { value: c, text: c } : c));
  }

  /** A bare input element for a spec. get/set read and write the stored value. */
  function input(spec, get, set, ctx = {}) {
    const v = get() == null ? '' : String(get());
    const changed = (val) => { set(val); ctx.onChange && ctx.onChange(spec.key, val); };
    switch (spec.input) {
      case 'textarea': {
        const el = h('textarea', { rows: 3, placeholder: spec.placeholder || '', 'aria-label': spec.label });
        el.value = v;
        el.addEventListener('input', () => changed(el.value));
        return el;
      }
      case 'select': case 'country': case 'state': {
        if (spec.input === 'state' && ctx.country && ctx.country !== 'United States') {
          const el = h('input', { type: 'text', 'aria-label': spec.label });
          el.value = v;
          el.addEventListener('input', () => changed(el.value));
          return el;
        }
        let list = spec.input === 'country' ? choiceList('country') : spec.input === 'state' ? choiceList('usState') : choiceList(spec.choices);
        if (v && !list.some((o) => o.value === v)) list = [{ value: v, text: v }].concat(list);
        const el = h('select', { 'aria-label': spec.label }, h('option', { value: '' }, 'Choose…'), ...list.map((o) => h('option', { value: o.value }, o.text)));
        el.value = v;
        el.classList.toggle('unset', !v);
        el.addEventListener('change', () => { el.classList.toggle('unset', !el.value); changed(el.value); });
        return el;
      }
      case 'yesno': {
        const el = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': spec.label });
        for (const o of choiceList(spec.choices || 'yesNo')) {
          const b = h('button', { type: 'button', class: o.value === v ? 'on' : '' }, o.text);
          b.onclick = () => {
            const nv = b.classList.contains('on') ? '' : o.value;
            $$('button', el).forEach((x) => x.classList.toggle('on', x === b && !!nv));
            changed(nv);
          };
          el.append(b);
        }
        return el;
      }
      case 'chips': {
        const cur = new Set(v.split(/\s*,\s*/).filter(Boolean));
        const all = choiceList(spec.choices);
        const el = h('div', { class: 'ctl inline' });
        for (const o of all) {
          const cb = h('input', { type: 'checkbox' });
          cb.checked = cur.has(o.value);
          cb.addEventListener('change', () => {
            cb.checked ? cur.add(o.value) : cur.delete(o.value);
            changed(all.map((x) => x.value).filter((x) => cur.has(x)).join(', '));
          });
          el.append(h('label', {}, cb, o.text));
        }
        return el;
      }
      case 'check': {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = v === 'true';
        cb.addEventListener('change', () => changed(cb.checked ? 'true' : ''));
        return h('span', { class: 'switch' }, cb, h('span'));
      }
      default: {
        const type = { email: 'email', tel: 'tel', url: 'url', number: 'number', date: 'date', month: 'month' }[spec.input] || 'text';
        const el = h('input', { type, placeholder: spec.placeholder || '', 'aria-label': spec.label });
        if (spec.min != null) el.min = spec.min;
        if (spec.max != null) el.max = spec.max;
        if (spec.step != null) el.step = spec.step;
        if (spec.datalist) {
          const id = 'dl-' + spec.datalist;
          if (!document.getElementById(id)) document.body.append(h('datalist', { id }, ...(AK.CHOICES[spec.datalist] || []).map((x) => h('option', { value: x }))));
          el.setAttribute('list', id);
        }
        el.value = v;
        el.addEventListener('input', () => changed(el.value));
        return el;
      }
    }
  }

  /** One label/answer row. `withSpecs` are extra inputs shown on the same row (e.g. currency). */
  function row(spec, getFor, setFor, ctx = {}, withSpecs = []) {
    const label = ctx.labelOverride || spec.label;
    const ctl = h('div', { class: 'ctl' });
    const side = (ws) => { const el = input(ws, getFor(ws.key), setFor(ws.key), ctx); el.style.width = 'auto'; el.style.maxWidth = '170px'; el.style.flex = 'none'; return el; };
    for (const w of spec.before || []) { const ws = withSpecs.find((x) => x.key === w); if (ws) ctl.append(side(ws)); }
    const main = input(spec, getFor(spec.key), setFor(spec.key), ctx);
    ctl.append(main);
    if (spec.joiner) ctl.append(h('span', { class: 'unit' }, spec.joiner));
    for (const w of spec.after || []) { const ws = withSpecs.find((x) => x.key === w); if (ws) ctl.append(side(ws)); }
    if (spec.input === 'number' && spec.max != null && !(spec.after || []).length) ctl.append(h('span', { class: 'unit' }, `${spec.min}–${spec.max}`));
    if (ctx.extra) ctl.append(ctx.extra);
    if (ctx.disabled) $$('input', ctl).forEach((x) => { x.disabled = true; x.type = 'text'; x.value = 'Present'; });
    const syn = (spec.synonyms || []).slice(0, 6);
    const q = [label, ...(spec.synonyms || []), getFor(spec.key)() || ''].join(' ').toLowerCase();
    return h('div', { class: 'row' + (spec.input === 'textarea' ? ' top' : '') + (ctx.disabled ? ' disabled' : ''), 'data-q': q },
      h('label', { title: syn.length ? 'Also used for: ' + syn.join(', ') : '' }, label),
      ctl);
  }

  /* ---------------- single-answer sections ---------------- */
  function singleSection(sec, fields) {
    const vals = state.profile.values;
    const getFor = (k) => () => vals[k];
    const setFor = (k) => (val) => { vals[k] = val; save('profile'); };
    const shown = fields.filter((f) => visibleFor(f.audience));
    const inlined = new Set(shown.flatMap((f) => (f.before || []).concat(f.after || [])));
    const group = h('div', { class: 'group' });
    const draw = () => {
      group.replaceChildren();
      for (const f of shown) {
        if (inlined.has(f.key)) continue;
        const ctx = { country: vals.country, onChange: (k) => { if (k === 'country') draw(); refreshCounts(); } };
        if (f.key.startsWith('custom_')) {
          ctx.extra = h('span', { class: 'extra' },
            h('button', { class: 'text', onclick: () => renameCustom(f) }, 'Rename'),
            h('button', { class: 'text danger', onclick: () => deleteCustom(f) }, 'Delete'));
        }
        group.append(row(f, getFor, setFor, ctx, shown));
      }
      if (!group.children.length) group.append(h('div', { class: 'empty-row' }, 'Nothing here yet.'));
    };
    draw();
    const counted = shown.filter((f) => !inlined.has(f.key));
    return {
      body: [group],
      action: sec.id === 'answers' ? h('button', { class: 'text', onclick: addCustom }, 'Add answer') : null,
      count: () => `${counted.filter((f) => String(vals[f.key] || '').trim()).length}/${counted.length}`,
    };
  }

  /* ---------------- repeatable sections ---------------- */
  function listSection(sec) {
    const def = AK.LISTS[sec.id];
    const lists = (state.profile.lists = state.profile.lists || {});
    const arr = (lists[sec.id] = lists[sec.id] || []);
    const holder = h('div', { class: 'entries' });
    const draw = () => {
      holder.replaceChildren();
      if (!arr.length) {
        holder.append(h('div', { class: 'group' }, h('div', { class: 'empty-row' }, `No ${def.plural || def.noun + 's'} added.`)));
      }
      arr.forEach((e, i) => holder.append(entry(def, arr, e, i, draw)));
    };
    draw();
    const add = h('button', {
      class: 'text', onclick: () => {
        const e = { id: AK.newId() };
        arr.push(e);
        expanded.add(e.id);
        save('profile', 0);
        draw();
        refreshCounts();
        const first = holder.querySelector(`[data-entry="${e.id}"] .entry-body input, [data-entry="${e.id}"] .entry-body select`);
        if (first) { first.scrollIntoView({ block: 'center' }); first.focus(); }
      },
    }, `Add ${def.noun}`);
    return { body: [holder], action: add, count: () => String(arr.length || '') };
  }

  function entry(def, arr, e, i, redraw) {
    const open = expanded.has(e.id);
    const [t1, t2, t3] = def.summary(e);
    const b = h('b', {}, t1);
    const s = h('span', {}, [t2, t3].filter(Boolean).join(' · ') || ' ');
    const refresh = () => {
      const [a, c, d] = def.summary(e);
      b.textContent = a;
      s.textContent = [c, d].filter(Boolean).join(' · ') || ' ';
    };
    const stop = (fn) => (ev) => { ev.stopPropagation(); fn(); };
    const move = (d) => stop(() => {
      const j = i + d;
      if (j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      save('profile', 0);
      redraw();
    });
    const remove = stop(() => {
      if (!confirm(`Remove ${t1}?`)) return;
      arr.splice(i, 1);
      save('profile', 0);
      redraw();
      refreshCounts();
    });
    const head = h('div', { class: 'entry-head', onclick: () => { open ? expanded.delete(e.id) : expanded.add(e.id); redraw(); } },
      h('span', { class: 'chev' }, icon('chev')),
      h('div', { class: 'sum' }, b, s),
      h('div', { class: 'eacts' },
        h('button', { class: 'icon', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: move(-1) }, icon('up')),
        h('button', { class: 'icon', title: 'Move down', 'aria-label': 'Move down', disabled: i === arr.length - 1, onclick: move(1) }, icon('down')),
        h('button', { class: 'icon', title: 'Remove', 'aria-label': 'Remove', onclick: remove }, icon('x'))));
    const card = h('div', { class: 'group entry' + (open ? ' open' : ''), 'data-entry': e.id }, head);
    if (open) {
      const body = h('div', { class: 'entry-body' });
      const getFor = (k) => () => e[k];
      const setFor = (k) => (val) => { e[k] = val; save('profile'); };
      const inlined = new Set(def.fields.flatMap((f) => (f.before || []).concat(f.after || [])));
      const draw = () => {
        body.replaceChildren();
        for (const f of def.fields) {
          if (inlined.has(f.key)) continue;
          const ctx = { onChange: (k) => { refresh(); if (k === 'current') draw(); } };
          if (f.key === 'end' && e.current) {
            if (f.currentLabel) ctx.labelOverride = f.currentLabel; else ctx.disabled = true;
          }
          body.append(row(f, getFor, setFor, ctx, def.fields));
        }
      };
      draw();
      card.append(body);
    }
    return card;
  }

  /* ---------------- custom answers ---------------- */
  async function addCustom() {
    const label = prompt('Which question is this answer for?\n\nFor example: "Why are you interested in this position?"');
    if (!label || !label.trim()) return;
    state.profile.custom = state.profile.custom || [];
    const key = 'custom_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40) + '_' + Date.now().toString(36);
    state.profile.custom.push({ key, label: label.trim(), group: 'answers', synonyms: [], input: 'textarea' });
    await AK.set({ profile: state.profile });
    render();
    const rows = $$('#sec-answers .row textarea');
    const last = rows[rows.length - 1];
    if (last) { last.scrollIntoView({ block: 'center' }); last.focus(); }
  }
  function renameCustom(f) {
    const label = prompt('New name for this answer', f.label);
    if (!label || !label.trim()) return;
    const c = state.profile.custom.find((x) => x.key === f.key);
    if (c) c.label = label.trim();
    AK.set({ profile: state.profile });
    render();
  }
  function deleteCustom(f) {
    if (!confirm(`Delete "${f.label}"?`)) return;
    state.profile.custom = state.profile.custom.filter((c) => c.key !== f.key);
    delete state.profile.values[f.key];
    for (const [k, a] of Object.entries(state.aliases)) if (a.key === f.key) delete state.aliases[k];
    AK.set({ profile: state.profile, aliases: state.aliases });
    render();
  }

  /* ---------------- page ---------------- */
  const counters = [];
  function refreshCounts() { for (const c of counters) c.el.textContent = c.fn(); }

  function render() {
    const wrap = $('#profileSections');
    const nav = $('#secNav');
    wrap.replaceChildren();
    nav.replaceChildren();
    counters.length = 0;
    $$('#audienceSeg button').forEach((b) => b.classList.toggle('on', b.dataset.aud === aud()));

    const fields = AK.allFields(state.profile);
    for (const sec of AK.SECTIONS) {
      if (!visibleFor(sec.audience)) continue;
      let part;
      if (sec.list) part = listSection(sec);
      else {
        const fs = fields.filter((f) => f.group === sec.id);
        if (!fs.some((f) => visibleFor(f.audience)) && sec.id !== 'answers') continue;
        part = singleSection(sec, fs);
      }
      const block = h('section', { class: 'sec', id: 'sec-' + sec.id },
        h('h3', { class: 'ghead' }, sec.title, h('span', { class: 'note' }, ''), part.action),
        sec.desc ? h('p', { class: 'gdesc' }, sec.desc) : null,
        ...part.body);
      wrap.append(block);
      const n = h('span', {}, part.count());
      counters.push({ el: n, fn: part.count });
      nav.append(h('a', { href: '#profile', onclick: (ev) => { ev.preventDefault(); if (location.hash !== '#profile' && location.hash !== '') location.hash = 'profile'; block.scrollIntoView({ block: 'start' }); } }, sec.short || sec.title, n));
    }
    filter();
  }

  function filter() {
    const q = query.trim().toLowerCase();
    $$('#profileSections .sec').forEach((sec) => {
      let any = !q || sec.querySelector('.ghead').textContent.toLowerCase().includes(q);
      $$('.row', sec).forEach((r) => {
        const hit = !q || any || (r.dataset.q || '').includes(q);
        r.classList.toggle('hide', !hit);
        if (hit) any = true;
      });
      $$('.entry', sec).forEach((en) => { if (q && en.textContent.toLowerCase().includes(q)) any = true; });
      sec.hidden = !any;
    });
  }

  function init() {
    $('#profileSearch').addEventListener('input', (e) => { query = e.target.value; filter(); });
    $$('#audienceSeg button').forEach((b) => b.addEventListener('click', () => {
      state.settings.audience = b.dataset.aud;
      AK.set({ settings: state.settings });
      render();
      if (window.Tracker) Tracker.onAudience();
    }));
  }

  return { init, render };
})();
