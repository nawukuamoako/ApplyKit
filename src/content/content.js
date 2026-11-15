/*
 * ApplyKit — content script. Suggests saved answers under form fields,
 * fills whole pages (including repeated education / work blocks), and
 * learns new question wordings as you go.
 */
(function () {
  if (window.__AK_API) return;
  const AK = window.AK;
  const host = location.hostname.replace(/^www\./, '');

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  let state = null;
  let fields = [];
  let fieldByKey = {};

  async function refresh() {
    try {
      state = await AK.load();
    } catch (e) {
      return; // the extension was reloaded; this copy of the script is orphaned
    }
    fields = AK.prepareFields(AK.matchFields(state.profile));
    fieldByKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  }
  let ready = refresh();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') ready = refresh();
  });

  const quiet = () => !state || (state.settings.disabledHosts || []).includes(host);
  const answer = (key, idx = 0) => AK.answer(state.profile, key, idx);
  const hasAnswer = (key) => AK.hasAnswer(state.profile, key);

  function labelOf(key, idx) {
    const f = fieldByKey[key];
    if (!f) return key;
    if (!f.list) return f.label;
    const def = AK.LISTS[f.list];
    const sub = def.fields.find((x) => x.key === f.sub);
    return `${def.title} ${idx + 1} · ${sub ? sub.label : f.sub}`;
  }

  function matchOf(d) {
    if (d.sensitive) return null;
    return AK.matchField(d, fields, state.aliases, hasAnswer);
  }

  /**
   * Turn a saved answer into what this particular control needs:
   * true/false for checkboxes, "Yes"/"No" for yes-no questions, only the
   * year or month when a form splits dates, "+1" for a dialling-code box...
   */
  function valueFor(d, key, idx) {
    const f = fieldByKey[key];
    let v = answer(key, idx);
    if (!f) return v;
    if (f.input === 'check') {
      if (d.kind === 'checkbox') return v === 'true';
      if (!((state.profile.lists || {})[f.list] || [])[idx]) return '';
      return v === 'true' ? 'Yes' : 'No';
    }
    if (!v) return '';
    if (d.kind === 'checkbox') {
      if (f.input === 'chips') return v.split(/\s*,\s*/).some((c) => AK.normalize(c) === AK.normalize(d.rawLabel));
      return /^(yes|true)$/i.test(v);
    }
    if (f.input === 'chips' && d.kind !== 'text') return v.split(/\s*,\s*/)[0];
    if (key === 'phoneCountryCode' && d.kind === 'text') {
      const m = /\((\+\d+)\)/.exec(v);
      return m ? m[1] : v;
    }
    if (f.input === 'month' || f.input === 'date' || AK.DATE_KEYS[key]) {
      const p = AK.parseDate(v);
      const words = d.texts.map((t) => t.text).join(' ');
      const year = /\byear\b|\byyyy\b/.test(words), month = /\bmonth\b|\bmm\b/.test(words);
      if (p && year && !month) return String(p.y);
      if (p && month && !year) return d.kind === 'text' ? String(p.m).padStart(2, '0') : AK.MONTH_NAMES[p.m - 1];
    }
    return v;
  }

  /**
   * Every control on the page with its match and, for repeated sections,
   * which entry it should get. Radio groups are counted once.
   */
  function scan() {
    const out = [];
    const seenRadio = new Set();
    const headingOf = AK.headingFinder();
    const rank = {};
    for (const el of AK.allCandidates()) {
      if (!AK.isVisible(el)) continue;
      if (el.type === 'radio') {
        const k = (el.form ? 'f' : 'r') + ':' + el.name;
        if (seenRadio.has(k)) continue;
        seenRadio.add(k);
      }
      const d = AK.describe(el, { headingOf });
      const m = matchOf(d);
      let idx = 0;
      if (m && fieldByKey[m.key] && fieldByKey[m.key].list) {
        // Count each distinct question separately, so "Start month" and "Start year" in one block share an entry.
        const rk = m.key + '|' + d.signature;
        const n = rank[rk] || 0;
        idx = d.index != null ? d.index : n;
        rank[rk] = Math.max(n, idx) + 1;
      }
      const value = m ? valueFor(d, m.key, idx) : '';
      out.push({ d, m, idx, value });
    }
    return out;
  }

  const usable = (x) => x.m && x.value !== '' && x.value !== false && x.value != null;

  // ------------------------------------------------------------------
  // Filling
  // ------------------------------------------------------------------
  const filledByUs = new WeakMap();
  let filling = false;

  function highlight(d) {
    if (!state.settings.highlightFilled || d.kind === 'checkbox') return;
    for (const el of d.kind === 'radio' ? d.els : [d.el]) {
      const root = el.getRootNode();
      const holder = root === document ? document.head || document.documentElement : root;
      if (holder && !holder.querySelector(':scope > style[data-applykit-style]')) {
        const st = document.createElement('style');
        st.setAttribute('data-applykit-style', '');
        st.textContent = '.applykit-filled{background-color:#fdf6d8 !important;background-image:none !important;color:#1d1d1f !important;transition:background-color .25s}';
        holder.appendChild(st);
      }
      el.classList.add('applykit-filled');
    }
  }

  function fillOne(d, value) {
    filling = true;
    let undo = null;
    try {
      undo = AK.write(d, value);
    } finally {
      filling = false;
    }
    if (undo) {
      filledByUs.set(d.el, AK.currentValue(d));
      highlight(d);
    }
    return undo;
  }

  function fillAll() {
    if (!state) return { filled: 0 };
    const undos = [];
    const used = {};
    for (const x of scan()) {
      if (!usable(x) || !AK.isEmpty(x.d)) continue;
      const u = fillOne(x.d, x.value);
      if (u) undos.push(u);
      const f = fieldByKey[x.m.key];
      if (f && f.list) used[f.list] = Math.max(used[f.list] || 0, x.idx + 1);
    }
    hideMenu();
    // Tell the user about entries the form had no room for.
    const extra = Object.entries(used)
      .map(([list, n]) => [list, AK.entryCount(state.profile, list) - n])
      .filter(([, n]) => n > 0)
      .map(([list, n]) => `${n} more ${(AK.LISTS[list].noun)}${n === 1 ? '' : 's'}`);
    if (undos.length) {
      let msg = `Filled ${undos.length} field${undos.length === 1 ? '' : 's'}. Check them before you submit.`;
      if (extra.length) msg += ` You have ${extra.join(' and ')} than this form shows; add a block on the form, then fill again.`;
      toast(msg, 'Undo', () => {
        undos.reverse().forEach((u) => { try { u(); } catch (e) {} });
        document.querySelectorAll('.applykit-filled').forEach((e) => e.classList.remove('applykit-filled'));
      });
    } else {
      toast('Nothing to fill. No empty fields on this page match your saved answers.');
    }
    return { filled: undos.length };
  }

  function stats() {
    if (!state) return { fields: 0, matched: 0, fillable: 0 };
    const s = scan();
    return {
      fields: s.length,
      matched: s.filter(usable).length,
      fillable: s.filter((x) => usable(x) && AK.isEmpty(x.d)).length,
    };
  }

  // ------------------------------------------------------------------
  // UI, inside a closed shadow root so the page's CSS can't reach it.
  // Styled after the browser's own autofill menu.
  // ------------------------------------------------------------------
  const hostEl = document.createElement('applykit-ui');
  hostEl.setAttribute('data-applykit-ui', '');
  hostEl.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
  const shadow = hostEl.attachShadow({ mode: 'closed' });
  const ICONS = {
    person: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3.5 13c.6-2.3 2.3-3.5 4.5-3.5s3.9 1.2 4.5 3.5"/>',
    fill: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M5 6.5h6M5 9.5h4"/>',
    list: '<path d="M5.5 4.5h7M5.5 8h7M5.5 11.5h7M3 4.5h.01M3 8h.01M3 11.5h.01"/>',
    off: '<circle cx="8" cy="8" r="5.25"/><path d="M4.3 11.7l7.4-7.4"/>',
    x: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  };
  const svg = (name) => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${ICONS[name]}</svg>`;
  shadow.innerHTML = `<style>
    :host{all:initial}
    *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,Roboto,sans-serif}
    svg{fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;flex:none}
    .pop{position:fixed;background:#fff;color:#1d1d1f;border-radius:8px;box-shadow:0 0 0 .5px rgba(0,0,0,.2),0 4px 16px rgba(0,0,0,.14);font-size:13px;line-height:1.35;overflow:hidden;display:none}
    .pop.show{display:block}
    .menu{min-width:260px;max-width:400px;padding:4px 0}
    .item{display:flex;gap:10px;align-items:center;padding:7px 12px;cursor:default;user-select:none}
    .item svg{color:#6e6e73}
    .item:hover,.item.active{background:#f0f0f2}
    .txt{min-width:0;flex:1}
    .t1,.t2{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .t2{color:#6e6e73;font-size:12px}
    .sep{height:1px;background:#ececee;margin:4px 0}
    .foot{display:flex;justify-content:space-between;align-items:center;padding:5px 12px 4px;color:#8e8e93;font-size:11.5px}
    .foot a{color:#0066cc;cursor:pointer;text-decoration:none}
    .search{display:block;margin:6px 8px;width:calc(100% - 16px);height:28px;padding:4px 8px;border:1px solid rgba(0,0,0,.16);border-radius:6px;font-size:13px;outline:none;color:#1d1d1f;background:#fff}
    .search:focus{border-color:#0066cc;box-shadow:0 0 0 3px rgba(0,102,204,.2)}
    .list{max-height:260px;overflow:auto}
    .empty{padding:9px 12px;color:#6e6e73}
    .chip{position:fixed;width:22px;height:22px;border-radius:5px;background:#fff;color:#6e6e73;display:none;place-items:center;cursor:pointer;box-shadow:0 0 0 .5px rgba(0,0,0,.25),0 1px 2px rgba(0,0,0,.12)}
    .chip.show{display:grid}
    .chip:hover{color:#1d1d1f}
    .bubble{width:320px;padding:12px 14px 12px}
    .bubble h4{margin:0 22px 2px 0;font-size:13px;font-weight:600}
    .bubble .q{color:#6e6e73;font-size:12px;margin-bottom:10px;word-break:break-word}
    .bubble label{display:block;font-size:12px;color:#6e6e73;margin-bottom:3px}
    .bubble input,.bubble select{width:100%;height:28px;padding:3px 8px;border:1px solid rgba(0,0,0,.16);border-radius:6px;font-size:12.5px;margin-bottom:10px;background:#fff;color:#1d1d1f}
    .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
    button{font:inherit;font-size:12.5px;height:28px;border-radius:6px;padding:0 10px;cursor:pointer;border:1px solid rgba(0,0,0,.16);background:#fff;color:#1d1d1f}
    button.primary{background:#1d1d1f;border-color:#1d1d1f;color:#fff}
    button.link{border:none;background:none;color:#0066cc;padding:0 4px}
    .x{position:absolute;top:8px;right:8px;border:none;background:none;color:#8e8e93;width:24px;height:24px;padding:0;display:grid;place-items:center}
    .x:hover{color:#1d1d1f}
    .toast{left:auto;right:18px;bottom:18px;top:auto;background:#1d1d1f;color:#fff;padding:9px 12px 9px 14px;display:none;align-items:center;gap:12px;max-width:440px;box-shadow:0 4px 16px rgba(0,0,0,.2)}
    .toast.show{display:flex}
    .toast button{background:none;border:none;color:#9ecbff;font-weight:600;padding:0 4px;height:auto}
    @media (prefers-color-scheme: dark){
      .pop:not(.toast){background:#2c2c2e;color:#f2f2f7;box-shadow:0 0 0 .5px rgba(255,255,255,.15),0 4px 16px rgba(0,0,0,.4)}
      .item:hover,.item.active{background:#3a3a3c}
      .item svg,.t2,.bubble .q,.bubble label,.empty{color:#a1a1a6}
      .sep{background:#3a3a3c}
      .search,.bubble input,.bubble select{background:#1c1c1e;color:#f2f2f7;border-color:rgba(255,255,255,.16)}
      button{background:#3a3a3c;border-color:rgba(255,255,255,.16);color:#f2f2f7}
      button.primary{background:#f2f2f7;border-color:#f2f2f7;color:#1c1c1e}
      button.link,.foot a{color:#4ea1ff}
      .chip{background:#2c2c2e;color:#a1a1a6}
    }
  </style>
  <div class="pop menu" role="listbox"></div>
  <div class="chip" title="ApplyKit: choose a saved answer">${svg('list')}</div>
  <div class="pop bubble" role="dialog"></div>
  <div class="pop toast" role="status"><span class="msg"></span><button class="act"></button></div>`;

  const menu = shadow.querySelector('.menu');
  const chip = shadow.querySelector('.chip');
  const bubble = shadow.querySelector('.bubble');
  const toastEl = shadow.querySelector('.toast');

  function mount() {
    if (!hostEl.isConnected) (document.body || document.documentElement).appendChild(hostEl);
  }

  function h(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v != null) e.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  }

  const trunc = (s, n = 60) => {
    s = String(s || '').replace(/\s+/g, ' ');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };

  function place(card, el, width) {
    const r = el.getBoundingClientRect();
    const w = width || Math.min(Math.max(r.width, 270), 400);
    card.style.width = w + 'px';
    card.style.left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8) + 'px';
    card.style.top = r.bottom + 4 + 'px';
    requestAnimationFrame(() => {
      const ch = card.offsetHeight;
      if (r.bottom + 4 + ch > window.innerHeight - 8 && r.top - 4 - ch > 8) card.style.top = r.top - 4 - ch + 'px';
    });
  }

  // ---------------- suggestion menu ----------------
  let cur = null;           // { d, m, idx }
  let items = [];
  let active = -1;

  function hideMenu() {
    menu.classList.remove('show');
    chip.classList.remove('show');
    cur = null;
    items = [];
    active = -1;
  }

  function setActive(i) {
    active = i;
    items.forEach((it, j) => it.el.classList.toggle('active', j === i));
    if (items[i]) items[i].el.scrollIntoView({ block: 'nearest' });
  }

  function addItem(container, icon, t1, t2, act) {
    const el = h('div', { class: 'item', role: 'option', html: svg(icon) }, h('div', { class: 'txt' }, h('div', { class: 't1' }, t1), t2 ? h('div', { class: 't2' }, t2) : null));
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => { e.preventDefault(); act(); });
    el.addEventListener('mouseenter', () => setActive(items.findIndex((x) => x.el === el)));
    container.append(el);
    items.push({ el, act });
  }

  function footer() {
    const f = h('div', { class: 'foot' }, h('span', {}, 'ApplyKit'), h('a', { onclick: () => chrome.runtime.sendMessage({ type: 'ak-open-options' }) }, 'Manage answers'));
    f.addEventListener('mousedown', (e) => e.preventDefault());
    return f;
  }

  function showMenu(d, m, idx, value, others) {
    mount();
    cur = { d, m, idx };
    items = [];
    active = -1;
    menu.replaceChildren();
    const long = String(value).length > 60;
    addItem(menu, 'person', long ? labelOf(m.key, idx) : value, long ? trunc(value, 70) : labelOf(m.key, idx), () => {
      fillOne(d, value);
      hideMenu();
    });
    menu.append(h('div', { class: 'sep' }));
    if (others > 0) addItem(menu, 'fill', `Fill ${others + 1} fields on this page`, null, fillAll);
    addItem(menu, 'list', 'Choose a different answer…', null, () => showPicker(d));
    addItem(menu, 'off', "Don't suggest for this field", null, async () => {
      hideMenu();
      await AK.learnAlias(d.signature, '__ignore__', d.rawLabel, host);
      toast(`ApplyKit won't suggest anything for "${trunc(d.rawLabel, 40)}" again.`);
    });
    menu.append(h('div', { class: 'sep' }), footer());
    menu.classList.add('show');
    chip.classList.remove('show');
    place(menu, d.el);
  }

  /** Everything the user has saved, as pickable rows (list entries expanded). */
  function savedAnswers() {
    const out = [];
    for (const f of fields) {
      if (f.input === 'check') continue;
      if (f.list) {
        ((state.profile.lists || {})[f.list] || []).forEach((e, i) => {
          if (e[f.sub]) out.push({ key: f.key, idx: i, label: labelOf(f.key, i), value: String(e[f.sub]) });
        });
      } else {
        const v = answer(f.key);
        if (v) out.push({ key: f.key, idx: 0, label: f.label, value: v });
      }
    }
    return out;
  }

  function showPicker(d) {
    mount();
    cur = cur || { d, m: null, idx: 0 };
    menu.replaceChildren();
    items = [];
    active = -1;
    const search = h('input', { class: 'search', type: 'text', placeholder: 'Search your answers', 'aria-label': 'Search your answers' });
    const list = h('div', { class: 'list' });
    const all = savedAnswers();
    const render = () => {
      list.replaceChildren();
      items = [];
      active = -1;
      const q = search.value.trim().toLowerCase();
      const avail = all.filter((a) => !q || a.label.toLowerCase().includes(q) || a.value.toLowerCase().includes(q));
      if (!avail.length) list.append(h('div', { class: 'empty' }, all.length ? 'No matches.' : 'You have no saved answers yet. Choose Manage answers to add some.'));
      for (const a of avail.slice(0, 80)) {
        addItem(list, 'person', a.label, trunc(a.value, 70), async () => {
          fillOne(d, valueFor(d, a.key, a.idx) || a.value);
          hideMenu();
          if (d.signature) {
            await AK.learnAlias(d.signature, a.key, d.rawLabel, host);
            toast(`Saved. Next time, "${trunc(d.rawLabel || d.signature, 40)}" will be filled with your ${fieldByKey[a.key] ? fieldByKey[a.key].label.toLowerCase() : 'answer'}.`);
          }
        });
      }
    };
    search.addEventListener('input', render);
    search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(items.length - 1, active + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, active - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); (items[active] || items[0] || { act() {} }).act(); }
      else if (e.key === 'Escape') { hideMenu(); d.el.focus(); }
    });
    menu.append(search, list, h('div', { class: 'sep' }), footer());
    render();
    menu.classList.add('show');
    chip.classList.remove('show');
    place(menu, d.el, 340);
    setTimeout(() => search.focus(), 0);
  }

  function showChip(d) {
    mount();
    cur = { d, m: null, idx: 0 };
    const r = d.el.getBoundingClientRect();
    if (r.width < 80) return;
    chip.style.left = r.right - 27 + 'px';
    chip.style.top = r.top + Math.max(0, (Math.min(r.height, 40) - 22) / 2) + 'px';
    chip.classList.add('show');
  }
  chip.addEventListener('mousedown', (e) => e.preventDefault());
  chip.addEventListener('click', () => cur && showPicker(cur.d));

  // ---------------- toast ----------------
  let toastTimer = 0;
  function toast(msg, actLabel, act) {
    mount();
    toastEl.querySelector('.msg').textContent = msg;
    const b = toastEl.querySelector('.act');
    b.style.display = actLabel ? '' : 'none';
    b.textContent = actLabel || '';
    b.onclick = () => { toastEl.classList.remove('show'); act && act(); };
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), actLabel ? 9000 : 5000);
  }

  // ---------------- "save this answer?" bubble ----------------
  const dismissed = new Set();
  let bubbleTimer = 0;
  bubble.addEventListener('mouseenter', () => clearTimeout(bubbleTimer));
  function hideBubble() {
    bubble.classList.remove('show');
    clearTimeout(bubbleTimer);
  }

  function showSaveBubble(d, value, m) {
    mount();
    bubble.replaceChildren();
    const nameInput = h('input', { type: 'text', value: trunc(d.rawLabel || d.signature, 100) });
    const linkSel = h('select', {},
      h('option', { value: '' }, 'Choose one of your answers…'),
      ...fields.filter((f) => f.input !== 'check').map((f) => h('option', { value: f.key }, f.label)));
    const close = h('button', { class: 'x', title: 'Close', 'aria-label': 'Close', html: svg('x') });
    close.onclick = () => { dismissed.add(d.signature); hideBubble(); };

    const saveNew = h('button', { class: 'primary' }, 'Save answer');
    saveNew.onclick = async () => {
      const label = nameInput.value.trim() || d.rawLabel || 'Saved answer';
      const key = await AK.addCustomField(label, value, [d.signature]);
      await AK.learnAlias(d.signature, key, d.rawLabel, host);
      hideBubble();
      toast(`Saved "${trunc(label, 40)}". ApplyKit will fill it in next time.`);
    };
    const updateBtn = m && !fieldByKey[m.key].list ? h('button', {}, `Replace my ${fieldByKey[m.key].label.toLowerCase()}`) : null;
    if (updateBtn) updateBtn.onclick = async () => {
      await AK.update('profile', (p) => { p.values[m.key] = value; return p; });
      await AK.learnAlias(d.signature, m.key, d.rawLabel, host);
      hideBubble();
      toast(`Updated your ${fieldByKey[m.key].label.toLowerCase()}.`);
    };
    linkSel.onchange = async () => {
      const k = linkSel.value;
      if (!k) return;
      await AK.learnAlias(d.signature, k, d.rawLabel, host);
      hideBubble();
      toast(`Got it. "${trunc(d.rawLabel, 40)}" means your ${fieldByKey[k].label.toLowerCase()}.`);
    };
    const never = h('button', { class: 'link' }, 'Not for this question');
    never.onclick = async () => {
      await AK.learnAlias(d.signature, '__ignore__', d.rawLabel, host);
      hideBubble();
    };

    bubble.append(
      close,
      h('h4', {}, 'Save this answer for next time?'),
      h('div', { class: 'q' }, `"${trunc(value, 90)}"`),
      h('label', {}, 'Name'),
      nameInput,
      h('div', { class: 'row' }, saveNew, updateBtn, never),
      h('div', { style: 'height:10px' }),
      h('label', {}, 'Or, this question is asking for'),
      linkSel,
    );
    bubble.classList.add('show');
    place(bubble, d.el, 320);
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hideBubble, 20000);
  }

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------
  function targetOf(e) {
    const p = e.composedPath ? e.composedPath() : [e.target];
    if (p.includes(hostEl)) return null;
    return p[0];
  }

  let formLike = { t: 0, v: false };
  function pageLooksLikeForm() {
    const now = Date.now();
    if (now - formLike.t > 3000) formLike = { t: now, v: AK.allCandidates().filter(AK.isVisible).length >= 3 };
    return formLike.v;
  }

  document.addEventListener('focusin', async (e) => {
    const el = targetOf(e);
    if (!el) return;
    if (!AK.isCandidate(el) || el.type === 'checkbox') { hideMenu(); return; }
    if (filling) return;
    await ready;
    if (quiet() || !state.settings.showOnFocus) return;
    const root = el.getRootNode();
    if ((root.activeElement || document.activeElement) !== el) return;
    const all = scan();
    const me = all.find((x) => x.d.el === el || (x.d.kind === 'radio' && x.d.els.includes(el)));
    if (!me || me.d.sensitive) { hideMenu(); return; }
    if (usable(me) && (AK.isEmpty(me.d) || AK.currentValue(me.d) !== String(me.value))) {
      const others = all.filter((x) => x !== me && usable(x) && AK.isEmpty(x.d)).length;
      showMenu(me.d, me.m, me.idx, me.value, others);
    } else if (me.d.kind === 'text' && pageLooksLikeForm()) {
      menu.classList.remove('show');
      showChip(me.d);
    } else hideMenu();
  }, true);

  document.addEventListener('focusout', (e) => {
    const el = targetOf(e);
    if (!el) return;
    setTimeout(() => {
      if (document.activeElement === hostEl) return; // focus moved into our search box
      if (cur && cur.d.el === el) hideMenu();
    }, 120);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!menu.classList.contains('show') || !cur) return;
    if (targetOf(e) !== cur.d.el) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setActive(Math.min(items.length - 1, active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setActive(Math.max(-1, active - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); e.stopPropagation(); items[active].act(); }
    else if (e.key === 'Escape') hideMenu();
    else if (e.key.length === 1 || e.key === 'Backspace') hideMenu();
  }, true);

  document.addEventListener('input', (e) => {
    if (!e.isTrusted) return;
    const el = targetOf(e);
    if (el && el.classList && el.classList.contains('applykit-filled')) el.classList.remove('applykit-filled');
    if (el && cur && cur.d.el === el) { menu.classList.remove('show'); chip.classList.remove('show'); }
  }, true);

  // Learn from what the user types
  document.addEventListener('change', async (e) => {
    if (!e.isTrusted || filling) return;
    const el = targetOf(e);
    if (!el || !AK.isCandidate(el) || el.type === 'checkbox') return;
    await ready;
    if (quiet()) return;
    const d = AK.describe(el);
    if (d.sensitive || !d.signature) return;
    const v = AK.currentValue(d).trim();
    if (!v || v.length > 10000) return;
    if (filledByUs.get(el) === v) return;

    const m = matchOf(d);
    const same = (a) => {
      if (!a) return false;
      if (AK.normValue(a) === AK.normValue(v)) return true;
      return d.kind !== 'text' && AK.pickOption([{ text: v, value: v }], a) === 0;
    };
    if (m && savedAnswers().some((a) => a.key === m.key && same(a.value))) return; // already right

    const hit = savedAnswers().find((a) => same(a.value));
    if (hit && state.settings.learnSilently) {
      const prev = state.aliases[d.signature];
      await AK.learnAlias(d.signature, hit.key, d.rawLabel, host);
      toast(`Learned: "${trunc(d.rawLabel || d.signature, 40)}" asks for your ${(fieldByKey[hit.key] || {}).label ? fieldByKey[hit.key].label.toLowerCase() : 'answer'}.`, 'Undo', async () => {
        await AK.update('aliases', (a) => { if (prev) a[d.signature] = prev; else delete a[d.signature]; return a; });
      });
      return;
    }
    if (!state.settings.offerToSave || dismissed.has(d.signature)) return;
    if (state.aliases[d.signature] && state.aliases[d.signature].key === '__ignore__') return;
    if (d.kind === 'text' && d.type === 'number' && v.length < 2) return;
    showSaveBubble(d, v, m);
  }, true);

  window.addEventListener('scroll', () => {
    if (menu.classList.contains('show') && cur) place(menu, cur.d.el, menu.offsetWidth);
    chip.classList.remove('show');
  }, true);
  window.addEventListener('resize', hideMenu);

  // ------------------------------------------------------------------
  // API for the toolbar pop-up and keyboard shortcut
  // ------------------------------------------------------------------
  window.__AK_API = {
    async stats() { await ready; return stats(); },
    async fillAll() { await ready; return fillAll(); },
  };
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg && msg.type === 'ak-fill-all') {
      window.__AK_API.fillAll().then(reply);
      return true;
    }
  });
})();
