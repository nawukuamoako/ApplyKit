// End-to-end test: loads the unpacked extension in Chrome and drives the sample forms.
// Usage: node test/e2e.mjs  (serves test/forms on :8765 itself)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'test', 'out');
fs.mkdirSync(out, { recursive: true });

const server = http.createServer((req, res) => {
  const f = path.join(root, 'test', 'forms', decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  fs.createReadStream(f).pipe(res);
}).listen(8765);

const ctx = await chromium.launchPersistentContext('', {
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: true,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--no-sandbox'],
  viewport: { width: 1100, height: 900 },
});

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
console.log('extension id', extId);

// Seed a fake profile through the options page
const opt = await ctx.newPage();
await opt.goto(`chrome-extension://${extId}/src/options/options.html#profile`);
await opt.evaluate(() => new Promise((r) => chrome.storage.local.set({
  profile: {
    values: {
      firstName: 'Sam', lastName: 'Rivera', preferredName: 'Sam', email: 'sam.rivera@example.com', phoneCountryCode: 'United States (+1)', phone: '555-0100',
      address1: '12 Elm Street', city: 'Springfield', state: 'Illinois', postalCode: '62701', country: 'United States',
      dob: '1999-04-07', gender: 'Prefer not to say', citizenship: 'Canada',
      linkedin: 'https://linkedin.com/in/sam-example', github: 'https://github.com/sam-example',
      researchInterests: 'Machine learning for health data', salary: '95000',
      workAuthorized: 'Yes', needSponsorship: 'No', workMode: 'Remote, Hybrid',
    },
    lists: {
      education: [
        { id: 'e1', school: 'Central State University', degree: 'Master of Science (M.S.)', gpa: '3.85', gpaScale: '4.0', start: '2024-08', end: '2026-05', city: 'Springfield' },
        { id: 'e2', school: 'Riverside College', degree: 'Bachelor of Arts (B.A.)', gpa: '3.5', start: '2018-09', end: '2022-06', city: 'Riverside' },
      ],
      work: [
        { id: 'w1', employer: 'Acme Analytics', title: 'Data Analyst', start: '2022-07', current: 'true' },
        { id: 'w2', employer: 'City Library', title: 'Assistant', start: '2020-01', end: '2022-05' },
        { id: 'w3', employer: 'Corner Cafe', title: 'Barista', start: '2018-06', end: '2019-12' },
      ],
      references: [{ id: 'r1', name: 'Dr. Pat Morgan', email: 'pmorgan@example.edu' }],
    },
    custom: [], hidden: [],
  },
  aliases: {}, apps: [],
}, r)));

const page = await ctx.newPage();
const results = [];
const check = (name, ok, extra = '') => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };

// ---- Graduate form ----
await page.goto('http://localhost:8765/graduate-application.html');
await page.waitForTimeout(800);
await page.click('#f1');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(out, '1-suggestion.png'), clip: { x: 0, y: 60, width: 800, height: 420 } });

// Arrow down to first item (fill this field) and press Enter
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
check('single fill via pop-up', (await page.inputValue('#f1')) === 'Sam');

// Fill all from the pop-up: focus a matched field, ArrowDown x2 → "Fill N fields"
await page.click('#f2');
await page.waitForTimeout(400);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await page.waitForTimeout(500);

