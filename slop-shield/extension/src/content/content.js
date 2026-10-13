// Slop Shield - content.js
// Content script that runs on LinkedIn, Indeed, Naukri, and Gmail.
// Reads visible job text, calls the engine, and injects an "AI Slop" badge with animation.

const SITE_SELECTORS = {
  linkedin: {
    // Each job card in the listing feed
    cards: 'div.job-card-container, div.base-card, li.jobs-search-results__list-item, div.artdeco-card li',
    // Detail pane - full description if opened
    detail: 'div.jobs-description__container, div.jobs-box__html-content, section.show-more-ellipsis-container',
    // Where to mount badges inside a card
    title: 'h3.base-card__title, h3.job-card-container__title, .job-card-list__title',
    company: 'h4.base-card__subtitle, .job-card-container__company-name',
    // Links pointing at the job detail page
    link: 'a[href*="/jobs/view/"], a[href*="currentJobId="]',
    pageIdMatch: /linkedin\.com/i,
    pageName: 'LinkedIn',
  },
  indeed: {
    cards: 'div.job_seen_beacon, td.resultContent, div.tapIQ-result',
    detail: 'div.jobsearch-jobDescriptionText, #jobDescriptionText',
    title: 'h2.jobTitle, h2.jobsearch-JobInfoHeader-title',
    company: 'span.companyName, div.company_location',
    link: 'a[href*="/viewjob?jk="], a[href*="clk="]',
    pageIdMatch: /indeed\.com/i,
    pageName: 'Indeed',
  },
  naukri: {
    cards: 'article.jobTuple, div.cust-job-tuple, div.job-tuple',
    detail: 'div.job-desc, .styles_job-detail-heading, div.jd-container',
    title: 'a.title, h2.jobTuple-header, .title',
    company: 'a.comp-name, span.comp-wrap, .companyInfo',
    link: 'a[href*="job-listings-"], a.title',
    pageIdMatch: /naukri\.com/i,
    pageName: 'Naukri',
  },
  gmail: {
    // Gmail uses completely different DOM. We target individual open emails.
    cards: 'div[role="main"] div.Ad, div.h7',
    detail: 'div.a3s, div[role="listitem"] div.gmailBodyContainer',
    title: 'h2.hP, .gs .gD',
    company: 'span.gD, .go',
    link: 'a[href*="linkedin.com/jobs"], a[href*="indeed"], a[href*="naukri"]',
    pageIdMatch: /mail\.google\.com/i,
    pageName: 'Gmail',
  },
};

function detectSite() {
  const href = location.href;
  if (/linkedin\.com/i.test(href)) return 'linkedin';
  if (/indeed\.com/i.test(href)) return 'indeed';
  if (/naukri\.com/i.test(href)) return 'naukri';
  if (/mail\.google\.com/i.test(href)) return 'gmail';
  return null;
}

