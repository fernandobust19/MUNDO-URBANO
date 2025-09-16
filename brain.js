// brain.js — almacenamiento persistente de usuarios y progreso
// Guarda en un JSON local en la raíz del proyecto.

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { google } = require('googleapis');

const DB_PATH = path.join(__dirname, 'brain.db.json');
const LEDGER_PATH = path.join(__dirname, 'saldos.ledger.json');

// --- Integración con Google Drive (Método Robusto) ---
const CRED_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || '/etc/secrets/key.json';
const BRAIN_ID_ENV = (process.env.GDRIVE_BRAIN_FILE_ID || '').trim();
const LEDGER_ID_ENV = (process.env.GDRIVE_LEDGER_FILE_ID || '').trim();
const GDRIVE_FOLDER_ID = process.env.GDRIVE_FOLDER_ID || undefined;

// IDs resueltos que se usarán después de la verificación inicial.
let resolvedBrainId = BRAIN_ID_ENV;
let resolvedLedgerId = LEDGER_ID_ENV;

// Loguear la cuenta de servicio en uso para depuración
try {
  if (fs.existsSync(CRED_PATH)) {
    const sa = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
    console.log('[SA EN USO]', sa.client_email);
  }
} catch (e) {
  console.log('[SA EN USO] No pude leer el keyfile:', e.message);
}

let driveClient = null;

function getDriveClient() {
	if (driveClient) return driveClient;
	
	// En producción, es obligatorio que los IDs de los archivos de Drive estén definidos.
	if (!BRAIN_ID_ENV || !LEDGER_ID_ENV) {
		if (process.env.NODE_ENV === 'production') {
			throw new Error('CRÍTICO: Los IDs de archivo de Google Drive (GDRIVE_BRAIN_FILE_ID, GDRIVE_LEDGER_FILE_ID) no están configurados en producción.');
		}
		return null;
	}

	try {
		// GoogleAuth encontrará y usará automáticamente el Secret File si la variable
		// de entorno GOOGLE_APPLICATION_CREDENTIALS está configurada en Render.
		const auth = new google.auth.GoogleAuth({
			scopes: ['https://www.googleapis.com/auth/drive.file'],
		});
		driveClient = google.drive({ version: 'v3', auth });
		return driveClient;
	} catch (e) {
		console.error('[GDRIVE] Falló la inicialización del cliente de Google Drive:', e.message);
		// En producción, un fallo aquí es fatal.
		if (process.env.NODE_ENV === 'production') throw e;
		return null;
	}
}

async function resolveFileId(drive, fileId) {
  // Soporta atajos y Shared Drives
  const meta = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,shortcutDetails',
    supportsAllDrives: true,
  });
  if (meta.data.mimeType === 'application/vnd.google-apps.shortcut' &&
      meta.data.shortcutDetails?.targetId) {
    console.log(`[GDRIVE] ${meta.data.name} es un atajo → usando targetId`);
    return meta.data.shortcutDetails.targetId;
  }
  return fileId;
}

async function ensureJsonFile(drive, { name, fileId, data, folderId }) {
  try {
    // 1) Resolver atajo si aplica
    const realId = await resolveFileId(drive, fileId);
    // 2) Intentar leer metadata (si no existe, cae al catch 404)
    const meta = await drive.files.get({
      fileId: realId,
      fields: 'id,name,mimeType,modifiedTime',
      supportsAllDrives: true,
    });
    console.log(`[GDRIVE] OK, existe: ${meta.data.name} (${meta.data.id})`);
    return realId;
  } catch (e) {
    const code = e?.response?.status || e?.code;
    if (code === 404) {
      console.log(`[GDRIVE] ${name} no existe (404) → creando...`);
      const res = await drive.files.create({
        requestBody: {
          name,
          mimeType: 'application/json',
          parents: folderId ? [folderId] : undefined,
        },
        media: { mimeType: 'application/json', body: JSON.stringify(data ?? {}) },
        fields: 'id,name',
        supportsAllDrives: true,
      });
      console.log(`[GDRIVE] Creado ${name} con nuevo ID: ${res.data.id}`);
      return res.data.id;
    }
    throw e;
  }
}

