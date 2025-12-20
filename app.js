// Simple client-side Document Monitoring System
// Stores documents in localStorage under key 'dms_docs'

const STORAGE_KEY = 'dms_docs_v1';
// Basic demo users and roles
const USERS = {
  admin: { password: 'password', role: 'admin' },
  user: { password: 'password', role: 'user' }
};
// Key used to persist authenticated user across refreshes
const AUTH_KEY = 'dms_auth_v1';
const AUTH_ROLE_KEY = 'dms_auth_role_v1';
let currentUserRole = null;

// Elements
const loginSection = document.getElementById('login-section');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('login-form');
const usernameDisplay = document.getElementById('username-display');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');

const newDocBtn = document.getElementById('new-doc-btn');
const newDocFormWrap = document.getElementById('new-doc-form');
const docForm = document.getElementById('doc-form');
const cancelNew = document.getElementById('cancel-new');

const docsTableBody = document.querySelector('#docs-table tbody');
const searchInput = document.getElementById('search-control');
const searchBtn = document.getElementById('search-btn');
const clearSearchBtn = document.getElementById('clear-search');
const importFileInput = document.getElementById('import-file');
const exportCsvBtn = document.getElementById('export-csv');
const downloadTemplateBtn = document.getElementById('download-template');
const createdAtInput = document.getElementById('created-at');
const notesInput = document.getElementById('doc-notes');

let docs = [];
let statusFilter = null; // e.g. 'Revision', 'Approved', etc.
let winsFilter = null; // e.g. 'Approved', 'Pending for Approve', 'Rejected'
let ageStatusFilter = null; // will mirror statusFilter when filtering by age row clicks

// Sidebar search & pagination state
let sidebarQuery = '';
let sidebarPageSize = 8;
let byStatusPage = 1;
let byWinsPage = 1;

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
  try{ docs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch(e){ docs = []; }
}

function saveDocs(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
}

