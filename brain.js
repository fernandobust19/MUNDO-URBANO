// brain.js — almacenamiento persistente de usuarios y progreso
// Guarda en un JSON local en la raíz del proyecto.

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'brain.db.json');
const LEDGER_PATH = path.join(__dirname, 'saldos.ledger.json');

let db = {
	users: [], // { id, username, passHash, createdAt, lastLoginAt, gender?, country?, email?, phone? }
	// userId -> { money, bank, vehicle, vehicles:[], shops:[], houses:[], name, avatar, likes:[], gender, age, initialRentPaid?, rentedHouseIdx? }
	progress: {},
	government: { funds: 0, placed: [] },
	activityLog: [] // { ts, type, userId, details }
};

// Ledger en un solo archivo: { users: { userId: { username, lastMoney, lastBank, updatedAt } }, movements: [ { ts, userId, username, delta, money, bank, reason } ] }
let ledger = { users: {}, movements: [] };

function saveAtomic(dataStr) {
	const tmp = DB_PATH + '.tmp';
	fs.writeFileSync(tmp, dataStr);
	fs.renameSync(tmp, DB_PATH);
}

function saveLedgerAtomic(dataStr){
	const tmp = LEDGER_PATH + '.tmp';
	fs.writeFileSync(tmp, dataStr);
	fs.renameSync(tmp, LEDGER_PATH);
}

function load() {
	try {
		if (fs.existsSync(DB_PATH)) {
			const raw = fs.readFileSync(DB_PATH, 'utf8');
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object') db = Object.assign(db, parsed);
			// backfill gobierno
			if(!db.government){ db.government = { funds: 0, placed: [] }; }
		} else {
			persist();
		}
	} catch (e) {
		console.warn('brain load error, starting fresh', e);
	}

	// Cargar ledger
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
function persist() {
	try {
		const str = JSON.stringify(db, null, 2);
		saveAtomic(str);
	} catch (e) {
		console.warn('brain persist error', e);
	}
}

function persistLedger(){
	try{
		// Limitar tamaño del array de movimientos
		if(Array.isArray(ledger.movements) && ledger.movements.length > 20000){
			ledger.movements.splice(0, ledger.movements.length - 20000);
		}
		const str = JSON.stringify(ledger, null, 2);
		saveLedgerAtomic(str);
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
	return p;
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
	const allowed = ['money', 'bank', 'vehicle', 'vehicles', 'shops', 'houses', 'name', 'avatar', 'likes', 'gender', 'age', 'country', 'email', 'phone', 'initialRentPaid', 'rentedHouseIdx', 'governmentFunds', 'rentalHouse'];
	for (const k of allowed) {
		if (k in patch) {
			if (k === 'shops' || k === 'houses' || k === 'vehicles' || k === 'likes') {
				if (Array.isArray(patch[k])) p[k] = patch[k];
			} else {
				p[k] = patch[k];
			}
		}
	}
	// Si viene governmentFunds actualizar objeto gobierno global
	try{
		if('governmentFunds' in patch && typeof patch.governmentFunds === 'number'){
			const g = getGovernment();
			g.funds = Math.max(0, Math.floor(patch.governmentFunds));
		}
		// Persistir snapshot de casa rentada (geometría + marcador)
		if('rentalHouse' in patch && patch.rentalHouse && typeof patch.rentalHouse==='object'){
			const rh = patch.rentalHouse;
			// normalizar
			const norm = { x: Math.floor(rh.x||0), y: Math.floor(rh.y||0), w: Math.floor(rh.w||0)||60, h: Math.floor(rh.h||0)||60 };
			if(rh.initial && typeof rh.initial==='string') norm.initial = rh.initial.slice(0,3);
			p.rentalHouse = norm;
		}
	}catch(_){ }
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

function saveMoneySnapshot(userId, reason='logout'){
	try{
		if(!userId) return;
		const user = getUserById(userId);
		const p = ensureProgress(userId);
		recordMoneyChange(userId, user?.username||null, 0, p.money||0, p.bank||0, reason);
	}catch(e){ console.warn('saveMoneySnapshot error', e); }
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
load();

function changePassword(userId, newPassword) {
	const user = getUserById(userId);
	if (!user || typeof newPassword !== 'string' || newPassword.length < 8) return { ok: false, msg: 'Usuario no encontrado o contraseña inválida' };
	user.passHash = bcrypt.hashSync(newPassword, 10);
	log('password_change', userId, {});
	schedulePersist();
	return { ok: true };
}

module.exports = {
	load,
	persist,
	registerUser,
	verifyLogin,
	getUserById,
	getProgress,
	updateProgress,
	addShop,
	addHouse,
	setMoney,
	setVehicle,
	addOwnedVehicle,
	log,
	// ledger API
	recordMoneyChange,
	saveMoneySnapshot,
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

