/*
 * ApplyKit — the answer schema.
 *
 * SECTIONS   the cards on the "My answers" page, in order.
 * DEFAULT_FIELDS  single answers (one value each).
 * LISTS      repeatable sections (education, work, references, ...). Each
 *            entry has the same sub-fields; forms that ask for "School 2" or
 *            repeat a block get the 2nd entry.
 *
 * Field properties:
 *   key, label, group (section id), synonyms (phrases forms use)
 *   input     text | email | tel | url | number | date | month | textarea |
 *             select | yesno | chips | country | state
 *   choices   key into AK.CHOICES for select / yesno / chips
 *   width     'full' | 'half' (default) | 'third'
 *   audience  'college' | 'job'   (omit = both)
 *   autocomplete  HTML autocomplete tokens that identify the field
 */
(function (global) {
  const F = (key, label, group, synonyms, extra = {}) => ({ key, label, group, synonyms, input: 'text', ...extra });

  const SECTIONS = [
    { id: 'personal', title: 'Personal details', short: 'Personal' },
    { id: 'contact', title: 'Contact', short: 'Contact' },
    { id: 'address', title: 'Address', short: 'Address' },
    { id: 'education', title: 'Education', short: 'Education', list: true, desc: 'Most recent first. When a form asks for more than one school, the second block gets your second entry, and so on.' },
    { id: 'work', title: 'Work experience', short: 'Work experience', list: true, desc: 'Jobs, internships and assistantships, most recent first.' },
    { id: 'college', title: 'College and graduate applications', short: 'Program details', audience: 'college' },
    { id: 'tests', title: 'Test scores', short: 'Test scores', audience: 'college' },
    { id: 'jobprefs', title: 'Job preferences and eligibility', short: 'Job preferences', audience: 'job' },
    { id: 'links', title: 'Links', short: 'Links' },
    { id: 'references', title: 'References and recommenders', short: 'References', list: true },
    { id: 'certs', title: 'Certifications and licenses', short: 'Certifications', list: true, audience: 'job' },
    { id: 'languages', title: 'Languages', short: 'Languages', list: true },
    { id: 'eeo', title: 'Voluntary self-identification', short: 'Self-identification', audience: 'job', desc: 'Optional questions that many U.S. employers ask. Leave these blank and ApplyKit won’t answer them for you.' },
    { id: 'answers', title: 'Other answers', short: 'Other answers', desc: 'Longer answers you reuse, and new answers ApplyKit saves while you fill in forms.' },
  ];

  const DEFAULT_FIELDS = [
    // ---- Personal ----
    F('firstName', 'First name', 'personal', ['first name', 'given name', 'forename', 'fname', 'first', 'legal first name', 'given names'], { autocomplete: ['given-name'], width: 'third' }),
    F('middleName', 'Middle name', 'personal', ['middle name', 'middle initial', 'mname', 'middle'], { autocomplete: ['additional-name'], width: 'third' }),
    F('lastName', 'Last name', 'personal', ['last name', 'surname', 'family name', 'lname', 'last', 'legal last name', 'family names'], { autocomplete: ['family-name'], width: 'third' }),
    F('fullName', 'Full name', 'personal', ['full name', 'legal name', 'your name', 'name', 'applicant name', 'full legal name', 'complete name'], { autocomplete: ['name'], placeholder: 'Uses first and last name if empty' }),
    F('preferredName', 'Preferred name', 'personal', ['preferred name', 'preferred first name', 'nickname', 'chosen name', 'name you go by'], { width: 'third' }),
    F('pronouns', 'Pronouns', 'personal', ['pronouns', 'preferred pronouns', 'personal pronouns'], { input: 'select', choices: 'pronouns', width: 'third' }),
    F('formerName', 'Former / other names', 'personal', ['former name', 'previous name', 'maiden name', 'other names', 'alias', 'other last names used'], { width: 'third' }),
    F('dob', 'Date of birth', 'personal', ['date of birth', 'birth date', 'birthdate', 'dob', 'birthday'], { autocomplete: ['bday'], input: 'date', width: 'third' }),
    F('gender', 'Gender', 'personal', ['gender', 'sex', 'gender identity', 'legal sex'], { autocomplete: ['sex'], input: 'select', choices: 'gender', width: 'third' }),
    F('citizenship', 'Citizenship', 'personal', ['citizenship', 'country of citizenship', 'nationality', 'citizen of', 'citizenship country'], { input: 'country', width: 'third' }),
    F('birthCountry', 'Country of birth', 'personal', ['country of birth', 'birth country', 'place of birth', 'born in'], { input: 'country', width: 'third' }),
    F('visaStatus', 'Residency / visa status', 'personal', ['visa status', 'visa type', 'immigration status', 'residency status', 'citizenship status', 'us residency status'], { input: 'select', choices: 'visaStatus' }),

    // ---- Contact ----
    F('email', 'Email', 'contact', ['email', 'email address', 'e mail', 'primary email', 'contact email', 'personal email'], { autocomplete: ['email'], type: 'email', input: 'email' }),
    F('phoneCountryCode', 'Country code', 'contact', ['country code', 'dialing code', 'phone country code'], { autocomplete: ['tel-country-code'], input: 'select', choices: 'dialCode', width: 'third' }),
    F('phone', 'Phone', 'contact', ['phone', 'phone number', 'telephone', 'mobile', 'mobile number', 'cell', 'cell phone', 'primary phone', 'contact number', 'tel'], { autocomplete: ['tel', 'tel-national'], type: 'tel', input: 'tel', before: ['phoneCountryCode'] }),

    // ---- Address ----
    F('address1', 'Street address', 'address', ['address', 'street address', 'address line 1', 'address 1', 'street', 'mailing address', 'permanent address', 'home address', 'street line 1', 'addr1'], { autocomplete: ['address-line1', 'street-address'] }),
    F('address2', 'Apt, suite, unit', 'address', ['address line 2', 'address 2', 'apartment', 'apt', 'suite', 'unit', 'street line 2', 'addr2', 'apt suite unit'], { autocomplete: ['address-line2'] }),
    F('city', 'City', 'address', ['city', 'town', 'city town', 'municipality', 'locality'], { autocomplete: ['address-level2'], width: 'third' }),
    F('state', 'State / province', 'address', ['state', 'province', 'state province', 'region', 'state province region', 'county'], { autocomplete: ['address-level1'], input: 'state', width: 'third' }),
    F('postalCode', 'ZIP / postal code', 'address', ['zip', 'zip code', 'postal code', 'postcode', 'zipcode', 'postal'], { autocomplete: ['postal-code'], width: 'third' }),
    F('country', 'Country', 'address', ['country', 'country of residence', 'current country', 'country region'], { autocomplete: ['country', 'country-name'], input: 'country' }),

    // ---- College / grad ----
    F('degreeSought', 'Degree you are applying for', 'college', ['degree sought', 'intended degree', 'degree objective', 'degree applying for', 'program level'], { input: 'select', choices: 'degreeSought', audience: 'college' }),
    F('startTerm', 'Intended start term', 'college', ['start term', 'entry term', 'intended start', 'term of entry', 'admit term', 'term', 'semester of entry', 'intended term', 'anticipated start'], { input: 'select', choices: 'startTerm', audience: 'college' }),
    F('researchInterests', 'Research interests', 'college', ['research interests', 'research interest', 'areas of interest', 'research area', 'area of interest', 'research areas', 'fields of interest', 'research focus'], { input: 'textarea', width: 'full', audience: 'college' }),
    F('facultyInterest', 'Faculty you want to work with', 'college', ['faculty of interest', 'faculty interest', 'potential advisors', 'faculty members', 'preferred advisor', 'faculty you would like to work with', 'potential faculty'], { audience: 'college', placeholder: 'Names, separated by commas' }),
    F('fundingNeeded', 'Applying for funding / assistantship?', 'college', ['funding', 'financial aid', 'assistantship', 'apply for funding', 'consider for assistantship', 'fellowship consideration'], { input: 'yesno', choices: 'yesNo', audience: 'college' }),

    // ---- Tests ----
    F('greVerbal', 'GRE Verbal', 'tests', ['gre verbal', 'verbal reasoning', 'verbal score', 'gre v'], { input: 'number', min: 130, max: 170, width: 'third', audience: 'college' }),
    F('greQuant', 'GRE Quantitative', 'tests', ['gre quantitative', 'quantitative reasoning', 'quant score', 'quantitative score', 'gre q'], { input: 'number', min: 130, max: 170, width: 'third', audience: 'college' }),
    F('greAW', 'GRE Analytical Writing', 'tests', ['gre analytical writing', 'analytical writing', 'writing score', 'gre aw'], { input: 'number', min: 0, max: 6, step: 0.5, width: 'third', audience: 'college' }),
    F('greDate', 'GRE test date', 'tests', ['gre test date', 'gre date', 'date of gre'], { input: 'date', width: 'third', audience: 'college' }),
    F('gmat', 'GMAT total', 'tests', ['gmat', 'gmat total', 'gmat score'], { input: 'number', min: 205, max: 805, width: 'third', audience: 'college' }),
    F('toefl', 'TOEFL iBT total', 'tests', ['toefl', 'toefl total', 'toefl score', 'toefl ibt'], { input: 'number', min: 0, max: 120, width: 'third', audience: 'college' }),
    F('ielts', 'IELTS overall band', 'tests', ['ielts', 'ielts overall', 'ielts score', 'ielts band'], { input: 'number', min: 0, max: 9, step: 0.5, width: 'third', audience: 'college' }),
    F('duolingo', 'Duolingo English Test', 'tests', ['duolingo', 'det score', 'duolingo english test'], { input: 'number', min: 10, max: 160, width: 'third', audience: 'college' }),
    F('englishTestDate', 'English test date', 'tests', ['toefl date', 'ielts date', 'english test date', 'english proficiency test date'], { input: 'date', width: 'third', audience: 'college' }),

    // ---- Job preferences ----
    F('workAuthorized', 'Legally authorized to work in the U.S.?', 'jobprefs', ['authorized to work', 'legally authorized', 'work authorization', 'eligible to work', 'right to work', 'legally eligible'], { input: 'yesno', choices: 'yesNo', audience: 'job' }),
    F('needSponsorship', 'Will you need visa sponsorship?', 'jobprefs', ['sponsorship', 'require sponsorship', 'visa sponsorship', 'need sponsorship', 'employment visa status'], { input: 'yesno', choices: 'yesNo', audience: 'job' }),
    F('willingRelocate', 'Willing to relocate?', 'jobprefs', ['relocate', 'willing to relocate', 'relocation', 'open to relocation'], { input: 'yesno', choices: 'relocate', audience: 'job' }),
    F('workMode', 'Work arrangement', 'jobprefs', ['work arrangement', 'remote', 'hybrid', 'on site', 'onsite', 'in office', 'work location preference', 'remote or onsite', 'work model', 'workplace type', 'preferred work arrangement'], { input: 'chips', choices: 'workMode', audience: 'job' }),
    F('desiredType', 'Looking for', 'jobprefs', ['employment type', 'job type', 'position type', 'type of employment', 'desired employment type'], { input: 'select', choices: 'employmentType', width: 'third', audience: 'job' }),
    F('availableFrom', 'Available to start', 'jobprefs', ['available start date', 'start date availability', 'earliest start date', 'when can you start', 'availability date', 'date available'], { input: 'date', width: 'third', audience: 'job' }),
    F('noticePeriod', 'Notice period', 'jobprefs', ['notice period', 'notice required', 'how much notice'], { input: 'select', choices: 'noticePeriod', width: 'third', audience: 'job' }),
    F('salary', 'Desired salary', 'jobprefs', ['desired salary', 'salary expectation', 'expected salary', 'salary requirements', 'compensation expectations', 'desired pay', 'expected compensation'], { input: 'number', min: 0, step: 1000, audience: 'job', after: ['salaryCurrency', 'salaryPeriod'] }),
    F('salaryCurrency', 'Currency', 'jobprefs', ['currency', 'salary currency'], { input: 'select', choices: 'currency', width: 'third', audience: 'job' }),
    F('salaryPeriod', 'Pay period', 'jobprefs', ['pay period', 'salary period', 'pay frequency'], { input: 'select', choices: 'salaryPeriod', width: 'third', audience: 'job' }),
    F('yearsExperience', 'Years of experience', 'jobprefs', ['years of experience', 'years experience', 'total experience', 'work experience years', 'how many years'], { input: 'number', min: 0, max: 60, width: 'third', audience: 'job' }),
    F('over18', 'Are you 18 or older?', 'jobprefs', ['18 years', 'at least 18', 'over 18', '18 or older', 'legal age'], { input: 'yesno', choices: 'yesNo', audience: 'job' }),
    F('hearAbout', 'How did you hear about us?', 'jobprefs', ['how did you hear', 'how did you hear about us', 'how did you learn about', 'referral source', 'source'], { input: 'select', choices: 'hearAbout' }),

    // ---- Links ----
    F('linkedin', 'LinkedIn', 'links', ['linkedin', 'linkedin url', 'linkedin profile', 'linked in'], { input: 'url', placeholder: 'https://linkedin.com/in/…' }),
    F('github', 'GitHub', 'links', ['github', 'github url', 'github profile', 'git hub'], { input: 'url', placeholder: 'https://github.com/…' }),
    F('website', 'Personal website / portfolio', 'links', ['website', 'personal website', 'portfolio', 'homepage', 'personal url', 'web site', 'portfolio url'], { autocomplete: ['url'], input: 'url' }),
    F('scholar', 'Google Scholar', 'links', ['google scholar', 'scholar profile', 'scholar url'], { input: 'url', audience: 'college' }),
    F('orcid', 'ORCID iD', 'links', ['orcid', 'orcid id'], { audience: 'college', placeholder: '0000-0000-0000-0000' }),

    // ---- EEO ----
    F('hispanic', 'Hispanic or Latino?', 'eeo', ['hispanic', 'hispanic or latino', 'latino', 'latinx'], { input: 'select', choices: 'hispanic', audience: 'job' }),
    F('race', 'Race', 'eeo', ['race', 'race ethnicity', 'ethnicity', 'racial background'], { input: 'select', choices: 'race', audience: 'job' }),
    F('veteran', 'Veteran status', 'eeo', ['veteran status', 'military status', 'protected veteran', 'veteran'], { input: 'select', choices: 'veteran', audience: 'job' }),
    F('disability', 'Disability status', 'eeo', ['disability', 'disability status', 'voluntary self identification of disability'], { input: 'select', choices: 'disability', audience: 'job' }),

    // ---- Saved answers ----
    F('shortBio', 'Short bio / about me', 'answers', ['bio', 'short bio', 'about you', 'tell us about yourself', 'summary', 'brief biography', 'professional summary'], { input: 'textarea', width: 'full' }),
  ];

  /* ---------------- Repeatable sections ---------------- */
  const S = (key, label, synonyms, extra = {}) => ({ key, label, synonyms, input: 'text', ...extra });

  const LISTS = {
    education: {
      title: 'Education', noun: 'school', plural: 'schools',
      context: ['education', 'educational', 'academic', 'school', 'schools', 'college', 'university', 'degree', 'institution', 'institutions attended', 'colleges attended'],
      fields: [
        S('school', 'School / university', ['university', 'institution', 'school', 'college', 'institution name', 'school name', 'university name', 'college name', 'college or university'], { width: 'full', autocomplete: ['organization'] }),
        S('degree', 'Degree', ['degree', 'degree type', 'degree earned', 'degree received', 'highest degree', 'degree level'], { input: 'select', choices: 'degree' }),
        S('major', 'Major / field of study', ['major', 'field of study', 'discipline', 'area of study', 'concentration', 'program of study', 'subject']),
        S('minor', 'Minor', ['minor', 'second major'], { width: 'third' }),
        S('gpa', 'GPA', ['gpa', 'grade point average', 'cumulative gpa', 'overall gpa', 'cgpa'], { input: 'number', step: 0.01, min: 0, after: ['gpaScale'], joiner: 'out of' }),
        S('gpaScale', 'GPA scale', ['gpa scale', 'grading scale', 'scale', 'gpa out of', 'maximum gpa'], { input: 'select', choices: 'gpaScale', width: 'third' }),
        S('start', 'Started', ['start date', 'from', 'date started', 'attended from', 'enrollment date', 'date of entry', 'start month', 'start year', 'from year', 'year started', 'dates attended from'], { input: 'month', width: 'third' }),
        S('end', 'Graduated', ['graduation date', 'end date', 'to', 'date of graduation', 'expected graduation', 'date graduated', 'attended to', 'completion date', 'degree date', 'date conferred', 'graduation', 'anticipated graduation', 'end month', 'end year', 'graduation year', 'graduation month', 'to year', 'year graduated', 'year of graduation', 'expected graduation date'], { input: 'month', width: 'third', currentLabel: 'Expected graduation' }),
        S('current', 'Still studying here', ['currently attending', 'currently enrolled', 'still enrolled', 'i currently attend', 'in progress'], { input: 'check' }),
        S('city', 'City', ['city', 'school city', 'institution city', 'location'], { width: 'third' }),
        S('country', 'Country', ['country', 'school country', 'institution country', 'country of institution'], { input: 'country', width: 'third' }),
        S('honors', 'Honors / awards', ['honors', 'awards', 'distinctions'], { width: 'third' }),
      ],
      summary: (e) => [e.school || 'New school', [e.degree && e.degree.replace(/\s*\(.*\)/, ''), e.major].filter(Boolean).join(', '), years(e)],
    },
    work: {
      title: 'Work experience', noun: 'position',
      context: ['work', 'employment', 'experience', 'work experience', 'employment history', 'work history', 'professional experience', 'employer', 'job history'],
      avoid: ['desired', 'applying', 'applied', 'apply', 'interested in', 'seeking', 'looking for'],
      fields: [
        S('employer', 'Employer / organization', ['employer', 'company', 'company name', 'organization', 'organisation', 'employer name', 'current company'], { width: 'half' }),
        S('title', 'Job title', ['job title', 'title', 'position', 'role', 'position title'], { autocomplete: ['organization-title'], width: 'half' }),
        S('type', 'Type', ['employment type', 'job type'], { input: 'select', choices: 'employmentType', width: 'third' }),
        S('city', 'City', ['city', 'work city', 'job location', 'location'], { width: 'third' }),
        S('country', 'Country', ['country', 'work country'], { input: 'country', width: 'third' }),
        S('start', 'Started', ['start date', 'from', 'date started', 'employed from', 'start month', 'start year', 'from year'], { input: 'month', width: 'third' }),
        S('end', 'Ended', ['end date', 'to', 'date ended', 'employed to', 'end month', 'end year', 'to year'], { input: 'month', width: 'third' }),
        S('current', 'Currently work here', ['i currently work here', 'currently work here', 'current job', 'currently employed', 'current position', 'current role', 'present'], { input: 'check' }),
        S('supervisor', 'Supervisor', ['supervisor', 'manager name', 'reporting to'], { width: 'half' }),
        S('reasonLeft', 'Reason for leaving', ['reason for leaving', 'why did you leave'], { width: 'half' }),
        S('description', 'Responsibilities and achievements', ['description', 'responsibilities', 'duties', 'job description', 'achievements', 'role description'], { input: 'textarea', width: 'full' }),
      ],
      summary: (e) => [e.title || 'New position', e.employer, years(e)],
    },
    references: {
      title: 'Reference', noun: 'reference',
      requires: ['recommender', 'recommenders', 'reference', 'references', 'referee', 'referees', 'recommendation', 'recommendations', 'letter writer', 'letters'],
      context: ['recommender', 'recommenders', 'reference', 'references', 'referee', 'recommendation'],
      fields: [
        S('name', 'Full name', ['recommender name', 'reference name', 'referee name', 'name of recommender', 'name of reference', 'name', 'full name'], { width: 'half' }),
        S('title', 'Title / position', ['recommender title', 'reference title', 'position', 'job title', 'title'], { width: 'half' }),
        S('organization', 'Organization', ['recommender institution', 'reference company', 'organization', 'institution', 'company'], { width: 'half' }),
        S('relationship', 'Relationship to you', ['relationship', 'how do you know', 'relationship to applicant'], { input: 'select', choices: 'relationship', width: 'half' }),
        S('email', 'Email', ['recommender email', 'reference email', 'referee email', 'email'], { input: 'email', width: 'half' }),
        S('phone', 'Phone', ['recommender phone', 'reference phone', 'referee phone', 'phone'], { input: 'tel', width: 'half' }),
      ],
      summary: (e) => [e.name || 'New reference', [e.title, e.organization].filter(Boolean).join(', '), e.relationship],
    },
    certs: {
      title: 'Certification', noun: 'certification',
      context: ['certification', 'certifications', 'license', 'licenses', 'licensure'],
      fields: [
        S('name', 'Certification / license', ['certification', 'license', 'certificate', 'certification name'], { width: 'half' }),
        S('issuer', 'Issued by', ['issuing organization', 'issuer', 'issued by', 'certifying body'], { width: 'half' }),
        S('issued', 'Issued', ['issue date', 'date issued', 'date obtained'], { input: 'month', width: 'third' }),
        S('expires', 'Expires', ['expiration date', 'expiry', 'valid until'], { input: 'month', width: 'third' }),
        S('credentialId', 'Credential ID', ['credential id', 'license number', 'certificate number'], { width: 'third' }),
      ],
      summary: (e) => [e.name || 'New certification', e.issuer, e.issued ? e.issued.slice(0, 4) : ''],
    },
    languages: {
      title: 'Language', noun: 'language',
      context: ['language', 'languages'],
      fields: [
        S('language', 'Language', ['language', 'languages spoken', 'language name'], { width: 'half', datalist: 'language' }),
        S('proficiency', 'Proficiency', ['proficiency', 'fluency', 'level'], { input: 'select', choices: 'proficiency', width: 'half' }),
      ],
      summary: (e) => [e.language || 'New language', e.proficiency],
    },
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function ym(v) {
    const m = /^(\d{4})-(\d{2})/.exec(v || '');
    return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : '';
  }
  function years(e) {
    const a = ym(e.start), b = e.current ? (e.end ? 'expected ' + ym(e.end) : 'present') : ym(e.end);
    return a || b ? `${a || '…'} – ${b || '…'}` : '';
  }

  // Old single fields that now live in the first education entry.
  const MIGRATE = { school1: ['education', 0, 'school'], degree1: ['education', 0, 'degree'], major1: ['education', 0, 'major'], minor1: ['education', 0, 'minor'], gpa1: ['education', 0, 'gpa'], gpaScale1: ['education', 0, 'gpaScale'], gradStart1: ['education', 0, 'start'], gradDate1: ['education', 0, 'end'], school2: ['education', 1, 'school'], degree2: ['education', 1, 'degree'], major2: ['education', 1, 'major'], gpa2: ['education', 1, 'gpa'], employer: ['work', 0, 'employer'], jobTitle: ['work', 0, 'title'] };

  // College statuses and job statuses share one tracker.
  const STATUSES = {
    college: ['Researching', 'In progress', 'Submitted', 'Interview', 'Accepted', 'Waitlisted', 'Rejected', 'Withdrawn'],
    job: ['Saved', 'Applied', 'Screening', 'Interview', 'Offer', 'Accepted', 'Rejected', 'Withdrawn'],
  };

  /** Every sub-field of every repeatable section, as a matchable field ("education.school"). */
  function listFields() {
    const out = [];
    for (const [id, def] of Object.entries(LISTS)) {
      for (const f of def.fields) {
        out.push({ ...f, key: `${id}.${f.key}`, sub: f.key, list: id, group: id, label: `${def.title} · ${f.label}` });
      }
    }
    return out;
  }

  global.AK = global.AK || {};
  Object.assign(global.AK, { listFields, SECTIONS, DEFAULT_FIELDS, LISTS, MIGRATE, STATUSES, GROUP_ORDER: SECTIONS.map((s) => s.id) });
})(typeof window !== 'undefined' ? window : globalThis);
