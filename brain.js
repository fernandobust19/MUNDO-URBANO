// brain.js — almacenamiento persistente de usuarios y progreso
// Guarda en un JSON local en la raíz del proyecto.

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { google } = require('googleapis');

const DB_PATH = path.join(__dirname, 'brain.db.json');
const LEDGER_PATH = path.join(__dirname, 'saldos.ledger.json');

// --- Integración con Google Drive ---
const GDRIVE_BRAIN_FILE_ID = process.env.GDRIVE_BRAIN_FILE_ID || null;
const GDRIVE_LEDGER_FILE_ID = process.env.GDRIVE_LEDGER_FILE_ID || null;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null;
const GOOGLE_PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

let driveClient = null;

function getDriveClient() {
	if (driveClient) return driveClient;
	if (!GDRIVE_BRAIN_FILE_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
		// Si no está configurado, se usará el sistema de archivos local como fallback.
		return null;
	}

	try {
		const jwtClient = new google.auth.JWT(
			GOOGLE_SERVICE_ACCOUNT_EMAIL,
			null,
			GOOGLE_PRIVATE_KEY,
			['https://www.googleapis.com/auth/drive.file'] // Permiso para acceder a archivos creados/compartidos
		);
		driveClient = google.drive({ version: 'v3', auth: jwtClient });
		console.log('[GDRIVE] Cliente de Google Drive inicializado.');
		return driveClient;
	} catch (e) {
		console.error('[GDRIVE] Falló la inicialización del cliente de Google Drive:', e.message);
		return null;
	}
}

let db = {
	users: [], // { id, username, passHash, createdAt, lastLoginAt, gender?, country?, email?, phone? }
	// userId -> { money, bank, vehicle, vehicles:[], shops:[], houses:[], name, avatar, likes:[], gender, age, initialRentPaid?, rentedHouseIdx? }
	progress: {},
	government: { funds: 0, placed: [] },
	activityLog: [], // { ts, type, userId, details }
	// Estructuras del mundo para que los agentes del servidor las usen
	factories: [],
	banks: [],
	houses: [] // Lista global de todas las casas para el sistema de arriendo
};

// Ledger en un solo archivo: { users: { userId: { username, lastMoney, lastBank, updatedAt } }, movements: [ { ts, userId, username, delta, money, bank, reason } ] }
let ledger = { users: {}, movements: [] };

async function saveAtomic(dataStr) {
	const drive = getDriveClient();
	if (drive && GDRIVE_BRAIN_FILE_ID) {
		try {
			await drive.files.update({
				fileId: GDRIVE_BRAIN_FILE_ID,
				media: {
					mimeType: 'application/json',
					body: dataStr,
				},
			});
		} catch (e) {
			console.error('[GDRIVE] Error al guardar brain.db.json:', e.message);
		}
	} else {
		const tmp = DB_PATH + '.tmp';
		fs.writeFileSync(tmp, dataStr);
		fs.renameSync(tmp, DB_PATH);
	}
}

async function saveLedgerAtomic(dataStr){
	const drive = getDriveClient();
	if (drive && GDRIVE_LEDGER_FILE_ID) {
		try {
			await drive.files.update({
				fileId: GDRIVE_LEDGER_FILE_ID,
				media: {
					mimeType: 'application/json',
					body: dataStr,
				},
			});
		} catch (e) {
			console.error('[GDRIVE] Error al guardar saldos.ledger.json:', e.message);
		}
	} else {
		const tmp = LEDGER_PATH + '.tmp';
		fs.writeFileSync(tmp, dataStr);
		fs.renameSync(tmp, LEDGER_PATH);
	}
}

