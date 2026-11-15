/*
 * ApplyKit — storage. Everything lives in chrome.storage.local on this
 * computer; nothing is ever sent anywhere.
 *
 * Keys:
 *   profile  { values: {key: value}, custom: [field], hidden: [key] }
 *   aliases  { [normalisedLabel]: { key, label, host, count, updated } }
 *   apps     [ application ]
 *   settings { ... }
 */
(function (global) {
  const AK = (global.AK = global.AK || {});

  const DEFAULT_SETTINGS = {
    showOnFocus: true,      // show the suggestion pop-up when a matched field is focused
    offerToSave: true,      // offer to remember answers typed into unknown fields
    learnSilently: true,    // learn new wordings when you type a value you already saved
    highlightFilled: true,
    disabledHosts: [],      // sites where ApplyKit stays quiet
    audience: 'both',       // 'college' | 'job' | 'both' — which sections to show
  };

  const DEFAULTS = {
    profile: { values: {}, lists: {}, custom: [], hidden: [] },
    aliases: {},
    apps: [],
    settings: DEFAULT_SETTINGS,
  };

  function get(keys) {
    return new Promise((res) => chrome.storage.local.get(keys, res));
  }
  function set(obj) {
    return new Promise((res) => chrome.storage.local.set(obj, res));
  }

  async function load() {
    const raw = await get(Object.keys(DEFAULTS));
    const profile = Object.assign({ values: {}, lists: {}, custom: [], hidden: [] }, raw.profile || {});
    migrate(profile);
    return {
      profile,
      aliases: raw.aliases || {},
      apps: Array.isArray(raw.apps) ? raw.apps : [],
      settings: Object.assign({}, DEFAULT_SETTINGS, raw.settings || {}),
    };
  }

  /** Move answers from the old single "School 1" style fields into list entries. */
  function migrate(profile) {
    profile.lists = profile.lists || {};
    for (const [old, [list, idx, sub]] of Object.entries(AK.MIGRATE || {})) {
      const v = profile.values[old];
      if (v == null || v === '') continue;
      const arr = (profile.lists[list] = profile.lists[list] || []);
      while (arr.length <= idx) arr.push({ id: newId() });
      if (!arr[idx][sub]) arr[idx][sub] = v;
      delete profile.values[old];
    }
    for (const c of profile.custom || []) if (!c.group || c.group === 'Custom') c.group = 'answers';
    return profile;
  }

  /** Default fields + the user's custom fields, minus hidden ones. */
  function allFields(profile) {
    const hidden = new Set(profile.hidden || []);
    const custom = (profile.custom || []).map((c) => ({ synonyms: [], input: c.multiline ? 'textarea' : 'text', ...c, group: 'answers' }));
    return AK.DEFAULT_FIELDS.concat(custom).filter((f) => !hidden.has(f.key));
  }

  /** The value to fill for a key, with sensible fallbacks for derived fields. */
  function valueFor(key, values) {
    const v = values[key];
    if (v != null && String(v).trim() !== '') return String(v);
    if (key === 'fullName') {
      const parts = [values.firstName, values.middleName, values.lastName].filter((x) => x && String(x).trim());
      if (parts.length) return parts.join(' ');
    }
    if (key === 'preferredName' && values.firstName) return values.firstName;
    return '';
  }

  /** Single answers plus every repeatable sub-field, for matching against forms. */
  function matchFields(profile) {
    return allFields(profile).concat(AK.listFields());
  }

  /** The saved answer for a key. List keys ("education.school") take an entry index. */
  function answer(profile, key, idx = 0) {
    const dot = key.indexOf('.');
    if (dot > 0) {
      const list = key.slice(0, dot), sub = key.slice(dot + 1);
      const e = ((profile.lists || {})[list] || [])[idx];
      if (!e) return '';
      const v = e[sub];
      return v == null ? '' : String(v);
    }
    return valueFor(key, profile.values || {});
  }

  /** Does any entry hold a value for this key? */
  function hasAnswer(profile, key) {
    const dot = key.indexOf('.');
    if (dot > 0) return ((profile.lists || {})[key.slice(0, dot)] || []).some((e) => e[key.slice(dot + 1)]);
    return !!valueFor(key, profile.values || {});
  }

  /** Entries in a list that have at least one answer filled in. */
  function entryCount(profile, list) {
    return ((profile.lists || {})[list] || []).filter((e) => Object.entries(e).some(([k, v]) => k !== 'id' && v)).length;
  }

  async function update(key, mutator) {
    const state = await load();
    const next = await mutator(state[key], state);
    await set({ [key]: next === undefined ? state[key] : next });
    return next;
  }

  async function learnAlias(signature, fieldKey, label, host) {
    if (!signature) return;
    await update('aliases', (aliases) => {
      const prev = aliases[signature] || {};
      aliases[signature] = {
        key: fieldKey,
        label: label || prev.label || signature,
        host: host || prev.host || '',
        count: (prev.key === fieldKey ? prev.count || 0 : 0) + 1,
        updated: Date.now(),
      };
      return aliases;
    });
  }

  function slugKey(label) {
    return 'custom_' + (String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'field') + '_' + Date.now().toString(36);
  }

  async function addCustomField(label, value, synonyms) {
    const key = slugKey(label);
    await update('profile', (p) => {
      p.custom = p.custom || [];
      p.custom.push({ key, label: String(label).slice(0, 120), group: 'answers', synonyms: synonyms || [], multiline: String(value).length > 80 });
      p.values = p.values || {};
      p.values[key] = value;
      return p;
    });
    return key;
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  Object.assign(AK, { matchFields, answer, hasAnswer, entryCount, DEFAULT_SETTINGS, migrate, load, get, set, update, allFields, valueFor, learnAlias, addCustomField, hostOf, newId });
})(typeof window !== 'undefined' ? window : globalThis);
