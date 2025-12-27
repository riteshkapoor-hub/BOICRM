const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzrHBqp6ZcS3lvRir9EchBhsldBS1jRghuQCWhj7XOY4nyuy8NRQP6mz3J1WGNYm-cD/exec";
const LS_SCRIPT_URL_KEY = "boi_crm_script_url";

let entries = [];
let mode = null; // 'supplier' | 'buyer'
let html5QrCode = null;

function $(id){ return document.getElementById(id); }
function getScriptUrl(){ return localStorage.getItem(LS_SCRIPT_URL_KEY) || DEFAULT_SCRIPT_URL; }

function setStatus(msg, cls=""){
  const el = $("status");
  el.className = "micro " + (cls || "");
  el.textContent = msg || "";
}
function updateSummary(){ $("summary").textContent = `${entries.length} leads this session`; }

function log(msg){
  const box = $("logBox");
  if (!box) return;
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  box.textContent = (box.textContent ? box.textContent + "\n" : "") + line;
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(s){
  return String(s || "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

/* ---------- VIEWS ---------- */
function setActiveTab(tabId){
  ["tabLeads","tabSupplier","tabBuyer","tabSettings"].forEach(id => $(id).classList.toggle("is-active", id === tabId));
  $("viewLeads").classList.toggle("d-none", tabId !== "tabLeads");
  $("viewSupplier").classList.toggle("d-none", tabId !== "tabSupplier");
  $("viewBuyer").classList.toggle("d-none", tabId !== "tabBuyer");
  $("viewSettings").classList.toggle("d-none", tabId !== "tabSettings");
}

function setMode(newMode){
  mode = newMode;
  $("btnSupplier").classList.toggle("btn-light", mode === "supplier");
  $("btnBuyer").classList.toggle("btn-light", mode === "buyer");
  if (mode === "supplier") setActiveTab("tabSupplier");
  if (mode === "buyer") setActiveTab("tabBuyer");
}

/* ---------- SESSION TABLE ---------- */
function addSessionEntry(payload, result){
  entries.push({ payload, result });
  updateSummary();

  const tbody = $("tbl").querySelector("tbody");
  const tr = document.createElement("tr");

  const driveLink = result?.folderUrl
    ? `<a href="${escapeHtml(result.folderUrl)}" target="_blank" rel="noopener" style="color:#93c5fd;">Open</a>`
    : `<span style="color:#fca5a5;">—</span>`;

  tr.innerHTML = `
    <td>${escapeHtml(payload.type)}</td>
    <td>${escapeHtml(payload.contact || "")}<br/><small class="text-secondary">${escapeHtml(payload.company || "")}</small></td>
    <td>${escapeHtml(payload.country || "")}</td>
    <td>${driveLink}</td>
  `;
  tbody.prepend(tr);
}

/* ---------- FILES ---------- */
function fileToBase64(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result || "");
      const base64 = res.includes("base64,") ? res.split("base64,")[1] : "";
      resolve(base64);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function collectFilesPayload(catalogInputId, cardInputId){
  const catalogInput = $(catalogInputId);
  const cardInput = $(cardInputId);

  const catalogFiles = [];
  if (catalogInput?.files?.length){
    for (const f of catalogInput.files){
      const dataBase64 = await fileToBase64(f);
      catalogFiles.push({ name: f.name, mimeType: f.type || "application/octet-stream", dataBase64 });
    }
  }

  let cardFile = null;
  if (cardInput?.files?.length){
    const f = cardInput.files[0];
    const dataBase64 = await fileToBase64(f);
    cardFile = { name: f.name, mimeType: f.type || "image/jpeg", dataBase64 };
  }

  return { catalogFiles, cardFile };
}

/* ---------- QR ---------- */
function openQr(){
  if (!mode){
    alert("Select Supplier or Buyer first. Scan is optional, but lead type is required.");
    return;
  }
  $("qrScannerOverlay").classList.add("is-open");
  $("qrScannerOverlay").setAttribute("aria-hidden","false");

  if (!window.Html5Qrcode){
    alert("QR library didn't load.");
    closeQr();
    return;
  }
  if (!html5QrCode) html5QrCode = new Html5Qrcode("qr-reader");

  html5QrCode.start(
    { facingMode:"environment" },
    { fps:10, qrbox:250 },
    (decodedText) => { applyScan(decodedText); closeQr(); },
    () => {}
  ).catch((err)=>{
    console.error(err);
    alert("Could not start camera. Allow camera permissions.");
    closeQr();
  });
}

function closeQr(){
  $("qrScannerOverlay").classList.remove("is-open");
  $("qrScannerOverlay").setAttribute("aria-hidden","true");
  if (html5QrCode){
    try { html5QrCode.stop().catch(()=>{}); } catch {}
  }
}

function parseVCard(text){
  const out = { fullName:"", company:"", email:"", phone:"", website:"" };
  const t = String(text || "").trim();
  if (!t.includes("BEGIN:VCARD")) return out;
  const lines = t.split(/\r?\n/);
  for (const l of lines){
    if (l.startsWith("FN:")) out.fullName = l.substring(3).trim();
    if (l.startsWith("ORG:")) out.company = l.substring(4).trim();
    if (l.startsWith("EMAIL")) out.email = (l.split(":")[1] || "").trim();
    if (l.startsWith("TEL") && !out.phone) out.phone = (l.split(":")[1] || "").trim();
    if (l.startsWith("URL")) out.website = (l.split(":")[1] || "").trim();
  }
  return out;
}

function applyScan(rawText){
  const p = parseVCard(rawText);
  if (mode === "supplier"){
    if (p.company && !$("supCompany").value) $("supCompany").value = p.company;
    if (p.fullName && !$("supContact").value) $("supContact").value = p.fullName;
    if (p.email && !$("supEmail").value) $("supEmail").value = p.email;
    if (p.phone && !$("supPhone").value) $("supPhone").value = p.phone;
    $("supQR").value = rawText;
  } else {
    if (p.fullName && !$("buyContact").value) $("buyContact").value = p.fullName;
    if (p.company && !$("buyCompany").value) $("buyCompany").value = p.company;
    if (p.email && !$("buyEmail").value) $("buyEmail").value = p.email;
    if (p.phone && !$("buyPhone").value) $("buyPhone").value = p.phone;
    $("buyQR").value = rawText;
  }
}

/* ---------- POST (NO PREFLIGHT) ---------- */
async function postEntry(payload){
  const url = getScriptUrl();
  setStatus("Saving...", "text-info");
  log(`POST → ${url}`);

  try{
    // IMPORTANT: This avoids CORS preflight
    const form = new URLSearchParams();
    form.set("payload", JSON.stringify(payload));

    const res = await fetch(url, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: form.toString()
    });

    const json = await res.json().catch(()=>null);
    log(`Response: ${JSON.stringify(json)}`);

    if (!json || json.result !== "success"){
      throw new Error(json?.message || "No success response");
    }

    setStatus("Saved.", "text-success");
    return json;

  } catch(e){
    console.error(e);
    setStatus(`Save failed: ${e.message}`, "text-danger");
    log(`ERROR: ${e.message}`);
    return null;
  }
}

/* ---------- SAVE FLOWS ---------- */
async function saveSupplier(closeAfter){
  const company = $("supCompany").value.trim();
  const list = $("supProducts").value.trim();
  if (!company || !list){
    alert("Please fill Company name and What they sell.");
    return;
  }

  setStatus("Preparing files...", "text-info");
  const files = await collectFilesPayload("supCatalogFiles","supCardFile");

  const payload = {
    type:"supplier",
    company,
    contact:$("supContact").value.trim(),
    email:$("supEmail").value.trim(),
    phone:$("supPhone").value.trim(),
    country:$("supCountry").value.trim(),
    productType:$("supProductType").value.trim(),
    productsOrNeeds:list,
    exFactory:$("supExFactory").value.trim(),
    fob:$("supFOB").value.trim(),
    qrData:$("supQR").value.trim(),
    notes:$("supNotes").value.trim(),
    catalogFiles:files.catalogFiles,
    cardFile:files.cardFile,
    timestamp:Date.now()
  };

  const result = await postEntry(payload);
  if (!result) return;

  $("supResult").innerHTML =
    `Drive folder: <a href="${escapeHtml(result.folderUrl)}" target="_blank" rel="noopener">${escapeHtml(result.folderUrl)}</a><br/>
     Items sheet: <a href="${escapeHtml(result.itemsSheetUrl)}" target="_blank" rel="noopener">${escapeHtml(result.itemsSheetUrl)}</a>`;

  addSessionEntry(payload, result);
  clearSupplier();
  if (closeAfter) setActiveTab("tabLeads");
}

async function saveBuyer(closeAfter){
  const contact = $("buyContact").value.trim();
  const list = $("buyNeeds").value.trim();
  if (!contact || !list){
    alert("Please fill Contact name and What they want to buy.");
    return;
  }

  setStatus("Preparing files...", "text-info");
  const files = await collectFilesPayload("buyCatalogFiles","buyCardFile");

  const payload = {
    type:"buyer",
    company:$("buyCompany").value.trim(),
    contact,
    email:$("buyEmail").value.trim(),
    phone:$("buyPhone").value.trim(),
    country:$("buyCountry").value.trim(),
    productsOrNeeds:list,
    privateLabel:$("buyPL").value.trim(),
    markets:$("buyMarkets").value.trim(),
    qrData:$("buyQR").value.trim(),
    notes:$("buyNotes").value.trim(),
    catalogFiles:files.catalogFiles,
    cardFile:files.cardFile,
    timestamp:Date.now()
  };

  const result = await postEntry(payload);
  if (!result) return;

  $("buyResult").innerHTML =
    `Drive folder: <a href="${escapeHtml(result.folderUrl)}" target="_blank" rel="noopener">${escapeHtml(result.folderUrl)}</a><br/>
     Items sheet: <a href="${escapeHtml(result.itemsSheetUrl)}" target="_blank" rel="noopener">${escapeHtml(result.itemsSheetUrl)}</a>`;

  addSessionEntry(payload, result);
  clearBuyer();
  if (closeAfter) setActiveTab("tabLeads");
}

function clearSupplier(){
  ["supCompany","supContact","supEmail","supPhone","supCountry","supProductType","supProducts","supExFactory","supFOB","supQR","supNotes"].forEach(id => $(id).value="");
  $("supCatalogFiles").value="";
  $("supCardFile").value="";
  $("supResult").textContent="";
}
function clearBuyer(){
  ["buyContact","buyCompany","buyEmail","buyPhone","buyCountry","buyNeeds","buyPL","buyMarkets","buyQR","buyNotes"].forEach(id => $(id).value="");
  $("buyCatalogFiles").value="";
  $("buyCardFile").value="";
  $("buyResult").textContent="";
}

/* ---------- SETTINGS ---------- */
function loadSettingsUI(){ $("scriptUrlInput").value = getScriptUrl(); }
function saveSettings(){
  const v = $("scriptUrlInput").value.trim();
  if (!v || !v.endsWith("/exec")){
    alert("Paste a valid Apps Script URL ending with /exec");
    return;
  }
  localStorage.setItem(LS_SCRIPT_URL_KEY, v);
  log("Saved Script URL: " + v);
  setStatus("Settings saved.", "text-success");
}

async function testConnection(){
  loadSettingsUI();
  setStatus("Testing...", "text-info");
  const payload = { type:"buyer", contact:"Ping", productsOrNeeds:"Test", timestamp:Date.now() };
  const res = await postEntry(payload);
  if (res?.result === "success"){
    setStatus("Connection OK.", "text-success");
  } else {
    setStatus("Connection failed. Check Apps Script deploy settings.", "text-danger");
  }
}
function clearLogs(){ $("logBox").textContent=""; }

/* ---------- INIT ---------- */
function bind(id, evt, fn){
  const el = $(id);
  if (!el) return;
  el.addEventListener(ev
