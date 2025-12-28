// BOI CRM — Frontend (GitHub Pages)
// Uses hidden-iframe POST to Apps Script (no CORS), Apps Script responds with postMessage(JSON)

const STORAGE = {
  user: 'boi_user_name',
  scriptUrl: 'boi_script_url',
};

let state = {
  leadType: 'supplier', // supplier|buyer
  sessionLeads: [],
  allLeads: [],
  followups: [],
  lists: { countries: [], productTypes: [], markets: [] },
  configured: false,
};

function el(id){ return document.getElementById(id); }
function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }
function show(id){ el(id).classList.remove('hidden'); }
function hide(id){ el(id).classList.add('hidden'); }
function setStatus(msg){ el('statusText').textContent = msg; }

function normalizeScriptUrl(url){
  if(!url) return '';
  url = String(url).trim();
  // remove trailing whitespace or stray quotes
  url = url.replace(/^"+|"+$/g,'');
  // strip trailing slash
  url = url.replace(/\/+$/,'');
  return url;
}
function isExecUrl(url){
  url = normalizeScriptUrl(url);
  return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i.test(url);
}

function getUser(){ return localStorage.getItem(STORAGE.user) || ''; }
function setUser(v){ localStorage.setItem(STORAGE.user, v || ''); }
function getScriptUrl(){ return localStorage.getItem(STORAGE.scriptUrl) || ''; }
function setScriptUrl(v){ localStorage.setItem(STORAGE.scriptUrl, normalizeScriptUrl(v)); }

function refreshHeader(){
  const u = getUser();
  el('userNameLabel').textContent = u ? u : '—';
}

function setConfigured(ok){
  state.configured = ok;
  el('btnScan').disabled = !ok;
  setStatus(ok ? 'Ready' : 'Not configured');
}

function switchTab(tab){
  qsa('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  hide('tab-capture'); hide('tab-dashboard'); hide('tab-leads'); hide('tab-calendar');
  show('tab-'+tab);
  if(tab==='dashboard') renderDashboard();
  if(tab==='leads') renderLeads();
  if(tab==='calendar') renderCalendar();
}

function setLeadType(t){
  state.leadType = t;
  el('btnTypeSupplier').classList.toggle('active', t==='supplier');
  el('btnTypeBuyer').classList.toggle('active', t==='buyer');
  el('captureTitle').textContent = t==='supplier' ? 'Supplier details' : 'Buyer details';
  el('productsLabel').innerHTML = (t==='supplier' ? 'What do they sell?' : 'What do they want to buy?') + ' (one per line) <span class="req">*</span>';
  // Scan button only enabled after selecting type + configured
  el('btnScan').disabled = !state.configured || !t;
}

function resetForm(){
  ['company','contact','title','email','country','markets','phone1','phone2','website','social','productType','privateLabel','exFactory','fob','productsOrNeeds','qrData','notes'].forEach(id=>{
    const node = el(id);
    if(!node) return;
    if(node.tagName==='SELECT') node.value='';
    else node.value='';
  });
  el('catalogFiles').value = '';
  el('cardFile').value = '';
  el('followEnabled').checked = false;
  el('followDate').value = '';
  el('followTime').value = '';
  el('followNote').value = '';
}

function getFormData(){
  const lead = {
    type: state.leadType,
    enteredBy: getUser() || '',
    company: el('company').value.trim(),
    contact: el('contact').value.trim(),
    title: el('title').value.trim(),
    email: el('email').value.trim(),
    phone: el('phone1').value.trim(),
    phone2: el('phone2').value.trim(),
    website: el('website').value.trim(),
    social: el('social').value.trim(),
    country: el('country').value.trim(),
    markets: el('markets').value.trim(),
    privateLabel: el('privateLabel').value.trim(),
    productType: el('productType').value.trim(),
    productsOrNeeds: el('productsOrNeeds').value.trim(),
    exFactory: el('exFactory').value.trim(),
    fob: el('fob').value.trim(),
    qrData: el('qrData').value.trim(),
    notes: el('notes').value.trim(),
  };

  // follow-up (store only)
  const followEnabled = el('followEnabled').checked;
  const follow = followEnabled ? {
    date: el('followDate').value,
    time: el('followTime').value,
    note: el('followNote').value.trim(),
    durationMinutes: 30
  } : null;

  return { lead, follow };
}

function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    if(!file) return resolve(null);
    const r=new FileReader();
    r.onload=()=> resolve(String(r.result).split(',')[1] || '');
    r.onerror=()=> reject(r.error || new Error('File read error'));
    r.readAsDataURL(file);
  });
}

