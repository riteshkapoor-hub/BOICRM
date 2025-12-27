const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzrHBqp6ZcS3lvRir9EchBhsldBS1jRghuQCWhj7XOY4nyuy8NRQP6mz3J1WGNYm-cD/exec";
const LS_SCRIPT_URL_KEY = "boi_crm_script_url";
const LS_USER_KEY = "boi_crm_user";

let mode = "supplier";
let entries = [];
let qr = null;

let chartCountry = null;
let chartOwner = null;
let cachedLeads = [];

const $ = (id) => document.getElementById(id);

function getScriptUrl(){ return localStorage.getItem(LS_SCRIPT_URL_KEY) || DEFAULT_SCRIPT_URL; }
function getUser(){ return localStorage.getItem(LS_USER_KEY) || ""; }

function setUser(name){
  localStorage.setItem(LS_USER_KEY, name);
  $("userPill").textContent = `User: ${name}`;
}

function ensureUser(){
  const u = getUser();
  if (u) {
    $("userOverlay").classList.remove("open");
    $("userOverlay").setAttribute("aria-hidden","true");
    setUser(u);
  } else {
    $("userOverlay").classList.add("open");
    $("userOverlay").setAttribute("aria-hidden","false");
  }
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
  if (!el) return;
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

/* ---- Tabs / Views ---- */
function setView(viewName){
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("isActive", b.dataset.view === viewName));
  $("viewCapture").style.display = viewName === "capture" ? "" : "none";
  $("viewDashboard").style.display = viewName === "dashboard" ? "" : "none";
  $("viewLeads").style.display = viewName === "leads" ? "" : "none";

  if (viewName === "dashboard") refreshDashboard();
  if (viewName === "leads") refreshLeads();
}

/* ---- Files ---- */
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

/* ---- QR ---- */
function openQr(){
  if (!window.Html5Qrcode){ alert("QR library failed to load."); return; }
  $("qrOverlay").classList.add("open");
  $("qrOverlay").setAttribute("aria-hidden","false");

  if (!qr) qr = new Html5Qrcode("qr-reader");

  qr.start(
    { facingMode:"environment" },
    { fps:10, qrbox:250 },
    (decodedText) => { applyScan(decodedText); closeQr(); },
    () => {}
  ).catch(()=>{
    alert("Could not start camera. Allow camera permission.");
    closeQr();
  });
}

function closeQr(){
  $("qrOverlay").classList.remove("open");
  $("qrOverlay").setAttribute("aria-hidden","true");
  if (qr){ try { qr.stop().catch(()=>{}); } catch {} }
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

/* ---- API ---- */
async function apiGet(action, params={}){
  const url = new URL(getScriptUrl());
  url.searchParams.set("action", action);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, String(v)));

  const res = await fetch(url.toString(), { method:"GET", mode:"cors" });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error("Server did not return JSON: " + text.slice(0,200)); }
  if (!json || json.result !== "success") throw new Error(json?.message || "GET failed");
  return json;
}

