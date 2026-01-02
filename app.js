// Simple client-side Document Monitoring System
// Stores documents in localStorage under key 'dms_docs'

const STORAGE_KEY = 'dms_docs_v1';
const USERS_STORAGE_KEY = 'dms_users_v1';
const RECYCLE_STORAGE_KEY = 'dms_recycle_v1';
// Basic demo users and roles
const USERS = {
  admin: { password: 'password', role: 'admin' },
  user: { password: 'password', role: 'user' }
};
// Key used to persist authenticated user across refreshes
const AUTH_KEY = 'dms_auth_v1';
const AUTH_ROLE_KEY = 'dms_auth_role_v1';
const AUTH_TOKEN_KEY = 'dms_auth_token_v1';
const DARK_MODE_KEY = 'dms_dark_mode_v1';
let currentUserRole = null;
// Optional server API for shared DB
const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? (location.protocol + '//' + location.hostname + ':3000/api') : (location.protocol + '//' + location.hostname + '/api');
let USE_SERVER = false;
let WS_CLIENT = null;
let WS_RECONNECT_TIMER = null;

// probe server once
(function(){
  try{
    fetch(API_BASE.replace('/api','') + '/api/ping').then(r => {
      if(r.ok){
        USE_SERVER = true;
        try{ announceStatus('Connected to sync server'); }catch(e){}
        startServerSync();
        try{ startWebsocket(); }catch(e){}
      }
    }).catch(()=>{});
  }catch(e){}
})();

// start a websocket client to receive server push updates (reconnects automatically)
function startWebsocket(){
  try{
    if(WS_CLIENT && (WS_CLIENT.readyState === WebSocket.OPEN || WS_CLIENT.readyState === WebSocket.CONNECTING)) return;
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = scheme + '//' + location.hostname + (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? ':3000' : '') + '/ws';
    WS_CLIENT = new WebSocket(wsUrl);
    WS_CLIENT.addEventListener('open', () => { announceStatus('Realtime sync connected'); if(WS_RECONNECT_TIMER){ clearTimeout(WS_RECONNECT_TIMER); WS_RECONNECT_TIMER = null; } });
    WS_CLIENT.addEventListener('message', (ev) => {
      try{
        const msg = JSON.parse(ev.data);
        if(msg && msg.type === 'docs_updated'){
          try{ fetch(API_BASE + '/docs').then(r => r.json()).then(j => { if(j && Array.isArray(j.docs)){ docs = j.docs; renderDocs(); updateAdminInboxBadge(); announceStatus('Realtime update received'); } }).catch(()=>{}); }catch(e){}
        }
      }catch(e){}
    });
    WS_CLIENT.addEventListener('close', () => {
      try{ announceStatus('Realtime sync disconnected'); }catch(e){}
      if(WS_RECONNECT_TIMER) clearTimeout(WS_RECONNECT_TIMER);
      WS_RECONNECT_TIMER = setTimeout(() => { try{ startWebsocket(); }catch(e){} }, 3000);
    });
    WS_CLIENT.addEventListener('error', () => { try{ WS_CLIENT.close(); }catch(e){} });
  }catch(e){}
}

// Start periodic server sync to fetch latest docs from server so other devices see updates
let _serverSyncInterval = null;
function startServerSync(){
  // fetch immediately
  try{ fetch(API_BASE + '/docs').then(r => r.json()).then(j => { if(j && Array.isArray(j.docs)){ docs = j.docs; renderDocs(); updateAdminInboxBadge(); } }).catch(()=>{}); }catch(e){}
  // poll every 5s
  try{ if(_serverSyncInterval) clearInterval(_serverSyncInterval); _serverSyncInterval = setInterval(()=>{
    try{ fetch(API_BASE + '/docs').then(r => r.json()).then(j => {
      if(j && Array.isArray(j.docs)){
        const remote = j.docs;
        try{
          const localStr = JSON.stringify(docs || []);
          const remoteStr = JSON.stringify(remote || []);
          if(localStr !== remoteStr){ docs = remote; renderDocs(); updateAdminInboxBadge(); announceStatus('Updated from server'); }
        }catch(e){ docs = remote; renderDocs(); updateAdminInboxBadge(); }
      }
    }).catch(()=>{}); }catch(e){}
  }, 5000); }catch(e){}
}

// Elements
const loginSection = document.getElementById('login-section');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('login-form');
const usernameDisplay = document.getElementById('username-display');
const logoutBtn = document.getElementById('logout-btn');
const navUser = document.getElementById('nav-user');
const userBtn = document.getElementById('user-btn');
const userMenu = document.getElementById('user-menu');
const navToggle = document.getElementById('nav-toggle');
const navbar = document.querySelector('.navbar');
const NAV_OPEN_KEY = 'dms_nav_open_v1';

// Announce short status messages for screen readers.
function announceStatus(msg){
  try{
    const el = document.getElementById('sr-status');
    if(el){ el.textContent = msg; /* keep briefly */ setTimeout(()=>{ try{ el.textContent = ''; }catch(e){} }, 1200); }
  }catch(e){}
}

const newDocBtn = document.getElementById('new-doc-btn');
const newDocFormWrap = document.getElementById('new-doc-form');
const docForm = document.getElementById('doc-form');
const cancelNew = document.getElementById('cancel-new');

const docsTableBody = document.querySelector('#docs-table tbody');
const searchInput = document.getElementById('search-control');
const searchBtn = document.getElementById('search-btn');
const filter30DaysBtn = document.getElementById('filter-30-days');
const clearSearchBtn = document.getElementById('clear-search');
const importFileInput = document.getElementById('import-file');
const exportCsvBtn = document.getElementById('export-csv');
const downloadTemplateBtn = document.getElementById('download-template');
const createdAtInput = document.getElementById('created-at');
const notesInput = document.getElementById('doc-notes');

let docs = [];
let statusFilter = null; // e.g. 'Revision', 'Approved', etc.
let winsFilter = null; // e.g. 'Approved', 'Pending for Approve', 'Rejected'
let dateFilter30Days = false;
let ageStatusFilter = null; // will mirror statusFilter when filtering by age row clicks

// Sidebar search & pagination state
let sidebarQuery = '';
let sidebarPageSize = 8;
let byStatusPage = 1;
let byWinsPage = 1;

// Admin inbox state
let adminInboxFilter = 'forwarded';
let adminInboxQuery = '';
let adminInboxPage = 1;
let adminInboxPageSize = 8;

// Inactivity logout (1 hour)
const INACTIVITY_MS = 60 * 60 * 1000;
let inactivityTimer = null;
function resetInactivityTimer(){
  try{ localStorage.setItem('dms_last_activity', String(Date.now())); }catch(e){}
  if(inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    // Only sign out if dashboard is visible (i.e., user is logged in)
    if(!dashboard.classList.contains('hidden')){
      try{ alert('You have been logged out due to 1 hour of inactivity.'); }catch(e){}
      signOut();
    }
  }, INACTIVITY_MS);
}
function startInactivityWatcher(){
  resetInactivityTimer();
  ['mousemove','keydown','click','touchstart','scroll'].forEach(ev => window.addEventListener(ev, resetInactivityTimer));
}
function stopInactivityWatcher(){
  if(inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
  ['mousemove','keydown','click','touchstart','scroll'].forEach(ev => window.removeEventListener(ev, resetInactivityTimer));
}

function loadDocs(){
  if(USE_SERVER){
    // fetch docs from server (async but keep previous docs if any)
    fetch(API_BASE + '/docs').then(r => r.json()).then(j => { if(j && Array.isArray(j.docs)){ docs = j.docs; renderDocs(); updateAdminInboxBadge(); } }).catch(()=>{});
  }
  try{ docs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch(e){ docs = []; }
  // migrate legacy 'Received' status: preserve as adminStatus and set a sane status value
  try{
    docs.forEach(d => {
      if(d && d.status === 'Received'){
        if(!d.adminStatus) d.adminStatus = 'Received';
        d.status = 'Routing';
      }
    });
  }catch(e){}
}

function saveDocs(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
  if(USE_SERVER){
    try{ fetch(API_BASE + '/docs', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ docs }) }).catch(()=>{}); }catch(e){}
  }
}