async function collectFiles(){
  const card = el('cardFile').files && el('cardFile').files[0] ? el('cardFile').files[0] : null;
  const catalogs = el('catalogFiles').files ? Array.from(el('catalogFiles').files) : [];
  const cardObj = card ? {
    name: card.name,
    mimeType: card.type || 'application/octet-stream',
    dataBase64: await fileToBase64(card),
  } : null;

  const catalogObjs = [];
  for(const f of catalogs){
    catalogObjs.push({
      name: f.name,
      mimeType: f.type || 'application/octet-stream',
      dataBase64: await fileToBase64(f),
    });
  }
  return { cardFile: cardObj, catalogFiles: catalogObjs };
}

// ---------- Apps Script bridge (no CORS) ----------
let pending = new Map();

function postToAppsScript(action, payload){
  return new Promise((resolve,reject)=>{
    const url = getScriptUrl();
    if(!isExecUrl(url)) return reject(new Error('Apps Script URL missing or not ending with /exec'));

    const id = 'req_' + Date.now() + '_' + Math.random().toString(16).slice(2);
    pending.set(id, { resolve, reject, t: Date.now() });

    const iframe = document.createElement('iframe');
    iframe.name = 'if_' + id;
    iframe.style.display = 'none';
    document.body.appendChild(iframe);

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    form.target = iframe.name;

    const add = (k,v)=>{
      const i=document.createElement('input');
      i.type='hidden';
      i.name=k;
      i.value=v;
      form.appendChild(i);
    };

    add('reqId', id);
    add('action', action);
    add('payload', JSON.stringify(payload || {}));

    document.body.appendChild(form);
    form.submit();
    form.remove();

    // timeout
    setTimeout(()=>{
      if(pending.has(id)){
        pending.delete(id);
        iframe.remove();
        reject(new Error('Request timeout'));
      }
    }, 45000);
  });
}

window.addEventListener('message', (ev)=>{
  const data = ev.data;
  if(!data || typeof data !== 'object') return;
  const { reqId, ok, result, error } = data;
  if(!reqId || !pending.has(reqId)) return;
  const p = pending.get(reqId);
  pending.delete(reqId);
  try{
    p.resolve({ ok, result, error });
  } catch(e){}
});

// ---------- Settings ----------
async function testConnection(){
  el('settingsMsg').textContent = '';
  const input = el('settingsScriptUrl').value;
  const url = normalizeScriptUrl(input);
  if(!isExecUrl(url)){
    el('settingsMsg').textContent = 'Connection failed: Apps Script URL missing or not ending with /exec';
    return false;
  }
  setScriptUrl(url);
  try{
    const res = await postToAppsScript('ping', { t: Date.now() });
    if(res.ok){
      el('settingsMsg').textContent = 'Connected ✓';
      setConfigured(true);
      // load lists & data
      await hydrateAll();
      return true;
    }
    el('settingsMsg').textContent = 'Connection failed: ' + (res.error || 'Unknown error');
    setConfigured(false);
    return false;
  }catch(err){
    el('settingsMsg').textContent = 'Connection failed: ' + (err.message || err);
    setConfigured(false);
    return false;
  }
}

function saveSettings(){
  const url = normalizeScriptUrl(el('settingsScriptUrl').value);
  if(!isExecUrl(url)){
    el('settingsMsg').textContent = 'Please paste a full /exec URL.';
    return;
  }
  setScriptUrl(url);
  el('settingsMsg').textContent = 'Saved ✓';
  setConfigured(true);
  hydrateAll().catch(()=>{});
}

// ---------- Data loading ----------
async function hydrateAll(){
  const res = await postToAppsScript('getAll', { });
  if(!res.ok) throw new Error(res.error || 'Failed to load');
  const { leads, followups, lists } = res.result || {};
  state.allLeads = Array.isArray(leads) ? leads : [];
  state.followups = Array.isArray(followups) ? followups : [];
  state.lists = lists || state.lists;
  renderDatalists();
  renderDashboard();
  renderLeads();
  renderCalendar();
}

