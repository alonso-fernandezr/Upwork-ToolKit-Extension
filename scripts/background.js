// Per-tab in-memory state
// tabId → { running, url, minInterval, maxInterval, folder, downloadedForNav, countdownTimer, nextIn }
const tabStates = {};

const DOWNLOAD_DELAY_MS = 15000;
const ALARM_PREFIX = 'refresh_';

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sanitizeFilename(url) {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname)
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/, '') || 'page';
  } catch {
    return 'page';
  }
}

function alarmName(tabId) { return ALARM_PREFIX + tabId; }

function broadcastStatus(tabId) {
  const s = tabStates[tabId];
  if (!s) return;
  try {
    chrome.runtime.sendMessage({
      action: 'statusUpdate',
      tabId,
      running: s.running,
      nextIn: s.nextIn
    });
  } catch {}
}

function startCountdown(tabId, seconds) {
  const s = tabStates[tabId];
  if (!s) return;
  clearInterval(s.countdownTimer);
  s.nextIn = seconds;
  broadcastStatus(tabId);
  s.countdownTimer = setInterval(() => {
    if (!s.running) { clearInterval(s.countdownTimer); return; }
    s.nextIn = Math.max(0, s.nextIn - 1);
    broadcastStatus(tabId);
  }, 1000);
}

async function downloadPageHTML(tabId, folder, url) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.documentElement.outerHTML
    });
    if (results?.[0]?.result) {
      const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(results[0].result);
      const name    = sanitizeFilename(url);
      const ts      = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      chrome.downloads.download({ url: dataUrl, filename: folder + '/' + name + '_' + ts + '.html', saveAs: false });
    }
  } catch (e) {
    console.error('[AutoRefresh] download failed:', e);
  }
}

function scheduleNextRefresh(tabId) {
  const s = tabStates[tabId];
  if (!s || !s.running) return;
  const delay = getRandomInt(s.minInterval, s.maxInterval);
  startCountdown(tabId, delay);
  chrome.alarms.create(alarmName(tabId), { delayInMinutes: delay / 60 });
}

function start(tabId, config) {
  // Stop any existing loop for this tab
  stopTab(tabId, false);

  tabStates[tabId] = {
    running: true,
    url: config.url,
    minInterval: config.minInterval,
    maxInterval: config.maxInterval,
    folder: config.folder,
    downloadedForNav: false,
    countdownTimer: null,
    nextIn: null
  };

  // Navigate current tab to the URL
  chrome.tabs.update(tabId, { url: config.url });
  broadcastStatus(tabId);
}

function stopTab(tabId, broadcast = true) {
  const s = tabStates[tabId];
  if (s) {
    s.running = false;
    clearInterval(s.countdownTimer);
    s.nextIn = null;
  }
  chrome.alarms.clear(alarmName(tabId));
  if (broadcast) {
    tabStates[tabId] = tabStates[tabId] || {};
    tabStates[tabId].running = false;
    tabStates[tabId].nextIn  = null;
    broadcastStatus(tabId);
  }
}

// Tab finishes loading → download once, then schedule next refresh
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  const s = tabStates[tabId];
  if (!s || !s.running) return;
  if (s.downloadedForNav) return;   // already handled this load
  s.downloadedForNav = true;

  // 5-second settle, then download + schedule next
  setTimeout(async () => {
    if (!s.running) return;
    await downloadPageHTML(tabId, s.folder, s.url);
    scheduleNextRefresh(tabId);
  }, DOWNLOAD_DELAY_MS);
});

// Alarm fires → reload the tab
chrome.alarms.onAlarm.addListener(alarm => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const tabId = parseInt(alarm.name.slice(ALARM_PREFIX.length), 10);
  const s = tabStates[tabId];
  if (!s || !s.running) return;
  s.downloadedForNav = false;   // allow next download
  chrome.tabs.reload(tabId, { bypassCache: true });
});

// If user closes the tab, stop the loop
chrome.tabs.onRemoved.addListener(tabId => {
  stopTab(tabId, false);
  delete tabStates[tabId];
});

// Messages from popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'start') {
    start(msg.tabId, msg.config);
    sendResponse({ ok: true });
    return;
  }
  if (msg.action === 'stop') {
    stopTab(msg.tabId);
    sendResponse({ ok: true });
    return;
  }
  if (msg.action === 'getStatus') {
    const s = tabStates[msg.tabId];
    sendResponse({ running: !!s?.running, nextIn: s?.nextIn ?? null });
    return;
  }
});
