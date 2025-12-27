/***********************
 * BOI CRM (Frontend) — app.js
 ***********************/

// Default Apps Script URL (you can change via Settings modal)
const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzrHBqp6ZcS3lvRir9EchBhsldBS1jRghuQCWhj7XOY4nyuy8NRQP6mz3J1WGNYm-cD/exec";

const LS_SCRIPT_URL = "boi_crm_script_url";
const LS_USER = "boi_crm_user";

let leadType = "supplier"; // supplier | buyer
let html5Qr = null;
let sessionCount = 0;

const $ = (id) => document.getElementById(id);

function scriptUrl() {
  return (localStorage.getItem(LS_SCRIPT_URL) || DEFAULT_SCRIPT_URL).trim();
}

function setStatus(msg) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
}

function updateSummary() {
  $("summary").textContent = `${sessionCount} leads this session`;
}

function setUserPill() {
  const u = localStorage.getItem(LS_USER) || "";
  $("userPill").textContent = `User: ${u || "—"}`;
}

function openOverlay(id) {
  const el = $(id);
  el.classList.add("open");
  el.setAttribute("aria-hidden", "false");
}
function closeOverlay(id) {
  const el = $(id);
  el.classList.remove("open");
  el.setAttribute("aria-hidden", "true");
}

/* -------- Lead type toggle -------- */
function showSupplier() {
  leadType = "supplier";
  $("btnSupplier").classList.add("isActive");
  $("btnBuyer").classList.remove("isActive");
  $("cardSupplier").style.display = "";
  $("cardBuyer").style.display = "none";
}

function showBuyer() {
  leadType = "buyer";
  $("btnBuyer").classList.add("isActive");
  $("btnSupplier").classList.remove("isActive");
  $("cardBuyer").style.display = "";
  $("cardSupplier").style.display = "none";
}

/* -------- Username (session) -------- */
function ensureUser() {
  const u = (localStorage.getItem(LS_USER) || "").trim();
  if (u) {
    closeOverlay("userOverlay");
    setUserPill();
    return;
  }
  openOverlay("userOverlay");
  setUserPill();
}

/* -------- Settings -------- */
function openSettings() {
  $("scriptUrlInput").value = scriptUrl();
  $("logBox").textContent = "";
  openOverlay("settingsOverlay");
}
function saveSettings() {
  const u = $("scriptUrlInput").value.trim();
  if (!u.endsWith("/exec")) {
    alert("Apps Script URL must end with /exec");
    return;
  }
  localStorage.setItem(LS_SCRIPT_URL, u);
  $("logBox").textContent = `Saved.\n${u}`;
}
async function testSettings() {
  try {
    const url = new URL(scriptUrl());
    url.searchParams.set("ping", "1");
    const res = await fetch(url.toString(), { method: "GET", mode: "cors" });
    const text = await res.text();
    $("logBox").textContent = `Ping response:\n${text}`;
  } catch (e) {
    $("logBox").textContent = `Ping failed:\n${e.message}`;
  }
}

