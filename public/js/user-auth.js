// user-auth.js — UI de login/registro + integración con API
(() => {
	// Crear modal simple si no existe
	function ensureAuthModal(){
		if(document.getElementById('authModal')) return;
		const wrap = document.createElement('div');
		wrap.id = 'authModal';
		wrap.style.position = 'fixed';
		wrap.style.inset = '0';
		wrap.style.zIndex = '60';
		wrap.style.display = 'flex';
		wrap.style.alignItems = 'flex-start';
		wrap.style.justifyContent = 'center';
		wrap.style.paddingTop = '8vh';
		// Fondo con imagen de registro y leve oscurecido para legibilidad
		wrap.style.background = 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url("/assets/registro.jpg")';
		wrap.style.backgroundSize = 'cover';
		wrap.style.backgroundPosition = 'center';
		wrap.style.backgroundRepeat = 'no-repeat';
		wrap.style.backgroundAttachment = 'fixed';
		wrap.innerHTML = `
			<form id="authForm" autocomplete="on">
			<div class="modalBox" style="width:min(460px,94vw);">
				<div style="display:flex;align-items:center;gap:12px">
					<img src="/login/creador.png" alt="creador" style="width:64px;height:64px;border-radius:8px;border:1px solid #2b3553;background:#fff;object-fit:cover"/>
					<div>
						<h3 style="margin:0">Bienvenido</h3>
						<div class="hint">Regístrate o inicia sesión para guardar tu progreso.</div>
					</div>
				</div>
				<div class="field" style="margin-top:10px">
					<label>Usuario</label>
					<input id="authUser" name="username" class="input" type="text" placeholder="usuario" maxlength="24" autocomplete="username">
				</div>
				<div class="field" style="margin-top:6px">
					<label>Contraseña</label>
					<input id="authPass" name="password" class="input" type="password" placeholder="••••" maxlength="64" autocomplete="current-password">
				</div>
				<div id="authErr" class="err" style="display:none;margin-top:6px"></div>
				<div class="actions" style="margin-top:10px">
					<button id="btnAuthRegister" type="button" class="btn">Registrar</button>
					<button id="btnAuthLogin" type="button" class="btn primary">Iniciar sesión</button>
				</div>
			</div>
			</form>`;
		document.body.appendChild(wrap);
	}

	function showAuth(on=true){ const m = document.getElementById('authModal'); if(!m) return; m.style.display = on ? 'flex' : 'none'; }
	function setErr(msg){ const e = document.getElementById('authErr'); if(!e) return; if(msg){ e.textContent = msg; e.style.display = 'block'; } else { e.style.display = 'none'; } }

	async function call(method, url, body){
		const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, credentials: 'include' });
		const json = await res.json().catch(()=>({ ok:false }));
		if(!res.ok || !json.ok) throw new Error(json.msg || 'Error');
		return json;
	}

	async function checkMe(){ try{ return await call('GET', '/api/me'); }catch(e){ return null; } }

	async function handleRegister(){
		setErr('');
		const u = document.getElementById('authUser').value.trim();
		const p = document.getElementById('authPass').value;
		try{
			const out = await call('POST', '/api/register', { username: u, password: p });
			applyLogin(out);
		}catch(e){ setErr(e.message || 'No se pudo registrar'); }
	}
	async function handleLogin(){
		setErr('');
		const u = document.getElementById('authUser').value.trim();
		const p = document.getElementById('authPass').value;
		try{
			const out = await call('POST', '/api/login', { username: u, password: p });
			applyLogin(out);
		}catch(e){ setErr(e.message || 'No se pudo iniciar'); }
	}

	function applyLogin(out){
		try {
			window.__user = out.user;
			window.__progress = out.progress || {};
			// Reflejar nombre de usuario
			const userName = document.getElementById('userName');
			if(userName) userName.textContent = out.user.username;
			// Inicializar saldo/vehículo desde progreso
			window.__onAuthProgress && window.__onAuthProgress(window.__progress);
			// Refrescar panel del banco con el saldo restaurado (antes de crear persona)
			try{ if(window.updateBankPanel){ window.updateBankPanel(window.__progress.money, out.user.username); } }catch(e){}
			// Mostrar formulario de creación de personaje tras iniciar sesión
			try { const fb = document.getElementById('formBar'); if(fb) fb.style.display = 'block'; }catch(e){}
			// Asegurar que la UI del mundo permanezca oculta hasta crear la persona
			try { const ui = document.getElementById('uiDock'); if(ui) ui.style.display = 'none'; }catch(e){}
			// Prefill del formulario con perfil guardado (nombre, avatar, gustos, género, edad)
			try{
				const prog = window.__progress || {};
				const fName = document.getElementById('fName');
				if(fName && prog.name){ fName.value = prog.name; }
				const fGender = document.getElementById('fGender');
				if(fGender && prog.gender){ fGender.value = prog.gender; }
				const fAge = document.getElementById('fAge');
				if(fAge && typeof prog.age === 'number'){ fAge.value = String(prog.age); }
				const likesWrap = document.getElementById('likesWrap');
				if(likesWrap && Array.isArray(prog.likes) && prog.likes.length){
					const set = new Set(prog.likes);
					likesWrap.querySelectorAll('input[type="checkbox"]').forEach(cb=>{ cb.checked = set.has(cb.value); });
					try{ const likesCount = document.getElementById('likesCount'); if(likesCount) likesCount.textContent = String(Math.min(5, prog.likes.length)); }catch(e){}
				}
				if(prog.avatar){
					try{ localStorage.setItem('selectedAvatar', prog.avatar); }catch(e){}
					try{ const uiAvatar = document.getElementById('uiAvatar'); if(uiAvatar) uiAvatar.src = prog.avatar; }catch(e){}
				}
				// Si ya hay nombre y 5 gustos, habilitar el botón Comenzar de inmediato
				try{ window.updateLikesUI && window.updateLikesUI(); }catch(e){}
			}catch(e){}
			// Refrescar concesionario: marcar vehículos ya comprados
			try{ window.updateCarMenuHighlight && window.updateCarMenuHighlight(); }catch(e){}
		} catch(e){}
		showAuth(false);
	}

	async function init(){
		ensureAuthModal();
		document.getElementById('btnAuthRegister').addEventListener('click', handleRegister);
		document.getElementById('btnAuthLogin').addEventListener('click', handleLogin);
		// Enviar con Enter: por defecto, intentar login
		const form = document.getElementById('authForm');
		if(form){ form.addEventListener('submit', (e)=>{ e.preventDefault(); handleLogin(); }); }
		// Botón SALIR (el servidor hace snapshot de dinero en /api/logout)
		const btnLogout = document.getElementById('btnLogout');
		if(btnLogout){ btnLogout.addEventListener('click', async ()=>{ try{ await call('POST','/api/logout'); location.reload(); }catch(e){ location.reload(); } }); }
		// Forzar mostrar la ventana de autenticación primero
		const me = await checkMe().catch(()=>null);
		showAuth(true);
		// Si hay sesión existente, prellenar el usuario para facilitar continuar
		try{ if(me && me.ok && me.user?.username){ const u=document.getElementById('authUser'); if(u) u.value = me.user.username; } }catch(e){}
	}

	// Exponer helper para que original.js aplique progreso inicial a la entidad del jugador
	window.__onAuthProgress = function(progress){
		try {
			// Guardar para consultas globales
			window.__progress = progress || {};
		} catch(e){}
	};

	// Guardar progreso con debounce para evitar ráfagas/recursión indirecta
	let __saveTimer = null;
	let __saveQueued = null;
	window.saveProgress = function(patch){
		try{
			// Acumular cambios (merge superficial)
			if (!__saveQueued) __saveQueued = Object.assign({}, window.__progress || {});
			if (patch && typeof patch === 'object') {
				Object.assign(__saveQueued, patch);
			}
			clearTimeout(__saveTimer);
			__saveTimer = setTimeout(async ()=>{
				const payload = __saveQueued || (window.__progress || {});
				__saveQueued = null;
				try{ await call('POST', '/api/progress', payload); }catch(_){ /* ignorar */ }
			}, 400);
		}catch(_){ /* noop */ }
	};

	// Iniciar
	if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

