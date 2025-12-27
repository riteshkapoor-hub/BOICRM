// ---------------- SETTINGS ----------------
const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzrHBqp6ZcS3lvRir9EchBhsldBS1jRghuQCWhj7XOY4nyuy8NRQP6mz3J1WGNYm-cD/exec";
const LS_SCRIPT_URL_KEY = "boi_crm_script_url";

let entries = [];
let mode = null; // 'supplier' | 'buyer'
let html5QrCode = null;

function $(id){ return document.getElementById(id); }

function getScriptUrl(){
  return localStorage.getItem(LS_SCRIPT_URL_KEY) || DEFAULT_SCRIPT_URL;
}

function log(msg){
  const box = $("logBox");
  if (!box) return;
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  box.textContent = (box.textContent ? box.textContent + "\n" : "") + line;
  box.scrollTop = box.scrollHeight;
}

function setStatus(msg, cls=""){
  const el = $("status");
  el.className = "micro " + (cls || "");
  el.textContent = msg || "";
}

function updateSummary(){
  $("summary").textContent = `${entries.length} leads this session`;
}

function escapeHtml(s){
  return String(s || "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

// ---------------- NAV / VIEWS ----------------
function setActiveTab(tabId){
  ["tabLeads","tabSupplier","tabBuyer","tabSettings"].forEach(id => {
    $(id).classList.toggle("is-active", id === tabId);
  });

  $("viewLeads").classList.toggle("d-none", tabId !== "tabLeads");
  $("viewSupplier").classList.toggle("d-none", tabId !== "tabSupplier");
  $("viewBuyer").classList.toggle("d-none", tabId !== "tabBuyer");
  $("viewSettings").classList.toggle("d-none", tabId !== "tabSettings");
}

function setMode(newMode){
  mode = newMode;
  $("btnSupplier").className = "btn btn-sm " + (mode === "supplier" ? "btn-primary" : "btn-outline-primary");
  $("btnBuyer").className = "btn btn-sm " + (mode === "buyer" ? "btn-primary" : "btn-outline-primary");

  if (mode === "supplier"){
    setActiveTab("tabSupplier");
  } else if (mode === "buyer"){
    setActiveTab("tabBuyer");
  }
}

// ---------------- SESSION TABLE ----------------
function addSessionEntry(e, serverResult){
  entries.push({ ...e, serverResult });
  updateSummary();

  const tbody = $("tbl").querySelector("tbody");
  const tr = document.createElement("tr");

  const driveLink = serverResult?.folderUrl
    ? `<a href="${escapeHtml(serverResult.folderUrl)}" target="_blank" rel="noopener">Open</a>`
    : `<span class="text-danger">—</span>`;

  tr.innerHTML = `
    <td><span class="badge ${e.type === "supplier" ? "text-bg-success" : "text-bg-primary"}">${escapeHtml(e.type)}</span></td>
    <td>${escapeHtml(e.contact || "(no contact)")}<br/><small class="text-muted">${escapeHtml(e.company || "")}</small></td>
    <td>${escapeHtml(e.country || "")}</td>
    <td>${driveLink}</td>
  `;
  tbody.prepend(tr);
}

// ---------------- FILES ----------------
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

// ---------------- QR (OPTIONAL) ----------------
function openQr(){
  if (!mode){
    alert("Select Supplier or Buyer first. Scan is optional, but we need the lead type to auto-fill correctly.");
    return;
  }

  const overlay = $("qrScannerOverlay");
  overlay.classList.add("is-open");
  overlay.setAttribute("aria-hidden", "false");

  if (!window.Html5Qrcode){
    alert("QR library didn't load. Check internet connection.");
    closeQr();
    return;
  }

  if (!html5QrCode) html5QrCode = new Html5Qrcode("qr-reader");

  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 250 },
    (decodedText) => { applyScan(decodedText); closeQr(); },
    () => {}
  ).catch((err) => {
    console.error(err);
    alert("Could not start camera. Allow camera permission in browser settings.");
    closeQr();
  });
}

function closeQr(){
  const overlay = $("qrScannerOverlay");
  overlay.classList.remove("is-open");
  overlay.setAttribute("aria-hidden", "true");

  if (html5QrCode){
    try {
      const p = html5QrCode.stop();
      if (p?.catch) p.catch(() => {});
    } catch {}
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
    if (l.startsWith("EMAIL")){
      const parts = l.split(":"); out.email = (parts[1] || "").trim();
    }
    if (l.startsWith("TEL") && !out.phone){
      const parts = l.split(":"); out.phone = (parts[1] || "").trim();
    }
    if (l.startsWith("URL")){
      const parts = l.split(":"); out.website = (parts[1] || "").trim();
    }
  }
  return out;
}