function renderDocs(filter){
  if(selectAll) selectAll.checked = false;
  docsTableBody.innerHTML = '';
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
  if(list.length === 0){
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="11" class="muted">No documents found.</td>';
    docsTableBody.appendChild(tr);
    return;
  }

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
      <td class="actions">
        <button data-edit="${escapeHtml(doc.controlNumber)}" title="Edit">✏️</button>
        ${isAdmin ? `<button data-delete="${escapeHtml(doc.controlNumber)}" class="delete" title="Delete">🗑️</button>` : ''}
      </td>
    `;
    docsTableBody.appendChild(tr);
  });
  renderTotalDocs();
  renderStatusChart();
  renderWinsChart();
  renderAgeOverview();  renderLeftSidebar();}

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
      nb.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); window.open(a.href, '_blank'); });
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

  // Approved by Status
  const approvedByStatusDocs = docs.filter(d => d.status === 'Approved');
  renderList(byStatus, approvedByStatusDocs, byStatusPage, byStatusPagination);

  // Approved by WINS
  const approvedByWinsDocs = docs.filter(d => d.winsStatus === 'Approved');
  renderList(byWins, approvedByWinsDocs, byWinsPage, byWinsPagination);
}

function setAgeStatusFilter(status){
  ageStatusFilter = status;
  // mirror into the main status filter for consistent behavior
  if(status) setStatusFilter(status);
  else setStatusFilter(null);
}

const clearAgeFilterBtn = document.getElementById('clear-age-filter');
clearAgeFilterBtn && clearAgeFilterBtn.addEventListener('click', () => { setAgeStatusFilter(null); });

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
  docs = docs.filter(d => d.controlNumber !== controlNumber);
  saveDocs();
}

function deleteDoc(controlNumber){
  // Enforce admin-only deletion via UI or programmatic attempts
  let isAdmin = (currentUserRole === 'admin');
  try{ isAdmin = isAdmin || (localStorage.getItem(AUTH_ROLE_KEY) === 'admin'); }catch(e){}
  if(!isAdmin){ alert('Permission denied: only admin users can delete documents.'); return; }
  deleteDocInternal(controlNumber);
}

// Auth
function signIn(username, password){
  const u = USERS[username];
  if(u && u.password === password) return u.role;
  return null;
}

function showDashboard(userName){
  // remove centered login if present
  loginSection.classList.remove('centered');
  loginSection.classList.add('hidden');
  dashboard.classList.remove('hidden');
  userInfo.classList.remove('hidden');
  usernameDisplay.textContent = userName;
  // restore role from storage if available
  try{ currentUserRole = localStorage.getItem(AUTH_ROLE_KEY) || currentUserRole; }catch(e){}
  loadDocs();
  renderDocs();
  adjustUIForRole();
  startInactivityWatcher();
}

function signOut(){
  loginSection.classList.remove('hidden');
  loginSection.classList.add('centered');
  dashboard.classList.add('hidden');
  userInfo.classList.add('hidden');
  usernameDisplay.textContent = '';
  currentUserRole = null;
  try{ localStorage.removeItem(AUTH_KEY); localStorage.removeItem(AUTH_ROLE_KEY); }catch(e){}
  stopInactivityWatcher();
}

// Adjust UI and permissions based on role (admin vs user)
function adjustUIForRole(){
  try{ currentUserRole = currentUserRole || localStorage.getItem(AUTH_ROLE_KEY) || null; }catch(e){}
  const isAdmin = (currentUserRole === 'admin');
  const roleBadge = document.getElementById('role-badge');

  // Show/hide global controls
  if(bulkDeleteBtn) bulkDeleteBtn.style.display = isAdmin ? '' : 'none';
  if(bulkUpdateBtn) bulkUpdateBtn.style.display = isAdmin ? '' : 'none';
  if(importFileInput) importFileInput.style.display = isAdmin ? '' : 'none';
  if(exportCsvBtn) exportCsvBtn.style.display = isAdmin ? '' : 'none';
  if(downloadTemplateBtn) downloadTemplateBtn.style.display = isAdmin ? '' : 'none';

  // Update role badge UI
  if(roleBadge){
    roleBadge.textContent = isAdmin ? 'Admin' : (currentUserRole ? 'User' : '');
    roleBadge.style.display = currentUserRole ? '' : 'none';
  }

  // Re-render docs so per-row actions reflect role
  try{ renderDocs(searchInput.value.trim()); }catch(e){}
}

// Events
loginForm.addEventListener('submit', e => {
  e.preventDefault();
  const u = document.getElementById('username').value.trim();
  const p = document.getElementById('password').value;
  const role = signIn(u,p);
  if(role){
    // persist login so refresh doesn't return to the login form
    try{ localStorage.setItem(AUTH_KEY, u); localStorage.setItem(AUTH_ROLE_KEY, role); }catch(e){}
    showDashboard(u);
    currentUserRole = role;
    adjustUIForRole();
  } else {
    alert('Invalid credentials');
  }
});

logoutBtn.addEventListener('click', () => {
  signOut();
});

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
  const title = document.getElementById('doc-title').value.trim();
  const owner = document.getElementById('doc-owner').value.trim();
  const status = document.getElementById('doc-status').value;
  const winsStatus = document.getElementById('wins-status').value;
  const notes = document.getElementById('doc-notes').value.trim();
  if(!controlNumber || !title){ alert('Control number and title are required'); return; }

  // Validate control number format: ECOM-YYYY-NNNN (digits)
  const ctrlRe = /^ECOM-\d{4}-\d{4}$/;
  if(!ctrlRe.test(controlNumber)){
    alert('Control Number must follow the format ECOM-YYYY-NNNN (e.g. ECOM-2025-0001)');
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

docsTableBody.addEventListener('click', e => {
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

docsTableBody.addEventListener('change', e => {
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
      sidebarToggle.setAttribute('aria-expanded','false');
      sidebarToggle.textContent = '›';
    }

    // Prevent missing hit area: ensure toggle sits outside normal flow and listens to clicks
    sidebarToggle.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const sb = document.getElementById('left-sidebar');
      if(!sb) return;
      const isCollapsed = sb.classList.toggle('collapsed');
      sidebarToggle.setAttribute('aria-expanded', String(!isCollapsed));
      sidebarToggle.textContent = isCollapsed ? '›' : '‹';
      // persist
      try{ localStorage.setItem('dms_sidebar_collapsed', isCollapsed ? '1' : '0'); }catch(e){}
      // re-render sidebar so pagination remains consistent
      renderLeftSidebar();
    });
  }

  // Modal behavior: open from sidebar link (prevent navigation), and support open-in-new-tab button
  document.body.addEventListener('click', e => {
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
    if(modal){ modal.classList.add('hidden'); modal.setAttribute('aria-hidden','true'); }
  }
  function openModal(){
    if(modal){ modal.classList.remove('hidden'); modal.setAttribute('aria-hidden','false'); }
  }

  modalClose && modalClose.addEventListener('click', closeModal);
  modalOverlay && modalOverlay.addEventListener('click', closeModal);
  modalCancel && modalCancel.addEventListener('click', closeModal);
  document.addEventListener('keydown', (ev) => { if(ev.key === 'Escape') closeModal(); });

  // Modal open helper
  window.openDocModal = function(control){
    const doc = docs.find(d => d.controlNumber === control);
    if(!doc){ alert('Document not found'); return; }
    // populate fields
    document.getElementById('modal-control').value = doc.controlNumber || '';
    document.getElementById('modal-original-control').value = doc.controlNumber || '';
    document.getElementById('modal-title-input').value = doc.title || '';
    document.getElementById('modal-owner').value = doc.owner || '';
    document.getElementById('modal-status').value = doc.status || 'Revision';
    document.getElementById('modal-wins').value = doc.winsStatus || 'Pending for Approve';
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
    const title = document.getElementById('modal-title-input').value.trim();
    const owner = document.getElementById('modal-owner').value.trim();
    const status = document.getElementById('modal-status').value;
    const winsStatus = document.getElementById('modal-wins').value;
    const notes = document.getElementById('modal-notes').value.trim();
    const createdVal = document.getElementById('modal-created').value || '';
    const createdMs = datetimeLocalToMs(createdVal);

    // basic validation
    if(!controlNumber || !title){ alert('Control number and title are required'); return; }
    const ctrlRe = /^ECOM-\d{4}-\d{4}$/;
    if(!ctrlRe.test(controlNumber)) { alert('Control Number must follow ECOM-YYYY-NNNN'); return; }

    // ensure unique control number if changed
    if(controlNumber !== original && docs.find(d => d.controlNumber === controlNumber)){
      alert('A document with that control number already exists. Please choose another.');
      return;
    }

    // find existing doc
    const existingIdx = docs.findIndex(d => d.controlNumber === original);
    let createdAtFinal = createdMs || (existingIdx >= 0 ? docs[existingIdx].createdAt : Date.now());
    const entry = { controlNumber, title, owner, status, winsStatus, notes, createdAt: createdAtFinal, updatedAt: Date.now() };

    if(existingIdx >= 0){
      // if control changed, delete old and add new
      if(controlNumber !== original){ deleteDocInternal(original); }
      addOrUpdateDoc(entry);
    } else {
      addOrUpdateDoc(entry);
    }
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
  // Format: Mon, Dec 15 2025 — 14:05:32
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
  // ensure only admin can import
  let isAdmin = (currentUserRole === 'admin');
  try{ if(!isAdmin && (localStorage.getItem(AUTH_ROLE_KEY) === 'admin')) isAdmin = true; }catch(e){}
  if(!isAdmin){ alert('Permission denied: only admin may import CSV.'); importFileInput.value = ''; return; }
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
  let isAdmin = (currentUserRole === 'admin');
  try{ if(!isAdmin && (localStorage.getItem(AUTH_ROLE_KEY) === 'admin')) isAdmin = true; }catch(e){}
  if(!isAdmin){ alert('Permission denied: only admin may export CSV.'); return; }
  exportToCSV();
});

downloadTemplateBtn && downloadTemplateBtn.addEventListener('click', () => {
  let isAdmin = (currentUserRole === 'admin');
  try{ if(!isAdmin && (localStorage.getItem(AUTH_ROLE_KEY) === 'admin')) isAdmin = true; }catch(e){}
  if(!isAdmin){ alert('Permission denied: only admin may download the template.'); return; }
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
  // ensure only admin may perform bulk delete
  let isAdmin = (currentUserRole === 'admin');
  try{ if(!isAdmin && (localStorage.getItem(AUTH_ROLE_KEY) === 'admin')) isAdmin = true; }catch(e){}
  if(!isAdmin){ alert('Permission denied: only admin can bulk delete.'); return; }
  const selected = Array.from(docsTableBody.querySelectorAll('.row-checkbox:checked')).map(cb => cb.value);
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
  // only admin permitted to bulk-update
  let isAdmin = (currentUserRole === 'admin');
  try{ if(!isAdmin && (localStorage.getItem(AUTH_ROLE_KEY) === 'admin')) isAdmin = true; }catch(e){}
  if(!isAdmin){ alert('Permission denied: only admin can perform bulk updates.'); return; }
  const selected = Array.from(docsTableBody.querySelectorAll('.row-checkbox:checked')).map(cb => cb.value);
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

docsTableBody.addEventListener('change', e => {
  if(e.target.classList.contains('row-checkbox')){
    e.target.closest('tr').classList.toggle('selected-row', e.target.checked);
  }
});
