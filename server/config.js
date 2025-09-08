module.exports = {
  storageMode: (process.env.STORAGE_MODE || 'ephemeral').toLowerCase(), // sheets|github|email|txt|ephemeral
  // TXT registros (opcional): si no se define, usará <raiz>/registros
  registrosDir: process.env.REGISTROS_DIR,
  // Sheets
  gsaJson: process.env.GOOGLE_SA_JSON,
  sheetId: process.env.GSHEET_ID,
  sheetTab: process.env.GSHEET_TAB || 'Hoja1',
  // GitHub
  ghToken: process.env.GH_TOKEN,
  ghRepo: process.env.GH_REPO,          // owner/repo
  ghBranch: process.env.GH_BRANCH || 'main',
  ghPrefix: process.env.GH_PATH_PREFIX || 'public',
  // Email
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    to: process.env.NOTIFY_TO,
  }
};
