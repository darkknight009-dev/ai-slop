// Slop Shield - heuristics.js
// Local rules that instantly detect obvious fake / spam job listings.
// Runs on every supported job site, no network calls needed.

// Example scammy patterns seen in the wild.
const PATTERNS = [
  { id: 'no-company-name', test: (t) => !/Salary|Pay|Employer/i.test(t) && /Apply Now/i.test(t) && t.length < 260, w: 20, label: 'No company name' },
  { id: 'too-good-to-be-true', test: (t) => /\b(earn|make)\s+(\$|₹|rs\.?|€|£)\s?\d{3,}[\s\S]*?(no experience|from home|part[- ]time)/i.test(t), w: 35, label: 'Too good to be true' },
  { id: 'money-upfront', test: (t) => /\b(pay|fee|deposit|registration|training)\s+(a\s+)?(fee|amount|money)\b/i.test(t) && /\b(inr|₹|rs\.?|\$)/i.test(t), w: 50, label: 'Asks for money upfront' },
  { id: 'pay-to-apply', test: (t) => /(registration|processing|application)\s+fee/i.test(t) || /(pay|deposit)\s+(₹|rs\.?|inr|\$|eur|€|£)/i.test(t), w: 55, label: 'Pay-to-apply scam' },
  { id: 'whatsapp-or-telegram', test: (t) => /\b(whatsapp|telegram|telegram\b)/i.test(t) && /(apply|contact|reach|join)/i.test(t), w: 40, label: 'Contact via WhatsApp/Telegram' },
  { id: 'personal-email', test: (t) => /\b(gmail|yahoo|hotmail|outlook|rediffmail|protonmail)\.(com|net|org)\b/i.test(t) && /(resume|cv|apply|send)/i.test(t), w: 30, label: 'Personal email contact' },
  { id: 'urgent-pressure', test: (t) => /(urgent|immediate|hiring now|closing soon|limited seats|filling fast)/i.test(t), w: 20, label: 'Pressure words' },
  { id: 'crypto-invest', test: (t) => /(crypto|bitcoin|btc|usdt|forex|trading)/i.test(t) && /(job|work|hire|earn)/i.test(t), w: 45, label: 'Crypto/forex angle' },
  { id: 'work-from-home-vague', test: (t) => /(work from home|remote|wfh|data entry|copy paste|typing)/i.test(t) && !/(experience required|degrees?|bachelor|master)/i.test(t) && t.length < 400, w: 25, label: 'Vague WFH gig' },
  { id: 'no-experience-any-education', test: (t) => /(no experience|no degree|no resume|no interview)/i.test(t) && /(high pay|salary|earn)/i.test(t), w: 30, label: 'No-experience high-pay' },
  { id: 'guaranteed-job', test: (t) => /(guaranteed|hundred\s*%|100\s*%)\s*(job|selection|placement|offer)/i.test(t), w: 40, label: 'Guaranteed-job claim' },
  { id: 'salary-odd-pattern', test: (t) => /salary\s*[:\-]?\s*₹?\s*(\d{1,3}(,\d{3})+|\d+)\s*(per|\/|p\.a\.|monthly|lpa)/i.test(t) && /(no skill|no interview|any (graduate|qualification))/i.test(t), w: 25, label: 'Suspicious salary pattern' },
  { id: 'ai-generated', test: (t) => /(this is an amazing exciting opportunity|dynamic fast[- ]paced environment|rockstar ninja wizard|wear many hats|family culture|life[- ]changing)/i.test(t), w: 15, label: 'AI-slop phrasing' },
];

// Kerbs from triggering on legit job fields like "Salary: $80k".
const NEGATIVE_CONTEXT = /(hiring manager|our client|apply through the official|company careers page|linkedin job post)/i;

function runHeuristics(text) {
  const clean = (text || '').trim();
  if (!clean || clean.length < 30) {
    return { score: 0, hits: [], clean };
  }
  const hits = [];
  for (const pat of PATTERNS) {
    let ok = false;
    try {
      ok = pat.test(clean);
    } catch (e) { /* Regex bug tolerated */ }
    if (ok) hits.push({ id: pat.id, label: pat.label, weight: pat.w });
  }
  let score = hits.reduce((sum, h) => sum + h.weight, 0);
  // Stronger hits dominate, dampen stacking.
  score = Math.min(100, Math.round(score * (hits.length > 2 ? 0.75 : 0.9)));
  return { score, hits, clean };
}

// Expose to other scripts loaded as plain <script> tags (no bundler).
if (typeof self !== 'undefined') {
  self.SLOP_HEURISTICS = { runHeuristics };
}
if (typeof globalThis !== 'undefined') {
  globalThis.SLOP_HEURISTICS = { runHeuristics };
}
