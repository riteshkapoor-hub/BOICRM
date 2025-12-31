const BUYER_STAGES = [
  "New/Open",
  "Attempting Contact/Working",
  "Connected/Engaged",
  "Meeting Set/Demo Scheduled",
  "Qualified (SQL)",
  "Long-Term Nurture/Inactive",
  "Customer/Closed Won",
  "Closed Lost",
  "Unqualified/Disqualified"
];

const SUPPLIER_STAGES = [
  "New Supplier Request",
  "Vetting/Due Diligence",
  "Approved Supplier",
  "Awaiting Quote/Proposal",
  "Inactive Vendor"
];

const NEXT_STEPS = [
  "",
  "Call",
  "WhatsApp",
  "Email",
  "Send Catalog",
  "Send Pricing",
  "Request Docs",
  "Request Quote",
  "Schedule Meeting",
  "Follow-up",
  "Waiting"
];

function fallbackLists(){
  return {
    countries: ["All","United States","India","UAE","Saudi Arabia","Qatar","Kuwait","Oman","Bahrain","UK","Germany","France","Netherlands","Italy","Spain","Canada","Australia"],
    markets: ["All","USA","EU","GCC","India","UK","Canada","Australia"],
    productTypes: ["All","Chips & Snacks","Powders","Sweeteners","Beverage","Other"]
  };
}
function applyLists(lists){
  // best-effort: if your combo components exist, re-populate through existing setters
  try{
    window.__lists = lists;
  }catch(e){}
}

// BOI CRM — app.js (FULL)
// Adds:
// - WhatsApp action next to phone (Leads + Calendar)
// - Duplicate detection before save (email/phone) via backend checkDuplicate
// - Works with Google Calendar sync fields (calendarEventId/calendarEventUrl) returned by backend
// Keeps:
// - Your existing theme, Calendar UI, Edit UI behaviors

// Default to your deployed Apps Script Web App URL (can be overridden in Settings)
const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzrHBqp6ZcS3lvRir9EchBhsldBS1jRghuQCWhj7XOY4nyuy8NRQP6mz3J1WGNYm-cD/exec";

function isValidExecUrl(u){
  if(!u) return false;
  try{
    const url = new URL(u);
    return /^https?:$/.test(url.protocol);
  }catch(e){
    return false;
  }
}

const LS_SCRIPT_URL = "boi_crm_script_url";
const LS_USER = "boi_crm_user";
const LS_USERID = "boi_crm_userid";
const LS_USEROBJ = "boi_crm_userobj";
;

// Safety polyfill (prevents iOS cache mismatch errors)
if (typeof window.getCurrentUser_ !== 'function') {
  window.getCurrentUser_ = function(){
    try{ const obj = localStorage.getItem(LS_USEROBJ); if(obj) return JSON.parse(obj);}catch(e){}
    const name = localStorage.getItem(LS_USER) || '';
    return { Name: name };
  };
}
const LS_DENSITY = "boi_crm_ui_density";

let USERS = [];
let mode = "supplier";
let html5Qr = null;
let qrRunning = false;
let sessionCount = 0;

// --- Enterprise IA state ---
let __leadsAll = [];
let __leadsAllFetchedAt = 0;
let __followupsAll = [];
let __usersProfiles = {};
let __followupsFetchedAt = 0;

let __leadsCapturedFilter = "all"; // all|today|week|month
let __leadsDueFilter = "all";      // all|overdue|today|next7|none
let __leadsTypeFilter = "all";     // all|supplier|buyer
let __leadsPage = 1;
const __LEADS_PAGE_SIZE = 30;
let __leadsFiltered = [];
let __leadNextFollow = new Map(); // leadId -> {d:Date,label:string,status:string}



// Prevent duplicate saves when network is slow / user taps multiple times
let supplierSaveInFlight = false;
let buyerSaveInFlight = false;

function makeSubmissionId(prefix){
  // Unique-enough for idempotency across retries
  const rnd = Math.random().toString(16).slice(2);
  return `${prefix}_${Date.now()}_${rnd}`;
}

function setSaving(kind, isSaving){
  const ids = (kind === "supplier")
    ? ["saveSupplierNew","saveSupplierClose"]
    : ["saveBuyerNew","saveBuyerClose"];

  ids.forEach(id=>{
    const btn = $(id);
    if(!btn) return;
    btn.disabled = !!isSaving;
    btn.classList.toggle("isLoading", !!isSaving);
  });

  // Small status cue so user knows it's working
  if(isSaving) setStatus("Saving… please wait");
}

let LISTS = { productTypes: [], markets: [] };
let queuedSupplierFU = null;
let queuedBuyerFU = null;

const $ = (id) => document.getElementById(id);

// --- utils: debounce (used by global search + auto-density resize) ---
// Some builds referenced debounce_ without defining it.
function debounce_(fn, wait = 150){
  let t = null;
  return function(...args){
    const ctx = this;
    clearTimeout(t);
    t = setTimeout(()=>fn.apply(ctx, args), wait);
  };
}

// Back-compat alias (in case any older call sites use debounce)
const debounce = debounce_;

function getScriptUrl() {
  return (localStorage.getItem(LS_SCRIPT_URL) || DEFAULT_SCRIPT_URL).trim();
}

function getExecUrl(){
  // Backward-compat alias (older code used getExecUrl()).
  return getScriptUrl();
}

function getScriptUrl_(){
  // Backward-compat alias used by older code paths
  return getScriptUrl();
}

function requireExecUrl(){
  const u = getScriptUrl();
  if(!u) throw new Error("Missing Apps Script /exec URL. Open Settings and paste your Apps Script Web App URL.");
  if(!isValidExecUrl(u)) throw new Error("Invalid Apps Script URL. Open Settings and paste the correct /exec URL.");
  if(!u.endsWith("/exec")) throw new Error("Apps Script URL must end with /exec.");
  return u;
}

function setStatus(msg) { $("status").textContent = msg || ""; }
function updateSummary() { $("summary").textContent = `${sessionCount} leads this session`; }
function setUserPill() {
  const u = getCurrentUser_();
  const name = String(u?.Name || "").trim();
  $("userPill").textContent = `User: ${name || "—"}`;
}

function openOverlay(id) { $(id).classList.add("open"); $(id).setAttribute("aria-hidden","false"); }
function closeOverlay(id) { $(id).classList.remove("open"); $(id).setAttribute("aria-hidden","true"); }

function ensureUser() {
  const u = (localStorage.getItem(LS_USER) || "").trim();
  if (u) return;
  openOverlay("userOverlay");
}


function showTab(which){
  const tabs = ["Capture","Dashboard","Leads","Pipeline","Calendar","Insights"];
  tabs.forEach(t=>{
    const tabBtn = $(`tab${t}`);
    const view = $(`view${t}`);
    if(tabBtn) tabBtn.classList.toggle("isActive", t===which);
    if(view) view.style.display = (t===which) ? "" : "none";
  });

  // Only show lead-type switch + scan on Capture (keeps Home clean)
  const leadType = document.querySelector(".leadtype");
  const btnScan = $("btnScan");
  const summary = $("summary");
  if(leadType) leadType.style.display = (which==="Capture") ? "" : "none";
  if(btnScan) btnScan.style.display = (which==="Capture") ? "" : "none";
  if(summary) summary.style.display = (which==="Capture") ? "" : "none";

  // Lazy-load heavy tabs
  if(which==="Dashboard") refreshHome_();
  if(which==="Leads") refreshLeadsEnterprise_();
  if(which==="Pipeline") refreshPipeline_();
  if(which==="Calendar") refreshCalendar();
  if(which==="Insights") refreshInsights_();
}


function setMode(newMode){
  mode = newMode;
  $("btnSupplier").classList.toggle("isActive", mode==="supplier");
  $("btnBuyer").classList.toggle("isActive", mode==="buyer");
  $("supplierForm").style.display = mode==="supplier" ? "" : "none";
  $("buyerForm").style.display = mode==="buyer" ? "" : "none";
  $("formTitle").textContent = mode==="supplier" ? "Supplier details" : "Buyer details";
}

function esc(s){
  return String(s||"")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function parseISTLabel_(label){
  const s = String(label||"").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if(!m) return null;
  const MM = parseInt(m[1],10);
  const DD = parseInt(m[2],10);
  const YY = 2000 + parseInt(m[3],10);
  let HH = parseInt(m[4],10);
  const MI = parseInt(m[5],10);
  const ap = String(m[6]||"").toUpperCase();
  if(ap==="PM" && HH<12) HH += 12;
  if(ap==="AM" && HH===12) HH = 0;
  // Interpret as IST (+05:30)
  const iso = `${YY}-${String(MM).padStart(2,"0")}-${String(DD).padStart(2,"0")}T${String(HH).padStart(2,"0")}:${String(MI).padStart(2,"0")}:00+05:30`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function startOfDay_(d){
  const x = new Date(d);
  x.setHours(0,0,0,0);
  return x;
}



function safeValue_(el){
  if(!el || typeof el.value === "undefined" || el.value === null) return "";
  return String(el.value);
}



/* ---------- Global quick search ---------- */
let __gsLastQ = "";
let __gsOpen = false;
let __gsIdx = -1;
let __gsRows = [];
let __gsFooter = null;

function initGlobalSearch_(){
  const wrap = $("gsearchWrap");
  const inp = $("globalSearch");
  const res = $("globalSearchResults");
  if(!wrap || !inp || !res) return;

  const close = ()=>{
    __gsOpen = false;
    __gsIdx = -1;
    __gsRows = [];
    __gsFooter = null;
    res.style.display = "none";
    res.innerHTML = "";
  };

  const open = ()=>{ __gsOpen = true; res.style.display = ""; };

  // Focus with /
  document.addEventListener('keydown', (e)=>{
    if(e.key !== '/') return;
    const tag = (document.activeElement && document.activeElement.tagName || "").toLowerCase();
    if(tag === 'input' || tag === 'textarea' || tag === 'select') return;
    e.preventDefault();
    inp.focus();
  });

  // Click outside closes
  document.addEventListener('click', (e)=>{
    if(!__gsOpen) return;
    if(wrap.contains(e.target)) return;
    close();
  });

  const setActive = (idx)=>{
    __gsIdx = idx;
    __gsRows.forEach((el,i)=>el.classList.toggle('isActive', i===__gsIdx));
    if(__gsFooter) __gsFooter.classList.toggle('isActive', __gsIdx === __gsRows.length);
    const activeEl = (__gsIdx >= 0 && __gsIdx < __gsRows.length) ? __gsRows[__gsIdx] : (__gsIdx === __gsRows.length ? __gsFooter : null);
    if(activeEl && activeEl.scrollIntoView){
      activeEl.scrollIntoView({ block:'nearest' });
    }
  };

  const viewInLeads = async (q)=>{
    close();
    try{
      showTab("Leads");
      const box = $("leadsQ");
      if(box){
        box.value = q || "";
        box.dispatchEvent(new Event('input', { bubbles:true }));
      }
      await refreshLeadsEnterprise_();
      if(box) box.focus();
    }catch{}
  };

  inp.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape'){ close(); inp.blur(); return; }
    if(!__gsOpen) return;
    if(e.key === 'ArrowDown'){
      e.preventDefault();
      const max = (__gsRows.length ? __gsRows.length : 0) + (__gsFooter ? 1 : 0);
      if(!max) return;
      const next = Math.min((__gsIdx<0?0:__gsIdx+1), max-1);
      setActive(next);
      return;
    }
    if(e.key === 'ArrowUp'){
      e.preventDefault();
      const max = (__gsRows.length ? __gsRows.length : 0) + (__gsFooter ? 1 : 0);
      if(!max) return;
      const prev = Math.max((__gsIdx<0?0:__gsIdx-1), 0);
      setActive(prev);
      return;
    }
    if(e.key === 'Enter'){
      e.preventDefault();
      if(__gsIdx === __gsRows.length && __gsFooter){
        viewInLeads(__gsLastQ);
        return;
      }
      const el = (__gsIdx>=0 && __gsIdx<__gsRows.length) ? __gsRows[__gsIdx] : null;
      if(el){ el.click(); }
      return;
    }
  });

  const doSearch = debounce_(async ()=>{
    const q = inp.value.trim();
    if(q.length < 2){ close(); return; }
    if(q === __gsLastQ && __gsOpen) return;
    __gsLastQ = q;

    try{
      const data = await getJson({ action:"listLeads", limit:"20", q });
      const rows = data.rows || [];
      if(!rows.length){
        res.innerHTML = `<div class="hint" style="padding:10px 12px">No matches</div>`;
        open();
        return;
      }

      res.innerHTML = rows.slice().reverse().map(r=>{
        const title = `${esc(r.company||'—')} • ${esc(r.contact||'')}`;
        const sub = [r.type, r.country, r.productType].filter(Boolean).map(x=>`<span class="pill pill--sm">${esc(x)}</span>`).join('');
        const when = esc(r.timestampIST||"");
        const id = esc(r.leadId||"");
        const extra = r.email ? esc(r.email) : (r.phone ? esc(r.phone) : "");
        return `
          <div class="gsearch__row" data-gs-id="${id}">
            <div class="gsearch__main">
              <div class="gsearch__title" title="${title}">${esc(r.company||'—')}</div>
              <div class="gsearch__sub">${sub}${extra ? `<span class="muted">${extra}</span>` : ``}</div>
            </div>
            <div class="gsearch__meta">${when}</div>
          </div>
        `;
      }).join('');

      // Footer action: view all results in Leads
      const footer = document.createElement('div');
      footer.className = 'gsearch__footer';
      footer.innerHTML = `
        <button type="button" class="gsearch__view" id="gsViewInLeads">View all results in Leads</button>
      `;
      res.appendChild(footer);
      open();

      __gsRows = Array.from(res.querySelectorAll('.gsearch__row'));
      __gsFooter = res.querySelector('#gsViewInLeads');
      __gsIdx = -1;
      setActive(0);

      if(__gsFooter){
        __gsFooter.addEventListener('click', ()=>viewInLeads(__gsLastQ));
      }

      res.querySelectorAll('[data-gs-id]').forEach(el=>{
        el.addEventListener('click', ()=>{
          const id = el.getAttribute('data-gs-id');
          const row = (data.rows||[]).find(x=>String(x.leadId)===String(id));
          close();
          // Open edit directly; feels enterprise and saves taps.
          openEdit(id, row);
        });
      });

      // Hover sets active row (mouse / trackpad)
      __gsRows.forEach((el,i)=>{
        el.addEventListener('mouseenter', ()=>setActive(i));
      });
    }catch(e){
      console.error(e);
      close();
    }
  }, 180);

  inp.addEventListener('input', doSearch);
  inp.addEventListener('focus', ()=>{ if(inp.value.trim().length>=2) doSearch(); });

  // One-time hint: "/" to search (shown once per device)
  // If the hint couldn't be shown at load (e.g., hidden header), show it on first focus instead.
  try {
    const hintKey = "boi_gsearch_hint_v1";
    const isPhone = window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
    const canShow = ()=> !isPhone && wrap && wrap.offsetParent !== null;

    const showHintOnce = ()=>{
      if(!canShow()) return;
      if(localStorage.getItem(hintKey)) return;
      const hint = document.createElement("div");
      hint.className = "gsearch__hint";
      hint.innerHTML = `<span class="gsearch__hintKey">/</span> to search • <span class="gsearch__hintKey">Esc</span> to close`;
      wrap.appendChild(hint);
      localStorage.setItem(hintKey, "1");
      setTimeout(()=>{ hint.classList.add("hide"); setTimeout(()=>hint.remove(), 600); }, 4200);
    };

    // Show on load if possible
    showHintOnce();

    // If it wasn't visible on load, show it when the user first focuses the search box
    inp.addEventListener('focus', showHintOnce, { once:false });
  } catch(_e) {}

}