function applyScan(rawText){
  const parsed = parseVCard(rawText);

  if (mode === "supplier"){
    if (parsed.company && !$("supCompany").value) $("supCompany").value = parsed.company;
    if (parsed.fullName && !$("supContact").value) $("supContact").value = parsed.fullName;
    if (parsed.email && !$("supEmail").value) $("supEmail").value = parsed.email;
    if (parsed.phone && !$("supPhone").value) $("supPhone").value = parsed.phone;
    $("supQR").value = rawText;
    if (parsed.website && !$("supNotes").value) $("supNotes").value = "Website: " + parsed.website;
  } else {
    if (parsed.fullName && !$("buyContact").value) $("buyContact").value = parsed.fullName;
    if (parsed.company && !$("buyCompany").value) $("buyCompany").value = parsed.company;
    if (parsed.email && !$("buyEmail").value) $("buyEmail").value = parsed.email;
    if (parsed.phone && !$("buyPhone").value) $("buyPhone").value = parsed.phone;
    $("buyQR").value = rawText;
    if (parsed.website && !$("buyNotes").value) $("buyNotes").value = "Website: " + parsed.website;
  }
}

// ---------------- POST (READ JSON + URLs) ----------------
async function postEntry(payload){
  const url = getScriptUrl();
  setStatus("Saving...", "text-primary");
  log(`POST → ${url}`);
  try {
    const res = await fetch(url, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => null);

    if (!res.ok){
      const msg = json?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }

    if (!json || json.result !== "success"){
      throw new Error(json?.message || "Unknown error (no success response)");
    }

    setStatus("Saved successfully.", "text-success");
    log(`SUCCESS. folderUrl=${json.folderUrl || "—"}`);
    return json;

  } catch (e){
    console.error(e);
    setStatus(`Save failed: ${e.message}`, "text-danger");
    log(`ERROR: ${e.message}`);
    return null;
  }
}

// ---------------- SAVE FLOWS ----------------
async function saveSupplier(closeAfter){
  const company = $("supCompany").value.trim();
  const productsOrNeeds = $("supProducts").value.trim();
  if (!company || !productsOrNeeds){
    alert("Please fill Company name and What they sell (list).");
    return;
  }

  setStatus("Preparing files...", "text-primary");
  const filesPayload = await collectFilesPayload("supCatalogFiles", "supCardFile");

  const payload = {
    type: "supplier",
    company,
    contact: $("supContact").value.trim(),
    email: $("supEmail").value.trim(),
    phone: $("supPhone").value.trim(),
    country: $("supCountry").value.trim(),
    productType: $("supProductType").value.trim(),
    productsOrNeeds,
    exFactory: $("supExFactory").value.trim(),
    fob: $("supFOB").value.trim(),
    qrData: $("supQR").value.trim(),
    notes: $("supNotes").value.trim(),
    privateLabel: "",
    markets: "",
    timestamp: Date.now(),
    catalogFiles: filesPayload.catalogFiles,
    cardFile: filesPayload.cardFile,
  };

  const result = await postEntry(payload);
  if (!result) return;

  $("supResult").innerHTML =
    `Drive folder: <a href="${escapeHtml(result.folderUrl)}" target="_blank" rel="noopener">${escapeHtml(result.folderUrl)}</a><br/>
     Items sheet: <a href="${escapeHtml(result.itemsSheetUrl)}" target="_blank" rel="noopener">${escapeHtml(result.itemsSheetUrl)}</a>`;

  addSessionEntry(payload, result);
  if (closeAfter){
    clearSupplier();
    setActiveTab("tabLeads");
  } else {
    clearSupplier();
  }
}

async function saveBuyer(closeAfter){
  const contact = $("buyContact").value.trim();
  const productsOrNeeds = $("buyNeeds").value.trim();
  if (!contact || !productsOrNeeds){
    alert("Please fill Contact name and What they want to buy (list).");
    return;
  }

  setStatus("Preparing files...", "text-primary");
  const filesPayload = await collectFilesPayload("buyCatalogFiles", "buyCardFile");

  const payload = {
    type: "buyer",
    company: $("buyCompany").value.trim(),
    contact,
    email: $("buyEmail").value.trim(),
    phone: $("buyPhone").value.trim(),
    country: $("buyCountry").value.trim(),
    productType: "",
    productsOrNeeds,
    exFactory: "",
    fob: "",
    qrData: $("buyQR").value.trim(),
    notes: $("buyNotes").value.trim(),
    privateLabel: $("buyPL").value.trim(),
    markets: $("buyMarkets").value.trim(),
    timestamp: Date.now(),
    catalogFiles: filesPayload.catalogFiles,
    cardFile: filesPayload.cardFile,
  };

  const result = await postEntry(payload);
  if (!result) return;

  $("buyResult").innerHTML =
    `Drive folder: <a href="${escapeHtml(result.folderUrl)}" target="_blank" rel="noopener">${escapeHtml(result.folderUrl)}</a><br/>
     Items sheet: <a href="${escapeHtml(result.itemsSheetUrl)}" target="_blank" rel="noopener">${escapeHtml(result.itemsSheetUrl)}</a>`;

  addSessionEntry(payload, result);
  if (closeAfter){
    clearBuyer();
    setActiveTab("tabLeads");
  } else {
    clearBuyer();
  }
}

