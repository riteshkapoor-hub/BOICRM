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
});/***********************
 * BOI CRM — Full Frontend
 * - Capture / Dashboard / Leads / Calendar
 * - Settings (Script URL + User)
 * - QR Scanner (NO auto-open, closes correctly)
 * - Saves to Apps Script /exec if configured
 * - Local storage cache
 ***********************/

const DEFAULT_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzrHBqp6ZcS3lvRir9EchBhsldBS1jRghuQCWhj7XOY4nyuy8NRQP6mz3J1WGNYm-cD/exec";

const LS_KEYS = {
  settings: "boi_crm_settings_v1",
  leads: "boi_crm_leads_v1",
  tasks: "boi_crm_tasks_v1"
};

const $ = (id) => document.getElementById(id);

/* =========================
   SETTINGS / STATE
========================= */
function loadSettings() {
  const raw = localStorage.getItem(LS_KEYS.settings);
  const s = raw ? JSON.parse(raw) : {};
  return {
    scriptUrl: s.scriptUrl || "",
    user: s.user || "",
    cache: s.cache || "on"
  };
}

function saveSettings(s) {
  localStorage.setItem(LS_KEYS.settings, JSON.stringify(s));
}

let SETTINGS = loadSettings();
let ACTIVE_TAB = "capture";
let LEAD_TYPE = "Supplier"; // Supplier / Buyer

/* =========================
   LOCAL DATA
========================= */
function loadLeads() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS.leads) || "[]"); }
  catch { return []; }
}
function saveLeads(list) {
  localStorage.setItem(LS_KEYS.leads, JSON.stringify(list));
}
function loadTasks() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS.tasks) || "[]"); }
  catch { return []; }
}
function saveTasks(list) {
  localStorage.setItem(LS_KEYS.tasks, JSON.stringify(list));
}

/* =========================
   UI HELPERS
========================= */
function setMsg(el, text, kind = "") {
  if (!el) return;
  el.className = `msg ${kind}`.trim();
  el.textContent = text || "";
}

function setBadge(el, text, kind) {
  if (!el) return;
  el.className = `badge ${kind}`.trim();
  el.textContent = text;
}

function isConfigured() {
  const okUser = !!(SETTINGS.user && SETTINGS.user.trim());
  const okUrl = !!(SETTINGS.scriptUrl && SETTINGS.scriptUrl.includes("/exec"));
  return okUser && okUrl;
}

function refreshHeader() {
  $("activeUserLabel").textContent = SETTINGS.user ? SETTINGS.user : "—";
  const statusEl = $("configStatus");
  if (isConfigured()) setBadge(statusEl, "Configured", "badge-ok");
  else setBadge(statusEl, "Not configured", "badge-warn");
}

function showTab(tabName) {
  ACTIVE_TAB = tabName;
  document.querySelectorAll(".tab").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tabName);
  });
  ["capture","dashboard","leads","calendar"].forEach(t => {
    const el = $(`tab-${t}`);
    el.classList.toggle("hidden", t !== tabName);
  });

  if (tabName === "dashboard") renderDashboard();
  if (tabName === "leads") renderLeads();
  if (tabName === "calendar") renderCalendar();
}

/* =========================
   MODALS
========================= */
function openModal(modalId) {
  const m = $(modalId);
  if (!m) return;
  m.classList.remove("hidden");
  m.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}
