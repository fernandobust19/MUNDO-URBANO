// server.js — servidor Express + socket.io (estado simple en memoria)
// Cargar variables de entorno desde .env si existe
try { require('dotenv').config(); } catch(_) {}
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const brain = require('./brain');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
// Cargar configuración centralizada
const cfg = require('./server/config');
// Directorio de comprobantes (configurable). En producción usa un disco persistente.
const PAGOS_DIR = process.env.PAGOS_DIR || path.join(__dirname, 'pagos');
// Pago sencillo: secret compartido para webhooks y generación de intents
const PAYMENT_SECRET = process.env.PAYMENT_SECRET || 'dev-pay-secret';
const PAY_BASE_LINK = process.env.PAY_BASE_LINK || 'https://ppls.me/ptnd6qxvmV1Km0yys7Hg';
// Intenciones de pago en memoria (token -> { userId, createdAt, creditedAt?, txId? })
const pendingPayments = new Map();

// --- Email (SMTP) para notificar subida de comprobantes ---
// Configurar via variables de entorno, por ejemplo para Gmail con App Password:
// SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_SECURE=true SMTP_USER=tu@gmail.com SMTP_PASS=xxxx NOTIFY_TO=ventasporweb19@gmail.com
const SMTP_HOST = process.env.SMTP_HOST || null;
const SMTP_PORT = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT,10) : null;
const SMTP_SECURE = String(process.env.SMTP_SECURE||'true').toLowerCase() !== 'false';
const SMTP_USER = process.env.SMTP_USER || null;
const SMTP_PASS = process.env.SMTP_PASS || null;
const SMTP_DEBUG = String(process.env.SMTP_DEBUG||'false').toLowerCase() === 'true';
const NOTIFY_TO = process.env.NOTIFY_TO || 'ventasporweb19@gmail.com';
let mailer = null;
if(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS){
  try{
    mailer = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE, auth: { user: SMTP_USER, pass: SMTP_PASS }, logger: SMTP_DEBUG, debug: SMTP_DEBUG });
    // Verificar conexión/credenciales al inicio (ayuda a diagnosticar por consola)
    mailer.verify().then(()=>{
      console.log(`[SMTP] listo: ${SMTP_USER}@${SMTP_HOST}:${SMTP_PORT} secure=${SMTP_SECURE}`);
    }).catch(err=>{
      console.warn('[SMTP] verificación falló:', err && err.message ? err.message : err);
    });
  }catch(e){ console.warn('No se pudo inicializar SMTP:', e.message); }
} else {
  console.warn('SMTP no configurado: define SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS para enviar correos.');
}

// Silenciar el error de favicon.ico en la consola del navegador
app.get('/favicon.ico', (req, res) => res.status(204).send());

app.use(express.static(path.join(__dirname, 'public')));
// Exponer carpeta 'login' para imágenes de UI de autenticación
app.use('/login', express.static(path.join(__dirname, 'login')));
// Servir assets descargados
app.use('/game-assets', express.static(path.join(__dirname, 'game-assets')));
// Exponer carpeta de comprobantes (si no existe, crearla)
try{ if(!fs.existsSync(PAGOS_DIR)) fs.mkdirSync(PAGOS_DIR, { recursive:true }); }catch(_){}
app.use('/pagos', express.static(PAGOS_DIR));
// Aumentar límite del body JSON para permitir data URLs de avatar
app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());

// Sesión simple via cookie firmada manualmente (sin exponer datos)
const SESS_COOKIE = 'sid';
const SESS_SECRET = process.env.SESS_SECRET || 'dev-secret-change-me';
function sign(val){ return val + '.' + crypto.createHmac('sha256', SESS_SECRET).update(val).digest('hex'); }
function unsign(signed){
  if(!signed || typeof signed !== 'string') return null;
  const i = signed.lastIndexOf('.'); if(i<0) return null; const val = signed.slice(0, i); const mac = signed.slice(i+1);
  const ok = crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(crypto.createHmac('sha256', SESS_SECRET).update(val).digest('hex')));
  return ok ? val : null;
}
function setSession(res, userId){ const v = sign(userId); res.cookie(SESS_COOKIE, v, { httpOnly:true, sameSite:'lax', maxAge: 1000*60*60*24*30 }); }
function clearSession(res){ res.clearCookie(SESS_COOKIE); }
function getSessionUserId(req){ const raw = req.cookies?.[SESS_COOKIE]; const uid = unsign(raw); return uid; }