// ---------- Notes: Voice-to-text (Web Speech API) ----------
function initVoiceNotes(textareaId, btnId, statusId){
  const ta = $(textareaId);
  const btn = $(btnId);
  const status = $(statusId);
  if(!ta || !btn) return;

  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!Speech){
    btn.style.display = "none";
    if(status) status.textContent = "";
    return;
  }

  let rec = null;
  let running = false;

  btn.addEventListener("click", ()=>{
    if(running){
      try{ rec && rec.stop(); }catch{}
      return;
    }
    rec = new Speech();
    rec.lang = (navigator.language || "en-US");
    rec.interimResults = true;
    rec.continuous = false;

    let finalText = "";
    running = true;
    btn.classList.add("isLoading");
    btn.textContent = "⏺️ Listening…";
    if(status) status.textContent = "Speak now";

    rec.onresult = (ev)=>{
      let interim = "";
      for(let i=ev.resultIndex; i<ev.results.length; i++){
        const t = ev.results[i][0].transcript;
        if(ev.results[i].isFinal) finalText += t + " ";
        else interim += t;
      }
      if(status) status.textContent = interim ? interim : "…";
    };
    rec.onerror = (e)=>{
      if(status) status.textContent = "Mic error";
      console.error(e);
    };
    rec.onend = ()=>{
      running = false;
      btn.classList.remove("isLoading");
      btn.textContent = "🎙️ Dictate";
      if(status) status.textContent = "";
      if(finalText.trim()){
        const sep = ta.value.trim() ? "\n" : "";
        ta.value = ta.value + sep + finalText.trim();
        ta.dispatchEvent(new Event("input"));
      }
    };

    try{ rec.start(); }catch(e){ console.error(e); }
  });
}

// ---------- Drive preview helper ----------
function drivePreviewUrl(fileId){
  if(!fileId) return "";
  return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(fileId)}`;
}

function isImageMime(m){
  return /^image\//i.test(m||"");
}

let __dashAttachView = localStorage.getItem("dashAttachView") || "list";
function setDashAttachView(mode){
  __dashAttachView = mode;
  localStorage.setItem("dashAttachView", mode);
  const bList = $("dashAttachViewList");
  const bGal  = $("dashAttachViewGallery");
  const list = $("dashAttachList");
  const gal = $("dashAttachGallery");
  if(bList) bList.classList.toggle("isActive", mode==="list");
  if(bGal)  bGal.classList.toggle("isActive", mode==="gallery");
  if(list) list.style.display = (mode==="list") ? "" : "none";
  if(gal)  gal.style.display  = (mode==="gallery") ? "" : "none";
}

function istTimeLabel(){
  try{
    return new Intl.DateTimeFormat("en-US", {
      timeZone:"Asia/Kolkata",
      hour:"numeric", minute:"2-digit", hour12:true
    }).format(new Date());
  } catch {
    return new Date().toLocaleTimeString();
  }
}

function addSessionRow(type, main, country){
  const tbody = $("tbl").querySelector("tbody");
  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${esc(type)}</td><td>${esc(main)}</td><td>${esc(country||"")}</td><td>${esc(istTimeLabel())}</td>`;
  tbody.prepend(tr);
}

/* ---------- Combo (searchable dropdown + supports auto-save typed value) ---------- */
function createCombo(containerId, options, placeholder){
  const root = document.getElementById(containerId);
  root.classList.add("combo");

  const input = document.createElement("input");
  input.type="text";
  input.placeholder = placeholder || "";
  input.autocomplete="off";

  const btn = document.createElement("button");
  btn.type="button";
  btn.className="combo__btn";
  btn.textContent="▾";

  // Clear (X) button (enterprise UX): quick reset per filter
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "combo__clear";
  clearBtn.setAttribute("aria-label", "Clear");
  clearBtn.textContent = "×";

  const list = document.createElement("div");
  list.className="combo__list";

  let value = "";

  function normalize(arr){
    return Array.from(new Set(arr.map(String).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
  }

  let optionsSet = new Set();
  function setOptionsInternal(arr){
    options = normalize(arr);
    optionsSet = new Set(options.map(x => String(x).toLowerCase()));
  }
  setOptionsInternal(options);

  function open(){ root.classList.add("open"); render(input.value); }
  function close(){ root.classList.remove("open"); }
  function set(v){
    value = v || "";
    input.value = v || "";
    // show/hide clear X
    clearBtn.style.display = (value || input.value.trim()) ? "" : "none";
    close();
  }

  function render(filter){
    list.innerHTML = "";
    const f = (filter||"").trim().toLowerCase();
    let filtered = options;
    if(f) filtered = options.filter(x=> x.toLowerCase().includes(f));

    filtered.slice(0,200).forEach(opt=>{
      const it = document.createElement("div");
      it.className="combo__item";
      it.textContent = opt;
      it.addEventListener("click", ()=> set(opt));
      list.appendChild(it);
    });
    if(!filtered.length){
      const it = document.createElement("div");
      it.className="combo__item";
      it.style.opacity="0.7";
      it.textContent = "No matches";
      list.appendChild(it);
    }
  }

  input.addEventListener("focus", open);
  input.addEventListener("input", ()=>{
    clearBtn.style.display = input.value.trim() ? "" : "none";
    open();
    render(input.value);
  });
  btn.addEventListener("click", ()=> root.classList.contains("open") ? close() : open());
  clearBtn.addEventListener("click", (e)=>{
    e.preventDefault();
    e.stopPropagation();
    value = "";
    input.value = "";
    clearBtn.style.display = "none";
    close();
    // notify listeners
    try{ input.dispatchEvent(new Event("change", { bubbles:true })); }catch{}
  });
  document.addEventListener("click",(e)=>{ if(!root.contains(e.target)) close(); });

  root.appendChild(input);
  root.appendChild(clearBtn);
  root.appendChild(btn);
  root.appendChild(list);
  render("");

  // initial state
  clearBtn.style.display = "none";

  return {
    get value(){ return value || input.value.trim(); },
    setValue(v){ set(v); },
    setOptions(newOpts){ setOptionsInternal(newOpts); render(input.value); },
    hasOption(v){ return optionsSet.has(String(v||"").trim().toLowerCase()); },
    addOption(v){
      const val = String(v||"").trim();
      if(!val) return;
      if(optionsSet.has(val.toLowerCase())) { set(val); return; }
      setOptionsInternal(options.concat([val]));
      set(val);
    },
    _inputEl: input
  };
}

/* ---------- Lists ---------- */
let supCountry, buyCountry, supMarkets, buyMarkets, supProductType, buyProductType;
let dashCountry, dashMarket, dashPT;
let leadsCountry, leadsMarket, leadsPT;
let editCountry, editMarket, editPT;

const COUNTRIES = [
  "India","United States","United Arab Emirates","Saudi Arabia","Qatar","Oman","Kuwait","Bahrain",
  "United Kingdom","Germany","France","Netherlands","Italy","Spain","Belgium","Sweden","Norway","Denmark",
  "Canada","Australia","New Zealand","Singapore","Malaysia","Indonesia","Thailand","Vietnam","Philippines",
  "Japan","South Korea","China","Hong Kong","Taiwan",
  "South Africa","Kenya","Nigeria","Egypt","Morocco",
  "Brazil","Mexico","Argentina","Chile",
  "Russia","Ukraine","Belarus","Poland","Czech Republic","Romania","Greece","Turkey"
];

/* ---------- Phone country code helpers ---------- */
const DIAL_CODES = {
  "India": "91",
  "United States": "1",
  "Canada": "1",
  "United Arab Emirates": "971",
  "Saudi Arabia": "966",
  "Qatar": "974",
  "Oman": "968",
  "Kuwait": "965",
  "Bahrain": "973",
  "United Kingdom": "44",
  "Germany": "49",
  "France": "33",
  "Netherlands": "31",
  "Italy": "39",
  "Spain": "34",
  "Belgium": "32",
  "Sweden": "46",
  "Norway": "47",
  "Denmark": "45",
  "Australia": "61",
  "New Zealand": "64",
  "Singapore": "65",
  "Malaysia": "60",
  "Indonesia": "62",
  "Thailand": "66",
  "Vietnam": "84",
  "Philippines": "63",
  "Japan": "81",
  "South Korea": "82",
  "China": "86",
  "Hong Kong": "852",
  "Taiwan": "886",
  "South Africa": "27",
  "Kenya": "254",
  "Nigeria": "234",
  "Egypt": "20",
  "Morocco": "212",
  "Brazil": "55",
  "Mexico": "52",
  "Argentina": "54",
  "Chile": "56",
  "Russia": "7",
  "Ukraine": "380",
  "Belarus": "375",
  "Poland": "48",
  "Czech Republic": "420",
  "Romania": "40",
  "Greece": "30",
  "Turkey": "90"
};

function digitsOnly(s){ return String(s||"").replace(/[^\d]/g,""); }

function dialCodeForCountry(country){
  const c = String(country||"").trim();
  return DIAL_CODES[c] || "";
}

function normalizePhone(country, raw){
  const s = String(raw||"").trim();
  if(!s) return "";

  if(s.startsWith("+")){
    const d = digitsOnly(s);
    return d ? ("+" + d) : "";
  }

  const d = digitsOnly(s);
  if(!d) return "";

  const cc = dialCodeForCountry(country);

  if(cc){
    if(d.startsWith(cc)) return "+" + d;
    return "+" + cc + d;
  }
  return "+" + d;
}

function applyCountryCodeToInput(country, inputEl){
  if(!inputEl) return;
  const cc = dialCodeForCountry(country);
  if(!cc) return;

  const v = String(inputEl.value||"").trim();
  if(!v){
    inputEl.value = "+" + cc + " ";
    return;
  }
  if(v && !v.startsWith("+")){
    inputEl.value = normalizePhone(country, v);
  }
}

// Product Types requested (exact)
const DEFAULT_PRODUCT_TYPES = [
  "Chips & Snacks",
  "Powders",
  "Onion & Garlic Products",
  "Freeze Dried Food",
  "Beverage",
  "Sweetner"
];

// Market buckets
const DEFAULT_MARKETS = [
  "USA",
  "Canada",
  "UK",
  "EU",
  "GCC (UAE/KSA/Qatar/Oman/Kuwait/Bahrain)",
  "UAE",
  "Saudi Arabia",
  "Qatar",
  "India",
  "Australia",
  "New Zealand",
  "Singapore",
  "Malaysia",
  "Indonesia",
  "Thailand",
  "Vietnam",
  "Philippines",
  "Japan",
  "South Korea",
  "South Africa",
  "Nigeria",
  "Kenya",
  "Brazil",
  "Mexico"
];

function refreshAllCombos(){
  supCountry.setOptions(COUNTRIES);
  buyCountry.setOptions(COUNTRIES);
  dashCountry.setOptions(COUNTRIES);
  leadsCountry.setOptions(COUNTRIES);
  editCountry.setOptions(COUNTRIES);

  supMarkets.setOptions(LISTS.markets || []);
  buyMarkets.setOptions(LISTS.markets || []);
  dashMarket.setOptions(LISTS.markets || []);
  leadsMarket.setOptions(LISTS.markets || []);
  editMarket.setOptions(LISTS.markets || []);

  supProductType.setOptions(LISTS.productTypes || []);
  buyProductType.setOptions(LISTS.productTypes || []);
  dashPT.setOptions(LISTS.productTypes || []);
  leadsPT.setOptions(LISTS.productTypes || []);
  editPT.setOptions(LISTS.productTypes || []);
}

async function loadLists(){
  const execUrl = getExecUrl();
  if(!execUrl){
    console.warn("Lists failed. Using fallback defaults. Missing /exec URL.");
    applyLists(fallbackLists());
    return;
  }

  const data = await getJson({ action:"lists" });
  const got = data.lists || { productTypes:[], markets:[] };

  LISTS = {
    productTypes: (got.productTypes && got.productTypes.length) ? got.productTypes : DEFAULT_PRODUCT_TYPES.slice(),
    markets: (got.markets && got.markets.length) ? got.markets : DEFAULT_MARKETS.slice()
  };
}

/* ---------- Auto-save NEW Market/ProductType typed by user ---------- */
async function maybeSaveListItem(listType, combo){
  const v = String(combo.value||"").trim();
  if(!v) return;

  if(combo.hasOption && combo.hasOption(v)) return;

  if(combo.addOption) combo.addOption(v);

  try{
    await postPayload({ action:"addListItem", listType, value:v });
    await loadLists();
    refreshAllCombos();
  }catch(e){
    console.warn("Could not save list item:", e);
  }
}

function wireAutosaveBlur(combo, listType){
  if(!combo || !combo._inputEl) return;
  combo._inputEl.addEventListener("blur", ()=>maybeSaveListItem(listType, combo));
}

/* ---------- Files to base64 ---------- */
function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>{
      const s=String(r.result||"");
      resolve(s.includes("base64,") ? s.split("base64,")[1] : "");
    };
    r.onerror=reject;
    r.readAsDataURL(file);
  });
}

async function collectUploads(catalogInputId, cardInputId){
  const catalogFiles=[];
  const cat=$(catalogInputId);
  if(cat?.files?.length){
    for(const f of cat.files){
      catalogFiles.push({
        name:f.name,
        mimeType:f.type||"application/octet-stream",
        dataBase64: await fileToBase64(f)
      });
    }
  }
  let cardFile=null;
  const card=$(cardInputId);
  if(card?.files?.length){
    const f=card.files[0];
    cardFile={ name:f.name, mimeType:f.type||"image/jpeg", dataBase64: await fileToBase64(f) };
  }
  return { catalogFiles, cardFile };
}

/* ---------- Backend calls ---------- */
async function postPayload(obj){
  setStatus("Saving…");
  const execUrl = requireExecUrl();
  const body = new URLSearchParams();
  body.set("payload", JSON.stringify(obj));

  const res = await fetch(execUrl, { method:"POST", body });
  const text = await res.text();

  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Server did not return JSON: ${text.slice(0,140)}`); }

  if(json.result !== "success") throw new Error(json.message || "Save failed");
  setStatus("Saved ✓");
  return json;
}

async function getJson(params){
  const execUrl = requireExecUrl();

  const url = new URL(execUrl);
  Object.entries(params).forEach(([k,v])=>{
    if(v!==undefined && v!==null && String(v).trim()!=="") url.searchParams.set(k,String(v));
  });

  const res = await fetch(url.toString(), { method:"GET" });
  const text = await res.text();

  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Server did not return JSON: ${text.slice(0,140)}`); }

  if(json.result !== "success") throw new Error(json.message || "Request failed");
  return json;
}

/* ---------- Duplicate detection (email/phone) ---------- */
function normEmail(s){ return String(s||"").trim().toLowerCase(); }
function normDigits(s){ return digitsOnly(String(s||"")); }

async function checkDuplicatesBeforeSave({ leadId="", email="", phone="", phone2="" }){
  const e = normEmail(email);
  const p1 = normDigits(phone);
  const p2 = normDigits(phone2);

  if(!e && !p1 && !p2) return true;

  let data;
  try{
    data = await getJson({
      action: "checkDuplicate",
      leadId: leadId || "",
      email: e || "",
      phone: p1 || "",
      phone2: p2 || ""
    });
  }catch(err){
    // If duplicate check fails, don't block saving.
    console.warn("Duplicate check failed:", err);
    return true;
  }

  const matches = data.matches || [];
  if(!matches.length) return true;

  const lines = matches.slice(0,5).map(m=>{
    return `• ${m.leadId} — ${m.type || ""} — ${m.company || m.contact || ""} — ${m.timestamp || ""}`;
  });

  const msg =
    `Potential duplicate lead found (${matches.length}).\n\n` +
    lines.join("\n") +
    (matches.length>5 ? `\n• +${matches.length-5} more…` : "") +
    `\n\nDo you want to SAVE anyway?`;

  return window.confirm(msg);
}