async function checkDriveHealth() {
	const drive = getDriveClient();
	if (!drive) {
		return { ok: false, message: 'Drive client not initialized.' };
	}

	try {
		// Asegura que los archivos existan (o los crea) y obtiene sus IDs reales.
		resolvedBrainId = await ensureJsonFile(drive, {
			name: 'brain.db.json',
			fileId: BRAIN_ID_ENV,
			data: { users: [], progress: {}, government: { funds: 0, placed: [] }, activityLog: [] },
			folderId: GDRIVE_FOLDER_ID,
		});

		resolvedLedgerId = await ensureJsonFile(drive, {
			name: 'saldos.ledger.json',
			fileId: LEDGER_ID_ENV,
			data: { users: {}, movements: [] },
			folderId: GDRIVE_FOLDER_ID,
		});

		// Realizar una lectura de metadatos para confirmar
		const [brainMeta, ledgerMeta] = await Promise.all([
			drive.files.get({ fileId: resolvedBrainId, fields: 'id,name,modifiedTime', supportsAllDrives: true }),
			drive.files.get({ fileId: resolvedLedgerId, fields: 'id,name,modifiedTime', supportsAllDrives: true }),
		]);

		const brainPreview = 'Lectura de contenido omitida en chequeo inicial para mayor rapidez.';

		return {
			ok: true,
			message: '✅ Conexión con Drive OK',
			brain: brainMeta.data,
			ledger: ledgerMeta.data,
			brainPreview: brainPreview.substring(0, 300),
		};

	} catch (e) {
		const error = e?.response?.data || e?.message || e;
		let hint = 'Error desconocido.';
		const code = e?.response?.status || e?.code;
		if (code === 403) {
			hint = 'Falta compartir el archivo en Google Drive con el "client_email" (rol de Editor).';
		} else if (code === 404) {
			hint = 'FileId incorrecto o el archivo es un “atajo”. Verifica GDRIVE_BRAIN_FILE_ID y GDRIVE_LEDGER_FILE_ID. Si es atajo, usa el ID del archivo real.';
		} else if (String(e.message).includes('Could not load the default credentials')) {
			hint = 'No se encontraron las credenciales. Asegúrate de que la variable de entorno GOOGLE_APPLICATION_CREDENTIALS esté definida en Render y apunte a la ruta correcta del Secret File (ej: /etc/secrets/key.json).';
		} else if (String(e.message).includes('ENOENT')) {
			hint = 'Ruta del Secret File incorrecta. Verifica la variable GOOGLE_APPLICATION_CREDENTIALS.';
		}
		return {
			ok: false,
			error,
			hint,
		};
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
	if (drive && resolvedBrainId) {
		try {
			await drive.files.update({
				fileId: resolvedBrainId,
				media: {
					mimeType: 'application/json',
					body: dataStr,
				},
			});
			// Si el guardado en Drive tiene éxito, no necesitamos hacer nada más.
		} catch (e) {
			console.error('[GDRIVE] Error al guardar brain.db.json:', e.message);
			// En producción, no hacer fallback. Es mejor fallar que perder datos silenciosamente.
			if (process.env.NODE_ENV === 'production') {
				throw new Error(`Fallo crítico al guardar en Google Drive: ${e.message}`);
			}
			console.log('[GDRIVE] Fallback (dev): Guardando brain.db.json en el sistema de archivos local.');
			const tmp = DB_PATH + '.tmp'; fs.writeFileSync(tmp, dataStr); fs.renameSync(tmp, DB_PATH);
		}
	} else {
		const tmp = DB_PATH + '.tmp';
		fs.writeFileSync(tmp, dataStr);
		fs.renameSync(tmp, DB_PATH);
	}
}

async function saveLedgerAtomic(dataStr){
	const drive = getDriveClient();
	if (drive && resolvedLedgerId) {
		try {
			await drive.files.update({
				fileId: resolvedLedgerId,
				media: {
					mimeType: 'application/json',
					body: dataStr,
				},
			});
			// Si el guardado en Drive tiene éxito, no necesitamos hacer nada más.
		} catch (e) {
			console.error('[GDRIVE] Error al guardar saldos.ledger.json:', e.message);
			// En producción, no hacer fallback.
			if (process.env.NODE_ENV === 'production') {
				throw new Error(`Fallo crítico al guardar ledger en Google Drive: ${e.message}`);
			}
			console.log('[GDRIVE] Fallback (dev): Guardando saldos.ledger.json en el sistema de archivos local.');
			const tmp = LEDGER_PATH + '.tmp'; fs.writeFileSync(tmp, dataStr); fs.renameSync(tmp, LEDGER_PATH);
		}
	} else {
		const tmp = LEDGER_PATH + '.tmp';
		fs.writeFileSync(tmp, dataStr);
		fs.renameSync(tmp, LEDGER_PATH);
	}
}

async function load() {
	const drive = getDriveClient();
	let loadedFromDrive = false;

	if (drive && resolvedBrainId) {
		try {
			console.log('[GDRIVE] Cargando brain.db.json desde Google Drive...');
			const res = await drive.files.get({ fileId: resolvedBrainId, alt: 'media' });
			const parsed = JSON.parse(res.data);
			if (parsed && typeof parsed === 'object') {
				db = Object.assign(db, parsed);
				console.log('[GDRIVE] brain.db.json cargado exitosamente.');
				// Si se carga desde Drive, no intentar cargar desde local.
				// Ahora cargamos el ledger y terminamos.
				return await loadLedger();
			}
		} catch (e) {
			if (e.code === 404) { // Error "Not Found" de la API de Google
				console.warn('[GDRIVE] brain.db.json no encontrado. Creando uno nuevo en Google Drive...');
				try {
					// Inicia con una base de datos vacía y la guarda inmediatamente.
					db = { users: [], progress: {}, government: { funds: 0, placed: [] }, activityLog: [], factories: [], banks: [], houses: [] };
					await persist();
					console.log('[GDRIVE] Nuevo brain.db.json creado exitosamente.');
					return await loadLedger(); // Continúa con la carga del ledger
				} catch (createError) {
					console.error('[GDRIVE] CRÍTICO: Falló la creación del nuevo brain.db.json. Abortando.', createError.message);
					throw new Error('No se pudo crear el archivo de base de datos en Google Drive.');
				}
			}
			console.error('[GDRIVE] CRÍTICO: No se pudo cargar brain.db.json. Abortando para prevenir la pérdida de datos.', e.message, e.code);
			throw new Error('No se pudo cargar la base de datos principal desde Google Drive. Verifica los permisos del archivo.');
		}
	} else {
		if (fs.existsSync(DB_PATH)) {
			console.log('[FS] Cargando brain.db.json desde el sistema de archivos local...');
			const raw = fs.readFileSync(DB_PATH, 'utf8');
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object') db = Object.assign(db, parsed);
			console.log('[FS] brain.db.json cargado exitosamente.');
		} else {
			persist();
		}
	}

	// Cargar ledger
	await loadLedger();
}

async function loadLedger() {
	const drive = getDriveClient();
	if (drive && resolvedLedgerId) {
		try {
			console.log('[GDRIVE] Cargando saldos.ledger.json desde Google Drive...');
			const res = await drive.files.get({ fileId: resolvedLedgerId, alt: 'media' });
			const parsed = JSON.parse(res.data);
			if (parsed && typeof parsed === 'object') ledger = Object.assign(ledger, parsed);
			console.log('[GDRIVE] saldos.ledger.json cargado exitosamente.');
		} catch (e) {
			if (e.code === 404) {
				console.warn('[GDRIVE] saldos.ledger.json no encontrado. Creando uno nuevo...');
				try {
					ledger = { users: {}, movements: [] };
					await persistLedger();
					console.log('[GDRIVE] Nuevo saldos.ledger.json creado exitosamente.');
				} catch (createError) {
					console.error('[GDRIVE] Falló la creación de saldos.ledger.json.', createError.message);
				}
			} else {
				console.warn('[GDRIVE] No se pudo cargar saldos.ledger.json, usando estado inicial.', e.message);
			}
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
async function addGovernmentFunds(delta){
	const g = getGovernment();
	const add = Math.floor(delta||0);
	if(!isFinite(add) || add===0) return { ok:false };
	g.funds = Math.max(0, (g.funds||0) + add);
	await persist();
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
	const drive = getDriveClient();
	if (drive && process.env.NODE_ENV === 'production') {
		console.log('[GDRIVE] Verificando conexión y permisos al arrancar...');
		const health = await checkDriveHealth();
		if (health.ok) {
			console.log(`✅ Conexión con Drive OK`);
			console.log('🧠 brain:', health.brain);
			console.log('📒 ledger:', health.ledger);
			console.log('🧪 Vista previa brain (primeros bytes):', health.brainPreview);
		} else {
			console.error(`❌ Drive check FAILED:`, health.error);
			console.error(`Sugerencia: ${health.hint}`);
			throw new Error('Fallo en la verificación inicial de Google Drive.');
		}
	} else if (drive) {
		console.log('[GDRIVE] Cliente de Google Drive inicializado para desarrollo.');
	}
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
	checkDriveHealth,
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