function renderDatalists(){
  const fill = (id, arr)=>{
    const dl = el(id);
    if(!dl) return;
    dl.innerHTML = '';
    (arr||[]).forEach(v=>{
      const o=document.createElement('option');
      o.value=v;
      dl.appendChild(o);
    });
  };
  fill('dlCountries', state.lists.countries || []);
  fill('dlProductTypes', state.lists.productTypes || []);
  fill('dlMarkets', state.lists.markets || []);
}

// ---------- Save lead ----------
function showSaving(on){
  const s = el('savingIndicator');
  s.classList.toggle('show', !!on);
}

async function saveLead(closeAfter){
  // basic validation
  const { lead, follow } = getFormData();
  if(!lead.company){
    alert('Company name is required.');
    return;
  }
  if(!lead.productsOrNeeds){
    alert((state.leadType==='supplier'?'Products sold':'Products needed') + ' is required.');
    return;
  }
  if(!getUser()){
    alert('Please set a User (Switch button) before saving.');
    openUser();
    return;
  }
  if(!isExecUrl(getScriptUrl())){
    alert('Please set your Apps Script URL in Settings.');
    openSettings();
    return;
  }

  // collect files
  showSaving(true);
  try{
    const files = await collectFiles();
    const res = await postToAppsScript('saveLead', { lead, follow, files });
    if(!res.ok) throw new Error(res.error || 'Save failed');

    // update session list
    const saved = res.result && res.result.lead ? res.result.lead : lead;
    state.sessionLeads.unshift(saved);
    state.sessionLeads = state.sessionLeads.slice(0, 15);
    renderSession();

    // refresh global datasets
    await hydrateAll();

    if(closeAfter){
      // stay on capture but clear
      resetForm();
      alert('Saved ✓');
    }else{
      resetForm();
    }
  }catch(err){
    alert('Save failed: ' + (err.message || err));
  }finally{
    showSaving(false);
  }
}

function renderSession(){
  const tbody = el('sessionTable').querySelector('tbody');
  tbody.innerHTML='';
  state.sessionLeads.forEach(r=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(r.type||'')}</td>
      <td>${escapeHtml(r.company||'')}</td>
      <td>${escapeHtml(r.country||'')}</td>
      <td>${escapeHtml(r.timeIST||r.timestampIST||'')}</td>`;
    tbody.appendChild(tr);
  });
  el('sessionCount').textContent = `${state.sessionLeads.length} leads this session`;
}

function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'}[c]));
}

// ---------- Dashboard ----------
function filterMatch(row, f){
  if(!f) return true;
  const v = String(row||'').toLowerCase();
  return v.includes(String(f).toLowerCase());
}
function applyFilters(arr, prefix){
  const c = el(prefix+'Country').value.trim();
  const p = el(prefix+'ProductType').value.trim();
  const m = el(prefix+'Markets').value.trim();
  return (arr||[]).filter(r =>
    filterMatch(r.country, c) &&
    filterMatch(r.productType, p) &&
    filterMatch(r.markets, m)
  );
}

function renderDashboard(){
  if(!state.configured) return;
  const filtered = applyFilters(state.allLeads, 'f');
  el('kpiTotal').textContent = filtered.length;
  el('kpiSuppliers').textContent = filtered.filter(x=>String(x.type).toLowerCase()==='supplier').length;
  el('kpiBuyers').textContent = filtered.filter(x=>String(x.type).toLowerCase()==='buyer').length;

  // followups (no filters except match by lead fields)
  const follow = (state.followups||[]).filter(fu=>{
    const lead = state.allLeads.find(l=>l.leadId===fu.leadId) || {};
    return filterMatch(lead.country, el('fCountry').value.trim()) &&
           filterMatch(lead.productType, el('fProductType').value.trim()) &&
           filterMatch(lead.markets, el('fMarkets').value.trim());
  });

  el('kpiFollowups').textContent = follow.length;

  // upcoming followups table
  const tbody = el('followupsTable').querySelector('tbody');
  tbody.innerHTML='';
  follow.slice(0, 20).forEach(fu=>{
    const lead = state.allLeads.find(l=>l.leadId===fu.leadId) || {};
    const tr=document.createElement('tr');
    const cal = fu.calendarUrl ? `<a class="link" href="${fu.calendarUrl}" target="_blank">Open</a>` : '';
    tr.innerHTML = `<td>${escapeHtml(fu.whenIST||'')}</td>
      <td>${escapeHtml(lead.type||'')}</td>
      <td>${escapeHtml(lead.company||'')}</td>
      <td>${escapeHtml(fu.note||'')}</td>
      <td>${cal}</td>`;
    tbody.appendChild(tr);
  });

  // recent leads
  const tbody2 = el('recentLeadsTable').querySelector('tbody');
  tbody2.innerHTML='';
  filtered.slice(0, 20).forEach(l=>{
    const drive = l.folderUrl ? `<a class="link" href="${l.folderUrl}" target="_blank">Drive</a>` : '';
    const tr=document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(l.whenIST||l.timestampIST||'')}</td>
      <td>${escapeHtml(l.type||'')}</td>
      <td>${escapeHtml(l.company||'')}</td>
      <td>${escapeHtml(l.country||'')}</td>
      <td>${drive}</td>`;
    tbody2.appendChild(tr);
  });
}