/* ---------- QR Scan (LOCAL, PERMANENT) ---------- */
function parseVCard(text){
  const out={fullName:"",company:"",email:"",phone:""};
  const t=String(text||"").trim();
  if(!t.includes("BEGIN:VCARD")) return out;
  const lines=t.split(/\r?\n/);
  for(const l of lines){
    if(l.startsWith("FN:")) out.fullName=l.substring(3).trim();
    if(l.startsWith("ORG:")) out.company=l.substring(4).trim();
    if(l.startsWith("EMAIL")) out.email=(l.split(":")[1]||"").trim();
    if(l.startsWith("TEL") && !out.phone) out.phone=(l.split(":")[1]||"").trim();
  }
  return out;
}

function applyScan(raw){
  const p=parseVCard(raw);
  if(mode==="supplier"){
    if(p.company && !$("supCompany").value) $("supCompany").value=p.company;
    if(p.fullName && !$("supContact").value) $("supContact").value=p.fullName;
    if(p.email && !$("supEmail").value) $("supEmail").value=p.email;
    if(p.phone && !$("supPhone").value) $("supPhone").value=p.phone;
    $("supQR").value=raw;
  } else {
    if(p.fullName && !$("buyContact").value) $("buyContact").value=p.fullName;
    if(p.company && !$("buyCompany").value) $("buyCompany").value=p.company;
    if(p.email && !$("buyEmail").value) $("buyEmail").value=p.email;
    if(p.phone && !$("buyPhone").value) $("buyPhone").value=p.phone;
    $("buyQR").value=raw;
  }
}

function isSecureContextForCamera(){
  return window.isSecureContext || location.hostname === "localhost";
}

async function openQr(){
  openOverlay("qrOverlay");

  if(!isSecureContextForCamera()){
    alert("QR scanner requires HTTPS to access the camera. Please open the CRM using the https:// link.");
    closeQr();
    return;
  }
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    alert("Camera is not available in this browser/environment.");
    closeQr();
    return;
  }

  // Must be loaded by index.html: <script src="./vendor/html5-qrcode.min.js"></script>
  if(!window.Html5Qrcode){
    alert("QR library not loaded. Confirm index.html includes ./vendor/html5-qrcode.min.js above app.js");
    closeQr();
    return;
  }

  const el = document.getElementById("qr-reader");
  if(!el){
    alert("QR reader container not found (qr-reader).");
    closeQr();
    return;
  }

  if(!html5Qr) html5Qr = new Html5Qrcode("qr-reader");
  if(qrRunning) return;

  try{
    await html5Qr.start(
      { facingMode:"environment" },
      { fps:10, qrbox:{ width:260, height:260 } },
      (decodedText)=>{ applyScan(decodedText); closeQr(); },
      ()=>{}
    );
    qrRunning = true;
  }catch(err){
    console.error(err);
    alert("Could not start camera. Allow camera permission and try again.");
    closeQr();
  }
}

async function closeQr(){
  closeOverlay("qrOverlay");
  if(html5Qr && qrRunning){
    try{ await html5Qr.stop(); }catch{}
    try{ await html5Qr.clear(); }catch{}
  }
  qrRunning = false;
}

/* ---------- Follow-up formatting ---------- */
function formatISTFromInputs(dateVal, timeVal){
  if(!dateVal || !timeVal) return { label:"", iso:"" };
  const iso = `${dateVal}T${timeVal}:00+05:30`;

  const [y,m,d] = dateVal.split("-").map(n=>parseInt(n,10));
  const [hh,mm] = timeVal.split(":").map(n=>parseInt(n,10));
  const dt = new Date(y, m-1, d, hh, mm, 0);

  try{
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone:"Asia/Kolkata",
      month:"2-digit",day:"2-digit",year:"2-digit",
      hour:"numeric",minute:"2-digit",hour12:true
    }).format(dt).replace(",", "");
    return { label, iso };
  } catch {
    return { label: dt.toLocaleString(), iso };
  }
}

function applyQuickFU(dateInputId, timeInputId, daysAhead){
  const dEl = $(dateInputId);
  const tEl = $(timeInputId);
  if(!dEl || !tEl) return;
  const base = new Date();
  base.setDate(base.getDate() + (daysAhead||0));
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth()+1).padStart(2,"0");
  const dd = String(base.getDate()).padStart(2,"0");
  dEl.value = `${yyyy}-${mm}-${dd}`;
  tEl.value = "10:00";
  dEl.dispatchEvent(new Event("input"));
  tEl.dispatchEvent(new Event("input"));
}

function queueFollowUp(kind){
  const dateId = (kind==="supplier") ? "supFUDate" : "buyFUDate";
  const timeId = (kind==="supplier") ? "supFUTime" : "buyFUTime";
  const notesId = (kind==="supplier") ? "supFUNotes" : "buyFUNotes";
  const outId  = (kind==="supplier") ? "supFULast" : "buyFULast";

  const d = $(dateId).value;
  const t = $(timeId).value;
  const notes = $(notesId).value.trim();

  if(!d || !t){
    if(kind==="supplier") queuedSupplierFU=null; else queuedBuyerFU=null;
    $(outId).textContent = "";
    return;
  }

  const f = formatISTFromInputs(d,t);
  const fu = { scheduledAtIST: f.label, scheduledAtISO: f.iso, notes };

  if(kind==="supplier") queuedSupplierFU = fu;
  else queuedBuyerFU = fu;

  $(outId).textContent = `Will schedule after save: ${f.label}`;
}

/* ---------- Clear forms ---------- */
function clearSupplier(){
  ["supCompany","supContact","supTitle","supEmail","supPhone","supPhone2","supWebsite","supSocial",
   "supExFactory","supFOB","supProducts","supQR","supNotes"
  ].forEach(id=>$(id).value="");
  $("supPL").value="";
  $("supCatalogFiles").value="";
  $("supCardFile").value="";
  $("supResult").innerHTML="";
  supCountry.setValue(""); supMarkets.setValue(""); supProductType.setValue("");

  $("supFUDate").value=""; $("supFUTime").value=""; $("supFUNotes").value="";
  $("supFULast").textContent="";
  queuedSupplierFU=null;
}

function clearBuyer(){
  ["buyContact","buyCompany","buyTitle","buyEmail","buyPhone","buyPhone2","buyWebsite","buySocial",
   "buyNeeds","buyQR","buyNotes"
  ].forEach(id=>$(id).value="");
  $("buyPL").value="";
  $("buyCatalogFiles").value="";
  $("buyCardFile").value="";
  $("buyResult").innerHTML="";
  buyCountry.setValue(""); buyMarkets.setValue(""); buyProductType.setValue("");

  $("buyFUDate").value=""; $("buyFUTime").value=""; $("buyFUNotes").value="";
  $("buyFULast").textContent="";
  queuedBuyerFU=null;
}

/* ---------- Save handlers ---------- */
async function saveSupplier(closeAfter){
  if(supplierSaveInFlight) return;
  const company = $("supCompany").value.trim();
  const contact = $("supContact").value.trim();
  const country = supCountry.value;

  if(!company || !contact || !country){
    alert("Please fill Company, Contact, and Country.");
    return;
  }

  supplierSaveInFlight = true;
  setSaving("supplier", true);

  try {
    queueFollowUp("supplier");
    const enteredBy = (localStorage.getItem(LS_USER)||"Unknown").trim() || "Unknown";

    await maybeSaveListItem("market", supMarkets);
    await maybeSaveListItem("productType", supProductType);

    // Normalize phones now
    const phone = normalizePhone(country, $("supPhone").value);
    const phone2 = normalizePhone(country, $("supPhone2").value);
    const email = $("supEmail").value.trim();

    if(!email && !digitsOnly(phone)){
      alert("Please provide at least Phone or Email.");
      return;
    }

    // Duplicate check (block save unless user confirms)
    const ok = await checkDuplicatesBeforeSave({ email, phone, phone2 });
    if(!ok) return;

    const uploads = await collectUploads("supCatalogFiles","supCardFile");

    const payload = {
      action: "saveLeadFast",
      fastMode: true,
      type:"supplier",
      submissionId: makeSubmissionId("sup"),
      enteredBy,
      company,
      contact,
      title:$("supTitle").value.trim(),
      email,
      phone,
      phone2,
      website:$("supWebsite").value.trim(),
      social:$("supSocial").value.trim(),
      country,
      markets:supMarkets.value,
      privateLabel:$("supPL").value.trim(),
      productType:supProductType.value,
      productsOrNeeds:$("supProducts").value.trim(),
      exFactory:$("supExFactory").value.trim(),
      fob:$("supFOB").value.trim(),
      qrData:$("supQR").value.trim(),
      stage: safeValue_($("supStage")),
      nextStep: safeValue_($("supNextStep")),
      notes: $("supNotes").value.trim(),
      catalogFiles:uploads.catalogFiles,
      cardFile:uploads.cardFile,
      pendingFollowUp: queuedSupplierFU,
      createCalendarEvent: false
    };

    const res = await postPayload(payload);

  const folderLine = res.folderUrl ? `Drive folder: <a target="_blank" rel="noopener" href="${esc(res.folderUrl)}">Open folder</a><br>` : "Drive folder: <i>not created yet (fast save)</i><br>";
  const itemsLine = res.itemsSheetUrl ? `Items sheet: <a target="_blank" rel="noopener" href="${esc(res.itemsSheetUrl)}">Open items</a>` : "Items sheet: <i>not created yet (fast save)</i>";
  const attachLine = (typeof res.attachmentCount === "number") ? `<br>Attachments saved: <b>${esc(res.attachmentCount)}</b> (${res.attachmentsRootUrl ? `<a target="_blank" rel="noopener" href="${esc(res.attachmentsRootUrl)}">Open root folder</a>` : ""})` : "";
  $("supResult").innerHTML =
    `Lead ID: <b>${esc(res.leadId)}</b><br>` +
    folderLine +
    itemsLine +
    attachLine;

  sessionCount++; updateSummary();
  addSessionRow("Supplier", `${company}${payload.contact? " / "+payload.contact:""}`, payload.country);

  clearSupplier();
  if(closeAfter) showTab("Dashboard");

  } finally {
    supplierSaveInFlight = false;
    setSaving("supplier", false);
  }
}

async function saveBuyer(closeAfter){
  if(buyerSaveInFlight) return;
  const contact = $("buyContact").value.trim();
  const company = $("buyCompany").value.trim();
  const country = buyCountry.value;

  if(!company || !contact || !country){
    alert("Please fill Company, Contact, and Country.");
    return;
  }

  buyerSaveInFlight = true;
  setSaving("buyer", true);

  try {
    queueFollowUp("buyer");
    const enteredBy = (localStorage.getItem(LS_USER)||"Unknown").trim() || "Unknown";

    await maybeSaveListItem("market", buyMarkets);
    await maybeSaveListItem("productType", buyProductType);

    const phone = normalizePhone(country, $("buyPhone").value);
    const phone2 = normalizePhone(country, $("buyPhone2").value);
    const email = $("buyEmail").value.trim();

    if(!email && !digitsOnly(phone)){
      alert("Please provide at least Phone or Email.");
      return;
    }

    const ok = await checkDuplicatesBeforeSave({ email, phone, phone2 });
    if(!ok) return;

    const uploads = await collectUploads("buyCatalogFiles","buyCardFile");

    const payload = {
      action: "saveLeadFast",
      fastMode: true,
      type:"buyer",
      submissionId: makeSubmissionId("buy"),
      enteredBy,
      company,
      contact,
      title:$("buyTitle").value.trim(),
      email,
      phone,
      phone2,
      website:$("buyWebsite").value.trim(),
      social:$("buySocial").value.trim(),
      country,
      markets:buyMarkets.value,
      privateLabel:$("buyPL").value.trim(),
      productType:buyProductType.value,
      productsOrNeeds:$("buyNeeds").value.trim(),
      qrData:$("buyQR").value.trim(),
      stage: safeValue_($("buyStage")),
      nextStep: safeValue_($("buyNextStep")),
      notes: $("buyNotes").value.trim(),
      catalogFiles:uploads.catalogFiles,
      cardFile:uploads.cardFile,
      pendingFollowUp: queuedBuyerFU,
      createCalendarEvent: false
    };

    const res = await postPayload(payload);

  const folderLine = res.folderUrl ? `Drive folder: <a target="_blank" rel="noopener" href="${esc(res.folderUrl)}">Open folder</a><br>` : "Drive folder: <i>not created yet (fast save)</i><br>";
  const itemsLine = res.itemsSheetUrl ? `Items sheet: <a target="_blank" rel="noopener" href="${esc(res.itemsSheetUrl)}">Open items</a>` : "Items sheet: <i>not created yet (fast save)</i>";
  const attachLine = (typeof res.attachmentCount === "number") ? `<br>Attachments saved: <b>${esc(res.attachmentCount)}</b> (${res.attachmentsRootUrl ? `<a target="_blank" rel="noopener" href="${esc(res.attachmentsRootUrl)}">Open root folder</a>` : ""})` : "";
  $("buyResult").innerHTML =
    `Lead ID: <b>${esc(res.leadId)}</b><br>` +
    folderLine +
    itemsLine +
    attachLine;

  sessionCount++; updateSummary();
  addSessionRow("Buyer", `${contact}${payload.company? " / "+payload.company:""}`, payload.country);

  clearBuyer();
  if(closeAfter) showTab("Dashboard");

  } finally {
    buyerSaveInFlight = false;
    setSaving("buyer", false);
  }
}

/* ---------- Icons + links ---------- */
function rowLink(url, label){
  if(!url) return "";
  return `<a target="_blank" rel="noopener" href="${esc(url)}">${esc(label)}</a>`;
}

function safeTel(phone){
  const d = digitsOnly(phone);
  if(!d) return "";
  return String(phone||"").trim().startsWith("+") ? String(phone||"").trim() : "+"+d;
}

function safeWa(phone){
  // wa.me wants digits only (no +)
  const d = digitsOnly(phone);
  return d ? `https://wa.me/${d}` : "";
}

function svgPhone(){
  // Lucide-style phone (stroke uses currentColor)
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07
             19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.08 4.18
             2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.12.81.3 1.6.54 2.36
             a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.72-1.72
             a2 2 0 0 1 2.11-.45c.76.24 1.55.42 2.36.54A2 2 0 0 1 22 16.92z"
          stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}
