/***********************
 * BOI CRM — Full Frontend
 * - Capture / Dashboard / Leads / Calendar
 * - Settings (Script URL + User)
 * - QR Scanner (NO auto-open, closes correctly)
 * - Saves to Apps Script /exec if configured
 * - Local storage cache
 ***********************/

const DEFAULT_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzrHBqp6ZcS3lvRir9EchBhsldBS1jRghuQCWhj7XOY4nyuy8NRQP6mz3J1WGNYm-cD/exec";

const LS_KEYS = {
  settings: "boi_crm_settings_v1",
  leads: "boi_crm_leads_v1",
  tasks: "boi_crm_tasks_v1"
};

const $ = (id) => document.getElementById(id);

/* =========================
   SETTINGS / STATE
========================= */
function loadSettings() {
  const raw = localStorage.getItem(LS_KEYS.settings);
  const s = raw ? JSON.parse(raw) : {};
  return {
    scriptUrl: s.scriptUrl || "",
    user: s.user || "",
    cache: s.cache || "on"
  };
}

function saveSettings(s) {
  localStorage.setItem(LS_KEYS.settings, JSON.stringify(s));
}

let SETTINGS = loadSettings();
let ACTIVE_TAB = "capture";
let LEAD_TYPE = "Supplier"; // Supplier / Buyer

/* =========================
   LOCAL DATA
========================= */
function loadLeads() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS.leads) || "[]"); }
  catch { return []; }
}
function saveLeads(list) {
  localStorage.setItem(LS_KEYS.leads, JSON.stringify(list));
}
function loadTasks() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS.tasks) || "[]"); }
  catch { return []; }
}
function saveTasks(list) {
  localStorage.setItem(LS_KEYS.tasks, JSON.stringify(list));
}

/* =========================
   UI HELPERS
========================= */
function setMsg(el, text, kind = "") {
  if (!el) return;
  el.className = `msg ${kind}`.trim();
  el.textContent = text || "";
}

function setBadge(el, text, kind) {
  if (!el) return;
  el.className = `badge ${kind}`.trim();
  el.textContent = text;
}

function isConfigured() {
  const okUser = !!(SETTINGS.user && SETTINGS.user.trim());
  const okUrl = !!(SETTINGS.scriptUrl && SETTINGS.scriptUrl.includes("/exec"));
  return okUser && okUrl;
}

function refreshHeader() {
  $("activeUserLabel").textContent = SETTINGS.user ? SETTINGS.user : "—";
  const statusEl = $("configStatus");
  if (isConfigured()) setBadge(statusEl, "Configured", "badge-ok");
  else setBadge(statusEl, "Not configured", "badge-warn");
}

function showTab(tabName) {
  ACTIVE_TAB = tabName;
  document.querySelectorAll(".tab").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tabName);
  });
  ["capture","dashboard","leads","calendar"].forEach(t => {
    const el = $(`tab-${t}`);
    el.classList.toggle("hidden", t !== tabName);
  });

  if (tabName === "dashboard") renderDashboard();
  if (tabName === "leads") renderLeads();
  if (tabName === "calendar") renderCalendar();
}

/* =========================
   MODALS
========================= */
function openModal(modalId) {
  const m = $(modalId);
  if (!m) return;
  m.classList.remove("hidden");
  m.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}
