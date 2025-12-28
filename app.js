// BOI CRM — app.js (Dark + Combo boxes + Global Lists + FollowUps + IST)

const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzrHBqp6ZcS3lvRir9EchBhsldBS1jRghuQCWhj7XOY4nyuy8NRQP6mz3J1WGNYm-cD/exec";
const LS_SCRIPT_URL = "boi_crm_script_url";
const LS_USER = "boi_crm_user";

let leadType = "supplier";
let html5Qr = null;
let sessionCount = 0;

let GLOBAL_LISTS = { productTypes: [], markets: [] };

// last saved leadId for follow-ups
let lastSupplierLeadId = "";
let lastBuyerLeadId = "";

// ----- Country list + calling code map (core set; can expand anytime)
const COUNTRIES = [
  "India","United States","United Arab Emirates","Saudi Arabia","Qatar","Oman","Kuwait","Bahrain",
  "United Kingdom","Germany","France","Netherlands","Italy","Spain","Belgium","Sweden","Norway","Denmark",
  "Canada","Australia","New Zealand","Singapore","Malaysia","Indonesia","Thailand","Vietnam","Philippines",
  "Japan","South Korea","China","Hong Kong","Taiwan",
  "South Africa","Kenya","Nigeria","Egypt","Morocco",
  "Brazil","Mexico","Argentina","Chile",
  "Russia","Ukraine","Belarus","Poland","Czech Republic","Romania","Greece","Turkey"
];

const CALLING = {
  "India":"91",
  "United States":"1",
  "Canada":"1",
  "United Kingdom":"44",
  "United Arab Emirates":"971",
  "Saudi Arabia":"966",
  "Qatar":"974",
  "Oman":"968",
  "Kuwait":"965",
  "Bahrain":"973",
  "Germany":"49",
  "France":"33",
  "Netherlands":"31",
  "Italy":"39",
  "Spain":"34",
  "Belgium":"32",
  "Sweden":"46",
  "Norway":"47",
  "Denmark":"45",
  "Australia":"61",
  "New Zealand":"64",
  "Singapore":"65",
  "Malaysia":"60",
  "Indonesia":"62",
  "Thailand":"66",
  "Vietnam":"84",
  "Philippines":"63",
  "Japan":"81",
  "South Korea":"82",
  "China":"86",
  "Hong Kong":"852",
  "Taiwan":"886",
  "South Africa":"27",
  "Kenya":"254",
  "Nigeria":"234",
  "Egypt":"20",
  "Morocco":"212",
  "Brazil":"55",
  "Mexico":"52",
  "Argentina":"54",
  "Chile":"56",
  "Russia":"7",
  "Ukraine":"380",
  "Belarus":"375",
  "Poland":"48",
  "Czech Republic":"420",
  "Romania":"40",
  "Greece":"30",
  "Turkey":"90"
};

const $ = (id) => document.getElementById(id);

// ---------- URL / Session ----------
function getScriptUrl(){ return (localStorage.getItem(LS_SCRIPT_URL) || DEFAULT_SCRIPT_URL).trim(); }
function setStatus(msg){ $("status").textContent = msg || ""; }
function updateSummary(){ $("summary").textContent = `${sessionCount} leads this session`; }
function setUserPill(){
  const u = (localStorage.getItem(LS_USER)||"").trim();
  $("userPill").textContent = `User: ${u || "—"}`;
}
function openOverlay(id){ $(id).classList.add("open"); $(id).setAttribute("aria-hidden","false"); }
function closeOverlay(id){ $(id).classList.remove("open"); $(id).setAttribute("aria-hidden","true"); }
function ensureUser(){
  const u=(localStorage.getItem(LS_USER)||"").trim();
  if(u){ closeOverlay("userOverlay"); setUserPill(); return; }
  openOverlay("userOverlay"); setUserPill();
}

function showTab(which){
  ["Capture","Dashboard","Leads"].forEach(t=>{
    $(`tab${t}`).classList.toggle("isActive", t===which);
    $(`view${t}`).style.display = (t===which) ? "" : "none";
  });
  if(which==="Dashboard") refreshDashboard();
  if(which==="Leads") refreshLeads();
}