function svgMail(){
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 6h16v12H4z" stroke="currentColor" stroke-width="1.8"/>
    <path d="M4 7l8 6 8-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
function svgEdit(){
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 20h4l10.5-10.5-4-4L4 16v4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M13.5 6.5l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`;
}
function svgWhatsApp(){
  // Lightweight "chat + handset" icon (WhatsApp action) using currentColor
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M20.5 12a8.5 8.5 0 0 1-12.7 7.3L4 20l.7-3.7A8.5 8.5 0 1 1 20.5 12z"
      stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M10.2 10.3c.5 1.4 1.6 2.6 3.2 3.2l.9-.9c.2-.2.5-.3.8-.2l1.4.6
             c.3.1.5.4.5.7 0 1-.8 1.8-1.8 1.8-3.6 0-6.6-3-6.6-6.6
             0-1 .8-1.8 1.8-1.8.3 0 .6.2.7.5l.6 1.4c.1.3 0 .6-.2.8l-.9.9z"
      stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

let leadsView = "cards"; // "cards" | "list"
function setLeadsView(v){
  leadsView = v;
  const cBtn = $("btnLeadsViewCards");
  const lBtn = $("btnLeadsViewList");
  if(cBtn && lBtn){
    cBtn.classList.toggle("isActive", v==="cards");
    lBtn.classList.toggle("isActive", v==="list");
  }
  const cards = $("leadsCards");
  const tableWrap = $("leadsTable")?.closest(".tablewrap");
  if(cards) cards.style.display = (v==="cards") ? "" : "none";
  if(tableWrap) tableWrap.style.display = (v==="list") ? "" : "none";
}

function renderLeadCard(r){
  const wa1 = safeWa(r.phone);
  const wa2 = safeWa(r.phone2);
  const header = (r.company || r.contact || "—").trim();
  const sub = [r.type, r.country, r.productType].filter(Boolean).join(" • ");
  const tags = [r.markets].filter(Boolean).join(" • ");
  return `
    <div class="leadcard">
      <div class="leadcard__top">
        <div>
          <div class="leadcard__title">${esc(header)}</div>
          <div class="leadcard__sub">${esc(sub)}</div>
          ${tags ? `<div class="leadcard__tags">${esc(tags)}</div>` : ``}
        </div>
        <div class="leadcard__time">${esc(r.timestampIST||"")}</div>
      </div>

      <div class="leadcard__body">
        ${r.contact ? `<div class="leadcard__row"><span class="muted">Contact</span> <span>${esc(r.contact)}</span></div>` : ``}
        ${r.email ? `<div class="leadcard__row"><span class="muted">Email</span> <a href="mailto:${esc(r.email)}">${esc(r.email)}</a></div>` : ``}
        ${r.phone ? `<div class="leadcard__row"><span class="muted">Phone</span> <a href="tel:${esc(safeTel(r.phone))}">${esc(r.phone)}</a></div>` : ``}
      </div>

      <div class="leadcard__actions">
        ${r.phone ? `<a class="iconbtn" href="tel:${esc(safeTel(r.phone))}">${svgPhone()} Call</a>` : ``}
        ${wa1 ? `<a class="iconbtn" target="_blank" rel="noopener" href="${esc(wa1)}">${svgWhatsApp()} WhatsApp</a>` : ``}
        ${r.leadId && wa1 ? `<button class="iconbtn" type="button" data-intro="1" data-leadid="${esc(r.leadId)}" title="WhatsApp Intro">${svgWhatsApp()} Intro</button>` : ``}
        ${r.email ? `<a class="iconbtn" href="mailto:${esc(r.email)}">${svgMail()} Email</a>` : ``}
        ${r.leadId ? `<button class="iconbtn" type="button" data-edit="${esc(r.leadId)}">${svgEdit()} Edit</button>` : ``}
      </div>
    </div>
  `;
}

/* ---------- Dashboard / Leads ---------- */
function renderKpis(k){
  const el = $("kpis");
  el.innerHTML = "";
  const items = [
    ["Suppliers", k.suppliers||0, {type:"supplier"}],
    ["Buyers", k.buyers||0, {type:"buyer"}],
    ["Overdue", k.overdue||0, {due:"overdue"}],
    ["Due Today", k.dueToday||0, {due:"today"}],
    ["Next 7 Days", k.next7||0, {due:"next7"}],
    ["Captured Today", k.capturedToday||0, {captured:"today"}]
  ];
  items.forEach(([label,val,flt])=>{
    const d=document.createElement("div");
    d.className="kpi";
    if(flt){ d.classList.add("kpi--click"); d.onclick = ()=>{ applyKpiFilter_(flt); }; }
    d.innerHTML = `<div class="kpi__v">${esc(val)}</div><div class="kpi__l">${esc(label)}</div>`;
    el.appendChild(d);
  });
}



/* ---------- Enterprise IA: cached loads + quick filters + pagination ---------- */
async function getLeadsAll_(){
  const now = Date.now();
  if(__leadsAll && __leadsAll.length && (now - __leadsAllFetchedAt) < 60_000) return __leadsAll;
  const execUrl = getExecUrl();
  if(!execUrl) throw new Error("Missing /exec URL");
  const data = await getJson({ action:"listLeads", limit:"5000" });
  const rows = Array.isArray(data.rows) ? data.rows : [];
  __leadsAll = rows;
  __leadsAllFetchedAt = now;
  return __leadsAll;
}

async function getFollowUpsAll_(){
  const now = Date.now();
  if(__followupsAll && __followupsAll.length && (now - __followupsFetchedAt) < 60_000) return __followupsAll;
  const execUrl = getExecUrl();
  if(!execUrl) throw new Error("Missing /exec URL");
  // listFollowUps already exists for Calendar
  const data = await getJson({ action:"listFollowUps", limit:"5000" });
  const rows = Array.isArray(data.rows) ? data.rows : [];
  __followupsAll = rows;
  __followupsFetchedAt = now;
  return __followupsAll;
}

function computeNextFollowMap_(followRows){
  __leadNextFollow = new Map();
  const byLead = new Map();
  (followRows||[]).forEach(f=>{
    const id = String(f.leadId||"").trim();
    if(!id) return;
    const d = f.scheduledAtISO ? new Date(f.scheduledAtISO) : parseISTLabel_(f.scheduledAtIST);
    if(!d || isNaN(d.getTime())) return;
    if(!byLead.has(id)) byLead.set(id, []);
    byLead.get(id).push({ d, label: String(f.scheduledAtIST||""), status: String(f.status||""), notes: String(f.notes||"") });
  });
  byLead.forEach((arr, id)=>{
    arr.sort((a,b)=>a.d - b.d);
    __leadNextFollow.set(id, arr[0]);
  });
}

function setChipGroupActive_(root, selector, key, value){
  if(!root) return;
  root.querySelectorAll(selector).forEach(btn=>{
    const v = btn.getAttribute(key);
    btn.classList.toggle("isActive", v === value);
  });
}

function capturedMatch_(lead, now){
  if(__leadsCapturedFilter === "all") return true;
  const d = parseISTLabel_(lead.timestampIST);
  if(!d) return false;
  const localNow = now;
  const sNow = startOfDay_(localNow);
  const sLead = startOfDay_(d);
  const diffDays = Math.round((sNow - sLead) / 86400000);
  if(__leadsCapturedFilter === "today") return diffDays === 0;
  if(__leadsCapturedFilter === "week") return diffDays >= 0 && diffDays < 7;
  if(__leadsCapturedFilter === "month") return diffDays >= 0 && diffDays < 31;
  return true;
}

function dueBucket_(lead, now){
  const nf = __leadNextFollow.get(String(lead.leadId||""));
  if(!nf) return "none";
  const d = nf.d;
  const sNow = startOfDay_(now);
  const sD = startOfDay_(d);
  const diffDays = Math.round((sD - sNow) / 86400000);
  if(diffDays < 0) return "overdue";
  if(diffDays === 0) return "today";
  if(diffDays <= 7) return "next7";
  return "later";
}

function applyEnterpriseLeadFilters_(rows){
  const q = safeValue_($("leadsQ")).trim().toLowerCase();
  const c = safeValue_(leadsCountry).trim().toLowerCase();
  const m = safeValue_(leadsMarket).trim().toLowerCase();
  const pt = safeValue_(leadsPT).trim().toLowerCase();
  const now = new Date();

  let out = (rows||[]).slice();

  // Newest first (sheet order is oldest->newest; reverse)
  out = out.reverse();

  // type filter (all|supplier|buyer)
  if(__leadsTypeFilter !== "all"){
    out = out.filter(r=>String(r.type||"").toLowerCase() === __leadsTypeFilter);
  }

  // dropdown filters
  out = out.filter(r=>{
    if(c && String(r.country||"").toLowerCase() !== c) return false;
    if(pt && String(r.productType||"").toLowerCase().indexOf(pt) === -1) return false;
    if(m && String(r.markets||"").toLowerCase().indexOf(m) === -1) return false;
    return true;
  });

  // captured quick filter
  out = out.filter(r=>capturedMatch_(r, now));

  // due filter
  if(__leadsDueFilter !== "all"){
    out = out.filter(r=>{
      const b = dueBucket_(r, now);
      return b === __leadsDueFilter;
    });
  }

  // search contains
  if(q){
    out = out.filter(r=>{
      const hay = (
        (r.timestampIST||"")+" "+(r.type||"")+" "+(r.enteredBy||"")+" "+
        (r.company||"")+" "+(r.contact||"")+" "+(r.email||"")+" "+
        (r.phone||"")+" "+(r.phone2||"")+" "+(r.country||"")+" "+
        (r.markets||"")+" "+(r.productType||"")
      ).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  __leadsFiltered = out;
  return out;
}

function renderLeadsPage_(){
  const cards = $("leadsCards");
  const tbody = $("leadsTable")?.querySelector("tbody");
  const pager = $("leadsPager");
  const hint = $("leadsPagerHint");

  const total = __leadsFiltered.length;
  const upto = Math.min(total, __leadsPage * __LEADS_PAGE_SIZE);
  const slice = __leadsFiltered.slice(0, upto);

  // cards
  if(cards){
    cards.innerHTML = slice.map(renderLeadCard).join("");
    cards.querySelectorAll("[data-edit]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id = btn.getAttribute("data-edit");
        const row = slice.find(x=>String(x.leadId)===String(id));
        openEdit(id, row);
      });
    });
  }

  // list
  if(tbody){
    tbody.innerHTML = "";
    slice.forEach(r=>{
      const wa1 = safeWa(r.phone);
      const wa2 = safeWa(r.phone2);
      const tr=document.createElement("tr");
      tr.innerHTML = `
        <td>${esc(r.timestampIST||"")}</td>
        <td>${esc(r.type||"")}</td>
        <td>${esc(r.company||"")}</td>
        <td>${esc(r.contact||"")}</td>
        <td>
          <div class="cellicons">
            ${r.email ? `<a class="iconlink" href="mailto:${esc(r.email)}" title="Email">${svgMail()}<span>${esc(r.email)}</span></a>` : `<span class="smallmuted">—</span>`}
          </div>
        </td>
        <td>
          <div class="cellicons">
            ${r.phone ? `<a class="iconlink" href="tel:${esc(safeTel(r.phone))}" title="Call">${svgPhone()}<span>${esc(r.phone)}</span></a>` : `<span class="smallmuted">—</span>`}
            ${wa1 ? `<a class="iconlink" href="${esc(wa1)}" target="_blank" rel="noopener" title="WhatsApp">${svgWhatsApp()}<span>WhatsApp</span></a>` : ``}
            ${r.phone2 ? `<a class="iconlink" href="tel:${esc(safeTel(r.phone2))}" title="Call (2)">${svgPhone()}<span>${esc(r.phone2)}</span></a>` : ``}
            ${wa2 ? `<a class="iconlink" href="${esc(wa2)}" target="_blank" rel="noopener" title="WhatsApp (2)">${svgWhatsApp()}<span>WA (2)</span></a>` : ``}
            ${wa1 ? `<button class="iconbtn" type="button" data-intro="1" data-leadid="${esc(r.leadId)}" title="WhatsApp Intro">${svgWhatsApp()}<span>Intro</span></button>` : ``}
          </div>
        </td>
        <td>${esc(r.country||"")}</td>
        <td>${esc(r.markets||"")}</td>
        <td>${esc(r.productType||"")}</td>
        <td>${esc(r.enteredBy||"")}</td>
        <td>
          ${rowLink(r.folderUrl,"Folder")} ${r.itemsSheetUrl ? " | " + rowLink(r.itemsSheetUrl,"Items") : ""}
          ${r.leadId ? ` | <button class="btn btn--ghost" data-edit="${esc(r.leadId)}">${svgEdit()} Edit</button>` : ""}
        </td>
      `;
      tbody.appendChild(tr);
      const eb = tr.querySelector('[data-edit]');
      if(eb){ eb.addEventListener("click", ()=> openEdit(r.leadId, r)); }
    });
  }

  if(pager){
    const show = total > __LEADS_PAGE_SIZE;
    pager.style.display = show ? "" : "none";
    if(hint) hint.textContent = total ? `Showing ${upto} of ${total}` : "No leads match.";
    const btn = $("btnLeadsLoadMore");
    if(btn) btn.disabled = upto >= total;
  }
}

async function refreshLeadsEnterprise_(){
  const execUrl = getExecUrl();
  if(!execUrl){ setStatus("Missing /exec URL. Open Settings."); return; }
  try{
    setStatus("Loading leads…");
    const [leads, fus] = await Promise.all([getLeadsAll_(), getFollowUpsAll_().catch(()=>[])]);
    computeNextFollowMap_(fus||[]);
    __leadsPage = 1;
    applyEnterpriseLeadFilters_(leads||[]);
    renderLeadsPage_();
    setStatus("Ready");
  }catch(e){
    console.error(e);
    setStatus("Leads load failed.");
  }
}

async function refreshHome_(){
  const execUrl = getExecUrl();
  if(!execUrl){ setStatus("Missing /exec URL. Open Settings."); return; }
  try{
    setStatus("Loading…");
    const [leads, fus] = await Promise.all([getLeadsAll_(), getFollowUpsAll_().catch(()=>[])]);
    computeNextFollowMap_(fus||[]);
    // KPI counts
    const now = new Date();
    const buckets = { overdue:0, today:0, next7:0 };
    (leads||[]).forEach(l=>{
      const b = dueBucket_(l, now);
      if(buckets[b] !== undefined) buckets[b] += 1;
    });
    const capturedToday = (leads||[]).filter(l=>{ const d=parseISTLabel_(l.timestampIST); if(!d) return false; return startOfDay_(d).getTime()===startOfDay_(now).getTime(); }).length;

    const suppliersCount = (leads||[]).filter(l=>String(l.type||"").toLowerCase()==="supplier").length;
    const buyersCount = (leads||[]).filter(l=>String(l.type||"").toLowerCase()==="buyer").length;

    // Render only 4 tiles on Home
    const el = $("kpis");
    if(el){
      el.innerHTML = "";
      const items = [
        ["Suppliers", suppliersCount],
        ["Buyers", buyersCount],
        ["Overdue", buckets.overdue],
        ["Due Today", buckets.today],
        ["Next 7 Days", buckets.next7],
        ["Captured Today", capturedToday]
      ];
      items.forEach(([label,val])=>{
        const d=document.createElement("div");
        d.className="kpi";
        d.innerHTML = `<div class="kpi__v">${esc(val)}</div><div class="kpi__l">${esc(label)}</div>`;
        d.setAttribute("data-homefilter", label);
        el.appendChild(d);
      });
      // click tiles -> go to Leads with chip prefilter
      el.querySelectorAll("[data-homefilter]").forEach(kpi=>{
        kpi.addEventListener("click", ()=>{
          const label = kpi.getAttribute("data-homefilter") || "";
          // Type tiles
          if(label === "Suppliers"){
            __leadsTypeFilter = "supplier";
            setCapturedFilter_("all");
            setDueFilter_("all");
            showTab("Leads");
            refreshLeadsEnterprise_();
            return;
          }
          if(label === "Buyers"){
            __leadsTypeFilter = "buyer";
            setCapturedFilter_("all");
            setDueFilter_("all");
            showTab("Leads");
            refreshLeadsEnterprise_();
            return;
          }

          // Default: clear type filter when using due/captured KPIs
          __leadsTypeFilter = "all";
          setCapturedFilter_("all");
          setDueFilter_("all");

          if(label === "Overdue") setDueFilter_("overdue");
          else if(label === "Due Today") setDueFilter_("today");
          else if(label === "Next 7 Days") setDueFilter_("next7");
          else if(label === "Captured Today") setCapturedFilter_("today");

          showTab("Leads");
          refreshLeadsEnterprise_();
        });
      });
    }

    // Drive shortcuts + today's attachments remain
    try{ await refreshDashboardInfo(); }catch{}
    setStatus("Ready");
  }catch(e){
    console.error(e);
    setStatus("Home load failed.");
  }
}

async function refreshPipeline_(){
  const board = $("pipelineBoard");
  if(!board) return;
  const execUrl = getExecUrl();
  if(!execUrl){ setStatus("Missing /exec URL. Open Settings."); return; }
  try{
    setStatus("Loading pipeline…");
    const [leads, fus] = await Promise.all([
      getLeadsAll_(),
      getFollowUpsAll_().catch(()=>[])
    ]);
    computeNextFollowMap_(fus||[]);
    // render stage-based Kanban (Buyer/Supplier toggle)
    renderPipeline_();
    setStatus("Ready");
  }catch(e){
    console.error(e);
    setStatus("Pipeline load failed.");
  }
}

async function refreshInsights_(){
  // Insights reuses the server-filtered table (more accurate for deep filters)
  await refreshDashboard();
}

// Helpers for chip state
function setCapturedFilter_(val){
  __leadsCapturedFilter = val;
  const root = $("leadsChips");
  setChipGroupActive_(root, "[data-captured]", "data-captured", val);
}
function setDueFilter_(val){
  __leadsDueFilter = val;
  const root = $("leadsChips");
  setChipGroupActive_(root, "[data-due]", "data-due", val);
}
function applyKpiFilter_(flt){
  // Reset
  __leadsCapturedFilter = "all";
  __leadsDueFilter = "all";
  __leadsTypeFilter = "all";
  try{
    if(flt.type) __leadsTypeFilter = flt.type;
    if(flt.captured) setCapturedFilter_(flt.captured);
    if(flt.due) setDueFilter_(flt.due);
    // Ensure chips reflect internal state
    setCapturedFilter_(__leadsCapturedFilter);
    setDueFilter_(__leadsDueFilter);
  }catch(e){}
  showTab("Leads");
  refreshLeads_();
}


async function refreshDashboard(){
  const execUrl = getExecUrl();
  if(!execUrl){ setStatus("Missing /exec URL. Open Settings."); return; }

  try{
    const data = await getJson({
      action:"listLeads",
      limit:"200",
      q:safeValue_($("dashQ")).trim(),
      country: safeValue_(dashCountry),
      market: safeValue_(dashMarket),
      productType: safeValue_(dashPT)
    });

    window.__leadsCache = data.rows || [];
    renderKpis(data.kpis || {});

    // Recent leads widget (newest first)
    try{ renderRecentLeads_(window.__leadsCache); }catch{}

    const tbody = $("dashTable").querySelector("tbody");
    tbody.innerHTML = "";

    (data.rows||[]).forEach(r=>{
      const tr=document.createElement("tr");
      tr.innerHTML = `
        <td>${esc(r.timestampIST||"")}</td>
        <td>${esc(r.type||"")}</td>
        <td>${esc(r.company||"")}</td>
        <td>${esc(r.contact||"")}</td>
        <td>${esc(r.country||"")}</td>
        <td>${esc(r.markets||"")}</td>
        <td>${esc(r.productType||"")}</td>
        <td>${esc(r.enteredBy||"")}</td>
        <td>${rowLink(r.folderUrl,"Folder")} ${r.itemsSheetUrl ? " | " + rowLink(r.itemsSheetUrl,"Items") : ""}</td>
      `;
      tbody.appendChild(tr);
    });

    // Drive shortcuts + today's attachments
    try{ await refreshDashboardInfo(); }catch{}
  } catch(e){
    console.error(e);
    setStatus("Dashboard load failed.");
  }
}

// Alias for legacy init()
async function refreshDashboard_(){ return refreshDashboard(); }


function renderRecentLeads_(rows){
  const list = $("dashRecentList");
  if(!list) return;
  const hint = $("dashRecentHint");

  const r = Array.isArray(rows) ? rows.slice().reverse() : [];
  const top = r.slice(0, 20);
  if(hint) hint.textContent = top.length ? `Latest ${top.length} lead(s) (newest first)` : "No leads found for current filters.";

  list.innerHTML = top.map(x=>{
    const wa = safeWa(x.phone);
    const title = `${esc(x.company||'—')} • ${esc(x.contact||'')}`;
    const meta = [x.type, x.country, x.markets, x.productType].filter(Boolean).map(m=>`<span class="pill pill--sm">${esc(m)}</span>`).join('');
    const when = esc(x.timestampIST||"");
    const id = esc(x.leadId||"");
    return `
      <div class="dashrecent__item">
        <div class="dashrecent__main">
          <div class="dashrecent__name" title="${title}">${esc(x.company||'—')}</div>
          <div class="dashrecent__meta">
            ${meta}
            ${x.enteredBy ? `<span class="muted">By:</span><span>${esc(x.enteredBy)}</span>` : ``}
            ${when ? `<span class="muted">Time:</span><span>${when}</span>` : ``}
          </div>
        </div>
        <div class="dashrecent__actions">
          ${x.phone ? `<a class="btn btn--ghost btn--sm" href="tel:${esc(safeTel(x.phone))}" title="Call">${svgPhone()}</a>` : ``}
          ${wa ? `<a class="btn btn--ghost btn--sm" href="${esc(wa)}" target="_blank" rel="noopener" title="WhatsApp">${svgWhatsApp()}</a>` : ``}
          ${x.email ? `<a class="btn btn--ghost btn--sm" href="mailto:${esc(x.email)}" title="Email">${svgMail()}</a>` : ``}
          ${id ? `<button class="btn btn--ghost btn--sm" data-recent-edit="${id}" title="Edit">${svgEdit()}</button>` : ``}
        </div>
      </div>
    `;
  }).join("") || `<div class="hint">Nothing to show.</div>`;

  list.querySelectorAll('[data-recent-edit]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const id = b.getAttribute('data-recent-edit');
      const row = (window.__leadsCache||[]).find(z=>String(z.leadId)===String(id));
      openEdit(id, row);
    });
  });
}

async function refreshDashboardInfo(){
  setDashAttachView(__dashAttachView);

  const execUrl = getExecUrl();
  if(!execUrl) return;

  const info = await getJson({ action:"dashboardInfo", limit:"60" });

  const supA = $("dashSupplierRoot");
  const buyA = $("dashBuyerRoot");
  if(supA && info.supplierRootUrl) supA.href = info.supplierRootUrl;
  if(buyA && info.buyerRootUrl) buyA.href = info.buyerRootUrl;

  const hint = $("dashAttachHint");
  const list = $("dashAttachList");
  if(!list) return;

  const rows = info.attachmentsToday || [];
  if(hint) hint.textContent = rows.length ? `${rows.length} file(s) uploaded today (IST)` : "No uploads logged today (IST).";

  const gal = $("dashAttachGallery");
  if(gal) gal.innerHTML = "";

  list.innerHTML = rows.map(a=>{
    const when = esc(a.createdAtIST||"");
    const who = esc(a.createdBy||"");
    const lead = esc(a.leadId||"");
    const type = esc(a.type||"");
    const name = esc(a.fileName||"File");
    const url = esc(a.fileUrl||"");
    const link = url ? `<a target="_blank" rel="noopener" href="${url}">${name}</a>` : name;
    return `
      <div class="dashattach__row">
        <div class="dashattach__main">${link}
          <div class="dashattach__meta">
            <span class="pill pill--sm">${type||""}</span>
            ${lead ? `<span class="muted">Lead:</span> <span>${lead}</span>` : ``}
            ${who ? `<span class="muted">By:</span> <span>${who}</span>` : ``}
          </div>
        </div>
        <div class="dashattach__time">${when}</div>
      </div>
    `;
  }).join("") || `<div class="hint">Nothing yet today.</div>`;
  // Gallery mode (images only)
  if(gal){
    const imgs = rows.filter(a=>isImageMime(a.mimeType) && a.fileId);
    gal.innerHTML = imgs.map(a=>{
      const url = esc(a.fileUrl||"");
      const name = esc(a.fileName||"Image");
      const when = esc(a.createdAtIST||"");
      const who = esc(a.createdBy||"");
      const imgSrc = drivePreviewUrl(a.fileId);
      const link = url ? url : "#";
      return `
        <a class="dashthumb" href="${link}" target="_blank" rel="noopener">
          <img class="dashthumb__img" src="${imgSrc}" alt="${name}" loading="lazy" />
          <div class="dashthumb__meta">
            <div class="dashthumb__name">${name}</div>
            <div class="dashthumb__sub">
              <span>${who}</span>
              <span>${when}</span>
            </div>
          </div>
        </a>
      `;
    }).join("") || `<div class="hint">No photos uploaded today (IST).</div>`;
  }

}

async function refreshLeads(){
  const execUrl = getExecUrl();
  if(!execUrl){ setStatus("Missing /exec URL. Open Settings."); return; }

  try{
    const data = await getJson({
      action:"listLeads",
      limit:"1000",
      q:safeValue_($("leadsQ")).trim(),
      country: safeValue_(leadsCountry),
      market: safeValue_(leadsMarket),
      productType: safeValue_(leadsPT)
    });

    window.__leadsCache = data.rows || [];

    const rows = (data.rows||[]);

    // Cards
    const cards = $("leadsCards");
    if(cards){
      cards.innerHTML = rows.map(renderLeadCard).join("");
      cards.querySelectorAll("[data-edit]").forEach(btn=>{
        btn.addEventListener("click", ()=>{
          const id = btn.getAttribute("data-edit");
          const row = rows.find(x=>String(x.leadId)===String(id));
          openEdit(id, row);
        });
      });
    }

    // List
    const tbody = $("leadsTable").querySelector("tbody");
    tbody.innerHTML = "";

    rows.forEach(r=>{
      const wa1 = safeWa(r.phone);
      const wa2 = safeWa(r.phone2);

      const tr=document.createElement("tr");
      tr.innerHTML = `
        <td>${esc(r.timestampIST||"")}</td>
        <td>${esc(r.type||"")}</td>
        <td>${esc(r.company||"")}</td>
        <td>${esc(r.contact||"")}</td>
        <td>
          <div class="cellicons">
            ${r.email ? `<a class="iconlink" href="mailto:${esc(r.email)}" title="Email">${svgMail()}<span>${esc(r.email)}</span></a>` : `<span class="smallmuted">—</span>`}
          </div>
        </td>
        <td>
          <div class="cellicons">
            ${r.phone ? `<a class="iconlink" href="tel:${esc(safeTel(r.phone))}" title="Call">${svgPhone()}<span>${esc(r.phone)}</span></a>` : `<span class="smallmuted">—</span>`}
            ${wa1 ? `<a class="iconlink" href="${esc(wa1)}" target="_blank" rel="noopener" title="WhatsApp">${svgWhatsApp()}<span>WhatsApp</span></a>` : ``}
            ${r.phone2 ? `<a class="iconlink" href="tel:${esc(safeTel(r.phone2))}" title="Call (2)">${svgPhone()}<span>${esc(r.phone2)}</span></a>` : ``}
            ${wa2 ? `<a class="iconlink" href="${esc(wa2)}" target="_blank" rel="noopener" title="WhatsApp (2)">${svgWhatsApp()}<span>WA (2)</span></a>` : ``}
            ${wa1 ? `<button class="iconbtn" type="button" data-intro="1" data-leadid="${esc(r.leadId)}" title="WhatsApp Intro">${svgWhatsApp()}<span>Intro</span></button>` : ``}
          </div>
        </td>
        <td>${esc(r.country||"")}</td>
        <td>${esc(r.markets||"")}</td>
        <td>${esc(r.productType||"")}</td>
        <td>${esc(r.enteredBy||"")}</td>
        <td>
          ${rowLink(r.folderUrl,"Folder")} ${r.itemsSheetUrl ? " | " + rowLink(r.itemsSheetUrl,"Items") : ""}
          ${r.leadId ? ` | <button class="btn btn--ghost" data-edit="${esc(r.leadId)}">${svgEdit()} Edit</button>` : ""}
        </td>
      `;
      tbody.appendChild(tr);

      const eb = tr.querySelector('[data-edit]');
      if(eb){
        eb.addEventListener("click", ()=> openEdit(r.leadId, r));
      }
    });
  } catch(e){
    console.error(e);
    setStatus("Leads load failed.");
  }
}

/* ---------- Edit Lead ---------- */
let currentEditRow = null;

function openEdit(leadId, row){
  currentEditRow = row || null;
  $("editLeadId").value = leadId || "";
  loadEditActivities_(leadId);
  $("editType").value = row?.type || "";
  initEditStageNextStep_(row);
  $("editEnteredBy").value = row?.enteredBy || "";
  $("editCompany").value = row?.company || "";
  $("editContact").value = row?.contact || "";
  $("editTitle").value = row?.title || "";
  $("editEmail").value = row?.email || "";
  $("editPhone").value = row?.phone || "";
  $("editPhone2").value = row?.phone2 || "";

  editCountry.setValue(row?.country || "");
  editMarket.setValue(row?.markets || "");
  editPT.setValue(row?.productType || "");

  $("editPL").value = row?.privateLabel || "";
  $("editExFactory").value = row?.exFactory || "";
  $("editFOB").value = row?.fob || "";
  $("editProducts").value = row?.productsOrNeeds || "";
  $("editNotes").value = row?.notes || "";

  const isSupplier = String(row?.type||"").toLowerCase()==="supplier";
  $("editPriceRow").style.display = isSupplier ? "" : "none";

  $("editFUDate").value = "";
  $("editFUTime").value = "";
  $("editFUNotes").value = "";
  $("editStatus").textContent = "";

  $("editSub").textContent = `${row?.leadId||leadId||""} • ${row?.company||row?.contact||""}`;
  openOverlay("editOverlay");
}

function clearEditFollowup(){
  $("editFUDate").value = "";
  $("editFUTime").value = "";
  $("editFUNotes").value = "";
}

async function saveEdit(){
  const leadId = $("editLeadId").value.trim();
  if(!leadId){ alert("Missing lead id"); return; }

  await maybeSaveListItem("market", editMarket);
  await maybeSaveListItem("productType", editPT);

  let newFollowUp = null;
  const d = $("editFUDate").value;
  const t = $("editFUTime").value;
  const notes = $("editFUNotes").value.trim();
  if(d && t){
    const f = formatISTFromInputs(d,t);
    newFollowUp = { scheduledAtIST: f.label, scheduledAtISO: f.iso, notes };
  }

  const email = $("editEmail").value.trim();
  const phone = normalizePhone(editCountry.value, $("editPhone").value);
  const phone2 = normalizePhone(editCountry.value, $("editPhone2").value);

  const ok = await checkDuplicatesBeforeSave({ leadId, email, phone, phone2 });
  if(!ok) return;

  $("editStatus").textContent = "Saving…";

  const payload = {
    action: "updateLead",
    leadId,
    updatedBy: (localStorage.getItem(LS_USER)||"Unknown").trim() || "Unknown",
    company: $("editCompany").value.trim(),
    contact: $("editContact").value.trim(),
    title: $("editTitle").value.trim(),
    email,
    phone,
    phone2,
    country: editCountry.value,
    markets: editMarket.value,
    privateLabel: $("editPL").value.trim(),
    productType: editPT.value,
    productsOrNeeds: $("editProducts").value.trim(),
    exFactory: $("editExFactory").value.trim(),
    fob: $("editFOB").value.trim(),
    stage: safeValue_($("editStage")),
    nextStep: safeValue_($("editNextStep")),
    stage: safeValue_($("editStage")),
    nextStep: safeValue_($("editNextStep")),
    notes: $("editNotes").value.trim(),
    newFollowUp
  };

  try{
    const res = await postPayload(payload);
    $("editStatus").textContent = "Saved ✓" + (res?.calendarEventUrl ? " (Calendar updated)" : "");

    await refreshDashboard();
    await refreshLeadsEnterprise_();
    await refreshCalendar();
  } catch(e){
    console.error(e);
    $("editStatus").textContent = "Save failed: " + (e?.message || e);
  }
}

/* ---------- Calendar (FULL FIX: Month + Week + Day grids + arrows) ---------- */
let calView = "month";
let calCursor = new Date();
let followUpsCache = [];

/* --- date math helpers (must exist before BOOT arrows) --- */
function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function startOfWeek(d){
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay()); // Sunday start
  return x;
}
function endOfWeek(d){ return addDays(startOfWeek(d), 6); }

/* --- IST helpers for correct grouping on calendar cells --- */
function istKey(dt){
  try{
    const s = new Intl.DateTimeFormat("en-CA", {
      timeZone:"Asia/Kolkata",
      year:"numeric", month:"2-digit", day:"2-digit"
    }).format(dt); // YYYY-MM-DD
    return s;
  }catch{
    // fallback: local day key
    const x = new Date(dt);
    return x.toISOString().slice(0,10);
  }
}

function fmtWhenIST(dt){
  try{
    return new Intl.DateTimeFormat("en-US", {
      timeZone:"Asia/Kolkata",
      weekday:"short",
      month:"short",
      day:"2-digit",
      year:"numeric",
      hour:"numeric",
      minute:"2-digit",
      hour12:true
    }).format(dt);
  }catch{
    return dt.toLocaleString();
  }
}

function fmtDayTitleIST(dt){
  try{
    return new Intl.DateTimeFormat("en-US", {
      timeZone:"Asia/Kolkata",
      weekday:"long",
      month:"long",
      day:"numeric",
      year:"numeric"
    }).format(dt);
  }catch{
    return dt.toDateString();
  }
}

function fmtMonthTitleIST(dt){
  try{
    return new Intl.DateTimeFormat("en-US", {
      timeZone:"Asia/Kolkata",
      month:"long",
      year:"numeric"
    }).format(dt);
  }catch{
    return dt.toDateString();
  }
}

/* --- parsers --- */
function parseIso(iso){
  const dt = iso ? new Date(iso) : null;
  return (dt && !isNaN(dt.getTime())) ? dt : null;
}

// Parses legacy IST label like "12/28/25 04:15 PM"
function parseISTLabel(label){
  const s = String(label||"").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if(!m) return null;

  const MM = parseInt(m[1],10);
  const DD = parseInt(m[2],10);
  const YY = 2000 + parseInt(m[3],10);
  let HH = parseInt(m[4],10);
  const MI = parseInt(m[5],10);
  const ap = m[6].toUpperCase();

  if(ap==="PM" && HH<12) HH += 12;
  if(ap==="AM" && HH===12) HH = 0;

  const iso = `${YY}-${String(MM).padStart(2,'0')}-${String(DD).padStart(2,'0')}T${String(HH).padStart(2,'0')}:${String(MI).padStart(2,'0')}:00+05:30`;
  const dt = new Date(iso);
  return isNaN(dt.getTime()) ? null : dt;
}

/* --- ranges --- */
function monthRange(cursor){
  // build a 6-row month grid range (Sun..Sat) including previous/next month days
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = startOfWeek(first);
  const last = new Date(cursor.getFullYear(), cursor.getMonth()+1, 0);
  const end = addDays(endOfWeek(last), 1); // exclusive
  return { start, end, label: fmtMonthTitleIST(cursor) };
}

/* --- view switch --- */
function setCalView(v){
  calView = v;
  ["Day","Week","Month"].forEach(x=>{
    const el = $("calView"+x);
    if(!el) return;
    const on = (v===x.toLowerCase());
    // support both historical class names
    el.classList.toggle("isActive", on);
    el.classList.toggle("is-active", on);
  });
  renderCalendar();
}

/* --- refresh from sheet --- */
async function refreshCalendar(){
  const execUrl = getExecUrl();
  if(!execUrl){ setStatus("Missing /exec URL. Open Settings."); return; }

  try{
    // leads cache (for call/email buttons in calendar)
    if(!window.__leadsCache || !window.__leadsCache.length){
      try{
        const dataLeads = await getJson({ action:"listLeads", limit:"2000" });
        window.__leadsCache = dataLeads.rows || [];
      }catch{}
    }

    const data = await getJson({ action:"listFollowUps", limit:"5000" });

    followUpsCache = (data.rows || []).map(r=>{
      // prefer ISO; fallback to IST label
      const dt = parseIso(r.scheduledAtISO) || parseISTLabel(r.scheduledAtIST);
      return { ...r, _dt: dt };
    }).filter(r=>r._dt)
      .sort((a,b)=>a._dt - b._dt);

    renderCalendar();
  } catch(e){
    console.error(e);
    setStatus("Calendar load failed.");
  }
}

/* --- render main --- */
function renderCalendar(){
  if(!$("calGrid") || !$("calTitle")) return;

  if(calView==="month"){
    $("calTitle").textContent = fmtMonthTitleIST(calCursor);
    renderMonthGrid();
    renderSideListForRange(rangeForMonth());
    return;
  }

  if(calView==="week"){
    const s = startOfWeek(calCursor), e = endOfWeek(calCursor);
    $("calTitle").textContent = `${fmtDayTitleIST(s)} – ${fmtDayTitleIST(e)}`;
    renderWeekGrid(s);
    renderSideListForRange({ start:s, end:addDays(e,1), label:"This week" });
    return;
  }

  // day
  $("calTitle").textContent = fmtDayTitleIST(calCursor);
  renderDayGrid(calCursor);
  renderSideListForRange({ start:startOfDay(calCursor), end:addDays(startOfDay(calCursor),1), label:"Today" });
}

function rangeForMonth(){
  const r = monthRange(calCursor);
  return { start:r.start, end:r.end, label:r.label };
}

/* --- month grid --- */
function renderMonthGrid(){
  const range = monthRange(calCursor);
  const start = range.start;
  const end = range.end;

  const days = [];
  for(let dt=new Date(start); dt<end; dt=addDays(dt,1)) days.push(new Date(dt));

  const grid = $("calGrid");
  grid.innerHTML = "";

  // header
  const headRow = document.createElement("div");
  headRow.className = "calrow calhead";
  ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].forEach(n=>{
    const c=document.createElement("div");
    c.className="calcell";
    c.style.minHeight="auto";
    c.innerHTML = `<div class="calday"><span class="calnum">${n}</span></div>`;
    headRow.appendChild(c);
  });
  grid.appendChild(headRow);

  // 6 weeks (or computed weeks)
  for(let w=0; w<days.length/7; w++){
    const row=document.createElement("div");
    row.className="calrow";

    for(let i=0;i<7;i++){
      const dt = days[w*7+i];
      const cell=document.createElement("div");
      cell.className="calcell";

      const today = startOfDay(new Date());
      if(startOfDay(dt).getTime()===today.getTime()) cell.classList.add("isToday");
      if(dt.getMonth()!==calCursor.getMonth()) cell.classList.add("isOtherMonth");

      const key = istKey(dt);
      const items = followUpsCache.filter(x=> istKey(x._dt) === key);

      cell.innerHTML = `<div class="calday"><span class="calnum">${dt.getDate()}</span><span>${items.length? items.length+" FU":""}</span></div>`;

      if(items.length){
        const b = document.createElement("div");
        b.className="caltag";
        b.textContent = "View";
        b.addEventListener("click", ()=> {
          calCursor = dt;
          setCalView("day");
        });
        cell.appendChild(b);
      }

      row.appendChild(cell);
    }
    grid.appendChild(row);
  }
}

/* --- week grid --- */
function renderWeekGrid(weekStart){
  const grid = $("calGrid");
  grid.innerHTML = "";

  // header
  const headRow = document.createElement("div");
  headRow.className = "calrow calhead";
  ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].forEach(n=>{
    const c=document.createElement("div");
    c.className="calcell";
    c.style.minHeight="auto";
    c.innerHTML = `<div class="calday"><span class="calnum">${n}</span></div>`;
    headRow.appendChild(c);
  });
  grid.appendChild(headRow);

  // one week row
  const row = document.createElement("div");
  row.className = "calrow";

  for(let i=0;i<7;i++){
    const dt = addDays(weekStart, i);
    const cell = document.createElement("div");
    cell.className = "calcell";

    const today = startOfDay(new Date());
    if(startOfDay(dt).getTime()===today.getTime()) cell.classList.add("isToday");

    const key = istKey(dt);
    const items = followUpsCache.filter(x=> istKey(x._dt) === key);

    cell.innerHTML = `<div class="calday"><span class="calnum">${dt.getDate()}</span><span>${items.length? items.length+" FU":""}</span></div>`;

    // show up to 2 items in the cell
    if(items.length){
      const mini = document.createElement("div");
      mini.className = "calmini";
      items.slice(0,2).forEach(f=>{
        const it = document.createElement("div");
        it.className = "calmini__it";
        const who = (f.company || f.contact || "Follow-up").trim();
        it.textContent = `${fmtWhenIST(f._dt)} — ${who}`;
        mini.appendChild(it);
      });
      if(items.length>2){
        const more = document.createElement("div");
        more.className = "calmini__more";
        more.textContent = `+${items.length-2} more`;
        mini.appendChild(more);
      }
      cell.appendChild(mini);

      const b = document.createElement("div");
      b.className="caltag";
      b.textContent="View";
      b.addEventListener("click", ()=>{ calCursor = dt; setCalView("day"); });
      cell.appendChild(b);
    }

    row.appendChild(cell);
  }

  grid.appendChild(row);
}

/* --- day grid --- */
function renderDayGrid(day){
  const grid = $("calGrid");
  grid.innerHTML = "";

  const box = document.createElement("div");
  box.className = "caldaybox";

  const key = istKey(day);
  const items = followUpsCache.filter(x=> istKey(x._dt) === key);

  if(!items.length){
    box.innerHTML = `<div class="hint">No follow-ups scheduled for this day.</div>`;
    grid.appendChild(box);
    return;
  }

  items.forEach(f=>{
    const el = document.createElement("div");
    el.className = "caldayitem";

    const who = (f.company || f.contact || "").trim();
    const meta = [f.type, f.country, f.productType].filter(Boolean).join(" • ");

    const lead = (window.__leadsCache||[]).find(x=>x.leadId===f.leadId);
    const phone = (lead?.phone || "").trim();
    const email = (lead?.email || "").trim();

    el.innerHTML = `
      <div class="caldayitem__when">${esc(fmtWhenIST(f._dt))}</div>
      <div class="caldayitem__who">${esc(who)}${meta? " — "+esc(meta):""}</div>
      ${f.notes ? `<div class="caldayitem__note">${esc(f.notes)}</div>` : ``}
      <div class="calitem__actions">
        ${phone ? `<a class="iconbtn" href="tel:${esc(safeTel(phone))}">${svgPhone()} Call</a>` : ``}
        ${phone ? `<a class="iconbtn" target="_blank" rel="noopener" href="https://wa.me/${esc(digitsOnly(phone))}">${svgPhone()} WhatsApp</a>` : ``}
        ${email ? `<a class="iconbtn" href="mailto:${esc(email)}">${svgMail()} Email</a>` : ``}
        ${f.leadId ? `<a class="iconbtn" href="#" data-open="${esc(f.leadId)}">${svgEdit()} Open Lead</a>` : ``}
      </div>
    `;

    const openBtn = el.querySelector('[data-open]');
    if(openBtn){
      openBtn.addEventListener("click",(e)=>{
        e.preventDefault();
        const leadRow = (window.__leadsCache||[]).find(x=>x.leadId===f.leadId);
        if(leadRow) openEdit(f.leadId, leadRow);
        else openEdit(f.leadId, { leadId:f.leadId, type:f.type, company:f.company, contact:f.contact, country:f.country, markets:f.markets, productType:f.productType, enteredBy:f.enteredBy });
      });
    }

    box.appendChild(el);
  });

  grid.appendChild(box);
}

/* --- right panel list --- */
function renderSideListForRange(range){
  const start = range.start;
  const end = range.end;
  const items = followUpsCache.filter(f=> f._dt >= start && f._dt < end);

  $("calPanelTitle").textContent = range.label || "Follow-ups";
  $("calPanelHint").textContent = items.length ? `${items.length} follow-up(s)` : "No follow-ups";

  const list = $("calList");
  list.innerHTML = "";

  if(!items.length){
    const d=document.createElement("div");
    d.className="hint";
    d.textContent="Nothing scheduled in this range.";
    list.appendChild(d);
    return;
  }

  items.slice(0,250).forEach(f=>{
    const el=document.createElement("div");
    el.className="calitem";

    const who = (f.company || f.contact || "").trim();
    const meta = [f.type, f.country, f.productType].filter(Boolean).join(" • ");

    const lead = (window.__leadsCache||[]).find(x=>x.leadId===f.leadId);
    const phone = (lead?.phone || "").trim();
    const email = (lead?.email || "").trim();

    el.innerHTML = `
      <div class="calitem__top">
        <div>
          <div class="calitem__when">${esc(fmtWhenIST(f._dt))}</div>
          <div class="calitem__meta">${esc(who)}${meta? " — "+esc(meta):""}</div>
        </div>
      </div>
      ${f.notes ? `<div class="calitem__note">${esc(f.notes)}</div>` : ``}
      <div class="calitem__actions">
        ${phone ? `<a class="iconbtn" href="tel:${esc(safeTel(phone))}">${svgPhone()} Call</a>` : ``}
        ${phone ? `<a class="iconbtn" target="_blank" rel="noopener" href="https://wa.me/${esc(digitsOnly(phone))}">${svgPhone()} WhatsApp</a>` : ``}
        ${email ? `<a class="iconbtn" href="mailto:${esc(email)}">${svgMail()} Email</a>` : ``}
        ${f.leadId ? `<a class="iconbtn" href="#" data-open="${esc(f.leadId)}">${svgEdit()} Open Lead</a>` : ``}
      </div>
    `;

    const openBtn = el.querySelector('[data-open]');
    if(openBtn){
      openBtn.addEventListener("click",(e)=>{
        e.preventDefault();
        const leadRow = (window.__leadsCache||[]).find(x=>x.leadId===f.leadId);
        if(leadRow) openEdit(f.leadId, leadRow);
        else openEdit(f.leadId, { leadId:f.leadId, type:f.type, company:f.company, contact:f.contact, country:f.country, markets:f.markets, productType:f.productType, enteredBy:f.enteredBy });
      });
    }

    list.appendChild(el);
  });
}


/* ---------- UI DENSITY (AUTO BY DEVICE) ---------- */
function detectDeviceClass_(){
  // Heuristic tuned for iPhone / iPad / Samsung tablets + laptops.
  const w = Math.min(window.innerWidth || 9999, screen?.width || 9999);
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if(w <= 640) return 'phone';
  // Most tablets (incl. iPad portrait/landscape, Samsung tablets) land here.
  if(w <= 1024) return 'tablet';
  // Large tablets in desktop-like widths but still touch.
  if(coarse && w <= 1366) return 'tablet';
  return 'desktop';
}
function applyAutoDensity_(){
  const device = detectDeviceClass_();  document.body.classList.remove('density-compact','density-phone','density-tablet');
  if(device === 'phone') document.body.classList.add('density-phone');
  else if(device === 'tablet') document.body.classList.add('density-tablet');
  document.body.dataset.device = device;
}

/* ---------- BOOT (FULL) ---------- */
document.addEventListener("DOMContentLoaded", async ()=>{
  // density (auto by device; no user toggle)
  applyAutoDensity_();
  window.addEventListener('resize', debounce_(applyAutoDensity_, 120));
  window.addEventListener('orientationchange', ()=>setTimeout(applyAutoDensity_, 50));

  // tabs
  $("tabCapture").addEventListener("click", ()=>showTab("Capture"));
  $("tabDashboard").addEventListener("click", ()=>showTab("Dashboard"));
  $("tabLeads").addEventListener("click", ()=>showTab("Leads"));
  const tp=$("tabPipeline"); if(tp) tp.addEventListener("click", ()=>showTab("Pipeline"));
  const ti=$("tabInsights"); if(ti) ti.addEventListener("click", ()=>showTab("Insights"));
  $("tabCalendar").addEventListener("click", ()=>showTab("Calendar"));

  // global search
  try{ initGlobalSearch_(); }catch{}

  // lead type
  $("btnSupplier").addEventListener("click", ()=>setMode("supplier"));
  $("btnBuyer").addEventListener("click", ()=>setMode("buyer"));
  setMode("supplier");

  // overlays close on backdrop click
  ["qrOverlay","settingsOverlay","userOverlay","vcardOverlay","editOverlay"].forEach(id=>{
    $(id).addEventListener("click",(e)=>{ if(e.target.id===id) closeOverlay(id); });
  });

  // edit overlay
  $("btnCloseEdit").addEventListener("click", ()=>closeOverlay("editOverlay"));
  $("btnSaveEdit").addEventListener("click", saveEdit);
  $("btnClearEditFU").addEventListener("click", clearEditFollowup);

  // QR open/close
  $("btnScan").addEventListener("click", openQr);
  $("btnCloseQr").addEventListener("click", closeQr);

  // settings
  $("btnSettings").addEventListener("click", ()=>{
    $("scriptUrlInput").value = getScriptUrl();
    openOverlay("settingsOverlay");
  });
  $("btnCloseSettings").addEventListener("click", ()=>closeOverlay("settingsOverlay"));
  $("btnSaveSettings").addEventListener("click", ()=>{
    const v = $("scriptUrlInput").value.trim();
    if(!v.endsWith("/exec")) { alert("URL must end with /exec"); return; }
    localStorage.setItem(LS_SCRIPT_URL, v);
    closeOverlay("settingsOverlay");
    setStatus("Settings saved.");
  });

  
  // users (from Users tab)
  setUserPill();
  ensureUser();
  fetchUsers_();

  $("btnStartSession").addEventListener("click", ()=>{
    const sel = $("userSelect");
    const selected = sel ? String(sel.value||"").trim() : "";
    let u = null;
    if(selected && USERS.length){
      u = USERS.find(x=>String(x.UserID||x.Name||"")===selected) || USERS.find(x=>String(x.Name||"")===selected);
    }
    const manual = $("usernameInput").value.trim();

    if(u){
      setCurrentUser_(u);
      setUserPill();
      closeOverlay("userOverlay");
      return;
    }

    if(!manual){ alert("Select a user or enter username"); return; }
    setCurrentUser_({ UserID:"", Name:manual });
    setUserPill();
    closeOverlay("userOverlay");
  });

  $("btnSwitchUser").addEventListener("click", ()=>{
    localStorage.removeItem(LS_USER);
    localStorage.removeItem(LS_USERID);
    localStorage.removeItem(LS_USEROBJ);
    setUserPill();
    openOverlay("userOverlay");
  });

  $("btnShareVcard").addEventListener("click", ()=>openVcardOverlay_());
  $("btnCloseVcard").addEventListener("click", ()=>closeOverlay("vcardOverlay"));

  // combos
  supCountry = createCombo("supCountryCombo", COUNTRIES, "Search country…");
  buyCountry = createCombo("buyCountryCombo", COUNTRIES, "Search country…");
  supMarkets = createCombo("supMarketsCombo", [], "Search markets…");
  buyMarkets = createCombo("buyMarketsCombo", [], "Search markets…");
  supProductType = createCombo("supProductTypeCombo", [], "Search product type…");
  buyProductType = createCombo("buyProductTypeCombo", [], "Search product type…");

  dashCountry = createCombo("dashCountryCombo", COUNTRIES, "All");
  dashMarket = createCombo("dashMarketCombo", [], "All");
  dashPT = createCombo("dashPTCombo", [], "All");

  leadsCountry = createCombo("leadsCountryCombo", COUNTRIES, "All");
  leadsMarket = createCombo("leadsMarketCombo", [], "All");
  leadsPT = createCombo("leadsPTCombo", [], "All");

  editCountry = createCombo("editCountryCombo", COUNTRIES, "Search country…");
  editMarket = createCombo("editMarketCombo", [], "Search markets…");
  editPT = createCombo("editPTCombo", [], "Search product type…");

  // Auto-prefill country code into phone fields
  supCountry._inputEl.addEventListener("blur", ()=> {
    applyCountryCodeToInput(supCountry.value, $("supPhone"));
    applyCountryCodeToInput(supCountry.value, $("supPhone2"));
  });
  buyCountry._inputEl.addEventListener("blur", ()=> {
    applyCountryCodeToInput(buyCountry.value, $("buyPhone"));
    applyCountryCodeToInput(buyCountry.value, $("buyPhone2"));
  });
  editCountry._inputEl.addEventListener("blur", ()=> {
    applyCountryCodeToInput(editCountry.value, $("editPhone"));
    applyCountryCodeToInput(editCountry.value, $("editPhone2"));
  });

  // Auto-save new Markets/ProductTypes typed anywhere (blur)
  [
    [supMarkets, "market"], [buyMarkets, "market"], [dashMarket, "market"], [leadsMarket, "market"], [editMarket, "market"],
    [supProductType, "productType"], [buyProductType, "productType"], [dashPT, "productType"], [leadsPT, "productType"], [editPT, "productType"]
  ].forEach(([combo, type])=> wireAutosaveBlur(combo, type));

  // follow-up queue buttons
  $("supFUQueueBtn").addEventListener("click", ()=>queueFollowUp("supplier"));
  $("buyFUQueueBtn").addEventListener("click", ()=>queueFollowUp("buyer"));

  // Quick follow-up buttons
  $("supFUQuickToday").addEventListener("click", ()=>applyQuickFU("supFUDate","supFUTime",0));
  $("supFUQuick7").addEventListener("click", ()=>applyQuickFU("supFUDate","supFUTime",7));
  $("supFUQuick14").addEventListener("click", ()=>applyQuickFU("supFUDate","supFUTime",14));
  $("buyFUQuickToday").addEventListener("click", ()=>applyQuickFU("buyFUDate","buyFUTime",0));
  $("buyFUQuick7").addEventListener("click", ()=>applyQuickFU("buyFUDate","buyFUTime",7));
  $("buyFUQuick14").addEventListener("click", ()=>applyQuickFU("buyFUDate","buyFUTime",14));
  $("editQuickToday").addEventListener("click", ()=>applyQuickFU("editFUDate","editFUTime",0));
  $("editQuick7").addEventListener("click", ()=>applyQuickFU("editFUDate","editFUTime",7));
  $("editQuick14").addEventListener("click", ()=>applyQuickFU("editFUDate","editFUTime",14));

  // save buttons
  $("saveSupplierNew").addEventListener("click", ()=>saveSupplier(false));
  $("saveSupplierClose").addEventListener("click", ()=>saveSupplier(true));
  $("clearSupplier").addEventListener("click", clearSupplier);

  $("saveBuyerNew").addEventListener("click", ()=>saveBuyer(false));
  $("saveBuyerClose").addEventListener("click", ()=>saveBuyer(true));
  $("clearBuyer").addEventListener("click", clearBuyer);

  // Voice-to-text for Notes
  initVoiceNotes("supNotes","supNotesMic","supNotesMicStatus");
  initVoiceNotes("buyNotes","buyNotesMic","buyNotesMicStatus");


  // refresh buttons
  $("btnDashRefresh").addEventListener("click", refreshDashboard);
  $("btnDashAttachments").addEventListener("click", refreshDashboardInfo);
  $("btnDashClear").addEventListener("click", ()=>{
    dashCountry.setValue("");
    dashMarket.setValue("");
    dashPT.setValue("");
    $("dashQ").value = "";
    refreshDashboard();
  });
  $("btnLeadsRefresh").addEventListener("click", refreshLeadsEnterprise_);
  const lm=$("btnLeadsLoadMore"); if(lm) lm.addEventListener("click", ()=>{ __leadsPage += 1; renderLeadsPage_(); });

  // Leads quick filters (chips)
  const chips = $("leadsChips");
  if(chips){
    chips.querySelectorAll("[data-captured]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        setCapturedFilter_(btn.getAttribute("data-captured"));
        __leadsPage = 1;
        applyEnterpriseLeadFilters_(__leadsAll||[]);
        renderLeadsPage_();
      });
    });
    chips.querySelectorAll("[data-due]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        setDueFilter_(btn.getAttribute("data-due"));
        __leadsPage = 1;
        applyEnterpriseLeadFilters_(__leadsAll||[]);
        renderLeadsPage_();
      });
    });
  }

  $("btnLeadsViewCards").addEventListener("click", ()=>{ setLeadsView("cards"); refreshLeadsEnterprise_(); });
  $("btnLeadsViewList").addEventListener("click", ()=>{ setLeadsView("list"); refreshLeadsEnterprise_(); });
  setLeadsView("cards");

  // calendar controls
  $("calViewDay").addEventListener("click", ()=>setCalView("day"));
  $("calViewWeek").addEventListener("click", ()=>setCalView("week"));
  $("calViewMonth").addEventListener("click", ()=>setCalView("month"));

  // Defensive: delegated handler for iOS home-screen PWAs where some taps
  // can be eaten by overlays (keeps Day/Week/Month switching reliable).
  document.addEventListener("click", (ev)=>{
    const btn = ev.target && ev.target.closest ? ev.target.closest("[data-calview]") : null;
    if(!btn) return;
    const v = (btn.getAttribute("data-calview") || "").trim();
    if(v) setCalView(v);
  });

  $("calPrev").addEventListener("click", ()=>{
    if(calView==="month") calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth()-1, 1);
    else if(calView==="week") calCursor = addDays(calCursor, -7);
    else calCursor = addDays(calCursor, -1);
    renderCalendar();
  });

  $("calNext").addEventListener("click", ()=>{
    if(calView==="month") calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth()+1, 1);
    else if(calView==="week") calCursor = addDays(calCursor, 7);
    else calCursor = addDays(calCursor, 1);
    renderCalendar();
  });

  $("btnCalRefresh").addEventListener("click", refreshCalendar);

  // load lists
  try{
    await loadLists();
  } catch(e){
    console.warn("Lists failed. Using fallback defaults.", e);
    LISTS = { productTypes: DEFAULT_PRODUCT_TYPES.slice(), markets: DEFAULT_MARKETS.slice() };
  }
  refreshAllCombos();

  // IMPORTANT: load calendar data once on boot so Month/Week/Day all have data
  try{ await refreshCalendar(); }catch{}

  setStatus("Ready");
  updateSummary();

  // Stage / Next Step dropdowns
  initStageNextStepUI_();

  // Pipeline toggle
  const pb = $("pipeBuyer"); const ps = $("pipeSupplier");
  if(pb && ps){
    pb.addEventListener("click", ()=>{ pb.classList.add("is-active"); ps.classList.remove("is-active"); renderPipeline_(); });
    ps.addEventListener("click", ()=>{ ps.classList.add("is-active"); pb.classList.remove("is-active"); renderPipeline_(); });
  }

  // Add activity note
  const btnAdd = $("btnAddActivityNote");
  if(btnAdd){
    btnAdd.addEventListener("click", async ()=>{
      const leadId = $("editLeadId").value;
      const msg = ($("editActivityNote")?.value||"").trim();
      if(!leadId || !msg) return;
      $("editActivityNote").value = "";
      await addActivityNote_(leadId, msg);
      await loadEditActivities_(leadId);
    });
  }

  // WhatsApp Intro buttons (delegated)
  document.addEventListener("click", async (ev)=>{
    const btn = ev.target.closest('[data-intro="1"]');
    if(!btn) return;
    ev.preventDefault();
    const leadId = btn.getAttribute("data-leadid");
    if(!leadId) return;
    await openWhatsAppIntro_(leadId);
  });

  // Pipeline move (delegated)
  document.addEventListener("click", async (ev)=>{
    const mv = ev.target.closest("[data-movelead]");
    if(!mv) return;
    ev.preventDefault();
    const leadId = mv.getAttribute("data-movelead");
    const stage = mv.getAttribute("data-stage");
    if(leadId && stage){
      await setLeadStage_(leadId, stage, "Moved in Pipeline");
      await renderPipeline_();
      await refreshDashboard_();
      await refreshLeads_();
    }
  });

  // Pipeline move (select)
  document.addEventListener("change", async (ev)=>{
    const sel = ev.target && ev.target.matches ? (ev.target.matches("select[data-stage-select]") ? ev.target : null) : null;
    if(!sel) return;
    const leadId = sel.getAttribute("data-stage-select");
    const stage = sel.value;
    if(!leadId || !stage) return;
    await setLeadStage_(leadId, stage, "Moved in Pipeline");
    await renderPipeline_();
    try{ await refreshHome_(); }catch{}
    try{ await refreshLeadsEnterprise_(); }catch{}
  });

function fetchUsers_(){
  const url = getScriptUrl_();
  return fetch(url + "?action=users")
    .then(r=>r.json())
    .then(j=>{
      if(j && j.result==="success" && Array.isArray(j.users)){ USERS = j.users; }
      else USERS = [];
      populateUserSelect_();
      return USERS;
    })
    .catch(_=>{ USERS = []; populateUserSelect_(); return USERS; });
}

function populateUserSelect_(){
  const sel = $("userSelect");
  if(!sel) return;
  sel.innerHTML = "";
  if(!USERS.length){
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "— No users found —";
    sel.appendChild(opt);
    return;
  }
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Select…";
  sel.appendChild(opt0);
  USERS.forEach(u=>{
    const id = String(u.UserID||"").trim();
    const name = String(u.Name||"").trim();
    if(!id && !name) return;
    const opt = document.createElement("option");
    opt.value = id || name;
    opt.textContent = name ? `${name}${id?` (${id})`:""}` : (id||"");
    sel.appendChild(opt);
  });

  // preselect from storage
  const savedId = localStorage.getItem(LS_USERID) || "";
  if(savedId){
    sel.value = savedId;
  }
}

function getCurrentUser_(){
  try{
    const obj = localStorage.getItem(LS_USEROBJ);
    if(obj) return JSON.parse(obj);
  }catch{}
  const name = localStorage.getItem(LS_USER) || "";
  const uid = localStorage.getItem(LS_USERID) || "";
  return { UserID: uid, Name: name };
}

function setCurrentUser_(u){
  const name = String(u?.Name || "").trim();
  const uid = String(u?.UserID || "").trim();
  if(name) localStorage.setItem(LS_USER, name); else localStorage.removeItem(LS_USER);
  if(uid) localStorage.setItem(LS_USERID, uid); else localStorage.removeItem(LS_USERID);
  localStorage.setItem(LS_USEROBJ, JSON.stringify(u || {}));
}

function buildVcard_(u){
  const name = String(u?.Name||"").trim();
  const title = String(u?.Title||"").trim();
  const email = String(u?.Email||"").trim();
  const phone1 = String(u?.Phone1||"").trim();
  const phone2 = String(u?.Phone2||"").trim();
  const website = String(u?.Website||"").trim();
  const social = String(u?.SocialHandle||"").trim();
  const company = String(u?.Company||u?.CompanyName||"").trim();
  const logoUrlUser = String(u?.LogoUrl||u?.LogoURL||"").trim();

  // naive split for N:
  const parts = name.split(" ");
  const last = parts.length>1 ? parts.pop() : "";
  const first = parts.join(" ");
  const n = `${last};${first};;;`;

  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${n}`,
    `FN:${escapeV_(name)}`,
  ];
  if(company) lines.push(`ORG:${escapeV_(company)}`);
  if(title) lines.push(`TITLE:${escapeV_(title)}`);
  if(email) lines.push(`EMAIL;TYPE=INTERNET:${escapeV_(email)}`);
  if(phone1) lines.push(`TEL;TYPE=CELL:${escapeV_(phone1)}`);
  if(phone2) lines.push(`TEL;TYPE=WORK:${escapeV_(phone2)}`);
  if(website) lines.push(`URL:${escapeV_(website)}`);

  // Attach logo / photo as contact image
  try{
    let logoUrl = logoUrlUser;
    if(!logoUrl){
      const base = window.location.origin + window.location.pathname.replace(/[^/]+$/, "");
      logoUrl = base + "boi-logo.png";
    }
    if(logoUrl){
      lines.push(`PHOTO;VALUE=URI:${escapeV_(logoUrl)}`);
      lines.push(`LOGO;VALUE=URI:${escapeV_(logoUrl)}`);
    }
  }catch(e){
    // ignore if not in browser environment
  }

  if(social) lines.push(`NOTE:Social ${escapeV_(social)}`);
  lines.push("END:VCARD");
  return lines.join("\n");
}

