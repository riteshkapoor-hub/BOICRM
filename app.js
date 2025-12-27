/***********************
 * BOI CRM Frontend (Browser JS) — app.js
 ***********************/

// Your Apps Script Web App URL
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzrHBqp6ZcS3lvRir9EchBhsldBS1jRghuQCWhj7XOY4nyuy8NRQP6mz3J1WGNYm-cD/exec";

let leadType = "supplier"; // supplier | buyer
let sessionUser = "";
let html5Qr = null;

const $ = (id) => document.getElementById(id);

function setStatus(msg, ok = null) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.remove("text-danger", "text-success", "text-info");
  if (ok === true) el.classList.add("text-success");
  else if (ok === false) el.classList.add("text-danger");
  else el.classList.add("text-info");
}

function updateSummary(count) {
  $("summary").textContent = `${count} leads this session`;
}

let sessionCount = 0;

function showSupplier() {
  leadType = "supplier";
  $("cardSupplier").classList.remove("d-none");
  $("cardBuyer").classList.add("d-none");
  $("btnSupplier").classList.add("btn-primary");
  $("btnSupplier").classList.remove("btn-outline-primary");
  $("btnBuyer").classList.add("btn-outline-primary");
  $("btnBuyer").classList.remove("btn-primary");
}

function showBuyer() {
  leadType = "buyer";
  $("cardBuyer").classList.remove("d-none");
  $("cardSupplier").classList.add("d-none");
  $("btnBuyer").classList.add("btn-primary");
  $("btnBuyer").classList.remove("btn-outline-primary");
  $("btnSupplier").classList.add("btn-outline-primary");
  $("btnSupplier").classList.remove("btn-primary");
}