function showSupplier(){
  leadType="supplier";
  $("btnSupplier").classList.add("isActive");
  $("btnBuyer").classList.remove("isActive");
  $("cardSupplier").style.display="";
  $("cardBuyer").style.display="none";
}
function showBuyer(){
  leadType="buyer";
  $("btnBuyer").classList.add("isActive");
  $("btnSupplier").classList.remove("isActive");
  $("cardBuyer").style.display="";
  $("cardSupplier").style.display="none";
}

// ---------- IST label for session table ----------
function istNowLabel(){
  try{
    const d=new Date();
    return new Intl.DateTimeFormat("en-US", {
      timeZone:"Asia/Kolkata",
      month:"2-digit",day:"2-digit",year:"2-digit",
      hour:"2-digit",minute:"2-digit",hour12:true
    }).format(d);
  }catch{
    return new Date().toLocaleString();
  }
}

function addSessionRow(type, main, country){
  const tbody=$("tbl").querySelector("tbody");
  const tr=document.createElement("tr");
  tr.innerHTML = `<td>${esc(type)}</td><td>${esc(main)}</td><td>${esc(country||"")}</td><td>${esc(istNowLabel())}</td>`;
  tbody.prepend(tr);
}

function esc(s){
  return String(s||"")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

// ---------- Network ----------
async function postPayload(obj){
  setStatus("Saving…");
  const body = new URLSearchParams();
  body.set("payload", JSON.stringify(obj));

  const res = await fetch(getScriptUrl(), { method:"POST", body });
  const text = await res.text();
  let json;
  try{ json = JSON.parse(text); }
  catch{ throw new Error("Server did not return JSON: " + text.slice(0,160)); }
  if(json.result !== "success") throw new Error(json.message || "Request failed");
  setStatus("Saved ✓");
  return json;
}

async function getJson(url){
  const res = await fetch(url, { method:"GET" });
  const text = await res.text();
  let json;
  try{ json = JSON.parse(text); }
  catch{ throw new Error("Server did not return JSON: " + text.slice(0,160)); }
  if(json.result !== "success") throw new Error(json.message || "Request failed");
  return json;
}

async function loadGlobalLists(){
  const url = new URL(getScriptUrl());
  url.searchParams.set("action","lists");
  const data = await getJson(url.toString());
  GLOBAL_LISTS = data.lists || { productTypes: [], markets: [] };
}

// ---------- File uploads ----------
function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>{
      const s=String(r.result||"");
      resolve(s.includes("base64,") ? s.split("base64,")[1] : "");
    };
    r.onerror=reject;
    r.readAsDataURL(file);
  });
}

async function collectUploads(catalogInputId, cardInputId){
  const catalogFiles=[];
  const cat=$(catalogInputId);
  if(cat?.files?.length){
    for(const f of cat.files){
      catalogFiles.push({
        name:f.name,
        mimeType:f.type||"application/octet-stream",
        dataBase64: await fileToBase64(f)
      });
    }
  }
  let cardFile=null;
  const card=$(cardInputId);
  if(card?.files?.length){
    const f=card.files[0];
    cardFile={ name:f.name, mimeType:f.type||"image/jpeg", dataBase64: await fileToBase64(f) };
  }
  return { catalogFiles, cardFile };
}

// ---------- QR ----------
function parseVCard(text){
  const out={fullName:"",company:"",email:"",phone:""};
  const t=String(text||"").trim();
  if(!t.includes("BEGIN:VCARD")) return out;
  const lines=t.split(/\r?\n/);
  for(const l of lines){
    if(l.startsWith("FN:")) out.fullName=l.substring(3).trim();
    if(l.startsWith("ORG:")) out.company=l.substring(4).trim();
    if(l.startsWith("EMAIL")) out.email=(l.split(":")[1]||"").trim();
    if(l.startsWith("TEL") && !out.phone) out.phone=(l.split(":")[1]||"").trim();
  }
  return out;
}

function applyScan(raw){
  const p=parseVCard(raw);
  if(leadType==="supplier"){
    if(p.company && !$("supCompany").value) $("supCompany").value=p.company;
    if(p.fullName && !$("supContact").value) $("supContact").value=p.fullName;
    if(p.email && !$("supEmail").value) $("supEmail").value=p.email;
    if(p.phone && !$("supPhone").value) $("supPhone").value=p.phone;
    $("supQR").value=raw;
  }else{
    if(p.fullName && !$("buyContact").value) $("buyContact").value=p.fullName;
    if(p.company && !$("buyCompany").value) $("buyCompany").value=p.company;
    if(p.email && !$("buyEmail").value) $("buyEmail").value=p.email;
    if(p.phone && !$("buyPhone").value) $("buyPhone").value=p.phone;
    $("buyQR").value=raw;
  }
}

