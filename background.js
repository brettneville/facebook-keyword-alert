/* global chrome */
const DEDUPE_KEY="seenPosts";
const DEDUPE_TTL_MS=86400000;

chrome.runtime.onInstalled.addListener(()=>{
  chrome.alarms.get("scan",a=>{ if(!a) chrome.alarms.create("scan",{periodInMinutes:2}); });
});

chrome.alarms.onAlarm.addListener(alarm=>{ if(alarm.name==="scan") scanAllFbTabs(); });

async function scanAllFbTabs(){
  const tabs=await queryFbTabs();
  if(!tabs.length) return;
  const s=await getSettings();
  const kw=normalizeKeywords(s.keywords);
  if(!kw.length) return;
  for(const tab of tabs){
    try{
      const matches=await requestScanFromTab(tab.id,kw);
      const fresh=await filterNewMatches(matches||[]);
      if(!fresh.length) continue;
      if(s.notificationsEnabled!==false){ await createNotification(`Found ${fresh.length} new match${fresh.length>1?'es':''}`); }
      const body={token:s.webhookToken||"",source:"chrome_extension",matches:fresh,timestamp:new Date().toISOString()};
      if(s.webhookUrl){ await postWithRetry(s.webhookUrl,body,3); }
    }catch(e){ console.debug("[FB Keyword Alert BG] scan error",e); }
  }
}

function queryFbTabs(){ return new Promise(res=>{ chrome.tabs.query({url:["*://*.facebook.com/*","*://*.fb.com/*"]},tabs=>res(tabs||[])); }); }

function requestScanFromTab(tabId,keywords){ return new Promise(res=>{ chrome.tabs.sendMessage(tabId,{type:"SCAN_NOW",keywords},r=>res((r&&r.matches)||[])); }); }

async function getSettings(){ return new Promise(res=>{ chrome.storage.local.get({webhookUrl:"",webhookToken:"",keywords:"",notificationsEnabled:true},res); }); }

function normalizeKeywords(input){ if(!input) return []; if(Array.isArray(input)) return input.map(String).map(s=>s.trim()).filter(Boolean); return String(input).split(/[,
]/).map(s=>s.trim()).filter(Boolean); }

async function filterNewMatches(matches){ const map=await loadSeenMap(); const now=Date.now(); const fresh=[]; for(const m of matches){ const k=(m.postUrl&&m.postUrl.trim())||`${m.group}|${(m.preview||'').slice(0,200)}`; if(map[k]) continue; map[k]=now; fresh.push(m);} await saveSeenMap(map); return fresh; }

function loadSeenMap(){ return new Promise(res=>{ chrome.storage.local.get(DEDUPE_KEY,obj=>{ res(obj[DEDUPE_KEY]||{}); }); }); }

function saveSeenMap(map){ return new Promise(res=>{ const now=Date.now(); const entries=Object.entries(map).filter(([_,ts])=>now-ts<DEDUPE_TTL_MS).sort((a,b)=>b[1]-a[1]).slice(0,800); chrome.storage.local.set({[DEDUPE_KEY]:Object.fromEntries(entries)},res); }); }

async function postWithRetry(url,payload,attempts=3){ for(let i=0;i<attempts;i++){ try{ const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}); if(r.ok) return true; console.warn("[FB Keyword Alert BG] webhook HTTP",r.status);}catch(e){ console.warn("[FB Keyword Alert BG] webhook error",e);} await new Promise(r=>setTimeout(r,1000*(2**i))); } return false; }

function createNotification(message){ return new Promise(res=>{ chrome.notifications.create({type:"basic",iconUrl:"icons/icon48.png",title:"Facebook Keyword Alert",message},res); }); }
