// FRONTEND ONLY (GitHub Pages). No DriveApp/SpreadsheetApp here.

const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzrHBqp6ZcS3lvRir9EchBhsldBS1jRghuQCWhj7XOY4nyuy8NRQP6mz3J1WGNYm-cD/exec";
const LS_SCRIPT_URL_KEY = "boi_crm_script_url";

let mode = "supplier";
let entries = [];
let qr = null;

const $ = (id) => document.getElementById(id);

function getScriptUrl() {
  return localStorage.getItem(LS_SCRIPT_URL_KEY) || DEFAULT_SCRIPT_URL;
}

function setMode(newMode){
  mode = newMode;

  $("btnSupplier").classList.toggle("isActive", mode === "supplier");
  $("btnBuyer").classList.toggle("isActive", mode === "buyer");

  $("panelSupplier").style.display = (mode === "supplier") ? "" : "none";
  $("panelBuyer").style.display = (mode === "buyer") ? "" : "none";
}

function setStatus(msg, ok=null){
  const el = $("status");
  el.textContent = msg || "";
  el.classList.remove("ok","bad");
  if (ok === true) el.classList.add("ok");
  if (ok === false) el.classList.add("bad");
}

function updateSummary(){
  $("summary").textContent = `${entries.length} leads this session`;
}