// ---------- Leads ----------
function leadActionsHtml(l){
  const tel = l.phone ? `tel:${encodeURI(l.phone)}` : '';
  const wa = l.phone ? `https://wa.me/${encodeURIComponent(l.phone.replace(/\D/g,''))}` : '';
  const mail = l.email ? `mailto:${encodeURIComponent(l.email)}?subject=${encodeURIComponent('IndusFood follow-up')}` : '';
  const drive = l.folderUrl || '';
  const btn = (href, label)=> href ? `<a class="chip" href="${href}" target="_blank">${label}</a>` : '';
  return `<div class="chips">
    ${btn(tel,'Call')}
    ${btn(wa,'WhatsApp')}
    ${btn(mail,'Email')}
    ${btn(drive,'Drive')}
    <button class="chip" data-edit="${escapeHtml(l.leadId||'')}">Edit</button>
  </div>`;
}

function renderLeads(){
  if(!state.configured) return;
  const filtered = applyFilters(state.allLeads, 'l');
  const tbody = el('leadsTable').querySelector('tbody');
  tbody.innerHTML='';
  filtered.slice(0, 300).forEach(l=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(l.whenIST||l.timestampIST||'')}</td>
      <td>${escapeHtml(l.type||'')}</td>
      <td>${escapeHtml(l.company||'')}</td>
      <td>${escapeHtml(l.contact||'')}</td>
      <td>${escapeHtml(l.country||'')}</td>
      <td>${escapeHtml(l.productType||'')}</td>
      <td>${escapeHtml(l.markets||'')}</td>
      <td>${escapeHtml(l.enteredBy||'')}</td>
      <td>${leadActionsHtml(l)}</td>`;
    tbody.appendChild(tr);
  });

  // attach edit handlers
  tbody.querySelectorAll('button[data-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=> openEdit(btn.getAttribute('data-edit')));
  });
}

// simple chips css injection via class names in existing css (add minimal here)
(function injectChipCss(){
  const st=document.createElement('style');
  st.textContent = `
  .chips{ display:flex; gap:6px; flex-wrap:wrap; }
  .chip{ border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.03); color:rgba(230,237,247,.9);
    padding:6px 10px; border-radius:999px; font-size:12px; cursor:pointer; text-decoration:none; }
  .chip:hover{ background:rgba(59,130,246,.08); }
  a.link{ color: rgba(147,197,253,.95); text-decoration:none; }
  a.link:hover{ text-decoration:underline; }
  `;
  document.head.appendChild(st);
})();

async function refreshLeads(){
  try{
    await hydrateAll();
  }catch(e){
    alert('Refresh failed: ' + (e.message||e));
  }
}

// ---------- Edit lead (simple prompt-based to keep UI minimal) ----------
async function openEdit(leadId){
  const lead = state.allLeads.find(x=>x.leadId===leadId);
  if(!lead) return;
  const newNotes = prompt('Update notes for: ' + lead.company, lead.notes||'');
  if(newNotes === null) return;
  const updated = { leadId, notes: newNotes };
  try{
    showSaving(true);
    const res = await postToAppsScript('updateLead', { updated });
    if(!res.ok) throw new Error(res.error||'Update failed');
    await hydrateAll();
    alert('Updated ✓');
  }catch(e){
    alert('Update failed: ' + (e.message||e));
  }finally{
    showSaving(false);
  }
}

// ---------- Calendar ----------
function renderCalendar(){
  if(!state.configured) return;

  const tbody = el('calendarTable').querySelector('tbody');
  tbody.innerHTML='';
  (state.followups||[]).slice(0,300).forEach(fu=>{
    const lead = state.allLeads.find(l=>l.leadId===fu.leadId) || {};
    const cal = fu.calendarUrl ? `<a class="link" href="${fu.calendarUrl}" target="_blank">Open</a>` : '';
    const tr=document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(fu.whenIST||'')}</td>
      <td>${escapeHtml(lead.company||'')}</td>
      <td>${escapeHtml(lead.type||'')}</td>
      <td>${escapeHtml(fu.note||'')}</td>
      <td>${cal}</td>`;
    tbody.appendChild(tr);
  });
}

