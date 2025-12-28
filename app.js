(() => {
  // =====================
  // Storage + State
  // =====================
  const LS = {
    scriptUrl: 'boi_script_url',
    user: 'boi_user',
  };

  const state = {
    leadType: 'supplier',
    sessionLeads: [],
    lists: { countries: [], productTypes: [], markets: [] },
    configured: false,
    scriptUrl: '',
    user: '',
    calendar: { anchor: startOfWeek(new Date()), followups: [] },
  };

  // =====================
  // Helpers
  // =====================
  const $ = (id) => document.getElementById(id);
  const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isExecUrl = (u='') => /^https:\/\/script\.google\.com\/macros\/s\/[^\/]+\/exec$/i.test(u.trim());
  function setOverlay(el, open){
    el.classList.toggle('open', !!open);
    el.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  function startOfWeek(d){
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7; // Mon=0
    x.setHours(0,0,0,0);
    x.setDate(x.getDate() - day);
    return x;
  }

  function fmtIST(date){
    // MM/DD/YY hh:mm AM/PM in IST
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: '2-digit', month: '2-digit', day: '2-digit',
      hour: 'numeric', minute: '2-digit', hour12: true
    });
    return dtf.format(date);
  }

  function normalizePhone(raw, country){
    const v = (raw||'').trim();
    if (!v) return '';
    if (v.startsWith('+')) return v;
    const digits = v.replace(/[^0-9]/g,'');
    if (!digits) return '';
    // fallback +91 as you requested
    const prefix = countryCodeFor(country) || '+91';
    return prefix + digits;
  }

  function countryCodeFor(country){
    // map from Lists sheet values like: "India (+91)" or just "India"
    const c = (country||'').trim();
    if (!c) return '';
    const m = c.match(/\(\+\d+\)/);
    if (m) return m[1];
    // quick hard default for India/US if not tagged
    const low = c.toLowerCase();
    if (low.includes('india')) return '+91';
    if (low.includes('united states') || low === 'usa') return '+1';
    return '';
  }

  function buildDatalist(elId, values){
    const dl = $(elId);
    if (!dl) return;
    dl.innerHTML = values.map(v => `<option value="${esc(v)}"></option>`).join('');
  }

  // =====================
  // Iframe POST bridge (no CORS)
  // =====================
  let iframe, iframeName, lastReqId = 0;

  function ensureIframe(){
    if (iframe) return;
    iframeName = 'boi_iframe_' + Math.random().toString(16).slice(2);
    iframe = document.createElement('iframe');
    iframe.name = iframeName;
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
  }

  function postToScript(action, data){
    return new Promise((resolve, reject) => {
      if (!state.scriptUrl || !isExecUrl(state.scriptUrl)) {
        reject(new Error('Apps Script URL missing or not ending with /exec'));
        return;
      }
      ensureIframe();
      const reqId = String(++lastReqId);

      const form = document.createElement('form');
      form.method = 'POST';
      form.action = state.scriptUrl;
      form.target = iframeName;

      const payload = {
        reqId,
        action,
        data
      };

      const inp = document.createElement('input');
      inp.type = 'hidden';
      inp.name = 'payload';
      inp.value = JSON.stringify(payload);
      form.appendChild(inp);

      document.body.appendChild(form);

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Request timed out.'));
      }, 20000);

      function onMsg(ev){
        // accept from any origin; validate payload
        try{
          const msg = ev.data;
          if (!msg || typeof msg !== 'object') return;
          if (msg.reqId !== reqId) return;
          window.removeEventListener('message', onMsg);
          clearTimeout(timeout);
          cleanup();
          if (msg.ok) resolve(msg);
          else reject(new Error(msg.error || 'Request failed'));
        }catch(e){}
      }

      function cleanup(){
        if (form && form.parentNode) form.parentNode.removeChild(form);
      }

      window.addEventListener('message', onMsg);
      form.submit();
    });
  }

  async function testConnection(){
    // ping through iframe + postMessage
    const r = await postToScript('ping', {});
    return r;
  }

  // =====================
  // QR Scan (html5-qrcode)
  // =====================
  let qrScanner = null;
  let qrLibReady = false;

  async function loadQrLib(){
    if (qrLibReady) return true;

    // Try jsDelivr versioned first, then unpkg versioned
    const candidates = [
      'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.10/minified/html5-qrcode.min.js',
      'https://unpkg.com/html5-qrcode@2.3.10/minified/html5-qrcode.min.js'
    ];

    for (const src of candidates){
      try{
        await loadScript(src);
        if (window.Html5Qrcode) { qrLibReady = true; return true; }
      }catch(e){}
    }
    return false;
  }

  function loadScript(src){
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve(true);
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  async function openQr(){
    if (!state.leadType) { alert('Select Supplier or Buyer first.'); return; }

    const ok = await loadQrLib();
    if (!ok) { alert('QR library not loaded yet. Please refresh and try again.'); return; }

    setOverlay($('qrOverlay'), true);

    $('qrHint').textContent = 'Starting camera…';
    await sleep(50);

    try{
      if (!qrScanner) qrScanner = new window.Html5Qrcode('qrReader');
      const cameras = await window.Html5Qrcode.getCameras();
      if (!cameras || !cameras.length){
        $('qrHint').textContent = 'No camera found on this device.';
        return;
      }
      const camId = cameras[0].id;

      await qrScanner.start(
        camId,
        { fps: 10, qrbox: { width: 280, height: 280 } },
        (decodedText) => {
          onQrDecoded(decodedText);
        },
        () => {}
      );
      $('qrHint').textContent = 'Point at a vCard QR.';
    }catch(e){
      $('qrHint').textContent = 'Camera start failed: ' + e.message;
    }
  }

  async function closeQr(){
    try{
      if (qrScanner && qrScanner.isScanning) await qrScanner.stop();
    }catch(e){}
    setOverlay($('qrOverlay'), false);
  }

  function parseVCard(text){
    const out = {};
    if (!text || !/BEGIN:VCARD/i.test(text)) return out;
    const lines = text.split(/\r?\n/);
    for (const ln of lines){
      const m = ln.match(/^([^:;]+)(?:;[^:]*)?:(.*)$/);
      if (!m) continue;
      const key = m[1].toUpperCase();
      const val = m[2].trim();
      if (key === 'FN') out.name = val;
      if (key === 'ORG') out.company = val;
      if (key === 'TITLE') out.title = val;
      if (key === 'EMAIL') out.email = val;
      if (key === 'TEL') {
        if (!out.phone) out.phone = val;
        else if (!out.phone2) out.phone2 = val;
      }
      if (key === 'URL') out.website = val;
      if (key === 'NOTE') out.note = val;
    }
    return out;
  }

  function onQrDecoded(decodedText){
    $('qrData').value = decodedText;
    const vc = parseVCard(decodedText);

    if (vc.company) $('company').value = vc.company;
    if (vc.name) $('contact').value = vc.name;
    if (vc.title) $('title').value = vc.title;
    if (vc.email) $('email').value = vc.email;
    if (vc.website) $('website').value = vc.website;

    if (vc.phone) $('phone').value = vc.phone;
    if (vc.phone2) $('phone2').value = vc.phone2;

    closeQr();
  }

  // =====================
  // UI wiring
  // =====================
  function setLeadType(t){
    state.leadType = t;
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.type === t));
    $('productsLabel').innerHTML = t === 'buyer'
      ? 'What do they want to buy? (one per line) <span class="req">*</span>'
      : 'What do they sell? (one per line) <span class="req">*</span>';
    $('productsOrNeeds').placeholder = t === 'buyer' ? 'One needed item per line' : 'One product per line';
  }

  function setConfigured(ok){
    state.configured = ok;
    $('statusText').textContent = ok ? 'Connected' : 'Not configured';
    $('statusTip').textContent = ok ? 'Ready to save leads.' : 'Tip: set user + Apps Script URL in Settings.';
  }

  function loadLocalSettings(){
    const u = localStorage.getItem(LS.scriptUrl) || '';
    const user = localStorage.getItem(LS.user) || '';
    state.scriptUrl = u.trim();
    state.user = user.trim();
    $('activeUser').textContent = state.user || '—';
    $('settingsScriptUrl').value = state.scriptUrl || '';
    $('userNameInput').value = state.user || '';
  }

  function saveLocalSettings(){
    localStorage.setItem(LS.scriptUrl, state.scriptUrl);
    localStorage.setItem(LS.user, state.user);
    $('activeUser').textContent = state.user || '—';
  }

  function clearForm(){
    $('leadForm').reset();
    $('qrData').value = '';
    $('followEnabled').checked = false;
  }

  function renderSession(){
    $('sessionCount').textContent = String(state.sessionLeads.length);
    const tbody = $('sessionTable').querySelector('tbody');
    tbody.innerHTML = state.sessionLeads.slice(-12).reverse().map(r => `
      <tr>
        <td>${esc(r.type)}</td>
        <td>${esc(r.company)}</td>
        <td>${esc(r.country||'')}</td>
        <td>${esc(r.timeIST||'')}</td>
      </tr>
    `).join('');
  }

  function leadPayload(){
    const country = $('country').value;
    const p1 = normalizePhone($('phone').value, country);
    const p2 = normalizePhone($('phone2').value, country);

    return {
      type: state.leadType,
      enteredBy: state.user || '',
      company: $('company').value.trim(),
      contact: $('contact').value.trim(),
      title: $('title').value.trim(),
      email: $('email').value.trim(),
      phone: p1,
      phone2: p2,
      website: $('website').value.trim(),
      social: $('social').value.trim(),
      country: country.trim(),
      markets: $('markets').value.trim(),
      privateLabel: $('privateLabel').value.trim(),
      productType: $('productType').value.trim(),
      productsOrNeeds: $('productsOrNeeds').value.trim(),
      exFactory: $('exFactory').value.trim(),
      fob: $('fob').value.trim(),
      qrData: $('qrData').value.trim(),
      notes: $('notes').value.trim(),
      followup: $('followEnabled').checked ? {
        date: $('followDate').value,
        time: $('followTime').value,
        note: $('followNote').value.trim()
      } : null,
      // files encoded
      catalogFiles: null,
      cardFile: null
    };
  }

  async function fileToBase64(file){
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  async function attachFiles(payload){
    // Catalog multiple
    const cat = $('catalogFiles').files;
    if (cat && cat.length){
      payload.catalogFiles = [];
      for (const f of Array.from(cat)){
        payload.catalogFiles.push({
          name: f.name,
          mimeType: f.type || 'application/octet-stream',
          dataBase64: await fileToBase64(f)
        });
      }
    }
    // Card
    const card = $('cardFile').files;
    if (card && card[0]){
      const f = card[0];
      payload.cardFile = {
        name: f.name,
        mimeType: f.type || 'image/jpeg',
        dataBase64: await fileToBase64(f)
      };
    }
  }

  async function saveLead(mode){
    if (!state.user) {
      setOverlay($('userOverlay'), true);
      alert('Set user first.');
      return;
    }
    if (!state.scriptUrl || !isExecUrl(state.scriptUrl)) {
      setOverlay($('settingsOverlay'), true);
      alert('Set Apps Script URL (must end with /exec).');
      return;
    }

    // basic required
    if (!$('company').value.trim() || !$('productsOrNeeds').value.trim()){
      alert('Please fill required fields (Company and Products/Needs).');
      return;
    }

    const payload = leadPayload();
    await attachFiles(payload);

    // ping once if not configured
    if (!state.configured){
      try{
        await testConnection();
        setConfigured(true);
      }catch(e){
        setConfigured(false);
        alert('Connection failed: ' + e.message);
        return;
      }
    }

    // save
    try{
      $('statusText').textContent = 'Saving…';
      const resp = await postToScript('saveLead', payload);
      $('statusText').textContent = 'Saved';
      const timeIST = resp.timeIST || fmtIST(new Date());

      state.sessionLeads.push({
        type: payload.type,
        company: payload.company,
        country: payload.country,
        timeIST
      });
      renderSession();

      // refresh lists + dashboard/leads caches
      await refreshLists();
      if (mode === 'new') clearForm();
      if (mode === 'close') switchTab('dashboard');
    }catch(e){
      $('statusText').textContent = 'Error';
      alert('Save failed: ' + e.message);
    } finally {
      if (!state.configured) setConfigured(false);
    }
  }

  function switchTab(name){
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
    if (name === 'dashboard') refreshDashboard();
    if (name === 'leads') refreshLeads();
    if (name === 'calendar') refreshCalendar();
  }

  // =====================
  // Data loading (Lists + Leads + FollowUps)
  // =====================
  async function refreshLists(){
    try{
      const r = await postToScript('getLists', {});
      const lists = r.lists || {};
      state.lists.countries = lists.countries || [];
      state.lists.productTypes = lists.productTypes || [];
      state.lists.markets = lists.markets || [];
      buildDatalist('countryList', state.lists.countries);
      buildDatalist('productTypeList', state.lists.productTypes);
      buildDatalist('marketsList', state.lists.markets);
    }catch(e){
      // ignore if not configured yet
    }
  }

  async function refreshDashboard(){
    if (!state.configured) return;
    const filters = {
      country: $('fCountry').value.trim(),
      productType: $('fProductType').value.trim(),
      markets: $('fMarkets').value.trim(),
    };
    try{
      const r = await postToScript('getDashboard', filters);
      $('kTotal').textContent = r.kpis?.total ?? '—';
      $('kSup').textContent = r.kpis?.suppliers ?? '—';
      $('kBuy').textContent = r.kpis?.buyers ?? '—';
      $('kFollow').textContent = r.kpis?.upcomingFollowups ?? '—';
      const tbody = $('upcomingTable').querySelector('tbody');
      tbody.innerHTML = (r.upcoming || []).map(x => `
        <tr>
          <td>${esc(x.when||'')}</td>
          <td>${esc(x.type||'')}</td>
          <td>${esc(x.company||'')}</td>
          <td>${esc(x.note||'')}</td>
        </tr>
      `).join('');
    }catch(e){
      // show not configured
    }
  }

  let leadsCache = [];
  async function refreshLeads(){
    if (!state.configured) return;
    try{
      const r = await postToScript('getLeads', {});
      leadsCache = r.leads || [];
      renderLeads();
    }catch(e){}
  }

  function applyLeadFilters(rows){
    const q = $('qLeads').value.trim().toLowerCase();
    const c = $('qCountry').value.trim().toLowerCase();
    const p = $('qProductType').value.trim().toLowerCase();
    const m = $('qMarkets').value.trim().toLowerCase();

    return rows.filter(x => {
      const hay = (x.company + ' ' + x.contact + ' ' + x.email).toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (c && !(x.country||'').toLowerCase().includes(c)) return false;
      if (p && !(x.productType||'').toLowerCase().includes(p)) return false;
      if (m && !(x.markets||'').toLowerCase().includes(m)) return false;
      return true;
    });
  }

  function renderLeads(){
    const rows = applyLeadFilters(leadsCache);
    const tbody = $('leadsTable').querySelector('tbody');
    tbody.innerHTML = rows.slice(0, 500).map(x => {
      const tel = x.phone ? `tel:${encodeURIComponent(x.phone)}` : '';
      const wa = x.phone ? `https://wa.me/${encodeURIComponent(x.phone.replace(/[^0-9]/g,''))}` : '';
      const mail = x.email ? `mailto:${encodeURIComponent(x.email)}` : '';
      const drive = x.folderUrl || '';
      return `
      <tr>
        <td>${esc(x.timestamp||'')}</td>
        <td>${esc(x.type||'')}</td>
        <td>${esc(x.company||'')}</td>
        <td>${esc(x.contact||'')}</td>
        <td>${esc(x.country||'')}</td>
        <td>${esc(x.productType||'')}</td>
        <td>${esc(x.markets||'')}</td>
        <td>
          <button class="btn btn-sm btn-ghost" data-edit="${esc(x.leadId)}">Edit</button>
          ${tel ? `<a class="linkbtn" href="${tel}">Call</a>` : ''}
          ${wa ? `<a class="linkbtn" target="_blank" href="${wa}">WhatsApp</a>` : ''}
          ${mail ? `<a class="linkbtn" href="${mail}">Email</a>` : ''}
          ${drive ? `<a class="linkbtn" target="_blank" href="${esc(drive)}">Drive</a>` : ''}
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('button[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => openEdit(btn.getAttribute('data-edit')));
    });
  }

  // Simple edit via prompt (keeps UI light)
  async function openEdit(leadId){
    const row = leadsCache.find(x => x.leadId === leadId);
    if (!row) return;
    const notes = prompt('Edit notes:', row.notes || '');
    if (notes === null) return;
    try{
      await postToScript('updateLead', { leadId, notes });
      await refreshLeads();
      await refreshDashboard();
      alert('Updated.');
    }catch(e){
      alert('Update failed: ' + e.message);
    }
  }

  // =====================
  // Calendar UI
  // =====================
  function calRangeText(anchor){
    const end = new Date(anchor); end.setDate(end.getDate()+6);
    return fmtIST(anchor) + ' — ' + fmtIST(end);
  }

  async function refreshCalendar(){
    if (!state.configured) return;
    const anchor = state.calendar.anchor;
    $('calRange').textContent = 'Week: ' + calRangeText(anchor);
    try{
      const r = await postToScript('getFollowups', { weekStartISO: anchor.toISOString() });
      state.calendar.followups = r.followups || [];
      renderAgenda();
      renderMonth();
    }catch(e){}
  }

  function renderAgenda(){
    const anchor = state.calendar.anchor;
    const days = [];
    for (let i=0;i<7;i++){
      const d = new Date(anchor); d.setDate(d.getDate()+i);
      const key = d.toISOString().slice(0,10);
      days.push({ date: d, key, items: [] });
    }
    for (const f of state.calendar.followups){
      const key = (f.dateISO||'').slice(0,10);
      const day = days.find(x => x.key === key);
      if (day) day.items.push(f);
    }

    const wrap = $('agenda');
    wrap.innerHTML = days.map(d => {
      const dateLabel = new Intl.DateTimeFormat('en-GB', { timeZone:'Asia/Kolkata', weekday:'short', day:'2-digit', month:'short' }).format(d.date);
      const items = d.items.sort((a,b)=> (a.time||'').localeCompare(b.time||''));
      const body = items.length ? items.map(ev => `
        <div class="event">
          <div class="event-top">
            <div class="event-title">${esc(ev.company||'')}</div>
            <div class="muted tiny">${esc(ev.time||'')}</div>
          </div>
          <div class="event-sub">${esc(ev.note||'')}</div>
          <div class="event-actions">
            ${ev.calendarUrl ? `<a class="linkbtn" target="_blank" href="${esc(ev.calendarUrl)}">Open Calendar</a>` : ''}
            ${ev.mailto ? `<a class="linkbtn" href="${esc(ev.mailto)}">Email</a>` : ''}
            ${ev.whatsapp ? `<a class="linkbtn" target="_blank" href="${esc(ev.whatsapp)}">WhatsApp</a>` : ''}
          </div>
        </div>
      `).join('') : `<div class="muted tiny">No follow-ups</div>`;
      return `
        <div class="day">
          <div class="day-title"><span>${esc(dateLabel)}</span><span class="muted tiny">${items.length} item(s)</span></div>
          ${body}
        </div>
      `;
    }).join('');
  }

  function renderMonth(){
    const now = new Date();
    const tz = 'Asia/Kolkata';
    const y = now.getFullYear(), m = now.getMonth();
    const first = new Date(y, m, 1);
    const startDow = first.getDay(); // Sun
    const daysInMonth = new Date(y, m+1, 0).getDate();
    const cells = [];
    const todayKey = new Date().toISOString().slice(0,10);

    for (let i=0;i<startDow;i++) cells.push(null);
    for (let d=1; d<=daysInMonth; d++){
      const date = new Date(y,m,d);
      const key = date.toISOString().slice(0,10);
      const count = state.calendar.followups.filter(f => (f.dateISO||'').slice(0,10) === key).length;
      cells.push({ key, day:d, count });
    }

    const grid = $('monthGrid');
    grid.innerHTML = cells.map(c => {
      if (!c) return `<div class="cell"></div>`;
      const cls = c.key === todayKey ? 'cell today' : 'cell';
      return `<div class="${cls}"><div class="d">${c.day}</div><div class="c">${c.count? c.count + ' follow-up' + (c.count>1?'s':'') : ''}</div></div>`;
    }).join('');
  }

  // =====================
  // Init
  // =====================
  async function init(){
    // tabs
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

    // lead type
    document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => setLeadType(b.dataset.type)));

    // overlays
    $('btnSettings').addEventListener('click', () => setOverlay($('settingsOverlay'), true));
    $('btnCloseSettings').addEventListener('click', () => setOverlay($('settingsOverlay'), false));
    $('btnSwitchUser').addEventListener('click', () => setOverlay($('userOverlay'), true));
    $('btnCloseUser').addEventListener('click', () => setOverlay($('userOverlay'), false));
    $('btnCloseQr').addEventListener('click', closeQr);

    // settings buttons
    $('btnSaveSettings').addEventListener('click', async () => {
      const url = $('settingsScriptUrl').value.trim();
      state.scriptUrl = url;
      saveLocalSettings();
      setConfigured(false);
      try{
        await testConnection();
        setConfigured(true);
        await refreshLists();
        alert('Connected.');
        setOverlay($('settingsOverlay'), false);
      }catch(e){
        setConfigured(false);
        alert('Connection failed: ' + e.message);
      }
    });

    $('btnTestConn').addEventListener('click', async () => {
      try{
        await testConnection();
        setConfigured(true);
        alert('Connection OK');
      }catch(e){
        setConfigured(false);
        alert('Connection failed: ' + e.message);
      }
    });

    // user
    $('btnSaveUser').addEventListener('click', () => {
      state.user = $('userNameInput').value.trim();
      saveLocalSettings();
      setOverlay($('userOverlay'), false);
    });

    // buttons
    $('btnScan').addEventListener('click', openQr);
    $('btnClear').addEventListener('click', clearForm);
    $('btnSaveNew').addEventListener('click', () => saveLead('new'));
    $('btnSaveClose').addEventListener('click', () => saveLead('close'));

    // dashboard
    $('btnDashRefresh').addEventListener('click', refreshDashboard);

    // leads filters
    $('btnLeadsRefresh').addEventListener('click', refreshLeads);
    $('btnApplyLeadFilters').addEventListener('click', renderLeads);

    // calendar controls
    $('calPrev').addEventListener('click', () => { state.calendar.anchor.setDate(state.calendar.anchor.getDate()-7); refreshCalendar(); });
    $('calNext').addEventListener('click', () => { state.calendar.anchor.setDate(state.calendar.anchor.getDate()+7); refreshCalendar(); });
    $('calToday').addEventListener('click', () => { state.calendar.anchor = startOfWeek(new Date()); refreshCalendar(); });

    // load local
    loadLocalSettings();
    setLeadType(state.leadType);

    // Try auto ping if configured
    if (state.scriptUrl && isExecUrl(state.scriptUrl)){
      try{
        await testConnection();
        setConfigured(true);
        await refreshLists();
        await refreshDashboard();
        await refreshLeads();
        await refreshCalendar();
      }catch(e){
        setConfigured(false);
      }
    } else {
      setConfigured(false);
    }
    renderSession();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
