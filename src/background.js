// ApplyKit — background service worker.

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html#welcome') });
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'ak-open-options') chrome.runtime.openOptionsPage();
});

async function fillTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => (window.__AK_API ? window.__AK_API.fillAll() : { filled: 0 }),
  });
  return results.reduce((n, r) => n + ((r.result && r.result.filled) || 0), 0);
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'fill-page') return;
  const t = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (t && t.id != null) {
    try { await fillTab(t.id); } catch (e) { /* page we can't script, e.g. chrome:// */ }
  }
});
