/* BOI CRM — client (GitHub Pages)
   Talks to Google Apps Script webapp using form-urlencoded to avoid CORS preflight.
*/

const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzrHBqp6ZcS3lvRir9EchBhsldBS1jRghuQCWhj7XOY4nyuy8NRQP6mz3J1WGNYm-cD/exec";

const LS = {
  scriptUrl: "boi.crm.scriptUrl",
  username: "boi.crm.username"
};

let leadType = "supplier"; // 'supplier' | 'buyer'
let sessionLeads = [];
let listsCache = { countries: [], markets: [], productTypes: [] };
let qrScanner = null;
let pendingFollowup = { supplier: null, buyer: null };
let editCurrent = null;
let calendar = null;

function $(id){ return document.getElementById(id); }
function esc(s){ return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function getScriptUrl(){
  return localStorage.getItem(LS.scriptUrl) || DEFAULT_SCRIPT_URL;
}
function setScriptUrl(url){
  localStorage.setItem(LS.scriptUrl, url);
}
function getUsername(){
  return localStorage.getItem(LS.username) || "";
}
function setUsername(name){
  localStorage.setItem(LS.username, name);
  renderUserPill();
}

function renderUserPill(){
  const u = getUsername() || "—";
  $("userPill").textContent = `User: ${u}`;
}

function openOverlay(overlayId){
  const el = $(overlayId);
  el.classList.add("open");
  el.setAttribute("aria-hidden","false");
}
function closeOverlay(overlayId){
  const el = $(overlayId);
  el.classList.remove("open");
  el.setAttribute("aria-hidden","true");
}

/* ---------- Combo (searchable dropdown) ---------- */
function createCombo(mountEl, options, placeholder, onPick){
  // mountEl is a DIV
  mountEl.innerHTML = `
    <div class="combo">
      <input type="text" aria-label="${esc(placeholder)}" placeholder="${esc(placeholder)}" />
      <button class="combo__btn" type="button" title="Show list">▾</button>
      <div class="combo__list"></div>
    </div>`;
  const wrap = mountEl.querySelector(".combo");
  const input = wrap.querySelector("input");
  const btn = wrap.querySelector(".combo__btn");
  const list = wrap.querySelector(".combo__list");

  function renderList(filter=""){
    const q = filter.trim().toLowerCase();
    const filtered = !q ? options : options.filter(o => String(o).toLowerCase().includes(q));
    list.innerHTML = filtered.slice(0, 200).map(o => `<div class="combo__item" data-v="${esc(o)}">${esc(o)}</div>`).join("") || `<div class="combo__item" data-v="">(no matches)</div>`;
  }
  renderList("");

  function open(){ wrap.classList.add("open"); renderList(input.value); }
  function close(){ wrap.classList.remove("open"); }
  btn.addEventListener("click", (e)=>{ e.preventDefault(); wrap.classList.contains("open") ? close() : open(); });
  input.addEventListener("focus", ()=> renderList(input.value));
  input.addEventListener("input", ()=> { renderList(input.value); open(); });

  list.addEventListener("click", (e)=>{
    const item = e.target.closest(".combo__item");
    if(!item) return;
    const v = item.getAttribute("data-v") || "";
    input.value = v;
    close();
    onPick?.(v);
  });

  // close on outside click
  document.addEventListener("click", (e)=>{
    if(!wrap.contains(e.target)) close();
  });

  return {
    get value(){ return input.value.trim(); },
    set value(v){ input.value = v || ""; },
    setOptions(newOptions){
      options = Array.from(new Set(newOptions)).filter(Boolean).sort();
      renderList(input.value);
    }
  };
}

/* ---------- API ---------- */
async function apiPost(action, payloadObj){
  const url = getScriptUrl();
  if(!/\/exec(\?|$)/.test(url)){
    throw new Error("Apps Script Web App URL must end with /exec");
  }
  const body = new URLSearchParams({
    action,
    payload: JSON.stringify(payloadObj || {})
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body
  });

  // GAS sometimes returns plain text; parse defensively.
  const text = await res.text();
  let jsonText = text;

  // If server echoes as payload=... (rare), decode
  if(/^payload=/.test(jsonText)){
    const v = jsonText.split("payload=")[1] || "";
    jsonText = decodeURIComponent(v.replace(/\+/g, "%20"));
  }
  try{
    return JSON.parse(jsonText);
  }catch(err){
    throw new Error(`Invalid JSON from server: ${text.slice(0,200)}`);
  }
}

async function apiGet(action, params={}){
  const url = new URL(getScriptUrl());
  url.searchParams.set("action", action);
  Object.entries(params).forEach(([k,v])=> url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  const text = await res.text();
  try{ return JSON.parse(text); }catch(e){ throw new Error(`Invalid JSON: ${text.slice(0,200)}`); }
}

/* ---------- QR scan ---------- */
async function openQr(){
  if(leadType !== "supplier" && leadType !== "buyer"){
    alert("Select Buyer or Supplier first.");
    return;
  }
  if(!window.__qrLoaded || typeof Html5Qrcode === "undefined"){
    alert("QR library not loaded.");
    return;
  }
  openOverlay("qrOverlay");

  const readerId = "qr-reader";
  $(readerId).innerHTML = ""; // reset
  qrScanner = new Html5Qrcode(readerId);

  const config = { fps: 10, qrbox: { width: 320, height: 320 } };

  try{
    const cameras = await Html5Qrcode.getCameras();
    if(!cameras || !cameras.length){
      throw new Error("No camera found");
    }
    const camId = cameras[0].id;
    await qrScanner.start(
      camId,
      config,
      (decodedText)=>{
        handleQr(decodedText);
        closeQr();
      },
      ()=>{}
    );
  }catch(e){
    console.error(e);
    alert("Camera permission / camera not available on this device.");
    closeQr();
  }
}
async function closeQr(){
  try{
    if(qrScanner){
      await qrScanner.stop();
      await qrScanner.clear();
    }
  }catch(_){}
  qrScanner = null;
  closeOverlay("qrOverlay");
}
$("btnCloseQr").addEventListener("click", closeQr);
$("btnScan").addEventListener("click", openQr);

function handleQr(text){
  const qr = String(text || "").trim();
  if(!qr) return;
  if(leadType === "supplier"){
    $("supQR").value = qr;
    const v = parseVCardOrMeCard(qr);
    if(v) fillSupplierFromVcard(v);
  }else{
    $("buyQR").value = qr;
    const v = parseVCardOrMeCard(qr);
    if(v) fillBuyerFromVcard(v);
  }
}
function parseVCardOrMeCard(raw){
  const s = String(raw || "");
  if(!/BEGIN:VCARD/i.test(s) && !/^MECARD:/i.test(s)) return null;
  const out = {};
  if(/^MECARD:/i.test(s)){
    // MECARD:N:John Doe;TEL:...;EMAIL:...;URL:...;
    const body = s.replace(/^MECARD:/i,"");
    body.split(";").forEach(part=>{
      const [k, ...rest] = part.split(":");
      const v = rest.join(":");
      const key = (k||"").toUpperCase().trim();
      if(key==="N") out.name = v;
      if(key==="TEL") out.tel = v;
      if(key==="EMAIL") out.email = v;
      if(key==="URL") out.url = v;
      if(key==="ORG") out.org = v;
    });
    return out;
  }
  // VCARD
  const lines = s.split(/\r?\n/);
  for(const line of lines){
    const m = line.match(/^([A-Z]+)(?:;[^:]+)?:([\s\S]*)$/i);
    if(!m) continue;
    const key = m[1].toUpperCase();
    const val = m[2].trim();
    if(key==="FN") out.name = val;
    if(key==="N" && !out.name) out.name = val.replace(/;/g," ").trim();
    if(key==="ORG") out.org = val.replace(/;/g," ").trim();
    if(key==="EMAIL") out.email = val;
    if(key==="TEL" && !out.tel) out.tel = val;
    if(key==="URL") out.url = val;
    if(key==="TITLE") out.title = val;
  }
  return out;
}
function fillSupplierFromVcard(v){
  if(v.org) $("supCompany").value = v.org;
  if(v.name) $("supContact").value = v.name;
  if(v.title) $("supTitle").value = v.title;
  if(v.email) $("supEmail").value = v.email;
  if(v.tel) $("supPhone").value = normalizePhone(v.tel, supCountryCombo?.value);
  if(v.url) $("supWebsite").value = v.url;
}
function fillBuyerFromVcard(v){
  if(v.name) $("buyContact").value = v.name;
  if(v.org) $("buyCompany").value = v.org;
  if(v.title) $("buyTitle").value = v.title;
  if(v.email) $("buyEmail").value = v.email;
  if(v.tel) $("buyPhone").value = normalizePhone(v.tel, buyCountryCombo?.value);
  if(v.url) $("buyWebsite").value = v.url;
}

/* ---------- Phone / country ---------- */
const COUNTRY_DIAL = {
  "India": "+91",
  "United States": "+1"
};
function normalizePhone(input, country){
  let s = String(input || "").trim();
  if(!s) return "";
  // remove spaces/brackets/dashes
  s = s.replace(/[()\-\s]/g, "");
  // if already starts with + keep it
  if(s.startsWith("+")) return s;
  const dial = COUNTRY_DIAL[country] || "";
  // if starts with 00 (international)
  if(s.startsWith("00")) return "+" + s.substring(2);
  // fallback: prepend country dial if available
  return dial ? (dial + s.replace(/^\+/, "")) : s;
}

/* ---------- UI wiring ---------- */
function setLeadType(t){
  leadType = t;
  $("btnSupplier").classList.toggle("isActive", t==="supplier");
  $("btnBuyer").classList.toggle("isActive", t==="buyer");
  $("supplierForm").style.display = t==="supplier" ? "" : "none";
  $("buyerForm").style.display = t==="buyer" ? "" : "none";
  $("formTitle").textContent = t==="supplier" ? "Supplier details" : "Buyer details";
}
$("btnSupplier").addEventListener("click", ()=> setLeadType("supplier"));
$("btnBuyer").addEventListener("click", ()=> setLeadType("buyer"));

function showView(view){
  const views = ["Capture","Dashboard","Leads","Calendar"];
  for(const v of views){
    $(`view${v}`).style.display = (v===view) ? "" : "none";
    $(`tab${v}`).classList.toggle("isActive", v===view);
  }
  if(view==="Dashboard") refreshDashboard();
  if(view==="Leads") refreshLeads();
  if(view==="Calendar") refreshCalendar();
}
$("tabCapture").addEventListener("click", ()=> showView("Capture"));
$("tabDashboard").addEventListener("click", ()=> showView("Dashboard"));
$("tabLeads").addEventListener("click", ()=> showView("Leads"));
$("tabCalendar").addEventListener("click", ()=> showView("Calendar"));

/* ---------- Settings / user ---------- */
$("btnSettings").addEventListener("click", ()=>{
  $("scriptUrlInput").value = getScriptUrl();
  openOverlay("settingsOverlay");
});
$("btnCloseSettings").addEventListener("click", ()=> closeOverlay("settingsOverlay"));
$("btnSaveSettings").addEventListener("click", ()=>{
  const v = $("scriptUrlInput").value.trim();
  setScriptUrl(v);
  closeOverlay("settingsOverlay");
  toast("Settings saved.");
});
$("btnSwitchUser").addEventListener("click", ()=> openOverlay("userOverlay"));
$("btnStartSession").addEventListener("click", ()=>{
  const name = $("usernameInput").value.trim();
  if(!name){ alert("Enter a username"); return; }
  setUsername(name);
  closeOverlay("userOverlay");
});

/* ---------- session table ---------- */
function addSessionLead(row){
  sessionLeads.unshift(row);
  renderSessionTable();
  $("summary").textContent = `${sessionLeads.length} leads this session`;
}
function renderSessionTable(){
  const tb = $("tbl").querySelector("tbody");
  tb.innerHTML = sessionLeads.slice(0, 15).map(r=>`
    <tr>
      <td>${esc(r.typeLabel)}</td>
      <td>${esc(r.contactOrCompany)}</td>
      <td>${esc(r.country || "")}</td>
      <td>${esc(r.timeIst || "")}</td>
    </tr>
  `).join("");
}

/* ---------- file helpers ---------- */
function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    if(!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = ()=> {
      const dataUrl = reader.result;
      const base64 = String(dataUrl).split(",")[1] || "";
      resolve({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        dataBase64: base64
      });
    };
    reader.onerror = ()=> reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}
async function filesToBase64List(fileList){
  const files = Array.from(fileList || []);
  const out = [];
  for(const f of files){
    const b = await fileToBase64(f);
    if(b) out.push(b);
  }
  return out;
}

/* ---------- Follow-up queue (before save) ---------- */
function queueFollowup(kind){
  const prefix = kind === "supplier" ? "sup" : "buy";
  const d = $(`${prefix}FUDate`).value;
  const t = $(`${prefix}FUTime`).value;
  const note = $(`${prefix}FUNotes`).value.trim();
  if(!d || !t){
    alert("Pick follow-up date and time first.");
    return;
  }
  pendingFollowup[kind] = { date: d, time: t, note };
  $(`${prefix}FULast`).textContent = `Will schedule after save: ${formatFUDisplay(d,t)}`;
  toast("Follow-up queued. Now save the lead.");
}
function formatFUDisplay(d,t){
  return `${d} ${t}`;
}
$("supFUQueueBtn").addEventListener("click", ()=> queueFollowup("supplier"));
$("buyFUQueueBtn").addEventListener("click", ()=> queueFollowup("buyer"));

/* ---------- Save lead ---------- */
async function saveSupplier(closeAfter){
  const enteredBy = getUsername();
  if(!enteredBy){ openOverlay("userOverlay"); throw new Error("No username"); }

  const company = $("supCompany").value.trim();
  const productsOrNeeds = $("supProducts").value.trim();
  if(!company){ alert("Company name is required."); return; }
  if(!productsOrNeeds){ alert("What do they sell is required."); return; }

  const country = supCountryCombo.value;
  const payload = {
    type: "supplier",
    enteredBy,
    company,
    contact: $("supContact").value.trim(),
    title: $("supTitle").value.trim(),
    email: $("supEmail").value.trim(),
    phone: normalizePhone($("supPhone").value, country),
    phone2: normalizePhone($("supPhone2").value, country),
    website: $("supWebsite").value.trim(),
    social: $("supSocial").value.trim(),
    country,
    markets: supMarketsCombo.value,
    privateLabel: $("supPL").value,
    productType: supProductTypeCombo.value,
    productsOrNeeds,
    exFactory: $("supExFactory").value.trim(),
    fob: $("supFOB").value.trim(),
    qrData: $("supQR").value.trim(),
    notes: $("supNotes").value.trim(),
    followup: pendingFollowup.supplier || null,
    cardFile: await fileToBase64($("supCardFile").files[0]),
    catalogFiles: await filesToBase64List($("supCatalogFiles").files)
  };

  $("status").textContent = "Saving…";
  const res = await apiPost("saveLead", payload);
  $("status").textContent = "Ready";

  if(res.result !== "ok"){
    alert(`Save failed: ${res.message || "Unknown error"}`);
    return;
  }
  pendingFollowup.supplier = null;
  $("supFULast").textContent = "";
  $("supResult").innerHTML = `Saved. <a href="${esc(res.folderUrl)}" target="_blank" rel="noreferrer">Open Drive folder</a> • <a href="${esc(res.itemsSheetUrl)}" target="_blank" rel="noreferrer">Items sheet</a>`;
  addSessionLead({
    typeLabel: "Supplier",
    contactOrCompany: `${payload.company}`,
    country: payload.country,
    timeIst: res.timeIst || ""
  });

  // Refresh lists + dashboards
  await refreshLists();
  if(closeAfter){
    showView("Dashboard");
  }else{
    clearSupplierForm(true);
  }
}
async function saveBuyer(closeAfter){
  const enteredBy = getUsername();
  if(!enteredBy){ openOverlay("userOverlay"); throw new Error("No username"); }

  const contact = $("buyContact").value.trim();
  const needs = $("buyNeeds").value.trim();
  if(!contact){ alert("Contact person is required."); return; }
  if(!needs){ alert("What do they want to buy is required."); return; }

  const country = buyCountryCombo.value;
  const payload = {
    type: "buyer",
    enteredBy,
    company: $("buyCompany").value.trim(),
    contact,
    title: $("buyTitle").value.trim(),
    email: $("buyEmail").value.trim(),
    phone: normalizePhone($("buyPhone").value, country),
    phone2: normalizePhone($("buyPhone2").value, country),
    website: $("buyWebsite").value.trim(),
    social: $("buySocial").value.trim(),
    country,
    markets: buyMarketsCombo.value,
    privateLabel: $("buyPL").value,
    productType: buyProductTypeCombo.value,
    productsOrNeeds: needs,
    exFactory: "",
    fob: "",
    qrData: $("buyQR").value.trim(),
    notes: $("buyNotes").value.trim(),
    followup: pendingFollowup.buyer || null,
    cardFile: await fileToBase64($("buyCardFile").files[0]),
    catalogFiles: await filesToBase64List($("buyCatalogFiles").files)
  };

  $("status").textContent = "Saving…";
  const res = await apiPost("saveLead", payload);
  $("status").textContent = "Ready";

  if(res.result !== "ok"){
    alert(`Save failed: ${res.message || "Unknown error"}`);
    return;
  }
  pendingFollowup.buyer = null;
  $("buyFULast").textContent = "";
  $("buyResult").innerHTML = `Saved. <a href="${esc(res.folderUrl)}" target="_blank" rel="noreferrer">Open Drive folder</a> • <a href="${esc(res.itemsSheetUrl)}" target="_blank" rel="noreferrer">Items sheet</a>`;
  addSessionLead({
    typeLabel: "Buyer",
    contactOrCompany: `${payload.contact}${payload.company ? " / "+payload.company : ""}`,
    country: payload.country,
    timeIst: res.timeIst || ""
  });

  await refreshLists();
  if(closeAfter){
    showView("Dashboard");
  }else{
    clearBuyerForm(true);
  }
}

function clearSupplierForm(keepLeadType){
  $("supCompany").value = "";
  $("supContact").value = "";
  $("supTitle").value = "";
  $("supEmail").value = "";
  $("supPhone").value = "";
  $("supPhone2").value = "";
  $("supWebsite").value = "";
  $("supSocial").value = "";
  $("supPL").value = "";
  $("supExFactory").value = "";
  $("supFOB").value = "";
  $("supProducts").value = "";
  $("supCatalogFiles").value = "";
  $("supCardFile").value = "";
  $("supQR").value = "";
  $("supNotes").value = "";
  $("supFUDate").value = "";
  $("supFUTime").value = "";
  $("supFUNotes").value = "";
  pendingFollowup.supplier = null;
  $("supFULast").textContent = "";
  $("supResult").textContent = "";
  if(!keepLeadType) setLeadType("supplier");
}
function clearBuyerForm(keepLeadType){
  $("buyCompany").value = "";
  $("buyContact").value = "";
  $("buyTitle").value = "";
  $("buyEmail").value = "";
  $("buyPhone").value = "";
  $("buyPhone2").value = "";
  $("buyWebsite").value = "";
  $("buySocial").value = "";
  $("buyPL").value = "";
  $("buyNeeds").value = "";
  $("buyCatalogFiles").value = "";
  $("buyCardFile").value = "";
  $("buyQR").value = "";
  $("buyNotes").value = "";
  $("buyFUDate").value = "";
  $("buyFUTime").value = "";
  $("buyFUNotes").value = "";
  pendingFollowup.buyer = null;
  $("buyFULast").textContent = "";
  $("buyResult").textContent = "";
  if(!keepLeadType) setLeadType("buyer");
}
$("clearSupplier").addEventListener("click", ()=> clearSupplierForm(true));
$("clearBuyer").addEventListener("click", ()=> clearBuyerForm(true));

$("saveSupplierNew").addEventListener("click", ()=> saveSupplier(false).catch(console.error));
$("saveSupplierClose").addEventListener("click", ()=> saveSupplier(true).catch(console.error));
$("saveBuyerNew").addEventListener("click", ()=> saveBuyer(false).catch(console.error));
$("saveBuyerClose").addEventListener("click", ()=> saveBuyer(true).catch(console.error));

/* ---------- Dashboard / Leads / Calendar ---------- */
let dashCountryCombo, dashMarketCombo, dashPTCombo;
let leadsCountryCombo, leadsMarketCombo, leadsPTCombo;
let supCountryCombo, supMarketsCombo, supProductTypeCombo;
let buyCountryCombo, buyMarketsCombo, buyProductTypeCombo;
let editCountryCombo, editMarketsCombo, editPTCombo;

async function refreshLists(){
  const res = await apiGet("lists");
  if(res.result !== "ok") return;
  listsCache = res.lists || listsCache;

  const { countries, markets, productTypes } = listsCache;

  // update all combos
  [supCountryCombo, buyCountryCombo, dashCountryCombo, leadsCountryCombo, editCountryCombo].forEach(c=> c?.setOptions(countries));
  [supMarketsCombo, buyMarketsCombo, dashMarketCombo, leadsMarketCombo, editMarketsCombo].forEach(c=> c?.setOptions(markets));
  [supProductTypeCombo, buyProductTypeCombo, dashPTCombo, leadsPTCombo, editPTCombo].forEach(c=> c?.setOptions(productTypes));
}

function getFilters(prefix){
  return {
    country: window[`${prefix}CountryCombo`]?.value || "",
    markets: window[`${prefix}MarketCombo`]?.value || "",
    productType: window[`${prefix}PTCombo`]?.value || "",
    q: $(prefix==="dash" ? "dashQ" : "leadsQ")?.value?.trim() || ""
  };
}

async function refreshDashboard(){
  const f = {
    country: dashCountryCombo.value,
    markets: dashMarketCombo.value,
    productType: dashPTCombo.value,
    q: $("dashQ").value.trim()
  };
  const res = await apiGet("leads", f);
  if(res.result !== "ok"){ console.warn(res); return; }

  renderKpis(res.stats || {});
  renderDashTable(res.leads || []);
  renderUpcoming(res.followups || []);
}
$("btnDashRefresh").addEventListener("click", refreshDashboard);

function renderKpis(stats){
  const kpis = [
    { v: stats.total || 0, l: "Total leads" },
    { v: stats.suppliers || 0, l: "Suppliers" },
    { v: stats.buyers || 0, l: "Buyers" },
    { v: stats.today || 0, l: "Today" }
  ];
  $("kpis").innerHTML = kpis.map(k=>`
    <div class="kpi">
      <div class="kpi__v">${esc(k.v)}</div>
      <div class="kpi__l">${esc(k.l)}</div>
    </div>`).join("");
}
function renderDashTable(rows){
  const tb = $("dashTable").querySelector("tbody");
  tb.innerHTML = rows.slice(0, 30).map(r=>`
    <tr>
      <td>${esc(r.timeIst || "")}</td>
      <td>${esc(r.type || "")}</td>
      <td>${esc(r.company || "")}</td>
      <td>${esc(r.contact || "")}</td>
      <td>${esc(r.country || "")}</td>
      <td>${esc(r.markets || "")}</td>
      <td>${esc(r.productType || "")}</td>
      <td>${esc(r.enteredBy || "")}</td>
      <td>${r.folderUrl ? `<a href="${esc(r.folderUrl)}" target="_blank" rel="noreferrer">Folder</a>` : ""}</td>
    </tr>
  `).join("");
}
function renderUpcoming(items){
  const box = $("upcomingFollowups");
  if(!items.length){
    box.innerHTML = `<div class="hint">No follow-ups scheduled.</div>`;
    return;
  }
  box.innerHTML = items.slice(0, 12).map(f=>`
    <div class="item">
      <div class="t">${esc(f.whenIst || "")} • ${esc(f.type || "")}</div>
      <div class="m">${esc(f.companyOrContact || "")}</div>
      <div class="m">${esc(f.note || "")}</div>
      ${f.calendarUrl ? `<div class="m"><a href="${esc(f.calendarUrl)}" target="_blank" rel="noreferrer">Open Calendar</a></div>` : ""}
    </div>
  `).join("");
}

async function refreshLeads(){
  const f = {
    country: leadsCountryCombo.value,
    markets: leadsMarketCombo.value,
    productType: leadsPTCombo.value,
    q: $("leadsQ").value.trim()
  };
  const res = await apiGet("leads", f);
  if(res.result !== "ok") return;
  renderLeadsTable(res.leads || []);
}
$("btnLeadsRefresh").addEventListener("click", refreshLeads);

function whatsappLink(phone){
  const p = String(phone||"").replace(/[^\d+]/g,"");
  const digits = p.replace(/^\+/,"");
  return digits ? `https://wa.me/${digits}` : "";
}
function renderLeadsTable(rows){
  const tb = $("leadsTable").querySelector("tbody");
  tb.innerHTML = rows.map(r=>{
    const mail = r.email ? `mailto:${encodeURIComponent(r.email)}` : "";
    const tel = r.phone ? `tel:${encodeURIComponent(r.phone)}` : "";
    const wa = r.phone ? whatsappLink(r.phone) : "";
    return `
      <tr>
        <td>${esc(r.timeIst || "")}</td>
        <td>${esc(r.type || "")}</td>
        <td>${esc(r.company || "")}</td>
        <td>${esc(r.contact || "")}</td>
        <td>
          ${tel ? `<a href="${esc(tel)}">Call</a>` : ""} ${wa ? ` • <a href="${esc(wa)}" target="_blank" rel="noreferrer">WhatsApp</a>` : ""}
        </td>
        <td>${mail ? `<a href="${esc(mail)}">Email</a>` : ""}</td>
        <td>${esc(r.phone || "")}</td>
        <td>${esc(r.country || "")}</td>
        <td>${esc(r.markets || "")}</td>
        <td>${esc(r.productType || "")}</td>
        <td>${esc(r.enteredBy || "")}</td>
        <td>${r.folderUrl ? `<a href="${esc(r.folderUrl)}" target="_blank" rel="noreferrer">Folder</a>` : ""}</td>
        <td><button class="btn btn--ghost" data-edit="${esc(r.leadId)}">Edit</button></td>
      </tr>`;
  }).join("");

  tb.querySelectorAll("button[data-edit]").forEach(btn=>{
    btn.addEventListener("click", ()=> openEdit(btn.getAttribute("data-edit")));
  });
}

async function refreshCalendar(){
  const res = await apiGet("followups");
  if(res.result !== "ok") return;

  const events = (res.followups || []).map(f=>({
    id: f.followupId,
    title: `${(f.type||"").toUpperCase()}: ${f.companyOrContact||""}`,
    start: f.startIso, // ISO in IST offset
    end: f.endIso,
    extendedProps: f
  }));

  if(!calendar){
    const calEl = $("calendar");
    calendar = new FullCalendar.Calendar(calEl, {
      initialView: "timeGridWeek",
      height: "auto",
      nowIndicator: true,
      headerToolbar: { left: "prev,next today", center: "title", right: "timeGridWeek,dayGridMonth" },
      events,
      eventClick: (info)=>{
        const p = info.event.extendedProps || {};
        const lines = [
          `When: ${p.whenIst || ""}`,
          `Lead: ${p.companyOrContact || ""}`,
          `Note: ${p.note || ""}`
        ].join("\n");
        if(p.calendarUrl){
          if(confirm(lines + "\n\nOpen Google Calendar event?")){
            window.open(p.calendarUrl, "_blank", "noreferrer");
          }
        }else{
          alert(lines);
        }
      }
    });
    calendar.render();
  }else{
    calendar.removeAllEvents();
    calendar.addEventSource(events);
  }
}

/* ---------- Edit lead ---------- */
async function openEdit(leadId){
  const res = await apiGet("lead", { leadId });
  if(res.result !== "ok"){ alert("Could not load lead."); return; }
  editCurrent = res.lead;
  $("editLeadId").value = editCurrent.leadId || "";
  $("editType").value = editCurrent.type || "";
  $("editCompany").value = editCurrent.company || "";
  $("editContact").value = editCurrent.contact || "";
  $("editEmail").value = editCurrent.email || "";
  $("editPhone").value = editCurrent.phone || "";
  editCountryCombo.value = editCurrent.country || "";
  editMarketsCombo.value = editCurrent.markets || "";
  editPTCombo.value = editCurrent.productType || "";
  $("editPL").value = editCurrent.privateLabel || "";
  $("editProductsOrNeeds").value = editCurrent.productsOrNeeds || "";
  $("editNotes").value = editCurrent.notes || "";
  $("editFUDate").value = "";
  $("editFUTime").value = "";
  $("editFUNotes").value = "";

  openOverlay("editOverlay");
}
$("btnCloseEdit").addEventListener("click", ()=> closeOverlay("editOverlay"));

async function saveEdit(withFollowup){
  if(!editCurrent) return;

  const country = editCountryCombo.value;
  const payload = {
    leadId: editCurrent.leadId,
    updates: {
      company: $("editCompany").value.trim(),
      contact: $("editContact").value.trim(),
      email: $("editEmail").value.trim(),
      phone: normalizePhone($("editPhone").value, country),
      country,
      markets: editMarketsCombo.value,
      productType: editPTCombo.value,
      privateLabel: $("editPL").value,
      productsOrNeeds: $("editProductsOrNeeds").value.trim(),
      notes: $("editNotes").value.trim()
    }
  };

  if(withFollowup){
    const d = $("editFUDate").value;
    const t = $("editFUTime").value;
    if(!d || !t){ alert("Pick follow-up date and time."); return; }
    payload.followup = { date: d, time: t, note: $("editFUNotes").value.trim() };
  }

  $("editResult").textContent = "Saving…";
  const res = await apiPost("updateLead", payload);
  if(res.result !== "ok"){
    $("editResult").textContent = "";
    alert(`Save failed: ${res.message || "Unknown"}`);
    return;
  }
  $("editResult").textContent = "Saved.";
  await refreshLists();
  await refreshDashboard();
  await refreshLeads();
  await refreshCalendar();
  toast("Saved.");
  closeOverlay("editOverlay");
}
$("btnSaveEdit").addEventListener("click", ()=> saveEdit(false).catch(console.error));
$("btnSaveEditAndFollow").addEventListener("click", ()=> saveEdit(true).catch(console.error));

/* ---------- Toast ---------- */
let toastTimer=null;
function toast(msg){
  $("status").textContent = msg;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=> $("status").textContent="Ready", 2000);
}

/* ---------- init ---------- */
window.addEventListener("load", async ()=>{
  renderUserPill();

  // combos mount
  supCountryCombo = createCombo($("supCountryCombo"), [], "Search country…", (v)=> {
    $("supPhone").value = normalizePhone($("supPhone").value, v);
    $("supPhone2").value = normalizePhone($("supPhone2").value, v);
  });
  supMarketsCombo = createCombo($("supMarketsCombo"), [], "Search markets…");
  supProductTypeCombo = createCombo($("supProductTypeCombo"), [], "Search product type…");

  buyCountryCombo = createCombo($("buyCountryCombo"), [], "Search country…", (v)=> {
    $("buyPhone").value = normalizePhone($("buyPhone").value, v);
    $("buyPhone2").value = normalizePhone($("buyPhone2").value, v);
  });
  buyMarketsCombo = createCombo($("buyMarketsCombo"), [], "Search markets…");
  buyProductTypeCombo = createCombo($("buyProductTypeCombo"), [], "Search product type…");

  dashCountryCombo = createCombo($("dashCountryCombo"), [], "All countries");
  dashMarketCombo = createCombo($("dashMarketCombo"), [], "All markets");
  dashPTCombo = createCombo($("dashPTCombo"), [], "All product types");

  leadsCountryCombo = createCombo($("leadsCountryCombo"), [], "All countries");
  leadsMarketCombo = createCombo($("leadsMarketCombo"), [], "All markets");
  leadsPTCombo = createCombo($("leadsPTCombo"), [], "All product types");

  editCountryCombo = createCombo($("editCountryCombo"), [], "Country");
  editMarketsCombo = createCombo($("editMarketsCombo"), [], "Markets / notes");
  editPTCombo = createCombo($("editPTCombo"), [], "Product type");

  // first run lists
  try{
    await refreshLists();
  }catch(e){
    console.warn(e);
    openOverlay("settingsOverlay");
    $("status").textContent = "Set Apps Script URL in Settings.";
  }

  // username
  if(!getUsername()){
    $("usernameInput").value = "";
    openOverlay("userOverlay");
  }else{
    $("usernameInput").value = getUsername();
  }

  // default view
  setLeadType("supplier");
  showView("Capture");
});
// BOI CRM — app.js (FRONT-END ONLY)

const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzrHBqp6ZcS3lvRir9EchBhsldBS1jRghuQCWhj7XOY4nyuy8NRQP6mz3J1WGNYm-cD/exec";
const LS_SCRIPT_URL = "boi_crm_script_url";
const LS_USER = "boi_crm_user";

let mode = "supplier"; // supplier | buyer
let html5Qr = null;
let sessionCount = 0;

let LISTS = { productTypes: [], markets: [] };

// queued follow-ups (optional)
let queuedSupplierFU = null;
let queuedBuyerFU = null;

const $ = (id) => document.getElementById(id);

const COUNTRIES = [
  "India","United States","United Arab Emirates","Saudi Arabia","Qatar","Oman","Kuwait","Bahrain",
  "United Kingdom","Germany","France","Netherlands","Italy","Spain","Belgium","Sweden","Norway","Denmark",
  "Canada","Australia","New Zealand","Singapore","Malaysia","Indonesia","Thailand","Vietnam","Philippines",
  "Japan","South Korea","China","Hong Kong","Taiwan",
  "South Africa","Kenya","Nigeria","Egypt","Morocco",
  "Brazil","Mexico","Argentina","Chile",
  "Russia","Ukraine","Belarus","Poland","Czech Republic","Romania","Greece","Turkey"
];

const CALLING = {
  "India":"91","United States":"1","Canada":"1","United Kingdom":"44",
  "United Arab Emirates":"971","Saudi Arabia":"966","Qatar":"974","Oman":"968","Kuwait":"965","Bahrain":"973",
  "Germany":"49","France":"33","Netherlands":"31","Italy":"39","Spain":"34","Belgium":"32","Sweden":"46","Norway":"47","Denmark":"45",
  "Australia":"61","New Zealand":"64","Singapore":"65","Malaysia":"60","Indonesia":"62","Thailand":"66","Vietnam":"84","Philippines":"63",
  "Japan":"81","South Korea":"82","China":"86","Hong Kong":"852","Taiwan":"886",
  "South Africa":"27","Kenya":"254","Nigeria":"234","Egypt":"20","Morocco":"212",
  "Brazil":"55","Mexico":"52","Argentina":"54","Chile":"56",
  "Russia":"7","Ukraine":"380","Belarus":"375","Poland":"48","Czech Republic":"420","Romania":"40","Greece":"30","Turkey":"90"
};

function getScriptUrl() {
  return (localStorage.getItem(LS_SCRIPT_URL) || DEFAULT_SCRIPT_URL).trim();
}

function setStatus(msg) {
  $("status").textContent = msg || "";
}
function updateSummary() {
  $("summary").textContent = `${sessionCount} leads this session`;
}
function setUserPill() {
  const u = (localStorage.getItem(LS_USER) || "").trim();
  $("userPill").textContent = `User: ${u || "—"}`;
}

function openOverlay(id) { $(id).classList.add("open"); $(id).setAttribute("aria-hidden","false"); }
function closeOverlay(id) { $(id).classList.remove("open"); $(id).setAttribute("aria-hidden","true"); }

function ensureUser() {
  const u = (localStorage.getItem(LS_USER) || "").trim();
  if (u) return;
  openOverlay("userOverlay");
}

function showTab(which){
  const tabs = ["Capture","Dashboard","Leads"];
  tabs.forEach(t=>{
    $(`tab${t}`).classList.toggle("isActive", t===which);
    $(`view${t}`).style.display = (t===which) ? "" : "none";
  });
  if(which==="Dashboard") refreshDashboard();
  if(which==="Leads") refreshLeads();
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

/* --------- Combo (searchable dropdown) --------- */
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

  const list = document.createElement("div");
  list.className="combo__list";

  let value = "";

  function normalize(arr){
    return Array.from(new Set(arr.map(String).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
  }
  options = normalize(options);

  function open(){ root.classList.add("open"); render(input.value); }
  function close(){ root.classList.remove("open"); }
  function set(v){
    value = v || "";
    input.value = v || "";
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
  input.addEventListener("input", ()=>{ open(); render(input.value); });
  btn.addEventListener("click", ()=> root.classList.contains("open") ? close() : open());

  document.addEventListener("click",(e)=>{ if(!root.contains(e.target)) close(); });

  root.appendChild(input);
  root.appendChild(btn);
  root.appendChild(list);

  render("");

  return {
    get value(){ return value || input.value.trim(); },
    setValue(v){ set(v); },
    setOptions(newOpts){ options = normalize(newOpts); render(input.value); }
  };
}

/* --------- Phone auto-fix (WhatsApp ok) --------- */
function digitsOnly(s){ return String(s||"").replace(/[^\d]/g,""); }

function formatPhoneWithCountry(countryName, raw){
  const cc = CALLING[countryName] || "";
  let num = digitsOnly(raw);
  if(!num) return "";
  if(num.startsWith("00")) num = num.slice(2);
  if(cc && num.startsWith(cc)) num = num.slice(cc.length);
  num = num.replace(/^0+/, "");
  return cc ? `+${cc} ${num}` : `+${num}`;
}

function wirePhoneAutoFix(countryCombo, phoneId1, phoneId2){
  const p1 = $(phoneId1);
  const p2 = $(phoneId2);

  function fix(){
    const c = countryCombo.value;
    if(!c) return;
    if(p1.value.trim()) p1.value = formatPhoneWithCountry(c, p1.value);
    if(p2.value.trim()) p2.value = formatPhoneWithCountry(c, p2.value);
  }
  p1.addEventListener("blur", fix);
  p2.addEventListener("blur", fix);
}

/* --------- Files to base64 --------- */
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

/* --------- QR Scan --------- */
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

function openQr(){
  openOverlay("qrOverlay");
  if(!window.Html5Qrcode){
    alert("QR library not loaded.");
    closeQr();
    return;
  }
  if(!html5Qr) html5Qr = new Html5Qrcode("qr-reader");

  html5Qr.start(
    { facingMode:"environment" },
    { fps:10, qrbox:250 },
    (decodedText)=>{ applyScan(decodedText); closeQr(); },
    ()=>{}
  ).catch(err=>{
    console.error(err);
    alert("Could not start camera. Allow camera permission and try again.");
    closeQr();
  });
}

function closeQr(){
  closeOverlay("qrOverlay");
  if(html5Qr){ try{ html5Qr.stop().catch(()=>{}); }catch{} }
}

/* --------- Backend calls (NO CORS preflight) --------- */
async function postPayload(obj){
  setStatus("Saving…");

  // use form-urlencoded payload to avoid preflight
  const body = new URLSearchParams();
  body.set("payload", JSON.stringify(obj));

  const res = await fetch(getScriptUrl(), { method:"POST", body });
  const text = await res.text();

  let json;
  try { json = JSON.parse(text); }
  catch (e) { throw new Error(`Server did not return JSON: ${text.slice(0,140)}`); }

  if(json.result !== "success") throw new Error(json.message || "Save failed");
  setStatus("Saved ✓");
  return json;
}

async function getJson(params){
  const url = new URL(getScriptUrl());
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

/* --------- Lists + combos --------- */
let supCountry, buyCountry, supMarkets, buyMarkets, supProductType, buyProductType;
let dashCountry, dashMarket, dashPT;
let leadsCountry, leadsMarket, leadsPT;

function refreshAllCombos(){
  supProductType.setOptions(LISTS.productTypes || []);
  buyProductType.setOptions(LISTS.productTypes || []);
  supMarkets.setOptions(LISTS.markets || []);
  buyMarkets.setOptions(LISTS.markets || []);

  dashCountry.setOptions(COUNTRIES);
  leadsCountry.setOptions(COUNTRIES);

  dashMarket.setOptions(LISTS.markets || []);
  leadsMarket.setOptions(LISTS.markets || []);

  dashPT.setOptions(LISTS.productTypes || []);
  leadsPT.setOptions(LISTS.productTypes || []);
}

async function loadLists(){
  const data = await getJson({ action:"lists" });
  LISTS = data.lists || { productTypes:[], markets:[] };
}

/* --------- Follow-up queue (BEFORE save) --------- */
function formatISTFromInputs(dateVal, timeVal){
  if(!dateVal || !timeVal) return "";
  const [y,m,d] = dateVal.split("-").map(n=>parseInt(n,10));
  const [hh,mm] = timeVal.split(":").map(n=>parseInt(n,10));
  const dt = new Date(y, m-1, d, hh, mm, 0);

  try{
    return new Intl.DateTimeFormat("en-US", {
      timeZone:"Asia/Kolkata",
      month:"2-digit",day:"2-digit",year:"2-digit",
      hour:"numeric",minute:"2-digit",hour12:true
    }).format(dt).replace(",", "");
  } catch {
    return dt.toLocaleString();
  }
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

  const scheduledAtIST = formatISTFromInputs(d,t);
  const fu = { scheduledAtIST, notes };

  if(kind==="supplier") queuedSupplierFU = fu;
  else queuedBuyerFU = fu;

  $(outId).textContent = `Will schedule after save: ${scheduledAtIST}`;
}

/* --------- Clear forms --------- */
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

/* --------- Save handlers --------- */
async function saveSupplier(closeAfter){
  const company = $("supCompany").value.trim();
  const products = $("supProducts").value.trim();
  if(!company || !products){ alert("Fill Company and What do they sell."); return; }

  const enteredBy = (localStorage.getItem(LS_USER)||"Unknown").trim() || "Unknown";

  // enforce phone formatting (and allow WhatsApp)
  if(supCountry.value){
    if($("supPhone").value.trim()) $("supPhone").value = formatPhoneWithCountry(supCountry.value, $("supPhone").value);
    if($("supPhone2").value.trim()) $("supPhone2").value = formatPhoneWithCountry(supCountry.value, $("supPhone2").value);
  }

  // queue FU if date/time filled
  queueFollowUp("supplier");

  const uploads = await collectUploads("supCatalogFiles","supCardFile");

  const payload = {
    type:"supplier",
    enteredBy,
    company,
    contact:$("supContact").value.trim(),
    title:$("supTitle").value.trim(),
    email:$("supEmail").value.trim(),
    phone:$("supPhone").value.trim(),
    phone2:$("supPhone2").value.trim(),
    website:$("supWebsite").value.trim(),
    social:$("supSocial").value.trim(),
    country:supCountry.value,
    markets:supMarkets.value,
    privateLabel:$("supPL").value.trim(),
    productType:supProductType.value,
    productsOrNeeds:products,
    exFactory:$("supExFactory").value.trim(),
    fob:$("supFOB").value.trim(),
    qrData:$("supQR").value.trim(),
    notes:$("supNotes").value.trim(),
    catalogFiles:uploads.catalogFiles,
    cardFile:uploads.cardFile,
    pendingFollowUp: queuedSupplierFU
  };

  const res = await postPayload(payload);

  $("supResult").innerHTML =
    `Lead ID: <b>${esc(res.leadId)}</b><br>` +
    `Drive folder: <a target="_blank" rel="noopener" href="${esc(res.folderUrl)}">Open folder</a><br>` +
    `Items sheet: <a target="_blank" rel="noopener" href="${esc(res.itemsSheetUrl)}">Open items</a>`;

  sessionCount++; updateSummary();
  addSessionRow("Supplier", `${company}${payload.contact? " / "+payload.contact:""}`, payload.country);

  clearSupplier();

  if(closeAfter) showTab("Dashboard");
}

async function saveBuyer(closeAfter){
  const contact = $("buyContact").value.trim();
  const needs = $("buyNeeds").value.trim();
  if(!contact || !needs){ alert("Fill Contact and What do they want to buy."); return; }

  const enteredBy = (localStorage.getItem(LS_USER)||"Unknown").trim() || "Unknown";

  if(buyCountry.value){
    if($("buyPhone").value.trim()) $("buyPhone").value = formatPhoneWithCountry(buyCountry.value, $("buyPhone").value);
    if($("buyPhone2").value.trim()) $("buyPhone2").value = formatPhoneWithCountry(buyCountry.value, $("buyPhone2").value);
  }

  queueFollowUp("buyer");

  const uploads = await collectUploads("buyCatalogFiles","buyCardFile");

  const payload = {
    type:"buyer",
    enteredBy,
    company:$("buyCompany").value.trim(),
    contact,
    title:$("buyTitle").value.trim(),
    email:$("buyEmail").value.trim(),
    phone:$("buyPhone").value.trim(),
    phone2:$("buyPhone2").value.trim(),
    website:$("buyWebsite").value.trim(),
    social:$("buySocial").value.trim(),
    country:buyCountry.value,
    markets:buyMarkets.value,
    privateLabel:$("buyPL").value.trim(),
    productType:buyProductType.value,
    productsOrNeeds:needs,
    qrData:$("buyQR").value.trim(),
    notes:$("buyNotes").value.trim(),
    catalogFiles:uploads.catalogFiles,
    cardFile:uploads.cardFile,
    pendingFollowUp: queuedBuyerFU
  };

  const res = await postPayload(payload);

  $("buyResult").innerHTML =
    `Lead ID: <b>${esc(res.leadId)}</b><br>` +
    `Drive folder: <a target="_blank" rel="noopener" href="${esc(res.folderUrl)}">Open folder</a><br>` +
    `Items sheet: <a target="_blank" rel="noopener" href="${esc(res.itemsSheetUrl)}">Open items</a>`;

  sessionCount++; updateSummary();
  addSessionRow("Buyer", `${contact}${payload.company? " / "+payload.company:""}`, payload.country);

  clearBuyer();

  if(closeAfter) showTab("Dashboard");
}

/* --------- Dashboard / Leads --------- */
function renderKpis(k){
  const el = $("kpis");
  el.innerHTML = "";
  const items = [
    ["Total leads", k.total||0],
    ["Suppliers", k.suppliers||0],
    ["Buyers", k.buyers||0],
    ["Today", k.today||0]
  ];
  items.forEach(([label,val])=>{
    const d=document.createElement("div");
    d.className="kpi";
    d.innerHTML = `<div class="kpi__v">${esc(val)}</div><div class="kpi__l">${esc(label)}</div>`;
    el.appendChild(d);
  });
}

function rowLink(url, label){
  if(!url) return "";
  return `<a target="_blank" rel="noopener" href="${esc(url)}">${esc(label)}</a>`;
}

async function refreshDashboard(){
  try{
    const data = await getJson({
      action:"listLeads",
      limit:"200",
      q:$("dashQ").value.trim(),
      country: dashCountry.value,
      market: dashMarket.value,
      productType: dashPT.value
    });

    renderKpis(data.kpis || {});
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
  } catch(e){
    console.error(e);
    setStatus("Dashboard load failed.");
  }
}

async function refreshLeads(){
  try{
    const data = await getJson({
      action:"listLeads",
      limit:"800",
      q:$("leadsQ").value.trim(),
      country: leadsCountry.value,
      market: leadsMarket.value,
      productType: leadsPT.value
    });

    const tbody = $("leadsTable").querySelector("tbody");
    tbody.innerHTML = "";

    (data.rows||[]).forEach(r=>{
      const tr=document.createElement("tr");
      tr.innerHTML = `
        <td>${esc(r.timestampIST||"")}</td>
        <td>${esc(r.type||"")}</td>
        <td>${esc(r.company||"")}</td>
        <td>${esc(r.contact||"")}</td>
        <td>${esc(r.email||"")}</td>
        <td>${esc(r.phone||"")}</td>
        <td>${esc(r.country||"")}</td>
        <td>${esc(r.markets||"")}</td>
        <td>${esc(r.productType||"")}</td>
        <td>${esc(r.enteredBy||"")}</td>
        <td>${rowLink(r.folderUrl,"Folder")} ${r.itemsSheetUrl ? " | " + rowLink(r.itemsSheetUrl,"Items") : ""}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch(e){
    console.error(e);
    setStatus("Leads load failed.");
  }
}

/* --------- Boot --------- */
document.addEventListener("DOMContentLoaded", async ()=>{
  // tabs
  $("tabCapture").addEventListener("click", ()=>showTab("Capture"));
  $("tabDashboard").addEventListener("click", ()=>showTab("Dashboard"));
  $("tabLeads").addEventListener("click", ()=>showTab("Leads"));

  // lead type
  $("btnSupplier").addEventListener("click", ()=>setMode("supplier"));
  $("btnBuyer").addEventListener("click", ()=>setMode("buyer"));
  setMode("supplier");

  // overlays close (click outside)
  ["qrOverlay","settingsOverlay","userOverlay"].forEach(id=>{
    $(id).addEventListener("click",(e)=>{ if(e.target.id===id) closeOverlay(id); });
  });

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

  // user
  setUserPill();
  ensureUser();
  $("btnStartSession").addEventListener("click", ()=>{
    const name=$("usernameInput").value.trim();
    if(!name){ alert("Enter username"); return; }
    localStorage.setItem(LS_USER, name);
    setUserPill();
    closeOverlay("userOverlay");
  });
  $("btnSwitchUser").addEventListener("click", ()=>{
    localStorage.removeItem(LS_USER);
    setUserPill();
    openOverlay("userOverlay");
  });

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

  // phone fix
  wirePhoneAutoFix(supCountry, "supPhone", "supPhone2");
  wirePhoneAutoFix(buyCountry, "buyPhone", "buyPhone2");

  // follow-up queue buttons (this was failing before because file was broken)
  $("supFUQueueBtn").addEventListener("click", ()=>queueFollowUp("supplier"));
  $("buyFUQueueBtn").addEventListener("click", ()=>queueFollowUp("buyer"));

  // save buttons
  $("saveSupplierNew").addEventListener("click", ()=>saveSupplier(false));
  $("saveSupplierClose").addEventListener("click", ()=>saveSupplier(true));
  $("clearSupplier").addEventListener("click", clearSupplier);

  $("saveBuyerNew").addEventListener("click", ()=>saveBuyer(false));
  $("saveBuyerClose").addEventListener("click", ()=>saveBuyer(true));
  $("clearBuyer").addEventListener("click", clearBuyer);

  $("btnDashRefresh").addEventListener("click", refreshDashboard);
  $("btnLeadsRefresh").addEventListener("click", refreshLeads);

  // load lists from backend
  try{
    await loadLists();
  }catch(e){
    console.warn("Lists failed, using defaults", e);
    LISTS = { productTypes:["Chips","Dehydrated powders","Sweeteners"], markets:["USA","GCC","EU","India","UAE"] };
  }
  refreshAllCombos();

  setStatus("Ready");
  updateSummary();
});