function escapeV_(s){
  return String(s||"").replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/;/g,"\\;").replace(/,/g,"\\,");
}

function openVcardOverlay_(){
  const u = getCurrentUser_();
  if(!u || !(u.Name||"").trim()){
    openOverlay("userOverlay");
    return;
  }
  const vcf = buildVcard_(u);
  $("vcardName").textContent = u.Name || "—";
  const meta = [u.Company, u.Title, u.Email, u.Phone1].filter(Boolean).join(" • ");
  $("vcardMeta").textContent = meta || "—";

    // Logo
  try{
    const base = window.location.origin + window.location.pathname.replace(/[^/]+$/, "");
    const logo = (u.LogoUrl||u.LogoURL||"").trim() || (base + "boi-logo.png");
    const el = $("vcardLogo");
    if(el) el.src = logo;
  }catch{}

  // QR image via qrserver
  const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=" + encodeURIComponent(vcf);
  $("vcardQr").src = qrUrl;

  // download vcf
  const blob = new Blob([vcf], {type:"text/vcard;charset=utf-8"});
  const href = URL.createObjectURL(blob);
  const a = $("btnDownloadVcf");
  a.href = href;
  a.download = (u.Name ? u.Name.replace(/[^a-z0-9]+/gi,"_") : "contact") + ".vcf";

  // share button
  const shareBtn = $("btnShareVcardSystem");
  if(navigator.share){
    shareBtn.style.display = "";
    shareBtn.onclick = async ()=>{
      try{
        const file = new File([vcf], a.download, {type:"text/vcard"});
        await navigator.share({ title: u.Name || "Contact", text: "My contact card", files: [file] });
      }catch{}
    };
  }else{
    shareBtn.style.display = "none";
  }

  $("btnCopyVcard").onclick = async ()=>{
    const txt = [u.Name, u.Company, u.Title, u.Email, u.Phone1, u.Website, u.SocialHandle].filter(Boolean).join("\n");
    try{ await navigator.clipboard.writeText(txt); setStatus("Copied."); }catch{ setStatus("Copy not available."); }
  };

  openOverlay("vcardOverlay");
}