function clearSupplier(){
  ["supCompany","supContact","supEmail","supPhone","supCountry","supProductType","supProducts","supExFactory","supFOB","supQR","supNotes"].forEach(id => $(id).value = "");
  $("supCatalogFiles").value = "";
  $("supCardFile").value = "";
  $("supResult").textContent = "";
}

function clearBuyer(){
  ["buyContact","buyCompany","buyEmail","buyPhone","buyCountry","buyNeeds","buyPL","buyMarkets","buyQR","buyNotes"].forEach(id => $(id).value = "");
  $("buyCatalogFiles").value = "";
  $("buyCardFile").value = "";
  $("buyResult").textContent = "";
}

// ---------------- SETTINGS ----------------
function loadSettingsUI(){
  $("scriptUrlInput").value = getScriptUrl();
}
function saveSettings(){
  const v = $("scriptUrlInput").value.trim();
  if (!v || !v.endsWith("/exec")){
    alert("Please paste a valid Apps Script Web App URL ending with /exec");
    return;
  }
  localStorage.setItem(LS_SCRIPT_URL_KEY, v);
  log(`Saved Script URL: ${v}`);
  setStatus("Settings saved.", "text-success");
}

async function testConnection(){
  setStatus("Testing connection...", "text-primary");
  log("Testing /exec ...");
  const url = getScriptUrl();

  // Send a tiny “ping” POST that should return JSON
  const payload = { type:"buyer", contact:"Ping", productsOrNeeds:"Test", timestamp:Date.now() };

  try{
    const res = await fetch(url, {
      method:"POST",
      mode:"cors",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => null);
    log(`Test response: HTTP ${res.status} ${JSON.stringify(json)}`);
    if (res.ok && json?.result === "success"){
      setStatus("Connection OK. Drive URLs should appear on save.", "text-success");
    } else {
      setStatus("Connection failed. Check Apps Script deployment settings.", "text-danger");
    }
  } catch(e){
    log(`Test ERROR: ${e.message}`);
    setStatus(`Test failed: ${e.message}`, "text-danger");
  }
}

function clearLogs(){
  $("logBox").textContent = "";
}

// ---------------- INIT ----------------
window.addEventListener("DOMContentLoaded", () => {
  // tabs
  $("tabLeads").addEventListener("click", () => setActiveTab("tabLeads"));
  $("tabSupplier").addEventListener("click", () => setActiveTab("tabSupplier"));
  $("tabBuyer").addEventListener("click", () => setActiveTab("tabBuyer"));
  $("tabSettings").addEventListener("click", () => { loadSettingsUI(); setActiveTab("tabSettings"); });

  // lead type buttons (open the correct form)
  $("btnSupplier").addEventListener("click", () => setMode("supplier"));
  $("btnBuyer").addEventListener("click", () => setMode("buyer"));

  // scan
  $("btnScan").addEventListener("click", openQr);
  $("btnCloseQr").addEventListener("click", closeQr);

  // close overlay by clicking background + ESC
  $("qrScannerOverlay").addEventListener("click", (e) => {
    if (e.target && e.target.id === "qrScannerOverlay") closeQr();
  });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeQr(); });

  // supplier actions
  $("saveSupplierNew").addEventListener("click", () => saveSupplier(false));
  $("saveSupplierClose").addEventListener("click", () => saveSupplier(true));
  $("clearSupplier").addEventListener("click", clearSupplier);

  // buyer actions
  $("saveBuyerNew").addEventListener("click", () => saveBuyer(false));
  $("saveBuyerClose").addEventListener("click", () => saveBuyer(true));
  $("clearBuyer").addEventListener("click", clearBuyer);

  // settings actions
  $("saveSettings").addEventListener("click", saveSettings);
  $("testConnection").addEventListener("click", testConnection);
  $("clearLogs").addEventListener("click", clearLogs);

  setActiveTab("tabLeads");
  updateSummary();
  log("App loaded.");
  log(`Default Script URL: ${DEFAULT_SCRIPT_URL}`);
});