// API de autenticación
app.post('/api/register', (req, res) => {
  try{
  const { username, password, country, email, phone, gender } = req.body || {};
  const out = brain.registerUser(username, password, { country, email, phone, gender });
    if(!out.ok) return res.status(400).json(out);
    setSession(res, out.user.id);
  return res.json({ ok: true, user: out.user, progress: brain.getProgress(out.user.id) });
  }catch(e){ return res.status(500).json({ ok:false, msg:'Error' }); }
});

app.post('/api/login', (req, res) => {
  try{
    const { username, password } = req.body || {};
    const out = brain.verifyLogin(username, password);
    if(!out.ok) return res.status(401).json(out);
    setSession(res, out.user.id);
  // Restaurar saldo desde ledger (si existe snapshot)
  try{ brain.restoreMoneyFromLedger(out.user.id); }catch(e){}
  return res.json({ ok:true, user: out.user, progress: brain.getProgress(out.user.id) });
  }catch(e){ return res.status(500).json({ ok:false, msg:'Error' }); }
});

app.post('/api/logout', (req, res) => { try{ const uid = getSessionUserId(req); if(uid){ try{ brain.saveMoneySnapshot(uid, 'logout'); }catch(e){} } clearSession(res); return res.json({ ok:true }); }catch(e){ return res.status(500).json({ ok:false }); } });

app.get('/api/me', (req, res) => {
  const uid = getSessionUserId(req);
  if(!uid) return res.status(401).json({ ok:false });
  const user = brain.getUserById(uid);
  if(!user) return res.status(401).json({ ok:false });
  return res.json({ ok:true, user: { id:user.id, username:user.username, gender: user.gender||null, country: user.country||null, email: user.email||null, phone: user.phone||null }, progress: brain.getProgress(uid) });
});

// Estado del gobierno (solo lectura)
app.get('/api/gov', (req, res) => {
  try{ return res.json({ ok:true, government: brain.getGovernment() }); }catch(e){ return res.status(500).json({ ok:false }); }
});

// Casas rentadas con inicial (para que nuevos clientes las pinten igual)
app.get('/api/rentals', (req,res)=>{
  try{
    const out = [];
    try{
      const users = brain.getGovernment() && Object.keys(brain.getGovernment());
    }catch(_){ }
    // Extraer de progreso
    try{
      const all = []; // recolectar desde brain.db.progress
      // Acceso interno directo (no expuesto antes):
      const internal = require('./brain');
      // internal no expone directamente el objeto, así que hacer require cache: ya está cargado
    }catch(_){ }
    const dbPath = path.join(__dirname,'brain.db.json');
    try{
      if(fs.existsSync(dbPath)){
        const raw = JSON.parse(fs.readFileSync(dbPath,'utf8'));
        if(raw && raw.progress){
          for(const uid of Object.keys(raw.progress)){
            const pr = raw.progress[uid];
            if(pr && pr.rentalHouse){ out.push({ userId: uid, rentalHouse: pr.rentalHouse, rentedHouseIdx: pr.rentedHouseIdx||null, initial: pr.rentalHouse.initial||null }); }
          }
        }
      }
    }catch(_){ }
    return res.json({ ok:true, rentals: out });
  }catch(e){ return res.status(500).json({ ok:false }); }
});

// Añadir fondos al gobierno (demo; en producción debería requerir admin)
app.post('/api/gov/funds/add', (req, res) => {
  try{
    const amount = Number(req.body?.amount||0);
    if(!Number.isFinite(amount) || amount===0) return res.status(400).json({ ok:false });
    const out = brain.addGovernmentFunds(amount);
    if(!(out && out.ok)) return res.status(400).json({ ok:false });
    return res.json({ ok:true, funds: out.funds });
  }catch(e){ return res.status(500).json({ ok:false }); }
});


app.post('/api/change-password', (req, res) => {
  const uid = getSessionUserId(req);
  if(!uid) return res.status(401).json({ ok:false, msg:'No autenticado' });
  const { newPassword } = req.body || {};
  if(typeof newPassword !== 'string' || newPassword.length < 8) return res.status(400).json({ ok:false, msg:'Contraseña inválida' });
  const out = brain.changePassword(uid, newPassword);
  if(!out.ok) return res.status(400).json(out);
  return res.json({ ok:true });
});