;




function getSelectedUserProfile_(){
  const sel = document.getElementById("userSelect");
  const uid = (sel && sel.value) ? String(sel.value) : String(localStorage.getItem(LS_USER)||"");
  if(__usersProfiles && __usersProfiles[uid]) return __usersProfiles[uid];
  const opt = sel ? (sel.selectedOptions ? sel.selectedOptions[0] : null) : null;
  if(opt){
    return {
      id: uid,
      name: String(opt.dataset.name||uid||"Unknown"),
      phone1: String(opt.dataset.phone1||""),
      phone2: String(opt.dataset.phone2||""),
      email: String(opt.dataset.email||"")
    };
  }
  return { id: uid, name: uid||"Unknown", phone1:"", phone2:"", email:"" };
}



});

/* ---------- Buyer/Supplier Stage + Next Step ---------- */


function stagesForType_(type){
  const t = String(type||"").toLowerCase();
  return t === "supplier" ? SUPPLIER_STAGES : BUYER_STAGES;
}
function defaultStageForType_(type){
  return String(type||"").toLowerCase()==="supplier" ? SUPPLIER_STAGES[0] : BUYER_STAGES[0];
}

function fillSelect_(sel, items){
  if(!sel) return;
  const v = sel.value;
  sel.innerHTML = "";
  items.forEach(it=>{
    const o=document.createElement("option");
    o.value=it;
    o.textContent=it || "—";
    sel.appendChild(o);
  });
  if(items.includes(v)) sel.value=v;
}

