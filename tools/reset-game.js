// tools/reset-game.js
// Resetea el juego a estado fábrica: respalda y limpia brain.db.json y saldos.ledger.json.
// Uso: npm run reset

const fs = require('fs');
const path = require('path');

const ROOT = __dirname ? path.join(__dirname, '..') : process.cwd();
const DB = path.join(ROOT, 'brain.db.json');
const LEDGER = path.join(ROOT, 'saldos.ledger.json');

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(ROOT, 'memoria');
  try { if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true }); } catch {}
  const base = path.basename(file);
  const out = path.join(backupDir, `${base}.backup-${stamp}`);
  fs.copyFileSync(file, out);
  return out;
}

function resetDb() {
  const fresh = { users: [], progress: {}, government: { funds: 0, placed: [] }, activityLog: [] };
  fs.writeFileSync(DB, JSON.stringify(fresh, null, 2));
}

function resetLedger() {
  const fresh = { users: {}, movements: [] };
  fs.writeFileSync(LEDGER, JSON.stringify(fresh, null, 2));
}

(function main(){
  console.log('🔄 Reset del juego: respaldando y limpiando archivos...');
  const b1 = backup(DB);
  const b2 = backup(LEDGER);
  if (b1) console.log(`  • Backup DB -> ${b1}`); else console.log('  • DB aún no existe, se creará nueva');
  if (b2) console.log(`  • Backup Ledger -> ${b2}`); else console.log('  • Ledger aún no existe, se creará nuevo');
  resetDb();
  resetLedger();
  console.log('✅ Listo. Usuarios/progreso y ledger vacíos.');
  console.log('Sugerencia: reinicia el servidor: npm start');
})();
