// Slop Shield - engine.js
// VERDICT FLOW (user-requested):
//   TinyFish full company investigation is THE verification path whenever a key
//   is set. Only listings whose text is unambiguously scammy (score >= 85) skip
//   the call, and no network is used when offline mode is selected.
//   The stamp verdict comes from the agent's is_legit answer — patterns are a
//   fallback, not the truth.
//   Gate: 'shieldOn' kills all scanning when off.

function sniffDomain(text) {
  if (!text) return null;
  const m = text.match(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/i)
     || text.match(/\b([a-z0-9-]+\.(?:com|co|io|ai|org|net|in))\b/i);
  return m ? m[1].toLowerCase() : null;
}

function guessDomain(company) {
  if (!company) return null;
  const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!slug || slug.length < 3) return null;
  return `${slug}.com`;
}

/** Extract the bits TinyFish wants to verify against the real web. */
function extractJobFacts(text, cardEl) {
  let employer = null;
  let location = null;
  let title = null;

  if (cardEl) {
    const root = cardEl.closest(
      '.job-details-jobs-unified-top-card__container, .jobs-details, .show-more-ellipsis-container'
    ) || cardEl;
    const t = root.querySelector(
      '.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1, h2'
    );
    const c = root.querySelector(
      '.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, .jobs-company-name, h2 > a, h3 > a'
    );
    const l = root.querySelector(
      '.job-details-jobs-unified-top-card__bullet, .jobs-unified-top-card__bullet, .jobs-company-location'
    );
    if (t) title = t.textContent.trim().slice(0, 120);
    if (c) employer = c.textContent.trim().slice(0, 120);
    if (l) location = l.textContent.trim().slice(0, 120);
  }

  if (!employer) {
    const at = text.match(/\bat\s+([A-Z][\w&.\- ]{2,40})/i);
    if (at) employer = at[1].trim();
  }
  if (!location) {
    const loc = text.match(/\b(?:in|located in|location:)\s+([A-Z][\w \-]{2,40})/i);
    if (loc) location = loc[1].trim();
  }

  const domain = sniffDomain(text) || guessDomain(employer);
  return { title, company: employer, location, domain, listingText: text };
}

function combineVerdict(heur, tinyfish, ai) {
  // If TinyFish gave us a full investigation verdict, THAT is the truth.
  if (tinyfish && !tinyfish.error && typeof tinyfish.is_legit === 'boolean') {
    if (!tinyfish.is_legit) {
      return {
        verdict: 'fake',
        score: Math.max(85, tinyfish.confidence || 0),
        hits: [],
        tinyfish,
        ai: ai || null,
        source: 'tinyfish.verdict',
      };
    }
    return {
      verdict: 'legit',
      score: 0,
      hits: [],
      tinyfish,
      ai: ai || null,
      source: 'tinyfish.verdict',
    };
  }

  // TinyFish absent/failed/skipped → patterns (+opt LLM) drive the call.
  let score = heur.score;
  if (ai) {
    const aiFake = ai.verdict === 'fake';
    const aiSusp = ai.verdict === 'suspicious';
    const aiConf = Math.max(0, Math.min(100, Number(ai.confidence) || 0));
    if (aiFake) score = Math.max(score, 70) + Math.round((aiConf / 100) * 25);
    else if (aiSusp) score = Math.max(score, 45) + Math.round((aiConf / 100) * 15);
    else if (aiConf >= 70 && heur.score < 35) score = Math.round(score * 0.4);
    score = Math.max(0, Math.min(100, score));
  }
  let verdict = 'legit';
  if (score >= 70) verdict = 'fake';
  else if (score >= 40) verdict = 'suspicious';

  return { score, verdict, hits: heur.hits, tinyfish: tinyfish || null, ai: ai || null, source: 'patterns.fallback' };
}

/** Full pipeline for one job listing. onStatus(state) lets the caller show live UI. */
async function analyzeJob(text, cardEl, onStatus) {
  const settings = await chrome.storage.sync.get(['shieldOn', 'tinyfishKey', 'verifyMode', 'aiEnabled']);
  if (settings.shieldOn === false) {
    // Shield paused — behave as if we're not here.
    return { verdict: 'off', score: 0, hits: [], tinyfish: null, ai: null, source: 'shield.paused' };
  }

  onStatus && onStatus('reading');
  const heur = (globalThis.SLOP_HEURISTICS || self.SLOP_HEURISTICS).runHeuristics(text);

  // Hallucination-grade scam — stamp instantly, no API call needed.
  if (heur.score >= 85) {
    return combineVerdict(heur, null, null);
  }

  // No key or user chose "patterns only" → no network at all.
  const wantsTinyFish = settings.tinyfishKey && settings.verifyMode !== 'off';
  if (!wantsTinyFish) {
    return combineVerdict(heur, null, null);
  }

  onStatus && onStatus('investigating');
  const facts = extractJobFacts(text, cardEl);
  let tinyfish = null;
  try {
    tinyfish = await chrome.runtime.sendMessage({
      type: 'SLOP_VERIFY',
      job: facts,
    });
  } catch (e) {
    tinyfish = { error: String(e) };
  }

  if (!tinyfish || tinyfish.error) {
    onStatus && onStatus('fallback');
    if (settings.aiEnabled) {
      try {
        const ai = await aiSecondOpinion(text);
        return combineVerdict(heur, tinyfish, ai);
      } catch (e) {
        return combineVerdict(heur, tinyfish, null);
      }
    }
    return combineVerdict(heur, tinyfish, null);
  }

  return combineVerdict(heur, tinyfish, null);
}

async function aiSecondOpinion(text) {
  const settings = await chrome.storage.sync.get(['provider', 'geminiKey', 'openaiKey']);
  if (settings.provider === 'openai' && settings.openaiKey) {
    return await chrome.runtime.sendMessage({ type: 'SLOP_AI_OPENAI', text });
  }
  if (settings.geminiKey) {
    return await chrome.runtime.sendMessage({ type: 'SLOP_AI_GEMINI', text });
  }
  return null;
}

// Expose
if (typeof globalThis !== 'undefined') {
  globalThis.SLOP_ENGINE = { analyzeJob, combineVerdict, extractJobFacts };
}
if (typeof self !== 'undefined') {
  self.SLOP_ENGINE = globalThis.SLOP_ENGINE;
}