app.post('/api/progress', (req, res) => {
  const uid = getSessionUserId(req);
  if(!uid) return res.status(401).json({ ok:false });
  const out = brain.updateProgress(uid, req.body || {});
  return res.json(out);
});

// ==== Pagos (demo) ====
// 1) Crear intención para adjuntar un token al link del proveedor
app.post('/api/pay/create-intent', (req, res) => {
  try{
    const uid = getSessionUserId(req);
    if(!uid) return res.status(401).json({ ok:false, msg:'No autenticado' });
    const token = crypto.randomBytes(16).toString('hex');
    pendingPayments.set(token, { userId: uid, createdAt: Date.now() });
    const url = PAY_BASE_LINK + (PAY_BASE_LINK.includes('?') ? '&' : '?') + 'ref=' + token;
    return res.json({ ok:true, url, ref: token });
  }catch(e){ return res.status(500).json({ ok:false }); }
});

// 2) Webhook del proveedor: debe enviar cabecera x-pay-secret o firma HMAC del cuerpo
// Estructura esperada del body: { txId, amountUsd, currency:'USD', ref }
app.post('/api/pay/webhook', (req, res) => {
  try{
    // Verificación básica con secreto compartido
    const hdr = req.headers['x-pay-secret'] || req.headers['x-pay-signature'];
    const provided = String(hdr || '');
    // Permitir dos modos: coincidencia exacta del secreto o HMAC del body
    let verified = false;
    if(provided && provided.length < 80){ verified = crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(PAYMENT_SECRET)); }
    if(!verified){
      try{
        const raw = JSON.stringify(req.body||{});
        const mac = crypto.createHmac('sha256', PAYMENT_SECRET).update(raw).digest('hex');
        verified = !!provided && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(mac));
      }catch(_){ }
    }
    if(!verified) return res.status(401).json({ ok:false });

    const { txId, amountUsd, currency, ref } = req.body || {};
    if(!txId || !ref) return res.status(400).json({ ok:false, msg:'faltan datos' });
    if(String(currency||'USD').toUpperCase() !== 'USD' || Number(amountUsd) < 5){
      return res.status(400).json({ ok:false, msg:'importe no válido' });
    }
    const intent = pendingPayments.get(String(ref));
    if(!intent){ return res.status(404).json({ ok:false, msg:'ref desconocido' }); }
    const userId = intent.userId;
    // Idempotencia por txId
    const reason = 'payment:' + txId;
    const out = brain.addMoneyOnce(userId, 500, reason);
    if(out && out.ok){ intent.creditedAt = Date.now(); intent.txId = txId; pendingPayments.set(String(ref), intent); }
    return res.json({ ok:true, credited: !!(out && out.ok), duplicated: !!(out && out.duplicated) });
  }catch(e){ return res.status(500).json({ ok:false }); }
});

// 3) Consulta de estado (permite al cliente verificar si ya se acreditó)
app.get('/api/pay/status', (req, res) => {
  try{
    const uid = getSessionUserId(req);
    if(!uid) return res.status(401).json({ ok:false });
    const ref = String(req.query.ref||'');
    const intent = pendingPayments.get(ref);
    if(!intent || intent.userId !== uid) return res.status(404).json({ ok:false });
    return res.json({ ok:true, credited: !!intent.creditedAt, txId: intent.txId||null });
  }catch(e){ return res.status(500).json({ ok:false }); }
});