async function load() {
	const drive = getDriveClient();
	if (drive && GDRIVE_BRAIN_FILE_ID) {
		try {
			console.log('[GDRIVE] Cargando brain.db.json desde Google Drive...');
			const res = await drive.files.get({ fileId: GDRIVE_BRAIN_FILE_ID, alt: 'media' });
			const parsed = JSON.parse(res.data);
			if (parsed && typeof parsed === 'object') db = Object.assign(db, parsed);
			console.log('[GDRIVE] brain.db.json cargado exitosamente.');
		} catch (e) {
			console.warn('[GDRIVE] No se pudo cargar brain.db.json, usando estado inicial.', e.message);
		}
	}
	try {
		if (fs.existsSync(DB_PATH)) {
			const raw = fs.readFileSync(DB_PATH, 'utf8');
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object') db = Object.assign(db, parsed);
			// backfill gobierno
			if(!db.government){ db.government = { funds: 0, placed: [] }; }
			if(!Array.isArray(db.factories)) db.factories = [];
			if(!Array.isArray(db.banks)) db.banks = [];
			if(!Array.isArray(db.houses)) db.houses = [];
		} else {
			persist();
		}
	} catch (e) {
		console.warn('brain load error, starting fresh', e);
	}

	// Cargar ledger
	if (drive && GDRIVE_LEDGER_FILE_ID) {
		try {
			console.log('[GDRIVE] Cargando saldos.ledger.json desde Google Drive...');
			const res = await drive.files.get({ fileId: GDRIVE_LEDGER_FILE_ID, alt: 'media' });
			const parsed = JSON.parse(res.data);
			if (parsed && typeof parsed === 'object') ledger = Object.assign(ledger, parsed);
			console.log('[GDRIVE] saldos.ledger.json cargado exitosamente.');
		} catch (e) {
			console.warn('[GDRIVE] No se pudo cargar saldos.ledger.json, usando estado inicial.', e.message);
		}
	}
	try{
		if(fs.existsSync(LEDGER_PATH)){
			const lr = fs.readFileSync(LEDGER_PATH, 'utf8');
			const parsed = JSON.parse(lr);
			if(parsed && typeof parsed === 'object') ledger = Object.assign(ledger, parsed);
		} else {
			persistLedger();
		}
	}catch(e){ console.warn('ledger load error', e); }
}

let _saveTimer = null;
async function persist() {
	try {
		const str = JSON.stringify(db, null, 2);
		await saveAtomic(str);
	} catch (e) {
		console.warn('brain persist error', e);
	}
}

async function persistLedger(){
	try{
		// Limitar tamaño del array de movimientos
		if(Array.isArray(ledger.movements) && ledger.movements.length > 20000){
			ledger.movements.splice(0, ledger.movements.length - 20000);
		}
		const str = JSON.stringify(ledger, null, 2);
		await saveLedgerAtomic(str);
	}catch(e){ console.warn('ledger persist error', e); }
}

function schedulePersist() {
	if (_saveTimer) clearTimeout(_saveTimer);
	_saveTimer = setTimeout(() => { _saveTimer = null; persist(); }, 250);
}

let _ledgerTimer = null;
function scheduleLedgerPersist(){
	if(_ledgerTimer) clearTimeout(_ledgerTimer);
	_ledgerTimer = setTimeout(()=>{ _ledgerTimer = null; persistLedger(); }, 200);
}

function uid() {
	return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() :
		'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function log(type, userId = null, details = null) {
	db.activityLog.push({ ts: Date.now(), type, userId, details });
	if (db.activityLog.length > 5000) db.activityLog.splice(0, db.activityLog.length - 5000);
	schedulePersist();
}

// ===== Gobierno (persistente) =====
function getGovernment(){
	try{
		if(!db.government || typeof db.government !== 'object') db.government = { funds: 0, placed: [] };
		if(!Array.isArray(db.government.placed)) db.government.placed = [];
		if(typeof db.government.funds !== 'number') db.government.funds = 0;
		return db.government;
	}catch(e){ return { funds: 0, placed: [] }; }
}
function setGovernment(gov){
	try{
		const g = getGovernment();
		if(gov && typeof gov === 'object'){
			if(typeof gov.funds === 'number') g.funds = Math.floor(gov.funds);
			if(Array.isArray(gov.placed)) g.placed = gov.placed;
			schedulePersist();
			log('gov_set', null, { funds: g.funds, placed: g.placed.length });
			return { ok:true };
		}
	}catch(e){}
	return { ok:false };
}
function addGovernmentFunds(delta){
	const g = getGovernment();
	const add = Math.floor(delta||0);
	if(!isFinite(add) || add===0) return { ok:false };
	g.funds = Math.max(0, (g.funds||0) + add);
	schedulePersist();
	log('gov_funds', null, { delta: add, funds: g.funds });
	return { ok:true, funds: g.funds };
}
function placeGovernment(payload){
	const g = getGovernment();
	try{ g.placed.push(payload); }catch(_){ }
	schedulePersist();
	log('gov_place', null, { k: payload?.k||payload?.label||'item' });
	return { ok:true };
}

