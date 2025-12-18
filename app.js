// Simple client-side Document Monitoring System
// Stores documents in localStorage under key 'dms_docs'

const STORAGE_KEY = 'dms_docs_v1';
const DEMO_USER = { username: 'admin', password: 'password' };
// Key used to persist authenticated user across refreshes
const AUTH_KEY = 'dms_auth_v1';

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

function loadDocs(){
  try{ docs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch(e){ docs = []; }
}

function saveDocs(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
}

function renderDocs(filter){
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
    tr.innerHTML = '<td colspan="10" class="muted">No documents found.</td>';
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

    tr.innerHTML = `
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
      <td>${escapeHtml(doc.winsStatus || '')}</td>
      <td>${escapeHtml(createdText)}</td>
      <td>${escapeHtml(updatedText)}</td>
      <td><span class="age ${ageClass}">${ageDays !== '' ? escapeHtml(ageDays) : ''}</span></td>
      <td class="actions">
        <button data-edit="${escapeHtml(doc.controlNumber)}" class="edit">Edit</button>
        <button data-delete="${escapeHtml(doc.controlNumber)}" class="delete">Delete</button>
      </td>
    `;
    docsTableBody.appendChild(tr);
  });
  renderTotalDocs();
  renderStatusChart();
  renderWinsChart();
  renderAgeOverview();
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

function deleteDoc(controlNumber){
  docs = docs.filter(d => d.controlNumber !== controlNumber);
  saveDocs();
}

// Auth
function signIn(username, password){
  return username === DEMO_USER.username && password === DEMO_USER.password;
}

function showDashboard(userName){
  loginSection.classList.add('hidden');
  dashboard.classList.remove('hidden');
  userInfo.classList.remove('hidden');
  usernameDisplay.textContent = userName;
  loadDocs();
  renderDocs();
}

function signOut(){
  loginSection.classList.remove('hidden');
  dashboard.classList.add('hidden');
  userInfo.classList.add('hidden');
  usernameDisplay.textContent = '';
  try{ localStorage.removeItem(AUTH_KEY); }catch(e){}
}

// Events
loginForm.addEventListener('submit', e => {
  e.preventDefault();
  const u = document.getElementById('username').value.trim();
  const p = document.getElementById('password').value;
  if(signIn(u,p)){
    // persist login so refresh doesn't return to the login form
    try{ localStorage.setItem(AUTH_KEY, u); }catch(e){}
    showDashboard(u);
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
      deleteDoc(editingKey);
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
        // find the row for the editing document and update the Created cell (column index 6)
        try{
          const editBtn = docsTableBody.querySelector(`button[data-edit="${editingKey}"]`);
          if(editBtn){
            const tr = editBtn.closest('tr');
            if(tr && tr.children && tr.children[6]){
              tr.children[6].textContent = display;
              // update in-memory doc preview so age and sidebars reflect change before save
              const doc = docs.find(d => d.controlNumber === editingKey);
              if(doc){
                if(ms) doc.createdAt = ms;
                // update age cell as well (column index 8)
                const ageCell = tr.children[8];
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
      loadDocs();
    }
  }catch(e){
    loadDocs();
  }
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
    const createdAt = createdAtRaw ? Number(createdAtRaw) : Date.now();
    const updatedAt = updatedAtRaw ? Number(updatedAtRaw) : Date.now();
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
      if(overwriteDuplicates){ docs[idx] = doc; updated++; }
      else { skipped++; }
    } else { docs.unshift(doc); added++; }
  });

  saveDocs();
  renderDocs();
  return { added, updated, skipped };
}

importFileInput && importFileInput.addEventListener('change', e => {
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
  exportToCSV();
});

downloadTemplateBtn && downloadTemplateBtn.addEventListener('click', () => {
  downloadTemplate();
});
