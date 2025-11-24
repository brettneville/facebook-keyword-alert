/* global chrome */
const el = id => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
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

  el("saveBtn").addEventListener("click", () => {
    const payload = {
      keywords: el("keywords").value.trim(),
      webhookUrl: el("webhookUrl").value.trim(),
      webhookToken: el("webhookToken").value.trim(),
      notificationsEnabled: el("notificationsEnabled").checked
    };
    chrome.storage.local.set(payload, () => setStatus("✅ Settings saved"));
  });
});

function setStatus(msg, ttl = 2500) {
  const s = el("status");
  s.textContent = msg;
  if (ttl) setTimeout(() => (s.textContent = ""), ttl);
}