// ---------- QR scanning ----------
function openQr(){
  show('qrOverlay');
  el('qrMsg').textContent = '';
  ensureQrLibrary()
    .then(()=> startQr())
    .catch(err=>{
      el('qrMsg').textContent = String(err.message||err);
      alert('QR library not loaded yet. Refresh and try again.');
    });
}
function closeQr(){
  stopQr().finally(()=> hide('qrOverlay'));
}

function ensureQrLibrary(){
  // Already loaded?
  if(window.Html5Qrcode) return Promise.resolve(true);

  return new Promise((resolve,reject)=>{
    const sources = [
      'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.10/minified/html5-qrcode.min.js',
      'https://unpkg.com/html5-qrcode@2.3.10/minified/html5-qrcode.min.js'
    ];
    let idx=0;

    const loadNext=()=>{
      if(idx>=sources.length) return reject(new Error('Unable to load QR library (CDN blocked).'));
      const src=sources[idx++];
      const s=document.createElement('script');
      s.src=src;
      s.async=true;
      s.onload=()=> window.Html5Qrcode ? resolve(true) : loadNext();
      s.onerror=()=> loadNext();
      document.head.appendChild(s);
    };
    loadNext();
  });
}

let qr = null;

async function startQr(){
  if(!window.Html5Qrcode) throw new Error('QR library not loaded.');
  const regionId = 'qrReader';
  el(regionId).innerHTML = '';
  qr = new Html5Qrcode(regionId);
  const cfg = { fps: 10, qrbox: { width: 260, height: 260 } };

  try{
    await qr.start(
      { facingMode: "environment" },
      cfg,
      (decodedText)=>{
        // fill QR raw
        el('qrData').value = decodedText;
        // Try parse vCard
        autofillFromVCard(decodedText);
        el('qrMsg').textContent = 'Captured ✓';
        // stop after first scan
        closeQr();
      },
      ()=>{}
    );
  }catch(e){
    el('qrMsg').textContent = 'Camera error: ' + (e.message||e);
    throw e;
  }
}

async function stopQr(){
  try{
    if(qr){
      await qr.stop();
      await qr.clear();
    }
  }catch(e){}
  qr = null;
}

function autofillFromVCard(text){
  if(!text || !/BEGIN:VCARD/i.test(text)) return;
  // basic vCard parse
  const lines = text.split(/\r?\n/);
  const get = (prefix)=>{
    const line = lines.find(l=>l.toUpperCase().startsWith(prefix));
    if(!line) return '';
    return line.split(':').slice(1).join(':').trim();
  };
  const fn = get('FN');
  const org = get('ORG');
  const email = get('EMAIL');
  const tel = get('TEL');
  if(fn && !el('contact').value) el('contact').value = fn;
  if(org && !el('company').value) el('company').value = org;
  if(email && !el('email').value) el('email').value = email;
  if(tel && !el('phone1').value) el('phone1').value = tel;
}