const v = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  return {
    last: q('#f2').value, pref: q('#f3').value, dob: q('#f4').value,
    sex: (document.querySelector('input[name=sex]:checked') || {}).value,
    cit: q('#cit').value, email: q('[name=contact_em]').value, phone: q('[name=contact_ph]').value,
    addr: q('[name=addr]').value, city: q('[name=city]').value, st: q('#st').value, zip: q('#zip').value,
    school: q('#u1').value, gpa: q('#u2').value, grad: q('#u3').value,
    recName: q('#r1').value, recEmail: q('#r2').value, ssn: q('#p3').value, fav: q('#p4').value,
    preview: JSON.parse(q('#preview').textContent),
  };
});
console.log(v);
check('Surname (as shown on passport) → last name', v.last === 'Rivera');
check('preferred name', v.pref === 'Sam');
check('date input formatted', v.dob === '1999-04-07');
check('radio Sex left alone (no matching option)', v.sex === undefined);
check('select citizenship Canada', v.cit === 'CA');
check('table-layout email', v.email === 'sam.rivera@example.com');
check('table-layout cell phone', v.phone === '555-0100');
check('placeholder-only street', v.addr === '12 Elm Street');
check('placeholder-only city', v.city === 'Springfield');
check('state select Illinois → IL', v.st === 'IL');
check('zip', v.zip === '62701');
check('school (first education entry)', v.school === 'Central State University');
check('gpa', v.gpa === '3.85');
check('MM/DD/YYYY text date', v.grad === '05/01/2026');
check('recommender name from references', v.recName === 'Dr. Pat Morgan');
check('recommender email from references, never your own', v.recEmail === 'pmorgan@example.edu');
check('SSN left empty', v.ssn === '');
check('unknown question left empty', v.fav === '');
check('page JS saw the values (framework events)', v.preview.field_1002 === 'Rivera' && v.preview.st === 'IL');
await page.screenshot({ path: path.join(out, '2-filled.png'), fullPage: true });

// ---- Learning: type a saved answer into a field ApplyKit didn't recognise ----
await page.click('#p1');
await page.keyboard.type('Machine learning for health data');
await page.click('#p4'); // blur → change
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(out, '3-learned-toast.png') });
check('research focus recognised as research interests', true);


// ---- Offer to save a brand-new answer ----
await page.keyboard.type('Python');
await page.click('#u2');
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(out, '4-save-bubble.png'), clip: { x: 0, y: 0, width: 1100, height: 900 } });

// Reload: the learned wording should now be suggested
await page.reload();
await page.waitForTimeout(800);
await page.click('#p1');
await page.waitForTimeout(400);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
check('learned wording filled on next visit', (await page.inputValue('#p1')) === 'Machine learning for health data');

// ---- Job form: aria-label, autocomplete, shadow DOM, iframe ----
await page.goto('http://localhost:8765/job-application.html');
await page.waitForTimeout(1000);
await page.locator('input[aria-label="First name"]').click();
await page.waitForTimeout(400);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
const j = await page.evaluate(() => {
  const ins = document.querySelectorAll('input');
  const shadowVals = Array.from(document.querySelectorAll('fancy-input')).map((f) => f.shadowRoot.querySelector('input').value);
  return { first: ins[0].value, last: ins[1].value, li: ins[2].value, gh: ins[3].value, shadow: shadowVals };
});
console.log(j);
check('aria-label first', j.first === 'Sam');
check('autocomplete last', j.last === 'Rivera');
check('aria-labelledby LinkedIn', j.li === 'https://linkedin.com/in/sam-example');
check('GitHub or portfolio', j.gh === 'https://github.com/sam-example');
check('shadow DOM company', j.shadow[0] === 'Acme Analytics');
check('shadow DOM phone', j.shadow[1] === '555-0100');

// iframe: fill from inside the frame
const frame = page.frames().find((f) => f.url().includes('embedded.html'));
await frame.click('input[name=email]');
await page.waitForTimeout(400);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
const fr = { email: await frame.inputValue('[name=email]'), city: await frame.inputValue('[name=loc_city]'), sal: await frame.inputValue('[name=salary]') };
console.log(fr);
check('iframe email/city/salary', fr.email === 'sam.rivera@example.com' && fr.city === 'Springfield' && fr.sal === '95000');
await page.screenshot({ path: path.join(out, '5-job.png'), fullPage: true });

