// Simple smoke test: start a session and fetch /api/me using cookie
const http = require('http');

function req(method, path, body=null, headers={}){
	return new Promise((resolve, reject)=>{
		const data = body ? Buffer.from(JSON.stringify(body)) : null;
		const opts = { method, hostname: 'localhost', port: 3000, path, headers: Object.assign({ 'Content-Type': 'application/json' }, headers) };
		if(data){ opts.headers['Content-Length'] = data.length; }
		const req = http.request(opts, res =>{
			let buf=''; res.on('data', c=> buf+=c);
			res.on('end', ()=>{
				resolve({ status: res.statusCode, headers: res.headers, text: buf, json: (()=>{ try{return JSON.parse(buf);}catch(_){return null;} })() });
			});
		});
		req.on('error', reject);
		if(data) req.write(data);
		req.end();
	});
}

(async function(){
	try{
		// Register or login
		const username = 'smoke_' + Math.random().toString(36).slice(2,8);
		const password = 'test1234';
		const r1 = await req('POST','/api/register',{ username, password });
		const setCookie = r1.headers['set-cookie'] && r1.headers['set-cookie'][0];
		const cookie = setCookie ? setCookie.split(';')[0] : '';
		const ok1 = r1.status === 200 && r1.json && r1.json.ok;
		console.log('register:', r1.status, ok1);
		// GET /api/me with cookie
		const r2 = await req('GET','/api/me', null, cookie ? { 'Cookie': cookie } : {});
		const ok2 = r2.status === 200 && r2.json && r2.json.ok;
		console.log('me:', r2.status, ok2, r2.json && r2.json.user);
		if(!ok1 || !ok2){ process.exitCode = 1; }
	}catch(e){ console.error('smoke error', e); process.exitCode = 1; }
})();

