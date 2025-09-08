const BASE = 'https://api.github.com';

function getHeaders(token){
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json'
  };
}

async function getFileSha({ repo, path, branch='main', token }){
  const url = `${BASE}/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const r = await fetch(url, { headers: getHeaders(token) });
  if(r.status === 404) return null;
  if(!r.ok) throw new Error(`GitHub getFile failed: ${r.status}`);
  const js = await r.json();
  return js && js.sha ? js.sha : null;
}

async function upsertFile({ repo, path, branch='main', token, content, message }){
  const sha = await getFileSha({ repo, path, branch, token });
  const body = {
    message: message || `update ${path}`,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch
  };
  if(sha) body.sha = sha;
  const url = `${BASE}/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const r = await fetch(url, { method:'PUT', headers: getHeaders(token), body: JSON.stringify(body) });
  if(!r.ok){ const t = await r.text().catch(()=> ''); throw new Error(`GitHub upsert failed: ${r.status} ${t}`); }
  const js = await r.json();
  return js;
}

module.exports = { upsertFile };