function log(msg){
  const box = $("logBox");
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  box.textContent = (box.textContent ? box.textContent + "\n" : "") + line;
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(s){
  return String(s||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

/* FILES */
function fileToBase64(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result || "");
      resolve(res.includes("base64,") ? res.split("base64,")[1] : "");
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

/* QR */
function openQr(){
  if (!window.Html5Qrcode){
    alert("QR library failed to load.");
    return;
  }
  $("qrOverlay").classList.add("open");
  $("qrOverlay").setAttribute("aria-hidden","false");

  if (!qr) qr = new Html5Qrcode("qr-reader");

  qr.start(
    { facingMode:"environment" },
    { fps:10, qrbox:250 },
    (decodedText) => { applyScan(decodedText); closeQr(); },
    () => {}
  ).catch((err)=>{
    console.error(err);
    alert("Could not start camera. Allow camera permission.");
    closeQr();
  });
}

function closeQr(){
  $("qrOverlay").classList.remove("open");
  $("qrOverlay").setAttribute("aria-hidden","true");
  if (qr){
    try { qr.stop().catch(()=>{}); } catch {}
  }
}

function parseVCard(text){
  const out = { fullName:"", company:"", email:"", phone:"" };
  const t = String(text || "").trim();
  if (!t.includes("BEGIN:VCARD")) return out;
  const lines = t.split(/\r?\n/);
  for (const l of lines){
    if (l.startsWith("FN:")) out.fullName = l.substring(3).trim();
    if (l.startsWith("ORG:")) out.company = l.substring(4).trim();
    if (l.startsWith("EMAIL")) out.email = (l.split(":")[1] || "").trim();
    if (l.startsWith("TEL") && !out.phone) out.phone = (l.split(":")[1] || "").trim();
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

/* POST — reads TEXT first, then JSON.parse (fixes your exact error) */
async function postEntry(payload){
  const url = getScriptUrl();
  setStatus("Saving…", null);
  log(`POST → ${url}`);

  try{
    // IMPORTANT: x-www-form-urlencoded avoids CORS preflight from GitHub Pages
    const form = new URLSearchParams();
    form.set("payload", JSON.stringify(payload));

    const res = await fetch(url, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: form.toString()
    });

    const text = await res.text();
    log("RAW RESPONSE: " + text);

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("Server did not return JSON. Raw: " + text.slice(0, 200));
    }

    if (!json || json.result !== "success") throw new Error(json?.message || "Save failed");

    setStatus("Saved ✓", true);
    return json;

  } catch (e){
    console.error(e);
    setStatus(`Save failed: ${e.message}`, false);
    log(`ERROR: ${e.message}`);
    return null;
  }
}

/* SESSION TABLE */
function addSessionEntry(payload, result){
  entries.push({ payload, result });
  updateSummary();

  const tbody = $("tbl").querySelector("tbody");
  const tr = document.createElement("tr");

  const driveCell = result?.folderUrl
    ? `<a href="${escapeHtml(result.folderUrl)}" target="_blank" rel="noopener">Open</a>`
    : "—";

  tr.innerHTML = `
    <td>${escapeHtml(payload.type)}</td>
    <td>${escapeHtml(payload.contact || "")}<br><span class="muted mini">${escapeHtml(payload.company || "")}</span></td>
    <td>${escapeHtml(payload.country || "")}</td>
    <td>${driveCell}</td>
  `;
  tbody.prepend(tr);
}

/* CLEAR */
function clearSupplier(){
  ["supCompany","supContact","supEmail","supPhone","supCountry","supProductType","supProducts","supExFactory","supFOB","supQR","supNotes"]
    .forEach(id => $(id).value = "");
  $("supCatalogFiles").value = "";
  $("supCardFile").value = "";
  $("supResult").innerHTML = "";
}

function clearBuyer(){
  ["buyContact","buyCompany","buyEmail","buyPhone","buyCountry","buyMarkets","buyNeeds","buyPL","buyQR","buyNotes"]
    .forEach(id => $(id).value = "");
  $("buyCatalogFiles").value = "";
  $("buyCardFile").value = "";
  $("buyResult").innerHTML = "";
}

/* SAVE */
async function saveSupplier(closeAfter){
  const company = $("supCompany").value.trim();
  const items = $("supProducts").value.trim();
  if (!company || !items){
    alert("Please fill Company name and What do they sell.");
    return;
  }

  const files = await collectFilesPayload("supCatalogFiles","supCardFile");

  const payload = {
    type: "supplier",
    company,
    contact: $("supContact").value.trim(),
    email: $("supEmail").value.trim(),
    phone: $("supPhone").value.trim(),
    country: $("supCountry").value.trim(),
    productType: $("supProductType").value.trim(),
    productsOrNeeds: items,
    exFactory: $("supExFactory").value.trim(),
    fob: $("supFOB").value.trim(),
    qrData: $("supQR").value.trim(),
    notes: $("supNotes").value.trim(),
    catalogFiles: files.catalogFiles,
    cardFile: files.cardFile,
    timestamp: Date.now()
  };

  const result = await postEntry(payload);
  if (!result) return;

  $("supResult").innerHTML =
    `Drive folder: <a href="${escapeHtml(result.folderUrl)}" target="_blank" rel="noopener">${escapeHtml(result.folderUrl)}</a><br>
     Items sheet: <a href="${escapeHtml(result.itemsSheetUrl)}" target="_blank" rel="noopener">${escapeHtml(result.itemsSheetUrl)}</a>`;

  addSessionEntry(payload, result);
  clearSupplier();

  if (closeAfter) window.scrollTo({ top:0, behavior:"smooth" });
}

async function saveBuyer(closeAfter){
  const contact = $("buyContact").value.trim();
  const items = $("buyNeeds").value.trim();
  if (!contact || !items){
    alert("Please fill Contact name and What do they want to buy.");
    return;
  }

  const files = await collectFilesPayload("buyCatalogFiles","buyCardFile");

  const payload = {
    type: "buyer",
    company: $("buyCompany").value.trim(),
    contact,
    email: $("buyEmail").value.trim(),
    phone: $("buyPhone").value.trim(),
    country: $("buyCountry").value.trim(),
    markets: $("buyMarkets").value.trim(),
    privateLabel: $("buyPL").value.trim(),
    productsOrNeeds: items,
    qrData: $("buyQR").value.trim(),
    notes: $("buyNotes").value.trim(),
    catalogFiles: files.catalogFiles,
    cardFile: files.cardFile,
    timestamp: Date.now()
  };

  const result = await postEntry(payload);
  if (!result) return;

  $("buyResult").innerHTML =
    `Drive folder: <a href="${escapeHtml(result.folderUrl)}" target="_blank" rel="noopener">${escapeHtml(result.folderUrl)}</a><br>
     Items sheet: <a href="${escapeHtml(result.itemsSheetUrl)}" target="_blank" rel="noopener">${escapeHtml(result.itemsSheetUrl)}</a>`;

  addSessionEntry(payload, result);
  clearBuyer();

  if (closeAfter) window.scrollTo({ top:0, behavior:"smooth" });
}

/* SETTINGS */
function openSettings(){
  $("settingsOverlay").classList.add("open");
  $("settingsOverlay").setAttribute("aria-hidden","false");
  $("scriptUrlInput").value = getScriptUrl();
}
function closeSettings(){
  $("settingsOverlay").classList.remove("open");
  $("settingsOverlay").setAttribute("aria-hidden","true");
}
function saveSettings(){
  const v = $("scriptUrlInput").value.trim();
  if (!v.endsWith("/exec")) { alert("Apps Script URL must end with /exec"); return; }
  localStorage.setItem(LS_SCRIPT_URL_KEY, v);
  log("Saved Script URL: " + v);
  setStatus("Settings saved ✓", true);
}
async function testConnection(){
  const url = getScriptUrl();
  const pingUrl = url + (url.includes("?") ? "&" : "?") + "ping=1";

  try {
    const res = await fetch(pingUrl, { method:"GET", mode:"cors" });
    const text = await res.text();
    log("PING RAW RESPONSE: " + text);

    const json = JSON.parse(text);
    if (json?.result === "success") {
      alert("Connection OK ✅ Web App is reachable.");
      setStatus("Connection OK ✓", true);
    } else {
      alert("Connection failed. " + (json?.message || ""));
      setStatus("Connection failed", false);
    }
  } catch (e) {
    alert("Connection failed. Check Apps Script deployment permissions.");
    setStatus("Connection failed", false);
    log("PING ERROR: " + e.message);
  }
}

/* INIT */
window.addEventListener("DOMContentLoaded", () => {
  setMode("supplier");
  updateSummary();
  setStatus("", null);

  $("btnSupplier").addEventListener("click", () => setMode("supplier"));
  $("btnBuyer").addEventListener("click", () => setMode("buyer"));

  $("saveSupplierNew").addEventListener("click", () => saveSupplier(false));
  $("saveSupplierClose").addEventListener("click", () => saveSupplier(true));
  $("clearSupplier").addEventListener("click", clearSupplier);

  $("saveBuyerNew").addEventListener("click", () => saveBuyer(false));
  $("saveBuyerClose").addEventListener("click", () => saveBuyer(true));
  $("clearBuyer").addEventListener("click", clearBuyer);

  $("btnScan").addEventListener("click", openQr);
  $("btnCloseQr").addEventListener("click", closeQr);

  $("qrOverlay").addEventListener("click", (e) => {
    if (e.target.id === "qrOverlay") closeQr();
  });

  $("btnSettings").addEventListener("click", openSettings);
  $("closeSettings").addEventListener("click", closeSettings);
  $("saveSettings").addEventListener("click", saveSettings);
  $("testConnection").addEventListener("click", testConnection);

  $("settingsOverlay").addEventListener("click", (e) => {
    if (e.target.id === "settingsOverlay") closeSettings();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape"){ closeQr(); closeSettings(); }
  });

  log("Loaded. Script URL: " + getScriptUrl());
});

