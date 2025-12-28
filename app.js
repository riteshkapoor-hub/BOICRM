/* =========================
   CONFIG
========================= */

const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzrHBqp6ZcS3lvRir9EchBhsldBS1jRghuQCWhj7XOY4nyuy8NRQP6mz3J1WGNYm-cD/exec";

/* =========================
   DOM
========================= */

const $ = (id) => document.getElementById(id);

const leadForm = $("leadForm");
const statusEl = $("status");

const btnSubmit = $("btnSubmit");
const btnClear = $("btnClear");

const scannerModal = $("scannerModal");
const scannerBackdrop = $("scannerBackdrop");
const btnOpenScanner = $("btnOpenScanner");
const btnCloseScanner = $("btnCloseScanner");
const btnStartScanner = $("btnStartScanner");
const btnStopScanner = $("btnStopScanner");
const scanStatus = $("scanStatus");

/* =========================
   UTIL
========================= */

function setStatus(msg, type = "info") {
  statusEl.textContent = msg || "";
  statusEl.className = `status ${type}`.trim();
}

function setScanStatus(msg, type = "info") {
  scanStatus.textContent = msg || "";
  scanStatus.className = `scan-status ${type}`.trim();
}

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

/* =========================
   FORM HELPERS
========================= */

function getFormPayload() {
  const payload = {
    company: $("company").value.trim(),
    contactName: $("contactName").value.trim(),
    title: $("title").value.trim(),
    email: $("email").value.trim(),
    phone: $("phone").value.trim(),
    country: $("country").value.trim(),
    productsOrNeeds: $("productsOrNeeds").value.trim(),
    notes: $("notes").value.trim(),
    source: $("source").value,
    priority: $("priority").value,
    createdAtLocal: new Date().toISOString(),
  };
  return payload;
}

function clearForm() {
  leadForm.reset();
  setStatus("");
}

/* =========================
   SUBMIT
========================= */

async function submitLead(payload) {
  // Apps Script is often happiest with text/plain
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  const json = safeJsonParse(text);

  if (!res.ok) {
    throw new Error(json?.message || text || `Request failed (${res.status})`);
  }

  // If your Apps Script returns JSON, great; if not, we still treat it as success
  return json || { ok: true, raw: text };
}

leadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus("");

  const payload = getFormPayload();

  // basic guard (optional)
  if (!payload.company && !payload.contactName && !payload.email && !payload.phone) {
    setStatus("Please enter at least Company or Contact or Email or Phone.", "warn");
    return;
  }

  btnSubmit.disabled = true;
  btnSubmit.textContent = "Saving...";

  try {
    const result = await submitLead(payload);
    setStatus("✅ Saved successfully.", "success");

    // optional: clear after save
    // clearForm();

    console.log("Saved:", result);
  } catch (err) {
    console.error(err);
    setStatus(`❌ Save failed: ${err.message}`, "error");
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.textContent = "Save Lead";
  }
});

btnClear.addEventListener("click", clearForm);

/* =========================
   QR SCANNER (html5-qrcode)
   Fixes auto-reopen + ensures full stop
========================= */

let scannerActive = false;
let html5Qr = null;
let lastScanAt = 0;

