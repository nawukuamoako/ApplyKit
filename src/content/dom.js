/*
 * ApplyKit — reading form controls from the page: finding them, working out
 * what each one is asking for, and writing values in a way that frameworks
 * like React, Angular and Vue notice.
 */
(function (global) {
  const AK = (global.AK = global.AK || {});

  const SKIP_INPUT_TYPES = new Set(['hidden', 'password', 'file', 'submit', 'button', 'reset', 'image', 'range', 'color', 'search']);
  const SENSITIVE = /\b(ssn|social security|social insurance|passport number|card number|credit card|debit card|cvv|cvc|security code|account number|routing|iban|swift|pin|password|passcode|otp|verification code|captcha)\b/;
  const NOT_TEXT = 'input,select,textarea,option,optgroup,script,style,noscript,button,svg,template,datalist';

  function isVisible(el) {
    if (!el.isConnected) return false;
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity || '1') > 0.05;
  }

  function isCandidate(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (SKIP_INPUT_TYPES.has(type)) return false;
    } else if (tag !== 'SELECT' && tag !== 'TEXTAREA') return false;
    if (el.disabled || el.readOnly) return false;
    if (el.closest('[data-applykit-ui]')) return false;
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (/\bcc-|one-time-code|new-password|current-password/.test(ac)) return false;
    return true;
  }

  /** All candidate controls in the document, including open shadow roots. */
  function allCandidates(root = document) {
    const out = [];
    const visit = (r) => {
      r.querySelectorAll('input,select,textarea').forEach((el) => {
        if (isCandidate(el)) out.push(el);
      });
      r.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot) visit(el.shadowRoot);
      });
    };
    visit(root);
    return out;
  }

  /** Visible text inside a node, skipping form controls and their options. */
  function ownText(node, max = 200) {
    if (!node) return '';
    if (node.nodeType === 3) return node.nodeValue.trim().slice(0, max);
    if (node.nodeType !== 1 || node.matches(NOT_TEXT) || node.closest('[data-applykit-ui]')) return '';
    let out = '';
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode(t) {
        const p = t.parentElement;
        if (!p || p.closest(NOT_TEXT)) return NodeFilter.FILTER_REJECT;
        // Skip text hidden with CSS (screen-reader-only text is fine; it's often the real label)
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let t;
    while ((t = walker.nextNode()) && out.length < max) out += ' ' + t.nodeValue;
    return out.replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function containsControl(node) {
    return node.nodeType === 1 && (node.matches('input,select,textarea') || !!node.querySelector('input:not([type=hidden]),select,textarea'));
  }

  /** Text near a control that has no proper <label>: previous siblings, then up the tree. */
  function nearbyText(el, maxDepth = 3) {
    let node = el;
    for (let depth = 0; depth <= maxDepth && node; depth++) {
      let sib = node.previousSibling, hops = 0;
      while (sib && hops < 4) {
        if (sib.nodeType === 1 && containsControl(sib)) break;
        const t = ownText(sib, 150);
        if (t) return t;
        sib = sib.previousSibling;
        hops++;
      }
      const parent = node.parentElement;
      if (!parent || parent === document.body) break;
      // Stop if the parent holds several other fields: its text is not about us.
      if (parent.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]),select,textarea').length > 1) break;
      node = parent;
    }
    return '';
  }

  function byIdList(el, ids) {
    const root = el.getRootNode();
    return String(ids || '')
      .split(/\s+/)
      .map((id) => id && (root.getElementById ? root.getElementById(id) : document.getElementById(id)))
      .filter(Boolean)
      .map((n) => ownText(n))
      .join(' ')
      .trim();
  }

  function labelsOf(el) {
    const out = [];
    try {
      if (el.labels) for (const l of el.labels) {
        const t = ownText(l);
        if (t) out.push(t);
      }
    } catch (e) { /* some custom elements throw */ }
    if (!out.length && el.id) {
      const root = el.getRootNode();
      const l = root.querySelector && root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) out.push(ownText(l));
    }
    return out.filter(Boolean);
  }

  /** Radio buttons that belong to the same group as `el`. */
  function radioGroup(el) {
    const name = el.name;
    if (!name) return [el];
    const scope = el.form || el.getRootNode();
    return Array.from(scope.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`)).filter((r) => !r.disabled);
  }

  function commonAncestor(els) {
    let a = els[0].parentElement;
    while (a && !els.every((e) => a.contains(e))) a = a.parentElement;
    return a;
  }

  const HEADINGS = 'h1,h2,h3,h4,h5,h6,legend,[role=heading],caption';

  /** Returns a function giving the nearest heading above an element (built once per scan). */
  function headingFinder(root = document) {
    const list = Array.from(root.querySelectorAll(HEADINGS)).filter((x) => !x.closest('[data-applykit-ui]'));
    return (el) => {
      let lo = 0, hi = list.length - 1, best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const pos = list[mid].compareDocumentPosition(el);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING || pos & Node.DOCUMENT_POSITION_CONTAINED_BY) { best = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return best >= 0 ? ownText(list[best], 80) : '';
    };
  }

  /** A short caption for the block a control sits in, e.g. "Education 2" or "Previous employer". */
  function groupLabel(el) {
    let node = el.parentElement;
    for (let depth = 0; depth < 6 && node && node !== document.body; depth++, node = node.parentElement) {
      if (node.tagName === 'FIELDSET') {
        const lg = node.querySelector(':scope > legend');
        if (lg && ownText(lg)) return ownText(lg, 80);
      }
      const lbl = node.getAttribute && (node.getAttribute('aria-label') || (node.getAttribute('aria-labelledby') && byIdList(node, node.getAttribute('aria-labelledby'))));
      if (lbl && /^(group|region)$/.test(node.getAttribute('role') || '')) return lbl.slice(0, 80);
      const first = node.firstElementChild;
      if (first && first !== el && !first.contains(el) && first.tagName !== 'LABEL' && !containsControl(first)) {
        const t = ownText(first, 90);
        if (t && t.length <= 60 && node.querySelectorAll('input,select,textarea').length > 1) return t;
      }
    }
    return '';
  }

  /** Index from wording like "Education 2", "Second school", "Employer #3" (0-based), or null. */
  function explicitIndex(...texts) {
    const words = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5 };
    for (const t of texts) {
      const n = AK.normalize(t || '');
      if (!n) continue;
      const m = /(?:^| )(\d{1,2})(?: |$)/.exec(n);
      if (m && +m[1] >= 1 && +m[1] <= 20) return +m[1] - 1;
      for (const [w, v] of Object.entries(words)) if (AK.containsPhrase(n, w)) return v - 1;
    }
    return null;
  }

  /**
   * Work out what a control is asking for.
   * Returns { kind, el, els, rawLabel, signature, texts, type, autocomplete, sensitive }.
   */
  function describe(el, opts = {}) {
    const N = AK.normalize;
    const tag = el.tagName;
    const type = tag === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : tag.toLowerCase();
    let kind = tag === 'SELECT' ? 'select' : type === 'radio' ? 'radio' : type === 'checkbox' ? 'checkbox' : 'text';
    let els = [el];
    const strong = [], weak = [];

    if (kind === 'radio') {
      els = radioGroup(el);
      const fs = el.closest('fieldset');
      const legend = fs && fs.querySelector('legend');
      if (legend) strong.push(ownText(legend));
      const rg = el.closest('[role=radiogroup],[role=group]');
      if (rg) {
        if (rg.getAttribute('aria-label')) strong.push(rg.getAttribute('aria-label'));
        if (rg.getAttribute('aria-labelledby')) strong.push(byIdList(rg, rg.getAttribute('aria-labelledby')));
      }
      if (!strong.length && els.length) {
        const c = commonAncestor(els);
        if (c) strong.push(nearbyText(c, 2));
      }
      if (el.name) weak.push({ raw: el.name, w: 0.75 });
    } else {
      labelsOf(el).forEach((t) => strong.push(t));
      if (kind === 'checkbox') {
        const fs = el.closest('fieldset');
        const lg = fs && fs.querySelector('legend');
        if (lg) weak.push({ raw: ownText(lg), w: 0.9 });
      }
      if (el.getAttribute('aria-labelledby')) strong.push(byIdList(el, el.getAttribute('aria-labelledby')));
      if (el.getAttribute('aria-label')) strong.push(el.getAttribute('aria-label'));
      if (el.placeholder) weak.push({ raw: el.placeholder, w: 0.9 });
      if (el.title) weak.push({ raw: el.title, w: 0.85 });
      if (!strong.filter(Boolean).length) {
        const near = nearbyText(el);
        if (near) weak.push({ raw: near, w: 0.85 });
      }
      if (el.name) weak.push({ raw: el.name, w: 0.75 });
      if (el.id && !/^\d|[0-9a-f]{8,}|^(input|field|ctl|ext-gen)\d*/i.test(el.id)) weak.push({ raw: el.id, w: 0.7 });
    }

    const strongClean = strong.map((s) => (s || '').trim()).filter(Boolean);
    const texts = [];
    const seen = new Set();
    for (const s of strongClean) {
      const t = N(s);
      if (t && !seen.has(t)) { seen.add(t); texts.push({ text: t, weight: 1 }); }
    }
    for (const { raw, w } of weak) {
      const t = N(raw);
      if (t && !seen.has(t)) { seen.add(t); texts.push({ text: t, weight: w }); }
    }

    const rawLabel = (strongClean[0] || (weak[0] && weak[0].raw) || '').replace(/\s*\*\s*$/, '').trim();
    const signature = texts.length ? texts[0].text : '';
    const sensitive = SENSITIVE.test(texts.map((t) => t.text).join(' | '));
    const group = groupLabel(kind === 'radio' && els.length > 1 ? commonAncestor(els) || el : el);
    const heading = (opts.headingOf || headingFinder())(el);
    const context = N([group, heading].filter(Boolean).join(' | '));
    const index = explicitIndex(group, rawLabel);
    return { kind, el, els, rawLabel, signature, texts, type, autocomplete: el.getAttribute('autocomplete') || '', sensitive, context, group, heading, index };
  }

  /** Is the control currently empty (safe to fill without overwriting)? */
  function isEmpty(d) {
    if (d.kind === 'checkbox') return !d.el.checked;
    if (d.kind === 'radio') return !d.els.some((r) => r.checked);
    if (d.kind === 'select') {
      const s = d.el;
      if (s.selectedIndex <= 0) return true;
      const o = s.options[s.selectedIndex];
      return !o || !o.value || /^(select|choose|please|--|-)/i.test((o.text || '').trim());
    }
    return !d.el.value;
  }

  function currentValue(d) {
    if (d.kind === 'checkbox') return d.el.checked ? 'true' : '';
    if (d.kind === 'radio') {
      const r = d.els.find((x) => x.checked);
      return r ? radioLabel(r) : '';
    }
    if (d.kind === 'select') {
      const o = d.el.options[d.el.selectedIndex];
      return isEmpty(d) || !o ? '' : (o.text || o.value || '').trim();
    }
    return d.el.value || '';
  }

  function radioLabel(r) {
    const l = labelsOf(r)[0];
    if (l) return l;
    const n = r.nextSibling;
    const t = n ? ownText(n, 80) : '';
    return t || r.value || '';
  }

  function nativeSet(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function fire(el) {
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  /**
   * Put a value into a control. Returns a function that undoes the change,
   * or null if nothing suitable could be filled.
   */
  function write(d, value) {
    if (value == null || value === '') return null;
    if (d.kind === 'checkbox') {
      if (value !== true && value !== 'true') return null;
      const cb = d.el;
      if (cb.checked) return () => {};
      cb.click();
      if (!cb.checked) { cb.checked = true; fire(cb); }
      return () => { if (cb.checked) cb.click(); };
    }
    if (d.kind === 'radio') {
      const opts = d.els.map((r) => ({ text: radioLabel(r), value: r.value }));
      const i = AK.pickOption(opts, value);
      if (i < 0) return null;
      const prev = d.els.find((r) => r.checked);
      const target = d.els[i];
      if (!target.checked) target.click();
      if (!target.checked) { target.checked = true; fire(target); }
      return () => { if (prev) prev.click(); else { target.checked = false; fire(target); } };
    }
    if (d.kind === 'select') {
      const s = d.el;
      const opts = Array.from(s.options).map((o) => ({ text: o.text, value: o.value }));
      const i = AK.pickOption(opts, value);
      if (i < 0) return null;
      const prevIdx = s.selectedIndex;
      if (prevIdx === i) return () => {};
      s.selectedIndex = i;
      fire(s);
      return () => { s.selectedIndex = prevIdx; fire(s); };
    }
    const el = d.el;
    let v = String(value);
    const hint = (el.placeholder || '') + ' ' + (d.rawLabel || '');
    if (d.type === 'date' || d.type === 'month' || (AK.parseDate(v) && /mm|dd|yyyy|month\s*\/?\s*year/i.test(hint))) {
      v = AK.formatDateFor(v, d.type, hint);
    }
    if (d.type === 'number') {
      const num = parseFloat(v.replace(/[^0-9.\-]/g, ''));
      if (isNaN(num)) return null;
      v = String(num);
    }
    if (d.type === 'email' && !/@/.test(v)) return null;
    if (el.maxLength > 0 && v.length > el.maxLength) v = v.slice(0, el.maxLength);
    const prev = el.value;
    nativeSet(el, v);
    fire(el);
    return () => { nativeSet(el, prev); fire(el); };
  }

  Object.assign(AK, { isVisible, isCandidate, allCandidates, describe, isEmpty, currentValue, write, ownText, headingFinder });
})(typeof window !== 'undefined' ? window : globalThis);
