// Run with: node test/matcher.test.js
const assert = require('assert');
require('../src/shared/choices.js');
require('../src/shared/fields.js');
require('../src/shared/matcher.js');
const AK = globalThis.AK;
const fields = AK.prepareFields(AK.DEFAULT_FIELDS.concat(AK.listFields()));

function m(label, extra = {}) {
  const sig = AK.normalize(label);
  const texts = [{ text: sig, weight: 1 }];
  if (extra.name) texts.push({ text: AK.normalize(extra.name), weight: 0.8 });
  const r = AK.matchField({ signature: sig, texts, type: extra.type, autocomplete: extra.ac, kind: extra.kind, context: AK.normalize(extra.ctx || '') }, fields, extra.aliases);
  return r ? r.key : null;
}

const cases = [
  ['First Name', 'firstName'],
  ['Legal First Name *', 'firstName'],
  ['Given name(s)', 'firstName'],
  ['Surname / Family name', 'lastName'],
  ['Last name', 'lastName'],
  ['Name', 'fullName'],
  ['Full legal name', 'fullName'],
  ['E-mail address', 'email'],
  ['Email', 'email'],
  ['Mobile phone number', 'phone'],
  ['Street Address', 'address1'],
  ['Address Line 2', 'address2'],
  ['ZIP/Postal Code', 'postalCode'],
  ['State/Province', 'state'],
  ['Country of Citizenship', 'citizenship'],
  ['Country', 'country'],
  ['Country of birth', 'birthCountry'],
  ['Date of Birth (MM/DD/YYYY)', 'dob'],
  ['Cumulative GPA', 'education.gpa'],
  ['Name of institution', 'education.school'],
  ['Name of college or university attended', 'education.school'],
  ['Degree', 'education.degree'],
  ['Employer', 'work.employer'],
  ['Job title', 'work.title'],
  ['Title', null],
  ['Start date', null],
  ['Start date', 'education.start', { ctx: 'Education' }],
  ['Start date', 'work.start', { ctx: 'Employment history' }],
  ['City', 'city'],
  ['City', 'education.city', { ctx: 'Education 2' }],
  ['Name', 'references.name', { ctx: 'Recommenders' }],
  ['Email', 'references.email', { ctx: 'Reference 1' }],
  ['Email', 'email', { ctx: 'Contact information' }],
  ['Position applied for', null],
  ['I currently work here', 'work.current', { kind: 'checkbox', ctx: 'Work experience' }],
  ['Current employer', 'work.employer'],
  ['Are you legally authorized to work in the United States?', 'workAuthorized'],
  ['Will you now or in the future require sponsorship for employment visa status?', 'needSponsorship'],
  ['Expected compensation', 'salary'],
  ['LinkedIn Profile URL', 'linkedin'],
  ['Research interests', 'researchInterests'],
  ['GRE Quantitative score', 'greQuant'],
  ['Personal statement', null],
  ['Recommender name', 'references.name'],
  ['Recommender email', 'references.email', { type: 'email' }],
  ['Recommender phone', 'references.phone'],
  ['Emergency contact phone', null, { type: 'tel' }],
  ['Employer address', null],
  ['What is your favourite colour?', null],
];

let fail = 0;
for (const [label, want, extra] of cases) {
  const got = m(label, extra);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(label)} -> ${got} ${ok ? '' : '(want ' + want + ')'}`);
}

// autocomplete wins
assert.strictEqual(m('Field 7', { ac: 'family-name' }), 'lastName');
// learned alias wins over heuristic, and __ignore__ suppresses
assert.strictEqual(m('Apellido', { aliases: { apellido: { key: 'lastName' } } }), 'lastName');
assert.strictEqual(m('First name', { aliases: { 'first name': { key: '__ignore__' } } }), null);

// options
const opts = (arr) => arr.map((t) => ({ text: t, value: t }));
assert.strictEqual(AK.pickOption(opts(['Select...', 'Illinois', 'Indiana', 'Iowa']), 'IN'), 2);
assert.strictEqual(AK.pickOption(opts(['--', 'Canada', 'United States of America']), 'United States'), 2);
assert.strictEqual(AK.pickOption(opts(['Select', "Bachelor's Degree", "Master's Degree", 'Doctorate']), 'Master of Science (M.S.)'), 2);
assert.strictEqual(AK.pickOption(opts(['Select', "Bachelor's Degree", "Master's Degree", 'Doctorate']), 'Doctor of Philosophy (Ph.D.)'), 3);
assert.strictEqual(AK.pickOption(opts(['Select', 'Male', 'Female', 'Decline to self-identify']), 'Prefer not to say'), 3);
assert.strictEqual(AK.pickOption(opts(['Month', 'January', 'February', 'March', 'April', 'May']), '05'), 5);
assert.strictEqual(AK.pickOption(opts(['', '+1', '+44', '+91']), 'United States (+1)'), 1);
assert.strictEqual(AK.pickOption(opts(['', 'Male', 'Female', 'Non-binary']), 'M'), 1);
assert.strictEqual(AK.pickOption(opts(['', 'Fall 2027', 'Spring 2027']), 'Fall 2027'), 1);
assert.strictEqual(AK.pickOption([{ text: 'Choose', value: '' }, { text: 'Canada', value: 'CA' }], 'Canada'), 1);

// dates
assert.strictEqual(AK.formatDateFor('1999-04-07', 'date', ''), '1999-04-07');
assert.strictEqual(AK.formatDateFor('1999-04-07', 'text', 'MM/DD/YYYY'), '04/07/1999');
assert.strictEqual(AK.formatDateFor('04/07/1999', 'date', ''), '1999-04-07');
assert.strictEqual(AK.formatDateFor('2026-05', 'month', ''), '2026-05');

if (fail) {
  console.log(`\n${fail} matching case(s) failed`);
  process.exit(1);
}
console.log('\nAll matcher tests passed');

// runner-up with a value, but never across a big gap
{
  const sig = AK.normalize('GitHub or portfolio URL');
  const hv = (k) => k === 'github';
  assert.strictEqual(AK.matchField({ signature: sig, texts: [{ text: sig, weight: 1 }] }, fields, {}, hv).key, 'github');
  const sig2 = AK.normalize('Middle name');
  const r = AK.matchField({ signature: sig2, texts: [{ text: sig2, weight: 1 }] }, fields, {}, (k) => k === 'fullName');
  assert.strictEqual(r.key, 'middleName');
  assert.strictEqual(m('Anticipated graduation (MM/DD/YYYY)'), 'education.end');
  console.log('fallback tests passed');
}