function closeModal(modalId) {
  const m = $(modalId);
  if (!m) return;
  m.classList.add("hidden");
  m.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

/* =========================
   LEAD FORM
========================= */
function clearLeadForm() {
  $("company").value = "";
  $("contactName").value = "";
  $("title").value = "";
  $("email").value = "";
  $("country").value = "";
  $("markets").value = "";
  $("phone1").value = "";
  $("phone2").value = "";
  $("website").value = "";
  $("social").value = "";
  $("productType").value = "";
  $("productsOrNeeds").value = "";
  $("notes").value = "";
  $("followUpDate").value = "";
  $("priority").value = "Warm";
  setMsg($("captureMsg"), "");
}

function buildLeadPayload() {
  const now = new Date();
  return {
    id: `L-${now.getTime()}`,
    createdAt: now.toISOString(),
    createdAtLocal: now.toLocaleString(),
    user: SETTINGS.user || "",
    leadType: LEAD_TYPE,
    company: $("company").value.trim(),
    contactName: $("contactName").value.trim(),
    title: $("title").value.trim(),
    email: $("email").value.trim(),
    country: $("country").value.trim(),
    markets: $("markets").value.trim(),
    phone1: $("phone1").value.trim(),
    phone2: $("phone2").value.trim(),
    website: $("website").value.trim(),
    social: $("social").value.trim(),
    productType: $("productType").value.trim(),
    productsOrNeeds: $("productsOrNeeds").value.trim(),
    notes: $("notes").value.trim(),
    followUpDate: $("followUpDate").value,
    priority: $("priority").value
  };
}

/* =========================
   SAVE TO APPS SCRIPT
   (Compatible with many Apps Script handlers using doPost)
========================= */
async function postToScript(payload) {
  const url = SETTINGS.scriptUrl || "";
  if (!url || !url.includes("/exec")) throw new Error("Apps Script URL not set.");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  // Some scripts return JSON, some return plain text
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(parsed?.message || text || `HTTP ${res.status}`);
  return parsed || { ok: true, raw: text };
}

async function saveLeadFlow(lead) {
  // Always cache locally first (unless user turned cache off)
  if (SETTINGS.cache === "on") {
    const leads = loadLeads();
    leads.unshift(lead);
    saveLeads(leads);
  }

  // If configured, push to Apps Script
  if (isConfigured()) {
    await postToScript({ action: "saveLead", lead });
  }
}

/* =========================
   DASHBOARD
========================= */
function renderDashboard() {
  const leads = loadLeads();
  $("kpiTotal").textContent = String(leads.length);

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth()+1).padStart(2,"0");
  const dd = String(today.getDate()).padStart(2,"0");
  const todayKey = `${yyyy}-${mm}-${dd}`;

  const savedToday = leads.filter(l => (l.createdAt || "").slice(0,10) === todayKey).length;
  $("kpiToday").textContent = String(savedToday);

  const dueCount = leads.filter(l => {
    if (!l.followUpDate) return false;
    const d = new Date(l.followUpDate);
    const diffDays = (d - new Date(todayKey)) / (1000*60*60*24);
    return diffDays >= 0 && diffDays <= 7;
  }).length;

  $("kpiDue").textContent = String(dueCount);

  const upcoming = leads
    .filter(l => l.followUpDate)
    .sort((a,b)=> (a.followUpDate||"").localeCompare(b.followUpDate||""))
    .slice(0,8);

  const box = $("dashUpcoming");
  box.innerHTML = "";
  if (!upcoming.length) {
    box.innerHTML = `<div class="item"><div class="muted small">No upcoming follow-ups.</div></div>`;
    return;
  }

  for (const l of upcoming) {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="item-top">
        <div>
          <div class="item-title">${escapeHtml(l.company || "(No company)")}</div>
          <div class="item-sub">${escapeHtml(l.contactName || "")} • ${escapeHtml(l.leadType || "")}</div>
        </div>
        <div class="item-actions">
          <span class="pill">Follow-up: ${escapeHtml(l.followUpDate)}</span>
          <span class="pill">${escapeHtml(l.priority || "")}</span>
        </div>
      </div>
    `;
    box.appendChild(el);
  }
}

/* =========================
   LEADS LIST
========================= */
function renderLeads() {
  const q = ($("leadSearch").value || "").trim().toLowerCase();
  const leads = loadLeads();
  const filtered = !q ? leads : leads.filter(l => {
    const hay = [
      l.company, l.contactName, l.email, l.country, l.phone1, l.phone2, l.productType, l.markets, l.leadType
    ].join(" ").toLowerCase();
    return hay.includes(q);
  });

  const box = $("leadsList");
  box.innerHTML = "";

  if (!filtered.length) {
    box.innerHTML = `<div class="item"><div class="muted small">No leads found.</div></div>`;
    return;
  }

  for (const l of filtered) {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="item-top">
        <div>
          <div class="item-title">${escapeHtml(l.company || "(No company)")}</div>
          <div class="item-sub">
            ${escapeHtml(l.contactName || "")}
            ${l.email ? " • " + escapeHtml(l.email) : ""}
            ${l.country ? " • " + escapeHtml(l.country) : ""}
          </div>
          <div class="item-sub">
            ${escapeHtml(l.leadType || "")}
            ${l.priority ? " • " + escapeHtml(l.priority) : ""}
            ${l.followUpDate ? " • Follow-up: " + escapeHtml(l.followUpDate) : ""}
          </div>
        </div>
        <div class="item-actions">
          <button class="btn btn-ghost btn-sm" data-act="copy" data-id="${l.id}">Copy</button>
          <button class="btn btn-danger btn-sm" data-act="delete" data-id="${l.id}">Delete</button>
        </div>
      </div>
    `;
    box.appendChild(el);
  }
}

