/* global chrome */
const el = id => document.getElementById(id);

async function load() {
  chrome.storage.local.get(
    {
      keywords: "",
      webhookUrl: "",
      webhookToken: "",
      notificationsEnabled: true
    },
    (res) => {
      el("keywords").value = res.keywords || "";
      el("webhookUrl").value = res.webhookUrl || "";
      el("webhookToken").value = res.webhookToken || "";
      el("notificationsEnabled").checked = !!res.notificationsEnabled;
    }
  );
}

function save() {
  const payload = {
    keywords: el("keywords").value.trim(),
    webhookUrl: el("webhookUrl").value.trim(),
    webhookToken: el("webhookToken").value.trim(),
    notificationsEnabled: el("notificationsEnabled").checked
  };
  chrome.storage.local.set(payload, () => setStatus("✅ Settings saved"));
}

function scanNow() {
  chrome.alarms.create("scan", { when: Date.now() + 250 });
  setStatus("⏳ Scan will start in a moment...", 1500);
}

function setStatus(msg, ttl = 2000) {
  const s = el("status");
  s.textContent = msg;
  if (ttl) setTimeout(() => (s.textContent = ""), ttl);
}

el("saveBtn").addEventListener("click", save);
el("scanNowBtn").addEventListener("click", scanNow);
document.addEventListener("DOMContentLoaded", load);
