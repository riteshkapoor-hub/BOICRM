const SHEET_NAME = 'Leads';

// Your root folders (from your links)
const BUYERS_ROOT_ID = '1pgE-VKGtc-_l6gpFIbqvfJfgO-MiaraW';
const SUPPLIERS_ROOT_ID = '1pltrlpOsBJgUSb-4s1ZelpCQEOGuEs9c';

/**
 * Run this ONCE manually from the script editor to trigger permissions
 * and confirm folder access.
 */
function setupCheck() {
  const b = DriveApp.getFolderById(BUYERS_ROOT_ID).getName();
  const s = DriveApp.getFolderById(SUPPLIERS_ROOT_ID).getName();
  Logger.log("Buyer folder OK: " + b);
  Logger.log("Supplier folder OK: " + s);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log("Spreadsheet OK: " + ss.getName());
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ result: 'error', message: 'No POST body received' }, 400);
    }

    const data = JSON.parse(e.postData.contents);

    if (!data.type || (data.type !== 'buyer' && data.type !== 'supplier')) {
      return jsonResponse({ result: 'error', message: 'Invalid type. Must be buyer or supplier.' }, 400);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return jsonResponse({ result: 'error', message: `Sheet "${SHEET_NAME}" not found` }, 500);

    const now = new Date();
    const tz = Session.getScriptTimeZone();
    const dateSlug = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    const timeSlug = Utilities.formatDate(now, tz, 'HHmm');

    // Pick correct root folder
    const rootId = (data.type === 'buyer') ? BUYERS_ROOT_ID : SUPPLIERS_ROOT_ID;
    const rootFolder = DriveApp.getFolderById(rootId);

    // Folder naming
    const baseName = ((data.contact || data.company || '').trim()) || (data.type === 'buyer' ? 'Buyer' : 'Supplier');
    const safeName = sanitize_(baseName).substring(0, 80);

    const folderName =
      (data.type === 'buyer' ? 'Buyer - ' : 'Supplier - ') +
      safeName + ' - ' + dateSlug + ' ' + timeSlug;

    // ✅ Create subfolder in correct root
    const subfolder = rootFolder.createFolder(folderName);
    const folderUrl = 'https://drive.google.com/drive/folders/' + subfolder.getId();

    // ✅ Create Items Google Sheet inside subfolder
    const itemsFileName =
      (data.type === 'buyer' ? 'Buyer Items - ' : 'Supplier Items - ') +
      safeName + ' - ' + dateSlug;

    const itemsSS = SpreadsheetApp.create(itemsFileName);
    DriveApp.getFileById(itemsSS.getId()).moveTo(subfolder);
    const itemsSheetUrl = 'https://docs.google.com/spreadsheets/d/' + itemsSS.getId();

    const sh = itemsSS.getSheets()[0];
    sh.setName('Items');

    // Headers
    if (data.type === 'buyer') {
      sh.getRange(1, 1, 1, 3).setValues([['Item wanted', 'Notes', 'From CRM (Timestamp)']]);
    } else {
      sh.getRange(1, 1, 1, 3).setValues([['Item sold', 'Notes', 'From CRM (Timestamp)']]);
    }

    // Write list lines
    const lines = (data.productsOrNeeds || '')
      .toString()
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);

    if (lines.length) {
      const ts = Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm:ss');
      sh.getRange(2, 1, lines.length, 3).setValues(lines.map(item => [item, '', ts]));
    }

    // ✅ Save files (catalog multiple + card optional)
    saveUploadedFilesToFolder_(subfolder, data, safeName, dateSlug);

    // ✅ Append row in master sheet
    const row = [
      now,                           // Timestamp
      data.type || '',               // Type
      data.company || '',            // Company
      data.contact || '',            // Contact
      data.email || '',              // Email
      data.phone || '',              // Phone
      data.country || '',            // Country
      data.productType || '',        // ProductType
      data.productsOrNeeds || '',    // ProductsOrNeeds
      '',                            // AttachmentLink (not used)
      data.exFactory || '',          // ExFactory
      data.fob || '',                // FOB
      data.privateLabel || '',       // PrivateLabel
      data.markets || '',            // Markets
      data.qrData || '',             // QRData
      data.notes || '',              // Notes
      folderUrl,                     // FolderUrl
      itemsSheetUrl                  // ItemsSheetUrl
    ];

    sheet.appendRow(row);

    return jsonResponse({ result: 'success', folderUrl, itemsSheetUrl }, 200);

  } catch (err) {
    Logger.log("ERROR: " + err + "\n" + (err && err.stack ? err.stack : ''));
    return jsonResponse({ result: 'error', message: String(err) }, 500);
  }
}

function saveUploadedFilesToFolder_(folder, data, safeName, dateSlug) {
  // Card file (optional)
  if (data.cardFile && data.cardFile.dataBase64) {
    const blob = Utilities.newBlob(
      Utilities.base64Decode(data.cardFile.dataBase64),
      data.cardFile.mimeType || 'image/jpeg',
      `Card - ${safeName} - ${dateSlug} - ${sanitize_(data.cardFile.name || 'card.jpg')}`
    );
    folder.createFile(blob);
  }

  // Catalog files (multiple optional)
  if (Array.isArray(data.catalogFiles) && data.catalogFiles.length) {
    data.catalogFiles.forEach((f, i) => {
      if (!f || !f.dataBase64) return;
      const blob = Utilities.newBlob(
        Utilities.base64Decode(f.dataBase64),
        f.mimeType || 'application/octet-stream',
        `Catalog ${String(i + 1).padStart(2, '0')} - ${safeName} - ${dateSlug} - ${sanitize_(f.name || 'catalog')}`
      );
      folder.createFile(blob);
    });
  }
}