function closeModal(modalId) {
  const m = $(modalId);
  if (!m) return;
  m.classList.add("hidden");
  m.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

/* =========================
   LEAD FORM
========================= */
function clearLeadForm() {
  $("company").value = "";
  $("contactName").value = "";
  $("title").value = "";
  $("email").value = "";
  $("country").value = "";
  $("markets").value = "";
  $("phone1").value = "";
  $("phone2").value = "";
  $("website").value = "";
  $("social").value = "";
  $("productType").value = "";
  $("productsOrNeeds").value = "";
  $("notes").value = "";
  $("followUpDate").value = "";
  $("priority").value = "Warm";
  setMsg($("captureMsg"), "");
}

function buildLeadPayload() {
  const now = new Date();
  return {
    id: `L-${now.getTime()}`,
    createdAt: now.toISOString(),
    createdAtLocal: now.toLocaleString(),
    user: SETTINGS.user || "",
    leadType: LEAD_TYPE,
    company: $("company").value.trim(),
    contactName: $("contactName").value.trim(),
    title: $("title").value.trim(),
    email: $("email").value.trim(),
    country: $("country").value.trim(),
    markets: $("markets").value.trim(),
    phone1: $("phone1").value.trim(),
    phone2: $("phone2").value.trim(),
    website: $("website").value.trim(),
    social: $("social").value.trim(),
    productType: $("productType").value.trim(),
    productsOrNeeds: $("productsOrNeeds").value.trim(),
    notes: $("notes").value.trim(),
    followUpDate: $("followUpDate").value,
    priority: $("priority").value
  };
}

/* =========================
   SAVE TO APPS SCRIPT
   (Compatible with many Apps Script handlers using doPost)
========================= */
async function postToScript(payload) {
  const url = SETTINGS.scriptUrl || "";
  if (!url || !url.includes("/exec")) throw new Error("Apps Script URL not set.");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  // Some scripts return JSON, some return plain text
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(parsed?.message || text || `HTTP ${res.status}`);
  return parsed || { ok: true, raw: text };
}

async function saveLeadFlow(lead) {
  // Always cache locally first (unless user turned cache off)
  if (SETTINGS.cache === "on") {
    const leads = loadLeads();
    leads.unshift(lead);
    saveLeads(leads);
  }

  // If configured, push to Apps Script
  if (isConfigured()) {
    await postToScript({ action: "saveLead", lead });
  }
}

/* =========================
   DASHBOARD
========================= */
function renderDashboard() {
  const leads = loadLeads();
  $("kpiTotal").textContent = String(leads.length);

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth()+1).padStart(2,"0");
  const dd = String(today.getDate()).padStart(2,"0");
  const todayKey = `${yyyy}-${mm}-${dd}`;

  const savedToday = leads.filter(l => (l.createdAt || "").slice(0,10) === todayKey).length;
  $("kpiToday").textContent = String(savedToday);

  const dueCount = leads.filter(l => {
    if (!l.followUpDate) return false;
    const d = new Date(l.followUpDate);
    const diffDays = (d - new Date(todayKey)) / (1000*60*60*24);
    return diffDays >= 0 && diffDays <= 7;
  }).length;

  $("kpiDue").textContent = String(dueCount);

  const upcoming = leads
    .filter(l => l.followUpDate)
    .sort((a,b)=> (a.followUpDate||"").localeCompare(b.followUpDate||""))
    .slice(0,8);

  const box = $("dashUpcoming");
  box.innerHTML = "";
  if (!upcoming.length) {
    box.innerHTML = `<div class="item"><div class="muted small">No upcoming follow-ups.</div></div>`;
    return;
  }

  for (const l of upcoming) {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="item-top">
        <div>
          <div class="item-title">${escapeHtml(l.company || "(No company)")}</div>
          <div class="item-sub">${escapeHtml(l.contactName || "")} • ${escapeHtml(l.leadType || "")}</div>
        </div>
        <div class="item-actions">
          <span class="pill">Follow-up: ${escapeHtml(l.followUpDate)}</span>
          <span class="pill">${escapeHtml(l.priority || "")}</span>
        </div>
      </div>
    `;
    box.appendChild(el);
  }
}

/* =========================
   LEADS LIST
========================= */
function renderLeads() {
  const q = ($("leadSearch").value || "").trim().toLowerCase();
  const leads = loadLeads();
  const filtered = !q ? leads : leads.filter(l => {
    const hay = [
      l.company, l.contactName, l.email, l.country, l.phone1, l.phone2, l.productType, l.markets, l.leadType
    ].join(" ").toLowerCase();
    return hay.includes(q);
  });

  const box = $("leadsList");
  box.innerHTML = "";

  if (!filtered.length) {
    box.innerHTML = `<div class="item"><div class="muted small">No leads found.</div></div>`;
    return;
  }

  for (const l of filtered) {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="item-top">
        <div>
          <div class="item-title">${escapeHtml(l.company || "(No company)")}</div>
          <div class="item-sub">
            ${escapeHtml(l.contactName || "")}
            ${l.email ? " • " + escapeHtml(l.email) : ""}
            ${l.country ? " • " + escapeHtml(l.country) : ""}
          </div>
          <div class="item-sub">
            ${escapeHtml(l.leadType || "")}
            ${l.priority ? " • " + escapeHtml(l.priority) : ""}
            ${l.followUpDate ? " • Follow-up: " + escapeHtml(l.followUpDate) : ""}
          </div>
        </div>
        <div class="item-actions">
          <button class="btn btn-ghost btn-sm" data-act="copy" data-id="${l.id}">Copy</button>
          <button class="btn btn-danger btn-sm" data-act="delete" data-id="${l.id}">Delete</button>
        </div>
      </div>
    `;
    box.appendChild(el);
  }
}

