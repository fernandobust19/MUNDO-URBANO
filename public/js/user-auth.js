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
			<div class="modalBox" style="width:min(520px,94vw);">
				<div style="display:flex;align-items:center;gap:12px">
					<img src="/login/creador.png" alt="creador" style="width:64px;height:64px;border-radius:8px;border:1px solid #2b3553;background:#fff;object-fit:cover"/>
					<div>
						<h3 id="authTitle" style="margin:0">Inicia sesión</h3>
						<div id="authHint" class="hint">Ingresa tu usuario y contraseña para continuar.</div>
					</div>
				</div>
				<div class="field" style="margin-top:10px">
					<label>Usuario</label>
					<input id="authUser" name="username" class="input" type="text" placeholder="usuario" maxlength="24" autocomplete="username">
				</div>
				<div class="field" style="margin-top:6px">
					<label>Contraseña</label>
					<input id="authPass" name="password" class="input" type="text" placeholder="" maxlength="64" autocomplete="current-password" data-plain="1">
				</div>
				<!-- Campos adicionales para registro de nuevos usuarios (ocultos por defecto) -->
				<div class="field regOnly" style="margin-top:10px; display:none;">
					<label>País</label>
					<select id="authCountry" class="select">
						<option value="" selected>— Selecciona tu país —</option>
						<option>Argentina</option>
						<option>Bolivia</option>
						<option>Chile</option>
						<option>Colombia</option>
						<option>Costa Rica</option>
						<option>Cuba</option>
						<option>Ecuador</option>
						<option>El Salvador</option>
						<option>España</option>
						<option>Guatemala</option>
						<option>Honduras</option>
						<option>México</option>
						<option>Nicaragua</option>
						<option>Panamá</option>
						<option>Paraguay</option>
						<option>Perú</option>
						<option>Puerto Rico</option>
						<option>República Dominicana</option>
						<option>Uruguay</option>
						<option>Venezuela</option>
						<option>Otro</option>
					</select>
					<span class="hint">País, correo y género son obligatorios. Teléfono es opcional.</span>
				</div>
				<div class="field regOnly" style="margin-top:6px; display:none;">
					<label>Correo electrónico</label>
					<input id="authEmail" class="input" type="email" placeholder="tucorreo@ejemplo.com" maxlength="120" autocomplete="email">
				</div>
				<div class="field regOnly" style="margin-top:6px; display:none;">
					<label>Teléfono (opcional)</label>
					<input id="authPhone" class="input" type="tel" placeholder="Ej: +57 300 123 4567" maxlength="24" autocomplete="tel">
				</div>
				<div class="field regOnly" style="margin-top:6px; display:none;">
					<label>Género</label>
					<select id="authGender" class="select">
						<option value="" selected>— Selecciona género —</option>
						<option value="M">Hombre</option>
						<option value="F">Mujer</option>
					</select>
				</div>
				<div id="authErr" class="err" style="display:none;margin-top:6px"></div>
				<div class="actions" style="margin-top:10px; display:flex; align-items:center; justify-content:space-between; gap:8px;">
					<div style="display:flex; gap:8px;">
						<button id="btnAuthRegister" type="button" class="btn regOnly" style="display:none;">Registrar</button>
						<button id="btnAuthLogin" type="button" class="btn primary loginOnly">Iniciar sesión</button>
					</div>
					<button id="authToggle" type="button" class="btn" style="background:transparent; border-color:transparent; color:#2563eb;">¿No tienes cuenta? Regístrate</button>
				</div>
			</div>
			</form>`;
		document.body.appendChild(wrap);
	}

	function showAuth(on=true){ const m = document.getElementById('authModal'); if(!m) return; m.style.display = on ? 'flex' : 'none'; }
	function setErr(msg){ const e = document.getElementById('authErr'); if(!e) return; if(msg){ e.textContent = msg; e.style.display = 'block'; } else { e.style.display = 'none'; } }

	// Exponer helpers globales para requerir autenticación desde otras capas
	try{
		window.isAuthenticated = function(){ try{ return !!(window.__user && (window.__user.id || window.__user.username)); }catch(_){ return false; } };
		window.requireLogin = function(reason){
			try{ ensureAuthModal(); showAuth(true); setErr('Inicia sesión para continuar'); }catch(_){ }
			// Ocultar todo lo del mundo por seguridad
			try{ const fb = document.getElementById('formBar'); if(fb) fb.style.display='none'; }catch(_){ }
			try{ const ui = document.getElementById('uiDock'); if(ui) ui.style.display='none'; }catch(_){ }
			try{ const world = document.getElementById('world'); if(world) world.style.display='none'; }catch(_){ }
			try{ const mini = document.getElementById('mini'); if(mini) mini.style.display='none'; }catch(_){ }
			try{ const showBtn = document.getElementById('uiShowBtn'); if(showBtn) showBtn.style.display='none'; }catch(_){ }
			try{ const follow = document.getElementById('followFab'); if(follow) follow.style.display='none'; }catch(_){ }
		};
	}catch(_){ }

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
		const country = (document.getElementById('authCountry')?.value || '').trim();
		const email = (document.getElementById('authEmail')?.value || '').trim();
		const phone = (document.getElementById('authPhone')?.value || '').trim();
		const gender = (document.getElementById('authGender')?.value || '').trim();
		// Validaciones: país, correo y género obligatorios; teléfono opcional
		if(!country){ setErr('Selecciona tu país'); return; }
		if(!email){ setErr('Ingresa tu correo'); return; }
		if(!/^\S+@\S+\.\S+$/.test(email)){ setErr('Correo inválido'); return; }
		if(phone && (phone.replace(/[^0-9]/g,'').length < 7)){ setErr('Teléfono inválido'); return; }
		if(!['M','F'].includes(gender)) { setErr('Selecciona género (Hombre o Mujer)'); return; }
		try{
			const out = await call('POST', '/api/register', { username: u, password: p, country, email, phone, gender });
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
			// Recordar username localmente para prellenar en próximas visitas
			try{ if(out.user && out.user.username){ localStorage.setItem('lastUsername', out.user.username); } }catch(_){ }
			// Sincronizar género al progreso:
			// 1) Si el usuario tiene M/F y al progreso le falta, úsalo.
			// 2) Si el usuario no tiene M/F pero en el modal se eligió uno válido, tomarlo para esta sesión.
			try{
				const chosen = (document.getElementById('authGender')?.value || '').trim();
				const userG = out.user?.gender;
				if(userG && ['M','F'].includes(userG) && (!window.__progress.gender || !['M','F'].includes(window.__progress.gender))){
					window.__progress.gender = userG;
				}else if((!userG || !['M','F'].includes(userG)) && ['M','F'].includes(chosen)){
					window.__progress.gender = chosen; // preferir lo recién seleccionado
				}
			}catch(_){ }
			// Reflejar nombre de usuario
			const userName = document.getElementById('userName');
			if(userName) userName.textContent = out.user.username;
			// Inicializar saldo/vehículo desde progreso
			window.__onAuthProgress && window.__onAuthProgress(window.__progress);
			// Refrescar panel del banco con el saldo restaurado (antes de crear persona)
			try{ if(window.updateBankPanel){ window.updateBankPanel(window.__progress.money, out.user.username); } }catch(e){}
			// Mostrar formulario de creación de personaje tras iniciar sesión
			try { const fb = document.getElementById('formBar'); if(fb) fb.style.display = 'block'; }catch(e){}
			// Mantener ocultos el mundo y la UI hasta que el usuario cree su personaje
			try { const ui = document.getElementById('uiDock'); if(ui) ui.style.display = 'none'; }catch(e){}
			try { const world = document.getElementById('world'); if(world) world.style.display = 'none'; }catch(e){}
			try { const mini = document.getElementById('mini'); if(mini) mini.style.display = 'none'; }catch(e){}
			try { const showBtn = document.getElementById('uiShowBtn'); if(showBtn) showBtn.style.display = 'none'; }catch(e){}
			try { const follow = document.getElementById('followFab'); if(follow) follow.style.display = 'none'; }catch(e){}
			// Prefill del formulario con perfil guardado (nombre, avatar, gustos, género, edad)
			try{
				const prog = window.__progress || {};
				const fName = document.getElementById('fName');
				if(fName && prog.name){ fName.value = prog.name; }
				const fGender = document.getElementById('fGender');
				if(fGender){
					const chosen = (document.getElementById('authGender')?.value || '').trim();
					const best = (prog.gender && ['M','F'].includes(prog.gender)) ? prog.gender
						: (['M','F'].includes(out.user?.gender) ? out.user.gender
						: (['M','F'].includes(chosen) ? chosen : ''));
					if(best) fGender.value = best;
				}
				// Prefill popup extra fields si existen
				try{ const el = document.getElementById('authCountry'); if(el && out.user?.country) el.value = out.user.country; }catch(e){}
				try{ const el = document.getElementById('authEmail'); if(el && out.user?.email) el.value = out.user.email; }catch(e){}
				try{ const el = document.getElementById('authPhone'); if(el && out.user?.phone) el.value = out.user.phone; }catch(e){}
				try{ const el = document.getElementById('authGender'); if(el && out.user?.gender) el.value = out.user.gender; }catch(e){}
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
			// Actualizar mini lista de comprobantes si existe
			try{ window.refreshMyProofs && window.refreshMyProofs(); }catch(e){}
		} catch(e){}
		showAuth(false);
	}

	async function init(){
		ensureAuthModal();
		// Configurar campo de contraseña para mostrar en claro hasta que el usuario escriba algo
		try{
			const pass = document.getElementById('authPass');
			if(pass){
				pass.value='';
				pass.addEventListener('input', ()=>{
					if(pass.dataset.plain && pass.value.length>0){
						pass.type='password';
						delete pass.dataset.plain;
						if(!pass.placeholder) pass.placeholder='••••';
					}
				});
				pass.addEventListener('blur', ()=>{
					// si el usuario borró todo, volver a modo texto limpio
					if(pass.value.length===0){ pass.type='text'; pass.dataset.plain='1'; pass.placeholder=''; }
				});
			}
		}catch(_){ }
		document.getElementById('btnAuthRegister').addEventListener('click', handleRegister);
		document.getElementById('btnAuthLogin').addEventListener('click', handleLogin);
		// Toggle entre login y registro
		function setAuthMode(mode){
			const reg = mode === 'register';
			const title = document.getElementById('authTitle');
			const hint = document.getElementById('authHint');
			const regEls = document.querySelectorAll('.regOnly');
			const loginEls = document.querySelectorAll('.loginOnly');
			regEls.forEach(el=> el.style.display = reg ? (el.dataset?.display||'') || '' : 'none');
			loginEls.forEach(el=> el.style.display = reg ? 'none' : '');
			const toggle = document.getElementById('authToggle');
			if(reg){
				if(title) title.textContent = 'Crear cuenta';
				if(hint) hint.textContent = 'Completa tus datos para registrar tu cuenta.';
				if(toggle) toggle.textContent = '¿Ya tienes cuenta? Inicia sesión';
			}else{
				if(title) title.textContent = 'Inicia sesión';
				if(hint) hint.textContent = 'Ingresa tu usuario y contraseña para continuar.';
				if(toggle) toggle.textContent = '¿No tienes cuenta? Regístrate';
			}
		}
		const toggleBtn = document.getElementById('authToggle');
		if(toggleBtn){
			let mode = 'login';
			toggleBtn.addEventListener('click', ()=>{ mode = (mode==='login' ? 'register' : 'login'); setErr(''); setAuthMode(mode); });
			setAuthMode('login');
		}
		// Enviar con Enter: por defecto, intentar login
		const form = document.getElementById('authForm');
		if(form){ form.addEventListener('submit', (e)=>{ e.preventDefault(); handleLogin(); }); }
		// Botón SALIR: guardar primero y luego cerrar sesión para volver a la pantalla de usuario y contraseña
		const btnLogout = document.getElementById('btnLogout');
		if(btnLogout){ btnLogout.addEventListener('click', async ()=>{
			try{
				// Construir snapshot completo del progreso actual antes de cerrar sesión
				let payload = {};
				try{
					const prog = window.__progress || {};
					// Intentar detectar agente local para tomar dinero actual en vivo
					let liveMoney = null;
					try{ if(window.agents && window.USER_ID){ const me = window.agents.find(a=>a.id===window.USER_ID); if(me && typeof me.money==='number') liveMoney = Math.floor(me.money); } else if(window.playerId && window.agents){ const me2=window.agents.find(a=>a.id===window.playerId); if(me2 && typeof me2.money==='number') liveMoney=Math.floor(me2.money); } }catch(_){ }
					if(liveMoney!=null) payload.money = liveMoney; else if(typeof prog.money==='number') payload.money = Math.floor(prog.money);
					if(typeof prog.bank==='number') payload.bank = Math.floor(prog.bank);
					if(prog.vehicle) payload.vehicle = prog.vehicle;
					if(Array.isArray(prog.vehicles)) payload.vehicles = prog.vehicles.slice();
					// Casas y negocios propios desde el mundo (para reflejar compras recientes)
					try{ if(window.houses){ const mineH = window.houses.filter(h=>h && h.ownerId===window.USER_ID); if(mineH.length) payload.houses = mineH.map(h=>({ id:h.id||null, x:h.x,y:h.y,w:h.w,h:h.h, ownerId:h.ownerId })); }
					}catch(_){ }
					try{ if(window.shops){ const mineS = window.shops.filter(s=>s && s.ownerId===window.USER_ID); if(mineS.length) payload.shops = mineS.map(s=>({ id:s.id||null, kind:s.kind, x:s.x,y:s.y,w:s.w,h:s.h, ownerId:s.ownerId, buyCost:s.buyCost||0, price:s.price||0 })); }
					}catch(_){ }
					// Fondos de gobierno (solo lectura local, guardar si existen)
					try{ if(window.government && typeof window.government.funds==='number'){ payload.governmentFunds = Math.floor(window.government.funds); } }catch(_){ }
					// Bandera de arriendo inicial pagado y casa rentada
					try{ if(prog.initialRentPaid) payload.initialRentPaid = true; }catch(_){ }
					try{ if(typeof prog.rentedHouseIdx === 'number') payload.rentedHouseIdx = prog.rentedHouseIdx; }catch(_){ }
					// Datos básicos del perfil
					['name','avatar','likes','gender','age','country','email','phone'].forEach(k=>{ if(prog && (k in prog)) payload[k]=prog[k]; });
					// Agregar estado del mundo (posición/temporizadores) inmediato
					try{
						if(window.agents && (window.USER_ID || window.playerId)){
							const me = window.agents.find(a=> a.id===window.USER_ID || a.id===window.playerId);
							if(me){
								const nowS = performance.now()/1000;
								const world = { x: Math.floor(me.x||0), y: Math.floor(me.y||0), goingToWork: !!me.goingToWork, workFactoryId: (typeof me.workFactoryId==='number'? me.workFactoryId : null), targetRole: me.targetRole || null };
								if(me.target && typeof me.target.x==='number' && typeof me.target.y==='number') world.target = { x: Math.floor(me.target.x), y: Math.floor(me.target.y) };
								const left = (t)=> (typeof t==='number' && t>nowS) ? Math.floor(t - nowS) : 0;
								world.workingLeft = left(me.workingUntil);
								world.exploreLeft = left(me.exploreUntil);
								world.restLeft = left(me.restUntil);
								world.cooldownLeft = left(me.nextWorkAt);
								payload.world = world;
							}
						}
					}catch(_){ }
				}catch(_){ }
				// Guardar snapshot en progreso
				try{ await call('POST','/api/progress', payload); }catch(_){ }
				// Cerrar sesión para ir a la pantalla de login (el servidor guarda snapshot en ledger)
				try{ await call('POST','/api/logout'); }catch(_){ }
			}finally{
				location.reload();
			}
		}); }
		// Comprobar si hay sesión activa y avanzar directo; si no, mostrar modal y prellenar usuario recordado
		const me = await checkMe().catch(()=>null);
		if(me && me.ok){
			applyLogin(me);
			showAuth(false);
		}else{
			// Ocultar todo lo del mundo hasta iniciar sesión
			try{ const fb = document.getElementById('formBar'); if(fb) fb.style.display = 'none'; }catch(_){ }
			try{ const ui = document.getElementById('uiDock'); if(ui) ui.style.display = 'none'; }catch(_){ }
			try{ const world = document.getElementById('world'); if(world) world.style.display = 'none'; }catch(_){ }
			try{ const mini = document.getElementById('mini'); if(mini) mini.style.display = 'none'; }catch(_){ }
			try{ const showBtn = document.getElementById('uiShowBtn'); if(showBtn) showBtn.style.display = 'none'; }catch(_){ }
			try{ const follow = document.getElementById('followFab'); if(follow) follow.style.display = 'none'; }catch(_){ }
			showAuth(true);
			try{
				const uEl = document.getElementById('authUser');
				const last = localStorage.getItem('lastUsername');
				if(uEl && last) uEl.value = last;
				// Foco inmediato al usuario
				setTimeout(()=>{ try{ uEl && uEl.focus(); }catch(_){ } }, 0);
			}catch(_){ }
		}
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