function initStageNextStepUI_(){
  fillSelect_($("supStage"), SUPPLIER_STAGES);
  fillSelect_($("buyStage"), BUYER_STAGES);
  fillSelect_($("supNextStep"), NEXT_STEPS);
  fillSelect_($("buyNextStep"), NEXT_STEPS);
  // defaults (only if empty)
  if($("supStage") && !$("supStage").value) $("supStage").value = SUPPLIER_STAGES[0];
  if($("buyStage") && !$("buyStage").value) $("buyStage").value = BUYER_STAGES[0];
}

function initEditStageNextStep_(row){
  const type = row?.type || $("editType")?.value || "buyer";
  fillSelect_($("editStage"), stagesForType_(type));
  fillSelect_($("editNextStep"), NEXT_STEPS);
  const st = row?.stage || defaultStageForType_(type);
  if($("editStage")) $("editStage").value = st;
  if($("editNextStep")) $("editNextStep").value = row?.nextStep || "";
}

/* ---------- Activities (Timeline) ---------- */
async function fetchActivities_(leadId){
  const url = getScriptUrl_();
  const u = `${url}?action=listActivities&leadId=${encodeURIComponent(leadId)}`;
  const data = await fetchJSON_(u);
  if(data?.result !== "ok") return [];
  return Array.isArray(data.rows) ? data.rows : [];
}