function deleteLeadLocal(id) {
  const leads = loadLeads().filter(l => l.id !== id);
  saveLeads(leads);
  renderLeads();
  renderDashboard();
}

/* =========================
   CALENDAR (TASKS)
========================= */
function renderCalendar() {
  const tasks = loadTasks().sort((a,b)=> (a.due||"").localeCompare(b.due||""));
  const box = $("taskList");
  box.innerHTML = "";

  if (!tasks.length) {
    box.innerHTML = `<div class="item"><div class="muted small">No tasks yet.</div></div>`;
    return;
  }

  for (const t of tasks) {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="item-top">
        <div>
          <div class="item-title">${escapeHtml(t.title || "(Untitled)")}</div>
          <div class="item-sub">${t.company ? escapeHtml(t.company) + " • " : ""}${t.due ? "Due: " + escapeHtml(t.due) : "No due date"}</div>
        </div>
        <div class="item-actions">
          <button class="btn btn-ghost btn-sm" data-act="done" data-id="${t.id}">Done</button>
          <button class="btn btn-danger btn-sm" data-act="deleteTask" data-id="${t.id}">Delete</button>
        </div>
      </div>
    `;
    box.appendChild(el);
  }
}

function addTask() {
  const title = $("taskTitle").value.trim();
  const due = $("taskDue").value;
  const company = $("taskCompany").value.trim();

  if (!title) {
    setMsg($("calendarMsg"), "Please enter a task title.", "warn");
    return;
  }
  const t = {
    id: `T-${Date.now()}`,
    title,
    due,
    company,
    createdAt: new Date().toISOString()
  };

  const tasks = loadTasks();
  tasks.unshift(t);
  saveTasks(tasks);

  $("taskTitle").value = "";
  $("taskDue").value = "";
  $("taskCompany").value = "";

  setMsg($("calendarMsg"), "✅ Task added.", "success");
  renderCalendar();
  renderDashboard();
}

function deleteTask(id) {
  const tasks = loadTasks().filter(t => t.id !== id);
  saveTasks(tasks);
  renderCalendar();
  renderDashboard();
}

/* =========================
   QR SCANNER — FULL FIX
   - NO auto-start
   - state guards prevent re-open loop
   - hard stop + clear on close
========================= */
let __scannerActive = false;
let __scannerStarting = false;
let __lastScanAt = 0;
let __html5Qr = null;

function scannerOpenUI() { openModal("scannerModal"); }
function scannerCloseUI() { closeModal("scannerModal"); setMsg($("scanMsg"), ""); }

async function startScanner() {
  if (__scannerActive || __scannerStarting) return; // critical guard
  __scannerStarting = true;
  __scannerActive = true;

  scannerOpenUI();
  setMsg($("scanMsg"), "Starting camera…", "");

  if (!__html5Qr) __html5Qr = new Html5Qrcode("qrReader", false);

  try {
    const config = { fps: 10, qrbox: { width: 280, height: 280 }, rememberLastUsedCamera: true };

    await __html5Qr.start(
      { facingMode: "environment" },
      config,
      (decodedText) => {
        const now = Date.now();
        if (now - __lastScanAt < 1200) return; // debounce
        __lastScanAt = now;

        setMsg($("scanMsg"), "✅ QR detected. Filling fields…", "success");
        handleDecodedQR(decodedText);

        // stop & close immediately (prevents auto re-open)
        stopScanner(true).catch(()=>{});
      },
      (_err) => { /* ignore continuous scan errors */ }
    );

    setMsg($("scanMsg"), "Camera ON. Point at a QR code.", "");
  } catch (e) {
    console.error("Scanner start error:", e);
    setMsg($("scanMsg"), `Camera error: ${e.message || e}`, "error");
    await stopScanner(true);
  } finally {
    __scannerStarting = false;
  }
}

async function stopScanner(closeUI = false) {
  try {
    if (__html5Qr) {
      try { await __html5Qr.stop(); } catch (e) {}
      try { await __html5Qr.clear(); } catch (e) {}
    }
  } finally {
    __scannerActive = false;
    __scannerStarting = false;
    if (closeUI) scannerCloseUI();
  }
}

// vCard + JSON + plain fallback
function handleDecodedQR(text) {
  if (!text) return;

  if (/BEGIN:VCARD/i.test(text)) {
    const parsed = parseVCard(text);
    if (parsed.org) $("company").value = parsed.org;
    if (parsed.fn) $("contactName").value = parsed.fn;
    if (parsed.title) $("title").value = parsed.title;
    if (parsed.email) $("email").value = parsed.email;
    if (parsed.tel) $("phone1").value = parsed.tel;
    return;
  }

  // JSON QR
  try {
    const obj = JSON.parse(text);
    if (obj.company) $("company").value = obj.company;
    if (obj.name || obj.contactName) $("contactName").value = obj.name || obj.contactName;
    if (obj.title) $("title").value = obj.title;
    if (obj.email) $("email").value = obj.email;
    if (obj.phone) $("phone1").value = obj.phone;
    if (obj.country) $("country").value = obj.country;
    return;
  } catch {}

  // Fallback: append to notes
  const n = $("notes").value.trim();
  $("notes").value = (n ? n + "\n" : "") + `QR: ${text}`;
}

function parseVCard(vcardText) {
  const out = { fn:"", email:"", tel:"", org:"", title:"" };
  const lines = vcardText.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  for (const l of lines) {
    if (/^FN:/i.test(l)) out.fn = l.replace(/^FN:/i,"").trim();
    if (/^EMAIL/i.test(l)) out.email = l.split(":").slice(1).join(":").trim();
    if (/^TEL/i.test(l)) out.tel = l.split(":").slice(1).join(":").trim();
    if (/^ORG:/i.test(l)) out.org = l.replace(/^ORG:/i,"").trim();
    if (/^TITLE:/i.test(l)) out.title = l.replace(/^TITLE:/i,"").trim();
  }
  return out;
}

/* =========================
   MISC
========================= */
function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* =========================
   EVENT WIRING
========================= */
function bindEvents() {
  // Tabs
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });

  // Lead type toggle
  $("leadTypeSupplier").addEventListener("click", () => {
    LEAD_TYPE = "Supplier";
    $("leadTypeSupplier").classList.add("active");
    $("leadTypeBuyer").classList.remove("active");
  });
  $("leadTypeBuyer").addEventListener("click", () => {
    LEAD_TYPE = "Buyer";
    $("leadTypeBuyer").classList.add("active");
    $("leadTypeSupplier").classList.remove("active");
  });

  // Capture save
  $("leadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msgEl = $("captureMsg");
    setMsg(msgEl, "");

    const lead = buildLeadPayload();
    if (!lead.company) {
      setMsg(msgEl, "Company name is required.", "warn");
      return;
    }

    const btn = $("btnSaveLead");
    btn.disabled = true;
    btn.textContent = "Saving…";

    try {
      await saveLeadFlow(lead);
      setMsg(msgEl, "✅ Saved. (Local cache + Apps Script if configured)", "success");
      renderDashboard();
      renderLeads();
    } catch (err) {
      console.error(err);
      setMsg(msgEl, `❌ Save failed: ${err.message}`, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save Lead";
    }
  });

  $("btnClearLead").addEventListener("click", clearLeadForm);

  // Dashboard refresh
  $("btnRefreshDashboard").addEventListener("click", renderDashboard);

  // Leads actions
  $("leadSearch").addEventListener("input", renderLeads);
  $("leadsList").addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    const leads = loadLeads();
    const lead = leads.find(l => l.id === id);
    if (!lead) return;

    if (act === "delete") {
      deleteLeadLocal(id);
    }
    if (act === "copy") {
      const text =
`Company: ${lead.company || ""}
Contact: ${lead.contactName || ""}
Title: ${lead.title || ""}
Email: ${lead.email || ""}
Phone1: ${lead.phone1 || ""}
Country: ${lead.country || ""}
Lead Type: ${lead.leadType || ""}
Priority: ${lead.priority || ""}
Follow-up: ${lead.followUpDate || ""}
Products/Needs:
${lead.productsOrNeeds || ""}
Notes:
${lead.notes || ""}`.trim();

      try {
        await navigator.clipboard.writeText(text);
        alert("Copied lead to clipboard.");
      } catch {
        alert("Copy failed (browser blocked clipboard).");
      }
    }
  });

  $("btnExportJson").addEventListener("click", () => {
    const leads = loadLeads();
    const blob = new Blob([JSON.stringify(leads, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `boi-crm-leads-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $("btnClearLocal").addEventListener("click", () => {
    if (!confirm("Clear ALL locally saved leads?")) return;
    saveLeads([]);
    renderLeads();
    renderDashboard();
  });

  // Calendar tasks
  $("btnAddTask").addEventListener("click", addTask);
  $("btnClearTask").addEventListener("click", () => {
    $("taskTitle").value = "";
    $("taskDue").value = "";
    $("taskCompany").value = "";
    setMsg($("calendarMsg"), "");
  });
  $("btnRefreshCalendar").addEventListener("click", renderCalendar);
  $("taskList").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    if (act === "deleteTask" || act === "done") deleteTask(id);
  });

  // Settings
  $("btnOpenSettings").addEventListener("click", () => {
    $("settingScriptUrl").value = SETTINGS.scriptUrl || DEFAULT_SCRIPT_URL;
    $("settingUser").value = SETTINGS.user || "";
    $("settingCache").value = SETTINGS.cache || "on";
    setMsg($("settingsMsg"), "");
    openModal("settingsModal");
  });
  $("btnCloseSettings").addEventListener("click", () => closeModal("settingsModal"));
  $("settingsBackdrop").addEventListener("click", () => closeModal("settingsModal"));

  $("btnSaveSettings").addEventListener("click", () => {
    const scriptUrl = $("settingScriptUrl").value.trim();
    const user = $("settingUser").value.trim();
    const cache = $("settingCache").value;

    SETTINGS = { scriptUrl, user, cache };
    saveSettings(SETTINGS);
    refreshHeader();
    setMsg($("settingsMsg"), "✅ Settings saved.", "success");
  });

  $("btnResetSettings").addEventListener("click", () => {
    if (!confirm("Reset settings?")) return;
    SETTINGS = { scriptUrl: "", user: "", cache: "on" };
    saveSettings(SETTINGS);
    $("settingScriptUrl").value = "";
    $("settingUser").value = "";
    $("settingCache").value = "on";
    refreshHeader();
    setMsg($("settingsMsg"), "Settings reset.", "warn");
  });

  // User switch
  $("btnSwitchUser").addEventListener("click", () => {
    $("userInput").value = SETTINGS.user || "";
    setMsg($("userMsg"), "");
    openModal("userModal");
  });
  $("btnCloseUser").addEventListener("click", () => closeModal("userModal"));
  $("userBackdrop").addEventListener("click", () => closeModal("userModal"));
  $("btnSetUser").addEventListener("click", () => {
    const u = $("userInput").value.trim();
    if (!u) {
      setMsg($("userMsg"), "Enter a user name.", "warn");
      return;
    }
    SETTINGS.user = u;
    saveSettings(SETTINGS);
    refreshHeader();
    setMsg($("userMsg"), "✅ User updated.", "success");
  });

  // QR scanner buttons (IMPORTANT: NO AUTO START)
  $("btnScanQR").addEventListener("click", () => startScanner());
  $("btnStartScanner").addEventListener("click", () => startScanner());
  $("btnStopScanner").addEventListener("click", () => stopScanner(false));
  $("btnCloseScanner").addEventListener("click", () => stopScanner(true));
  $("scannerBackdrop").addEventListener("click", () => stopScanner(true));

  // Safety: close scanner when tab backgrounded
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopScanner(true).catch(()=>{});
  });

  // ESC closes any modal that’s open (scanner included)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("scannerModal").classList.contains("hidden")) stopScanner(true);
    if (!$("settingsModal").classList.contains("hidden")) closeModal("settingsModal");
    if (!$("userModal").classList.contains("hidden")) closeModal("userModal");
  });
}

/* =========================
   INIT
========================= */
(function init() {
  // Pre-fill settings with your URL (but allow user override)
  if (!SETTINGS.scriptUrl) SETTINGS.scriptUrl = DEFAULT_SCRIPT_URL;

  refreshHeader();
  bindEvents();
  showTab("capture");
  renderDashboard();
})();

