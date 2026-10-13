// Slop Shield - background.js (MV3 service worker)
//
// Sole verification path (user-requested): TinyFish Agent API performs a FULL
// investigation of the company behind each job listing — find the official
// website, probe careers/about/contact pages, look for registrations,
// leadership, press, scam reports — and returns a legitimacy verdict.
// The stamp decision is driven by that verdict, not by fixed patterns.

const TINYFISH_ENDPOINT = 'https://agent.tinyfish.ai/v1/automation/run';

const INVESTIGATION_GOAL = `
INVESTIGATION PROTOCOL — do ALL of these steps, in order:

STEP 1 — FIND THE COMPANY:
Search the web for "<company name>" together with the location and any
website/domain hint from the listing. Identify the company's OFFICIAL website
(their own domain, not a job-board profile, not a review site).
If no official website exists or can be found, note website_status = "not_found"
and set is_legit = false with confidence reflecting that.

STEP 2 — VISIT THE OFFICIAL SITE AND PROBE THE PAGES BELOW:
- Home page: does it describe real products/services/work?
- About / Team / Leadership page: are there NAMED people (founders, directors)?
- Careers / Jobs / "Work with us" page: does it exist? Does it feel real?
- Contact page: a real physical address, phone, or business email?
- Legal footers: company registration number, terms, privacy policy?

STEP 3 — EXTERNAL LEGITIMACY SIGNALS (search the web for):
- "<company>" + "reviews" (Glassdoor, Indeed reviews, Google reviews)
- "<company>" + "scam OR fraud OR fake"
- LinkedIn company page with follower count and employees
- Any press coverage or news mentions
- Signs of scam: pay-to-apply reports, WhatsApp hiring complaints,
- registration-fee complaints, or the company name appearing on scam-warning
  lists

STEP 4 — RED FLAGS IN THE LISTING TEXT ITSELF:
Registration/processing fee, "pay via UPI then WhatsApp", guaranteed offer,
unrealistic salary for the role, no interview promised, vague duties,
grammar-slop phrasing. Even if the company is real, note fee-related listing
red flags as reasons.

STEP 5 — DECIDE:
agent verdict fields:
- is_legit: true ONLY if the company exists as a real organization AND the
  listing carries no pay-to-apply / WhatsApp-fee scam markers
- employer_type: direct_employer | agency (real staffing agency) | unknown
- website_status: reached | unreachable | not_found
- confidence: 0-100
- reasons: up to 6 SHORT bullets, concrete facts ("careers page lists 3 roles",
  "no team names on about page", "2 Glassdoor reviews from 2023", "asks ₹499 fee")

Respond with ONLY the JSON object of the final verdict. No commentary.
`.trim();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'SLOP_VERIFY' && typeof msg.job === 'object') {
    verifyWithTinyFish(msg.job)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: String(err && err.message || err) }));
    return true; // keep channel open for async response
  }
});

/**
 * job = { title, company, location, domain, listingText }
 * Response: { is_legit, website_status, employer_type, confidence, reasons }
 *          or { error: "..." }
 */
async function verifyWithTinyFish(job) {
  const { tinyfishKey, verifyMode } = await chrome.storage.sync.get(['tinyfishKey', 'verifyMode']);
  if (!tinyfishKey) {
    return { error: 'No TinyFish API key set. Add one in the popup.' };
  }
  if (verifyMode === 'off') {
    return { error: 'Verification is set to "patterns only" in the popup.' };
  }

  const goalParts = [];
  goalParts.push('Investigate whether this job listing describes a legitimate employer.');
  if (job.title) goalParts.push(`Job title: ${job.title}`);
  if (job.company) goalParts.push(`Company: ${job.company}`);
  if (job.location) goalParts.push(`Location: ${job.location}`);
  if (job.domain) goalParts.push(`Possible website: ${job.domain}`);
  if (job.listingText) goalParts.push(`Listing text for red flags: ${String(job.listingText).slice(0, 2500)}`);
  goalParts.push(INVESTIGATION_GOAL);
  const goal = goalParts.join('\n\n');

  const payload = {
    url: 'https://www.google.com',
    goal,
    output_schema: {
      type: 'object',
      properties: {
        is_legit: { type: 'boolean' },
        website_status: { type: 'string', description: 'reached | unreachable | not_found' },
        employer_type: { type: 'string', description: 'direct_employer | agency | unknown' },
        confidence: { type: 'integer', description: '0-100' },
        reasons: { type: 'array', items: { type: 'string' } },
      },
      required: ['is_legit', 'website_status', 'confidence', 'reasons'],
    },
  };

  const res = await fetch(TINYFISH_ENDPOINT, {
    method: 'POST',
    headers: {
      'X-API-Key': tinyfishKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`TinyFish API ${res.status}: ${bodyText.slice(0, 300)}`);
  }

  const data = await res.json();
  return normalizeVerdict(data);
}

function normalizeVerdict(data) {
  let result = data?.result;
  if (result && typeof result === 'object' && 'result' in result && typeof result.result !== 'object') {
    result = result.result; // bare text/string answer
  }
  if (typeof result === 'string') {
    try { result = JSON.parse(result); } catch (e) { result = null; }
  }
  if (!data || data.status !== 'COMPLETED' || !result || typeof result !== 'object' || typeof result.is_legit !== 'boolean') {
    return { error: `TinyFish returned an unexpected result: ${JSON.stringify(data).slice(0, 300)}` };
  }
  return {
    is_legit: result.is_legit,
    website_status: ['reached', 'unreachable', 'not_found'].includes(result.website_status) ? result.website_status : 'unknown',
    employer_type: ['direct_employer', 'agency', 'unknown'].includes(result.employer_type) ? result.employer_type : 'unknown',
    confidence: Math.max(0, Math.min(100, Number(result.confidence) || 0)),
    reasons: Array.isArray(result.reasons) ? result.reasons.slice(0, 6) : [],
    verified_by: 'tinyfish',
  };
}

// Simple stats for the popup dashboard.
async function bumpStat(key) {
  const { stats } = await chrome.storage.local.get('stats');
  const next = { scanned: 0, flagged: 0, verified: 0, ...(stats || {}) };
  next[key] = (next[key] || 0) + 1;
  await chrome.storage.local.set({ stats: next });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'SLOP_STAT') bumpStat(msg.key);
});
