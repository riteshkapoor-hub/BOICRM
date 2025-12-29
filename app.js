// BOI CRM — app.js (FULL)
// Adds:
// - WhatsApp action next to phone (Leads + Calendar)
// - Duplicate detection before save (email/phone) via backend checkDuplicate
// - Works with Google Calendar sync fields (calendarEventId/calendarEventUrl) returned by backend
// Keeps:
// - Your existing theme, Calendar UI, Edit UI behaviors

const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzrHBqp6ZcS3lvRir9EchBhsldBS1jRghuQCWhj7XOY4nyuy8NRQP6mz3J1WGNYm-cD/exec";
const LS_SCRIPT_URL = "boi_crm_script_url";
const LS_TRADE_MODE = "boi_trade_mode";
const LS_LEADS_VIEW = "boi_leads_view";
const LS_USER = "boi_crm_user";

let mode = "supplier";
let html5Qr = null;
let qrRunning = false;
let sessionCount = 0;

let LISTS = { productTypes: [], markets: [] };
let queuedSupplierFU = null;
let queuedBuyerFU = null;

const $ = (id) => document.getElementById(id);

function getScriptUrl() {
  return (localStorage.getItem(LS_SCRIPT_URL) || DEFAULT_SCRIPT_URL).trim();
}

function setStatus(msg) { $("status").textContent = msg || ""; }
function updateSummary() { $("summary").textContent = `${sessionCount} leads this session`; }
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
  const tabs = ["Capture","Dashboard","Leads","Calendar"];
  tabs.forEach(t=>{
    $(`tab${t}`).classList.toggle("isActive", t===which);
    $(`view${t}`).style.display = (t===which) ? "" : "none";
  });
  if(which==="Dashboard") refreshDashboard();
  if(which==="Leads") refreshLeads();
  if(which==="Calendar") refreshCalendar();
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
  const body = new URLSearchParams();
  body.set("payload", JSON.stringify(obj));

  const res = await fetch(getScriptUrl(), { method:"POST", body });
  const text = await res.text();

  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Server did not return JSON: ${text.slice(0,140)}`); }

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
  const company = $("supCompany").value.trim();
  const products = $("supProducts").value.trim();
  if(!company || !products){ alert("Fill Company and What do they sell."); return; }

  queueFollowUp("supplier");
  const enteredBy = (localStorage.getItem(LS_USER)||"Unknown").trim() || "Unknown";

  await maybeSaveListItem("market", supMarkets);
  await maybeSaveListItem("productType", supProductType);

  // Normalize phones now
  const phone = normalizePhone(supCountry.value, $("supPhone").value);
  const phone2 = normalizePhone(supCountry.value, $("supPhone2").value);
  const email = $("supEmail").value.trim();

  // Duplicate check (block save unless user confirms)
  const ok = await checkDuplicatesBeforeSave({ email, phone, phone2 });
  if(!ok) return;

  const uploads = await collectUploads("supCatalogFiles","supCardFile");

  const payload = {
    type:"supplier",
    enteredBy,
    company,
    contact:$("supContact").value.trim(),
    title:$("supTitle").value.trim(),
    email,
    phone,
    phone2,
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
    `Items sheet: <a target="_blank" rel="noopener" href="${esc(res.itemsSheetUrl)}">Open items</a>` +
    (res.calendarEventUrl ? `<br>Calendar: <a target="_blank" rel="noopener" href="${esc(res.calendarEventUrl)}">Open event</a>` : "");

  sessionCount++; updateSummary();
  addSessionRow("Supplier", `${company}${payload.contact? " / "+payload.contact:""}`, payload.country);

  clearSupplier();
  if(closeAfter) showTab("Dashboard");
}

async function saveBuyer(closeAfter){
  const contact = $("buyContact").value.trim();
  const needs = $("buyNeeds").value.trim();
  if(!contact || !needs){ alert("Fill Contact and What do they want to buy."); return; }

  queueFollowUp("buyer");
  const enteredBy = (localStorage.getItem(LS_USER)||"Unknown").trim() || "Unknown";

  await maybeSaveListItem("market", buyMarkets);
  await maybeSaveListItem("productType", buyProductType);

  const phone = normalizePhone(buyCountry.value, $("buyPhone").value);
  const phone2 = normalizePhone(buyCountry.value, $("buyPhone2").value);
  const email = $("buyEmail").value.trim();

  const ok = await checkDuplicatesBeforeSave({ email, phone, phone2 });
  if(!ok) return;

  const uploads = await collectUploads("buyCatalogFiles","buyCardFile");

  const payload = {
    type:"buyer",
    enteredBy,
    company:$("buyCompany").value.trim(),
    contact,
    title:$("buyTitle").value.trim(),
    email,
    phone,
    phone2,
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
    `Items sheet: <a target="_blank" rel="noopener" href="${esc(res.itemsSheetUrl)}">Open items</a>` +
    (res.calendarEventUrl ? `<br>Calendar: <a target="_blank" rel="noopener" href="${esc(res.calendarEventUrl)}">Open event</a>` : "");

  sessionCount++; updateSummary();
  addSessionRow("Buyer", `${contact}${payload.company? " / "+payload.company:""}`, payload.country);

  clearBuyer();
  if(closeAfter) showTab("Dashboard");
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
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M7 3h3l2 5-2 1c1.2 2.6 3.4 4.8 6 6l1-2 5 2v3c0 1.1-.9 2-2 2-9.4 0-17-7.6-17-17 0-1.1.9-2 2-2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
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
  // simple WA glyph (keeps your theme – uses currentColor)
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M20 12a8 8 0 0 1-12.9 6.2L4 20l1.9-3.1A8 8 0 1 1 20 12z"
      stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M9.2 9.2c.2-.5.4-.6.7-.6h.6c.2 0 .4 0 .6.4l.8 1.9c.1.3.1.5-.1.7l-.4.5c-.1.1-.2.3 0 .5.2.5.8 1.4 1.6 2.1.8.7 1.6 1 2.1 1.2.2.1.4 0 .5-.1l.7-.8c.2-.2.4-.3.7-.2l2 .8c.3.1.4.3.4.5 0 .2 0 1.2-.6 1.8-.5.6-1.2.6-1.6.5-.3 0-1.4-.3-2.7-1.1-1.1-.6-2.3-1.7-3.2-2.9-.9-1.2-1.3-2.3-1.4-2.7-.1-.4-.1-1.1.4-1.5z"
      stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/* ---------- Dashboard / Leads ---------- */
let dashKpiType = "";
let dashKpiToday = false;

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
    const d=document.createElement("button");
    d.type="button";
    d.className="kpi";
    d.innerHTML = `<div class="kpi__v">${esc(val)}</div><div class="kpi__l">${esc(label)}</div>`;
    const key = label==="Suppliers" ? "supplier" : label==="Buyers" ? "buyer" : label==="Today" ? "today" : "all";
    d.dataset.key = key;
    d.classList.toggle("isActive", (key==="today" && dashKpiToday) || (key!=="all" && key!=="today" && dashKpiType===key));
    d.addEventListener("click", ()=>{
      if(key==="all"){ dashKpiType=""; dashKpiToday=false; }
      else if(key==="today"){ dashKpiToday = !dashKpiToday; dashKpiType=""; }
      else { dashKpiType = (dashKpiType===key? "": key); dashKpiToday=false; }
      refreshDashboard();
    });
    el.appendChild(d);
  });
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

    const rowsRaw = data.rows || [];

    // Apply KPI filters
    let rows = rowsRaw.slice();
    if(dashKpiType){ rows = rows.filter(r=> String(r.type||"").toLowerCase()===dashKpiType); }
    if(dashKpiToday){
      const now=new Date();
      const y=now.getFullYear(), m=now.getMonth(), d=now.getDate();
      rows = rows.filter(r=>{
        if(!r.followUpDateTimeIST) return false;
        const dt=new Date(r.followUpDateTimeIST);
        return dt.getFullYear()===y && dt.getMonth()===m && dt.getDate()===d;
      });
    }

    renderKpis(data.kpis || {});

    const tbody = $("dashTable").querySelector("tbody");
    tbody.innerHTML = "";

    (rows||[]).forEach(r=>{
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
      tr.addEventListener("click", (ev)=>{ if(ev.target && (ev.target.closest("a") || ev.target.closest("button"))) return; openEditFromRow(r); });
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
      limit:"1000",
      q:$("leadsQ").value.trim(),
      country: leadsCountry.value,
      market: leadsMarket.value,
      productType: leadsPT.value
    });

    window.__leadsCache = data.rows || [];
    try{ renderLeadsCards(window.__leadsCache); }catch(e){}
    try{ setLeadsView(getLeadsView()); }catch(e){}


    const tbody = $("leadsTable").querySelector("tbody");
    tbody.innerHTML = "";

    (data.rows||[]).forEach(r=>{
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
      tr.addEventListener("click", (ev)=>{ if(ev.target && (ev.target.closest("a") || ev.target.closest("button"))) return; openEditFromRow(r); });
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
  $("editType").value = row?.type || "";
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
    notes: $("editNotes").value.trim(),
    newFollowUp
  };

  try{
    const res = await postPayload(payload);
    $("editStatus").textContent = "Saved ✓" + (res?.calendarEventUrl ? " (Calendar updated)" : "");

    await refreshDashboard();
    await refreshLeads();
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
    $("calView"+x).classList.toggle("isActive", v===x.toLowerCase());
  });
  renderCalendar();
}

/* --- refresh from sheet --- */
async function refreshCalendar(){
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

/* ---------- BOOT (FULL) ---------- */
document.addEventListener("DOMContentLoaded", async ()=>{
  // tabs
  $("tabCapture").addEventListener("click", ()=>showTab("Capture"));
  $("tabDashboard").addEventListener("click", ()=>showTab("Dashboard"));
  $("tabLeads").addEventListener("click", ()=>showTab("Leads"));
  $("tabCalendar").addEventListener("click", ()=>showTab("Calendar"));

  // lead type
  $("btnSupplier").addEventListener("click", ()=>setMode("supplier"));
  $("btnBuyer").addEventListener("click", ()=>setMode("buyer"));
  setMode("supplier");

  // overlays close on backdrop click
  ["qrOverlay","settingsOverlay","userOverlay","editOverlay"].forEach(id=>{
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

  // save buttons
  $("saveSupplierNew").addEventListener("click", ()=>saveSupplier(false));
  $("saveSupplierClose").addEventListener("click", ()=>saveSupplier(true));
  $("clearSupplier").addEventListener("click", clearSupplier);

  $("saveBuyerNew").addEventListener("click", ()=>saveBuyer(false));
  $("saveBuyerClose").addEventListener("click", ()=>saveBuyer(true));
  $("clearBuyer").addEventListener("click", clearBuyer);

  // refresh buttons
  $("btnDashRefresh").addEventListener("click", refreshDashboard);
  $("btnLeadsRefresh").addEventListener("click", refreshLeads);

  // calendar controls
  $("calViewDay").addEventListener("click", ()=>setCalView("day"));
  $("calViewWeek").addEventListener("click", ()=>setCalView("week"));
  $("calViewMonth").addEventListener("click", ()=>setCalView("month"));

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
});

/* ---------- Quick follow-up helpers ---------- */
function setQuickFU(dateId, timeId, noteId, offsetDays){
  const dEl=$(dateId), tEl=$(timeId);
  if(!dEl || !tEl) return;
  const base=new Date();
  base.setHours(0,0,0,0);
  base.setDate(base.getDate() + (offsetDays||0));
  const yyyy=base.getFullYear();
  const mm=String(base.getMonth()+1).padStart(2,"0");
  const dd=String(base.getDate()).padStart(2,"0");
  dEl.value=`${yyyy}-${mm}-${dd}`;
  tEl.value="10:00";
  if(noteId && $(noteId) && !$(noteId).value.trim()){
    $(noteId).value="Call / WhatsApp follow-up";
  }
}
function clearQuickFU(dateId, timeId){
  $(dateId) && ($(dateId).value="");
  $(timeId) && ($(timeId).value="");
}


/* ---------- Sticky action bar ---------- */
function setSticky({show, primaryText, secondaryText, onPrimary, onSecondary}){
  const bar=$("stickyBar");
  if(!bar) return;
  document.body.classList.toggle("has-sticky", !!show);
  bar.setAttribute("aria-hidden", show ? "false" : "true");
  const p=$("stickyPrimary"), s=$("stickySecondary");
  if(primaryText) p.textContent=primaryText;
  if(secondaryText) s.textContent=secondaryText;
  p.onclick = onPrimary || null;
  s.onclick = onSecondary || null;
}


function getLeadsView(){ return (localStorage.getItem(LS_LEADS_VIEW) || "cards").toLowerCase(); }
function setLeadsView(v){
  localStorage.setItem(LS_LEADS_VIEW, v);
  $("leadsViewList")?.classList.toggle("isActive", v==="list");
  $("leadsViewCards")?.classList.toggle("isActive", v==="cards");
  const tableWrap = $("leadsTable")?.closest(".tablewrap");
  const cards = $("leadsCards");
  if(tableWrap) tableWrap.style.display = (v==="list") ? "" : "none";
  if(cards) cards.style.display = (v==="cards") ? "" : "none";
}
function leadChip(t){ return t ? `<span class="chip">${esc(t)}</span>` : ""; }

function renderLeadsCards(rows){
  const host=$("leadsCards");
  if(!host) return;
  host.innerHTML="";
  (rows||[]).forEach(r=>{
    const card=document.createElement("div");
    card.className="leadcard";
    const title=(r.company||r.contact||"").trim() || "—";
    const phone=(r.phone||"").trim();
    const email=(r.email||"").trim();
    const wa=safeWa(phone);
    card.innerHTML = `
      <div class="leadcard__top">
        <div>
          <div class="leadcard__title">${esc(title)}</div>
          <div class="leadcard__sub">${esc(r.type||"")} • ${esc(r.timestampIST||"")}</div>
        </div>
        <button class="btn btn--ghost" type="button" data-edit="1">${svgEdit()} Edit</button>
      </div>
      <div class="leadcard__meta">
        ${leadChip(r.country)}${leadChip(r.markets)}${leadChip(r.productType)}
      </div>
      <div class="leadcard__actions">
        ${phone ? `<a class="iconbtn" href="tel:${esc(safeTel(phone))}">${svgPhone()} Call</a>`:""}
        ${wa ? `<a class="iconbtn" target="_blank" rel="noopener" href="${esc(wa)}">${svgWhatsApp()} WhatsApp</a>`:""}
        ${email ? `<a class="iconbtn" href="mailto:${esc(email)}">${svgMail()} Email</a>`:""}
        ${r.folderUrl ? `<a class="iconbtn" target="_blank" rel="noopener" href="${esc(r.folderUrl)}">Folder</a>`:""}
      </div>
    `;
    card.querySelector("[data-edit]")?.addEventListener("click", ()=> openEdit(r.leadId, r));
    card.addEventListener("click",(ev)=>{
      if(ev.target.closest("a")||ev.target.closest("button")) return;
      openEdit(r.leadId, r);
    });
    host.appendChild(card);
  });
}


function updateSticky(){
  const touch = (()=>{ try{ return window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(max-width: 1100px)").matches; }catch(e){ return window.innerWidth<=1100; }})();
  const editOpen = $("editOverlay")?.classList.contains("open");
  const captureVisible = $("viewCapture") && $("viewCapture").style.display !== "none";
  // only Capture or Edit
  if(!editOpen && !captureVisible){ setSticky({show:false}); return; }
  if(!touch){ setSticky({show:false}); return; }

  if(editOpen){
    setSticky({
      show:true,
      primaryText:"Save Changes",
      secondaryText:"Close",
      onPrimary: ()=> $("btnSaveEdit")?.click(),
      onSecondary: ()=> $("btnCloseEdit")?.click()
    });
    return;
  }

  const isSupplier = (mode==="supplier");
  setSticky({
    show:true,
    primaryText:"Save & New",
    secondaryText:"Save & Close",
    onPrimary: ()=> (isSupplier ? $("saveSupplierNew") : $("saveBuyerNew"))?.click(),
    onSecondary: ()=> (isSupplier ? $("saveSupplierClose") : $("saveBuyerClose"))?.click()
  });
}