// ---- Repeated sections: education / work / references ----
await page.goto('http://localhost:8765/job-history.html');
await page.waitForTimeout(800);
await page.click('#fn');
await page.waitForTimeout(400);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
const jh = await page.evaluate(() => {
  const all = (sel) => Array.from(document.querySelectorAll(sel)).map((e) => (e.type === 'checkbox' ? e.checked : e.value));
  const q = (s) => document.querySelector(s);
  return {
    pos: q('#pos').value, sal: q('#sal').value, fn: q('#fn').value, cc: q('#cc').value, ph: q('#ph').value, pcity: q('#pcity').value,
    school: all('.school'), degree: all('.degree'), ecity: all('.ecity'), smonth: all('.smonth'), syear: all('.syear'), end: all('.end'),
    co: all('.co'), ti: all('.ti'), cur: all('.cur'), rn: q('#rn').value, re: q('#re').value,
    auth: (document.querySelector('input[name=auth]:checked') || {}).value, spon: (document.querySelector('input[name=spon]:checked') || {}).value,
    wm: all('.wm'), gen: q('#gen').value,
  };
});
console.log(jh);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check('"Position applied for" left empty', jh.pos === '');
check('salutation "Title" left empty', jh.sal === '');
check('personal fields', jh.fn === 'Sam' && jh.ph === '555-0100' && jh.pcity === 'Springfield');
check('country code select +1', jh.cc === '+1');
check('two schools in order', eq(jh.school, ['Central State University', 'Riverside College']));
check('degree by meaning', eq(jh.degree, ["Master's Degree", "Bachelor's Degree"]));
check('school city uses education entry, not home city', eq(jh.ecity, ['Springfield', 'Riverside']));
check('split month select + year box', eq(jh.smonth, ['August', 'September']) && eq(jh.syear, ['2024', '2018']));
check('MM/YYYY end date', eq(jh.end, ['05/2026', '06/2022']));
check('two employers by "Employer 1/2"', eq(jh.co, ['Acme Analytics', 'City Library']) && eq(jh.ti, ['Data Analyst', 'Assistant']));
check('"I currently work here" only on current job', eq(jh.cur, [true, false]));
check('reference name/email from references, not you', jh.rn === 'Dr. Pat Morgan' && jh.re === 'pmorgan@example.edu');
check('yes/no radios', jh.auth === 'yes' && jh.spon === 'no');
check('work arrangement checkboxes', eq(jh.wm, [true, true, false]));
check('"Prefer not to say" → "Decline to self-identify"', jh.gen === 'Decline to self-identify');
await page.screenshot({ path: path.join(out, 'multi-entry.png'), fullPage: true });

// ---- Options page screenshots ----
await opt.evaluate(() => new Promise((r) => chrome.storage.local.set({ apps: [
  { id: 'a1', type: 'job', school: 'Harbor Health', program: 'Data Analyst II', url: 'https://jobs.example.com/1', deadline: '2026-11-30', status: 'Applied', fee: '', feePaid: false, notes: '' },
  { id: 'a2', type: 'college', school: 'Eastbrook University', program: 'MS Biostatistics', url: '', deadline: '2026-12-15', status: 'In progress', fee: '90', feePaid: false, notes: 'Two letters requested' },
  { id: 'a3', type: 'job', school: 'Cobalt Logistics', program: 'Analytics Engineer', url: '', deadline: '2026-11-24', status: 'Saved', fee: '', feePaid: false, notes: '' },
  { id: 'a4', type: 'college', school: 'Northfield State University', program: 'PhD Data Science', url: '', deadline: '2027-01-15', status: 'Researching', fee: '65', feePaid: true, notes: '' },
] }, r)));
await opt.setViewportSize({ width: 1300, height: 820 });
await opt.goto(`chrome-extension://${extId}/src/options/options.html#tracker`);
await opt.waitForTimeout(500);
await opt.screenshot({ path: path.join(out, '6-tracker.png') });
await opt.goto(`chrome-extension://${extId}/src/options/options.html#learned`);
await opt.waitForTimeout(400);
await opt.screenshot({ path: path.join(out, '7-learned.png') });
await opt.goto(`chrome-extension://${extId}/src/options/options.html#profile`);
await opt.waitForTimeout(400);
await opt.screenshot({ path: path.join(out, '8-profile.png') });
await opt.goto(`chrome-extension://${extId}/src/popup/popup.html`);
await opt.setViewportSize({ width: 384, height: 520 });
await opt.waitForTimeout(600);
await opt.screenshot({ path: path.join(out, '9-popup.png') });

const errs = [];
await ctx.close();
server.close();
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