function openQr(){
  openOverlay("qrOverlay");
  if(!window.Html5Qrcode){ alert("QR library not loaded"); closeQr(); return; }
  if(!html5Qr) html5Qr = new Html5Qrcode("qr-reader");
  html5Qr.start(
    { facingMode:"environment" },
    { fps:10, qrbox:250 },
    (decodedText)=>{ applyScan(decodedText); closeQr(); },
    ()=>{}
  ).catch(err=>{
    console.error(err);
    alert("Could not start camera. Allow camera permission and try again.");
    closeQr();
  });
}
function closeQr(){
  closeOverlay("qrOverlay");
  if(html5Qr){ try{ html5Qr.stop().catch(()=>{}); }catch{} }
}

// ---------- Combo Box Component ----------
function createCombo(containerId, options, placeholder, allowEmptyLabel){
  const root = document.getElementById(containerId);
  root.classList.add("combo");

  const input = document.createElement("input");
  input.type="text";
  input.placeholder = placeholder || "";
  input.autocomplete="off";

  const btn = document.createElement("button");
  btn.type="button";
  btn.className="combo__btn";
  btn.textContent="▾";

  const list = document.createElement("div");
  list.className="combo__list";

  let value = ""; // selected exact value

  function open(){ root.classList.add("open"); render(input.value); }
  function close(){ root.classList.remove("open"); }
  function set(v){
    value = v || "";
    input.value = v || "";
    close();
    root.dispatchEvent(new CustomEvent("combo:change", { detail: { value } }));
  }
  function render(filter){
    list.innerHTML = "";
    const f = (filter||"").trim().toLowerCase();

    let filtered = options.slice();
    if(f) filtered = options.filter(x=> String(x).toLowerCase().includes(f));

    if(allowEmptyLabel){
      const it = document.createElement("div");
      it.className="combo__item";
      it.textContent = allowEmptyLabel;
      it.addEventListener("click", ()=> set(""));
      list.appendChild(it);
    }

    filtered.slice(0, 200).forEach(opt=>{
      const it=document.createElement("div");
      it.className="combo__item";
      it.textContent = opt;
      it.addEventListener("click", ()=> set(opt));
      list.appendChild(it);
    });

    if(!filtered.length){
      const it=document.createElement("div");
      it.className="combo__item";
      it.textContent = "No matches";
      it.style.opacity = "0.7";
      list.appendChild(it);
    }
  }

  input.addEventListener("focus", open);
  input.addEventListener("input", ()=>{ open(); render(input.value); });
  btn.addEventListener("click", ()=> root.classList.contains("open") ? close() : open());

  document.addEventListener("click",(e)=>{
    if(!root.contains(e.target)) close();
  });

  root.appendChild(input);
  root.appendChild(btn);
  root.appendChild(list);

  render("");

  return {
    get value(){ return value; },
    setValue(v){ set(v); },
    setOptions(newOpts){
      options = Array.from(new Set(newOpts.map(String).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
      render(input.value);
    },
    inputEl: input
  };
}

// ---------- Phone auto-fix with country code ----------
function digitsOnly(s){ return String(s||"").replace(/[^\d]/g,""); }

function formatPhoneWithCountry(countryName, raw){
  const cc = CALLING[countryName] || "";
  let num = digitsOnly(raw);

  if(!num) return "";

  // strip leading 00
  if(num.startsWith("00")) num = num.slice(2);

  // If already starts with country code, remove it and re-add with +
  if(cc && num.startsWith(cc)) num = num.slice(cc.length);

  // remove leading 0s (common local prefix)
  num = num.replace(/^0+/, "");

  return cc ? `+${cc} ${num}` : `+${num}`;
}

function wirePhoneAutoFix(countryCombo, phoneId1, phoneId2){
  const p1 = $(phoneId1);
  const p2 = $(phoneId2);

  function fix(){
    const c = countryCombo.value;
    if(c){
      if(p1.value.trim()) p1.value = formatPhoneWithCountry(c, p1.value);
      if(p2.value.trim()) p2.value = formatPhoneWithCountry(c, p2.value);
    }
  }

  // fix on blur (user finishes typing)
  p1.addEventListener("blur", fix);
  p2.addEventListener("blur", fix);

  // fix when country changes
  countryComboRoot(countryCombo).addEventListener("combo:change", fix);
}

function countryComboRoot(comboObj){
  // our combo object doesn't expose root; easiest: use input parent
  return comboObj.inputEl.parentElement;
}

// ---------- Global List Add (ProductType / Market) ----------
async function addGlobalListItem(listType, value){
  const createdBy = (localStorage.getItem(LS_USER)||"Unknown").trim() || "Unknown";
  await postPayload({ action:"addListItem", listType, value, createdBy });
  await loadGlobalLists();
  refreshAllCombos();
}

// ---------- Clear ----------
function clearSupplier(){
  ["supCompany","supContact","supTitle","supEmail","supPhone","supPhone2","supWebsite","supSocial",
   "supExFactory","supFOB","supProducts","supQR","supNotes"
  ].forEach(id=>$(id).value="");
  $("supPL").value="";
  $("supCatalogFiles").value="";
  $("supCardFile").value="";
  $("supResult").innerHTML="";
  $("supFULast").textContent="";
  // keep combos selected? clear:
  supCountry.setValue(""); supMarkets.setValue(""); supProductType.setValue("");
}
function clearBuyer(){
  ["buyContact","buyCompany","buyTitle","buyEmail","buyPhone","buyPhone2","buyWebsite","buySocial",
   "buyNeeds","buyQR","buyNotes"
  ].forEach(id=>$(id).value="");
  $("buyPL").value="";
  $("buyCatalogFiles").value="";
  $("buyCardFile").value="";
  $("buyResult").innerHTML="";
  $("buyFULast").textContent="";
  buyCountry.setValue(""); buyMarkets.setValue(""); buyProductType.setValue("");
}

// ---------- Save Lead ----------
async function saveSupplier(closeAfter){
  const company=$("supCompany").value.trim();
  const products=$("supProducts").value.trim();
  if(!company || !products){ alert("Fill Company and What do they sell."); return; }

  // phone fix on save too
  if(supCountry.value){
    if($("supPhone").value.trim()) $("supPhone").value = formatPhoneWithCountry(supCountry.value, $("supPhone").value);
    if($("supPhone2").value.trim()) $("supPhone2").value = formatPhoneWithCountry(supCountry.value, $("supPhone2").value);
  }

  const uploads = await collectUploads("supCatalogFiles","supCardFile");
  const enteredBy=(localStorage.getItem(LS_USER)||"Unknown").trim() || "Unknown";

  const payload={
    type:"supplier",
    enteredBy,
    company,
    contact:$("supContact").value.trim(),
    title:$("supTitle").value.trim(),
    email:$("supEmail").value.trim(),
    phone:$("supPhone").value.trim(),
    phone2:$("supPhone2").value.trim(),
    website:$("supWebsite").value.trim(),
    social:$("supSocial").value.trim(),
    country:supCountry.value,
    markets:supMarkets.value,
    privateLabel:$("supPL").value.trim(),
    productType:supProductType.value,
    productsOrNeeds:products,
    exFactory:$("supExFactory").value.trim(),
    fob:$("supFOB").value.trim(),
    qrData:$("supQR").value.trim(),
    notes:$("supNotes").value.trim(),
    catalogFiles:uploads.catalogFiles,
    cardFile:uploads.cardFile
  };

  const res = await postPayload(payload);

  $("supResult").innerHTML =
    `Lead ID: <b>${esc(res.leadId)}</b><br>` +
    `Drive folder: <a target="_blank" rel="noopener" href="${esc(res.folderUrl)}">Open folder</a><br>` +
    `Items sheet: <a target="_blank" rel="noopener" href="${esc(res.itemsSheetUrl)}">Open items</a>`;

  lastSupplierLeadId = res.leadId;

  sessionCount++; updateSummary();
  addSessionRow("Supplier", `${company}${payload.contact? " / "+payload.contact:""}`, payload.country);

  // refresh dashboard lists quickly (markets/product types might have changed)
  await loadGlobalLists();
  refreshAllCombos();

  clearSupplier();
  if(closeAfter) window.scrollTo({top:0,behavior:"smooth"});
}

async function saveBuyer(closeAfter){
  const contact=$("buyContact").value.trim();
  const needs=$("buyNeeds").value.trim();
  if(!contact || !needs){ alert("Fill Contact and What do they want to buy."); return; }

  if(buyCountry.value){
    if($("buyPhone").value.trim()) $("buyPhone").value = formatPhoneWithCountry(buyCountry.value, $("buyPhone").value);
    if($("buyPhone2").value.trim()) $("buyPhone2").value = formatPhoneWithCountry(buyCountry.value, $("buyPhone2").value);
  }

  const uploads = await collectUploads("buyCatalogFiles","buyCardFile");
  const enteredBy=(localStorage.getItem(LS_USER)||"Unknown").trim() || "Unknown";

  const payload={
    type:"buyer",
    enteredBy,
    contact,
    company:$("buyCompany").value.trim(),
    title:$("buyTitle").value.trim(),
    email:$("buyEmail").value.trim(),
    phone:$("buyPhone").value.trim(),
    phone2:$("buyPhone2").value.trim(),
    website:$("buyWebsite").value.trim(),
    social:$("buySocial").value.trim(),
    country:buyCountry.value,
    markets:buyMarkets.value,
    privateLabel:$("buyPL").value.trim(),
    productType:buyProductType.value,
    productsOrNeeds:needs,
    qrData:$("buyQR").value.trim(),
    notes:$("buyNotes").value.trim(),
    catalogFiles:uploads.catalogFiles,
    cardFile:uploads.cardFile
  };

  const res = await postPayload(payload);

  $("buyResult").innerHTML =
    `Lead ID: <b>${esc(res.leadId)}</b><br>` +
    `Drive folder: <a target="_blank" rel="noopener" href="${esc(res.folderUrl)}">Open folder</a><br>` +
    `Items sheet: <a target="_blank" rel="noopener" href="${esc(res.itemsSheetUrl)}">Open items</a>`;

  lastBuyerLeadId = res.leadId;

  sessionCount++; updateSummary();
  addSessionRow("Buyer", `${contact}${payload.company? " / "+payload.company:""}`, payload.country);

  await loadGlobalLists();
  refreshAllCombos();

  clearBuyer();
  if(closeAfter) window.scrollTo({top:0,behavior:"smooth"});
}

// ---------- Follow-up Scheduler ----------
function toIstStringFromInputs(dateVal, timeVal){
  // dateVal = YYYY-MM-DD, timeVal = HH:MM
  if(!dateVal || !timeVal) return "";
  const [y,m,d] = dateVal.split("-").map(n=>parseInt(n,10));
  const [hh,mm] = timeVal.split(":").map(n=>parseInt(n,10));

  // Create local date; we only need formatted in IST
  const dt = new Date(y, m-1, d, hh, mm, 0);

  // Format as IST MM/DD/YY hh:mm AM/PM
  try{
    return new Intl.DateTimeFormat("en-US", {
      timeZone:"Asia/Kolkata",
      month:"2-digit",day:"2-digit",year:"2-digit",
      hour:"2-digit",minute:"2-digit",hour12:true
    }).format(dt).replace(",", "");
  }catch{
    return dt.toLocaleString();
  }
}

async function addFollowUpForLead(leadId, dateId, timeId, notesId, outId){
  if(!leadId){
    alert("Save the lead first (so it has a Lead ID), then schedule follow-up.");
    return;
  }
  const dateVal = $(dateId).value;
  const timeVal = $(timeId).value;
  const notes = $(notesId).value.trim();
  const scheduledAtIST = toIstStringFromInputs(dateVal, timeVal);
  if(!scheduledAtIST){
    alert("Select follow-up date and time.");
    return;
  }

  const enteredBy=(localStorage.getItem(LS_USER)||"Unknown").trim() || "Unknown";

  await postPayload({
    action:"addFollowUp",
    leadId,
    scheduledAtIST,
    status:"Scheduled",
    notes,
    enteredBy
  });

  $(outId).textContent = `Follow-up scheduled: ${scheduledAtIST}`;
  $(dateId).value = "";
  $(timeId).value = "";
  $(notesId).value = "";

  // refresh dashboard
  if($("viewDashboard").style.display !== "none") refreshDashboard();
}

// ---------- Dashboard + Leads ----------
function setDashRow(tbody, r){
  const driveLink = r.folderUrl ? `<a target="_blank" rel="noopener" href="${esc(r.folderUrl)}">Open</a>` : "";
  const tr=document.createElement("tr");
  tr.innerHTML = `
    <td>${esc(r.timestampIST||"")}</td>
    <td>${esc(r.type||"")}</td>
    <td>${esc(r.productType||"")}</td>
    <td>${esc(r.markets||"")}</td>
    <td>${esc(r.enteredBy||"")}</td>
    <td>${esc((r.company||"") || (r.contact||""))}</td>
    <td>${esc(r.country||"")}</td>
    <td>${driveLink}</td>
    <td>${esc(r.leadId||"")}</td>
  `;
  tbody.appendChild(tr);
}

function setLeadRow(tbody, r){
  const driveLink = r.folderUrl ? `<a target="_blank" rel="noopener" href="${esc(r.folderUrl)}">Open</a>` : "";
  const tr=document.createElement("tr");
  tr.innerHTML = `
    <td>${esc(r.timestampIST||"")}</td>
    <td>${esc(r.type||"")}</td>
    <td>${esc(r.productType||"")}</td>
    <td>${esc(r.markets||"")}</td>
    <td>${esc(r.enteredBy||"")}</td>
    <td>${esc(r.company||"")}</td>
    <td>${esc(r.contact||"")}</td>
    <td>${esc(r.email||"")}</td>
    <td>${esc(r.phone||"")}</td>
    <td>${esc(r.country||"")}</td>
    <td>${driveLink}</td>
    <td>${esc(r.leadId||"")}</td>
  `;
  tbody.appendChild(tr);
}

function setFU.row(tbody, r){
  const tr=document.createElement("tr");
  tr.innerHTML = `
    <td>${esc(r.scheduledAtIST||"")}</td>
    <td>${esc(r.status||"")}</td>
    <td>${esc(r.type||"")}</td>
    <td>${esc((r.company||"") || (r.contact||""))}</td>
    <td>${esc(r.country||"")}</td>
    <td>${esc(r.markets||"")}</td>
    <td>${esc(r.productType||"")}</td>
    <td>${esc(r.enteredBy||"")}</td>
    <td>${esc(r.notes||"")}</td>
  `;
  tbody.appendChild(tr);
}

async function refreshDashboard(){
  try{
    setStatus("Loading dashboard…");

    const url = new URL(getScriptUrl());
    url.searchParams.set("action","listLeads");
    url.searchParams.set("limit","50");

    const user = $("filterUser").value.trim();
    const type = $("filterType").value.trim();
    if(user) url.searchParams.set("user", user);
    if(type) url.searchParams.set("type", type);

    if(dashCountry.value) url.searchParams.set("country", dashCountry.value);
    if(dashMarket.value) url.searchParams.set("market", dashMarket.value); // contains match
    if(dashPT.value) url.searchParams.set("productType", dashPT.value);

    const data = await getJson(url.toString());

    $("kpiTotal").textContent = data.kpis.total;
    $("kpiSup").textContent = data.kpis.suppliers;
    $("kpiBuy").textContent = data.kpis.buyers;
    $("kpiToday").textContent = data.kpis.today;

    const tbody = $("dashTable").querySelector("tbody");
    tbody.innerHTML="";
    data.rows.forEach(r=>setDashRow(tbody,r));

    // Follow-ups
    const fuUrl = new URL(getScriptUrl());
    fuUrl.searchParams.set("action","listFollowUps");
    fuUrl.searchParams.set("limit","50");
    if(dashCountry.value) fuUrl.searchParams.set("country", dashCountry.value);
    if(dashMarket.value) fuUrl.searchParams.set("market", dashMarket.value);
    if(dashPT.value) fuUrl.searchParams.set("productType", dashPT.value);

    const fuData = await getJson(fuUrl.toString());
    $("fuTotal").textContent = fuData.kpis.total;
    $("fuToday").textContent = fuData.kpis.dueToday;
    $("fuOver").textContent = fuData.kpis.overdue;
    $("fuUp").textContent = fuData.kpis.upcoming;

    const futBody = $("fuTable").querySelector("tbody");
    futBody.innerHTML="";
    fuData.rows.forEach(r=> setFUrow(futBody, r));

    $("dashNote").textContent = `Loaded ${data.rows.length} leads and ${fuData.rows.length} follow-ups.`;
    setStatus("Ready");
  }catch(e){
    console.error(e);
    setStatus("Dashboard failed");
    $("dashNote").textContent = e.message;
  }
}

async function refreshLeads(){
  try{
    setStatus("Loading leads…");
    const url = new URL(getScriptUrl());
    url.searchParams.set("action","listLeads");
    url.searchParams.set("limit","500");

    const q = $("searchLeads").value.trim();
    if(q) url.searchParams.set("q", q);

    if(leadsCountry.value) url.searchParams.set("country", leadsCountry.value);
    if(leadsMarket.value) url.searchParams.set("market", leadsMarket.value);
    if(leadsPT.value) url.searchParams.set("productType", leadsPT.value);

    const data = await getJson(url.toString());

    const tbody = $("leadsTable").querySelector("tbody");
    tbody.innerHTML="";
    data.rows.forEach(r=>setLeadRow(tbody,r));

    setStatus("Ready");
  }catch(e){
    console.error(e);
    setStatus("Leads failed");
    alert("Leads load failed: " + e.message);
  }
}

// ---------- Settings ----------
function openSettings(){
  $("scriptUrlInput").value = getScriptUrl();
  $("logBox").textContent = "";
  openOverlay("settingsOverlay");
}
function saveSettings(){
  const u=$("scriptUrlInput").value.trim();
  if(!u.endsWith("/exec")){ alert("Apps Script URL must end with /exec"); return; }
  localStorage.setItem(LS_SCRIPT_URL,u);
  $("logBox").textContent = `Saved:\n${u}`;
}
async function testSettings(){
  try{
    const url = new URL(getScriptUrl());
    url.searchParams.set("action","ping");
    const json = await getJson(url.toString());
    $("logBox").textContent = `Ping OK:\n${JSON.stringify(json,null,2)}`;
  }catch(e){
    $("logBox").textContent = `Ping failed:\n${e.message}`;
  }
}

// ---------- Combo instances ----------
let supCountry, buyCountry, supMarkets, buyMarkets, supProductType, buyProductType;
let dashCountry, dashMarket, dashPT;
let leadsCountry, leadsMarket, leadsPT;

function refreshAllCombos(){
  // update options
  const productTypes = GLOBAL_LISTS.productTypes || [];
  const markets = GLOBAL_LISTS.markets || [];

  supProductType.setOptions(productTypes);
  buyProductType.setOptions(productTypes);

  supMarkets.setOptions(markets);
  buyMarkets.setOptions(markets);

  dashPT.setOptions(productTypes);
  leadsPT.setOptions(productTypes);

  dashMarket.setOptions(markets);
  leadsMarket.setOptions(markets);
}

function attachAddButtons(){
  // Add Market buttons
  const supMarketsRoot = supMarkets.inputEl.parentElement;
  const buyMarketsRoot = buyMarkets.inputEl.parentElement;
  const supPTRoot = supProductType.inputEl.parentElement;
  const buyPTRoot = buyProductType.inputEl.parentElement;

  // add buttons injected
  function addPlus(root, label, onClick){
    const wrap = document.createElement("div");
    wrap.className = "combo__add";
    const b = document.createElement("button");
    b.type="button";
    b.className="btn btn--ghost btn--sm";
    b.textContent = label;
    b.addEventListener("click", onClick);
    wrap.appendChild(b);
    root.appendChild(wrap);
  }

  addPlus(supMarketsRoot, "+ Add Market", async ()=>{
    const v = prompt("Add new Market/Notes value (example: GCC, UAE, EU):");
    if(!v) return;
    await addGlobalListItem("market", v.trim());
  });
  addPlus(buyMarketsRoot, "+ Add Market", async ()=>{
    const v = prompt("Add new Market/Notes value:");
    if(!v) return;
    await addGlobalListItem("market", v.trim());
  });

  addPlus(supPTRoot, "+ Add Product Type", async ()=>{
    const v = prompt("Add new Product Type:");
    if(!v) return;
    await addGlobalListItem("productType", v.trim());
  });
  addPlus(buyPTRoot, "+ Add Product Type", async ()=>{
    const v = prompt("Add new Product Type:");
    if(!v) return;
    await addGlobalListItem("productType", v.trim());
  });
}

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", async ()=>{
  // tabs
  $("tabCapture").addEventListener("click", ()=>showTab("Capture"));
  $("tabDashboard").addEventListener("click", ()=>showTab("Dashboard"));
  $("tabLeads").addEventListener("click", ()=>showTab("Leads"));

  // lead type
  showSupplier();
  $("btnSupplier").addEventListener("click", showSupplier);
  $("btnBuyer").addEventListener("click", showBuyer);

  // QR
  $("btnScan").addEventListener("click", openQr);
  $("btnCloseQr").addEventListener("click", closeQr);
  $("qrOverlay").addEventListener("click",(e)=>{ if(e.target.id==="qrOverlay") closeQr(); });

  // settings
  $("btnSettings").addEventListener("click", openSettings);
  $("btnCloseSettings").addEventListener("click", ()=>closeOverlay("settingsOverlay"));
  $("btnSaveSettings").addEventListener("click", saveSettings);
  $("btnTestSettings").addEventListener("click", testSettings);
  $("settingsOverlay").addEventListener("click",(e)=>{ if(e.target.id==="settingsOverlay") closeOverlay("settingsOverlay"); });

  // user
  setUserPill();
  ensureUser();
  $("btnStartSession").addEventListener("click", ()=>{
    const name=$("usernameInput").value.trim();
    if(!name){ alert("Enter username"); return; }
    localStorage.setItem(LS_USER,name);
    setUserPill();
    closeOverlay("userOverlay");
  });
  $("btnSwitchUser").addEventListener("click", ()=>{
    localStorage.removeItem(LS_USER);
    $("usernameInput").value="";
    ensureUser();
  });

  // create combos
  supCountry = createCombo("supCountryCombo", COUNTRIES, "Search country…", "All countries");
  buyCountry = createCombo("buyCountryCombo", COUNTRIES, "Search country…", "All countries");

  // Markets/ProductType use global lists (loaded below)
  supMarkets = createCombo("supMarketsCombo", [], "Search market…", "All markets");
  buyMarkets = createCombo("buyMarketsCombo", [], "Search market…", "All markets");

  supProductType = createCombo("supProductTypeCombo", [], "Search product type…", "All product types");
  buyProductType = createCombo("buyProductTypeCombo", [], "Search product type…", "All product types");

  dashCountry = createCombo("dashCountryCombo", COUNTRIES, "Country filter…", "All countries");
  dashMarket = createCombo("dashMarketCombo", [], "Market filter…", "All markets");
  dashPT = createCombo("dashPTCombo", [], "Product type filter…", "All product types");

  leadsCountry = createCombo("leadsCountryCombo", COUNTRIES, "Country filter…", "All countries");
  leadsMarket = createCombo("leadsMarketCombo", [], "Market filter…", "All markets");
  leadsPT = createCombo("leadsPTCombo", [], "Product type filter…", "All product types");

  // phone auto-fix
  wirePhoneAutoFix(supCountry, "supPhone", "supPhone2");
  wirePhoneAutoFix(buyCountry, "buyPhone", "buyPhone2");

  // load global lists + update combos
  try{
    await loadGlobalLists();
  }catch(e){
    console.warn("Lists load failed, using fallback in UI", e);
    GLOBAL_LISTS = { productTypes:["Chips","Dehydrated powders","Sweeteners","Spices","Snacks","Private label"], markets:["GCC","UAE","EU","USA","India"] };
  }
  refreshAllCombos();
  attachAddButtons();

  // save buttons
  $("saveSupplierNew").addEventListener("click", ()=>saveSupplier(false));
  $("saveSupplierClose").addEventListener("click", ()=>saveSupplier(true));
  $("clearSupplier").addEventListener("click", clearSupplier);

  $("saveBuyerNew").addEventListener("click", ()=>saveBuyer(false));
  $("saveBuyerClose").addEventListener("click", ()=>saveBuyer(true));
  $("clearBuyer").addEventListener("click", clearBuyer);

  // followup buttons
  $("btnSupAddFU").addEventListener("click", ()=>addFollowUpForLead(lastSupplierLeadId, "supFUDate","supFUTime","supFUNotes","supFULast"));
  $("btnBuyAddFU").addEventListener("click", ()=>addFollowUpForLead(lastBuyerLeadId, "buyFUDate","buyFUTime","buyFUNotes","buyFULast"));

  // dashboard/leads refresh
  $("btnRefreshDash").addEventListener("click", refreshDashboard);
  $("btnRefreshLeads").addEventListener("click", refreshLeads);

  // esc closes modals
  window.addEventListener("keydown",(e)=>{
    if(e.key==="Escape"){
      closeQr();
      closeOverlay("settingsOverlay");
    }
  });

  setStatus("Ready");
  updateSummary();
});
