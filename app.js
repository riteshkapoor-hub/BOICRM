// BOI CRM — app.js (FIXED follow-up queue + order-safe)

const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzrHBqp6ZcS3lvRir9EchBhsldBS1jRghuQCWhj7XOY4nyuy8NRQP6mz3J1WGNYm-cD/exec";
const LS_SCRIPT_URL = "boi_crm_script_url";
const LS_USER = "boi_crm_user";

let leadType = "supplier";
let html5Qr = null;
let sessionCount = 0;

let GLOBAL_LISTS = { productTypes: [], markets: [] };

// queued follow-ups before save (optional)
let queuedSupplierFU = null;
let queuedBuyerFU = null;

// last saved leadId (still used if you want to add another follow-up after save)
let lastSupplierLeadId = "";
let lastBuyerLeadId = "";

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

function getScriptUrl(){ return (localStorage.getItem(LS_SCRIPT_URL) || DEFAULT_SCRIPT_URL).trim(); }
function setStatus(msg){ $("status").textContent = msg || ""; }
function updateSummary(){ $("summary").textContent = `${sessionCount} leads this session`; }

function setUserPill(){
  const u = (localStorage.getItem(LS_USER)||"").trim();
  $("userPill").textContent = `User: ${u || "—"}`;
}
function openOverlay(id){ $(id).classList.add("open"); $(id).setAttribute("aria-hidden","false"); }
function closeOverlay(id){ $(id).classList.remove("open"); $(id).setAttribute("aria-hidden","true"); }
function ensureUser(){
  const u=(localStorage.getItem(LS_USER)||"").trim();
  if(u){ closeOverlay("userOverlay"); setUserPill(); return; }
  openOverlay("userOverlay"); setUserPill();
}

function showTab(which){
  ["Capture","Dashboard","Leads"].forEach(t=>{
    $(`tab${t}`).classList.toggle("isActive", t===which);
    $(`view${t}`).style.display = (t===which) ? "" : "none";
  });
  if(which==="Dashboard") refreshDashboard();
  if(which==="Leads") refreshLeads();
}

function showSupplier(){
  leadType="supplier";
  $("btnSupplier").classList.add("isActive");
  $("btnBuyer").classList.remove("isActive");
  $("cardSupplier").style.display="";
  $("cardBuyer").style.display="none";
}
function showBuyer(){
  leadType="buyer";
  $("btnBuyer").classList.add("isActive");
  $("btnSupplier").classList.remove("isActive");
  $("cardBuyer").style.display="";
  $("cardSupplier").style.display="none";
}