// 3b) URL de retorno/confirmación (GET) por si el proveedor solo redirige (sin webhook)
// Acepta: ?ref=...&txId=...&amountUsd=5&currency=USD&ts=...&sig=HMAC
// Donde sig opcionalmente puede ser HMAC-SHA256(secret, `${ref}|${txId}|${amountUsd||''}|${currency||''}|${ts||''}`)
// Si no hay 'sig', se requiere currency USD y amountUsd >= 5.
app.get('/api/pay/return', (req, res) => {
  try{
    const ref = String(req.query.ref||'');
    const txId = String(req.query.txId||'').trim();
    const amountUsd = req.query.amountUsd != null ? Number(req.query.amountUsd) : null;
    const currency = String(req.query.currency||'').toUpperCase();
    const ts = String(req.query.ts||'');
    const sig = String(req.query.sig||'');
    if(!ref || !txId){ return res.status(400).send('missing ref/txId'); }

    // Verificación opcional por firma HMAC
    let sigOk = false;
    try{
      const raw = [ref, txId, (amountUsd!=null?amountUsd:''), currency, ts].join('|');
      const mac = crypto.createHmac('sha256', PAYMENT_SECRET).update(raw).digest('hex');
      if(sig && mac.length === sig.length){ sigOk = crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(sig)); }
    }catch(_){ }

    const basicOk = (amountUsd!=null) && amountUsd >= 5 && (currency||'USD') === 'USD';
    if(!(sigOk || basicOk)){
      // Si no pasa validación, no acreditar; redirigir con estado de error.
      return res.redirect('/?pay=' + encodeURIComponent('invalid'));
    }

    const intent = pendingPayments.get(ref);
    if(!intent){ return res.redirect('/?pay=' + encodeURIComponent('unknown')); }
    // Acreditar +500 de forma idempotente por txId
    const reason = 'payment:' + txId;
    const out = brain.addMoneyOnce(intent.userId, 500, reason);
    if(out && out.ok){ intent.creditedAt = Date.now(); intent.txId = txId; pendingPayments.set(ref, intent); }
    const status = (out && out.ok && !out.duplicated) ? 'credited' : 'already';
    return res.redirect('/?pay=' + encodeURIComponent(status));
  }catch(e){ return res.status(500).send('error'); }
});

