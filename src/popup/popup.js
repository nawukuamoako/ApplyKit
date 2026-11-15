const $ = (id) => document.getElementById(id);
const CONTENT_FILES = ['src/shared/choices.js', 'src/shared/fields.js', 'src/shared/matcher.js', 'src/shared/storage.js', 'src/content/dom.js', 'src/content/content.js'];

let tab, host, state, app, type = 'college';

async function inFrames(func) {
  const res = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func });
  return Promise.all(res.map((r) => r.result));
}

/** Pages opened before ApplyKit was installed don't have the content script yet. */
async function ensureInjected() {
  const has = await inFrames(() => !!window.__AK_API);
  if (has.every(Boolean)) return;
  await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: CONTENT_FILES });
}

async function refreshStats() {
  try {
    await ensureInjected();
    const all = await inFrames(() => (window.__AK_API ? window.__AK_API.stats() : null));
    const s = all.filter(Boolean).reduce((a, b) => ({ fields: a.fields + b.fields, matched: a.matched + b.matched, fillable: a.fillable + b.fillable }), { fields: 0, matched: 0, fillable: 0 });
    const hasAnswers = Object.values(state.profile.values || {}).some((v) => v && String(v).trim()) || Object.values(state.profile.lists || {}).some((l) => l.length);
    if (!hasAnswers) {
      $('statLine').textContent = 'No saved answers yet';
      $('statSub').innerHTML = '<a id="setup">Add your answers</a> to start filling forms.';
      $('setup').onclick = () => openOptions('profile');
      $('fillBtn').disabled = true;
    } else if (!s.fields) {
      $('statLine').textContent = 'No form on this page';
      $('statSub').textContent = 'Open an application to fill it in.';
      $('fillBtn').disabled = true;
    } else {
      $('statLine').textContent = s.fillable ? `${s.fillable} field${s.fillable === 1 ? '' : 's'} ready to fill` : 'Nothing left to fill';
      $('statSub').textContent = `ApplyKit recognises ${s.matched} of ${s.fields} fields here.`;
      $('fillBtn').disabled = !s.fillable;
    }
  } catch (e) {
    $('statLine').textContent = "Can't fill this page";
    $('statSub').textContent = 'Browsers block extensions on their own settings pages and stores.';
    $('fillBtn').disabled = true;
  }
}

function openOptions(hash) {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html#' + (hash || 'profile')) });
  window.close();
}

function guessName(title) {
  const parts = String(title || '').split(/\s[|\-–—:]\s/).map((s) => s.trim()).filter(Boolean);
  const pick = parts.find((p) => /universit|college|institute|school|academy/i.test(p)) || parts[parts.length - 1] || '';
  return pick.slice(0, 80);
}

function setType(t, keepStatus) {
  type = t;
  document.querySelectorAll('#aType button').forEach((b) => b.classList.toggle('on', b.dataset.type === t));
  $('lSchool').textContent = t === 'job' ? 'Company' : 'School';
  $('lProgram').textContent = t === 'job' ? 'Role' : 'Program';
  const sel = $('aStatus');
  const prev = sel.value;
  sel.replaceChildren(...AK.STATUSES[t].map((s) => new Option(s, s)));
  sel.value = keepStatus && AK.STATUSES[t].includes(prev) ? prev : (t === 'job' ? 'Applied' : 'In progress');
}

function renderApp() {
  app = state.apps.find((a) => a.url && AK.hostOf(a.url) === host);
  if (app) {
    $('appTitle').textContent = 'You are tracking this application';
    setType(app.type || 'college');
    $('aSchool').value = app.school || '';
    $('aProgram').value = app.program || '';
    $('aDeadline').value = app.deadline || '';
    $('aStatus').value = app.status;
    $('appSave').textContent = 'Save';
  } else {
    setType(state.settings.audience === 'job' ? 'job' : 'college');
    $('aSchool').value = guessName(tab.title);
    $('appSave').textContent = 'Add';
  }
}

async function saveApp() {
  const fields = {
    type,
    school: $('aSchool').value.trim() || host,
    program: $('aProgram').value.trim(),
    deadline: $('aDeadline').value,
    status: $('aStatus').value,
  };
  await AK.update('apps', (apps) => {
    if (app) {
      const a = apps.find((x) => x.id === app.id);
      if (a) Object.assign(a, fields, { updated: Date.now() });
    } else {
      apps.push({ id: AK.newId(), url: tab.url, fee: '', feePaid: false, notes: '', created: Date.now(), updated: Date.now(), ...fields });
    }
    return apps;
  });
  state = await AK.load();
  renderApp();
  $('appSaved').textContent = 'Saved';
  setTimeout(() => ($('appSaved').textContent = ''), 1800);
}

async function main() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  host = AK.hostOf(tab.url || '');
  $('host').textContent = host || 'This page';
  state = await AK.load();
  $('pause').checked = (state.settings.disabledHosts || []).includes(host);
  renderApp();
  refreshStats();

  document.querySelectorAll('#aType button').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); setType(b.dataset.type, true); }));
  $('openOptions').onclick = () => openOptions('profile');
  $('openTracker').onclick = () => openOptions('tracker');
  $('appSave').onclick = saveApp;
  $('fillBtn').onclick = async () => {
    $('fillBtn').disabled = true;
    const res = await inFrames(() => (window.__AK_API ? window.__AK_API.fillAll() : { filled: 0 }));
    const n = res.reduce((a, r) => a + ((r && r.filled) || 0), 0);
    $('statLine').textContent = `Filled ${n} field${n === 1 ? '' : 's'}`;
    $('statSub').textContent = 'Check them before you submit.';
  };
  $('pause').onchange = async () => {
    await AK.update('settings', (s) => {
      const set = new Set(s.disabledHosts || []);
      if ($('pause').checked) set.add(host); else set.delete(host);
      s.disabledHosts = Array.from(set);
      return s;
    });
  };
}

main();