// ---------- Phone auto-prefix ----------
function countryDialCode(country){
  // minimal mapping; backend also normalizes
  const map = {
    'India': '+91',
    'United States': '+1',
    'USA': '+1',
    'United Arab Emirates': '+971',
    'UAE': '+971',
    'Qatar': '+974',
    'Saudi Arabia': '+966',
    'United Kingdom': '+44'
  };
  return map[country] || '+91';
}
function normalizePhone(phone, country){
  phone = String(phone||'').trim();
  if(!phone) return '';
  if(phone.startsWith('+')) return phone;
  const code = countryDialCode(country || el('country').value.trim());
  const digits = phone.replace(/[^\d]/g,'');
  return code + digits;
}

function attachPhoneHandlers(){
  const fix = ()=>{
    const c = el('country').value.trim();
    el('phone1').value = normalizePhone(el('phone1').value, c);
    el('phone2').value = normalizePhone(el('phone2').value, c);
  };
  el('phone1').addEventListener('blur', fix);
  el('phone2').addEventListener('blur', fix);
  el('country').addEventListener('change', fix);
}

// ---------- Modals ----------
function openSettings(){
  el('settingsScriptUrl').value = getScriptUrl();
  show('settingsOverlay');
}
function closeSettings(){ hide('settingsOverlay'); }
function openUser(){
  el('userNameInput').value = getUser();
  show('userOverlay');
}
function closeUser(){ hide('userOverlay'); }

// ---------- Init ----------
function init(){
  refreshHeader();

  // tabs
  qsa('.tab').forEach(b=> b.addEventListener('click', ()=> switchTab(b.dataset.tab)));

  // lead type
  el('btnTypeSupplier').addEventListener('click', ()=> setLeadType('supplier'));
  el('btnTypeBuyer').addEventListener('click', ()=> setLeadType('buyer'));

  // scan
  el('btnScan').addEventListener('click', ()=>{
    if(!state.leadType){ alert('Select Supplier or Buyer first.'); return; }
    if(!state.configured){ alert('Set Apps Script URL in Settings first.'); openSettings(); return; }
    openQr();
  });
  el('btnCloseQr').addEventListener('click', closeQr);

  // settings
  el('btnSettings').addEventListener('click', openSettings);
  el('btnCloseSettings').addEventListener('click', closeSettings);
  el('btnSaveSettings').addEventListener('click', saveSettings);
  el('btnTest').addEventListener('click', testConnection);

  // user
  el('btnSwitchUser').addEventListener('click', openUser);
  el('btnCloseUser').addEventListener('click', closeUser);
  el('btnSaveUser').addEventListener('click', ()=>{
    setUser(el('userNameInput').value.trim());
    refreshHeader();
    closeUser();
    // refresh status
    setConfigured(!!getUser() && isExecUrl(getScriptUrl()));
  });

  // actions
  el('btnClear').addEventListener('click', resetForm);
  el('btnSaveNew').addEventListener('click', ()=> saveLead(false));
  el('btnSaveClose').addEventListener('click', ()=> saveLead(true));

  // dashboard filters
  el('btnClearFilters').addEventListener('click', ()=>{
    ['fCountry','fProductType','fMarkets'].forEach(id=> el(id).value='');
    renderDashboard();
  });
  ['fCountry','fProductType','fMarkets'].forEach(id=> el(id).addEventListener('input', renderDashboard));
  ['lCountry','lProductType','lMarkets'].forEach(id=> el(id).addEventListener('input', renderLeads));
  el('btnRefreshLeads').addEventListener('click', refreshLeads);

  // calendar view toggles (agenda only implemented in this stable build)
  el('calViewAgenda').addEventListener('click', ()=>{
    el('calViewAgenda').classList.add('active'); el('calViewWeek').classList.remove('active'); el('calViewMonth').classList.remove('active');
    show('calAgenda'); hide('calGrid');
  });
  el('calViewWeek').addEventListener('click', ()=>{
    alert('Week view UI is queued next. Agenda view is stable for now.');
  });
  el('calViewMonth').addEventListener('click', ()=>{
    alert('Month view UI is queued next. Agenda view is stable for now.');
  });

  attachPhoneHandlers();
  setLeadType('supplier');

  // config check
  const ok = !!getUser() && isExecUrl(getScriptUrl());
  setConfigured(ok);
  if(ok){
    hydrateAll().catch(()=>{});
  }
}

document.addEventListener('DOMContentLoaded', init);