function esc(s){
  return String(s||"")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function istNowLabel(){
  try{
    return new Intl.DateTimeFormat("en-US", {
      timeZone:"Asia/Kolkata",
      month:"2-digit",day:"2-digit",year:"2-digit",
      hour:"numeric",minute:"2-digit",hour12:true
    }).format(new Date());
  }catch{
    return new Date().toLocaleString();
  }
}

function addSessionRow(type, main, country){
  const tbody=$("tbl").querySelector("tbody");
  const tr=document.createElement("tr");
  tr.innerHTML = `<td>${esc(type)}</td><td>${esc(main)}</td><td>${esc(country||"")}</td><td>${esc(istNowLabel())}</td>`;
  tbody.prepend(tr);
}

async function postPayload(obj){
  setStatus("Saving…");
  const body = new URLSearchParams();
  body.set("payload", JSON.stringify(obj));

  const res = await fetch(getScriptUrl(), { method:"POST", body });
  const text = await res.text();
  let json;
  try{ json = JSON.parse(text); }
  catch{ throw new Error("Server did not return JSON: " + text.slice(0,160)); }
  if(json.result !== "success") throw new Error(json.message || "Request failed");
  setStatus("Saved ✓");
  return json;
}

async function getJson(url){
  const res = await fetch(url, { method:"GET" });
  const text = await res.text();
  let json;
  try{ json = JSON.parse(text); }
  catch{ throw new Error("Server did not return JSON: " + text.slice(0,160)); }
  if(json.result !== "success") throw new Error(json.message || "Request failed");
  return json;
}

async function loadGlobalLists(){
  const url = new URL(getScriptUrl());
  url.searchParams.set("action","lists");
  const data = await getJson(url.toString());
  GLOBAL_LISTS = data.lists || { productTypes: [], markets: [] };
}

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

// QR (unchanged)
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
  if(leadType==="supplier"){
    if(p.company && !$("supCompany").value) $("supCompany").value=p.company;
    if(p.fullName && !$("supContact").value) $("supContact").value=p.fullName;
    if(p.email && !$("supEmail").value) $("supEmail").value=p.email;
    if(p.phone && !$("supPhone").value) $("supPhone").value=p.phone;
    $("supQR").value=raw;
  }else{
    if(p.fullName && !$("buyContact").value) $("buyContact").value=p.fullName;
    if(p.company && !$("buyCompany").value) $("buyCompany").value=p.company;
    if(p.email && !$("buyEmail").value) $("buyEmail").value=p.email;
    if(p.phone && !$("buyPhone").value) $("buyPhone").value=p.phone;
    $("buyQR").value=raw;
  }
}
function openQr(){
  openOverlay("qrOverlay");
  if(!window.Html5Qrcode){ alert("QR library not loaded"); closeQr(); return; }
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

// Combo box component (unchanged from your last working version)
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

  function open(){ root.classList.add("open"); render(input.value); }
  function close(){ root.classList.remove("open"); }
  function set(v){
    value = v || "";
    input.value = v || "";
    close();
    root.dispatchEvent(new CustomEvent("combo:change", { detail: { value } }));
  }
  function render(filter){
    list.innerHTML = "";
    const f = (filter||"").trim().toLowerCase();
    let filtered = options.slice();
    if(f) filtered = options.filter(x=> String(x).toLowerCase().includes(f));

    filtered.slice(0, 200).forEach(opt=>{
      const it=document.createElement("div");
      it.className="combo__item";
      it.textContent = opt;
      it.addEventListener("click", ()=> set(opt));
      list.appendChild(it);
    });

    if(!filtered.length){
      const it=document.createElement("div");
      it.className="combo__item";
      it.textContent = "No matches";
      it.style.opacity = "0.7";
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
    get value(){ return value; },
    setValue(v){ set(v); },
    setOptions(newOpts){
      options = Array.from(new Set(newOpts.map(String).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
      render(input.value);
    },
    inputEl: input
  };
}

// phone formatting
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
  const root = countryCombo.inputEl.parentElement;

  function fix(){
    const c = countryCombo.value;
    if(c){
      if(p1.value.trim()) p1.value = formatPhoneWithCountry(c, p1.value);
      if(p2.value.trim()) p2.value = formatPhoneWithCountry(c, p2.value);
    }
  }
  p1.addEventListener("blur", fix);
  p2.addEventListener("blur", fix);
  root.addEventListener("combo:change", fix);
}

// Global list add
async function addGlobalListItem(listType, value){
  const createdBy = (localStorage.getItem(LS_USER)||"Unknown").trim() || "Unknown";
  await postPayload({ action:"addListItem", listType, value, createdBy });
  await loadGlobalLists();
  refreshAllCombos();
}

// Follow-up queue BEFORE save
function formatISTFromInputs(dateVal, timeVal){
  if(!dateVal || !timeVal) return "";
  const [y,m,d] = dateVal.split("-").map(n=>parseInt(n,10));
  const [hh,mm] = timeVal.split(":").map(n=>parseInt(n,10));
  const dt = new Date(y, m-1, d, hh, mm, 0);

  try{
    // produces "12/28/25, 7:54 AM" -> remove comma
    return new Intl.DateTimeFormat("en-US", {
      timeZone:"Asia/Kolkata",
      month:"2-digit",day:"2-digit",year:"2-digit",
      hour:"numeric",minute:"2-digit",hour12:true
    }).format(dt).replace(",", "");
  }catch{
    return dt.toLocaleString();
  }
}

function queueFollowUp(kind){
  const dateId = (kind==="supplier") ? "supFUDate" : "buyFUDate";
  const timeId = (kind==="supplier") ? "supFUTime" : "buyFUTime";
  const notesId = (kind==="supplier") ? "supFUNotes" : "buyFUNotes";
  const outId = (kind==="supplier") ? "supFULast" : "buyFULast";

  const d = $(dateId).value;
  const t = $(timeId).value;
  const notes = $(notesId).value.trim();

  if(!d || !t){
    // follow-up optional; if empty, clear queued
    if(kind==="supplier") queuedSupplierFU = null; else queuedBuyerFU = null;
    $(outId).textContent = "";
    return;
  }

  const scheduledAtIST = formatISTFromInputs(d, t);
  const fu = { scheduledAtIST, notes };

  if(kind==="supplier") queuedSupplierFU = fu; else queuedBuyerFU = fu;
  $(outId).textContent = `Will schedule after save: ${scheduledAtIST}`;
}

function clearQueuedFollowUp(kind){
  if(kind==="supplier"){
    queuedSupplierFU = null;
    $("supFUDate").value="";
    $("supFUTime").value="";
    $("supFUNotes").value="";
    $("supFULast").textContent="";
  }else{
    queuedBuyerFU = null;
    $("buyFUDate").value="";
    $("buyFUTime").value="";
    $("buyFUNotes").value="";
    $("buyFULast").textContent="";
  }
}

// clear
function clearSupplier(){
  ["supCompany","supContact","supTitle","supEmail","supPhone","supPhone2","supWebsite","supSocial",
   "supExFactory","supFOB","supProducts","supQR","supNotes"
  ].forEach(id=>$(id).value="");
  $("supPL").value="";
  $("supCatalogFiles").value="";
  $("supCardFile").value="";
  $("supResult").innerHTML="";
  supCountry.setValue(""); supMarkets.setValue(""); supProductType.setValue("");
  clearQueuedFollowUp("supplier");
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
  clearQueuedFollowUp("buyer");
}

// combos
let supCountry, buyCountry, supMarkets, buyMarkets, supProductType, buyProductType;
let dashCountry, dashMarket, dashPT;
let leadsCountry, leadsMarket, leadsPT;

function refreshAllCombos(){
  const productTypes = GLOBAL_LISTS.productTypes || [];
  const markets = GLOBAL_LISTS.markets || [];
  supProductType.setOptions(productTypes);
  buyProductType.setOptions(productTypes);
  supMarkets.setOptions(markets);
  buyMarkets.setOptions(markets);
  dashPT.setOptions(productTypes);
  leadsPT.setOptions(productTypes);
  dashMarket.setOptions(markets);
  leadsMarket.setOptions(markets);
}

function attachAddButtons(){
  function addPlus(rootEl, label, onClick){
    const wrap = document.createElement("div");
    wrap.className = "combo__add";
    const b = document.createElement("button");
    b.type="button";
    b.className="btn btn--ghost btn--sm";
    b.textContent = label;
    b.addEventListener("click", onClick);
    wrap.appendChild(b);
    rootEl.appendChild(wrap);
  }
  addPlus(supMarkets.inputEl.parentElement, "+ Add Market", async ()=>{
    const v = prompt("Add new Market/Notes value:");
    if(!v) return;
    await addGlobalListItem("market", v.trim());
  });
  addPlus(buyMarkets.inputEl.parentElement, "+ Add Market", async ()=>{
    const v = prompt("Add new Market/Notes value:");
    if(!v) return;
    await addGlobalListItem("market", v.trim());
  });
  addPlus(supProductType.inputEl.parentElement, "+ Add Product Type", async ()=>{
    const v = prompt("Add new Product Type:");
    if(!v) return;
    await addGlobalListItem("productType", v.trim());
  });
  addPlus(buyProductType.inputEl.parentElement, "+ Add Product Type", async ()=>{
    const v = prompt("Add new Product Type:");
    if(!v) return;
    await addGlobalListItem("productType", v.trim());
  });
}

// save
async function saveSupplier(closeAfter){
  const company=$("supCompany").value.trim();
  const products=$("supProducts").value.trim();
  if(!company || !products){ alert("Fill Company and What do they sell."); return; }

  if(supCountry.value){
    if($("supPhone").value.trim()) $("supPhone").value = formatPhoneWithCountry(supCountry.value, $("supPhone").value);
    if($("supPhone2").value.trim()) $("supPhone2").value = formatPhoneWithCountry(supCountry.value, $("supPhone2").value);
  }

  const uploads = await collectUploads("supCatalogFiles","supCardFile");
  const enteredBy=(localStorage.getItem(LS_USER)||"Unknown").trim() || "Unknown";

  // queue follow-up if filled
  queueFollowUp("supplier");

  const payload={
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
    pendingFollowUp: queuedSupplierFU // ✅ send with lead
  };

  const res = await postPayload(payload);

  $("supResult").innerHTML =
    `Lead ID: <b>${esc(res.leadId)}</b><br>` +
    `Drive folder: <a target="_blank" rel="noopener" href="${esc(res.folderUrl)}">Open folder</a><br>` +
    `Items sheet: <a target="_blank" rel="noopener" href="${esc(res.itemsSheetUrl)}">Open items</a>`;

  lastSupplierLeadId = res.leadId;

  sessionCount++; updateSummary();
  addSessionRow("Supplier", `${company}${payload.contact? " / "+payload.contact:""}`, payload.country);

  await loadGlobalLists();
  refreshAllCombos();

  // Clear AFTER save; queued FU already attached
  clearSupplier();
  if(closeAfter) window.scrollTo({top:0,behavior:"smooth"});
}

async function saveBuyer(closeAfter){
  const contact=$("buyContact").value.trim();
  const needs=$("buyNeeds").value.trim();
  if(!contact || !needs){ alert("Fill Contact and What do they want to buy."); return; }

  if(buyCountry.value){
    if($("buyPhone").value.trim()) $("buyPhone").value = formatPhoneWithCountry(buyCountry.value, $("buyPhone").value);
    if($("buyPhone2").value.trim()) $("buyPhone2").value = formatPhoneWithCountry(buyCountry.value, $("buyPhone2").value);
  }

  const uploads = await collectUploads("buyCatalogFiles","buyCardFile");
  const enteredBy=(localStorage.getItem(LS_USER)||"Unknown").trim() || "Unknown";

  queueFollowUp("buyer");

  const payload={
    type:"buyer",
    enteredBy,
    contact,
    company:$("buyCompany").value.trim(),
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

  lastBuyerLeadId = res.leadId;

  sessionCount++; updateSummary();
  addSessionRow("Buyer", `${contact}${payload.company? " / "+payload.company:""}`, payload.country);

  await loadGlobalLists();
  refreshAllCombos();

  clearBuyer();
  if(closeAfter) window.scrollTo({top:0,behavior:"smooth"});
}

// dashboard/leads functions remain as you had; no changes required for this fix.
// If your dashboard currently works, keep those functions from your working file.
// If you want, I can paste full dashboard functions again after you confirm.

document.addEventListener("DOMContentLoaded", async ()=>{
  $("tabCapture").addEventListener("click", ()=>showTab("Capture"));
  $("tabDashboard").addEventListener("click", ()=>showTab("Dashboard"));
  $("tabLeads").addEventListener("click", ()=>showTab("Leads"));

  showSupplier();
  $("btnSupplier").addEventListener("click", showSupplier);
  $("btnBuyer").addEventListener("click", showBuyer);

  $("btnScan").addEventListener("click", openQr);
  $("btnCloseQr").addEventListener("click", closeQr);
  $("qrOverlay").addEventListener("click",(e)=>{ if(e.target.id==="qrOverlay") closeQr(); });

  $("btnSettings").addEventListener("click", ()=>openOverlay("settingsOverlay"));
  $("btnCloseSettings").addEventListener("click", ()=>closeOverlay("settingsOverlay"));

  setUserPill();
  ensureUser();

  $("btnStartSession").addEventListener("click", ()=>{
    const name=$("usernameInput").value.trim();
    if(!name){ alert("Enter username"); return; }
    localStorage.setItem(LS_USER,name);
    setUserPill();
    closeOverlay("userOverlay");
  });

  $("btnSwitchUser").addEventListener("click", ()=>{
    localStorage.removeItem(LS_USER);
    $("usernameInput").value="";
    ensureUser();
  });

  // combos
  supCountry = createCombo("supCountryCombo", COUNTRIES, "Search country…");
  buyCountry = createCombo("buyCountryCombo", COUNTRIES, "Search country…");
  supMarkets = createCombo("supMarketsCombo", [], "Search market…");
  buyMarkets = createCombo("buyMarketsCombo", [], "Search market…");
  supProductType = createCombo("supProductTypeCombo", [], "Search product type…");
  buyProductType = createCombo("buyProductTypeCombo", [], "Search product type…");

  // phone auto-fix
  wirePhoneAutoFix(supCountry, "supPhone", "supPhone2");
  wirePhoneAutoFix(buyCountry, "buyPhone", "buyPhone2");

  // queue follow-up on input changes (so it displays “Will schedule after save…”)
  ["supFUDate","supFUTime","supFUNotes"].forEach(id=> $(id).addEventListener("input", ()=>queueFollowUp("supplier")));
  ["buyFUDate","buyFUTime","buyFUNotes"].forEach(id=> $(id).addEventListener("input", ()=>queueFollowUp("buyer")));

  try{
    await loadGlobalLists();
  }catch(e){
    console.warn("Lists load failed, using fallback", e);
    GLOBAL_LISTS = { productTypes:["Chips","Dehydrated powders","Sweeteners"], markets:["USA","UAE","GCC","EU","India"] };
  }
  refreshAllCombos();
  attachAddButtons();

  // save buttons
  $("saveSupplierNew").addEventListener("click", ()=>saveSupplier(false));
  $("saveSupplierClose").addEventListener("click", ()=>saveSupplier(true));
  $("clearSupplier").addEventListener("click", clearSupplier);

  $("saveBuyerNew").addEventListener("click", ()=>saveBuyer(false));
  $("saveBuyerClose").addEventListener("click", ()=>saveBuyer(true));
  $("clearBuyer").addEventListener("click", clearBuyer);

  setStatus("Ready");
  updateSummary();
});
