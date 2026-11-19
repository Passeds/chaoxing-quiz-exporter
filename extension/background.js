// The panel lives inside the page: clicking the icon never opens a tab and never
// interrupts what the user is reading. Pages the extension cannot inject into
// (chrome://, the Web Store, non-Chaoxing sites) keep the old tab behaviour.
chrome.action.onClicked.addListener(async tab => {
  const id = tab && tab.id;
  const inScope = /^https:\/\/[^/]*chaoxing\.com\//i.test((tab && tab.url) || '');
  if (id && inScope) {
    try {
      await chrome.scripting.executeScript({target: {tabId: id, allFrames: false}, files: ['overlay.js']});
      return;
    } catch {}
  }
  chrome.tabs.create({url: chrome.runtime.getURL('dashboard.html') + (id ? '?tab=' + id : '')});
});

// The overlay runs in the page, where the tab id is not directly available.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message) return;
  const tabId = (sender.tab && sender.tab.id) || 0;
  if (message.type === 'cxqk-whoami') {
    respond({tabId});
    return;
  }
  // Escape hatch for pages whose CSP refuses to embed the panel.
  if (message.type === 'cxqk-open-tab') {
    chrome.tabs.create({url: chrome.runtime.getURL('dashboard.html') + (tabId ? '?tab=' + tabId : '')});
    respond({ok: true});
  }
});