function sanitize_(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, ' ').trim().substring(0, 120);
}

function jsonResponse(obj, statusCode) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzrHBqp6ZcS3lvRir9EchBhsldBS1jRghuQCWhj7XOY4nyuy8NRQP6mz3J1WGNYm-cD/exec";

let entries = [];
let mode = null; // 'supplier' | 'buyer'
let html5QrCode = null;

function $(id){ return document.getElementById(id); }

function setStatus(msg, cls="text-info"){
  const el = $("status");
  el.className = "small " + cls;
  el.textContent = msg || "";
}
function updateSummary(){ $("summary").textContent = `${entries.length} leads this session`; }

function escapeHtml(s){
  return String(s || "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function addSessionEntry(e){
  entries.push(e);
  updateSummary();
  const tbody = $("tbl").querySelector("tbody");
  const tr = document.createElement("tr");

  const badge = document.createElement("span");
  badge.className = "badge text-capitalize " + (e.type === "supplier" ? "badge-supplier" : "badge-buyer");
  badge.textContent = e.type;

  tr.innerHTML = `
    <td></td>
    <td>${escapeHtml(e.contact || "(no contact)")}<br/><small class="text-muted">${escapeHtml(e.company || "")}</small></td>
    <td>${escapeHtml(e.country || "")}</td>
    <td>${new Date(e.timestamp).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}</td>
  `;
  tr.children[0].appendChild(badge);
  tbody.prepend(tr);
}

function setMode(newMode){
  mode = newMode;
  $("cardSupplier").classList.toggle("d-none", mode !== "supplier");
  $("cardBuyer").classList.toggle("d-none", mode !== "buyer");

  $("btnSupplier").className = "btn btn-sm " + (mode === "supplier" ? "btn-primary" : "btn-outline-primary");
  $("btnBuyer").className = "btn btn-sm " + (mode === "buyer" ? "btn-primary" : "btn-outline-primary");
}

/* ---------- Files to Base64 ---------- */
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

/* ---------- Optional QR Scan ---------- */
function openQr(){
  if (!mode){
    alert("Select Supplier or Buyer first (scan is optional, but we need type to auto-fill correctly).");
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

/* ---------- Submit ---------- */
async function postEntry(payload){
  setStatus("Saving...", "text-info");
  try {
    await fetch(SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setStatus("Saved.", "text-success");
    setTimeout(() => setStatus(""), 1400);
    return true;
  } catch (e){
    console.error(e);
    setStatus("Save failed. Check internet.", "text-danger");
    alert("Save failed. Check connection and try again.");
    return false;
  }
}

async function saveSupplier(){
  const company = $("supCompany").value.trim();
  const productsOrNeeds = $("supProducts").value.trim();
  if (!company || !productsOrNeeds){
    alert("Please fill Company name and What they sell (list).");
    return;
  }

  setStatus("Preparing files...", "text-info");
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

  const ok = await postEntry(payload);
  if (ok){ addSessionEntry(payload); clearSupplier(); }
}

async function saveBuyer(){
  const contact = $("buyContact").value.trim();
  const productsOrNeeds = $("buyNeeds").value.trim();
  if (!contact || !productsOrNeeds){
    alert("Please fill Contact name and What they want to buy (list).");
    return;
  }

  setStatus("Preparing files...", "text-info");
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

  const ok = await postEntry(payload);
  if (ok){ addSessionEntry(payload); clearBuyer(); }
}

function clearSupplier(){
  ["supCompany","supContact","supEmail","supPhone","supCountry","supProductType","supProducts","supExFactory","supFOB","supQR","supNotes"].forEach(id => $(id).value = "");
  $("supCatalogFiles").value = "";
  $("supCardFile").value = "";
}

function clearBuyer(){
  ["buyContact","buyCompany","buyEmail","buyPhone","buyCountry","buyNeeds","buyPL","buyMarkets","buyQR","buyNotes"].forEach(id => $(id).value = "");
  $("buyCatalogFiles").value = "";
  $("buyCardFile").value = "";
}

window.addEventListener("DOMContentLoaded", () => {
  $("btnSupplier").addEventListener("click", () => setMode("supplier"));
  $("btnBuyer").addEventListener("click", () => setMode("buyer"));
  $("btnScan").addEventListener("click", openQr);
  $("btnCloseQr").addEventListener("click", closeQr);

  $("saveSupplier").addEventListener("click", saveSupplier);
  $("clearSupplier").addEventListener("click", clearSupplier);
  $("saveBuyer").addEventListener("click", saveBuyer);
  $("clearBuyer").addEventListener("click", clearBuyer);
  // Close when clicking outside the box
$("qrScannerOverlay").addEventListener("click", (e) => {
  if (e.target && e.target.id === "qrScannerOverlay") closeQr();
});

// Close on ESC key
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeQr();
});
  updateSummary();
});