async function postEntry(payload){
  const url = getScriptUrl();
  setStatus("Saving…", null);
  log(`POST → ${url}`);

  try{
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
    try { json = JSON.parse(text); }
    catch { throw new Error("Server did not return JSON. Raw: " + text.slice(0, 200)); }

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

/* ---- Session table (right panel) ---- */
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

/* ---- Clear ---- */
function clearSupplier(){
  ["supCompany","supContact","supTitle","supEmail","supPhone","supPhone2","supWebsite","supSocial","supCountry","supProductType","supProducts","supExFactory","supFOB","supQR","supNotes"]
    .forEach(id => $(id).value = "");
  $("supCatalogFiles").value = "";
  $("supCardFile").value = "";
  $("supResult").innerHTML = "";
}

function clearBuyer(){
  ["buyContact","buyCompany","buyTitle","buyEmail","buyPhone","buyPhone2","buyWebsite","buySocial","buyCountry","buyMarkets","buyNeeds","buyPL","buyQR","buyNotes"]
    .forEach(id => $(id).value = "");
  $("buyCatalogFiles").value = "";
  $("buyCardFile").value = "";
  $("buyResult").innerHTML = "";
}

/* ---- Save ---- */
async function saveSupplier(closeAfter){
  const company = $("supCompany").value.trim();
  const items = $("supProducts").value.trim();
  if (!company || !items){ alert("Please fill Company name and What do they sell."); return; }

  const files = await collectFilesPayload("supCatalogFiles","supCardFile");

  const payload = {
    type: "supplier",
    enteredBy: getUser(),
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
  if (!contact || !items){ alert("Please fill Contact name and What do they want to buy."); return; }

  const files = await collectFilesPayload("buyCatalogFiles","buyCardFile");

  const payload = {
    type: "buyer",
    enteredBy: getUser(),
    company: $("buyCompany").value.trim(),
    contact,
    title: $("buyTitle").value.trim(),
    email: $("buyEmail").value.trim(),
    phone: $("buyPhone").value.trim(),
    phone2: $("buyPhone2").value.trim(),
    website: $("buyWebsite").value.trim(),
    social: $("buySocial").value.trim(),
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

/* ---- Dashboard ---- */
function topN(obj, n){
  return Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,n);
}

function renderChart(elId, labelPairs, existingChart){
  const labels = labelPairs.map(x=>x[0]);
  const data = labelPairs.map(x=>x[1]);

  const ctx = $(elId).getContext("2d");
  if (existingChart) existingChart.destroy();

  return new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Count", data }] },
    options: {
      responsive: true,
      plugins: { legend: { display:false } },
      scales: { x: { ticks: { color:"#cbd5e1" } }, y: { ticks: { color:"#cbd5e1" } } }
    }
  });
}

async function refreshDashboard(){
  try{
    setStatus("Loading dashboard…", null);
    const json = await apiGet("stats", { limit: 3000 });
    const s = json.stats;

    $("kpiTotal").textContent = s.total;
    $("kpiWeek").textContent = s.week;
    $("kpiToday").textContent = s.today;
    $("kpiSplit").textContent = `${s.buyers} / ${s.suppliers}`;

    chartCountry = renderChart("chartCountry", topN(s.byCountry, 8), chartCountry);
    chartOwner = renderChart("chartOwner", topN(s.byEnteredBy, 8), chartOwner);

    $("recentList").innerHTML = s.last10.map(r => {
      const t = r.ts ? new Date(r.ts).toLocaleString() : "";
      const title = `${escapeHtml(r.type||"")} · ${escapeHtml(r.contact||"")} · ${escapeHtml(r.company||"")}`;
      const meta = `${escapeHtml(r.country||"")} · Entered by ${escapeHtml(r.enteredBy||"") } · ${escapeHtml(t)}`;
      const link = r.folderUrl ? `<a href="${escapeHtml(r.folderUrl)}" target="_blank" rel="noopener">Drive Folder</a>` : "";
      return `<div class="recentItem">
        <div class="recentTop"><b>${title}</b><span class="muted mini">${link}</span></div>
        <div class="recentMeta">${meta}</div>
      </div>`;
    }).join("");

    setStatus("Dashboard loaded ✓", true);
  } catch (e){
    setStatus("Dashboard failed: " + e.message, false);
    log("DASH ERROR: " + e.message);
  }
}

/* ---- Leads ---- */
function renderLeadsTable(rows){
  const tbody = $("tblLeads").querySelector("tbody");
  tbody.innerHTML = "";

  rows.forEach(r => {
    const ts = r["Timestamp"] ? new Date(r["Timestamp"]).toLocaleString() : "";
    const drive = r["Folder URL"]
      ? `<a href="${escapeHtml(r["Folder URL"])}" target="_blank" rel="noopener">Open</a>`
      : "—";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(ts)}</td>
      <td>${escapeHtml(r["Type"]||"")}</td>
      <td>${escapeHtml(r["Contact"]||"")}</td>
      <td>${escapeHtml(r["Company"]||"")}</td>
      <td>${escapeHtml(r["Country"]||"")}</td>
      <td>${escapeHtml(r["Entered By"]||"")}</td>
      <td>${drive}</td>
    `;
    tbody.appendChild(tr);
  });

  $("leadCount").textContent = `${rows.length} leads shown`;
}

function applyLeadSearch(){
  const q = $("leadSearch").value.trim().toLowerCase();
  if (!q){
    renderLeadsTable(cachedLeads);
    return;
  }
  const filtered = cachedLeads.filter(r => {
    const hay = [
      r["Type"], r["Contact"], r["Company"], r["Country"], r["Entered By"],
      r["Email"], r["Phone"], r["Notes"]
    ].map(x=>String(x||"").toLowerCase()).join(" | ");
    return hay.includes(q);
  });
  renderLeadsTable(filtered);
}

async function refreshLeads(){
  try{
    setStatus("Loading leads…", null);
    const json = await apiGet("listLeads", { limit: 500 });
    cachedLeads = json.rows || [];
    renderLeadsTable(cachedLeads);
    setStatus("Leads loaded ✓", true);
  } catch (e){
    setStatus("Leads failed: " + e.message, false);
    log("LEADS ERROR: " + e.message);
  }
}

/* ---- Settings ---- */
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
  try{
    const j = await apiGet("ping");
    alert("Connection OK ✅ " + (j.message || ""));
  } catch(e){
    alert("Connection failed: " + e.message);
  }
}

/* ---- Init ---- */
window.addEventListener("DOMContentLoaded", () => {
  ensureUser();
  updateSummary();
  setStatus("", null);

  // tabs
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  // username modal actions
  $("startSession").addEventListener("click", () => {
    const name = $("usernameInput").value.trim();
    if (!name) { alert("Enter username"); return; }
    setUser(name);
    $("userOverlay").classList.remove("open");
    $("userOverlay").setAttribute("aria-hidden","true");
  });
  $("btnSwitchUser").addEventListener("click", () => {
    localStorage.removeItem(LS_USER_KEY);
    ensureUser();
  });

  // mode
  setMode("supplier");
  $("btnSupplier").addEventListener("click", () => setMode("supplier"));
  $("btnBuyer").addEventListener("click", () => setMode("buyer"));

  // save buttons
  $("saveSupplierNew").addEventListener("click", () => saveSupplier(false));
  $("saveSupplierClose").addEventListener("click", () => saveSupplier(true));
  $("clearSupplier").addEventListener("click", clearSupplier);

  $("saveBuyerNew").addEventListener("click", () => saveBuyer(false));
  $("saveBuyerClose").addEventListener("click", () => saveBuyer(true));
  $("clearBuyer").addEventListener("click", clearBuyer);

  // QR modal
  $("btnScan").addEventListener("click", openQr);
  $("btnCloseQr").addEventListener("click", closeQr);
  $("qrOverlay").addEventListener("click", (e) => { if (e.target.id === "qrOverlay") closeQr(); });

  // settings modal
  $("btnSettings").addEventListener("click", openSettings);
  $("closeSettings").addEventListener("click", closeSettings);
  $("saveSettings").addEventListener("click", saveSettings);
  $("testConnection").addEventListener("click", testConnection);
  $("settingsOverlay").addEventListener("click", (e) => { if (e.target.id === "settingsOverlay") closeSettings(); });

  // dashboard/leads
  $("btnRefreshDash").addEventListener("click", refreshDashboard);
  $("btnRefreshLeads").addEventListener("click", refreshLeads);
  $("leadSearch").addEventListener("input", applyLeadSearch);

  window.addEventListener("keydown", (e) => { if (e.key === "Escape"){ closeQr(); closeSettings(); } });

  log("Loaded. Script URL: " + getScriptUrl());
  // default view
  setView("capture");
});
