/* BOI CRM — frontend app.js (GitHub Pages) */
(() => {
  'use strict';

  // ====== Local config ======
  const LS = {
    scriptUrl: 'boi_crm_scriptUrl',
    user: 'boi_crm_user',
    session: 'boi_crm_session_leads'
  };

  // IMPORTANT: do NOT declare the same const twice. Keep a single default.
  const DEFAULT_SCRIPT_URL = ''; // leave blank; set in Settings UI

  // ====== Helpers ======
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const nowIsoDate = () => new Date().toISOString().slice(0,10);

  const readCfg = () => ({
    scriptUrl: localStorage.getItem(LS.scriptUrl) || DEFAULT_SCRIPT_URL,
    user: localStorage.getItem(LS.user) || ''
  });

  const setStatus = (el, msg, ok=null) => {
    if(!el) return;
    el.textContent = msg || '';
    el.classList.remove('ok','bad');
    if(ok === true) el.classList.add('ok');
    if(ok === false) el.classList.add('bad');
  };

  const safe = (v) => (v ?? '').toString().trim();

  const loadSession = () => {
    try { return JSON.parse(localStorage.getItem(LS.session) || '[]'); }
    catch { return []; }
  };
  const saveSession = (arr) => localStorage.setItem(LS.session, JSON.stringify(arr.slice(0,50)));

  const toast = (msg) => alert(msg);

  // ====== UI State ======
  let leadType = 'supplier';
  let editingLeadId = null;
  let leadsCache = [];
  let followupsCache = [];

  // ====== Datalists (countries) ======
  const COUNTRIES = [
    {name:'India', code:'+91'},
    {name:'United States', code:'+1'},
    {name:'United Arab Emirates', code:'+971'},
    {name:'Qatar', code:'+974'},
    {name:'Saudi Arabia', code:'+966'},
    {name:'Oman', code:'+968'},
    {name:'Kuwait', code:'+965'},
    {name:'Bahrain', code:'+973'},
    {name:'United Kingdom', code:'+44'},
    {name:'Germany', code:'+49'},
    {name:'France', code:'+33'},
    {name:'Netherlands', code:'+31'},
    {name:'Spain', code:'+34'},
    {name:'Italy', code:'+39'},
    {name:'Canada', code:'+1'},
    {name:'Australia', code:'+61'}
  ];

  function fillCountries(){
    const dl = $('#dlCountries');
    if(!dl) return;
    dl.innerHTML = COUNTRIES.map(c => `<option value="${c.name}"></option>`).join('');
  }

  function countryDialCode(name){
    const found = COUNTRIES.find(c => c.name.toLowerCase() === safe(name).toLowerCase());
    return found ? found.code : '';
  }

  function ensurePrefix(phoneEl, countryName){
    if(!phoneEl) return;
    const v = safe(phoneEl.value);
    if(!v) return;
    if(v.startsWith('+')) return;
    const code = countryDialCode(countryName);
    if(!code) return;
    phoneEl.value = `${code} ${v}`.trim();
  }

  // ====== Tabs ======
  function setTab(tab){
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.tabpanel').forEach(p => p.classList.add('hidden'));
    const panel = $(`#tab-${tab}`);
    if(panel) panel.classList.remove('hidden');

    if(tab === 'dashboard') refreshDashboard();
    if(tab === 'leads') refreshLeads();
    if(tab === 'calendar') refreshCalendar();
  }

  // ====== Overlay helpers ======
  function openOverlay(id){
    const o = $(id);
    if(!o) return;
    o.classList.remove('hidden');
    o.setAttribute('aria-hidden','false');
  }
  function closeOverlay(id){
    const o = $(id);
    if(!o) return;
    o.classList.add('hidden');
    o.setAttribute('aria-hidden','true');
  }

  // ====== Settings / User ======
  function applyHeader(){
    const cfg = readCfg();
    $('#sessionUser').textContent = cfg.user || '—';
    $('#connStatus').textContent = cfg.scriptUrl ? 'Configured' : 'Not configured';
  }

  async function apiPost(action, payload){
    const cfg = readCfg();
    if(!cfg.scriptUrl || !cfg.scriptUrl.endsWith('/exec')){
      throw new Error('Apps Script URL missing or not ending with /exec');
    }
    // Use x-www-form-urlencoded to avoid CORS preflight.
    const body = new URLSearchParams();
    body.set('action', action);
    body.set('payload', JSON.stringify(payload || {}));

    const res = await fetch(cfg.scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch(e){
      // helpful debug
      throw new Error('Server returned non-JSON: ' + text.slice(0,120));
    }
    if(!data.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function apiGet(action, payload){
    const cfg = readCfg();
    if(!cfg.scriptUrl || !cfg.scriptUrl.endsWith('/exec')){
      throw new Error('Apps Script URL missing or not ending with /exec');
    }
    const u = new URL(cfg.scriptUrl);
    u.searchParams.set('action', action);
    if(payload) u.searchParams.set('payload', JSON.stringify(payload));
    const res = await fetch(u.toString(), { method: 'GET' });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch{ throw new Error('Server returned non-JSON: ' + text.slice(0,120)); }
    if(!data.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // ====== QR scanning ======
  let qrScanner = null;
  async function openQr(){
    // require lead type chosen (it always is)
    if(typeof window.Html5Qrcode === 'undefined'){
      toast('QR library not loaded yet. Refresh and try again.');
      return;
    }
    openOverlay('#qrOverlay');
    setStatus($('#qrStatus'), 'Starting camera...', null);

    const readerId = 'qrReader';
    try{
      qrScanner = new Html5Qrcode(readerId);
      const cams = await Html5Qrcode.getCameras();
      if(!cams || !cams.length) throw new Error('No camera found');
      await qrScanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        (decodedText) => {
          $('#qrData').value = decodedText;
          fillFromQr(decodedText);
          closeQr();
        }
      );
      setStatus($('#qrStatus'), 'Scanning... (point at QR)', true);
    }catch(e){
      setStatus($('#qrStatus'), 'Camera error: ' + e.message, false);
    }
  }

  async function closeQr(){
    try{
      if(qrScanner){
        await qrScanner.stop();
        await qrScanner.clear();
      }
    }catch(_){}
    qrScanner = null;
    closeOverlay('#qrOverlay');
  }

  function parseVCard(text){
    // minimal vCard parsing for FN, ORG, EMAIL, TEL, TITLE, URL
    const lines = text.split(/\r?\n/);
    const out = {};
    for(const raw of lines){
      const line = raw.trim();
      const up = line.toUpperCase();
      if(up.startsWith('FN:')) out.contact = line.slice(3).trim();
      else if(up.startsWith('ORG:')) out.company = line.slice(4).trim();
      else if(up.startsWith('TITLE:')) out.title = line.slice(6).trim();
      else if(up.startsWith('EMAIL')) {
        const idx = line.indexOf(':');
        if(idx>-1) out.email = line.slice(idx+1).trim();
      } else if(up.startsWith('TEL')) {
        const idx = line.indexOf(':');
        if(idx>-1){
          const phone = line.slice(idx+1).trim();
          out.phone = out.phone || phone;
        }
      } else if(up.startsWith('URL:')) out.website = line.slice(4).trim();
    }
    return out;
  }

  function fillFromQr(text){
    if(!text) return;
    if(text.toUpperCase().includes('BEGIN:VCARD')){
      const v = parseVCard(text);
      if(v.company) $('#company').value = v.company;
      if(v.contact) $('#contact').value = v.contact;
      if(v.title) $('#title').value = v.title;
      if(v.email) $('#email').value = v.email;
      if(v.phone) $('#phone').value = v.phone;
      if(v.website) $('#website').value = v.website;
    }else{
      // if plain text, store only in qrData
    }
  }

  // ====== Capture form ======
  function setLeadType(t){
    leadType = t;
    $$('.pill').forEach(p => p.classList.toggle('active', p.dataset.leadtype === t));
    $('#productsLabel').textContent = t === 'supplier'
      ? 'What do they sell? (one per line) *'
      : 'What do they want to buy? (one per line) *';
    $('#productsOrNeeds').placeholder = t === 'supplier'
      ? 'Example:\nMango powder\nDehydrated onion flakes\nJaggery blocks'
      : 'Example:\nMango powder\nBanana chips\nJaggery';
  }

  function clearForm(keepType=true){
    if(!keepType) setLeadType('supplier');
    $('#leadForm').reset();
    $('#qrData').value = '';
    setStatus($('#saveStatus'), '');
  }

  async function fileToBase64(file){
    const buf = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for(let i=0;i<bytes.length;i+=chunk){
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i+chunk));
    }
    return btoa(binary);
  }

  async function collectPayload(){
    const cfg = readCfg();
    if(!cfg.user) throw new Error('Set user first (Switch User).');

    const country = safe($('#country').value);
    ensurePrefix($('#phone'), country);
    ensurePrefix($('#phone2'), country);

    const payload = {
      type: leadType,
      enteredBy: cfg.user,
      company: safe($('#company').value),
      contact: safe($('#contact').value),
      title: safe($('#title').value),
      email: safe($('#email').value),
      phone: safe($('#phone').value),
      phone2: safe($('#phone2').value),
      website: safe($('#website').value),
      social: safe($('#social').value),
      country,
      markets: safe($('#markets').value),
      privateLabel: safe($('#privateLabel').value),
      productType: safe($('#productType').value),
      productsOrNeeds: safe($('#productsOrNeeds').value),
      exFactory: safe($('#exFactory').value),
      fob: safe($('#fob').value),
      qrData: safe($('#qrData').value),
      notes: safe($('#notes').value),
      followup: null
    };

    // followup optional
    const fuOn = $('#fuEnabled').checked;
    const fuDate = safe($('#fuDate').value);
    const fuTime = safe($('#fuTime').value);
    const fuNote = safe($('#fuNote').value);
    if(fuOn && fuDate && fuTime){
      payload.followup = { date: fuDate, time: fuTime, note: fuNote };
    }

    // Files (optional)
    const card = $('#cardFile').files[0] || null;
    if(card){
      payload.cardFile = {
        name: card.name,
        mimeType: card.type || 'application/octet-stream',
        dataBase64: await fileToBase64(card)
      };
    }

    const catalogs = Array.from($('#catalogFiles').files || []);
    if(catalogs.length){
      payload.catalogFiles = [];
      for(const f of catalogs){
        payload.catalogFiles.push({
          name: f.name,
          mimeType: f.type || 'application/octet-stream',
          dataBase64: await fileToBase64(f)
        });
      }
    }

    return payload;
  }

  async function saveLead(mode){
    const st = $('#saveStatus');
    try{
      setStatus(st, 'Saving...', null);
      const payload = await collectPayload();
      if(!payload.company) throw new Error('Company name is required.');
      if(!payload.productsOrNeeds) throw new Error('Products / Needs is required.');

      const resp = await apiPost('saveLead', payload);

      // update session
      const session = loadSession();
      session.unshift({ type: payload.type, company: payload.company, time: resp.data.timeIst || '' });
      saveSession(session);
      renderSession();

      // refresh caches in background
      refreshLists().catch(()=>{});
      refreshDashboard().catch(()=>{});
      refreshLeads().catch(()=>{});
      refreshCalendar().catch(()=>{});

      setStatus(st, 'Saved ✓ (Folder created)', true);

      if(mode === 'new') clearForm(true);
      if(mode === 'close') setTab('dashboard');
    }catch(e){
      setStatus(st, 'Save failed: ' + e.message, false);
      toast('Save failed: ' + e.message);
    }
  }

  // ====== Lists for dropdowns ======
  async function refreshLists(){
    const data = await apiGet('getLists');
    const { productTypes, markets } = data.data;

    const dlPT = $('#dlProductTypes');
    if(dlPT) dlPT.innerHTML = (productTypes || []).map(x => `<option value="${escapeHtml(x)}"></option>`).join('');

    const dlM = $('#dlMarkets');
    if(dlM) dlM.innerHTML = (markets || []).map(x => `<option value="${escapeHtml(x)}"></option>`).join('');
  }

  function escapeHtml(s){
    return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  // ====== Dashboard ======
  async function refreshDashboard(){
    try{
      const f = {
        country: safe($('#dashCountry').value),
        productType: safe($('#dashProductType').value),
        markets: safe($('#dashMarkets').value)
      };
      const data = await apiGet('getDashboard', f);
      $('#kpiTotal').textContent = data.data.kpis.total;
      $('#kpiSup').textContent = data.data.kpis.suppliers;
      $('#kpiBuy').textContent = data.data.kpis.buyers;
      $('#kpiFU').textContent = data.data.kpis.upcomingFollowups;

      const tb = $('#tblUpcoming tbody');
      tb.innerHTML = '';
      (data.data.upcoming || []).forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(r.when)}</td>
          <td>${badge(r.type)}</td>
          <td>${escapeHtml(r.company)}</td>
          <td>${escapeHtml(r.contact)}</td>
          <td>${escapeHtml(r.note)}</td>
          <td>${r.calendarUrl ? `<a class="link" href="${r.calendarUrl}" target="_blank" rel="noopener">Open</a>` : '—'}</td>
        `;
        tb.appendChild(tr);
      });
    }catch(_){}
  }

  function badge(type){
    const t = (type||'').toLowerCase();
    const cls = t === 'supplier' ? 'sup' : 'buy';
    return `<span class="badge ${cls}">${escapeHtml(type)}</span>`;
  }

  // ====== Leads list & edit ======
  async function refreshLeads(){
    try{
      const data = await apiGet('getLeads');
      leadsCache = data.data.leads || [];
      renderLeads();
    }catch(e){
      // ignore
    }
  }

  function filterContains(value, needle){
    const v = safe(value).toLowerCase();
    const n = safe(needle).toLowerCase();
    if(!n) return true;
    return v.includes(n);
  }

  function renderLeads(){
    const tb = $('#tblLeads tbody');
    if(!tb) return;

    const fCountry = safe($('#leadCountry').value);
    const fPT = safe($('#leadProductType').value);
    const fMk = safe($('#leadMarkets').value);
    const q = safe($('#leadSearch').value);

    tb.innerHTML = '';
    const rows = leadsCache.filter(r =>
      filterContains(r.country, fCountry) &&
      filterContains(r.productType, fPT) &&
      filterContains(r.markets, fMk) &&
      (
        filterContains(r.company, q) ||
        filterContains(r.contact, q) ||
        filterContains(r.email, q) ||
        filterContains(r.notes, q)
      )
    );

    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(r.timeIst)}</td>
        <td>${badge(r.type)}</td>
        <td>${escapeHtml(r.company)}</td>
        <td>${escapeHtml(r.contact)}</td>
        <td>${escapeHtml(r.country)}</td>
        <td>${escapeHtml(r.productType)}</td>
        <td>${escapeHtml(r.markets)}</td>
        <td>${escapeHtml(r.enteredBy)}</td>
        <td>
          <button class="btn btn-outline btn-xs" data-edit="${escapeHtml(r.leadId)}">Edit</button>
          ${actionLinks(r)}
        </td>
      `;
      tb.appendChild(tr);
    });

    // bind edit clicks
    $$('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => openEdit(btn.getAttribute('data-edit')));
    });
  }

  function actionLinks(r){
    const phone = safe(r.phone).replace(/\s+/g,'');
    const email = safe(r.email);
    const links = [];
    if(phone){
      links.push(`<a class="link" href="tel:${encodeURIComponent(phone)}">Call</a>`);
      links.push(`<a class="link" href="https://wa.me/${encodeURIComponent(phone.replace('+',''))}" target="_blank" rel="noopener">WhatsApp</a>`);
    }
    if(email){
      links.push(`<a class="link" href="mailto:${encodeURIComponent(email)}">Email</a>`);
    }
    if(r.folderUrl){
      links.push(`<a class="link" href="${r.folderUrl}" target="_blank" rel="noopener">Drive</a>`);
    }
    return links.length ? `<span class="links">${links.join(' • ')}</span>` : '';
  }

  function openEdit(leadId){
    const r = leadsCache.find(x => x.leadId === leadId);
    if(!r) return;

    editingLeadId = leadId;
    $('#e_company').value = r.company || '';
    $('#e_contact').value = r.contact || '';
    $('#e_title').value = r.title || '';
    $('#e_email').value = r.email || '';
    $('#e_phone').value = r.phone || '';
    $('#e_phone2').value = r.phone2 || '';
    $('#e_website').value = r.website || '';
    $('#e_social').value = r.social || '';
    $('#e_country').value = r.country || '';
    $('#e_markets').value = r.markets || '';
    $('#e_productType').value = r.productType || '';
    $('#e_privateLabel').value = r.privateLabel || '';
    $('#e_exFactory').value = r.exFactory || '';
    $('#e_fob').value = r.fob || '';
    $('#e_productsOrNeeds').value = r.productsOrNeeds || '';
    $('#e_notes').value = r.notes || '';
    $('#e_fuEnabled').checked = false;
    $('#e_fuDate').value = '';
    $('#e_fuTime').value = '';
    $('#e_fuNote').value = '';
    setStatus($('#editStatus'), '');

    openOverlay('#editOverlay');
  }

  async function saveEdit(){
    const st = $('#editStatus');
    try{
      if(!editingLeadId) throw new Error('No lead selected');
      const payload = {
        leadId: editingLeadId,
        company: safe($('#e_company').value),
        contact: safe($('#e_contact').value),
        title: safe($('#e_title').value),
        email: safe($('#e_email').value),
        phone: safe($('#e_phone').value),
        phone2: safe($('#e_phone2').value),
        website: safe($('#e_website').value),
        social: safe($('#e_social').value),
        country: safe($('#e_country').value),
        markets: safe($('#e_markets').value),
        privateLabel: safe($('#e_privateLabel').value),
        productType: safe($('#e_productType').value),
        productsOrNeeds: safe($('#e_productsOrNeeds').value),
        exFactory: safe($('#e_exFactory').value),
        fob: safe($('#e_fob').value),
        notes: safe($('#e_notes').value),
        followup: null
      };
      if($('#e_fuEnabled').checked && $('#e_fuDate').value && $('#e_fuTime').value){
        payload.followup = {
          date: safe($('#e_fuDate').value),
          time: safe($('#e_fuTime').value),
          note: safe($('#e_fuNote').value)
        };
      }

      setStatus(st, 'Saving...', null);
      await apiPost('updateLead', payload);
      setStatus(st, 'Saved ✓', true);

      closeOverlay('#editOverlay');
      editingLeadId = null;
      await refreshLeads();
      await refreshCalendar();
      await refreshDashboard();
      await refreshLists();
    }catch(e){
      setStatus(st, 'Save failed: ' + e.message, false);
    }
  }

  // ====== Calendar ======
  async function refreshCalendar(){
    try{
      const from = $('#calFrom').value || '';
      const to = $('#calTo').value || '';
      const search = safe($('#calSearch').value);

      const data = await apiGet('getFollowups', { from, to, search });
      followupsCache = data.data.followups || [];
      renderCalendar();
    }catch(_){}
  }

  function renderCalendar(){
    const tb = $('#tblFollowups tbody');
    if(!tb) return;
    const search = safe($('#calSearch').value);

    tb.innerHTML = '';
    followupsCache
      .filter(r => !search || (safe(r.company+r.note+r.email).toLowerCase().includes(search.toLowerCase())))
      .forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(r.when)}</td>
          <td>${escapeHtml(r.company)}</td>
          <td>${badge(r.type)}</td>
          <td>${escapeHtml(r.note)}</td>
          <td>${r.calendarUrl ? `<a class="link" href="${r.calendarUrl}" target="_blank" rel="noopener">Open</a>` : '—'}</td>
        `;
        tb.appendChild(tr);
      });
  }

  // ====== Session table ======
  function renderSession(){
    const session = loadSession();
    $('#sessionCount').textContent = String(session.length || 0);
    const tb = $('#tblSession tbody');
    tb.innerHTML = '';
    session.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${badge(r.type)}</td><td>${escapeHtml(r.company)}</td><td>${escapeHtml(r.time)}</td>`;
      tb.appendChild(tr);
    });
  }

  // ====== Init ======
  function bind(){
    // Tabs
    $$('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

    // Lead type pills
    $$('.pill').forEach(p => p.addEventListener('click', () => setLeadType(p.dataset.leadtype)));

    // Scan
    $('#btnScanQr').addEventListener('click', openQr);
    $('#btnCloseQr').addEventListener('click', closeQr);

    // Capture actions
    $('#btnSaveNew').addEventListener('click', () => saveLead('new'));
    $('#btnSaveClose').addEventListener('click', () => saveLead('close'));
    $('#btnClear').addEventListener('click', () => clearForm(true));

    // Settings
    $('#btnSettings').addEventListener('click', () => {
      const cfg = readCfg();
      $('#cfgScriptUrl').value = cfg.scriptUrl || '';
      setStatus($('#settingsStatus'), '');
      openOverlay('#settingsOverlay');
    });
    $('#btnSettingsClose').addEventListener('click', () => closeOverlay('#settingsOverlay'));
    $('#btnSaveSettings').addEventListener('click', () => {
      const url = safe($('#cfgScriptUrl').value);
      localStorage.setItem(LS.scriptUrl, url);
      applyHeader();
      setStatus($('#settingsStatus'), 'Saved.', true);
      refreshLists().catch(()=>{});
      testConn().catch(()=>{});
    });
    $('#btnTestConn').addEventListener('click', () => testConn());

    // User
    $('#btnSwitchUser').addEventListener('click', () => {
      const cfg = readCfg();
      $('#cfgUser').value = cfg.user || '';
      openOverlay('#userOverlay');
    });
    $('#btnUserClose').addEventListener('click', () => closeOverlay('#userOverlay'));
    $('#btnSaveUser').addEventListener('click', () => {
      const u = safe($('#cfgUser').value);
      localStorage.setItem(LS.user, u);
      applyHeader();
      closeOverlay('#userOverlay');
    });

    // Dashboard
    $('#btnDashRefresh').addEventListener('click', refreshDashboard);

    // Leads
    $('#btnLeadsRefresh').addEventListener('click', refreshLeads);
    ['#leadCountry','#leadProductType','#leadMarkets','#leadSearch'].forEach(sel => {
      const el = $(sel);
      if(el) el.addEventListener('input', renderLeads);
    });

    // Calendar
    $('#btnCalRefresh').addEventListener('click', refreshCalendar);
    ['#calFrom','#calTo','#calSearch'].forEach(sel => {
      const el = $(sel);
      if(el) el.addEventListener('input', () => refreshCalendar());
    });

    // Country change => prefix phones
    $('#country').addEventListener('change', () => {
      const c = safe($('#country').value);
      if(c){
        const code = countryDialCode(c);
        if(code){
          if(!safe($('#phone').value)) $('#phone').value = code + ' ';
          if(!safe($('#phone2').value)) $('#phone2').value = code + ' ';
        }
      }
    });

    // Edit modal
    $('#btnEditClose').addEventListener('click', () => closeOverlay('#editOverlay'));
    $('#btnEditSave').addEventListener('click', saveEdit);

    // Set defaults
    $('#calFrom').value = nowIsoDate();
    const d = new Date(); d.setDate(d.getDate()+14);
    $('#calTo').value = d.toISOString().slice(0,10);
  }

  async function testConn(){
    try{
      setStatus($('#settingsStatus'), 'Testing...', null);
      const data = await apiGet('ping');
      $('#connStatus').textContent = 'Connected';
      setStatus($('#settingsStatus'), 'Connected ✓', true);
      // load lists too
      await refreshLists();
    }catch(e){
      $('#connStatus').textContent = 'Not connected';
      setStatus($('#settingsStatus'), 'Connection failed: ' + e.message, false);
    }
  }

  function wireProductsRequired(){
    // keep required for productsOrNeeds always
    $('#productsOrNeeds').setAttribute('required','required');
  }

  // Boot
  fillCountries();
  bind();
  wireProductsRequired();
  applyHeader();
  renderSession();

  // If configured, pull lists and data
  const cfg = readCfg();
  if(cfg.scriptUrl){
    testConn().catch(()=>{});
    refreshDashboard().catch(()=>{});
    refreshLeads().catch(()=>{});
    refreshCalendar().catch(()=>{});
  }

  // Expose for debugging
  window.BOICRM = { setTab };
})();
