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
