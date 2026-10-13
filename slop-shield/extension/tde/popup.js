// Slop Shield - popup.js
// Fix list vs previous version:
//  - toggles are <label class="switch" for="..."><input></label> pairs — clicks always land
//  - every control persists IMMEDIATELY on change (no dependency on hitting Save)
//  - Save button also writes all keys in one shot (for people who type keys then click)
//  - UI state (status pill, status dot, key sections) syncs with storage
const $ = (id) => document.getElementById(id);

function debounce(fn, ms = 400) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ---------- persisted controls ---------- */
const saveShield = debounce((v) => chrome.storage.sync.set({ shieldOn: v }));
const saveVerify = debounce((v) => chrome.storage.sync.set({ verifyMode: v }));
const saveTinyfishKey = debounce((v) => chrome.storage.sync.set({ tinyfishKey: v.trim() }));
const saveAiEnabled = debounce((v) => chrome.storage.sync.set({ aiEnabled: v }));
const saveGeminiKey = debounce((v) => chrome.storage.sync.set({ geminiKey: v.trim() }));
const saveOpenaiKey = debounce((v) => chrome.storage.sync.set({ openaiKey: v.trim() }));

/* ---------- UI state ---------- */
function paintShieldUI(on) {
  $('dotShield').className = 'status-dot ' + (on ? 'on' : 'off');
  const pill = $('statusPill');
  pill.textContent = on ? 'ACTIVE' : 'PAUSED';
  pill.style.background = on ? 'var(--lime)' : '#d6d2c9';
  pill.style.color = 'var(--ink)';
}

function paintVerifyUI(mode) {
  const agent = mode !== 'off';
  $('vmAgent').checked = agent;
  $('vmOff').checked = !agent;
  // highlight the key input when agent mode is on
  const wrap = $('tinyfishWrap');
  wrap.style.opacity = agent ? '1' : '0.45';
  wrap.style.pointerEvents = agent ? 'auto' : 'none';
}

function paintAiUI(enabled) {
  $('aiSection').style.display = enabled ? 'block' : 'none';
}

/* ---------- wire everything ---------- */
$('shieldOn').addEventListener('change', (e) => {
  paintShieldUI(e.target.checked);
  saveShield(e.target.checked);
});
document.querySelectorAll('input[name="verifyMode"]').forEach((r) => {
  r.addEventListener('change', (e) => {
    paintVerifyUI(e.target.value);
    saveVerify(e.target.value);
  });
});
$('tinyfishKey').addEventListener('input', (e) => saveTinyfishKey(e.target.value));
$('aiEnabled').addEventListener('change', (e) => {
  paintAiUI(e.target.checked);
  saveAiEnabled(e.target.checked);
});
$('geminiKey').addEventListener('input', (e) => saveGeminiKey(e.target.value));
$('openaiKey').addEventListener('input', (e) => saveOpenaiKey(e.target.value));

$('save').addEventListener('click', async () => {
  await chrome.storage.sync.set({
    shieldOn: $('shieldOn').checked,
    verifyMode: document.querySelector('input[name="verifyMode"]:checked')?.value || 'auto',
    tinyfishKey: $('tinyfishKey').value.trim(),
    aiEnabled: $('aiEnabled').checked,
    geminiKey: $('geminiKey').value.trim(),
    openaiKey: $('openaiKey').value.trim(),
  });
  const el = $('saved');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
});

/* ---------- load ---------- */
(async function load() {
  const s = await chrome.storage.sync.get([
    'shieldOn', 'verifyMode', 'tinyfishKey',
    'aiEnabled', 'geminiKey', 'openaiKey',
  ]);
  const { stats } = await chrome.storage.local.get('stats');
  const st = stats || { scanned: 0, flagged: 0, verified: 0 };

  const shieldOn = s.shieldOn !== false;
  $('shieldOn').checked = shieldOn;
  paintShieldUI(shieldOn);
  paintVerifyUI(s.verifyMode || 'auto');
  paintAiUI(!!s.aiEnabled);
  $('aiEnabled').checked = !!s.aiEnabled;
  if (s.tinyfishKey) $('tinyfishKey').value = s.tinyfishKey;
  if (s.geminiKey) $('geminiKey').value = s.geminiKey;
  if (s.openaiKey) $('openaiKey').value = s.openaiKey;

  $('statScanned').textContent = st.scanned || 0;
  $('statFlagged').textContent = st.flagged || 0;
  $('statVerified').textContent = st.verified || 0;
})();