function getUserByUsername(username) {
	return db.users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase());
}

function getUserById(userId) {
	return db.users.find(u => u.id === userId) || null;
}

function ensureProgress(userId) {
	if (!db.progress[userId]) db.progress[userId] = { money: 400, bank: 0, vehicle: null, vehicles: [], shops: [], houses: [], name: null, avatar: null, likes: [], gender: null, age: null, initialRentPaid: false, rentedHouseIdx: null };
	// backfill para repos anteriores
	const p = db.progress[userId];
	if(!('vehicles' in p)) p.vehicles = [];
	if(!('shops' in p)) p.shops = [];
	if(!('houses' in p)) p.houses = [];
	if(!('name' in p)) p.name = null;
	if(!('avatar' in p)) p.avatar = null;
	if(!Array.isArray(p.likes)) p.likes = [];
	if(!('gender' in p)) p.gender = null;
	if(!('age' in p)) p.age = null;
	if(!('initialRentPaid' in p)) p.initialRentPaid = false;
	if(!('rentedHouseIdx' in p)) p.rentedHouseIdx = null;
	if(!('state' in p)) p.state = 'single';
	if(!('spouseId' in p)) p.spouseId = null;
	return p;
}

function registerBot(botId, defaults = {}) {
	// No crea un "usuario", solo una entrada de progreso para un bot
	if (db.progress[botId]) {
		return { ok: true, progress: db.progress[botId] };
	}
	const p = ensureProgress(botId);
	p.name = defaults.name || botId;
	p.money = defaults.money || 400;
	p.isBot = true; // Marcar como bot
	log('bot_register', botId, { name: p.name });
	schedulePersist();
	return { ok: true, progress: p };
}

function registerUser(username, password, extra={}) {
	const name = String(username || '').trim();
	if (!name || name.length < 3) return { ok: false, msg: 'Nombre inválido' };
	if (String(password || '').length < 4) return { ok: false, msg: 'Contraseña muy corta' };
	if (getUserByUsername(name)) return { ok: false, msg: 'Usuario ya existe' };

	const passHash = bcrypt.hashSync(String(password), 10);
	const user = { id: uid(), username: name, passHash, createdAt: Date.now(), lastLoginAt: null };
	// Guardar campos adicionales opcionales
	try{
		if(extra && typeof extra === 'object'){
			const { country, email, phone, gender } = extra;
			if(country) user.country = String(country);
			if(email) user.email = String(email);
			if(phone) user.phone = String(phone);
			if(gender && ['M','F','X'].includes(String(gender))) user.gender = String(gender);
		}
	}catch(_){ }
	db.users.push(user);
	ensureProgress(user.id);
	log('register', user.id, { username: name });
	schedulePersist();
	return { ok: true, user: { id: user.id, username: user.username, gender: user.gender||null, country: user.country||null, email: user.email||null, phone: user.phone||null } };
}

function verifyLogin(username, password) {
	const user = getUserByUsername(username);
	if (!user) return { ok: false, msg: 'Usuario o contraseña inválidos' };
	const ok = bcrypt.compareSync(String(password || ''), user.passHash);
	if (!ok) return { ok: false, msg: 'Usuario o contraseña inválidos' };
	user.lastLoginAt = Date.now();
	log('login', user.id, { username: user.username });
	schedulePersist();
	return { ok: true, user: { id: user.id, username: user.username, gender: user.gender||null, country: user.country||null, email: user.email||null, phone: user.phone||null } };
}

function getProgress(userId) {
	if (!userId) return null;
	return ensureProgress(userId);
}

function updateProgress(userId, patch) {
	if (!userId) return { ok: false };
	const p = ensureProgress(userId);
	if (patch == null || typeof patch !== 'object') return { ok: false };
	// Solo campos permitidos
	const allowed = ['money', 'bank', 'vehicle', 'vehicles', 'shops', 'houses', 'name', 'avatar', 'likes', 'gender', 'age', 'country', 'email', 'phone', 'initialRentPaid', 'rentedHouseIdx', 'state', 'spouseId'];
	for (const k of allowed) {
		if (k in patch) {
			if (k === 'shops' || k === 'houses' || k === 'vehicles' || k === 'likes') {
				if (Array.isArray(patch[k])) p[k] = patch[k];
			} else {
				p[k] = patch[k];
			}
		}
	}
	log('progress_update', userId, { keys: Object.keys(patch || {}) });
	schedulePersist();
	return { ok: true };
}