/* -------- Files to base64 -------- */
function fileToBase64(file) {
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

/* -------- POST lead (text/plain to minimize CORS preflight) -------- */
async function postLead(payload) {
  setStatus("Saving…");

  try {
    const res = await fetch(scriptUrl(), {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); }
    catch { throw new Error("Server did not return JSON: " + text.slice(0, 160)); }

    if (!json || json.result !== "success") {
      throw new Error(json?.message || "Save failed");
    }

    setStatus("Saved ✓");
    return json;
  } catch (e) {
    console.error(e);
    setStatus("Save failed");
    alert("Save failed: " + e.message);
    return null;
  }
}

/* -------- Session table row -------- */
function addSessionRow(type, main, country) {
  const tbody = $("tbl").querySelector("tbody");
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${escapeHtml(type)}</td>
    <td>${escapeHtml(main)}</td>
    <td>${escapeHtml(country || "")}</td>
    <td>${new Date().toLocaleTimeString()}</td>
  `;
  tbody.prepend(tr);
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

/* -------- QR parsing + apply -------- */
function parseVCard(text) {
  const out = { fullName:"", company:"", email:"", phone:"" };
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

/* -------- QR modal open/close (ONLY on click) -------- */
function openQr() {
  openOverlay("qrOverlay");

  if (!window.Html5Qrcode) {
    alert("QR scanner library not loaded.");
    closeQr();
    return;
  }

  if (!html5Qr) html5Qr = new Html5Qrcode("qr-reader");

  html5Qr.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 250 },
    (decodedText) => {
      applyScan(decodedText);
      closeQr();
    },
    () => {}
  ).catch((err) => {
    console.error(err);
    alert("Could not start camera. Please allow camera permission.");
    closeQr();
  });
}

function closeQr() {
  closeOverlay("qrOverlay");
  if (html5Qr) {
    try { html5Qr.stop().catch(()=>{}); } catch {}
  }
}

/* -------- Clear forms -------- */
function clearSupplier() {
  ["supCompany","supContact","supTitle","supEmail","supPhone","supPhone2","supWebsite","supSocial",
   "supCountry","supProductType","supProducts","supExFactory","supFOB","supQR","supNotes"
  ].forEach(id => $(id).value = "");
  $("supCatalogFiles").value = "";
  $("supCardFile").value = "";
  $("supResult").textContent = "";
}

function clearBuyer() {
  ["buyContact","buyCompany","buyTitle","buyEmail","buyPhone","buyPhone2","buyWebsite","buySocial",
   "buyCountry","buyMarkets","buyNeeds","buyPL","buyQR","buyNotes"
  ].forEach(id => {
    const el = $(id);
    if (el.tagName === "SELECT") el.value = "";
    else el.value = "";
  });
  $("buyCatalogFiles").value = "";
  $("buyCardFile").value = "";
  $("buyResult").textContent = "";
}

/* -------- Save handlers -------- */
async function saveSupplier(closeAfter) {
  const company = $("supCompany").value.trim();
  const products = $("supProducts").value.trim();
  if (!company || !products) {
    alert("Please fill Company name and What do they sell.");
    return;
  }

  const uploads = await collectUploads("supCatalogFiles", "supCardFile");
  const enteredBy = (localStorage.getItem(LS_USER) || "Unknown").trim() || "Unknown";

  const payload = {
    type: "supplier",
    enteredBy,
    company,
    contact: $("supContact").value.trim(),
    title: $("supTitle").value.trim(),
    email: $("supEmail").value.trim(),
    phone: $("supPhone").value.trim(),
    phone2: $("supPhone2").value.trim(),
    website: $("supWebsite").value.trim(),
    social: $("supSocial").value.trim(),
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

  const res = await postLead(payload);
  if (!res) return;

  $("supResult").innerHTML = `Drive folder: <a href="${escapeHtml(res.folderUrl)}" target="_blank" rel="noopener">${escapeHtml(res.folderUrl)}</a><br>
Items sheet: <a href="${escapeHtml(res.itemsSheetUrl)}" target="_blank" rel="noopener">${escapeHtml(res.itemsSheetUrl)}</a>`;

  sessionCount++;
  updateSummary();
  addSessionRow("Supplier", `${company}${payload.contact ? " / " + payload.contact : ""}`, payload.country);

  if (closeAfter) {
    clearSupplier();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    clearSupplier();
  }
}

async function saveBuyer(closeAfter) {
  const contact = $("buyContact").value.trim();
  const needs = $("buyNeeds").value.trim();
  if (!contact || !needs) {
    alert("Please fill Contact name and What do they want to buy.");
    return;
  }

  const uploads = await collectUploads("buyCatalogFiles", "buyCardFile");
  const enteredBy = (localStorage.getItem(LS_USER) || "Unknown").trim() || "Unknown";

  const payload = {
    type: "buyer",
    enteredBy,
    contact,
    company: $("buyCompany").value.trim(),
    title: $("buyTitle").value.trim(),
    email: $("buyEmail").value.trim(),
    phone: $("buyPhone").value.trim(),
    phone2: $("buyPhone2").value.trim(),
    website: $("buyWebsite").value.trim(),
    social: $("buySocial").value.trim(),
    country: $("buyCountry").value.trim(),
    markets: $("buyMarkets").value.trim(),
    privateLabel: $("buyPL").value.trim(),
    productsOrNeeds: needs,
    qrData: $("buyQR").value.trim(),
    notes: $("buyNotes").value.trim(),
    catalogFiles: uploads.catalogFiles,
    cardFile: uploads.cardFile
  };

  const res = await postLead(payload);
  if (!res) return;

  $("buyResult").innerHTML = `Drive folder: <a href="${escapeHtml(res.folderUrl)}" target="_blank" rel="noopener">${escapeHtml(res.folderUrl)}</a><br>
Items sheet: <a href="${escapeHtml(res.itemsSheetUrl)}" target="_blank" rel="noopener">${escapeHtml(res.itemsSheetUrl)}</a>`;

  sessionCount++;
  updateSummary();
  addSessionRow("Buyer", `${contact}${payload.company ? " / " + payload.company : ""}`, payload.country);

  if (closeAfter) {
    clearBuyer();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    clearBuyer();
  }
}

/* -------- Init -------- */
document.addEventListener("DOMContentLoaded", () => {
  // Default UI
  showSupplier();
  updateSummary();
  setUserPill();
  setStatus("Ready");

  // User overlay
  ensureUser();
  $("btnStartSession").addEventListener("click", () => {
    const name = $("usernameInput").value.trim();
    if (!name) { alert("Enter username"); return; }
    localStorage.setItem(LS_USER, name);
    setUserPill();
    closeOverlay("userOverlay");
  });

  $("btnSwitchUser").addEventListener("click", () => {
    localStorage.removeItem(LS_USER);
    $("usernameInput").value = "";
    ensureUser();
  });

  // Lead type
  $("btnSupplier").addEventListener("click", showSupplier);
  $("btnBuyer").addEventListener("click", showBuyer);

  // QR
  $("btnScan").addEventListener("click", openQr);
  $("btnCloseQr").addEventListener("click", closeQr);
  $("qrOverlay").addEventListener("click", (e) => {
    if (e.target && e.target.id === "qrOverlay") closeQr();
  });

  // Settings
  $("btnSettings").addEventListener("click", openSettings);
  $("btnCloseSettings").addEventListener("click", () => closeOverlay("settingsOverlay"));
  $("btnSaveSettings").addEventListener("click", saveSettings);
  $("btnTestSettings").addEventListener("click", testSettings);
  $("settingsOverlay").addEventListener("click", (e) => {
    if (e.target && e.target.id === "settingsOverlay") closeOverlay("settingsOverlay");
  });

  // Supplier buttons
  $("saveSupplierNew").addEventListener("click", () => saveSupplier(false));
  $("saveSupplierClose").addEventListener("click", () => saveSupplier(true));
  $("clearSupplier").addEventListener("click", clearSupplier);

  // Buyer buttons
  $("saveBuyerNew").addEventListener("click", () => saveBuyer(false));
  $("saveBuyerClose").addEventListener("click", () => saveBuyer(true));
  $("clearBuyer").addEventListener("click", clearBuyer);

  // ESC closes modals
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeQr();
      closeOverlay("settingsOverlay");
    }
  });
});