function getUsername() {
  const saved = localStorage.getItem("boi_crm_user") || "";
  if (saved) return saved;
  const name = prompt("Enter your name (saved as Entered By):") || "";
  const clean = name.trim();
  if (clean) localStorage.setItem("boi_crm_user", clean);
  return clean;
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      resolve(s.includes("base64,") ? s.split("base64,")[1] : "");
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function collectUploads(catalogInputId, cardInputId) {
  const catalogFiles = [];
  const cat = $(catalogInputId);
  if (cat && cat.files && cat.files.length) {
    for (const f of cat.files) {
      const dataBase64 = await fileToBase64(f);
      catalogFiles.push({
        name: f.name,
        mimeType: f.type || "application/octet-stream",
        dataBase64
      });
    }
  }

  let cardFile = null;
  const card = $(cardInputId);
  if (card && card.files && card.files.length) {
    const f = card.files[0];
    const dataBase64 = await fileToBase64(f);
    cardFile = {
      name: f.name,
      mimeType: f.type || "image/jpeg",
      dataBase64
    };
  }

  return { catalogFiles, cardFile };
}

/**
 * POST JSON as text/plain to avoid CORS preflight on GitHub Pages.
 */
async function postLead(payload) {
  try {
    setStatus("Saving…", null);

    const res = await fetch(SCRIPT_URL, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Server did not return JSON. Got: ${text.slice(0, 180)}`);
    }

    if (json.result !== "success") throw new Error(json.message || "Save failed");

    setStatus("Saved ✓", true);
    return json;
  } catch (e) {
    console.error(e);
    setStatus(`Save failed: ${e.message}`, false);
    alert(`Save failed: ${e.message}`);
    return null;
  }
}

function addSessionRow(type, contactCompany, country) {
  const tbody = $("tbl").querySelector("tbody");
  const tr = document.createElement("tr");
  const time = new Date().toLocaleTimeString();
  tr.innerHTML = `
    <td>${type}</td>
    <td>${contactCompany}</td>
    <td>${country || ""}</td>
    <td>${time}</td>
  `;
  tbody.prepend(tr);
}

function parseVCard(text) {
  const out = { fullName: "", company: "", email: "", phone: "" };
  const t = String(text || "").trim();
  if (!t.includes("BEGIN:VCARD")) return out;

  const lines = t.split(/\r?\n/);
  for (const l of lines) {
    if (l.startsWith("FN:")) out.fullName = l.substring(3).trim();
    if (l.startsWith("ORG:")) out.company = l.substring(4).trim();
    if (l.startsWith("EMAIL")) out.email = (l.split(":")[1] || "").trim();
    if (l.startsWith("TEL") && !out.phone) out.phone = (l.split(":")[1] || "").trim();
  }
  return out;
}

function applyScan(raw) {
  const p = parseVCard(raw);

  if (leadType === "supplier") {
    if (p.company && !$("supCompany").value) $("supCompany").value = p.company;
    if (p.fullName && !$("supContact").value) $("supContact").value = p.fullName;
    if (p.email && !$("supEmail").value) $("supEmail").value = p.email;
    if (p.phone && !$("supPhone").value) $("supPhone").value = p.phone;
    $("supQR").value = raw;
  } else {
    if (p.fullName && !$("buyContact").value) $("buyContact").value = p.fullName;
    if (p.company && !$("buyCompany").value) $("buyCompany").value = p.company;
    if (p.email && !$("buyEmail").value) $("buyEmail").value = p.email;
    if (p.phone && !$("buyPhone").value) $("buyPhone").value = p.phone;
    $("buyQR").value = raw;
  }
}

function openQr() {
  const overlay = $("qrScannerOverlay");
  overlay.classList.add("is-open");
  overlay.setAttribute("aria-hidden", "false");

  if (!window.Html5Qrcode) {
    alert("QR scanner library not loaded.");
    closeQr();
    return;
  }

  if (!html5Qr) html5Qr = new Html5Qrcode("qr-reader");

  html5Qr
    .start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 250 },
      (decodedText) => {
        applyScan(decodedText);
        closeQr();
      },
      () => {}
    )
    .catch((err) => {
      console.error(err);
      alert("Could not start camera. Please allow camera permission.");
      closeQr();
    });
}

function closeQr() {
  const overlay = $("qrScannerOverlay");
  overlay.classList.remove("is-open");
  overlay.setAttribute("aria-hidden", "true");

  if (html5Qr) {
    try {
      html5Qr.stop().catch(() => {});
    } catch {}
  }
}

function clearSupplier() {
  ["supCompany","supContact","supEmail","supPhone","supCountry","supProductType","supProducts","supExFactory","supFOB","supQR","supNotes"]
    .forEach(id => { if ($(id)) $(id).value = ""; });
  if ($("supCatalogFiles")) $("supCatalogFiles").value = "";
  if ($("supCardFile")) $("supCardFile").value = "";
}

function clearBuyer() {
  ["buyContact","buyCompany","buyEmail","buyPhone","buyCountry","buyNeeds","buyQR","buyNotes"]
    .forEach(id => { if ($(id)) $(id).value = ""; });
  if ($("buyCatalogFiles")) $("buyCatalogFiles").value = "";
  if ($("buyCardFile")) $("buyCardFile").value = "";
}

async function saveSupplier() {
  const company = $("supCompany").value.trim();
  const products = $("supProducts").value.trim();
  if (!company || !products) {
    alert("Please fill Company name and What do they sell.");
    return;
  }

  const uploads = await collectUploads("supCatalogFiles", "supCardFile");

  const payload = {
    type: "supplier",
    enteredBy: sessionUser,
    company,
    contact: $("supContact").value.trim(),
    email: $("supEmail").value.trim(),
    phone: $("supPhone").value.trim(),
    country: $("supCountry").value.trim(),
    productType: $("supProductType").value.trim(),
    productsOrNeeds: products,
    exFactory: $("supExFactory").value.trim(),
    fob: $("supFOB").value.trim(),
    qrData: $("supQR").value.trim(),
    notes: $("supNotes").value.trim(),
    catalogFiles: uploads.catalogFiles,
    cardFile: uploads.cardFile
  };

  const result = await postLead(payload);
  if (!result) return;

  sessionCount++;
  updateSummary(sessionCount);
  addSessionRow("Supplier", `${payload.company} / ${payload.contact || ""}`, payload.country);

  clearSupplier();
}

async function saveBuyer() {
  const contact = $("buyContact").value.trim();
  const needs = $("buyNeeds").value.trim();
  if (!contact || !needs) {
    alert("Please fill Contact name and What do they want to buy.");
    return;
  }

  const uploads = await collectUploads("buyCatalogFiles", "buyCardFile");

  const payload = {
    type: "buyer",
    enteredBy: sessionUser,
    contact,
    company: $("buyCompany").value.trim(),
    email: $("buyEmail").value.trim(),
    phone: $("buyPhone").value.trim(),
    country: $("buyCountry").value.trim(),
    productsOrNeeds: needs,
    qrData: $("buyQR").value.trim(),
    notes: $("buyNotes").value.trim(),
    catalogFiles: uploads.catalogFiles,
    cardFile: uploads.cardFile
  };

  const result = await postLead(payload);
  if (!result) return;

  sessionCount++;
  updateSummary(sessionCount);
  addSessionRow("Buyer", `${payload.contact} / ${payload.company || ""}`, payload.country);

  clearBuyer();
}

document.addEventListener("DOMContentLoaded", () => {
  // Session user
  sessionUser = getUsername();
  sessionUser = sessionUser || "Unknown";

  // Default view
  showSupplier();
  updateSummary(0);
  setStatus("Ready", null);

  // Buttons
  $("btnSupplier").addEventListener("click", showSupplier);
  $("btnBuyer").addEventListener("click", showBuyer);

  $("btnScan").addEventListener("click", () => openQr());
  $("btnCloseQr").addEventListener("click", () => closeQr());

  $("saveSupplier").addEventListener("click", saveSupplier);
  $("clearSupplier").addEventListener("click", clearSupplier);

  $("saveBuyer").addEventListener("click", saveBuyer);
  $("clearBuyer").addEventListener("click", clearBuyer);

  // Clicking outside box closes QR
  $("qrScannerOverlay").addEventListener("click", (e) => {
    if (e.target && e.target.id === "qrScannerOverlay") closeQr();
  });
});
