const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

let state;
const saveTimers = {};

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

function save(key, delay = 350) {
  clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(() => AK.set({ [key]: state[key] }), delay);
}

function fieldsList() {
  return AK.allFields(state.profile);
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function showTab() {
  let tab = (location.hash || '#profile').slice(1);
  if (tab === 'welcome') {
    $('#welcome').hidden = false;
    tab = 'profile';
  }
  if (!$(`[data-panel="${tab}"]`)) tab = 'profile';
  $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab));
  $$('nav a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
}
window.addEventListener('hashchange', showTab);

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------
let sortKey = 'deadline', sortDesc = false;
const DONE = new Set(['Accepted', 'Rejected', 'Withdrawn']);
const SUBMITTED = new Set(['Submitted', 'Applied', 'Screening', 'Interview', 'Offer', 'Accepted', 'Waitlisted', 'Rejected']);
let typeFilter = '';
const typeOf = (a) => a.type || 'college';
const statusesFor = (t) => AK.STATUSES[t] || AK.STATUSES.college;
const ALL_STATUSES = Array.from(new Set(AK.STATUSES.college.concat(AK.STATUSES.job)));
window.Tracker = {
  onAudience() {
    const a = state.settings.audience;
    typeFilter = a === 'both' ? '' : a;
    renderTracker();
  },
};