// 4) Subida de comprobante manual -> carpeta /pagos
app.post('/api/pay/upload-proof', async (req, res) => {
  try{
    const uid = getSessionUserId(req);
    if(!uid) return res.status(401).json({ ok:false });
    const { filename, mime, data } = req.body || {};
    if(!data || typeof data !== 'string') return res.status(400).json({ ok:false, msg:'faltan datos' });
    const safeName = String(filename||'comprobante').replace(/[^a-zA-Z0-9_.-]/g,'_');
    const ext = (safeName.includes('.') ? safeName.split('.').pop().toLowerCase() : 'bin');
    // Validar tipo: solo jpg/png
    const allowedExt = new Set(['jpg','jpeg','png']);
    const allowedMime = new Set(['image/jpeg','image/png']);
    if(!(allowedExt.has(ext) && (!mime || allowedMime.has(String(mime).toLowerCase())))){
      return res.status(400).json({ ok:false, msg:'Formato no permitido. Usa JPG o PNG.' });
    }
  const ts = new Date().toISOString().replace(/[:]/g,'-');
    const outDir = PAGOS_DIR;
    if(!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outName = `${ts}-${uid}.${ext}`;
    const outPath = path.join(outDir, outName);
    const buf = Buffer.from(data, 'base64');
    fs.writeFileSync(outPath, buf);
    // Guardar pequeño .json con metadatos
  const userObj = brain.getUserById(uid);
  const meta = { ts: Date.now(), userId: uid, username: (userObj && userObj.username) || null, filename: safeName, savedAs: outName, mime: mime||null };
  fs.writeFileSync(path.join(outDir, `${ts}-${uid}.json`), JSON.stringify(meta, null, 2));
      console.log(`[upload-proof] saved ${outName} for user ${uid}`);
      // Enviar email si está configurado SMTP
      if(mailer){
        try{
          await mailer.sendMail({
            from: SMTP_USER,
            to: NOTIFY_TO,
            subject: `Nuevo comprobante subido — usuario ${uid}`,
            text: `Se subió un comprobante.\n\nUsuario: ${uid}\nArchivo: ${safeName}\nGuardado como: ${outName}\nMIME: ${mime||'n/d'}\nFecha: ${new Date(meta.ts).toISOString()}`,
            attachments: [{ filename: safeName || outName, path: outPath }]
          });
          console.log('[upload-proof] correo de notificación enviado');
        }catch(e){ console.warn('No se pudo enviar correo de notificación:', e.message); }
      }
    return res.json({ ok:true, file: `pagos/${outName}` });
  }catch(e){ console.error('upload-proof error', e); return res.status(500).json({ ok:false }); }
});


  // Listar comprobantes del usuario autenticado (solo metadatos)
  app.get('/api/pay/proofs', (req, res) => {
    try{
      const uid = getSessionUserId(req);
      if(!uid) return res.status(401).json({ ok:false });
  const outDir = PAGOS_DIR;
      if(!fs.existsSync(outDir)) return res.json({ ok:true, items: [] });
      const files = fs.readdirSync(outDir).filter(f => typeof f === 'string' && f.toLowerCase().endsWith('.json'));
      const items = [];
      for(const f of files){
        try{ const meta = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8')); if(meta && String(meta.userId||'') === String(uid)) items.push(meta); }catch(_){ }
      }
      // Ordenar por ts desc
      items.sort((a,b)=> (b.ts||0)-(a.ts||0));
      return res.json({ ok:true, items });
    }catch(e){ return res.status(500).json({ ok:false }); }
  });

// Proxy/cache sencillo de imágenes remotas (evita CORS/404 externos).
// GET /img/:key -> mapea por images.json; GET /img?url=...
const IMG_MAP = (()=>{ try{ return require('./images.json'); }catch(e){ return {}; } })();
const LOCAL_MAP = (()=>{ try{ return require('./game-assets/map.json'); }catch(e){ return {}; } })();
const fetch = (...args) => globalThis.fetch(...args);
app.get('/img/:key', async (req, res) => {
  try{
    const key = req.params.key;
    // Si existe localmente, servir archivo local
    const localPath = LOCAL_MAP[key] ? path.join(__dirname, LOCAL_MAP[key]) : null;
    if(localPath && fs.existsSync(localPath)){
      return res.sendFile(localPath);
    }
    const url = IMG_MAP[key];
    if(!url) return res.status(404).send('not found');
    const r = await fetch(url);
    if(!r.ok) return res.status(502).send('bad upstream');
    res.set('Cache-Control','public, max-age=86400');
    res.set('Content-Type', r.headers.get('content-type')||'image/png');
    r.body.pipe(res);
  }catch(e){ res.status(500).send('error'); }
});
app.get('/img', async (req, res) => {
  try{
    const url = req.query.url;
    if(!url) return res.status(400).send('missing url');
    const r = await fetch(url);
    if(!r.ok) return res.status(502).send('bad upstream');
    res.set('Cache-Control','public, max-age=86400');
    res.set('Content-Type', r.headers.get('content-type')||'image/png');
    r.body.pipe(res);
  }catch(e){ res.status(500).send('error'); }
});

// Debug simple para verificar assets en producción (limitar a carpeta /public/assets)
app.get('/api/debug/assets-list', (req, res) => {
  try{
    const dir = path.join(__dirname, 'public', 'assets');
    const files = fs.readdirSync(dir).filter(f => typeof f === 'string');
    return res.json({ ok:true, dir, count: files.length, files });
  }catch(e){ return res.status(500).json({ ok:false, msg: e.message }); }
});
app.get('/api/debug/asset', (req, res) => {
  try{
    const name = String(req.query.name||'');
    if(!name) return res.status(400).json({ ok:false, msg:'missing name' });
    const p = path.join(__dirname, 'public', 'assets', name);
    const exists = fs.existsSync(p);
    let size = null;
    if(exists){ try{ size = fs.statSync(p).size; }catch(_){ } }
    return res.json({ ok:true, name, path: p, exists, size });
  }catch(e){ return res.status(500).json({ ok:false, msg: e.message }); }
});

// Debug: Google Sheets info (no escribe, sólo lee metadatos)

const state = {
  players: {},
  shops: [],
  houses: [],
  government: (function(){ try{ return brain.getGovernment(); }catch(e){ return { funds: 0, placed: [] }; } })()
};

function now() { return Date.now(); }

setInterval(() => {
  const payload = {
    players: Object.values(state.players),
    shops: state.shops,
    houses: state.houses,
    government: state.government
  };
  io.emit('state', payload);
}, 150);

// Trabajo automático: cada 6s todos ganan +15
setInterval(() => {
  for (const p of Object.values(state.players)) {
    p.money = (p.money || 0) + 15;
    p.updatedAt = now();
  }
}, 6000);

// Bots sencillos que deambulan (para siempre ver agentes)
// Nombres españoles simples
const MALE_NAMES = ['Carlos','Luis','Javier','Miguel','Andrés','José','Pedro','Diego','Sergio','Fernando','Juan','Víctor','Pablo','Eduardo','Hugo','Mario'];
const FEMALE_NAMES = ['María','Ana','Lucía','Sofía','Camila','Valeria','Paula','Elena','Sara','Isabella','Daniela','Carla','Laura','Diana','Andrea','Noelia'];
const LAST_NAMES = ['García','Martínez','López','González','Rodríguez','Pérez','Sánchez','Ramírez','Torres','Flores','Vargas','Castro','Romero','Navarro','Molina','Ortega'];
function randomPersonName(gender){
  const first = (gender==='F' ? FEMALE_NAMES : MALE_NAMES)[Math.floor(Math.random()*(gender==='F'?FEMALE_NAMES.length:MALE_NAMES.length))];
  const last = LAST_NAMES[Math.floor(Math.random()*LAST_NAMES.length)];
  return `${first} ${last}`;
}

function ensureBots(n = 3) {
  const existing = Object.values(state.players).filter(p => p.isBot);
  for (let i = existing.length; i < n; i++) {
    const id = 'B' + (i + 1);
    const gender = Math.random() > 0.5 ? 'M' : 'F';
    const speed = 120 + Math.random()*120; // 120-240
    // Avatares base alternados
    const preset = ['/assets/avatar1.png','/assets/avatar2.png','/assets/avatar3.png','/assets/avatar4.png'];
    const avatar = preset[Math.floor(Math.random()*preset.length)];
    state.players[id] = {
      id,
      socketId: null,
      code: randomPersonName(gender),
      x: Math.random() * 800 + 50,
      y: Math.random() * 500 + 50,
      money: 400,
      gender,
      avatar,
      isBot: true,
      vx: 0,
      vy: 0,
      speed,
      targetX: Math.random()*1800+100,
      targetY: Math.random()*1000+100,
      createdAt: now(),
      updatedAt: now()
    };
  }
}

function tickBots(bounds = { w: 2200, h: 1400 }) {
  const dt = 0.12; // ~120ms por tick
  for (const p of Object.values(state.players)) {
    if (!p.isBot) continue;
    // nuevo objetivo si llegó o por probabilidad
    const dx = (p.targetX ?? p.x) - (p.x || 0);
    const dy = (p.targetY ?? p.y) - (p.y || 0);
    const dist = Math.hypot(dx, dy);
    if (!isFinite(dist) || dist < 20 || Math.random() < 0.02) {
      p.targetX = Math.random() * bounds.w;
      p.targetY = Math.random() * bounds.h;
    }
    // velocidad deseada hacia el objetivo
    const ddx = (p.targetX - p.x);
    const ddy = (p.targetY - p.y);
    const d = Math.hypot(ddx, ddy) || 1;
    const nx = ddx / d, ny = ddy / d;
    const desiredVx = nx * (p.speed || 160);
    const desiredVy = ny * (p.speed || 160);
    // suavizado (lerp) + pequeño jitter para evitar movimiento robótico
    p.vx = (p.vx || 0) * 0.85 + desiredVx * 0.15 + (Math.random()*2-1)*4;
    p.vy = (p.vy || 0) * 0.85 + desiredVy * 0.15 + (Math.random()*2-1)*4;
    // actualizar posición
    p.x = Math.max(0, Math.min((p.x || 0) + p.vx * dt, bounds.w));
    p.y = Math.max(0, Math.min((p.y || 0) + p.vy * dt, bounds.h));
    // rebote en bordes ajustando objetivo
    if (p.x <= 0 || p.x >= bounds.w) { p.vx *= -0.6; p.targetX = Math.random() * bounds.w; }
    if (p.y <= 0 || p.y >= bounds.h) { p.vy *= -0.6; p.targetY = Math.random() * bounds.h; }
    p.updatedAt = now();
  }
}

// Movimiento para jugadores humanos inactivos, para que el mundo se sienta vivo.
function tickIdlePlayers(bounds = { w: 2200, h: 1400 }) {
  const dt = 0.12; // ~120ms por tick
  const idleTimeout = 3000; // 3 segundos de inactividad para empezar a moverse
  const currentTime = now();

  for (const p of Object.values(state.players)) {
    // Omitir bots (manejados por tickBots) y jugadores que han enviado actualizaciones recientemente.
    if (p.isBot || (currentTime - (p.lastUpdateFromClient || 0) < idleTimeout)) {
      continue;
    }

    // Lógica de movimiento aleatorio para jugadores inactivos
    if (typeof p.targetX !== 'number' || typeof p.targetY !== 'number' || Math.random() < 0.02) {
      p.targetX = Math.random() * bounds.w;
      p.targetY = Math.random() * bounds.h;
    }

    const dx = p.targetX - p.x;
    const dy = p.targetY - p.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 20) {
      p.targetX = Math.random() * bounds.w;
      p.targetY = Math.random() * bounds.h;
    }

    const speed = p.speed || 120;
    const nx = dx / (dist || 1);
    const ny = dy / (dist || 1);
    p.vx = (p.vx || 0) * 0.85 + nx * speed * 0.15;
    p.vy = (p.vy || 0) * 0.85 + ny * speed * 0.15;
    p.x = Math.max(0, Math.min((p.x || 0) + p.vx * dt, bounds.w));
    p.y = Math.max(0, Math.min((p.y || 0) + p.vy * dt, bounds.h));
    p.updatedAt = now();
  }
}

// Tick de movimiento automático para todos los jugadores
setInterval(() => {
  ensureBots(5); // Aseguramos que haya 5 bots
  // Usar límites amplios: si el mundo crece, se pueden mapear al menos 1.2x del tamaño base
  const w =  Math.max(2200, (globalThis.WORLD?.w)||2200);
  const h =  Math.max(1400, (globalThis.WORLD?.h)||1400);
  tickBots({ w, h });
  tickIdlePlayers({ w, h });
}, 120);

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);
  socket._lastUpdate = 0;
  // Asociar sesión si existe (sólo lectura de cookies del handshake)
  try{
    const cookie = socket.handshake.headers.cookie || '';
    const m = cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith(SESS_COOKIE+'='));
    if(m){
      const raw = decodeURIComponent(m.split('=')[1]||'');
      const uid = unsign(raw);
      if(uid){ socket.userId = uid; }
    }
  }catch(e){}

  socket.on('createPlayer', (data, ack) => {
    const id = 'P' + (Math.random().toString(36).slice(2,9));
    const player = {
      id,
      socketId: socket.id,
      code: data.code || ('Player' + id),
      x: data.x || 100,
      y: data.y || 100,
      money: (data.startMoney != null) ? data.startMoney : 400,
      gender: data.gender || 'M',
      avatar: data.avatar || null,
      createdAt: now(),
      updatedAt: now(),
      lastUpdateFromClient: now()
    };
    state.players[id] = player;
    socket.playerId = id;
    if (ack) ack({ ok: true, id });
    io.emit('playerJoined', player);
  });

  socket.on('update', (data) => {
    const t = Date.now();
    if (t - socket._lastUpdate < 80) return;
    socket._lastUpdate = t;
    const id = socket.playerId;
    if (!id || !state.players[id]) return;
    const p = state.players[id];
    if ('x' in data) p.x = data.x;
    if ('y' in data) p.y = data.y;
    if ('money' in data) {
      p.money = data.money;
  if(socket.userId){ try{ brain.setMoney(socket.userId, p.money, p.bank); brain.recordMoneyChange(socket.userId, brain.getUserById(socket.userId)?.username || null, 0, p.money, p.bank, 'tick'); }catch(e){} }
    }
  if ('bank' in data) p.bank = data.bank;
    if ('vehicle' in data) {
      p.vehicle = data.vehicle;
      if(socket.userId){
        try{
          brain.setVehicle(socket.userId, p.vehicle);
          // registrar vehículo como adquirido si no existía
          brain.addOwnedVehicle(socket.userId, p.vehicle);
        }catch(e){}
      }
    }
    p.updatedAt = now();
    p.lastUpdateFromClient = t;
  });

  socket.on('placeShop', (payload, ack) => {
    const id = 'S' + (state.shops.length + 1);
    const shop = Object.assign({}, payload, { id, cashbox: 0, createdAt: now() });
  state.shops.push(shop);
  // Persistir si el socket tiene usuario logueado
  if(socket.userId){ try{ brain.addShop(socket.userId, shop); }catch(e){} }
    io.emit('shopPlaced', shop);
    if (ack) ack({ ok: true, shop });
  });

  socket.on('placeHouse', (payload, ack) => {
    const id = 'H' + (state.houses.length + 1);
    const house = Object.assign({}, payload, { id, createdAt: now() });
  state.houses.push(house);
  if(socket.userId){ try{ brain.addHouse(socket.userId, house); }catch(e){} }
    io.emit('housePlaced', house);
    if (ack) ack({ ok: true, house });
  });

  // Restaurar ítems del progreso (coloca en el estado del servidor si faltan)
  socket.on('restoreItems', (payload, ack) => {
    try{
      const shops = Array.isArray(payload?.shops) ? payload.shops : [];
      const houses = Array.isArray(payload?.houses) ? payload.houses : [];
      const near = (a,b,eps=8)=> Math.abs((a||0)-(b||0))<=eps;
      const findShopSimilar = (s)=> state.shops.find(o => o && o.kind===s.kind && near(o.x,s.x,16) && near(o.y,s.y,16) && near(o.w,s.w,12) && near(o.h,s.h,12));
      const findHouseSimilar = (h)=> state.houses.find(o => o && near(o.x,h.x,16) && near(o.y,h.y,16) && near(o.w,h.w,12) && near(o.h,h.h,12));
      const ownerId = socket.playerId || null;

      for(const s of shops){
        if(!s) continue;
        if(findShopSimilar(s)) continue;
        const id = 'S' + (state.shops.length + 1);
        const shop = Object.assign({}, s, { id, ownerId: ownerId || s.ownerId || null, cashbox: s.cashbox || 0, createdAt: now() });
        state.shops.push(shop);
        io.emit('shopPlaced', shop);
      }
      for(const h of houses){
        if(!h) continue;
        if(findHouseSimilar(h)) continue;
        const id = 'H' + (state.houses.length + 1);
        const house = Object.assign({}, h, { id, ownerId: ownerId || h.ownerId || null, createdAt: now() });
        state.houses.push(house);
        io.emit('housePlaced', house);
      }
      if(ack) ack({ ok:true, shops: state.shops, houses: state.houses });
    }catch(e){ if(ack) ack({ ok:false }); }
  });

  socket.on('placeGov', (payload, ack) => {
  if ((state.government.funds || 0) < (payload.cost || 0)) {
      if (ack) ack({ ok:false, msg: 'Fondos insuficientes' });
      return;
    }
  try{ brain.addGovernmentFunds(-Math.abs(payload.cost||0)); }catch(_){ }
  try{ brain.placeGovernment(payload); }catch(_){ }
  state.government = brain.getGovernment();
    io.emit('govPlaced', payload);
    if (ack) ack({ ok:true });
  });

  // Chat básico entre jugadores conectados
  socket.on('chat:send', (payload, ack) => {
    try{
      const fromId = socket.playerId;
      const from = state.players[fromId];
      if(!from){ if(ack) ack({ ok:false, msg:'no-sender' }); return; }
      const toId = (payload && payload.to) ? String(payload.to) : null;
      const toName = (payload && payload.toName) ? String(payload.toName) : null;
      let target = null;
      if(toId && state.players[toId]) target = state.players[toId];
      if(!target && toName){ target = Object.values(state.players).find(p => (p.code||'').toLowerCase() === toName.toLowerCase()); }
      if(!target){ if(ack) ack({ ok:false, msg:'notfound' }); return; }
      if(!target.socketId){ if(ack) ack({ ok:false, msg:'offline' }); return; }
      const msg = {
        from: { id: fromId, name: from.code || from.id, avatar: from.avatar||null },
        to: { id: target.id, name: target.code || target.id },
        text: (payload && typeof payload.text==='string') ? payload.text.slice(0,300) : null,
        gift: (payload && payload.gift && (payload.gift==='roses' || payload.gift==='chocolates')) ? payload.gift : null,
        ts: now()
      };
      // Entregar al destinatario y eco al remitente
      io.to(target.socketId).emit('chat:msg', msg);
      if(socket.id) io.to(socket.id).emit('chat:msg', msg);
      if(ack) ack({ ok:true });
    }catch(e){ if(ack) ack({ ok:false }); }
  });

  socket.on('disconnect', () => {
    const id = socket.playerId;
    if (id && state.players[id]) {
      delete state.players[id];
      io.emit('playerLeft', { id });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});