function renderDocs(filter){
  if(selectAll) selectAll.checked = false;
  if(docsTableBody) docsTableBody.innerHTML = '';
  const q = filter ? filter.toLowerCase() : '';
  let list = docs.slice();
  if(q){
    list = docs.filter(d => {
      return (d.controlNumber || '').toLowerCase().includes(q)
        || (d.title || '').toLowerCase().includes(q)
        || (d.notes || '').toLowerCase().includes(q)
        || (d.owner || '').toLowerCase().includes(q);
    });
  }
  if(statusFilter){
    list = list.filter(d => d.status === statusFilter);
  }
  if(winsFilter){
    list = list.filter(d => d.winsStatus === winsFilter);
  }
  if(ageStatusFilter){
    list = list.filter(d => d.status === ageStatusFilter);
  }
  if(dateFilter30Days){
    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    list = list.filter(d => d.createdAt && Number(d.createdAt) >= cutoff);
  }
  if(list.length === 0){
    if(docsTableBody){
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="12" class="muted">No documents found.</td>';
      docsTableBody.appendChild(tr);
    }
    renderDashboardSummaries(list);
    return;
  }

  if(docsTableBody){
    list.forEach(doc => {
    const tr = document.createElement('tr');
    const createdText = doc.createdAt ? msToDatetimeLocal(doc.createdAt).replace('T',' ') : '';
    const updatedText = doc.updatedAt ? new Date(doc.updatedAt).toLocaleString() : '';
    const ageDays = doc.createdAt ? Math.floor((Date.now() - Number(doc.createdAt)) / (1000 * 60 * 60 * 24)) : '';
    let ageClass = '';
    if(ageDays !== ''){
      if(ageDays > 30) ageClass = 'age-bad';
      else if(ageDays > 7) ageClass = 'age-warn';
      else ageClass = 'age-good';
    }

      const isAdmin = (currentUserRole === 'admin');

    // admin status cell — reflect forwarded/received/returned
    let adminStatusHtml = '';
    if(doc.forwarded){
      adminStatusHtml = `<span class="forwarded-label">Forwarded</span>`;
    } else if(doc.adminStatus === 'Received'){
      adminStatusHtml = `<span class="admin-status-label">Received</span>`;
      if(doc.returnReason){ adminStatusHtml += `<div class="muted" style="font-size:11px;margin-top:4px">Note: ${escapeHtml(doc.returnReason)}</div>`; }
    } else if(doc.adminStatus === 'Returned'){
      adminStatusHtml = `<span class="returned-label">Returned</span>`;
      if(doc.returnReason){ adminStatusHtml += `<div class="muted" style="font-size:11px;margin-top:4px">Reason: ${escapeHtml(doc.returnReason)}</div>`; }
    }

    tr.innerHTML = `
      <td><input type="checkbox" class="row-checkbox" value="${escapeHtml(doc.controlNumber)}"></td>
      <td>${escapeHtml(doc.controlNumber)}</td>
      <td>${escapeHtml(doc.title)}</td>
      <td class="notes-cell"><span class="notes-text" title="${escapeHtml(doc.notes || '')}">${escapeHtml(doc.notes || '')}</span><button type="button" class="note-edit-btn" data-note-edit="${escapeHtml(doc.controlNumber)}">✎</button></td>
      <td>${escapeHtml(doc.owner || '')}</td>
      <td>
        <select data-control="${escapeHtml(doc.controlNumber)}" class="status-select">
          <option ${doc.status === 'Revision' ? 'selected' : ''}>Revision</option>
            <option ${doc.status === 'Routing' ? 'selected' : ''}>Routing</option>
          <option ${doc.status === 'Approved' ? 'selected' : ''}>Approved</option>
          <option ${doc.status === 'Rejected' ? 'selected' : ''}>Rejected</option>

        </select>
      </td>
      <td>
        <select data-control-wins="${escapeHtml(doc.controlNumber)}" class="wins-select">
          <option ${doc.winsStatus === 'Approved' ? 'selected' : ''}>Approved</option>
          <option ${doc.winsStatus === 'Pending for Approve' ? 'selected' : ''}>Pending for Approve</option>
          <option ${doc.winsStatus === 'Rejected' ? 'selected' : ''}>Rejected</option>
        </select>
      </td>
      <td>${escapeHtml(createdText)}</td>
      <td>${escapeHtml(updatedText)}</td>
      <td><span class="age ${ageClass}">${ageDays !== '' ? escapeHtml(ageDays) : ''}</span></td>
      <td class="admin-status-cell">${adminStatusHtml}</td>
      <td class="actions">
        <button class="icon-btn" data-edit="${escapeHtml(doc.controlNumber)}" title="Edit" aria-label="Edit ${escapeHtml(doc.controlNumber)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg></button>
        ${!isAdmin && !doc.forwarded && String(doc.adminStatus).toLowerCase() !== 'received' ? `<button class="icon-btn forward" data-forward="${escapeHtml(doc.controlNumber)}" title="Forward to Admin" aria-label="Forward ${escapeHtml(doc.controlNumber)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></button>` : (!isAdmin && doc.forwarded ? `<span class="forwarded-label">Forwarded</span>` : (!isAdmin && String(doc.adminStatus).toLowerCase() === 'received' ? `<span class="received-label">Received by Admin</span>` : ''))}
        ${isAdmin && doc.forwarded ? `<button class="icon-btn receive" data-receive="${escapeHtml(doc.controlNumber)}" title="Receive forwarded document" aria-label="Receive ${escapeHtml(doc.controlNumber)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button>` : ''}
        ${isAdmin && doc.adminStatus === 'Received' ? `<button class="icon-btn return" data-return="${escapeHtml(doc.controlNumber)}" title="Return to IC" aria-label="Return ${escapeHtml(doc.controlNumber)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 4 6 9 1"></polyline><path d="M20 22v-7a4 4 0 0 0-4-4H4"></path></svg><span class="btn-label">Return</span></button>` : (isAdmin && doc.adminStatus === 'Returned' ? `<span class="returned-label">Returned</span>` : '')}
        <button class="icon-btn delete" data-delete="${escapeHtml(doc.controlNumber)}" title="Delete" aria-label="Delete ${escapeHtml(doc.controlNumber)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></button>
      </td> 
    `;
    docsTableBody.appendChild(tr);
    });
  }
  renderTotalDocs();
  renderStatusChart();
  renderWinsChart();
  renderAdminStatusOverview();
  renderAgeOverview();
  renderLeftSidebar();
  renderDashboardSummaries(list);
}
  try{ updateAdminInboxBadge(); }catch(e){}

function drawPieChart(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  if(total === 0) return;

  let startAngle = 0;
  const colors = ['#2752a7', '#4a90e2', '#f39c12', '#e74c3c', '#2ecc71', '#9b59b6', '#34495e', '#95a5a6'];
  const sorted = Object.entries(data).sort((a,b) => b[1] - a[1]);

  sorted.forEach(([key, value], index) => {
    const sliceAngle = (value / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, canvas.height / 2);
    ctx.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) / 2 - 5, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = colors[index % colors.length];
    ctx.fill();
    startAngle += sliceAngle;
  });
}

function drawBarChart(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const entries = Object.entries(data).sort((a,b) => b[1] - a[1]).slice(0, 8); // Top 8
  if (entries.length === 0) return;

  const maxVal = Math.max(...entries.map(e => e[1]));
  const barWidth = (width - 40) / entries.length;
  const gap = 5;
  const chartHeight = height - 20;

  entries.forEach((entry, i) => {
    const val = entry[1];
    const barH = maxVal > 0 ? (val / maxVal) * (chartHeight - 20) : 0;
    const x = 20 + i * barWidth;
    const y = chartHeight - barH;
    
    ctx.fillStyle = '#2752a7';
    ctx.fillRect(x, y, barWidth - gap, barH);
    
    ctx.fillStyle = '#333';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(val, x + (barWidth - gap)/2, y - 5);
    
    // Simple label truncation
    const label = entry[0].length > 6 ? entry[0].substring(0,6)+'..' : entry[0];
    ctx.fillText(label, x + (barWidth - gap)/2, chartHeight + 12);
  });
}

function renderDashboardSummaries(currentList){
  const titleContainer = document.getElementById('summary-by-title');
  const ownerContainer = document.getElementById('summary-by-owner');
  if(!titleContainer || !ownerContainer) return;

  const list = currentList || docs;
  const byTitle = {};
  const byOwner = {};
  
  list.forEach(d => {
    const t = d.title || 'Unknown';
    byTitle[t] = (byTitle[t] || 0) + 1;
    const o = d.owner || 'Unknown';
    byOwner[o] = (byOwner[o] || 0) + 1;
  });

  const colors = ['#2752a7', '#4a90e2', '#f39c12', '#e74c3c', '#2ecc71', '#9b59b6', '#34495e', '#95a5a6'];

  // Helper to render list
  const render = (map, container, isTitle) => {
    const sorted = Object.entries(map).sort((a,b) => b[1] - a[1]);
    if(sorted.length === 0) { container.innerHTML = '<div class="muted">No data</div>'; return; }
    
    let html = '';
    if(isTitle) html += '<div style="text-align:center;margin-bottom:12px"><canvas id="title-pie-chart" width="160" height="160"></canvas></div>';
    else html += '<div style="text-align:center;margin-bottom:12px"><canvas id="owner-bar-chart" width="280" height="160"></canvas></div>';
    
    html += '<ul class="approved-ul">';
    sorted.forEach(([k, v], idx) => {
      const color = colors[idx % colors.length];
      const dot = isTitle ? `<span style="display:inline-block;width:10px;height:10px;background:${color};border-radius:50%;margin-right:8px;"></span>` : '';
      html += `<li style="padding:6px 0;border-bottom:1px solid #eee;display:flex;justify-content:space-between;cursor:pointer" onclick="window.location.href='documents_full.html?q=${encodeURIComponent(k)}'" title="Filter by ${escapeHtml(k)}"><span>${dot}${escapeHtml(k)}</span> <span class="nav-badge" style="background:#eef4ff;color:#2752a7">${v}</span></li>`;
    });
    html += '</ul>';
    container.innerHTML = html;
    if(isTitle) setTimeout(() => drawPieChart('title-pie-chart', map), 0);
    else setTimeout(() => drawBarChart('owner-bar-chart', map), 0);
  };

  render(byTitle, titleContainer, true);
  render(byOwner, ownerContainer, false);
}

function computeWinsCounts(){
  const counts = { 'Approved':0, 'Pending for Approve':0, 'Rejected':0 };
  docs.forEach(d => {
    const w = d.winsStatus || 'Pending for Approve';
    if(!(w in counts)) counts[w] = 0;
    counts[w]++;
  });
  return counts;
}

function renderWinsChart(){
  const container = document.getElementById('wins-chart');
  if(!container) return;
  container.innerHTML = '';
  const counts = computeWinsCounts();
  const total = Object.values(counts).reduce((a,b) => a + b, 0) || 1;
  const wins = [
    { key: 'Approved', cls: 'wins-approved' },
    { key: 'Pending for Approve', cls: 'wins-pending' },
    { key: 'Rejected', cls: 'wins-rejected' }
  ];
  wins.forEach(w => {
    const row = document.createElement('div');
    row.className = 'wins-row ' + (w.key === winsFilter ? 'selected' : '');
    const label = document.createElement('div'); label.className = 'wins-label'; label.textContent = w.key;
    const count = document.createElement('div'); count.className = 'wins-count'; count.textContent = counts[w.key] || 0;
    const bar = document.createElement('div'); bar.className = 'wins-bar ' + w.cls;
    const inner = document.createElement('div'); inner.className = 'wins-bar-inner';
    const pct = Math.round(((counts[w.key] || 0) / total) * 100);
    inner.style.width = pct + '%';
    bar.appendChild(inner);
    const btn = document.createElement('button'); btn.textContent = (w.key === winsFilter) ? 'Clear' : 'Filter';
    btn.addEventListener('click', () => {
      if(w.key === winsFilter) setWinsFilter(null);
      else setWinsFilter(w.key);
    });
    row.appendChild(label);
    row.appendChild(count);
    row.appendChild(bar);
    row.appendChild(btn);
    container.appendChild(row);
  });
}

function setWinsFilter(status){
  winsFilter = status;
  renderDocs(searchInput.value.trim());
}

const clearWinsFilterBtn = document.getElementById('clear-wins-filter');
clearWinsFilterBtn && clearWinsFilterBtn.addEventListener('click', () => { setWinsFilter(null); });

// Age overview: compute counts and buckets for Revision and Routing
function computeAgeOverview(){
  const statuses = ['Revision','Routing'];
  const msDay = 1000 * 60 * 60 * 24;
  const now = Date.now();
  const out = {};
  statuses.forEach(status => {
    const docsFor = docs.filter(d => d.status === status && d.createdAt);
    const ages = docsFor.map(d => Math.max(0, Math.floor((now - Number(d.createdAt)) / msDay)));
    const total = docsFor.length;
    const avg = total ? Math.round(ages.reduce((a,b)=>a+b,0)/total) : 0;
    const buckets = { a:0, b:0, c:0 }; // a:0-7, b:8-30, c:>30
    ages.forEach(a => {
      if(a <= 7) buckets.a++;
      else if(a <= 30) buckets.b++;
      else buckets.c++;
    });
    out[status] = { total, avg, buckets };
  });
  return out;
}

function renderAgeOverview(){
  const container = document.getElementById('age-overview');
  if(!container) return;
  container.innerHTML = '';
  const data = computeAgeOverview();
  const statuses = ['Revision','Routing'];
  statuses.forEach(s => {
    const info = data[s] || { total:0, avg:0, buckets:{a:0,b:0,c:0} };
    const row = document.createElement('div'); row.className = 'age-ov-row ' + (s === ageStatusFilter ? 'selected' : '');
    const label = document.createElement('div'); label.className = 'age-ov-label'; label.textContent = s;
    const avg = document.createElement('div'); avg.className = 'age-ov-avg'; avg.textContent = info.avg + ' d';
    const bucketsWrap = document.createElement('div'); bucketsWrap.className = 'age-ov-buckets';
    const total = info.total || 1;
    // bucket elements
    const b1 = document.createElement('div'); b1.className = 'age-bucket'; const b1i = document.createElement('div'); b1i.className = 'age-bucket-inner'; b1i.style.width = Math.round((info.buckets.a/total)*100) + '%'; b1.appendChild(b1i);
    const b2 = document.createElement('div'); b2.className = 'age-bucket'; const b2i = document.createElement('div'); b2i.className = 'age-bucket-inner mid'; b2i.style.width = Math.round((info.buckets.b/total)*100) + '%'; b2.appendChild(b2i);
    const b3 = document.createElement('div'); b3.className = 'age-bucket'; const b3i = document.createElement('div'); b3i.className = 'age-bucket-inner bad'; b3i.style.width = Math.round((info.buckets.c/total)*100) + '%'; b3.appendChild(b3i);
    bucketsWrap.appendChild(b1); bucketsWrap.appendChild(b2); bucketsWrap.appendChild(b3);
    const count = document.createElement('div'); count.className = 'age-ov-count'; count.textContent = info.total;
    const btn = document.createElement('button'); btn.textContent = (s === ageStatusFilter) ? 'Clear' : 'Filter';
    btn.addEventListener('click', () => {
      if(s === ageStatusFilter){ setAgeStatusFilter(null); }
      else { setAgeStatusFilter(s); }
    });
    row.appendChild(label);
    row.appendChild(avg);
    row.appendChild(bucketsWrap);
    row.appendChild(count);
    row.appendChild(btn);
    container.appendChild(row);
  });
}

function renderAdminStatusOverview(){
  const container = document.getElementById('admin-status-overview');
  if(!container) return;
  container.innerHTML = '';
  const counts = computeAdminStatusCounts();
  const total = (counts.Received + counts.Returned) || 1;
  const rows = [
    { key: 'Received', cls: 'status-admin' },
    { key: 'Returned', cls: 'status-rejected' }
  ];
  rows.forEach(r => {
    const row = document.createElement('div'); row.className = 'status-row';
    const label = document.createElement('div'); label.className = 'status-label';
    const badgeHtml = `<span class="nav-badge status-badge" aria-hidden="true">${counts[r.key] || 0}</span>`;
    label.innerHTML = r.key + ' ' + badgeHtml;
    const bar = document.createElement('div'); bar.className = 'status-bar ' + r.cls;
    const inner = document.createElement('div'); inner.className = 'status-bar-inner';
    inner.style.width = Math.round(((counts[r.key]||0)/total)*100) + '%';
    bar.appendChild(inner);
    row.appendChild(label); row.appendChild(bar);
    container.appendChild(row);
  });
}

function renderLeftSidebar(){
  const byStatus = document.getElementById('approved-by-status');
  const byWins = document.getElementById('approved-by-wins');
  const searchInput = document.getElementById('sidebar-search');
  const pageSizeEl = document.getElementById('sidebar-page-size');
  const byStatusPagination = document.getElementById('by-status-pagination');
  const byWinsPagination = document.getElementById('by-wins-pagination');
  if(!byStatus || !byWins) return;
  // sync page size
  sidebarPageSize = Number(pageSizeEl && pageSizeEl.value) || sidebarPageSize;
  const q = (searchInput && searchInput.value || sidebarQuery || '').toLowerCase();

  // Helper to render list with pagination
  function renderList(container, items, page, paginationEl){
    container.innerHTML = '';
    const filtered = items.filter(d => {
      if(!q) return true;
      const combined = ((d.controlNumber||'') + ' ' + (d.title||'')).toLowerCase();
      return combined.includes(q);
    });
    if(filtered.length === 0){
      container.innerHTML = '<div class="muted">No documents.</div>';
      if(paginationEl) paginationEl.innerHTML = '';
      return;
    }
    const totalPages = Math.max(1, Math.ceil(filtered.length / sidebarPageSize));
    // clamp page
    page = Math.min(Math.max(1, page), totalPages);
    // save back global
    if(container === byStatus) byStatusPage = page; else byWinsPage = page;
    const start = (page - 1) * sidebarPageSize;
    const slice = filtered.slice(start, start + sidebarPageSize);
    const ul = document.createElement('ul'); ul.className = 'approved-ul';
    slice.forEach(d => {
      const li = document.createElement('li');
          const a = document.createElement('a');
      a.href = 'document.html?control=' + encodeURIComponent(d.controlNumber);
      a.dataset.control = d.controlNumber;
      a.textContent = (d.controlNumber || '') + ' — ' + (d.title || '');
      // button to open in new tab
      const nb = document.createElement('button'); nb.type = 'button'; nb.className = 'open-new-tab'; nb.title = 'Open in new tab'; nb.textContent = '↗'; nb.style.marginLeft = '6px';
      nb.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); const sb = document.getElementById('left-sidebar'); if(sb && sb.classList.contains('collapsed')) return; window.open(a.href, '_blank'); });
      li.appendChild(a);
      li.appendChild(nb);
      ul.appendChild(li);
    });
    container.appendChild(ul);

    // Pagination controls
    if(paginationEl){
      paginationEl.innerHTML = '';
      const prev = document.createElement('button'); prev.type = 'button'; prev.textContent = 'Prev'; prev.disabled = page <= 1;
      prev.addEventListener('click', () => { renderList(container, items, page - 1, paginationEl); });
      const info = document.createElement('span'); info.className = 'current-page'; info.textContent = 'Page ' + page + ' / ' + totalPages;
      const next = document.createElement('button'); next.type = 'button'; next.textContent = 'Next'; next.disabled = page >= totalPages;
      next.addEventListener('click', () => { renderList(container, items, page + 1, paginationEl); });
      paginationEl.appendChild(prev); paginationEl.appendChild(info); paginationEl.appendChild(next);
    }
  }

  // Routing by Status
  const routingByStatusDocs = docs.filter(d => d.status === 'Routing');
  renderList(byStatus, routingByStatusDocs, byStatusPage, byStatusPagination);

  // Revision by Status
  const revisionByStatusDocs = docs.filter(d => d.status === 'Revision');
  renderList(byWins, revisionByStatusDocs, byWinsPage, byWinsPagination);


}

function setAgeStatusFilter(status){
  ageStatusFilter = status;
  // mirror into the main status filter for consistent behavior
  if(status) setStatusFilter(status);
  else setStatusFilter(null);
}

// Render the Admin Inbox (visible to admins). Supports filters: forwarded, received, returned, all
function renderAdminInbox(externalFilter){
  const container = document.getElementById('admin-inbox-list');
  const paginationEl = document.getElementById('admin-inbox-pagination');
  if(!container) return;
  container.innerHTML = '';
  // ensure docs loaded
  loadDocs();
  const f = externalFilter || adminInboxFilter || 'all';
  const q = (document.getElementById('admin-inbox-search') && document.getElementById('admin-inbox-search').value) || adminInboxQuery || '';
  adminInboxQuery = q;
  let list = (docs || []).slice();
  // Apply filter
  if(f === 'forwarded') list = list.filter(d => d.forwarded === true);
  else if(f === 'received') list = list.filter(d => String(d.adminStatus).toLowerCase() === 'received');
  else if(f === 'returned') list = list.filter(d => String(d.adminStatus).toLowerCase() === 'returned');
  else list = list.filter(d => d.forwarded || d.adminStatus);
  // Apply search query
  if(adminInboxQuery){
    const ql = adminInboxQuery.toLowerCase();
    list = list.filter(d => ((d.controlNumber||'') + ' ' + (d.title||'') + ' ' + (d.owner||'')).toLowerCase().includes(ql));
  }
  // Pagination
  const totalPages = Math.max(1, Math.ceil(list.length / adminInboxPageSize));
  adminInboxPage = Math.min(Math.max(1, adminInboxPage), totalPages);
  const start = (adminInboxPage - 1) * adminInboxPageSize;
  const slice = list.slice(start, start + adminInboxPageSize);

  if(slice.length === 0){ container.innerHTML = '<div class="muted">No items in inbox.</div>'; if(paginationEl) paginationEl.innerHTML = ''; updateAdminInboxBadge(); return; }

  const ul = document.createElement('ul'); ul.className = 'approved-ul';
  slice.forEach(d => {
    const li = document.createElement('li');
    const left = document.createElement('div'); left.style.flex = '1';
    let adminHtml = '';
    if(d.adminStatus){
      if(String(d.adminStatus).toLowerCase() === 'received'){
        adminHtml = ' <span class="admin-status-label">Admin: Received' + (d.forwardedHandledBy ? ' by ' + escapeHtml(d.forwardedHandledBy) + ' at ' + (d.forwardedHandledAt ? new Date(Number(d.forwardedHandledAt)).toLocaleString() : '') : '') + '</span>';
        if(d.returnReason){ adminHtml += '<div class="muted" style="font-size:11px;margin-top:4px">Note: ' + escapeHtml(d.returnReason) + '</div>'; }
      } else if(String(d.adminStatus).toLowerCase() === 'returned'){
        adminHtml = ' <span class="forwarded-label">Admin: Returned' + (d.returnedBy ? ' by ' + escapeHtml(d.returnedBy) + ' at ' + (d.returnedAt ? new Date(Number(d.returnedAt)).toLocaleString() : '') : '') + '</span>';
        if(d.returnReason){ adminHtml += '<div class="muted" style="font-size:11px;margin-top:4px">Reason: ' + escapeHtml(d.returnReason) + '</div>'; }
      }
    }
    const chk = `<input type="checkbox" class="admin-inbox-check" value="${escapeHtml(d.controlNumber||d.control)}" style="margin-right:10px;cursor:pointer">`;
    left.innerHTML = `<div style="display:flex;align-items:center">${chk}<div><strong>${escapeHtml(d.controlNumber||d.control)}</strong> — ${escapeHtml(d.title||'')} <div class="muted" style="font-size:12px">Status: ${escapeHtml(d.status || '')} ${d.forwarded ? ' • Forwarded by ' + escapeHtml(d.forwardedBy || '') + ' at ' + (d.forwardedAt ? new Date(Number(d.forwardedAt)).toLocaleString() : '') : ''}${adminHtml}</div></div></div>`;
    const actions = document.createElement('div');
    // view (eye icon)
    const view = document.createElement('button'); view.type = 'button'; view.className = 'icon-btn'; view.title = 'Open details'; view.setAttribute('aria-label','Open details for ' + (d.controlNumber||d.control));
    view.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    view.style.marginLeft = '6px'; view.addEventListener('click', () => { openDocModal(d.controlNumber||d.control); }); actions.appendChild(view);
    if(d.forwarded){
      const wrapRec = document.createElement('div'); wrapRec.className = 'icon-with-label';
      const rec = document.createElement('button'); rec.type = 'button'; rec.className = 'icon-btn receive'; rec.title = 'Receive forwarded document'; rec.setAttribute('data-receive', d.controlNumber||d.control); rec.setAttribute('aria-label','Receive ' + (d.controlNumber||d.control));
      rec.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      const recLabel = document.createElement('span'); recLabel.className = 'btn-label-under'; recLabel.textContent = 'Receive';
      wrapRec.appendChild(rec); wrapRec.appendChild(recLabel);
      actions.appendChild(wrapRec);
    } else if(String(d.adminStatus).toLowerCase() === 'received'){
      const wrapRet = document.createElement('div'); wrapRet.className = 'icon-with-label';
      const ret = document.createElement('button'); ret.type = 'button'; ret.className = 'icon-btn return'; ret.title = 'Return to originator'; ret.setAttribute('data-return', d.controlNumber||d.control); ret.setAttribute('aria-label','Return ' + (d.controlNumber||d.control));
      ret.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 4 6 9 1"></polyline><path d="M20 22v-7a4 4 0 0 0-4-4H4"></path></svg>';
      const retLabel = document.createElement('span'); retLabel.className = 'btn-label-under'; retLabel.textContent = 'Return';
      wrapRet.appendChild(ret); wrapRet.appendChild(retLabel);
      actions.appendChild(wrapRet);
    } else if(String(d.adminStatus).toLowerCase() === 'returned'){
      const lbl = document.createElement('span'); lbl.className = 'returned-label'; lbl.textContent = 'Returned'; lbl.style.marginLeft = '6px';
      actions.appendChild(lbl);
    }
    li.appendChild(left);
    li.appendChild(actions);
    li.style.display = 'flex'; li.style.alignItems = 'center'; li.style.justifyContent = 'space-between';
    ul.appendChild(li);
  });
  container.appendChild(ul);

  // pagination controls
  if(paginationEl){
    paginationEl.innerHTML = '';
    const prev = document.createElement('button'); prev.type = 'button'; prev.textContent = 'Prev'; prev.disabled = adminInboxPage <= 1;
    prev.addEventListener('click', () => { adminInboxPage = Math.max(1, adminInboxPage - 1); renderAdminInbox(); });
    const info = document.createElement('span'); info.className = 'current-page'; info.textContent = 'Page ' + adminInboxPage + ' / ' + totalPages;
    const next = document.createElement('button'); next.type = 'button'; next.textContent = 'Next'; next.disabled = adminInboxPage >= totalPages;
    next.addEventListener('click', () => { adminInboxPage = Math.min(totalPages, adminInboxPage + 1); renderAdminInbox(); });
    paginationEl.appendChild(prev); paginationEl.appendChild(info); paginationEl.appendChild(next);
  }
  // update badges in navbar
  try{ updateAdminInboxBadge(); }catch(e){}
}

// Enhance common toolbar buttons with icons and tooltips
function enhanceToolbarIcons(){
  const map = [
    ['new-doc-btn','New Document', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>'],
    ['refresh-docs','Refresh','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.36-3.36L23 10"></path><path d="M20.49 15a9 9 0 0 1-14.36 3.36L1 14"></path></svg>'],
    ['search-btn','Search','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>'],
    ['clear-search','Clear','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'],
    ['download-template','Download Template','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>'],
    ['export-csv','Export CSV','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>'],
    ['bulk-update','Update Selected','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 11l5-5 5 5"></path></svg>'],
    ['bulk-delete','Delete Selected','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>'],
    ['clear-status-filter','Clear Filter','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'],
    ['clear-wins-filter','Clear WINS Filter','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'],
    ['clear-age-filter','Clear Age Filter','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>']
  ];
  map.forEach(([id, title, svg]) => {
    try{
      const el = document.getElementById(id);
      if(!el) return;
      // keep possible existing label span for responsive show/hide
      const label = el.querySelector('.btn-label');
      el.innerHTML = svg + (label ? label.outerHTML : '');
      el.setAttribute('title', title);
      el.setAttribute('aria-label', title);
      el.classList.add('icon-btn');
    }catch(e){}
  });
}

// run enhancement on load
try{ enhanceToolbarIcons(); }catch(e){}

// Allow external callers (e.g., navbar menu) to change the admin inbox filter
function setAdminInboxFilter(f){
  adminInboxFilter = f;
  try{ const fe = document.getElementById('admin-inbox-filter'); if(fe) fe.value = adminInboxFilter; }catch(e){}
  adminInboxPage = 1;
  renderAdminInbox(f);
}
window.setAdminInboxFilter = setAdminInboxFilter;

// Render recycle bin view (for recycle_bin.html)
function renderRecycleBin(){
  const container = document.getElementById('recycle-list');
  if(!container) return;
  const rb = loadRecycle();
  container.innerHTML = '';
  if(!rb || rb.length === 0){ container.innerHTML = '<div class="muted">Recycle bin is empty.</div>'; return; }
  const ul = document.createElement('ul'); ul.className = 'approved-ul';
  rb.forEach(d => {
    const li = document.createElement('li');
    const left = document.createElement('div'); left.style.flex = '1';
    left.innerHTML = `<strong>${escapeHtml(d.controlNumber||d.control)}</strong> — ${escapeHtml(d.title||'')} <div class="muted" style="font-size:12px">Deleted: ${d.deletedAt? new Date(Number(d.deletedAt)).toLocaleString():''}</div>`;
    const actions = document.createElement('div');
    const restore = document.createElement('button'); restore.type='button'; restore.className='icon-btn'; restore.title='Restore'; restore.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
    restore.addEventListener('click', () => { if(restoreFromRecycle(d.controlNumber||d.control)){ renderRecycleBin(); alert('Restored.'); } });
    const purge = document.createElement('button'); purge.type='button'; purge.className='icon-btn'; purge.title='Delete permanently'; purge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>';
    purge.addEventListener('click', () => { if(confirm('Permanently delete this item?')){ purgeFromRecycle(d.controlNumber||d.control); renderRecycleBin(); } });
    actions.appendChild(restore); actions.appendChild(purge);
    li.appendChild(left); li.appendChild(actions); li.style.display='flex'; li.style.alignItems='center'; li.style.justifyContent='space-between'; ul.appendChild(li);
  });
  container.appendChild(ul);
}

const clearAgeFilterBtn = document.getElementById('clear-age-filter');
clearAgeFilterBtn && clearAgeFilterBtn.addEventListener('click', () => { setAgeStatusFilter(null); });

const clearAdminStatusFilterBtn = document.getElementById('clear-admin-status-filter');
clearAdminStatusFilterBtn && clearAdminStatusFilterBtn.addEventListener('click', () => { setStatusFilter(null); renderDocs(); });

function renderTotalDocs(){
  const container = document.getElementById('total-docs');
  if(!container) return;
  container.textContent = docs.length;
}

function computeStatusCounts(){
  const counts = { 'Revision':0, 'Routing':0, 'Approved':0, 'Rejected':0 };
  docs.forEach(d => {
    const s = d.status || 'Revision';
    if(!(s in counts)) counts[s] = 0;
    counts[s]++;
  });
  return counts;
} 

function computeAdminStatusCounts(){
  const res = { Received:0, Returned:0 };
  docs.forEach(d => {
    if(d.adminStatus === 'Received') res.Received++;
    else if(d.adminStatus === 'Returned') res.Returned++;
  });
  return res;
} 

function computeAdminInboxCounts(){
  const res = { forwarded:0, received:0, returned:0 };
  docs.forEach(d => {
    if(d.forwarded) res.forwarded++;
    if(d.adminStatus === 'Received') res.received++;
    if(d.adminStatus === 'Returned') res.returned++;
  });
  return res;
}

function updateAdminInboxBadge(){
  try{
    const btn = document.getElementById('admin-inbox-page-btn');
    if(!btn) return;
    const counts = computeAdminInboxCounts();
    // If we're on the admin inbox page (card present), show all status badges there.
    // On other pages (dashboards) show only the received badge to avoid clutter.
    const isInboxPage = !!document.getElementById('admin-inbox');
    const label = 'Admin Inbox';
    if(isInboxPage){
      const parts = [label];
      if(counts.forwarded) parts.push(`<button type="button" class="nav-badge badge-forwarded admin-badge-btn" data-admin-filter="forwarded" aria-label="${counts.forwarded} forwarded">${counts.forwarded}</button>`);
      if(counts.received) parts.push(`<button type="button" class="nav-badge badge-received admin-badge-btn" data-admin-filter="received" aria-label="${counts.received} received">${counts.received}</button>`);
      if(counts.returned) parts.push(`<button type="button" class="nav-badge badge-returned admin-badge-btn" data-admin-filter="returned" aria-label="${counts.returned} returned">${counts.returned}</button>`);
      btn.innerHTML = parts.join(' ');
    } else {
      // dashboard/minor pages: show only received count if any
      if(counts.received){
        btn.innerHTML = label + ' ' + `<button type="button" class="nav-badge badge-received admin-badge-btn" data-admin-filter="received" aria-label="${counts.received} received">${counts.received}</button>`;
      } else {
        btn.innerHTML = label;
      }
    }
    // update inbox box badges/menu counts if present
    try{
      const bf = document.getElementById('badge-forwarded-box'); if(bf) bf.textContent = counts.forwarded || '';
      const bfm = document.getElementById('badge-forwarded-menu'); if(bfm) bfm.textContent = counts.forwarded || 0;
      const brm = document.getElementById('badge-received-menu'); if(brm) brm.textContent = counts.received || 0;
      const brrm = document.getElementById('badge-returned-menu'); if(brrm) brrm.textContent = counts.returned || 0;
    }catch(e){}
    // also update dashboard-specific received badge anchors (e.g., show on users-dashboard link)
    try{
      // look for any element with id 'users-dashboard-page-btn' or other nav links and append received badge
      const usersBtn = document.getElementById('users-dashboard-page-btn');
      if(usersBtn){
        if(counts.received) usersBtn.innerHTML = 'Users ' + `<span class="nav-badge badge-received" aria-label="${counts.received} received">${counts.received}</span>`;
        else usersBtn.innerHTML = 'Users';
      }
    }catch(e){}
  }catch(e){}
}

function renderStatusChart(){
  const container = document.getElementById('status-chart');
  if(!container) return;
  container.innerHTML = '';
  const counts = computeStatusCounts();
  const total = Object.values(counts).reduce((a,b) => a + b, 0) || 1;
  const statuses = [
    { key: 'Revision', cls: 'status-revision' },
    { key: 'Routing', cls: 'status-routing' },
    { key: 'Approved', cls: 'status-approved' },
    { key: 'Rejected', cls: 'status-rejected' }
  ];
  statuses.forEach(s => {
    const row = document.createElement('div');
    row.className = 'status-row ' + (s.key === statusFilter ? 'selected' : '');
    const label = document.createElement('div'); label.className = 'status-label'; label.textContent = s.key;
    const count = document.createElement('div'); count.className = 'status-count'; count.textContent = counts[s.key] || 0;
    const bar = document.createElement('div'); bar.className = 'status-bar ' + s.cls;
    const inner = document.createElement('div'); inner.className = 'status-bar-inner';
    const pct = Math.round(((counts[s.key] || 0) / total) * 100);
    inner.style.width = pct + '%';
    bar.appendChild(inner);
    const btn = document.createElement('button'); btn.textContent = (s.key === statusFilter) ? 'Clear' : 'Filter';
    btn.addEventListener('click', () => {
      if(s.key === statusFilter) setStatusFilter(null);
      else setStatusFilter(s.key);
    });
    row.appendChild(label);
    row.appendChild(count);
    row.appendChild(bar);
    row.appendChild(btn);
    container.appendChild(row);
  });
}

function setStatusFilter(status){
  statusFilter = status;
  renderDocs(searchInput.value.trim());
}

const clearStatusFilterBtn = document.getElementById('clear-status-filter');
clearStatusFilterBtn && clearStatusFilterBtn.addEventListener('click', () => { setStatusFilter(null); });

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]);
}

// Render small avatar in navbar. Prefer server avatar when available.
function renderNavAvatar(){
  try{
    const el = document.getElementById('nav-avatar');
    if(!el) return;
    const local = localStorage.getItem('dms_profile_avatar');
    const uname = localStorage.getItem(AUTH_KEY) || '';
    // if server available, try fetching server avatar (async) and update when received
    if(USE_SERVER && uname){
      fetch(API_BASE + '/users/' + encodeURIComponent(uname) + '/avatar').then(r => r.json()).then(j => {
        try{
          const a = j && j.avatar ? j.avatar : local;
          if(a) el.innerHTML = '<img src="'+a+'" alt="avatar">'; else { const initials = (uname||'').split(' ').map(s=>s[0]||'').join('').slice(0,2).toUpperCase() || '?'; el.innerHTML = initials; }
        }catch(e){ if(local){ el.innerHTML = '<img src="'+local+'" alt="avatar">'; } }
      }).catch(()=>{ if(local) el.innerHTML = '<img src="'+local+'" alt="avatar">'; else { const initials = (uname||'').split(' ').map(s=>s[0]||'').join('').slice(0,2).toUpperCase() || '?'; el.innerHTML = initials; } });
      return;
    }
    if(local){ el.innerHTML = '<img src="'+local+'" alt="avatar">'; return; }
    const initials = (uname||'').split(' ').map(s=>s[0]||'').join('').slice(0,2).toUpperCase() || '?'; el.innerHTML = initials;
  }catch(e){}
}
window.renderNavAvatar = renderNavAvatar;

function addOrUpdateDoc(doc){
  const idx = docs.findIndex(d => d.controlNumber === doc.controlNumber);
  if(idx >= 0){
    // preserve original createdAt when updating existing record
    const existing = docs[idx];
    doc.createdAt = existing.createdAt || existing.createdAt === 0 ? existing.createdAt : existing.createdAt;
    doc.updatedAt = Date.now();
    docs[idx] = doc;
  } else {
    // if caller provided createdAt (e.g. rename preserving original), keep it; otherwise set now
    if(!doc.createdAt) doc.createdAt = Date.now();
    doc.updatedAt = Date.now();
    docs.unshift(doc);
  }
  saveDocs();
}

function deleteDocInternal(controlNumber){
  // soft-delete: move to recycle bin
  const idx = docs.findIndex(d => d.controlNumber === controlNumber);
  if(idx === -1) return;
  const removed = docs.splice(idx,1)[0];
  saveDocs();
  try{
    const rb = loadRecycle();
    rb.unshift(Object.assign({}, removed, { deletedAt: Date.now() }));
    saveRecycle(rb);
  }catch(e){ }
}

function deleteDoc(controlNumber){
  // Soft-delete: move document to recycle bin (allow restore)
  deleteDocInternal(controlNumber);
} 

// Recycle bin helpers
function loadRecycle(){
  try{ return JSON.parse(localStorage.getItem(RECYCLE_STORAGE_KEY) || '[]'); }catch(e){ return []; }
}
function saveRecycle(arr){
  try{ localStorage.setItem(RECYCLE_STORAGE_KEY, JSON.stringify(arr)); }catch(e){}
}
function restoreFromRecycle(controlNumber){
  const rb = loadRecycle();
  const idx = rb.findIndex(d => d.controlNumber === controlNumber);
  if(idx === -1) return false;
  const doc = rb.splice(idx,1)[0];
  // remove deletedAt before restoring
  delete doc.deletedAt;
  docs.unshift(doc);
  saveDocs();
  saveRecycle(rb);
  renderDocs();
  try{ renderAdminInbox(); }catch(e){}
  return true;
}
function purgeFromRecycle(controlNumber){
  let rb = loadRecycle();
  rb = rb.filter(d => d.controlNumber !== controlNumber);
  saveRecycle(rb);
}

// Forward document to admin (user action)
function forwardDoc(controlNumber){
  let isUser = (currentUserRole === 'user');
  try{ if(!isUser && (localStorage.getItem(AUTH_ROLE_KEY) === 'user')) isUser = true; }catch(e){}
  if(!isUser){ alert('Only non-admin users can forward documents to admin.'); return; }
  const doc = docs.find(d => d.controlNumber === controlNumber);
  if(!doc){ alert('Document not found'); return; }
  doc.forwarded = true;
  doc.forwardedAt = Date.now();
  try{ doc.forwardedBy = localStorage.getItem(AUTH_KEY) || ''; }catch(e){ doc.forwardedBy = ''; }
  doc.updatedAt = Date.now();
  saveDocs();
  renderDocs();
}

// Admin receives forwarded document (acknowledge)
function receiveDoc(controlNumber){
  let isAdmin = (currentUserRole === 'admin');
  try{ if(!isAdmin && (localStorage.getItem(AUTH_ROLE_KEY) === 'admin')) isAdmin = true; }catch(e){}
  if(!isAdmin){ alert('Only admin can receive forwarded documents.'); return; }
  const doc = docs.find(d => d.controlNumber === controlNumber);
  if(!doc){ alert('Document not found'); return; }
  doc.forwarded = false;
  doc.forwardedHandledAt = Date.now();
  try{ doc.forwardedHandledBy = localStorage.getItem(AUTH_KEY) || ''; }catch(e){ doc.forwardedHandledBy = ''; }
  // mark adminStatus (Received) when admin handles it
  doc.adminStatus = 'Received';
  doc.updatedAt = Date.now();
  saveDocs();
  renderDocs();
  // refresh admin inbox view as well
  try{ renderAdminInbox(); }catch(e){}
}  

// Batch receive: mark multiple forwarded docs as received (respects current adminInboxFilter/search)
function batchReceiveForwarded(){
  let isAdmin = (currentUserRole === 'admin');
  try{ if(!isAdmin && (localStorage.getItem(AUTH_ROLE_KEY) === 'admin')) isAdmin = true; }catch(e){}
  if(!isAdmin){ alert('Only admin can receive forwarded documents.'); return; }
  // collect matching forwarded docs according to current inbox view
  try{
    loadDocs();
    const searchVal = (document.getElementById('admin-inbox-search') && document.getElementById('admin-inbox-search').value) || adminInboxQuery || '';
    const f = adminInboxFilter || 'all';
    let list = (docs || []).slice();
    if(f === 'forwarded') list = list.filter(d => d.forwarded === true);
    else if(f === 'received') list = list.filter(d => String(d.adminStatus).toLowerCase() === 'received');
    else if(f === 'returned') list = list.filter(d => String(d.adminStatus).toLowerCase() === 'returned');
    else list = list.filter(d => d.forwarded || d.adminStatus);
    if(searchVal) list = list.filter(d => ((d.controlNumber||'') + ' ' + (d.title||'') + ' ' + (d.owner||'')).toLowerCase().includes(searchVal.toLowerCase()));
    const toReceive = list.filter(d => d.forwarded === true).map(d => d.controlNumber);
    if(toReceive.length === 0){ alert('No forwarded documents matched the current view.'); return; }
    if(!confirm('Mark ' + toReceive.length + ' forwarded document(s) as received?')) return;
    toReceive.forEach(ctrl => {
      const doc = docs.find(d => d.controlNumber === ctrl);
      if(doc){ doc.forwarded = false; doc.forwardedHandledAt = Date.now(); try{ doc.forwardedHandledBy = localStorage.getItem(AUTH_KEY) || ''; }catch(e){ doc.forwardedHandledBy = ''; } doc.adminStatus = 'Received'; doc.updatedAt = Date.now(); }
    });
    saveDocs();
    try{ renderAdminInbox(); }catch(e){}
    try{ renderDocs(); }catch(e){}
    try{ updateAdminInboxBadge(); }catch(e){}
    try{ if(USE_SERVER) fetch(API_BASE + '/docs', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ docs })}).catch(()=>{}); }catch(e){}
    announceStatus('Marked ' + toReceive.length + ' forwarded document(s) as received');
  }catch(e){ console.error(e); alert('Error receiving documents'); }
}
window.batchReceiveForwarded = batchReceiveForwarded;

// Batch receive selected documents in Admin Inbox
function batchReceiveSelected(){
  let isAdmin = (currentUserRole === 'admin');
  try{ if(!isAdmin && (localStorage.getItem(AUTH_ROLE_KEY) === 'admin')) isAdmin = true; }catch(e){}
  if(!isAdmin){ alert('Only admin can receive forwarded documents.'); return; }

  const checks = document.querySelectorAll('.admin-inbox-check:checked');
  if(checks.length === 0){ alert('No documents selected.'); return; }

  if(!confirm('Mark ' + checks.length + ' selected document(s) as received?')) return;

  const toReceive = Array.from(checks).map(c => c.value);
  let count = 0;
  toReceive.forEach(ctrl => {
    const doc = docs.find(d => d.controlNumber === ctrl);
    // Only receive if it is currently forwarded
    if(doc && doc.forwarded){
      doc.forwarded = false;
      doc.forwardedHandledAt = Date.now();
      try{ doc.forwardedHandledBy = localStorage.getItem(AUTH_KEY) || ''; }catch(e){ doc.forwardedHandledBy = ''; }
      doc.adminStatus = 'Received';
      doc.updatedAt = Date.now();
      count++;
    }
  });

  if(count > 0){
    saveDocs();
    renderAdminInbox();
    try{ renderDocs(); }catch(e){}
    try{ updateAdminInboxBadge(); }catch(e){}
    announceStatus('Received ' + count + ' documents');
  } else {
    alert('Selected documents were not in a state to be received (e.g. already received or not forwarded).');
  }
}
window.batchReceiveSelected = batchReceiveSelected;

// Auth
function signIn(username, password){
  // Try server auth first
  if(USE_SERVER){
    try{
      return fetch(API_BASE + '/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username, password }) }).then(r => {
        if(!r.ok) return null;
        return r.json().then(j => {
            try{ localStorage.setItem(AUTH_KEY, j.username || username); localStorage.setItem(AUTH_ROLE_KEY, j.role || 'user'); if(j.token) localStorage.setItem(AUTH_TOKEN_KEY, j.token); }catch(e){}
          return j.role || 'user';
        }).catch(()=>null);
      }).catch(()=>null);
    }catch(e){/* fallthrough */}
  }
  // Fallback to local demo users
  // check persisted users first
  try{
    const stored = JSON.parse(localStorage.getItem(USERS_STORAGE_KEY) || '{}');
    if(stored && stored[username] && stored[username].password === password){
      return stored[username].role || 'user';
    }
  }catch(e){}
  const u = USERS[username];
  if(u && u.password === password) return u.role;
  return null;
}

// Users persistence helpers (client-side demo)
function loadUsers(){
  try{ return JSON.parse(localStorage.getItem(USERS_STORAGE_KEY) || '{}'); }catch(e){ return {}; }
}
function saveUsers(obj){
  try{ localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(obj)); }catch(e){}
}
function registerUser(username, password, role){
  if(!username || !password) return { ok:false, error:'username and password required' };
  const users = loadUsers();
  if(users[username]) return { ok:false, error:'username already exists' };
  users[username] = { password, role: role || 'user', createdAt: Date.now() };
  saveUsers(users);
  return { ok:true };
}

// Admin action: return document to originator (IC)
function returnToIC(controlNumber){
  let isAdmin = (currentUserRole === 'admin');
  try{ if(!isAdmin && (localStorage.getItem(AUTH_ROLE_KEY) === 'admin')) isAdmin = true; }catch(e){}
  if(!isAdmin){ alert('Only admin can return documents to IC.'); return; }
  const doc = docs.find(d => d.controlNumber === controlNumber);
  if(!doc){ alert('Document not found'); return; }
  doc.adminStatus = 'Returned';
  doc.returnedAt = Date.now();
  try{ doc.returnedBy = localStorage.getItem(AUTH_KEY) || ''; }catch(e){ doc.returnedBy = ''; }
  // keep optional reason
  if(arguments.length > 1 && typeof arguments[1] === 'string'){
    doc.returnReason = arguments[1];
  }
  doc.forwarded = false;
  doc.updatedAt = Date.now();
  saveDocs();
  renderDocs();
  try{ renderAdminInbox(); }catch(e){}
} 

function showDashboard(userName){
  // remove centered login if present
  loginSection.classList.remove('centered');
  loginSection.classList.add('hidden');
  dashboard.classList.remove('hidden');
  try{ if(navUser) navUser.style.display = ''; }catch(e){}
  // ensure navbar is visible on the dashboard
  try{ document.body.classList.remove('no-navbar'); }catch(e){}
  usernameDisplay.textContent = userName;
  // restore role from storage if available
  try{ currentUserRole = localStorage.getItem(AUTH_ROLE_KEY) || currentUserRole; }catch(e){}
  loadDocs();
  
  // Check for URL query param 'q' to filter docs immediately
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q');
  if(q && searchInput){ searchInput.value = q; renderDocs(q); }
  else { renderDocs(); }

  adjustUIForRole();
  try{ renderNavAvatar(); }catch(e){}
  // wire title selects to show/hide 'Other' input if present
  try{
    const newTitleSel = document.getElementById('doc-title');
    if(newTitleSel && newTitleSel.tagName === 'SELECT'){
      const other = document.getElementById('doc-title-other');
      newTitleSel.addEventListener('change', () => { if(other) other.style.display = (newTitleSel.value === 'Other') ? '' : 'none'; });
      // init
      if(other) other.style.display = (newTitleSel.value === 'Other') ? '' : 'none';
    }
    const editTitleSel = document.getElementById('edit-title');
    if(editTitleSel && editTitleSel.tagName === 'SELECT'){
      const otherE = document.getElementById('edit-title-other');
      editTitleSel.addEventListener('change', () => { if(otherE) otherE.style.display = (editTitleSel.value === 'Other') ? '' : 'none'; });
      if(otherE) otherE.style.display = (editTitleSel.value === 'Other') ? '' : 'none';
    }
  }catch(e){}
  try{ updateAdminInboxBadge(); }catch(e){}
  startInactivityWatcher();
  try{ announceStatus('Signed in'); }catch(e){}
}

function signOut(){
  loginSection.classList.remove('hidden');
  loginSection.classList.add('centered');
  dashboard.classList.add('hidden');
  try{ if(navUser) navUser.style.display = 'none'; }catch(e){}
  // hide navbar on the login screen
  try{ document.body.classList.add('no-navbar'); }catch(e){}
  usernameDisplay.textContent = '';
  currentUserRole = null;
  try{ localStorage.removeItem(AUTH_KEY); localStorage.removeItem(AUTH_ROLE_KEY); localStorage.removeItem(AUTH_TOKEN_KEY); }catch(e){}
  stopInactivityWatcher();
  try{ announceStatus('Signed out'); }catch(e){}
}

// Ensure admin inbox badge reflects current data at startup
try{ updateAdminInboxBadge(); }catch(e){}

// Adjust UI and permissions based on role (admin vs user)
function adjustUIForRole(){
  try{ currentUserRole = currentUserRole || localStorage.getItem(AUTH_ROLE_KEY) || null; }catch(e){}
  const isAdmin = (currentUserRole === 'admin');
  const roleBadge = document.getElementById('role-badge');

  // Show global controls to all users (both Admin and User)
  if(bulkDeleteBtn) bulkDeleteBtn.style.display = '';
  if(bulkUpdateBtn) bulkUpdateBtn.style.display = '';
  if(importFileInput) importFileInput.style.display = '';
  if(exportCsvBtn) exportCsvBtn.style.display = '';
  if(downloadTemplateBtn) downloadTemplateBtn.style.display = ''; 

  // Update role badge UI
  if(roleBadge){
    roleBadge.textContent = isAdmin ? 'Admin' : (currentUserRole ? 'User' : '');
    roleBadge.style.display = currentUserRole ? '' : 'none';
  }

  // Admin-only: show link to dedicated admin inbox page
  const adminInboxPageBtn = document.getElementById('admin-inbox-page-btn');
  if(adminInboxPageBtn) adminInboxPageBtn.style.display = isAdmin ? '' : 'none';

  // Admin-only: show users dashboard link
  const usersDashboardBtn = document.getElementById('users-dashboard-page-btn');
  if(usersDashboardBtn) usersDashboardBtn.style.display = isAdmin ? '' : 'none';

  // Re-render docs so per-row actions reflect role
  try{ renderDocs(searchInput.value.trim()); }catch(e){}
  try{ updateAdminInboxBadge(); }catch(e){}
}

// Events
loginForm.addEventListener('submit', e => {
  e.preventDefault();
  const u = document.getElementById('username').value.trim();
  const p = document.getElementById('password').value;
  const maybe = signIn(u,p);
  if(maybe && typeof maybe.then === 'function'){
    maybe.then(role => {
      if(role){ try{ localStorage.setItem(AUTH_KEY, u); localStorage.setItem(AUTH_ROLE_KEY, role); }catch(e){}
        showDashboard(u); currentUserRole = role; adjustUIForRole();
      } else { alert('Invalid credentials'); }
    }).catch(() => { alert('Invalid credentials'); });
  } else {
    const role = maybe;
    if(role){ try{ localStorage.setItem(AUTH_KEY, u); localStorage.setItem(AUTH_ROLE_KEY, role); }catch(e){}
      showDashboard(u); currentUserRole = role; adjustUIForRole();
    } else { alert('Invalid credentials'); }
  }
});

// Registration form handling
const showRegisterBtn = document.getElementById('show-register');
const registerForm = document.getElementById('register-form');
const cancelRegisterBtn = document.getElementById('cancel-register');
if(showRegisterBtn && registerForm){
  showRegisterBtn.addEventListener('click', (ev) => { registerForm.classList.remove('hidden'); showRegisterBtn.classList.add('hidden'); });
}
if(cancelRegisterBtn && registerForm){
  cancelRegisterBtn.addEventListener('click', (ev) => { registerForm.classList.add('hidden'); showRegisterBtn.classList.remove('hidden'); registerForm.reset(); });
}
if(registerForm){
  registerForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const u = (document.getElementById('reg-username') || {}).value && document.getElementById('reg-username').value.trim();
    const p = (document.getElementById('reg-password') || {}).value;
    const pc = (document.getElementById('reg-password-confirm') || {}).value;
    const role = (document.getElementById('reg-role') || {}).value || 'user';
    if(!u || !p){ alert('Username and password required'); return; }
    if(p !== pc){ alert('Passwords do not match'); return; }
    // Only allow creating admin if there is no admin yet or current session is admin
    const users = loadUsers();
    const hasAdmin = Object.keys(users).some(k => users[k].role === 'admin');
    const currentRole = (localStorage.getItem(AUTH_ROLE_KEY) || null);
    if(role === 'admin' && hasAdmin && currentRole !== 'admin'){
      alert('Creating additional admin accounts is restricted.');
      return;
    }

    // If server is available, attempt server-side registration first so accounts persist
    if(USE_SERVER){
      const token = localStorage.getItem(AUTH_TOKEN_KEY) || '';
      fetch(API_BASE + '/auth/register', { method: 'POST', headers: { 'Content-Type':'application/json', 'Authorization': token ? ('Bearer ' + token) : '' }, body: JSON.stringify({ username: u, password: p, role }) }).then(r => {
        if(!r.ok){ r.json().then(j => alert(j && j.error ? j.error : 'Registration failed on server')); return; }
        r.json().then(j => {
          // After successful registration, do NOT auto-login; show success and return to login form
          alert('Registration successful. Please sign in using your new credentials.');
          registerForm.classList.add('hidden'); showRegisterBtn.classList.remove('hidden'); registerForm.reset();
        }).catch(()=>{ alert('Registration succeeded but unexpected server response'); });
      }).catch(()=>{ alert('Registration failed (network)'); });
      return;
    }

    const res = registerUser(u,p,role);
    if(!res.ok){ alert(res.error || 'Unable to register'); return; }
    // For local/demo registration, do NOT auto-login; ask user to sign in
    alert('Registration successful. Please sign in using your new credentials.');
    registerForm.classList.add('hidden'); showRegisterBtn.classList.remove('hidden'); registerForm.reset();
  });
}

if(logoutBtn) logoutBtn.addEventListener('click', () => {
  signOut();
});

// Toggle user dropdown menu when clicking user button
if(userBtn && navUser){
  userBtn.addEventListener('click', (ev) => { ev.stopPropagation(); const open = navUser.classList.toggle('open'); userBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); });
  // close when clicking outside
  document.addEventListener('click', () => { if(navUser) navUser.classList.remove('open'); });
  if(userMenu) userMenu.addEventListener('click', ev => ev.stopPropagation());
  // ensure nav-user hidden by default when not signed in
  try{ if(!usernameDisplay || !usernameDisplay.textContent) navUser.style.display = 'none'; }catch(e){}
}

// Restore persisted hamburger/nav state
try{
  const wasOpen = localStorage.getItem(NAV_OPEN_KEY);
  if(wasOpen === '1' && navbar){ navbar.classList.add('open'); if(navToggle) navToggle.setAttribute('aria-expanded','true'); }
}catch(e){}

// Hamburger nav toggle for small screens
if(navToggle && navbar){
  navToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = navbar.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    try{ localStorage.setItem(NAV_OPEN_KEY, isOpen ? '1' : '0'); }catch(e){}
  });
  // close when clicking outside
  document.addEventListener('click', () => { if(navbar && navbar.classList.contains('open')) navbar.classList.remove('open'); });
}

// keyboard accessibility: Esc closes open menus
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' || e.key === 'Esc'){
    try{ if(navUser) navUser.classList.remove('open'); }catch(ex){}
    try{ if(navbar && navbar.classList.contains('open')){ navbar.classList.remove('open'); if(navToggle) navToggle.setAttribute('aria-expanded','false'); } }catch(ex){}
  }
});

// Dark Mode Logic
function initDarkMode(){
  const isDark = localStorage.getItem(DARK_MODE_KEY) === '1';
  document.body.classList.toggle('dark-mode', isDark);
  const btn = document.getElementById('dark-mode-toggle');
  if(btn) btn.textContent = isDark ? 'Light Mode' : 'Dark Mode';
}

const darkModeToggle = document.getElementById('dark-mode-toggle');
if(darkModeToggle){
  darkModeToggle.addEventListener('click', (e) => {
    e.stopPropagation(); // prevent menu close
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem(DARK_MODE_KEY, isDark ? '1' : '0');
    darkModeToggle.textContent = isDark ? 'Light Mode' : 'Dark Mode';
  });
}

// Profile is a standalone page now (profile.html); inline modal handlers removed.

// Forgot password handler (link in login forms)
document.addEventListener('click', (ev) => {
  try{
    const a = ev.target.closest && ev.target.closest('#forgot-password-link');
    if(!a) return;
    ev.preventDefault();
    const u = prompt('Enter your username to reset password:');
    if(!u) return;
    if(USE_SERVER){
      fetch(API_BASE + '/auth/forgot', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: u }) }).then(r => r.json()).then(j => {
        if(!j || !j.ok){ alert(j && j.error ? j.error : 'Unable to request reset'); return; }
        // demo: server returns token; prompt user to enter token + new password
        const token = j.token || '';
        alert('Reset token: ' + token + '\n(For demo only; in production this would be emailed.)');
        const provided = prompt('Enter the reset token you received:');
        if(!provided) return;
        const npw = prompt('Enter your new password:');
        if(!npw) return;
        fetch(API_BASE + '/auth/reset', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token: provided, password: npw }) }).then(r2 => r2.json()).then(j2 => {
          if(!j2 || !j2.ok){ alert(j2 && j2.error ? j2.error : 'Reset failed'); return; }
          alert('Password reset. Please sign in.');
        }).catch(()=>{ alert('Reset failed'); });
      }).catch(()=>{ alert('Reset request failed'); });
    } else {
      // local-demo fallback: update persisted users if present
      try{
        const users = loadUsers();
        if(!users[u]){ alert('User not found'); return; }
        const npw = prompt('Enter your new password:');
        if(!npw) return;
        users[u].password = npw;
        saveUsers(users);
        alert('Password reset locally. Please sign in.');
      }catch(e){ alert('Reset failed'); }
    }
  }catch(e){}
});

// Change password implementation (used by profile.html form)
window.changePassword = function(oldPwd, newPwd){
  if(USE_SERVER){
    const token = localStorage.getItem(AUTH_TOKEN_KEY) || '';
    return fetch(API_BASE + '/auth/change', { method: 'POST', headers: { 'Content-Type':'application/json', 'Authorization': token ? ('Bearer ' + token) : '' }, body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }) }).then(r => r.json()).then(j => { return j; }).catch(e => ({ ok:false }));
  }
  // local fallback
  try{
    const current = localStorage.getItem(AUTH_KEY);
    if(!current) return Promise.resolve({ ok:false, error:'not signed in' });
    const users = loadUsers();
    if(!users[current]) return Promise.resolve({ ok:false, error:'user not found' });
    if(users[current].password !== oldPwd) return Promise.resolve({ ok:false, error:'invalid old password' });
    users[current].password = newPwd;
    saveUsers(users);
    return Promise.resolve({ ok:true });
  }catch(e){ return Promise.resolve({ ok:false }); }
};

newDocBtn.addEventListener('click', () => {
  // open new form and clear editing state
  const wasHidden = newDocFormWrap.classList.contains('hidden');
  newDocFormWrap.classList.toggle('hidden');
  if(wasHidden){
    // opening
    delete docForm.dataset.editing;
    const saveBtn = docForm.querySelector('button[type="submit"]');
    if(saveBtn) saveBtn.textContent = 'Save';
    const ctrl = document.getElementById('control-number');
    if(!ctrl.value) ctrl.value = generateControlNumber();
    // default createdAt for new documents (user can modify via calendar)
    if(createdAtInput) createdAtInput.value = msToDatetimeLocal(Date.now());
  }
});

cancelNew.addEventListener('click', () => {
  newDocFormWrap.classList.add('hidden');
  docForm.reset();
  delete docForm.dataset.editing;
  const saveBtn = docForm.querySelector('button[type="submit"]');
  if(saveBtn) saveBtn.textContent = 'Save';
});

docForm.addEventListener('submit', e => {
  e.preventDefault();
  const controlNumber = document.getElementById('control-number').value.trim();
  // title may be a select with 'Other' option
  const titleEl = document.getElementById('doc-title');
  let title = '';
  if(titleEl){
    if(titleEl.tagName === 'SELECT' && titleEl.value === 'Other'){
      const other = document.getElementById('doc-title-other');
      title = other ? (other.value || '').trim() : '';
    } else {
      title = (titleEl.value || '').trim();
    }
  } else {
    title = '';
  }
  const owner = document.getElementById('doc-owner').value.trim();
  const status = document.getElementById('doc-status').value;
  const winsStatus = document.getElementById('wins-status').value;
  const notes = document.getElementById('doc-notes').value.trim();
  if(!controlNumber || !title){ alert('Control number and title are required'); return; }

  // Validate control number format: ECOM-YYYY-NNNN (digits)
  const ctrlRe = /^ECOM-\d{4}-\d{4}$/;
    if(!ctrlRe.test(controlNumber)){
    alert('Control Number must follow the format ECOM-YYYY-NNNN (e.g. ECOM-2026-0001)');
    const ctrlInput = document.getElementById('control-number');
    if(ctrlInput) ctrlInput.focus();
    return;
  }

  // allow user to set/modify createdAt via the datetime-local control
  const createdVal = (createdAtInput && createdAtInput.value) ? createdAtInput.value : '';
  const parsedCreated = datetimeLocalToMs(createdVal);

  // Validation: createdAt should not be in the future; warn if very old (>10 years)
  if(parsedCreated){
    const now = Date.now();
    // reject dates more than 1 minute in the future (to allow small clock skew)
    if(parsedCreated > now + 60 * 1000){
      alert('Created date cannot be in the future. Please adjust the Created field.');
      if(createdAtInput) createdAtInput.focus();
      return;
    }
    // warn for dates older than 10 years
    const tenYearsMs = 1000 * 60 * 60 * 24 * 365 * 10;
    if(parsedCreated < now - tenYearsMs){
      const yrs = Math.floor((now - parsedCreated) / (1000 * 60 * 60 * 24 * 365));
      if(!confirm(`The Created date is ${yrs} years in the past. Are you sure you want to use this date?`)){
        if(createdAtInput) createdAtInput.focus();
        return;
      }
    }
  }

  const editingKey = docForm.dataset.editing || '';
  if(editingKey){
    // editing existing record
    if(controlNumber !== editingKey){
      // control number changed: ensure no conflict
      if(docs.find(d => d.controlNumber === controlNumber)){
        alert('A document with that control number already exists. Choose a different control number.');
        const ctrlInput = document.getElementById('control-number');
        if(ctrlInput) ctrlInput.focus();
        return;
      }
      // preserve createdAt from the existing record unless user provided a valid override
      const existing = docs.find(d => d.controlNumber === editingKey);
      const createdAt = parsedCreated || (existing && existing.createdAt) || Date.now();
      // internal delete during rename (bypass admin check)
      deleteDocInternal(editingKey);
      addOrUpdateDoc({ controlNumber, title, owner, status, winsStatus, notes, createdAt, updatedAt: Date.now() });
    } else {
      // update in-place; allow createdAt modification if provided
      const existing = docs.find(d => d.controlNumber === editingKey);
      const createdAt = parsedCreated || (existing && existing.createdAt) || Date.now();
      addOrUpdateDoc({ controlNumber, title, owner, status, winsStatus, notes, createdAt, updatedAt: Date.now() });
    }
  } else {
    // new document
    // Prevent creating a duplicate control number
    if(docs.find(d => d.controlNumber === controlNumber)){
      alert('A document with that control number already exists. Use Edit to change it or choose a different control number.');
      const ctrlInput = document.getElementById('control-number');
      if(ctrlInput) ctrlInput.focus();
      return;
    }
    const createdAtForNew = parsedCreated || Date.now();
    addOrUpdateDoc({ controlNumber, title, owner, status, winsStatus, notes, createdAt: createdAtForNew, updatedAt: Date.now() });
  }

  // cleanup
  docForm.reset();
  delete docForm.dataset.editing;
  const saveBtn = docForm.querySelector('button[type="submit"]');
  if(saveBtn) saveBtn.textContent = 'Save';
  newDocFormWrap.classList.add('hidden');
  renderDocs();
});

if(docsTableBody) docsTableBody.addEventListener('click', e => {
  // Quick-edit notes handling
  const noteEditBtn = e.target.closest('button[data-note-edit]');
  if(noteEditBtn){
    const ctl = noteEditBtn.getAttribute('data-note-edit');
    const tr = noteEditBtn.closest('tr');
    const doc = docs.find(d => d.controlNumber === ctl);
    if(!tr || !doc) return;
    // replace notes cell content with textarea + save/cancel
    const notesCell = tr.querySelector('.notes-cell');
    const current = doc.notes || '';
    notesCell.innerHTML = `<textarea class="notes-inline" rows="3">${escapeHtml(current)}</textarea><button type="button" class="note-save-btn" data-note-save="${escapeHtml(ctl)}">Save</button><button type="button" class="note-cancel-btn" data-note-cancel="${escapeHtml(ctl)}">Cancel</button>`;
    const ta = notesCell.querySelector('.notes-inline');
    if(ta) ta.focus();
    return;
  }

  // Save inline note
  const noteSave = e.target.closest('button[data-note-save]');
  if(noteSave){
    const ctl = noteSave.getAttribute('data-note-save');
    const tr = noteSave.closest('tr');
    const doc = docs.find(d => d.controlNumber === ctl);
    if(!tr || !doc) return;
    const notesTa = tr.querySelector('.notes-inline');
    const newNotes = notesTa ? notesTa.value.trim() : '';
    doc.notes = newNotes;
    doc.updatedAt = Date.now();
    saveDocs();
    // restore cell
    const notesCell = tr.querySelector('.notes-cell');
    notesCell.innerHTML = `<span class="notes-text" title="${escapeHtml(doc.notes || '')}">${escapeHtml(doc.notes || '')}</span><button type="button" class="note-edit-btn" data-note-edit="${escapeHtml(doc.controlNumber)}">✎</button>`;
    renderAgeOverview();
    return;
  }

  // Cancel inline note edit
  const noteCancel = e.target.closest('button[data-note-cancel]');
  if(noteCancel){
    const ctl = noteCancel.getAttribute('data-note-cancel');
    const tr = noteCancel.closest('tr');
    const doc = docs.find(d => d.controlNumber === ctl);
    if(!tr || !doc) return;
    const notesCell = tr.querySelector('.notes-cell');
    notesCell.innerHTML = `<span class="notes-text" title="${escapeHtml(doc.notes || '')}">${escapeHtml(doc.notes || '')}</span><button type="button" class="note-edit-btn" data-note-edit="${escapeHtml(doc.controlNumber)}">✎</button>`;
    return;
  }

  const forwardBtn = e.target.closest('button[data-forward]');
  if(forwardBtn){
    const ctrl = forwardBtn.getAttribute('data-forward');
    // only non-admin users may forward
    let isUser = (currentUserRole === 'user');
    try{ if(!isUser && (localStorage.getItem(AUTH_ROLE_KEY) === 'user')) isUser = true; }catch(e){}
    if(!isUser){ alert('Only non-admin users can forward documents to admin.'); return; }
    if(confirm(`Forward document ${ctrl} to admin?`)){
      // prevent forwarding if admin already received it
      const doc = docs.find(d => d.controlNumber === ctrl);
      if(doc && String(doc.adminStatus).toLowerCase() === 'received'){ alert('This document has already been received by admin and cannot be forwarded.'); return; }
      forwardDoc(ctrl);
    }
    return;
  }
  const receiveBtn = e.target.closest('button[data-receive]');
  if(receiveBtn){
    const ctrl = receiveBtn.getAttribute('data-receive');
    // only admin may receive
    let isAdmin = (currentUserRole === 'admin');
    try{ if(!isAdmin && (localStorage.getItem(AUTH_ROLE_KEY) === 'admin')) isAdmin = true; }catch(e){}
    if(!isAdmin){ alert('Only admin may receive forwarded documents.'); return; }
    if(confirm(`Mark document ${ctrl} as received?`)){
      receiveDoc(ctrl);
    }
    return;
  }
  const retBtn = e.target.closest('button[data-return]');
  if(retBtn){
    const ctrl = retBtn.getAttribute('data-return');
    let isAdmin = (currentUserRole === 'admin');
    try{ if(!isAdmin && (localStorage.getItem(AUTH_ROLE_KEY) === 'admin')) isAdmin = true; }catch(e){}
    if(!isAdmin){ alert('Only admin may return documents to IC.'); return; }
    // prompt for optional reason when returning
    const reason = prompt(`Return document ${ctrl} to IC (optional reason):`);
    if(reason === null) return; // cancelled
    if(confirm(`Confirm returning ${ctrl}${reason ? ' with reason: "' + reason + '"' : ''}?`)){
      returnToIC(ctrl, String(reason || ''));
      renderDocs();
    }
    return;
  }
  const del = e.target.closest('button[data-delete]');
  if(del){
    const ctrl = del.getAttribute('data-delete');
    // check permission before prompting
    let isAdmin = (currentUserRole === 'admin');
    try{ if(!isAdmin && (localStorage.getItem(AUTH_ROLE_KEY) === 'admin')) isAdmin = true; }catch(e){}
    if(!isAdmin){ alert('Permission denied: only admin may delete documents.'); return; }
    if(confirm(`Delete document ${ctrl}?`)){
      deleteDoc(ctrl);
      renderDocs();
    }
    return;
  }

  const editBtn = e.target.closest('button[data-edit]');
  if(editBtn){
    const ctrl = editBtn.getAttribute('data-edit');
    const doc = docs.find(d => d.controlNumber === ctrl);
    if(!doc) { alert('Document not found'); return; }
    // populate form for editing
    document.getElementById('control-number').value = doc.controlNumber;
    document.getElementById('doc-title').value = doc.title || '';
    document.getElementById('doc-notes').value = doc.notes || '';
    document.getElementById('doc-owner').value = doc.owner || '';
    document.getElementById('doc-status').value = doc.status || 'Revision';
    document.getElementById('wins-status').value = doc.winsStatus || 'Pending for Approve';
    if(createdAtInput) createdAtInput.value = msToDatetimeLocal(doc.createdAt);
    docForm.dataset.editing = doc.controlNumber;
    const saveBtn = docForm.querySelector('button[type="submit"]');
    if(saveBtn) saveBtn.textContent = 'Update';
    newDocFormWrap.classList.remove('hidden');
  }
});

    // Live-update the table Created cell while the user edits the Created (modify) input
    if(createdAtInput){
      createdAtInput.addEventListener('input', () => {
        const val = createdAtInput.value || '';
        const ms = datetimeLocalToMs(val);
        const display = ms ? msToDatetimeLocal(ms).replace('T',' ') : '';
        const editingKey = docForm.dataset.editing || '';
        if(!editingKey) return;
        // find the row for the editing document and update the Created cell (column index 7)
        try{
          const editBtn = docsTableBody.querySelector(`button[data-edit="${editingKey}"]`);
          if(editBtn){
            const tr = editBtn.closest('tr');
            if(tr && tr.children && tr.children[7]){
              tr.children[7].textContent = display;
              // update in-memory doc preview so age and sidebars reflect change before save
              const doc = docs.find(d => d.controlNumber === editingKey);
              if(doc){
                if(ms) doc.createdAt = ms;
                // update age cell as well (column index 9)
                const ageCell = tr.children[9];
                if(ageCell){
                  const ageDays = doc.createdAt ? Math.floor((Date.now() - Number(doc.createdAt)) / (1000 * 60 * 60 * 24)) : '';
                  let ageClass = '';
                  if(ageDays !== ''){
                    if(ageDays > 30) ageClass = 'age-bad';
                    else if(ageDays > 7) ageClass = 'age-warn';
                    else ageClass = 'age-good';
                  }
                  ageCell.textContent = ageDays !== '' ? String(ageDays) : '';
                  const span = ageCell.querySelector('span.age');
                  if(span){
                    span.className = 'age ' + ageClass;
                    span.textContent = ageDays !== '' ? String(ageDays) : '';
                  }
                }
                // refresh age overview (preview only)
                renderAgeOverview();
              }
            }
          }
        }catch(e){
          // ignore selector errors
        }
      });
    }

if(docsTableBody) docsTableBody.addEventListener('change', e => {
  const sel = e.target.closest('.status-select');
  if(sel){
    const ctl = sel.getAttribute('data-control');
    const doc = docs.find(d => d.controlNumber === ctl);
    if(doc){
      doc.status = sel.value;
      doc.updatedAt = Date.now();
      saveDocs();
      renderDocs(searchInput.value.trim());
    }
    return;
  }
  const winsSel = e.target.closest('.wins-select');
  if(winsSel){
    const ctl = winsSel.getAttribute('data-control-wins');
    const doc = docs.find(d => d.controlNumber === ctl);
    if(doc){
      doc.winsStatus = winsSel.value;
      doc.updatedAt = Date.now();
      saveDocs();
      renderDocs(searchInput.value.trim());
    }
    return;
  }
});

searchBtn.addEventListener('click', () => {
  const q = searchInput.value.trim();
  renderDocs(q);
});

if(filter30DaysBtn){
  filter30DaysBtn.addEventListener('click', () => {
    dateFilter30Days = !dateFilter30Days;
    filter30DaysBtn.classList.toggle('active-filter', dateFilter30Days);
    renderDocs(searchInput.value.trim());
  });
}

clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  renderDocs();
});

// Debounced auto-search: render as the user types (300ms debounce)
function debounce(fn, wait){
  let timer = null;
  return function(...args){
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

const autoSearchHandler = debounce(() => {
  renderDocs(searchInput.value.trim());
}, 300);

searchInput.addEventListener('input', autoSearchHandler);

function generateControlNumber(){
  // Generate control number in the form ECOM-<YEAR>-<4DIGITS>
  const year = new Date().getFullYear();
  const rand = Math.floor(Math.random() * 9000) + 1000; // 4-digit
  return `ECOM-${year}-${rand}`;
}

function msToDatetimeLocal(ms){
  if(!ms) return '';
  const d = new Date(Number(ms));
  const pad = n => String(n).padStart(2,'0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth()+1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function datetimeLocalToMs(val){
  if(!val) return null;
  const d = new Date(val);
  if(isNaN(d.getTime())) return null;
  return d.getTime();
}

function formatDateForCSV(ms){
  if(!ms) return '';
  const d = new Date(Number(ms));
  const pad = n => String(n).padStart(2,'0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth()+1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}
document.addEventListener('DOMContentLoaded', () => {
  // If you want auto-login during development, uncomment:
  // showDashboard(DEMO_USER.username);
  // If a user was previously signed in, restore their session and show dashboard
  try{
    const storedUser = localStorage.getItem(AUTH_KEY);
    if(storedUser){
      showDashboard(storedUser);
    } else {
      // center login form when no user stored
      loadDocs();
      if(loginSection) loginSection.classList.add('centered');
    }
  }catch(e){
    loadDocs();
    if(loginSection) loginSection.classList.add('centered');
  }

  try{ renderNavAvatar(); }catch(e){}
  try{ initDarkMode(); }catch(e){}

  // Sidebar search & page size
  const sidebarSearch = document.getElementById('sidebar-search');
  const sidebarPageSizeEl = document.getElementById('sidebar-page-size');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  if(sidebarSearch){
    sidebarSearch.addEventListener('input', debounce(() => {
      sidebarQuery = sidebarSearch.value.trim();
      byStatusPage = 1; byWinsPage = 1;
      renderLeftSidebar();
    }, 250));
  }

  // Add "Forgot password" link to login form (if present)
  try{
    if(loginForm){
      let fp = document.getElementById('forgot-password-link');
      if(!fp){
        fp = document.createElement('button');
        fp.type = 'button';
        fp.id = 'forgot-password-link';
        fp.className = 'icon-btn';
        fp.style.background = 'transparent';
        fp.style.color = 'var(--accent)';
        fp.style.marginTop = '6px';
        fp.textContent = 'Forgot password?';
        loginForm.appendChild(fp);
      }
      fp.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const user = prompt('Enter username to reset password:');
        if(!user) return;
        // If server available, call server reset endpoint
        if(USE_SERVER){
          try{
            const r = await fetch(API_BASE + '/auth/reset', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username: user }) });
            if(!r.ok){ const j = await r.json().catch(()=>null); alert('Reset failed: ' + (j && j.error ? j.error : r.status)); return; }
            const j = await r.json().catch(()=>null);
            alert('Password for ' + user + ' has been reset. Temporary password: ' + (j && j.tempPassword ? j.tempPassword : 'password'));
            return;
          }catch(e){ console.error(e); alert('Reset failed'); }
        }
        // fallback: local users or demo users
        try{
          const stored = JSON.parse(localStorage.getItem(USERS_STORAGE_KEY) || '{}');
          if(stored && stored[user]){
            stored[user].password = 'password';
            saveUsers(stored);
            alert('Local user password reset. Temporary password: password');
            return;
          }
        }catch(e){}
        // check built-in demo users
        if(USERS[user]){
          // nothing to persist for built-in demo, just inform
          alert('Demo account. Default temporary password: password');
          return;
        }
        alert('User not found');
      });
    }
  }catch(e){}
  if(sidebarPageSizeEl){
    sidebarPageSizeEl.addEventListener('change', () => {
      sidebarPageSize = Number(sidebarPageSizeEl.value) || sidebarPageSize;
      byStatusPage = 1; byWinsPage = 1;
      renderLeftSidebar();
    });
  }

  // Sidebar toggle behavior (hide/unhide)
  if(sidebarToggle){
    // restore previous state
    const collapsed = localStorage.getItem('dms_sidebar_collapsed') === '1';
    const sb = document.getElementById('left-sidebar');
    if(collapsed && sb){
      sb.classList.add('collapsed');
      sb.setAttribute('aria-hidden','true');
      sidebarToggle.setAttribute('aria-expanded','false');
      sidebarToggle.textContent = '›';
      sidebarToggle.title = 'Show sidebar';
    }

    // Prevent missing hit area: ensure toggle sits outside normal flow and listens to clicks
    sidebarToggle.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const sb = document.getElementById('left-sidebar');
      if(!sb) return;
      const isCollapsed = sb.classList.toggle('collapsed');
      sb.setAttribute('aria-hidden', isCollapsed ? 'true' : 'false');
      sidebarToggle.setAttribute('aria-expanded', String(!isCollapsed));
      sidebarToggle.textContent = isCollapsed ? '›' : '‹';
      sidebarToggle.title = isCollapsed ? 'Show sidebar' : 'Hide sidebar';
      // persist
      try{ localStorage.setItem('dms_sidebar_collapsed', isCollapsed ? '1' : '0'); }catch(e){}
      // re-render sidebar so pagination remains consistent
      renderLeftSidebar();
    });
  }

  // Make admin inbox badges clickable across the app: set filter and open admin inbox
  document.body.addEventListener('click', (e) => {
    try{
      const btn = e.target.closest && e.target.closest('[data-admin-filter]');
      if(!btn) return;
      e.preventDefault();
      const f = btn.getAttribute('data-admin-filter');
      if(f){
        try{ setAdminInboxFilter(f); }catch(err){}
        try{ localStorage.setItem('dms_admin_inbox_filter', f); }catch(er){}
        window.location.href = 'admin_inbox.html';
      }
    }catch(e){}
  });

  // Modal behavior: open from sidebar link (prevent navigation), and support open-in-new-tab button
  document.body.addEventListener('click', e => {
    const sb = document.getElementById('left-sidebar');
    if(sb && sb.classList.contains('collapsed')) return; // ignore sidebar clicks when hidden
    const a = e.target.closest('.approved-ul a');
    if(a){
      // allow modifier clicks to open in new tab/window
      if(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) { return; }
      // left click opens modal
      e.preventDefault();
      const control = a.dataset.control || (new URL(a.href, location.href)).searchParams.get('control');
      if(control) openDocModal(control);
      return;
    }
  });

  // Modal elements
  const modal = document.getElementById('doc-modal');
  const modalOverlay = document.getElementById('modal-overlay');
  const modalClose = document.getElementById('modal-close');
  const modalForm = document.getElementById('modal-doc-form');
  const modalCancel = document.getElementById('modal-cancel');
  const modalOpenNew = document.getElementById('modal-open-new');

  function closeModal(){
    if(modal){
      modal.classList.add('hidden'); modal.setAttribute('aria-hidden','true');
      // remove focus trap
      try{ if(modal._trapHandler) modal.removeEventListener('keydown', modal._trapHandler); }catch(e){}
      try{ if(modal._previouslyFocused) modal._previouslyFocused.focus(); }
      catch(e){}
      try{ announceStatus('Dialog closed'); }catch(e){}
    }
  }
  function openModal(){
    if(modal){
      modal.classList.remove('hidden'); modal.setAttribute('aria-hidden','false');
      // focus trapping: remember previously focused element
      try{ modal._previouslyFocused = document.activeElement; }catch(e){}
      // gather focusable elements inside modal
      try{
        const focusableSelectors = 'a[href], area[href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const nodes = modal.querySelectorAll(focusableSelectors);
        modal._focusable = Array.prototype.slice.call(nodes);
        if(modal._focusable.length) modal._focusable[0].focus();
        // trap Tab within modal
        modal._trapHandler = function(e){
          if(e.key === 'Tab'){
            const first = modal._focusable[0];
            const last = modal._focusable[modal._focusable.length - 1];
            if(e.shiftKey){ if(document.activeElement === first){ e.preventDefault(); last.focus(); } }
            else { if(document.activeElement === last){ e.preventDefault(); first.focus(); } }
          }
        };
        modal.addEventListener('keydown', modal._trapHandler);
      }catch(e){}
      try{ announceStatus('Dialog opened'); }catch(e){}
    }
  }

  modalClose && modalClose.addEventListener('click', closeModal);
  modalOverlay && modalOverlay.addEventListener('click', closeModal);
  modalCancel && modalCancel.addEventListener('click', closeModal);
  document.addEventListener('keydown', (ev) => { if(ev.key === 'Escape') closeModal(); });

  // Admin inbox controls
  const adminFilter = document.getElementById('admin-inbox-filter');
  const adminSearch = document.getElementById('admin-inbox-search');
  const adminPagination = document.getElementById('admin-inbox-pagination');
  if(adminFilter){ adminFilter.addEventListener('change', () => { adminInboxFilter = adminFilter.value; adminInboxPage = 1; renderAdminInbox(); }); }
  if(adminSearch){ adminSearch.addEventListener('input', debounce(() => { adminInboxQuery = adminSearch.value.trim(); adminInboxPage = 1; renderAdminInbox(); }, 250)); }
  
  // Admin inbox selection controls
  const adminSelAll = document.getElementById('admin-select-all');
  if(adminSelAll){ adminSelAll.addEventListener('change', () => { document.querySelectorAll('.admin-inbox-check').forEach(c => c.checked = adminSelAll.checked); }); }
  const btnReceiveSel = document.getElementById('receive-selected-btn');
  if(btnReceiveSel){ btnReceiveSel.addEventListener('click', () => { if(window.batchReceiveSelected) window.batchReceiveSelected(); }); }

  // delegate clicks inside admin inbox (receive)
  const adminList = document.getElementById('admin-inbox-list');
  if(adminList){
    adminList.addEventListener('click', (ev) => {
      const rec = ev.target.closest('button[data-receive]');
      if(rec){
        const ctl = rec.getAttribute('data-receive');
        if(confirm(`Mark document ${ctl} as received?`)){
          receiveDoc(ctl);
          renderAdminInbox();
        }
        return;
      }
      const ret = ev.target.closest('button[data-return]');
      if(ret){
        const ctl = ret.getAttribute('data-return');
        // prompt for optional reason
        const reason = prompt(`Return document ${ctl} to IC (optional reason):`);
        if(reason === null) return;
        if(confirm(`Confirm returning ${ctl}${reason ? ' with reason: "' + reason + '"' : ''}?`)){
          returnToIC(ctl, String(reason || ''));
          renderAdminInbox();
        }
        return;
      }
    });
  }

  // Modal open helper
  window.openDocModal = function(control){
    const doc = docs.find(d => d.controlNumber === control);
    if(!doc){ alert('Document not found'); return; }
    // populate fields
    document.getElementById('modal-control').value = doc.controlNumber || '';
    document.getElementById('modal-original-control').value = doc.controlNumber || '';
    // Title / Status / WINS may be removed from modal; set only if elements exist
    const modalTitleEl = document.getElementById('modal-title-input');
    if(modalTitleEl) modalTitleEl.value = doc.title || '';
    const modalOwnerEl = document.getElementById('modal-owner');
    if(modalOwnerEl) modalOwnerEl.value = doc.owner || '';
    const modalStatusEl = document.getElementById('modal-status');
    if(modalStatusEl) modalStatusEl.value = doc.status || 'Revision';
    const modalWinsEl = document.getElementById('modal-wins');
    if(modalWinsEl) modalWinsEl.value = doc.winsStatus || 'Pending for Approve';
    document.getElementById('modal-created').value = msToDatetimeLocal(doc.createdAt);
    document.getElementById('modal-notes').value = doc.notes || '';
    openModal();
  };

  // Open current doc in new tab from modal
  modalOpenNew && modalOpenNew.addEventListener('click', () => {
    const ctrl = document.getElementById('modal-control').value.trim();
    if(ctrl) window.open('document.html?control=' + encodeURIComponent(ctrl),'_blank');
  });

  // Modal save handler
  modalForm && modalForm.addEventListener('submit', function(e){
    e.preventDefault();
    const controlNumber = document.getElementById('modal-control').value.trim();
    const original = document.getElementById('modal-original-control').value || '';
    const title = document.getElementById('modal-title-input') ? document.getElementById('modal-title-input').value.trim() : '';
    const owner = document.getElementById('modal-owner') ? document.getElementById('modal-owner').value.trim() : '';
    const status = document.getElementById('modal-status') ? document.getElementById('modal-status').value : '';
    const winsStatus = document.getElementById('modal-wins') ? document.getElementById('modal-wins').value : '';
    const notes = document.getElementById('modal-notes') ? document.getElementById('modal-notes').value.trim() : '';
    const createdVal = document.getElementById('modal-created').value || '';
    const createdMs = datetimeLocalToMs(createdVal);

    // basic validation: control number always required; title may be absent from modal — use existing title
    if(!controlNumber){ alert('Control number is required'); return; }
    // If title input exists, require it; otherwise fallback to existing doc title later
    const modalTitleInputEl = document.getElementById('modal-title-input');
    if(modalTitleInputEl && !title){ alert('Title is required'); return; }
    const ctrlRe = /^ECOM-\d{4}-\d{4}$/;
    if(!ctrlRe.test(controlNumber)) { alert('Control Number must follow ECOM-YYYY-NNNN'); return; }

    // ensure unique control number if changed
    if(controlNumber !== original && docs.find(d => d.controlNumber === controlNumber)){
      alert('A document with that control number already exists. Please choose another.');
      return;
    }

    // find existing doc
    const existingIdx = docs.findIndex(d => d.controlNumber === original);

    if(existingIdx < 0){
      // Creating new documents from modal is not supported (use New Document form)
      alert('Creating new documents from the modal is not supported. Use the New Document form.');
      return;
    }

    // Use existing doc values if fields are not present in modal
    const existing = docs[existingIdx];
    const finalTitle = modalTitleInputEl ? title : (existing.title || '');
    const finalStatus = document.getElementById('modal-status') ? status : (existing.status || 'Revision');
    const finalWins = document.getElementById('modal-wins') ? winsStatus : (existing.winsStatus || 'Pending for Approve');

    let createdAtFinal = createdMs || existing.createdAt || Date.now();
    const entry = { controlNumber, title: finalTitle, owner, status: finalStatus, winsStatus: finalWins, notes, createdAt: createdAtFinal, updatedAt: Date.now() };

    // update in-place
    addOrUpdateDoc(entry);
    saveDocs();
    renderDocs();
    closeModal();
  });

  // Initialize left sidebar render on load
  renderLeftSidebar();

  // start clock
  updateClock();
  setInterval(updateClock, 1000);
});

function updateClock(){
  const el = document.getElementById('clock');
  if(!el) return;
  const now = new Date();
  // Format: Mon, Dec 15 2026 — 14:05:32
  const datePart = now.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  const timePart = now.toLocaleTimeString(undefined, { hour12: false });
  el.textContent = `${datePart} — ${timePart}`;
}

// CSV export/import
function csvEscape(field){
  if(field == null) return '""';
  const s = String(field);
  if(/[,\"\n]/.test(s)){
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return '"' + s + '"';
}

function exportToCSV(){
  const headers = ['controlNumber','title','notes','owner','status','winsStatus','createdAt','updatedAt'];
  const lines = [headers.join(',')];
  docs.forEach(d => {
    const row = [d.controlNumber, d.title, d.notes || '', d.owner || '', d.status || '', d.winsStatus || '', formatDateForCSV(d.createdAt), formatDateForCSV(d.updatedAt)];
    lines.push(row.map(csvEscape).join(','));
  });
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'documents_export.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadTemplate(){
  const headers = ['controlNumber','title','notes','owner','status','winsStatus','createdAt','updatedAt'];
  const example = ['ECOM-20XX-0001','Example Document','Example notes','Alice','Revision','Pending for Approve','',''];
  const csv = headers.join(',') + '\n' + example.map(csvEscape).join(',');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'documents_template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function parseDateFromCSV(s){
  if(!s || typeof s !== 'string') return null;
  // Format: yyyy-mm-dd hh:mm:ss or dd/mm/yyyy hh:mm:ss
  const parts = s.trim().split(' ');
  if(parts.length !== 2) return null;
  const datePart = parts[0].includes('/') ? parts[0].split('/') : parts[0].split('-');
  const timePart = parts[1].split(':');
  if(datePart.length !== 3 || timePart.length !== 3) return null;
  const [hh, min, ss] = timePart.map(Number);
  let yyyy, mm, dd;
  if(parts[0].includes('/')){
    // dd/mm/yyyy
    [dd, mm, yyyy] = datePart.map(Number);
  } else {
    // yyyy-mm-dd
    [yyyy, mm, dd] = datePart.map(Number);
  }
  const d = new Date(yyyy, mm-1, dd, hh, min, ss);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function parseCSV(text){
  // Simple CSV parser supporting quoted fields and newlines inside quotes
  const rows = [];
  let cur = '';
  let row = [];
  let inQuotes = false;
  for(let i=0;i<text.length;i++){
    const ch = text[i];
    if(inQuotes){
      if(ch === '"'){
        if(text[i+1] === '"'){
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if(ch === '"'){
        inQuotes = true;
      } else if(ch === ','){
        row.push(cur);
        cur = '';
      } else if(ch === '\r'){
        // ignore
      } else if(ch === '\n'){
        row.push(cur);
        rows.push(row);
        row = [];
        cur = '';
      } else {
        cur += ch;
      }
    }
  }
  // final
  if(cur !== '' || row.length > 0){
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function importFromCSVText(text){
  const rows = parseCSV(text);
  if(rows.length === 0) return { added:0, updated:0, skipped:0 };
  const header = rows[0].map(h => String(h).trim());
  const mapIndex = {};
  header.forEach((h,i) => mapIndex[h] = i);
  const parsed = [];
  const duplicates = [];
  for(let r=1;r<rows.length;r++){
    const row = rows[r];
    if(row.length === 0) continue;
    const controlNumber = (row[mapIndex['controlNumber']] || '').trim();
    if(!controlNumber) continue;
    const title = (row[mapIndex['title']] || '').trim();
    const notes = (row[mapIndex['notes']] || '').trim();
    const owner = (row[mapIndex['owner']] || '').trim();
    const status = (row[mapIndex['status']] || 'Revision').trim();
    const winsStatus = (row[mapIndex['winsStatus']] || 'Pending for Approve').trim();
    const createdAtRaw = row[mapIndex['createdAt']];
    const updatedAtRaw = row[mapIndex['updatedAt']];
    const createdAt = createdAtRaw ? parseDateFromCSV(createdAtRaw) : null;
    const updatedAt = updatedAtRaw ? parseDateFromCSV(updatedAtRaw) : null;
    const doc = { controlNumber, title, notes, owner, status, winsStatus, createdAt, updatedAt };
    parsed.push(doc);
    if(docs.find(d => d.controlNumber === controlNumber)) duplicates.push(controlNumber);
  }

  let added = 0, updated = 0, skipped = 0;
  let overwriteDuplicates = false;
  if(duplicates.length > 0){
    const shown = duplicates.slice(0,20).join(', ');
    const more = duplicates.length > 20 ? '\n...and ' + (duplicates.length - 20) + ' more' : '';
    overwriteDuplicates = confirm(`Found ${duplicates.length} duplicate control numbers:\n${shown}${more}\n\nPress OK to overwrite duplicates, Cancel to skip duplicates.`);
  }

  parsed.forEach(doc => {
    const idx = docs.findIndex(d => d.controlNumber === doc.controlNumber);
    if(idx >= 0){
      if(overwriteDuplicates){ 
        doc.createdAt = doc.createdAt || docs[idx].createdAt; // use from CSV if valid, else preserve
        doc.updatedAt = doc.updatedAt || Date.now(); // use from CSV if valid, else set to now
        docs[idx] = doc; 
        updated++; 
      }
      else { skipped++; }
    } else { 
      doc.createdAt = doc.createdAt || Date.now(); // use from CSV if valid, else set to now
      doc.updatedAt = doc.updatedAt || Date.now(); // use from CSV if valid, else set to now
      docs.unshift(doc); 
      added++; 
    }
  });

  saveDocs();
  renderDocs();
  return { added, updated, skipped };
}

importFileInput && importFileInput.addEventListener('change', e => {
  // Allow import for both user and admin
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = function(ev){
    try{
      const text = String(ev.target.result || '');
      const res = importFromCSVText(text);
      alert(`Import complete: ${res.added} added, ${res.updated} updated, ${res.skipped} skipped`);
    } catch(err){
      alert('Failed to import CSV: ' + err.message);
    }
    importFileInput.value = '';
  };
  reader.readAsText(file, 'utf-8');
});

exportCsvBtn && exportCsvBtn.addEventListener('click', () => {
  // Allow CSV export for both user and admin
  exportToCSV();
});

downloadTemplateBtn && downloadTemplateBtn.addEventListener('click', () => {
  // Allow template download for both user and admin
  downloadTemplate();
});

const selectAll = document.getElementById('select-all');
const bulkUpdateBtn = document.getElementById('bulk-update');
const bulkDeleteBtn = document.getElementById('bulk-delete');

selectAll && selectAll.addEventListener('change', () => {
  const checkboxes = docsTableBody.querySelectorAll('.row-checkbox');
  checkboxes.forEach(cb => cb.checked = selectAll.checked);
});

bulkDeleteBtn && bulkDeleteBtn.addEventListener('click', () => {
  const selected = docsTableBody ? Array.from(docsTableBody.querySelectorAll('.row-checkbox:checked')).map(cb => cb.value) : [];
  if(selected.length === 0){
    alert('No documents selected.');
    return;
  }
  if(confirm(`Delete ${selected.length} selected documents?`)){
    selected.forEach(controlNumber => deleteDoc(controlNumber));
    renderDocs();
  }
});

bulkUpdateBtn && bulkUpdateBtn.addEventListener('click', () => {
  const selected = docsTableBody ? Array.from(docsTableBody.querySelectorAll('.row-checkbox:checked')).map(cb => cb.value) : [];
  if(selected.length === 0){
    alert('No documents selected.');
    return;
  }
  const newStatus = prompt('Enter new status for selected documents (Revision, Routing, Approved, Rejected):');
  if(newStatus && ['Revision', 'Routing', 'Approved', 'Rejected'].includes(newStatus)){
    selected.forEach(controlNumber => {
      const doc = docs.find(d => d.controlNumber === controlNumber);
      if(doc){
        doc.status = newStatus;
        doc.updatedAt = Date.now();
      }
    });
    saveDocs();
    renderDocs();
  }
});

if(docsTableBody) docsTableBody.addEventListener('change', e => {
  if(e.target.classList.contains('row-checkbox')){
    e.target.closest('tr').classList.toggle('selected-row', e.target.checked);
  }
});