function addShop(userId, shopObj) {
	const p = ensureProgress(userId);
	p.shops.push(shopObj);
	log('shop_add', userId, { id: shopObj?.id || null });
	schedulePersist();
}

function addHouse(userId, houseObj) {
	const p = ensureProgress(userId);
	p.houses.push(houseObj);
	log('house_add', userId, { id: houseObj?.id || null });
	schedulePersist();
}

function updateGlobalHouse(houseId, patch) {
	if (!Array.isArray(db.houses)) db.houses = [];
	const house = db.houses.find(h => h.id === houseId);
	if (house) {
		Object.assign(house, patch);
		schedulePersist();
		return { ok: true };
	}
	return { ok: false };
}

function updateShop(shopId, patch) {
    // Actualiza una tienda en la lista de progreso de su dueño
    for (const userId in db.progress) {
        const p = db.progress[userId];
        if (p && Array.isArray(p.shops)) {
            const shop = p.shops.find(s => s.id === shopId);
            if (shop) {
                Object.assign(shop, patch);
                schedulePersist();
                return { ok: true };
            }
        }
    }
    return { ok: false, msg: 'Shop not found' };
}

function setWorldStructures({ factories, banks }) {
    if (Array.isArray(factories)) {
        db.factories = factories;
    }
    if (Array.isArray(banks)) {
        db.banks = banks;
    }
    schedulePersist();
    return { ok: true };
}

function getGameStructures() {
    // Devuelve las estructuras necesarias para la IA de los agentes del servidor
    const allShops = Object.values(db.progress).flatMap(p => p.shops || []);
    return { factories: db.factories, banks: db.banks, shops: allShops };
}

function addGlobalHouse(houseObj) {
	if(!Array.isArray(db.houses)) db.houses = [];
	// Evitar duplicados por si se restaura o coloca varias veces
	const exists = db.houses.some(h => h.id === houseObj.id || (Math.abs(h.x - houseObj.x) < 2 && Math.abs(h.y - houseObj.y) < 2));
	if (!exists) {
		db.houses.push(houseObj);
		schedulePersist();
	}
}

function getProgressHouses() {
	// Devuelve la lista global de casas para que el servidor la use
	if(!Array.isArray(db.houses)) db.houses = [];
	return db.houses;
}

function setMoney(userId, money, bank = undefined) {
	const p = ensureProgress(userId);
	const prevMoney = p.money || 0;
	const prevBank = p.bank || 0;
	if (typeof money === 'number') p.money = Math.max(0, Math.floor(money));
	if (typeof bank === 'number') p.bank = Math.max(0, Math.floor(bank));
	schedulePersist();
	try{
		const user = getUserById(userId);
		recordMoneyChange(userId, user?.username || null, (p.money||0) - prevMoney, p.money||0, p.bank||0, 'update');
	}catch(e){}
}

async function setMoneyAndPersist(userId, money, bank) {
	const p = ensureProgress(userId);
	const prevMoney = p.money || 0;

	// Asegurarse de que los valores son números válidos antes de asignarlos
	if (typeof money === 'number' && !isNaN(money)) {
		p.money = Math.max(0, Math.floor(money));
	}
	if (typeof bank === 'number' && !isNaN(bank)) {
		p.bank = Math.max(0, Math.floor(bank));
	}

	// Registrar el cambio en el ledger
	try {
		const user = getUserById(userId);
		recordMoneyChange(userId, user?.username || null, (p.money || 0) - prevMoney, p.money || 0, p.bank || 0, 'logout-save');
	} catch (e) { }

	// Forzar la persistencia inmediata de ambos archivos y esperar a que terminen
	await Promise.all([persist(), persistLedger()]);
}

function setVehicle(userId, vehicle) {
	const p = ensureProgress(userId);
	p.vehicle = vehicle || null;
	schedulePersist();
}