function openScannerUI() {
  scannerModal.classList.remove("hidden");
  scannerModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeScannerUI() {
  scannerModal.classList.add("hidden");
  scannerModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

async function startScanner() {
  if (scannerActive) return; // KEY: prevents loop / auto reopen
  scannerActive = true;

  openScannerUI();
  setScanStatus("Starting camera...", "info");

  if (!html5Qr) {
    html5Qr = new Html5Qrcode("qrReader", /* verbose= */ false);
  }

  try {
    const config = {
      fps: 10,
      qrbox: { width: 280, height: 280 },
      rememberLastUsedCamera: true,
    };

    // Prefer back camera
    const constraints = { facingMode: "environment" };

    await html5Qr.start(
      constraints,
      config,
      onScanSuccess,
      onScanFailure
    );

    setScanStatus("Camera is ON. Point at a QR code.", "success");
  } catch (e) {
    console.error("Scanner start error:", e);
    setScanStatus(`Camera error: ${e.message || e}`, "error");
    // Hard stop & reset state so user can retry
    await stopScanner(true);
  }
}

async function stopScanner(forceCloseUI = false) {
  if (!html5Qr) {
    scannerActive = false;
    if (forceCloseUI) closeScannerUI();
    return;
  }

  try {
    // stop() throws if not running sometimes, so guard with try
    await html5Qr.stop();
  } catch (e) {
    // ignore
  }

  try {
    await html5Qr.clear();
  } catch (e) {
    // ignore
  }

  scannerActive = false;
  setScanStatus("Camera stopped.", "info");
  if (forceCloseUI) closeScannerUI();
}

function onScanSuccess(decodedText) {
  // Debounce rapid duplicate scans
  const now = Date.now();
  if (now - lastScanAt < 1200) return;
  lastScanAt = now;

  setScanStatus("✅ QR detected. Filling fields...", "success");

  // Try to parse vCard or simple key/value text
  // 1) vCard parsing (basic)
  if (/BEGIN:VCARD/i.test(decodedText)) {
    parseVCard(decodedText);
  } else {
    // 2) If it’s JSON, parse
    const maybe = safeJsonParse(decodedText);
    if (maybe && typeof maybe === "object") {
      fillFromObject(maybe);
    } else {
      // 3) Otherwise put in Notes
      $("notes").value = ($("notes").value ? $("notes").value + "\n" : "") + `QR: ${decodedText}`;
    }
  }

  // IMPORTANT: stop + close immediately so it does NOT reopen
  stopScanner(true).catch(() => {});
}

function onScanFailure(_error) {
  // Keep quiet – errors happen constantly while scanning
}

function fillFromObject(obj) {
  // best-effort mapping
  if (obj.company) $("company").value = obj.company;
  if (obj.name || obj.contactName) $("contactName").value = obj.name || obj.contactName;
  if (obj.title) $("title").value = obj.title;
  if (obj.email) $("email").value = obj.email;
  if (obj.phone) $("phone").value = obj.phone;
  if (obj.country) $("country").value = obj.country;
}

function parseVCard(vcardText) {
  const lines = vcardText.split(/\r?\n/);

  let fullName = "";
  let email = "";
  let phone = "";
  let org = "";
  let title = "";

  for (const line of lines) {
    const l = line.trim();
    if (/^FN:/i.test(l)) fullName = l.replace(/^FN:/i, "").trim();
    if (/^EMAIL/i.test(l)) email = l.split(":").slice(1).join(":").trim();
    if (/^TEL/i.test(l)) phone = l.split(":").slice(1).join(":").trim();
    if (/^ORG:/i.test(l)) org = l.replace(/^ORG:/i, "").trim();
    if (/^TITLE:/i.test(l)) title = l.replace(/^TITLE:/i, "").trim();
  }

  if (org) $("company").value = org;
  if (fullName) $("contactName").value = fullName;
  if (title) $("title").value = title;
  if (email) $("email").value = email;
  if (phone) $("phone").value = phone;
}

/* =========================
   EVENTS
========================= */

// Never auto-start scanner on load
btnOpenScanner.addEventListener("click", () => startScanner());

btnStartScanner.addEventListener("click", () => startScanner());
btnStopScanner.addEventListener("click", () => stopScanner(false));
btnCloseScanner.addEventListener("click", () => stopScanner(true));
scannerBackdrop.addEventListener("click", () => stopScanner(true));

// Mobile safety: if user backgrounds tab, shut camera
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopScanner(true).catch(() => {});
  }
});

// ESC closes modal
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !scannerModal.classList.contains("hidden")) {
    stopScanner(true).catch(() => {});
  }
});

// Nice initial text
setStatus("Ready. Click “Scan QR” to capture a contact, then Save Lead.", "info");
