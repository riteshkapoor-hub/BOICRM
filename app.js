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

  updateSummary();
});