function addOwnedVehicle(userId, vehicle){
	try{
		const p = ensureProgress(userId);
		if(!Array.isArray(p.vehicles)) p.vehicles = [];
		if(vehicle && !p.vehicles.includes(vehicle)){
			p.vehicles.push(vehicle);
			schedulePersist();
			log('vehicle_add', userId, { vehicle });
		}
	}catch(e){}
}

// ===== Ledger helpers =====
function recordMoneyChange(userId, username, delta, newMoney, newBank, reason){
	try{
		if(!userId) return;
		ledger.movements.push({ ts: Date.now(), userId, username: username || null, delta: Math.floor(delta||0), money: Math.floor(newMoney||0), bank: Math.floor(newBank||0), reason: reason || 'update' });
		// actualizar snapshot por usuario
		ledger.users[userId] = { username: username || (ledger.users[userId]?.username||null), lastMoney: Math.floor(newMoney||0), lastBank: Math.floor(newBank||0), updatedAt: Date.now() };
		scheduleLedgerPersist();
	}catch(e){ console.warn('recordMoneyChange error', e); }
}

// Sumar créditos y registrar en el ledger (una sola entrada)
function addMoney(userId, delta, reason='credit'){
	try{
		if(!userId) return { ok:false };
		const p = ensureProgress(userId);
		const add = Math.floor(delta||0);
		if(add <= 0) return { ok:false };
		const prev = Math.floor(p.money||0);
		p.money = Math.max(0, prev + add);
		schedulePersist();
		const user = getUserById(userId);
		recordMoneyChange(userId, user?.username||null, add, p.money||0, p.bank||0, reason||'credit');
		return { ok:true, money: p.money };
	}catch(e){ console.warn('addMoney error', e); return { ok:false }; }
}

// Idempotencia simple: evitar duplicar un pago ya aplicado buscando por razón exacta
function hasLedgerReason(reason){
	try{ return !!(ledger.movements || []).find(m => m && m.reason === reason); }catch(e){ return false; }
}

function addMoneyOnce(userId, delta, reasonKey){
	const reason = String(reasonKey||'credit:once');
	if(hasLedgerReason(reason)) return { ok:false, duplicated:true };
	return addMoney(userId, delta, reason);
}

function latestMoney(userId){
	try{ return ledger.users[userId]?.lastMoney ?? null; }catch(e){ return null; }
}

function restoreMoneyFromLedger(userId){
	try{
		const snap = ledger.users[userId];
		if(!snap) return null;
		const p = ensureProgress(userId);
		if(snap.lastMoney != null){ p.money = Math.max(0, Math.floor(snap.lastMoney)); }
		if(snap.lastBank != null){ p.bank = Math.max(0, Math.floor(snap.lastBank)); }
		schedulePersist();
		// snapshot en ledger para dejar constancia de la restauración
		const user = getUserById(userId);
		recordMoneyChange(userId, user?.username||null, 0, p.money||0, p.bank||0, 'login-restore');
		return { money: p.money, bank: p.bank };
	}catch(e){ console.warn('restoreMoneyFromLedger error', e); return null; }
}

// Cargar al iniciar
async function init() {
	await load();
}
function changePassword(userId, newPassword) {
	const user = getUserById(userId);
	if (!user || typeof newPassword !== 'string' || newPassword.length < 8) return { ok: false, msg: 'Usuario no encontrado o contraseña inválida' };
	user.passHash = bcrypt.hashSync(newPassword, 10);
	log('password_change', userId, {});
	schedulePersist();
	return { ok: true };
}

module.exports = {
	init,
	load,
	persist,
	registerUser,
	registerBot,
	verifyLogin,
	getUserById,
	getProgress,
	updateProgress,
	addShop,
	addHouse,
	updateGlobalHouse,
	updateShop,
	getGameStructures,
	setWorldStructures,
	addGlobalHouse,
	getProgressHouses,
	setMoney,
	setVehicle,
	setMoneyAndPersist,
	addOwnedVehicle,
	log,
	// ledger API
	recordMoneyChange,
	latestMoney,
	restoreMoneyFromLedger,
	changePassword,
	// credits helpers
	addMoney,
	addMoneyOnce,
	hasLedgerReason,
	// government
	getGovernment,
	setGovernment,
	addGovernmentFunds,
	placeGovernment
};
