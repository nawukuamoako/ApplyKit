/*
 * ApplyKit — text normalisation and field matching.
 *
 * Pure functions with no DOM or chrome.* access, so they can be unit tested
 * in Node (see test/matcher.test.js).
 */
(function (global) {
  const AK = (global.AK = global.AK || {});

  const FILLER = /\b(please|kindly|enter|provide|select|choose|required|optional|mandatory|here|e g|eg)\b/g;

  /** Lower-case, split camelCase / snake_case, drop punctuation and filler words. */
  function normalize(s) {
    if (s == null) return '';
    let t = String(s)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Za-z])(\d)/g, '$1 $2')
      .toLowerCase()
      .replace(/e-mail/g, 'email')
      .replace(/[_\-./:;,()[\]{}*?!"'’#|\\+&<>=~`^%$@]/g, ' ')
      .replace(/\b(mm|dd|yyyy|yy)( (mm|dd|yyyy|yy))+\b/g, ' ')
      .replace(FILLER, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (t.length > 140) t = t.slice(0, 140);
    return t;
  }

  /** The value as it should be compared (case/space insensitive). */
  function normValue(v) {
    return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function wordCount(t) {
    return t ? t.split(' ').length : 0;
  }

  function containsPhrase(text, phrase) {
    if (!phrase) return false;
    if (text === phrase) return true;
    return (' ' + text + ' ').indexOf(' ' + phrase + ' ') !== -1;
  }

  // Words that mean "this field is about somebody/something else", so the
  // user's own name/phone/address must not be filled there.
  const NEGATIVE_PERSON = ['recommender', 'reference', 'referee', 'recommendation', 'emergency', 'parent', 'guardian',
    'mother', 'father', 'spouse', 'partner', 'supervisor', 'manager', 'sibling', 'child', 'relative', 'sponsor',
    'dependent', 'advisor', 'adviser', 'contact person', 'faculty', 'professor', 'friend', 'beneficiary'];
  const NEGATIVE_ORG = ['employer', 'company', 'institution', 'school', 'university', 'college', 'organization', 'organisation', 'business', 'office'];
  const PERSONAL_GROUPS = { personal: 1, contact: 1, address: 1 };
  const ORG_SENSITIVE_GROUPS = { contact: 1, address: 1, personal: 1 };

  // Synonyms that are too vague to trust for a repeated section without a heading nearby.
  const GENERIC_LIST_SYN = new Set(['name', 'full name', 'title', 'position', 'role', 'city', 'country', 'location', 'from', 'to',
    'email', 'phone', 'start date', 'end date', 'start month', 'start year', 'end month',
    'end year', 'from year', 'to year', 'present', 'in progress', 'level', 'subject', 'scale', 'description', 'type']);

  // If a label ends in one of these, that word says what kind of value it wants.
  const HEAD_WORDS = { address: 1, phone: 1, email: 1, city: 1, state: 1, zip: 1, date: 1, number: 1, url: 1, website: 1, name: 1, code: 1, country: 1, title: 1, score: 0 };

  function hasAny(text, words) {
    for (const w of words) if (containsPhrase(text, w)) return true;
    return false;
  }

  /**
   * Score how well one piece of text matches one field (0..1).
   * Exact synonym match = 1. A synonym contained in a longer label scores
   * higher the more of the label it covers.
   */
  function scoreText(text, field) {
    if (!text) return { score: 0, syn: '' };
    if (PERSONAL_GROUPS[field.group] && hasAny(text, NEGATIVE_PERSON)) return { score: 0, syn: '' };
    let best = 0, bestSyn = '';
    const words = wordCount(text);
    for (const raw of field._syn || field.synonyms || []) {
      const syn = raw;
      if (!syn) continue;
      let s = 0;
      if (text === syn) s = 1;
      else if (containsPhrase(text, syn)) {
        const synWords = wordCount(syn);
        // Short single words ("to", "first", "state") are only trusted in short labels.
        if (synWords === 1 && syn.length <= 5 && words > 3) continue;
        // If the label also names an organisation, don't put the user's own address there.
        if (ORG_SENSITIVE_GROUPS[field.group] && hasAny(text, NEGATIVE_ORG) && !hasAny(syn, NEGATIVE_ORG)) continue;
        s = 0.6 + 0.35 * (syn.length / text.length);
        // "Employer address": the label is really about an address, not the employer.
        const last = text.slice(text.lastIndexOf(' ') + 1);
        if (HEAD_WORDS[last] && !(field._syn || []).some((x) => containsPhrase(x, last))) s *= 0.5;
      }
      if (s > best || (s === best && syn.length > bestSyn.length)) {
        best = s;
        bestSyn = syn;
      }
    }
    return { score: best, syn: bestSyn };
  }

  /** Prepare fields once: normalise synonyms (including the field's own label). */
  function prepareFields(fields) {
    return fields.map((f) => {
      const syn = new Set();
      for (const s of f.synonyms || []) syn.add(normalize(s));
      syn.add(normalize(f.label));
      syn.delete('');
      return { ...f, _syn: Array.from(syn) };
    });
  }

  const AUTOCOMPLETE_IGNORE = /^(on|off|section-\S+|shipping|billing|home|work|mobile|fax|pager|webauthn)$/;

  function autocompleteTokens(ac) {
    if (!ac) return [];
    return ac.toLowerCase().split(/\s+/).filter((t) => t && !AUTOCOMPLETE_IGNORE.test(t));
  }

  /**
   * Find the best profile field for a form control.
   *
   * desc = {
   *   signature: normalised primary label (used for learned wordings),
   *   texts: [{ text: normalised, weight: 0..1 }],
   *   autocomplete: raw autocomplete attribute,
   *   type: input type
   * }
   * aliases = { [signature]: { key } }  (learned wordings; key "__ignore__" = never suggest)
   *
   * Returns { key, score, source } or null.
   */
  function matchField(desc, fields, aliases, hasValue) {
    aliases = aliases || {};
    const sig = desc.signature;
    if (sig && aliases[sig]) {
      const k = aliases[sig].key;
      if (k === '__ignore__') return null;
      if (fields.some((f) => f.key === k)) return { key: k, score: 1.01, source: 'learned' };
    }
    // Any other learned text on the element (e.g. its name attribute) also counts.
    for (const t of desc.texts || []) {
      const a = aliases[t.text];
      if (a && a.key !== '__ignore__' && fields.some((f) => f.key === a.key)) {
        return { key: a.key, score: 1.0, source: 'learned' };
      }
    }

    const tokens = autocompleteTokens(desc.autocomplete);
    if (tokens.length) {
      for (const f of fields) {
        if (f.autocomplete && f.autocomplete.some((a) => tokens.includes(a))) {
          return { key: f.key, score: 1, source: 'autocomplete' };
        }
      }
    }

    const ranked = [];
    const ctx = desc.context || '';
    const labelTexts = (desc.texts || []).map((t) => t.text).join(' | ');
    const kind = desc.kind || 'text';
    for (const f of fields) {
      // Checkbox-only answers never go into text boxes, and checkboxes only take yes/no style answers.
      if (f.input === 'check' && kind === 'text') continue;
      if (kind === 'checkbox' && !['check', 'yesno', 'chips'].includes(f.input)) continue;
      if (PERSONAL_GROUPS[f.group] && hasAny(ctx, NEGATIVE_PERSON)) continue;
      let ctxHit = false;
      if (f.list) {
        const def = (AK.LISTS || {})[f.list] || {};
        if (def.requires && !hasAny(labelTexts + ' | ' + ctx, def.requires)) continue;
        if (def.avoid && hasAny(labelTexts, def.avoid)) continue;
        ctxHit = !!(def.context && hasAny(ctx, def.context));
      }
      let fs = 0, fsyn = '';
      for (const t of desc.texts || []) {
        const r = scoreText(t.text, f);
        const sc = r.score * (t.weight == null ? 1 : t.weight);
        if (sc > fs || (sc === fs && r.syn.length > fsyn.length)) {
          fs = sc;
          fsyn = r.syn;
        }
      }
      if (f.list && fs > 0) {
        if (ctxHit) fs *= 1.12;
        else if (GENERIC_LIST_SYN.has(fsyn)) fs = 0;   // "Title", "City", "Start date" need a section heading to be sure
        else fs *= 0.9;
      }
      if (f.type && desc.type === f.type) {
        const aboutSomeoneElse = (desc.texts || []).some((t) => hasAny(t.text, NEGATIVE_PERSON) || hasAny(t.text, NEGATIVE_ORG)) || hasAny(ctx, NEGATIVE_PERSON);
        if (!aboutSomeoneElse) fs = Math.max(fs, 0.8) + 0.1;
      }
      if (fs > 0) ranked.push({ key: f.key, score: fs, synLen: fsyn.length });
    }
    ranked.sort((a, b) => b.score - a.score || b.synLen - a.synLen);
    let best = ranked[0];
    if (!best || best.score < 0.55) return null;
    // "GitHub or portfolio URL": if the top guess has no saved answer but a close
    // runner-up does, use the runner-up. (A big gap means they really differ,
    // e.g. "Middle name" must never fall back to the full name.)
    if (hasValue && !hasValue(best.key)) {
      const alt = ranked.find((r) => r.score >= 0.55 && best.score - r.score <= 0.15 && hasValue(r.key));
      if (alt) best = alt;
    }
    // An email/tel input should never be filled with something that isn't an email/phone.
    if (desc.type === 'email' && !/(^|\.)email$/.test(best.key)) return null;
    return { key: best.key, score: best.score, source: 'guess' };
  }

  // ------------------------------------------------------------------
  // Picking an option in a <select> or radio group
  // ------------------------------------------------------------------

  const US_STATES = {
    al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut',
    de: 'delaware', dc: 'district of columbia', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois',
    in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland',
    ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana',
    ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico', ny: 'new york',
    nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania',
    ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah',
    vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming', pr: 'puerto rico',
  };
  const COUNTRY_ALIASES = [
    ['united states', 'united states of america', 'usa', 'us', 'u s', 'u s a', 'america'],
    ['united kingdom', 'uk', 'u k', 'great britain', 'britain', 'england'],
    ['south korea', 'korea republic of', 'republic of korea', 'korea south'],
    ['ivory coast', "cote d ivoire", 'côte d ivoire'],
    ['china', 'people s republic of china', 'prc', 'china mainland'],
    ['russia', 'russian federation'],
    ['iran', 'iran islamic republic of'],
    ['vietnam', 'viet nam'],
    ['netherlands', 'the netherlands', 'holland'],
    ['uae', 'united arab emirates'],
  ];
  const GENERIC_EQUIV = [
    ['male', 'm', 'man'],
    ['female', 'f', 'woman'],
    ['yes', 'y', 'true'],
    ['no', 'n', 'false'],
    ['prefer not to say', 'prefer not to answer', 'decline to self identify', 'decline to answer', 'i don t wish to answer',
      'i do not wish to answer', 'choose not to disclose', 'decline', 'not specified', 'i prefer not to say'],
    ['non binary', 'nonbinary', 'non binary genderqueer', 'genderqueer'],
    ['open to discuss', 'maybe', 'open to it', 'negotiable'],
  ];
  const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const DEGREE_KEYS = [
    [/^bachelor|^b ?[as]\b|^b ?eng/, ['bachelor', 'bachelors', 'bachelor s', 'bachelor s degree', 'undergraduate', 'ba', 'bs', 'b s', 'b a', 'bsc', 'bachelor degree']],
    [/^master of business|^mba/, ['mba', 'master of business administration', 'master s', 'masters', 'master s degree']],
    [/^master|^m ?[as]\b|^m ?eng|^msc/, ['master', 'masters', 'master s', 'master s degree', 'ms', 'm s', 'ma', 'm a', 'msc', 'master degree', 'graduate']],
    [/^doctor of philosophy|^ph ?d/, ['doctorate', 'doctoral', 'phd', 'ph d', 'doctor of philosophy', 'doctorate degree']],
    [/^doctor of medicine|^m ?d$/, ['md', 'm d', 'doctor of medicine', 'medical degree', 'doctorate', 'professional degree']],
    [/^juris|^j ?d$/, ['jd', 'j d', 'juris doctor', 'law degree', 'professional degree']],
    [/^associate/, ['associate', 'associates', 'associate s', 'associate s degree', 'associate degree']],
    [/^high school/, ['high school', 'high school diploma', 'secondary school', 'ged', 'diploma']],
    [/^certificate/, ['certificate', 'diploma', 'certification']],
  ];

  function equivalents(v) {
    const n = normalize(v);
    const out = new Set([n]);
    if (US_STATES[n]) out.add(US_STATES[n]);
    for (const [abbr, name] of Object.entries(US_STATES)) if (name === n) out.add(abbr);
    for (const group of COUNTRY_ALIASES.concat(GENERIC_EQUIV)) {
      if (group.includes(n)) group.forEach((g) => out.add(g));
    }
    for (const [re, keys] of DEGREE_KEYS) if (re.test(n)) { keys.forEach((k) => out.add(k)); break; }
    const mi = MONTH_NAMES.indexOf(n) >= 0 ? MONTH_NAMES.indexOf(n) : MONTH_NAMES.findIndex((m) => m.slice(0, 3) === n);
    if (mi >= 0) { out.add(MONTH_NAMES[mi]); out.add(MONTH_NAMES[mi].slice(0, 3)); out.add(String(mi + 1)); out.add(String(mi + 1).padStart(2, '0')); }
    if (/^\d{1,2}$/.test(n) && +n >= 1 && +n <= 12) { out.add(MONTH_NAMES[+n - 1]); out.add(MONTH_NAMES[+n - 1].slice(0, 3)); out.add(String(+n)); out.add(String(+n).padStart(2, '0')); }
    const dial = /\(\s*(\+\d+)\s*\)$/.exec(String(v));
    if (dial) { out.add(normalize(dial[1])); out.add(normalize(String(v).replace(/\s*\(.*$/, ''))); }
    return out;
  }

  /**
   * Choose the option that best matches a profile value.
   * options = [{ text, value }]. Returns index or -1.
   */
  function pickOption(options, value) {
    if (value == null || String(value).trim() === '') return -1;
    const wants = equivalents(value);
    let bestIdx = -1, bestScore = 0;
    options.forEach((o, i) => {
      const t = normalize(o.text), v = normalize(o.value);
      if (!t && !v) return;
      let s = 0;
      if (wants.has(t) || wants.has(v)) s = 1;
      else {
        for (const w of wants) {
          if (w.length < 2) continue;
          if (t && containsPhrase(t, w)) s = Math.max(s, 0.7 + 0.2 * (w.length / t.length));
          else if (t && t.length >= 3 && containsPhrase(w, t)) s = Math.max(s, 0.6 + 0.2 * (t.length / w.length));
          else if (t && w.length >= 3 && t.startsWith(w)) s = Math.max(s, 0.6);
        }
      }
      if (s > bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    });
    return bestScore >= 0.6 ? bestIdx : -1;
  }

  // ------------------------------------------------------------------
  // Dates
  // ------------------------------------------------------------------

  /** Parse common date strings into {y, m, d} (m and d may be missing). */
  function parseDate(v) {
    const s = String(v || '').trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/))) return { y: +m[1], m: +m[2], d: m[3] ? +m[3] : null };
    if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) return { y: +m[3], m: +m[1], d: +m[2] };
    if ((m = s.match(/^(\d{1,2})[/.-](\d{4})$/))) return { y: +m[2], m: +m[1], d: null };
    const t = Date.parse(s);
    if (!isNaN(t) && /\d{4}/.test(s)) {
      const dt = new Date(t);
      return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: /\d{1,2},?\s+\d{4}|\d{1,2}\s+\w+\s+\d{4}/.test(s) ? dt.getDate() : null };
    }
    return null;
  }

  const pad = (n) => String(n).padStart(2, '0');

  /** Format a date value for an input, given its type and placeholder. */
  function formatDateFor(value, type, placeholder) {
    const p = parseDate(value);
    if (!p) return value;
    const d = p.d || 1;
    if (type === 'date') return `${p.y}-${pad(p.m)}-${pad(d)}`;
    if (type === 'month') return `${p.y}-${pad(p.m)}`;
    const ph = String(placeholder || '').toLowerCase();
    if (/month\s*\/?\s*year|mm\s*\/\s*yyyy|mm\s*-\s*yyyy/.test(ph) && !/dd/.test(ph)) return `${pad(p.m)}/${p.y}`;
    if (/dd.?mm.?yyyy/.test(ph)) return `${pad(d)}/${pad(p.m)}/${p.y}`;
    if (/mm.?dd.?yyyy/.test(ph)) return `${pad(p.m)}/${pad(d)}/${p.y}`;
    if (/mm.?yyyy/.test(ph)) return `${pad(p.m)}/${p.y}`;
    if (/yyyy.?mm.?dd/.test(ph)) return `${p.y}-${pad(p.m)}-${pad(d)}`;
    return value;
  }

  const DATE_KEYS = { dob: 1, gradStart1: 1, gradDate1: 1, greDate: 1 };

  Object.assign(AK, {
    normalize, normValue, scoreText, prepareFields, matchField, pickOption, parseDate, formatDateFor,
    containsPhrase, DATE_KEYS, hasAny, MONTH_NAMES,
  });
})(typeof window !== 'undefined' ? window : globalThis);