function deleteLeadLocal(id) {
  const leads = loadLeads().filter(l => l.id !== id);
  saveLeads(leads);
  renderLeads();
  renderDashboard();
}

/* =========================
   CALENDAR (TASKS)
========================= */
function renderCalendar() {
  const tasks = loadTasks().sort((a,b)=> (a.due||"").localeCompare(b.due||""));
  const box = $("taskList");
  box.innerHTML = "";

  if (!tasks.length) {
    box.innerHTML = `<div class="item"><div class="muted small">No tasks yet.</div></div>`;
    return;
  }

  for (const t of tasks) {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="item-top">
        <div>
          <div class="item-title">${escapeHtml(t.title || "(Untitled)")}</div>
          <div class="item-sub">${t.company ? escapeHtml(t.company) + " • " : ""}${t.due ? "Due: " + escapeHtml(t.due) : "No due date"}</div>
        </div>
        <div class="item-actions">
          <button class="btn btn-ghost btn-sm" data-act="done" data-id="${t.id}">Done</button>
          <button class="btn btn-danger btn-sm" data-act="deleteTask" data-id="${t.id}">Delete</button>
        </div>
      </div>
    `;
    box.appendChild(el);
  }
}

function addTask() {
  const title = $("taskTitle").value.trim();
  const due = $("taskDue").value;
  const company = $("taskCompany").value.trim();

  if (!title) {
    setMsg($("calendarMsg"), "Please enter a task title.", "warn");
    return;
  }
  const t = {
    id: `T-${Date.now()}`,
    title,
    due,
    company,
    createdAt: new Date().toISOString()
  };

  const tasks = loadTasks();
  tasks.unshift(t);
  saveTasks(tasks);

  $("taskTitle").value = "";
  $("taskDue").value = "";
  $("taskCompany").value = "";

  setMsg($("calendarMsg"), "✅ Task added.", "success");
  renderCalendar();
  renderDashboard();
}

function deleteTask(id) {
  const tasks = loadTasks().filter(t => t.id !== id);
  saveTasks(tasks);
  renderCalendar();
  renderDashboard();
}

/* =========================
   QR SCANNER — FULL FIX
   - NO auto-start
   - state guards prevent re-open loop
   - hard stop + clear on close
========================= */
let __scannerActive = false;
let __scannerStarting = false;
let __lastScanAt = 0;
let __html5Qr = null;

function scannerOpenUI() { openModal("scannerModal"); }
function scannerCloseUI() { closeModal("scannerModal"); setMsg($("scanMsg"), ""); }

async function startScanner() {
  if (__scannerActive || __scannerStarting) return; // critical guard
  __scannerStarting = true;
  __scannerActive = true;

  scannerOpenUI();
  setMsg($("scanMsg"), "Starting camera…", "");

  if (!__html5Qr) __html5Qr = new Html5Qrcode("qrReader", false);

  try {
    const config = { fps: 10, qrbox: { width: 280, height: 280 }, rememberLastUsedCamera: true };

    await __html5Qr.start(
      { facingMode: "environment" },
      config,
      (decodedText) => {
        const now = Date.now();
        if (now - __lastScanAt < 1200) return; // debounce
        __lastScanAt = now;

        setMsg($("scanMsg"), "✅ QR detected. Filling fields…", "success");
        handleDecodedQR(decodedText);

        // stop & close immediately (prevents auto re-open)
        stopScanner(true).catch(()=>{});
      },
      (_err) => { /* ignore continuous scan errors */ }
    );

    setMsg($("scanMsg"), "Camera ON. Point at a QR code.", "");
  } catch (e) {
    console.error("Scanner start error:", e);
    setMsg($("scanMsg"), `Camera error: ${e.message || e}`, "error");
    await stopScanner(true);
  } finally {
    __scannerStarting = false;
  }
}

async function stopScanner(closeUI = false) {
  try {
    if (__html5Qr) {
      try { await __html5Qr.stop(); } catch (e) {}
      try { await __html5Qr.clear(); } catch (e) {}
    }
  } finally {
    __scannerActive = false;
    __scannerStarting = false;
    if (closeUI) scannerCloseUI();
  }
}

// vCard + JSON + plain fallback
function handleDecodedQR(text) {
  if (!text) return;

  if (/BEGIN:VCARD/i.test(text)) {
    const parsed = parseVCard(text);
    if (parsed.org) $("company").value = parsed.org;
    if (parsed.fn) $("contactName").value = parsed.fn;
    if (parsed.title) $("title").value = parsed.title;
    if (parsed.email) $("email").value = parsed.email;
    if (parsed.tel) $("phone1").value = parsed.tel;
    return;
  }

  // JSON QR
  try {
    const obj = JSON.parse(text);
    if (obj.company) $("company").value = obj.company;
    if (obj.name || obj.contactName) $("contactName").value = obj.name || obj.contactName;
    if (obj.title) $("title").value = obj.title;
    if (obj.email) $("email").value = obj.email;
    if (obj.phone) $("phone1").value = obj.phone;
    if (obj.country) $("country").value = obj.country;
    return;
  } catch {}

  // Fallback: append to notes
  const n = $("notes").value.trim();
  $("notes").value = (n ? n + "\n" : "") + `QR: ${text}`;
}

function parseVCard(vcardText) {
  const out = { fn:"", email:"", tel:"", org:"", title:"" };
  const lines = vcardText.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  for (const l of lines) {
    if (/^FN:/i.test(l)) out.fn = l.replace(/^FN:/i,"").trim();
    if (/^EMAIL/i.test(l)) out.email = l.split(":").slice(1).join(":").trim();
    if (/^TEL/i.test(l)) out.tel = l.split(":").slice(1).join(":").trim();
    if (/^ORG:/i.test(l)) out.org = l.replace(/^ORG:/i,"").trim();
    if (/^TITLE:/i.test(l)) out.title = l.replace(/^TITLE:/i,"").trim();
  }
  return out;
}

/* =========================
   MISC
========================= */
function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* =========================
   EVENT WIRING
========================= */
function bindEvents() {
  // Tabs
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });

  // Lead type toggle
  $("leadTypeSupplier").addEventListener("click", () => {
    LEAD_TYPE = "Supplier";
    $("leadTypeSupplier").classList.add("active");
    $("leadTypeBuyer").classList.remove("active");
  });
  $("leadTypeBuyer").addEventListener("click", () => {
    LEAD_TYPE = "Buyer";
    $("leadTypeBuyer").classList.add("active");
    $("leadTypeSupplier").classList.remove("active");
  });

  // Capture save
  $("leadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msgEl = $("captureMsg");
    setMsg(msgEl, "");

    const lead = buildLeadPayload();
    if (!lead.company) {
      setMsg(msgEl, "Company name is required.", "warn");
      return;
    }

    const btn = $("btnSaveLead");
    btn.disabled = true;
    btn.textContent = "Saving…";

    try {
      await saveLeadFlow(lead);
      setMsg(msgEl, "✅ Saved. (Local cache + Apps Script if configured)", "success");
      renderDashboard();
      renderLeads();
    } catch (err) {
      console.error(err);
      setMsg(msgEl, `❌ Save failed: ${err.message}`, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save Lead";
    }
  });

  $("btnClearLead").addEventListener("click", clearLeadForm);

  // Dashboard refresh
  $("btnRefreshDashboard").addEventListener("click", renderDashboard);

  // Leads actions
  $("leadSearch").addEventListener("input", renderLeads);
  $("leadsList").addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    const leads = loadLeads();
    const lead = leads.find(l => l.id === id);
    if (!lead) return;

    if (act === "delete") {
      deleteLeadLocal(id);
    }
    if (act === "copy") {
      const text =
`Company: ${lead.company || ""}
Contact: ${lead.contactName || ""}
Title: ${lead.title || ""}
Email: ${lead.email || ""}
Phone1: ${lead.phone1 || ""}
Country: ${lead.country || ""}
Lead Type: ${lead.leadType || ""}
Priority: ${lead.priority || ""}
Follow-up: ${lead.followUpDate || ""}
Products/Needs:
${lead.productsOrNeeds || ""}
Notes:
${lead.notes || ""}`.trim();

      try {
        await navigator.clipboard.writeText(text);
        alert("Copied lead to clipboard.");
      } catch {
        alert("Copy failed (browser blocked clipboard).");
      }
    }
  });

  $("btnExportJson").addEventListener("click", () => {
    const leads = loadLeads();
    const blob = new Blob([JSON.stringify(leads, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `boi-crm-leads-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $("btnClearLocal").addEventListener("click", () => {
    if (!confirm("Clear ALL locally saved leads?")) return;
    saveLeads([]);
    renderLeads();
    renderDashboard();
  });

  // Calendar tasks
  $("btnAddTask").addEventListener("click", addTask);
  $("btnClearTask").addEventListener("click", () => {
    $("taskTitle").value = "";
    $("taskDue").value = "";
    $("taskCompany").value = "";
    setMsg($("calendarMsg"), "");
  });
  $("btnRefreshCalendar").addEventListener("click", renderCalendar);
  $("taskList").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    if (act === "deleteTask" || act === "done") deleteTask(id);
  });

  // Settings
  $("btnOpenSettings").addEventListener("click", () => {
    $("settingScriptUrl").value = SETTINGS.scriptUrl || DEFAULT_SCRIPT_URL;
    $("settingUser").value = SETTINGS.user || "";
    $("settingCache").value = SETTINGS.cache || "on";
    setMsg($("settingsMsg"), "");
    openModal("settingsModal");
  });
  $("btnCloseSettings").addEventListener("click", () => closeModal("settingsModal"));
  $("settingsBackdrop").addEventListener("click", () => closeModal("settingsModal"));

  $("btnSaveSettings").addEventListener("click", () => {
    const scriptUrl = $("settingScriptUrl").value.trim();
    const user = $("settingUser").value.trim();
    const cache = $("settingCache").value;

    SETTINGS = { scriptUrl, user, cache };
    saveSettings(SETTINGS);
    refreshHeader();
    setMsg($("settingsMsg"), "✅ Settings saved.", "success");
  });

  $("btnResetSettings").addEventListener("click", () => {
    if (!confirm("Reset settings?")) return;
    SETTINGS = { scriptUrl: "", user: "", cache: "on" };
    saveSettings(SETTINGS);
    $("settingScriptUrl").value = "";
    $("settingUser").value = "";
    $("settingCache").value = "on";
    refreshHeader();
    setMsg($("settingsMsg"), "Settings reset.", "warn");
  });

  // User switch
  $("btnSwitchUser").addEventListener("click", () => {
    $("userInput").value = SETTINGS.user || "";
    setMsg($("userMsg"), "");
    openModal("userModal");
  });
  $("btnCloseUser").addEventListener("click", () => closeModal("userModal"));
  $("userBackdrop").addEventListener("click", () => closeModal("userModal"));
  $("btnSetUser").addEventListener("click", () => {
    const u = $("userInput").value.trim();
    if (!u) {
      setMsg($("userMsg"), "Enter a user name.", "warn");
      return;
    }
    SETTINGS.user = u;
    saveSettings(SETTINGS);
    refreshHeader();
    setMsg($("userMsg"), "✅ User updated.", "success");
  });

  // QR scanner buttons (IMPORTANT: NO AUTO START)
  $("btnScanQR").addEventListener("click", () => startScanner());
  $("btnStartScanner").addEventListener("click", () => startScanner());
  $("btnStopScanner").addEventListener("click", () => stopScanner(false));
  $("btnCloseScanner").addEventListener("click", () => stopScanner(true));
  $("scannerBackdrop").addEventListener("click", () => stopScanner(true));

  // Safety: close scanner when tab backgrounded
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopScanner(true).catch(()=>{});
  });

  // ESC closes any modal that’s open (scanner included)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("scannerModal").classList.contains("hidden")) stopScanner(true);
    if (!$("settingsModal").classList.contains("hidden")) closeModal("settingsModal");
    if (!$("userModal").classList.contains("hidden")) closeModal("userModal");
  });
}

/* =========================
   INIT
========================= */
(function init() {
  // Pre-fill settings with your URL (but allow user override)
  if (!SETTINGS.scriptUrl) SETTINGS.scriptUrl = DEFAULT_SCRIPT_URL;

  refreshHeader();
  bindEvents();
  showTab("capture");
  renderDashboard();
})();
