// BOI CRM Frontend (GitHub Pages)

// Default Apps Script URL
const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzrHBqp6ZcS3lvRir9EchBhsldBS1jRghuQCWhj7XOY4nyuy8NRQP6mz3J1WGNYm-cD/exec";
const LS_SCRIPT_URL = "boi_crm_script_url";
const LS_USER = "boi_crm_user";

let leadType = "supplier";
let html5Qr = null;
let sessionCount = 0;

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

function openOverlay(id){ $(id).classList.add("open"); $(id).setAttribute("aria-hidden","false"); }
function closeOverlay(id){ $(id).classList.remove("open"); $(id).setAttribute("aria-hidden","true"); }

function showTab(which){
  const tabs = ["Capture","Dashboard","Leads"];
  tabs.forEach(t=>{
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

/* ---------- USER ---------- */
function ensureUser(){
  const u=(localStorage.getItem(LS_USER)||"").trim();
  if(u){ closeOverlay("userOverlay"); setUserPill(); return; }
  openOverlay("userOverlay"); setUserPill();
}

/* ---------- SETTINGS ---------- */
function openSettings(){
  $("scriptUrlInput").value = getScriptUrl();
  $("logBox").textContent = "";
  openOverlay("settingsOverlay");
}
function saveSettings(){
  const u=$("scriptUrlInput").value.trim();
  if(!u.endsWith("/exec")){ alert("Apps Script URL must end with /exec"); return; }
  localStorage.setItem(LS_SCRIPT_URL,u);
  $("logBox").textContent = `Saved:\n${u}`;
}
async function testSettings(){
  try{
    const url = new URL(getScriptUrl());
    url.searchParams.set("action","ping");
    const res = await fetch(url.toString(), { method:"GET" });
    const txt = await res.text();
    $("logBox").textContent = `Ping response:\n${txt}`;
  }catch(e){
    $("logBox").textContent = `Ping failed:\n${e.message}`;
  }
}

/* ---------- FILES ---------- */
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
    cardFile={
      name:f.name,
      mimeType:f.type||"image/jpeg",
      dataBase64: await fileToBase64(f)
    };
  }
  return {catalogFiles, cardFile};
}

/* ---------- NETWORK ---------- */
/**
 * IMPORTANT: send as application/x-www-form-urlencoded with `payload=...`
 * This matches your backend and avoids "Missing payload".
 */
async function postLead(payloadObj){
  setStatus("Saving…");
  const payloadStr = JSON.stringify(payloadObj);

  try{
    const body = new URLSearchParams();
    body.set("payload", payloadStr);

    const res = await fetch(getScriptUrl(), {
      method:"POST",
      body
    });

    const text = await res.text();
    let json;
    try{ json = JSON.parse(text); }
    catch{ throw new Error("Server did not return JSON: " + text.slice(0,160)); }

    if(json.result!=="success"){
      throw new Error(json.message || "Save failed");
    }
    setStatus("Saved ✓");
    return json;
  }catch(e){
    console.error(e);
    setStatus("Save failed");
    alert("Save failed: " + e.message);
    return null;
  }
}

async function getLeads(params={}){
  const url = new URL(getScriptUrl());
  url.searchParams.set("action","list");
  Object.entries(params).forEach(([k,v])=>{
    if(v!==undefined && v!==null && String(v).trim()!=="") url.searchParams.set(k,String(v));
  });

  const res = await fetch(url.toString(), { method:"GET" });
  const text = await res.text();
  let json;
  try{ json = JSON.parse(text); }
  catch{ throw new Error("Server did not return JSON: " + text.slice(0,160)); }
  if(json.result!=="success") throw new Error(json.message || "List failed");
  return json;
}

/* ---------- QR ---------- */
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

/* ---------- UI helpers ---------- */
function addSessionRow(type, main, country){
  const tbody=$("tbl").querySelector("tbody");
  const tr=document.createElement("tr");
  tr.innerHTML = `<td>${esc(type)}</td><td>${esc(main)}</td><td>${esc(country||"")}</td><td>${new Date().toLocaleTimeString()}</td>`;
  tbody.prepend(tr);
}
function esc(s){
  return String(s||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

/* ---------- Clear ---------- */
function clearSupplier(){
  ["supCompany","supContact","supTitle","supEmail","supPhone","supPhone2","supWebsite","supSocial",
   "supCountry","supProductType","supProducts","supExFactory","supFOB","supQR","supNotes"
  ].forEach(id=>$(id).value="");
  $("supCatalogFiles").value="";
  $("supCardFile").value="";
  $("supResult").innerHTML="";
}
function clearBuyer(){
  ["buyContact","buyCompany","buyTitle","buyEmail","buyPhone","buyPhone2","buyWebsite","buySocial",
   "buyCountry","buyMarkets","buyNeeds","buyQR","buyNotes"
  ].forEach(id=>$(id).value="");
  $("buyPL").value="";
  $("buyCatalogFiles").value="";
  $("buyCardFile").value="";
  $("buyResult").innerHTML="";
}

/* ---------- Save ---------- */
async function saveSupplier(closeAfter){
  const company=$("supCompany").value.trim();
  const products=$("supProducts").value.trim();
  if(!company || !products){ alert("Fill Company name and What do they sell."); return; }

  const uploads = await collectUploads("supCatalogFiles","supCardFile");
  const enteredBy=(localStorage.getItem(LS_USER)||"Unknown").trim() || "Unknown";

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
    country:$("supCountry").value.trim(),
    productType:$("supProductType").value.trim(),
    productsOrNeeds:products,
    exFactory:$("supExFactory").value.trim(),
    fob:$("supFOB").value.trim(),
    qrData:$("supQR").value.trim(),
    notes:$("supNotes").value.trim(),
    catalogFiles:uploads.catalogFiles,
    cardFile:uploads.cardFile
  };

  const res=await postLead(payload);
  if(!res) return;

  $("supResult").innerHTML =
    `Drive folder: <a target="_blank" rel="noopener" href="${esc(res.folderUrl)}">${esc(res.folderUrl)}</a><br>`+
    `Items sheet: <a target="_blank" rel="noopener" href="${esc(res.itemsSheetUrl)}">${esc(res.itemsSheetUrl)}</a>`;

  sessionCount++; updateSummary();
  addSessionRow("Supplier", `${company}${payload.contact? " / "+payload.contact:""}`, payload.country);

  clearSupplier();
  if(closeAfter) window.scrollTo({top:0,behavior:"smooth"});
}

async function saveBuyer(closeAfter){
  const contact=$("buyContact").value.trim();
  const needs=$("buyNeeds").value.trim();
  if(!contact || !needs){ alert("Fill Contact name and What do they want to buy."); return; }

  const uploads = await collectUploads("buyCatalogFiles","buyCardFile");
  const enteredBy=(localStorage.getItem(LS_USER)||"Unknown").trim() || "Unknown";

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
    country:$("buyCountry").value.trim(),
    markets:$("buyMarkets").value.trim(),
    privateLabel:$("buyPL").value.trim(),
    productsOrNeeds:needs,
    qrData:$("buyQR").value.trim(),
    notes:$("buyNotes").value.trim(),
    catalogFiles:uploads.catalogFiles,
    cardFile:uploads.cardFile
  };

  const res=await postLead(payload);
  if(!res) return;

  $("buyResult").innerHTML =
    `Drive folder: <a target="_blank" rel="noopener" href="${esc(res.folderUrl)}">${esc(res.folderUrl)}</a><br>`+
    `Items sheet: <a target="_blank" rel="noopener" href="${esc(res.itemsSheetUrl)}">${esc(res.itemsSheetUrl)}</a>`;

  sessionCount++; updateSummary();
  addSessionRow("Buyer", `${contact}${payload.company? " / "+payload.company:""}`, payload.country);

  clearBuyer();
  if(closeAfter) window.scrollTo({top:0,behavior:"smooth"});
}

/* ---------- Dashboard + Leads ---------- */
function setDashRow(tbody, r){
  const driveLink = r.folderUrl ? `<a target="_blank" rel="noopener" href="${esc(r.folderUrl)}">Open</a>` : "";
  const tr=document.createElement("tr");
  tr.innerHTML = `
    <td>${esc(r.timestamp||"")}</td>
    <td>${esc(r.type||"")}</td>
    <td>${esc(r.enteredBy||"")}</td>
    <td>${esc((r.company||"") || (r.contact||""))}</td>
    <td>${esc(r.country||"")}</td>
    <td>${driveLink}</td>
  `;
  tbody.appendChild(tr);
}

async function refreshDashboard(){
  try{
    setStatus("Loading dashboard…");
    const user = $("filterUser").value.trim();
    const type = $("filterType").value.trim();
    const data = await getLeads({ limit: 50, user, type });

    $("kpiTotal").textContent = data.kpis.total;
    $("kpiSup").textContent = data.kpis.suppliers;
    $("kpiBuy").textContent = data.kpis.buyers;
    $("kpiToday").textContent = data.kpis.today;

    const tbody = $("dashTable").querySelector("tbody");
    tbody.innerHTML="";
    data.rows.forEach(r=>setDashRow(tbody,r));

    $("dashNote").textContent = `Loaded ${data.rows.length} rows.`;
    setStatus("Ready");
  }catch(e){
    console.error(e);
    setStatus("Dashboard failed");
    $("dashNote").textContent = e.message;
  }
}

async function refreshLeads(){
  try{
    setStatus("Loading leads…");
    const q = $("searchLeads").value.trim();
    const data = await getLeads({ limit: 200, q });

    const tbody = $("leadsTable").querySelector("tbody");
    tbody.innerHTML="";

    data.rows.forEach(r=>{
      const driveLink = r.folderUrl ? `<a target="_blank" rel="noopener" href="${esc(r.folderUrl)}">Open</a>` : "";
      const tr=document.createElement("tr");
      tr.innerHTML = `
        <td>${esc(r.timestamp||"")}</td>
        <td>${esc(r.type||"")}</td>
        <td>${esc(r.enteredBy||"")}</td>
        <td>${esc(r.company||"")}</td>
        <td>${esc(r.contact||"")}</td>
        <td>${esc(r.email||"")}</td>
        <td>${esc(r.phone||"")}</td>
        <td>${esc(r.country||"")}</td>
        <td>${driveLink}</td>
      `;
      tbody.appendChild(tr);
    });

    setStatus("Ready");
  }catch(e){
    console.error(e);
    setStatus("Leads failed");
    alert("Leads load failed: " + e.message);
  }
}

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", ()=>{
  // tabs
  $("tabCapture").addEventListener("click", ()=>showTab("Capture"));
  $("tabDashboard").addEventListener("click", ()=>showTab("Dashboard"));
  $("tabLeads").addEventListener("click", ()=>showTab("Leads"));

  // dashboard buttons
  $("btnRefreshDash").addEventListener("click", refreshDashboard);
  $("btnRefreshLeads").addEventListener("click", refreshLeads);
  $("searchLeads").addEventListener("input", ()=>{ /* optional live */ });

  // lead type
  showSupplier();
  $("btnSupplier").addEventListener("click", showSupplier);
  $("btnBuyer").addEventListener("click", showBuyer);

  // QR
  $("btnScan").addEventListener("click", openQr);
  $("btnCloseQr").addEventListener("click", closeQr);
  $("qrOverlay").addEventListener("click",(e)=>{ if(e.target.id==="qrOverlay") closeQr(); });

  // settings
  $("btnSettings").addEventListener("click", openSettings);
  $("btnCloseSettings").addEventListener("click", ()=>closeOverlay("settingsOverlay"));
  $("btnSaveSettings").addEventListener("click", saveSettings);
  $("btnTestSettings").addEventListener("click", testSettings);
  $("settingsOverlay").addEventListener("click",(e)=>{ if(e.target.id==="settingsOverlay") closeOverlay("settingsOverlay"); });

  // user
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

  // save buttons
  $("saveSupplierNew").addEventListener("click", ()=>saveSupplier(false));
  $("saveSupplierClose").addEventListener("click", ()=>saveSupplier(true));
  $("clearSupplier").addEventListener("click", clearSupplier);

  $("saveBuyerNew").addEventListener("click", ()=>saveBuyer(false));
  $("saveBuyerClose").addEventListener("click", ()=>saveBuyer(true));
  $("clearBuyer").addEventListener("click", clearBuyer);

  setStatus("Ready");
  updateSummary();

  // esc closes modals
  window.addEventListener("keydown",(e)=>{
    if(e.key==="Escape"){
      closeQr();
      closeOverlay("settingsOverlay");
    }
  });
});