function extractText(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  // Strip previously-injected badge/panel so re-scan texts stay clean.
  clone.querySelectorAll('.slop-badge, .slop-stamp, .slop-tip, .slop-panel').forEach((n) => n.remove());
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

function mountBadge(cardEl, verdict) {
  // Avoid double-badge on re-scan.
  cardEl.querySelectorAll('.slop-badge, .slop-stamp').forEach((n) => n.remove());

  if (verdict.verdict === 'legit' && verdict.score < 25) return;

  const badge = document.createElement('div');
  badge.className = `slop-badge ${verdict.verdict}`;
  badge.textContent = verdict.verdict === 'fake' ? 'AI Slop' : 'Suspicious';

  const tip = document.createElement('div');
  tip.className = 'slop-tip';
  let body = '';
  if (verdict.tinyfish && !verdict.tinyfish.error) {
    const tf = verdict.tinyfish;
    body += `<em>TinyFish agent</em> visited the company's website · <strong>${tf.website_status || 'unknown'}</strong><br/>`;
    body += `<strong>Employer type:</strong> ${tf.employer_type || 'unknown'} · <strong>Confidence:</strong> ${tf.confidence || 0}%`;
    body += '<ul>' + (tf.reasons || []).map((r) => `<li>${r}</li>`).join('') + '</ul>';
  } else {
    const reasons = verdict.hits.map((h) => `<li>${h.label}</li>`).join('');
    const aiReasons = (verdict.ai?.reasons || []).map((r) => `<li>${r}</li>`).join('');
    body = `<em>Fallback analysis (no TinyFish verdict)</strong><ul>${reasons}${aiReasons}</ul>`;
  }
  tip.innerHTML = `<strong>Slop Shield</strong> — score ${verdict.score}/100<br/>${body}`;
  badge.appendChild(tip);

  const title = cardEl.querySelector(
    SITE_SELECTORS[detectSite()]?.title || 'h3, h2, h1'
  );
  if (title) {
    title.insertAdjacentElement('afterend', badge);
  } else {
    cardEl.insertAdjacentElement('afterbegin', badge);
  }

  if (verdict.verdict === 'fake') {
    cardEl.classList.add('slop-flagged-fake');
    const stamp = document.createElement('div');
    stamp.className = 'slop-stamp';
    stamp.textContent = 'AI Slop';
    cardEl.style.position = 'relative';
    cardEl.appendChild(stamp);
    setTimeout(() => stamp.remove(), 3000);
  }
}

const processed = new WeakSet();

/** Temporary "scanning…" badge so the user sees verification is live. */
function showScanningBadge(cardEl) {
  cardEl.querySelectorAll('.slop-badge.scanning').forEach((n) => n.remove());
  const b = document.createElement('div');
  b.className = 'slop-badge scanning';
  b.textContent = '⏳ checking…';
  const title = cardEl.querySelector(SITE_SELECTORS[detectSite()]?.title || 'h3, h2, h1');
  if (title) title.insertAdjacentElement('afterend', b);
  else cardEl.insertAdjacentElement('afterbegin', b);
  return b;
}

async function processCard(cardEl, site) {
  if (processed.has(cardEl)) return;
  processed.add(cardEl);
  const text = extractText(cardEl);
  if (!text || text.length < 30) return;

  const scanBadge = showScanningBadge(cardEl);
  let verdict;
  try {
    verdict = await globalThis.SLOP_ENGINE.analyzeJob(text, cardEl, (state) => {
      if (state === 'investigating') scanBadge.textContent = '🌐 investigating company…';
      else if (state === 'fallback') scanBadge.textContent = '⚠ pattern fallback';
    });
  } catch (e) {
    scanBadge.remove();
    return;
  }
  scanBadge.remove();

  if (verdict.verdict === 'off') return; // shield paused
  mountBadge(cardEl, verdict);
  chrome.runtime.sendMessage({ type: 'SLOP_STAT', key: 'scanned' }).catch(() => {});
  if (verdict.tinyfish && !verdict.tinyfish.error) {
    chrome.runtime.sendMessage({ type: 'SLOP_STAT', key: 'verified' }).catch(() => {});
  }
  if (verdict.verdict !== 'legit') {
    chrome.runtime.sendMessage({ type: 'SLOP_STAT', key: 'flagged' }).catch(() => {});
  }
}

function scanCards(site) {
  const sel = SITE_SELECTORS[site];
  if (!sel) return;
  let found = 0;
  document.querySelectorAll(sel.cards).forEach((el) => {
    processCard(el, site);
  });
  document.querySelectorAll(sel.detail).forEach((el) => {
    found++;
    processCard(el, site);
  });
  return found;
}

// Gmail only scans after user opens one email.
let gmailScanTimer = null;
function scheduleGmailScan() {
  if (gmailScanTimer) return;
  gmailScanTimer = setTimeout(() => {
    gmailScanTimer = null;
    const site = detectSite();
    if (site === 'gmail') scanCards(site);
  }, 700);
}

function boot() {
  const site = detectSite();
  if (!site) return;

  // Initial scan
  scanCards(site);

  // SPA navigation — sites don't reload on pagination.
  const obs = new MutationObserver(() => {
    const cur = detectSite();
    if (cur === 'gmail') scheduleGmailScan();
    else scanCards(cur);
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
