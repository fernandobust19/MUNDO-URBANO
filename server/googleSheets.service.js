const { google } = require('googleapis');

async function getSheetsClient(){
  const creds = process.env.GOOGLE_SA_JSON;
  if(!creds) throw new Error('GOOGLE_SA_JSON no definido');
  let parsed;
  try{ parsed = JSON.parse(creds); }catch(e){ throw new Error('GOOGLE_SA_JSON inválido'); }
  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
  const pk = (parsed.private_key || '').includes('BEGIN PRIVATE KEY')
    ? parsed.private_key
    : String(parsed.private_key||'').replace(/\\n/g, '\n');
  const auth = new google.auth.JWT(parsed.client_email, null, pk, scopes);
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

// Evita re-escribir encabezados múltiples veces por ejecución
const ENSURED_TABS = new Set();
async function ensureHeaders({ sheets, spreadsheetId, sheetName, headers = ['Fecha','UserID','Username','Número'] }){
  const key = `${spreadsheetId}|${sheetName}`;
  if(ENSURED_TABS.has(key)) return true;
  try{
    const range = `${sheetName}!A1:D1`;
    const r = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const row = (r.data && r.data.values && r.data.values[0]) || null;
    const isEmpty = !row || row.every(v => String(v||'').trim() === '');
    if(isEmpty){
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [headers] }
      });
    }
    ENSURED_TABS.add(key);
    return true;
  }catch(_){
    // Si falla la lectura/actualización, continuar sin bloquear el append
    return false;
  }
}

async function appendRow({ spreadsheetId, sheetName, values }){
  const sheets = await getSheetsClient();
  const resource = { values: [values] };
  async function doAppend(tab){
    await ensureHeaders({ sheets, spreadsheetId, sheetName: tab });
    const range = `${tab}!A1`;
    return sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: resource
    });
  }
  try{
    await doAppend(sheetName);
    return true;
  }catch(e){
    const msg = e && (e.message||'');
    // Si la pestaña no existe o el rango es inválido, intentar con la primera hoja
    if(/invalidRange|Unable to parse range|notFound|Sheet not found/i.test(msg)){
      const info = await getSheetInfo(spreadsheetId).catch(()=>null);
      const fallback = info && info.firstSheet ? info.firstSheet : null;
      if(fallback && fallback !== sheetName){
        await doAppend(fallback);
        return true;
      }
    }
    throw e;
  }
}

async function getSheetInfo(spreadsheetId){
  const sheets = await getSheetsClient();
  const r = await sheets.spreadsheets.get({ spreadsheetId });
  const title = r.data?.properties?.title || null;
  const firstSheet = r.data?.sheets?.[0]?.properties?.title || null;
  return { title, firstSheet };
}

module.exports = { appendRow, getSheetInfo };
