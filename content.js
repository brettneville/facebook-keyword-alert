/* global chrome */
const PREVIEW_MAX = 500;
const TEXT_MAX = 5000;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "SCAN_NOW") {
    try {
      const keywords = Array.isArray(msg.keywords) ? msg.keywords : [];
      const matches = collectMatches(keywords);
      sendResponse({ matches });
    } catch (e) {
      console.error("[FB Keyword Alert CS] scan error", e);
      sendResponse({ matches: [] });
    }
    return true;
  }
});

function collectMatches(keywords) {
  if (!keywords.length) return [];
  const posts = document.querySelectorAll('[role="article"]');
  const out = [];
  posts.forEach(p => {
    const text = (p.innerText || "").slice(0, TEXT_MAX);
    if (!text) return;
    for (const kw of keywords) {
      if (!kw) continue;
      if (text.toLowerCase().includes(String(kw).toLowerCase())) {
        out.push({
          keyword: kw,
          group: canonicalGroup(),
          postUrl: extractPostUrl(p),
          preview: text.slice(0, PREVIEW_MAX),
          timestamp: extractPostTimestamp(p),
          fullText: text
        });
      }
    }
  });
  return out;
}

function canonicalGroup() {
  try {
    const m = location.pathname.match(/\/groups\/([^\/?#]+)/i);
    return m ? decodeURIComponent(m[1]) : "unknown-group";
  } catch {
    return "unknown-group";
  }
}

function extractPostUrl(post) {
  try {
    const linkSelectors = [
      'a[href*="/permalink/"]',
      'a[href*="/posts/"]',
      'a:has(time[datetime])',
      'time[datetime] ~ a[href]'
    ];
    for (const sel of linkSelectors) {
      const el = post.querySelector(sel);
      if (el && el.href) return new URL(el.href, location.origin).href;
    }
  } catch (e) {
    console.error("[FB Keyword Alert CS] extractPostUrl", e);
  }
  return location.href;
}

function extractPostTimestamp(post) {
  try {
    const t = post.querySelector('time[datetime]') || post.querySelector('[data-utime]');
    if (t) {
      const iso = t.getAttribute('datetime') || t.getAttribute('data-utime');
      if (iso) return new Date(iso).toISOString();
    }
  } catch {}
  return new Date().toISOString();
}
