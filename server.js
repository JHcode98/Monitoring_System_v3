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
    db.users.push({ id, username, passwordHash: passHash, role: requestedRole, createdAt: Date.now() });
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
    return res.json({ ok:true, doc: db.docs[idx] });
  });

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
    const safe = (db.users||[]).map(u => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt }));
    return res.json({ users: safe });
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

  app.listen(PORT, ()=>{
    console.log('Monitoring System API listening on port', PORT);
  });

})();
