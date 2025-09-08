const { upsertFile } = require('./github.service');
const { ghRepo, ghBranch, ghToken, ghPrefix } = require('./config');

function dayOf(iso){ return iso.slice(0,10); }

async function publishDailyHtml(record){
  if(!(ghRepo && ghToken)) throw new Error('GitHub no configurado');
  const day = dayOf(record.iso);
  const path = `${ghPrefix}/registros-${day}.html`;
  const safe = (s)=> String(s||'').replace(/[<>]/g, c=> ({'<':'&lt;','>':'&gt;'}[c]));
  // Para simplicidad, regeneramos con un solo registro si el archivo no existe; si existe, dejamos que GitHub API lo sobrescriba.
  const html = `<!doctype html><meta charset="utf-8"><title>Registros ${day}</title>`+
    `<style>body{font-family:system-ui,Segoe UI,Arial}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px}</style>`+
    `<h1>Registros ${day}</h1>`+
    `<table><thead><tr><th>Fecha</th><th>UserId</th><th>Usuario</th><th>Número</th></tr></thead>`+
    `<tbody><tr><td>${safe(record.iso)}</td><td>${safe(record.userId)}</td><td>${safe(record.username)}</td><td>${safe(record.receiptNumber)}</td></tr></tbody></table>`;
  await upsertFile({ repo: ghRepo, path, branch: ghBranch||'main', token: ghToken, content: html, message: `Registro ${day}` });
}

module.exports = { publishDailyHtml };