function daysLeft(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

const STATUS_COLOR = {
  Researching: '', Saved: '', 'In progress': 'blue', Submitted: 'green', Applied: 'green', Screening: 'green', Interview: 'green',
  Offer: 'green', Accepted: 'green', Waitlisted: 'amber', Rejected: 'red', Withdrawn: '',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso) => { const d = new Date(iso + 'T00:00:00'); return isNaN(d) ? '' : `${MONTHS[d.getMonth()]} ${d.getDate()}`; };

function dueText(app) {
  const n = daysLeft(app.deadline);
  if (n == null || SUBMITTED.has(app.status) || DONE.has(app.status)) return null;
  if (n < 0) return h('span', { class: 'left late' }, `${-n} day${n === -1 ? '' : 's'} overdue`);
  if (n === 0) return h('span', { class: 'left late' }, 'Due today');
  return h('span', { class: 'left' + (n <= 14 ? ' soon' : '') }, n === 1 ? 'Tomorrow' : `In ${n} days`);
}

function money(n) {
  return '$' + (Math.round(n * 100) / 100).toLocaleString();
}

function renderTracker() {
  const filter = $('#statusFilter').value;
  $$('#typeFilter button').forEach((b) => b.classList.toggle('on', b.dataset.type === typeFilter));
  const sf = $('#statusFilter');
  const keep = sf.value;
  sf.replaceChildren(h('option', { value: '' }, 'Any status'), ...(typeFilter ? statusesFor(typeFilter) : ALL_STATUSES).map((x) => h('option', { value: x }, x)));
  sf.value = keep;
  const pool = state.apps.filter((a) => !typeFilter || typeOf(a) === typeFilter);
  const apps = pool.filter((a) => !filter || a.status === filter);
  apps.sort((a, b) => {
    let x = a[sortKey], y = b[sortKey];
    if (sortKey === 'fee') { x = parseFloat(x) || 0; y = parseFloat(y) || 0; }
    if (sortKey === 'deadline') { x = x || '9999'; y = y || '9999'; }
    if (sortKey === 'status') { x = ALL_STATUSES.indexOf(x); y = ALL_STATUSES.indexOf(y); }
    if (sortKey === 'type') { x = typeOf(a); y = typeOf(b); }
    const r = x < y ? -1 : x > y ? 1 : 0;
    return sortDesc ? -r : r;
  });
  $$('#appTable th').forEach((th) => {
    th.classList.toggle('sorted', th.dataset.sort === sortKey);
    th.classList.toggle('desc', th.dataset.sort === sortKey && sortDesc);
  });
  $('#appTable tbody').replaceChildren(...apps.map(appRow));
  $('#appEmpty').hidden = apps.length > 0;
  $('#appTable').hidden = apps.length === 0;
  renderStats(pool);
}

function renderStats(pool) {
  const all = pool || state.apps.filter((a) => !typeFilter || typeOf(a) === typeFilter);
  if (!all.length) { $('#trackerSummary').textContent = ''; return; }
  const active = all.filter((a) => !SUBMITTED.has(a.status) && !DONE.has(a.status));
  const upcoming = active.filter((a) => daysLeft(a.deadline) != null && daysLeft(a.deadline) >= 0).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const unpaid = all.filter((a) => !a.feePaid && a.status !== 'Withdrawn').reduce((s, a) => s + (parseFloat(a.fee) || 0), 0);
  const next = upcoming[0];
  const parts = [`${all.length} application${all.length === 1 ? '' : 's'}`, `${active.length} not yet sent`];
  if (next) parts.push(`next deadline ${shortDate(next.deadline)} (${next.school || 'untitled'})`);
  if (unpaid) parts.push(`${money(unpaid)} in fees unpaid`);
  $('#trackerSummary').textContent = parts.join(' · ');
}

function appRow(a) {
  const upd = (k, v) => {
    const t = state.apps.find((x) => x.id === a.id);
    if (!t) return;
    t[k] = v;
    a[k] = v;
    t.updated = Date.now();
    save('apps');
  };
  const txt = (k, ph) => {
    const i = h('input', { type: 'text', placeholder: ph || '', 'aria-label': ph });
    i.value = a[k] || '';
    i.addEventListener('input', () => upd(k, i.value));
    return i;
  };
  const icon = (name) => { const t = document.createElement('template'); t.innerHTML = `<svg class="i"><use href="#i-${name}"/></svg>`; return t.content.firstChild; };

  const urlIn = h('input', { type: 'text', placeholder: 'Link to application', 'aria-label': 'Link' });
  urlIn.value = a.url || '';
  const openLink = h('a', { href: a.url || '#', target: '_blank', rel: 'noopener', title: 'Open', hidden: !a.url }, icon('out'));
  urlIn.addEventListener('input', () => { upd('url', urlIn.value.trim()); openLink.href = urlIn.value.trim() || '#'; openLink.hidden = !urlIn.value.trim(); });

  const date = h('input', { type: 'date', 'aria-label': 'Deadline' });
  date.value = a.deadline || '';
  const left = h('span', {}, dueText(a));
  date.addEventListener('change', () => { upd('deadline', date.value); left.replaceChildren(dueText(a) || ''); renderStats(); });

  const dot = h('span', { class: 'dot ' + (STATUS_COLOR[a.status] || '') });
  const status = h('select', { 'aria-label': 'Status' }, ...statusesFor(typeOf(a)).map((s) => h('option', { value: s }, s)));
  status.value = a.status || statusesFor(typeOf(a))[0];
  status.addEventListener('change', () => { upd('status', status.value); renderTracker(); });

  const type = h('select', { 'aria-label': 'Type' }, h('option', { value: 'college' }, 'College'), h('option', { value: 'job' }, 'Job'));
  type.value = typeOf(a);
  type.addEventListener('change', () => {
    const from = typeOf(a);
    upd('type', type.value);
    const list = statusesFor(type.value);
    if (!list.includes(a.status)) upd('status', list[statusesFor(from).indexOf(a.status)] || list[0]);
    renderTracker();
  });

  const fee = h('input', { type: 'number', min: 0, step: 1, placeholder: '—', 'aria-label': 'Fee' });
  fee.value = a.fee || '';
  fee.addEventListener('input', () => { upd('fee', fee.value); renderStats(); });

  const paid = h('input', { type: 'checkbox', 'aria-label': 'Fee paid' });
  paid.checked = !!a.feePaid;
  paid.addEventListener('change', () => { upd('feePaid', paid.checked); renderStats(); });

  const del = h('button', {
    class: 'icon', title: 'Delete', 'aria-label': 'Delete', onclick: () => {
      if (!confirm(`Delete ${a.school || 'this application'}?`)) return;
      state.apps = state.apps.filter((x) => x.id !== a.id);
      AK.set({ apps: state.apps });
      renderTracker();
    },
  }, icon('x'));

  return h('tr', { class: DONE.has(a.status) ? 'closed' : '' },
    h('td', { class: 'org' }, txt('school', typeOf(a) === 'job' ? 'Company' : 'School'), h('div', { class: 'sub' }, urlIn, openLink)),
    h('td', { class: 'prog' }, txt('program', typeOf(a) === 'job' ? 'Role' : 'Program')),
    h('td', { class: 'type' }, type),
    h('td', { class: 'deadline' }, date, left),
    h('td', { class: 'status' }, h('div', { class: 'st' }, dot, status)),
    h('td', { class: 'fee' }, fee),
    h('td', { class: 'paid' }, paid),
    h('td', { class: 'notes' }, txt('notes', 'Notes')),
    h('td', { class: 'del' }, del),
  );
}

function addApp() {
  const t = typeFilter || (state.settings.audience === 'job' ? 'job' : 'college');
  state.apps.push({ id: AK.newId(), type: t, school: '', program: '', url: '', deadline: '', status: statusesFor(t)[0], fee: '', feePaid: false, notes: '', created: Date.now(), updated: Date.now() });
  AK.set({ apps: state.apps });
  $('#statusFilter').value = '';
  sortKey = 'created'; sortDesc = false;
  renderTracker();
  const rows = $$('#appTable tbody tr');
  rows[rows.length - 1]?.querySelector('input')?.focus();
}

const CSV_COLS = [
  ['type', 'Type'], ['school', 'School / company'], ['program', 'Program / role'], ['url', 'Portal link'], ['deadline', 'Deadline'],
  ['status', 'Status'], ['fee', 'Fee'], ['feePaid', 'Fee paid'], ['notes', 'Notes'],
];

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv() {
  const rows = [CSV_COLS.map((c) => c[1])].concat(state.apps.map((a) => CSV_COLS.map(([k]) => (k === 'feePaid' ? (a.feePaid ? 'Yes' : 'No') : a[k] || ''))));
  download('applykit-tracker.csv', CSV.stringify(rows), 'text/csv');
}

function headerKey(hd) {
  const t = hd.toLowerCase();
  if (/^type$|kind|category/.test(t)) return 'type';
  if (/paid/.test(t)) return 'feePaid';
  if (/fee|cost|price/.test(t)) return 'fee';
  if (/deadline|due/.test(t)) return 'deadline';
  if (/status|stage/.test(t)) return 'status';
  if (/note|comment/.test(t)) return 'notes';
  if (/url|link|portal|website/.test(t)) return 'url';
  if (/program|role|position|degree|department/.test(t)) return 'program';
  if (/school|universit|college|company|institution|employer|name/.test(t)) return 'school';
  return null;
}

async function importCsv(file) {
  const rows = CSV.parse(await file.text());
  if (rows.length < 2) return toast('That file has no rows.');
  const keys = rows[0].map(headerKey);
  if (!keys.includes('school')) return toast('Couldn’t find a School column in that file.');
  let n = 0;
  for (const r of rows.slice(1)) {
    const a = { id: AK.newId(), school: '', program: '', url: '', deadline: '', status: 'Researching', fee: '', feePaid: false, notes: '', created: Date.now(), updated: Date.now() };
    keys.forEach((k, i) => {
      if (!k || r[i] == null) return;
      const v = String(r[i]).trim();
      if (k === 'deadline') {
        const p = AK.parseDate(v);
        a.deadline = p ? `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d || 1).padStart(2, '0')}` : '';
        if (!p && v) a.notes = (a.notes ? a.notes + ' · ' : '') + 'Deadline: ' + v;
      } else if (k === 'fee') a.fee = (v.match(/\d+(\.\d+)?/) || [''])[0];
      else if (k === 'feePaid') a.feePaid = /^(y|yes|true|paid|1|✓|x)$/i.test(v);
      else if (k === 'type') a.type = /job|work|employ|intern/i.test(v) ? 'job' : 'college';
      else if (k === 'status') {
        const i2 = AK.pickOption(ALL_STATUSES.map((s) => ({ text: s, value: s })), v);
        a.status = i2 >= 0 ? ALL_STATUSES[i2] : /not started|todo|planning/i.test(v) ? 'Researching' : 'In progress';
      } else if (k === 'notes') a.notes = a.notes ? v + ' · ' + a.notes : v;
      else if (!a[k]) a[k] = v;
    });
    if (a.school) { state.apps.push(a); n++; }
  }
  await AK.set({ apps: state.apps });
  renderTracker();
  toast(`Imported ${n} application${n === 1 ? '' : 's'}.`);
}

// ---------------------------------------------------------------------------
// Learned wordings
// ---------------------------------------------------------------------------
function renderLearned() {
  const fields = fieldsList();
  const entries = Object.entries(state.aliases).sort((a, b) => (b[1].updated || 0) - (a[1].updated || 0));
  $('#aliasEmpty').hidden = entries.length > 0;
  $('#aliasTable').hidden = entries.length === 0;
  $('#aliasTable tbody').replaceChildren(...entries.map(([sig, a]) => {
    const sel = h('select', {},
      h('option', { value: '__ignore__' }, 'Never suggest anything'),
      ...fields.map((f) => h('option', { value: f.key }, f.label)));
    sel.value = a.key;
    if (sel.value !== a.key) sel.prepend(h('option', { value: a.key }, '(deleted field)')), (sel.value = a.key);
    sel.addEventListener('change', () => {
      state.aliases[sig].key = sel.value;
      state.aliases[sig].updated = Date.now();
      AK.set({ aliases: state.aliases });
      toast('Updated');
    });
    const del = h('button', {
      class: 'text danger', title: 'Forget this wording', onclick: () => {
        delete state.aliases[sig];
        AK.set({ aliases: state.aliases });
        renderLearned();
      },
    }, 'Forget');
    return h('tr', {},
      h('td', {}, h('div', {}, a.label || sig), a.label && AK.normalize(a.label) !== sig ? h('div', { class: 'muted small' }, sig) : null),
      h('td', {}, sel),
      h('td', { class: 'muted small' }, a.host || ''),
      h('td', { class: 'num muted' }, a.count || 1),
      h('td', {}, del));
  }));
}

// ---------------------------------------------------------------------------
// Settings & backup
// ---------------------------------------------------------------------------
function renderSettings() {
  $$('[data-setting]').forEach((cb) => {
    cb.checked = !!state.settings[cb.dataset.setting];
    cb.onchange = () => { state.settings[cb.dataset.setting] = cb.checked; AK.set({ settings: state.settings }); toast('Saved'); };
  });
  const list = state.settings.disabledHosts || [];
  $('#disabledHosts').replaceChildren(...(list.length ? list.map((hst) => h('div', { class: 'srow' }, h('span', {}, hst), h('button', {
    onclick: () => {
      state.settings.disabledHosts = list.filter((x) => x !== hst);
      AK.set({ settings: state.settings });
      renderSettings();
    },
  }, 'Turn back on'))) : [h('div', { class: 'srow muted' }, 'None. To turn ApplyKit off on a website, use the ApplyKit button in your browser toolbar.')]));
}

function exportAll() {
  const data = { app: 'ApplyKit', version: 1, exported: new Date().toISOString(), profile: state.profile, aliases: state.aliases, apps: state.apps, settings: state.settings };
  download(`applykit-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
}

async function importAll(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { return toast('That isn’t a valid backup file.'); }
  if (!data || data.app !== 'ApplyKit') return toast('That isn’t an ApplyKit backup.');
  if (!confirm('Replace your current ApplyKit data with this backup?')) return;
  await AK.set({ profile: data.profile || {}, aliases: data.aliases || {}, apps: data.apps || [], settings: data.settings || {} });
  await reload();
  toast('Backup restored');
}

async function resetAll() {
  if (!confirm('Erase all your answers, tracker entries and learned wordings? This can’t be undone.\n\nTip: download a backup first.')) return;
  await new Promise((r) => chrome.storage.local.clear(r));
  await reload();
  toast('All data erased');
}

// ---------------------------------------------------------------------------
async function reload() {
  state = await AK.load();
  Profile.render();
  renderTracker();
  renderLearned();
  renderSettings();
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  const fresh = await AK.load();
  const focusIn = (sel) => document.activeElement && document.activeElement.closest(sel);
  if (changes.aliases) { state.aliases = fresh.aliases; renderLearned(); }
  if (changes.apps && !focusIn('[data-panel="tracker"]')) { state.apps = fresh.apps; renderTracker(); }
  if (changes.profile && !focusIn('[data-panel="profile"]')) { state.profile = fresh.profile; Profile.render(); }
  if (changes.settings) { state.settings = fresh.settings; renderSettings(); }
});

async function init() {
  state = await AK.load();
  Profile.init();
  typeFilter = state.settings.audience === 'both' ? '' : state.settings.audience || '';
  await reload();
  $$('#typeFilter button').forEach((b) => b.addEventListener('click', () => { typeFilter = b.dataset.type; $('#statusFilter').value = ''; renderTracker(); }));
  showTab();

  $('#welcomeOk').onclick = () => { $('#welcome').hidden = true; history.replaceState(null, '', '#profile'); };
  $('#addApp').onclick = addApp;
  $('#statusFilter').onchange = renderTracker;
  $('#exportCsv').onclick = exportCsv;
  $('#importCsv').onchange = (e) => { if (e.target.files[0]) importCsv(e.target.files[0]); e.target.value = ''; };
  $('#exportAll').onclick = exportAll;
  $('#importAll').onchange = (e) => { if (e.target.files[0]) importAll(e.target.files[0]); e.target.value = ''; };
  $('#resetAll').onclick = resetAll;
  $$('#appTable th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    if (sortKey === th.dataset.sort) sortDesc = !sortDesc; else { sortKey = th.dataset.sort; sortDesc = false; }
    renderTracker();
  }));
}

init();
