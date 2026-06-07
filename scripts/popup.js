let currentTab = null;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  // Pre-fill URL with current tab's URL
  const urlInput = document.getElementById('urlInput');
  urlInput.value = tab.url || '';

  // Load saved config for this tab
  const cfg = await loadTabConfig(tab.id, tab.url);
  document.getElementById('urlInput').value   = cfg.url || tab.url || '';
  document.getElementById('minInterval').value = cfg.minInterval;
  document.getElementById('maxInterval').value = cfg.maxInterval;
  document.getElementById('folderName').value  = cfg.folder;

  // Get running status from background
  chrome.runtime.sendMessage({ action: 'getStatus', tabId: tab.id }, resp => {
    applyStatus(resp || {});
  });

  // Live countdown updates while popup is open
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.action === 'statusUpdate' && msg.tabId === currentTab.id) {
      applyStatus(msg);
    }
  });

  document.getElementById('btnAction').addEventListener('click', onActionClick);
}

function applyStatus({ running, nextIn }) {
  const banner = document.getElementById('status-banner');
  const text   = document.getElementById('status-text');
  const btn    = document.getElementById('btnAction');
  const nextEl = document.getElementById('lblNextIn');

  if (running) {
    banner.className = 'banner-running';
    text.textContent = 'RUNNING';
    btn.className    = 'btn-stop';
    btn.textContent  = '■ Stop';
    nextEl.textContent = nextIn ? nextIn + 's' : '…';
  } else {
    banner.className = 'banner-stopped';
    text.textContent = 'STOPPED';
    btn.className    = 'btn-start';
    btn.textContent  = '▶ Start';
    nextEl.textContent = '—';
  }
}

async function onActionClick() {
  const running = document.getElementById('status-banner').classList.contains('banner-running');

  if (running) {
    chrome.runtime.sendMessage({ action: 'stop', tabId: currentTab.id });
    applyStatus({ running: false });
  } else {
    const url    = document.getElementById('urlInput').value.trim();
    const min    = parseInt(document.getElementById('minInterval').value, 10) || 30;
    const max    = Math.max(parseInt(document.getElementById('maxInterval').value, 10) || 90, min);
    const folder = document.getElementById('folderName').value.trim() || 'upwork';

    if (!url) { alert('Enter a URL first.'); return; }

    const cfg = { url, minInterval: min, maxInterval: max, folder };
    await saveTabConfig(currentTab.id, cfg);

    chrome.runtime.sendMessage({ action: 'start', tabId: currentTab.id, config: cfg });
    applyStatus({ running: true, nextIn: null });
    // Close popup so it doesn't block
    window.close();
  }
}

/* ── Storage helpers ── */

function storageKey(tabId) { return 'tabCfg_' + tabId; }

async function loadTabConfig(tabId, tabUrl) {
  return new Promise(resolve => {
    const key = storageKey(tabId);
    chrome.storage.local.get(key, result => {
      resolve(result[key] || { url: tabUrl, minInterval: 30, maxInterval: 90, folder: 'upwork' });
    });
  });
}

async function saveTabConfig(tabId, cfg) {
  return new Promise(resolve => {
    const obj = {};
    obj[storageKey(tabId)] = cfg;
    chrome.storage.local.set(obj, resolve);
  });
}

document.addEventListener('DOMContentLoaded', init);
