const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const DB_FILE = path.join(__dirname, 'db.json');
const PORT = process.env.PORT || 3000;

async function readDB(){
  try{
    const txt = await fs.readFile(DB_FILE, 'utf8');
    return JSON.parse(txt);
  }catch(e){
    return null;
  }
}
async function writeDB(data){
  await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

async function ensureDB(){
  let db = await readDB();
  if(!db){
    const adminPass = bcrypt.hashSync('password', 10);
    const userPass = bcrypt.hashSync('password', 10);
    db = {
      users: [
        { id: 'u-admin', username: 'admin', passwordHash: adminPass, role: 'admin' },
        { id: 'u-user', username: 'user', passwordHash: userPass, role: 'user' }
      ],
      docs: [],
      sessions: {}
    };
    await writeDB(db);
  }
  return db;
}

(async ()=>{
  await ensureDB();
  const app = express();
  app.use(cors());
  app.use(express.json());
  // middleware: update lastSeen on requests that provide a valid session token
  app.use(async (req, res, next) => {
    try{
      const token = getSessionFromReq(req);
      if(token){
        const db = await readDB();
        db.sessions = db.sessions || {};
        if(db.sessions[token]){
          db.sessions[token].lastSeen = Date.now();
          // persist lastSeen (best-effort)
          await writeDB(db);
        }
      }
    }catch(e){}
    next();
  });
  const http = require('http');
  const WebSocket = require('ws');

  app.get('/api/ping', (req,res) => res.json({ok:true}));

  app.post('/api/auth/login', async (req,res) => {
    const { username, password } = req.body || {};
    if(!username || !password) return res.status(400).json({ error: 'username/password required' });
    const db = await readDB();
    const user = (db.users||[]).find(u => u.username === username);
    if(!user) return res.status(401).json({ error: 'invalid' });
    const match = bcrypt.compareSync(password, user.passwordHash);
    if(!match) return res.status(401).json({ error: 'invalid' });
    const token = uuidv4();
    db.sessions = db.sessions || {};
    db.sessions[token] = { username: user.username, role: user.role, created: Date.now() };
    await writeDB(db);
    return res.json({ ok:true, username: user.username, role: user.role, token });
  });

  // Forgot password: create a short-lived reset token (demo - returns token)
  app.post('/api/auth/forgot', async (req,res) => {
    const { username } = req.body || {};
    if(!username) return res.status(400).json({ error: 'username required' });
    const db = await readDB();
    const user = (db.users||[]).find(u => u.username === username);
    if(!user) return res.status(404).json({ error: 'user not found' });
    db.resetTokens = db.resetTokens || {};
    const token = uuidv4();
    db.resetTokens[token] = { username: user.username, expires: Date.now() + (60 * 60 * 1000) };
    await writeDB(db);
    // In a real app we'd email the token. For this demo, return it so UI can use it.
    return res.json({ ok:true, token });
  });

  // Reset password using token
  app.post('/api/auth/reset', async (req,res) => {
    const { token, password } = req.body || {};
    if(!token || !password) return res.status(400).json({ error: 'token and password required' });
    const db = await readDB();
    db.resetTokens = db.resetTokens || {};
    const entry = db.resetTokens[token];
    if(!entry) return res.status(400).json({ error: 'invalid token' });
    if(entry.expires < Date.now()){ delete db.resetTokens[token]; await writeDB(db); return res.status(400).json({ error: 'token expired' }); }
    const user = (db.users||[]).find(u => u.username === entry.username);
    if(!user) return res.status(404).json({ error: 'user not found' });
    user.passwordHash = bcrypt.hashSync(password, 10);
    delete db.resetTokens[token];
    await writeDB(db);
    return res.json({ ok:true });
  });

  // Change password for authenticated session
  app.post('/api/auth/change', async (req,res) => {
    const token = getSessionFromReq(req);
    const { oldPassword, newPassword } = req.body || {};
    if(!token || !oldPassword || !newPassword) return res.status(400).json({ error: 'auth + old/new password required' });
    const db = await readDB();
    const session = db.sessions && db.sessions[token];
    if(!session) return res.status(403).json({ error: 'invalid session' });
    const user = (db.users||[]).find(u => u.username === session.username);
    if(!user) return res.status(404).json({ error: 'user not found' });
    const ok = bcrypt.compareSync(oldPassword, user.passwordHash);
    if(!ok) return res.status(401).json({ error: 'invalid old password' });
    user.passwordHash = bcrypt.hashSync(newPassword, 10);
    await writeDB(db);
    return res.json({ ok:true });
  });

  // Register new user (persisted)
  app.post('/api/auth/register', async (req,res) => {
    const { username, password, role } = req.body || {};
    if(!username || !password) return res.status(400).json({ error: 'username/password required' });
    const db = await readDB();
    const exists = (db.users||[]).find(u => u.username === username);
    if(exists) return res.status(409).json({ error: 'username exists' });

    // Admin creation rules: if role === 'admin' and an admin exists, require admin token
    const requestedRole = role === 'admin' ? 'admin' : 'user';
    const anyAdmin = (db.users||[]).some(u => u.role === 'admin');
    if(requestedRole === 'admin' && anyAdmin){
      // require Authorization header with valid admin session
      const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i,'');
      if(!auth || !db.sessions || !db.sessions[auth] || db.sessions[auth].role !== 'admin'){
        return res.status(403).json({ error: 'admin token required to create another admin' });
      }
    }

    const passHash = bcrypt.hashSync(password, 10);
    const id = uuidv4();
    db.users = db.users || [];
    db.users.push({ id, username, passwordHash: passHash, role: requestedRole, createdAt: Date.now(), avatar: null });
    await writeDB(db);
    return res.json({ ok:true, username, role: requestedRole });
  });

  app.post('/api/auth/logout', async (req,res) => {
    const { token } = req.body || {};
    const db = await readDB();
    if(db.sessions && token && db.sessions[token]){
      delete db.sessions[token];
      await writeDB(db);
    }
    return res.json({ ok:true });
  });

  // simple password reset endpoint for demo: resets to a temporary password 'password'
  app.post('/api/auth/reset', async (req,res) => {
    const { username } = req.body || {};
    if(!username) return res.status(400).json({ error: 'username required' });
    const db = await readDB();
    const user = (db.users||[]).find(u => u.username === username);
    if(!user) return res.status(404).json({ error: 'not found' });
    const temp = 'password';
    user.passwordHash = bcrypt.hashSync(temp, 10);
    await writeDB(db);
    return res.json({ ok:true, username: user.username, tempPassword: temp });
  });

  // docs endpoints (simple)
  app.get('/api/docs', async (req,res) => {
    const db = await readDB();
    return res.json({ docs: db.docs || [] });
  });

  app.post('/api/docs', async (req,res) => {
    const { docs } = req.body || {};
    if(!Array.isArray(docs)) return res.status(400).json({ error: 'docs array required' });
    const db = await readDB();
    db.docs = docs;
    await writeDB(db);
    // broadcast to websocket clients that docs changed
    try{ broadcast({ type: 'docs_updated', docsCount: (db.docs || []).length, counts: computeAdminCounts(db.docs || []) }); }catch(e){}
    return res.json({ ok:true });
  });

  app.get('/api/docs/:control', async (req,res) => {
    const control = req.params.control;
    const db = await readDB();
    const doc = (db.docs||[]).find(d => d.controlNumber === control);
    if(!doc) return res.status(404).json({ error: 'not found' });
    return res.json({ doc });
  });

  app.put('/api/docs/:control', async (req,res) => {
    const control = req.params.control;
    const payload = req.body || {};
    const db = await readDB();
    const idx = (db.docs||[]).findIndex(d => d.controlNumber === control);
    if(idx === -1) return res.status(404).json({ error: 'not found' });
    db.docs[idx] = Object.assign({}, db.docs[idx], payload);
    await writeDB(db);
    try{ broadcast({ type: 'docs_updated', docsCount: (db.docs || []).length, counts: computeAdminCounts(db.docs || []) }); }catch(e){}
    return res.json({ ok:true, doc: db.docs[idx] });
  });

  // helper to compute admin counts server-side
  function computeAdminCounts(docs){
    const res = { forwarded:0, received:0, returned:0 };
    (docs||[]).forEach(d => { if(d && d.forwarded) res.forwarded++; if(d && d.adminStatus === 'Received') res.received++; if(d && d.adminStatus === 'Returned') res.returned++; });
    return res;
  }

  // Helper to resolve session token from Authorization header or body
  function getSessionFromReq(req){
    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i,'') || (req.body && req.body.token) || null;
    return auth;
  }

  // List users (admin only)
  app.get('/api/users', async (req,res) => {
    const db = await readDB();
    const token = getSessionFromReq(req);
    if(!token || !db.sessions || !db.sessions[token] || db.sessions[token].role !== 'admin'){
      return res.status(403).json({ error: 'admin required' });
    }
    // include avatar if present (data URL) so admin dashboard can render it
    const safe = (db.users||[]).map(u => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt, avatar: u.avatar || null }));
    return res.json({ users: safe });
  });

  // List active sessions (admin only)
  app.get('/api/sessions', async (req, res) => {
    const db = await readDB();
    const token = getSessionFromReq(req);
    if(!token || !db.sessions || !db.sessions[token] || db.sessions[token].role !== 'admin'){
      return res.status(403).json({ error: 'admin required' });
    }
    const list = Object.keys(db.sessions || {}).map(t => {
      const s = db.sessions[t];
      return { token: t, username: s.username, role: s.role, created: s.created, lastSeen: s.lastSeen || s.created };
    });
    return res.json({ sessions: list });
  });

  // GET user's avatar (public for demo)
  app.get('/api/users/:username/avatar', async (req,res) => {
    const { username } = req.params || {};
    const db = await readDB();
    const user = (db.users||[]).find(u => u.username === username);
    if(!user) return res.status(404).json({ error: 'not found' });
    return res.json({ avatar: user.avatar || null });
  });

  // PUT user's avatar (must be owner or admin)
  app.put('/api/users/:username/avatar', async (req,res) => {
    const { username } = req.params || {};
    const { avatar } = req.body || {};
    if(!(typeof avatar === 'string' || avatar === null)) return res.status(400).json({ error: 'avatar string or null required' });
    const db = await readDB();
    const token = getSessionFromReq(req);
    const session = token && db.sessions && db.sessions[token];
    if(!session) return res.status(403).json({ error: 'auth required' });
    if(session.username !== username && session.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const user = (db.users||[]).find(u => u.username === username);
    if(!user) return res.status(404).json({ error: 'not found' });
    user.avatar = avatar;
    await writeDB(db);
    return res.json({ ok:true });
  });

  // Update user role (admin only)
  app.put('/api/users/:username', async (req,res) => {
    const { username } = req.params || {};
    const { role } = req.body || {};
    const db = await readDB();
    const token = getSessionFromReq(req);
    if(!token || !db.sessions || !db.sessions[token] || db.sessions[token].role !== 'admin'){
      return res.status(403).json({ error: 'admin required' });
    }
    const user = (db.users||[]).find(u => u.username === username);
    if(!user) return res.status(404).json({ error: 'not found' });
    const newRole = role === 'admin' ? 'admin' : 'user';
    // prevent removing last admin
    if(user.role === 'admin' && newRole !== 'admin'){
      const otherAdmins = (db.users||[]).filter(u => u.role === 'admin' && u.username !== username);
      if(otherAdmins.length === 0) return res.status(400).json({ error: 'cannot remove last admin' });
    }
    user.role = newRole;
    await writeDB(db);
    return res.json({ ok:true, username: user.username, role: user.role });
  });

  // Delete user (admin only)
  app.delete('/api/users/:username', async (req,res) => {
    const { username } = req.params || {};
    const db = await readDB();
    const token = getSessionFromReq(req);
    if(!token || !db.sessions || !db.sessions[token] || db.sessions[token].role !== 'admin'){
      return res.status(403).json({ error: 'admin required' });
    }
    const idx = (db.users||[]).findIndex(u => u.username === username);
    if(idx === -1) return res.status(404).json({ error: 'not found' });
    // prevent deleting last admin
    const user = db.users[idx];
    if(user.role === 'admin'){
      const otherAdmins = (db.users||[]).filter(u => u.role === 'admin' && u.username !== username);
      if(otherAdmins.length === 0) return res.status(400).json({ error: 'cannot delete last admin' });
    }
    db.users.splice(idx,1);
    await writeDB(db);
    return res.json({ ok:true });
  });

  // attach WebSocket server to the HTTP server so same port is used
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server, path: '/ws' });

  function broadcast(obj){
    try{
      const txt = JSON.stringify(obj || {});
      wss.clients.forEach(c => { try{ if(c.readyState === WebSocket.OPEN) c.send(txt); }catch(e){} });
    }catch(e){}
  }

  server.listen(PORT, ()=>{
    console.log('Monitoring System API (with WS) listening on port', PORT);
  });

})();
