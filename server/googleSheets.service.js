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

async function appendRow({ spreadsheetId, sheetName, values }){
  const sheets = await getSheetsClient();
  const range = `${sheetName}!A1`;
  const resource = { values: [values] };
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: resource
  });
  return true;
}

module.exports = { appendRow };