function renderActivities_(rows){
  const box = $("editActivityList");
  if(!box) return;
  box.innerHTML = "";
  if(!rows.length){
    box.innerHTML = `<div class="hint">No activity yet.</div>`;
    return;
  }
  rows.forEach(r=>{
    const div=document.createElement("div");
    div.className="activityItem";
    const meta = document.createElement("div");
    meta.className="activityMeta";
    meta.textContent = String(r.createdAtIST || r.createdAt || "").trim() || "—";
    const msg = document.createElement("div");
    msg.className="activityMsg";
    msg.textContent = String(r.message||r.value||"").trim();
    div.appendChild(meta);
    div.appendChild(msg);
    box.appendChild(div);
  });
}

async function loadEditActivities_(leadId){
  if(!leadId) return;
  try{
    const rows = await fetchActivities_(leadId);
    renderActivities_(rows);
  }catch(e){
    console.warn("activities load failed", e);
  }
}

async function addActivityNote_(leadId, note){
  const payload = {
    action: "addActivityNote",
    leadId,
    note,
    createdBy: (localStorage.getItem(LS_USER)||"Unknown").trim() || "Unknown"
  };
  try{
    await postJSON_(getScriptUrl_(), payload);
  }catch(e){
    console.warn("addActivityNote failed", e);
  }
}

async function logActivityClient_(leadId, listType, value){
  const payload = {
    action: "logActivity",
    leadId,
    listType,
    value,
    createdBy: (localStorage.getItem(LS_USER)||"Unknown").trim() || "Unknown"
  };
  try{
    await postJSON_(getScriptUrl_(), payload);
  }catch(e){
    // best-effort
  }
}

/* ---------- WhatsApp Intro ---------- */
function buildWhatsAppIntroText_(lead, user){
  const contactName = (lead?.contact || "").trim() || "there";
  const senderName = (user?.name || user?.id || "").trim() || "Blue Orbit International";
  const senderEmail = (user?.email || "").trim();
  const p1 = (user?.phone1 || "").trim();
  const p2 = (user?.phone2 || "").trim();

  const lines = [];
  lines.push(`Hello ${contactName},`);
  lines.push("");
  lines.push(`This is ${senderName} from Blue Orbit International LLP.`);
  lines.push("We work with export-ready food & ingredient solutions.");
  lines.push("");
  lines.push("You can reach me directly at:");
  if(p1) lines.push(`📞 ${p1}`);
  if(p2) lines.push(`📞 ${p2}`);
  if(senderEmail) lines.push(`✉️ ${senderEmail}`);
  lines.push("");
  lines.push("Looking forward to connecting.");
  return lines.join("\n");
}

async function openWhatsAppIntro_(leadId){
  const lead = (__leadsAll||[]).find(x=>String(x.leadId)===String(leadId));
  if(!lead){ alert("Lead not found (try refreshing)."); return; }
  const user = getSelectedUserProfile_();
  const wa = safeWa(lead.phone || lead.phone2 || "");
  if(!wa){ alert("No phone number available for WhatsApp."); return; }

  // Auto stage advance rule (Buyer: New/Open -> Attempting; Supplier: New Supplier Request -> Vetting)
  const type = String(lead.type||"buyer").toLowerCase();
  const curStage = lead.stage || defaultStageForType_(type);
  let newStage = curStage;
  if(type==="buyer" && curStage===BUYER_STAGES[0]) newStage = BUYER_STAGES[1];
  if(type==="supplier" && curStage===SUPPLIER_STAGES[0]) newStage = SUPPLIER_STAGES[1];

  const text = buildWhatsAppIntroText_(lead, user);
  const waUrl = wa + "?text=" + encodeURIComponent(text);
  window.open(waUrl, "_blank");

  // Best-effort: update lead + log activity
  const introStamp = new Date().toISOString();
  await setLeadFields_(leadId, { introSent: introStamp, stage: newStage, nextStep: "WhatsApp" });
  await logActivityClient_(leadId, "whatsapp_intro", `Intro sent`);
}

/* ---------- Lead field patch ---------- */
async function setLeadFields_(leadId, patch){
  try{
    const payload = Object.assign({ action:"updateLead", leadId }, patch || {});
    const res = await postJSON_(getScriptUrl_(), payload);
    if(res?.result !== "ok") console.warn("updateLead failed", res);
    // Update local cache
    const i = (__leadsAll||[]).findIndex(x=>String(x.leadId)===String(leadId));
    if(i>=0){
      __leadsAll[i] = Object.assign({}, __leadsAll[i], patch);
    }
  }catch(e){
    console.warn("setLeadFields_ error", e);
  }
}
async function setLeadStage_(leadId, stage, reason){
  await setLeadFields_(leadId, { stage });
  await logActivityClient_(leadId, "stage", `${reason || "Stage changed"}: ${stage}`);
}

/* ---------- Pipeline Kanban (Buyer/Supplier) ---------- */
function currentPipelineType_(){
  const pb = $("pipeBuyer");
  const ps = $("pipeSupplier");
  if(ps && ps.classList.contains("is-active")) return "supplier";
  return "buyer";
}

function renderPipeline_(){
  const board = $("pipelineBoard");
  if(!board) return;
  const type = currentPipelineType_();
  const stages = stagesForType_(type);
  const leads = (__leadsAll||[]).filter(l=>String(l.type||"buyer").toLowerCase()===type);

  // group
  const byStage = {};
  stages.forEach(s=>byStage[s]=[]);
  leads.forEach(l=>{
    const st = l.stage || defaultStageForType_(type);
    if(!byStage[st]) byStage[st]=[];
    byStage[st].push(l);
  });

  // sort within columns: follow-up soonest then newest timestamp
  stages.forEach(s=>{
    byStage[s].sort((a,b)=>{
      const ad = __leadNextFollow.get(a.leadId)?._dt?.getTime() || 0;
      const bd = __leadNextFollow.get(b.leadId)?._dt?.getTime() || 0;
      if(ad && bd && ad!==bd) return ad - bd;
      const at = Date.parse(a.timestamp||"") || 0;
      const bt = Date.parse(b.timestamp||"") || 0;
      return bt - at;
    });
  });

  // render columns
  board.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "kanban";
  stages.forEach(stage=>{
    const col = document.createElement("div");
    col.className = "kanbanCol";
    const hdr = document.createElement("div");
    hdr.className = "kanbanHdr";
    hdr.textContent = `${stage} • ${byStage[stage]?.length||0}`;
    col.appendChild(hdr);

    const list = document.createElement("div");
    list.className = "kanbanList";
    (byStage[stage]||[]).forEach(l=>{
      const card=document.createElement("div");
      card.className="kanbanCard";
      const title = document.createElement("div");
      title.className="kanbanTitle";
      title.textContent = (l.company||l.contact||"—").trim();
      const sub = document.createElement("div");
      sub.className="kanbanSub";
      sub.textContent = [l.contact, l.country].filter(Boolean).join(" • ");

      const fu = __leadNextFollow.get(l.leadId);
      const fuText = fu ? `FU: ${fu.label||""}` : "FU: —";
      const meta = document.createElement("div");
      meta.className="kanbanMeta";
      meta.textContent = fuText;

      const actions = document.createElement("div");
      actions.className="kanbanActions";
      const editBtn = document.createElement("button");
      editBtn.className="btn btn--ghost";
      editBtn.type="button";
      editBtn.textContent="Edit";
      editBtn.addEventListener("click", ()=>openEdit(l.leadId, l));
      const introBtn = document.createElement("button");
      introBtn.className="btn btn--ghost";
      introBtn.type="button";
      introBtn.textContent="Intro";
      introBtn.setAttribute("data-intro","1");
      introBtn.setAttribute("data-leadid", l.leadId);

      // Compact move control (works well on iPhone/iPad)
      const moveSel = document.createElement("div");
      moveSel.className="moveMenu";
      const moveLabel = document.createElement("div");
      moveLabel.className="hint";
      moveLabel.textContent="Move stage";
      const sel = document.createElement("select");
      sel.className = "moveSelect";
      sel.setAttribute("data-stage-select", String(l.leadId||""));
      const curOpt = document.createElement("option");
      curOpt.value = stage;
      curOpt.textContent = stage;
      sel.appendChild(curOpt);
      stages.forEach(st=>{
        if(st===stage) return;
        const o=document.createElement("option");
        o.value = st;
        o.textContent = st;
        sel.appendChild(o);
      });
      moveSel.appendChild(moveLabel);
      moveSel.appendChild(sel);

      actions.appendChild(editBtn);
      actions.appendChild(introBtn);

      card.appendChild(title);
      card.appendChild(sub);
      card.appendChild(meta);
      card.appendChild(actions);
      card.appendChild(moveSel);
      list.appendChild(card);
    });

    col.appendChild(list);
    wrap.appendChild(col);
  });
  board.appendChild(wrap);
}
