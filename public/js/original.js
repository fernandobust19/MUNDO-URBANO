// Archivo restaurado: sin <script> ni IIFE innecesario
  const $ = s => document.querySelector(s);
  const show = (el, on=true)=>{
    if(!el) return;
    try{
      // Si es el panel principal, usar clase collapsed para animación
      if(el.id === 'uiDock'){
        if(on){ el.classList.remove('collapsed'); el.style.display='flex'; }
        else { el.classList.add('collapsed'); /* dejar display para la animación y desactivar interacción */ setTimeout(()=>{ if(el.classList.contains('collapsed')) el.style.display='none'; }, 280); }
        return;
      }
      // Modal-like elements: mantener comportamiento previo
      el.style.display = on? 'flex':'none';
    }catch(e){ console.warn('show() error', e); }
  };
  const toastLimiter = { last: 0, gap: 400 }; // ms
  const toast = (msg)=>{
    const now = performance.now();
    if (now - toastLimiter.last < toastLimiter.gap) return;
    toastLimiter.last = now;
    const _t = document.querySelector("#toast"); // Quitar las comillas extras
    if(_t){ _t.textContent=msg; _t.style.display='block'; clearTimeout(toast._id); toast._id=setTimeout(()=>_t.style.display='none',2400); }
  };

  window.addEventListener('error', e => { try{toast('⚠️ Error: '+(e.message||'JS'));}catch(_){} });
  window.addEventListener('unhandledrejection', e => { try{toast('⚠️ Promesa: '+(e.reason?.message||'error'));}catch(_){} });

  // Salvaguarda temprana: si el progreso ya indica que pagó el arriendo inicial,
  // impedir que cualquier lógica posterior muestre el prompt o bloquee el juego.
  // (Se refuerza luego dentro de startWorldWithUser, pero esto evita parpadeos.)
  try{
    const pr = (window.__progress||{});
    if(pr.initialRentPaid){
      window.__rentBlocked = false; // asegurar desbloqueado
      // Marcar una bandera para que la creación de UI de arriendo se salte siempre
      window.__skipInitialRentPrompt = true;
    }
  }catch(_){ }

  // Red: helpers para multijugador
  const hasNet = () => !!(window.sock && window.sock.connected);
  let __lastNetSend = 0;
  let __lastSentState = { x: -1, y: -1, money: -1 };

  // ====== SUAVIZADO REMOTO (nuevo) ======
  const REMOTE = {
    BUFFER: {},     // id -> [{x,y,t}, ...]
    SMOOTH: {},     // id -> {x,y,vx,vy}
    STATS: {},      // id -> {delay, iat:[], lastTs:0}
    BASE_DELAY: 110,     // ms mínimo (sube a 120 si ves micro-tirón)
    DELAY_MAX: 170,      // ms tope
    EXTRA_GUARD: 10,     // ms sobre p80
    MAX_BUF: 24,         // snapshots guardados
    K: 18.0,             // rigidez del filtro crítico (12–24)
    DEADZONE: 0.18       // px: evita microtemblores
  };

    /* ===== FORMULARIO ===== */
  const formBar = $("#formBar"), fGender=$("#fGender"), fName=$("#fName"), fAge=$("#fAge"), fUsd=$("#fUsd");
  // Enforce age rules: editable typing, clamp on blur/change, keep 20–89
  (function enforceAgeField(){
    try{
      if(!fAge) return;
      // HTML constraints
      fAge.min = '20'; fAge.max = '89'; fAge.step = '1';
      if(!fAge.value) fAge.value = '20';
      const clamp = (v)=> Math.max(20, Math.min(89, (v|0)));
      // Permitir escribir/borrar libremente; sólo limpiar caracteres no numéricos
      const onInput = ()=>{
        const raw = fAge.value;
        if(raw === '') return; // permitir vacío mientras escribe
        const digits = raw.replace(/[^0-9]/g, '');
        if(digits !== raw) fAge.value = digits;
      };
      // Al salir del campo o confirmar cambio, ajustar a rango
      const onCommit = ()=>{
        let v = parseInt(fAge.value || '20', 10);
        if(Number.isNaN(v)) v = 20;
        fAge.value = String(clamp(v));
      };
      fAge.addEventListener('input', onInput);
      fAge.addEventListener('change', onCommit);
      fAge.addEventListener('blur', onCommit);
      // Rueda del mouse: incrementar/decrementar respetando límites
      fAge.addEventListener('wheel', (e)=>{
        e.preventDefault();
        let v = parseInt(fAge.value || '20', 10);
        if(Number.isNaN(v)) v = 20;
        v += (e.deltaY > 0 ? -1 : 1);
        fAge.value = String(clamp(v));
      }, { passive:false });
    }catch(_){ }
  })();
  const btnBuy500 = document.getElementById('btnBuy500');
  async function createPaymentIntent(){
    const r = await fetch('/api/pay/create-intent', { method:'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({}), credentials:'include' });
    if(!r.ok) throw new Error('No se pudo crear la intención');
    return r.json();
  }
  async function pollPaymentStatus(ref, ms=10000){
    const started = Date.now();
    while(Date.now()-started < ms){
      await new Promise(r=>setTimeout(r, 1500));
      try{
        const q = await fetch('/api/pay/status?ref='+encodeURIComponent(ref), { credentials:'include' });
        if(!q.ok) continue;
        const js = await q.json();
        if(js && js.ok && js.credited){ return true; }
      }catch(_){ }
    }
    return false;
  }
  if(btnBuy500){
    btnBuy500.addEventListener('click', async ()=>{
      try{
        if(!window.__user){
          try{ const m = document.getElementById('authModal'); if(m) m.style.display='flex'; }catch(_){ }
          toast('Inicia sesión para comprar créditos.');
          return;
        }
        const res = await createPaymentIntent();
        if(!res || !res.ok) throw new Error('Intent falló');
        const url = res.url; const ref = res.ref;
        window.open(url, '_blank', 'noopener');
        toast('Abriendo pago en nueva pestaña…');
        const ok = await pollPaymentStatus(ref, 120000);
        if(ok){
          try{
            // Intentar refrescar progreso del servidor para evitar doble conteo
            const me = await fetch('/api/me', { credentials:'include' });
            if(me.ok){
              const data = await me.json();
              if(data && data.ok && data.progress){
                window.__progress = Object.assign({}, window.__progress||{}, data.progress);
                toast('Pago verificado: tu saldo se actualizó en el servidor.');
                return;
              }
            }
            // Fallback: si no pudimos refrescar, marca fUsd para sumar +500 al inicio
            if(fUsd) fUsd.value = '5';
            toast('Pago verificado. Se sumarán +500 al iniciar.');
          }catch(_){ if(fUsd) fUsd.value = '5'; toast('Pago verificado. Se sumarán +500 al iniciar.'); }
        } else {
          toast('Aún no se confirmó el pago. Puedes intentarlo de nuevo.');
        }
      }catch(e){ console.warn('buy500 error', e); toast('No se pudo iniciar el pago.'); }
    });
  }

  // N° doc. eliminado por solicitud

  // Mini lista de comprobantes del usuario
  // Eliminar mini lista de comprobantes; dejar stub para no romper llamadas externas
  window.refreshMyProofs = function(){};

  // (Botón de verificación de comprobantes eliminado por solicitud)
  const fGenderPreview = document.getElementById('fGenderPreview');
  const MALE_IMG = '/assets/avatar1.png';
  const MALE_IMG_2 = '/assets/avatar2.png';
  const FEMALE_IMG = '/assets/avatar3.png';
  const FEMALE_IMG_2 = '/assets/avatar4.png';
  // Variable global runtime para priorizar siempre el avatar recientemente seleccionado o subido (incluye data URLs)
  window.__selectedAvatarCurrent = window.__selectedAvatarCurrent || null;

  // Avatar grid clickable thumbnails
  const avatarGrid = document.getElementById('avatarGrid');
  const uiAvatarEl = document.getElementById('uiAvatar');
  // Placeholder de avatar: fondo blanco y un gran signo de pregunta
  const AVATAR_PLACEHOLDER = "data:image/svg+xml;utf8,\
<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'>\
<rect width='100%' height='100%' fill='white'/>\
<text x='50%' y='52%' text-anchor='middle' dominant-baseline='middle' font-size='84' font-family='Segoe UI, Arial, sans-serif' fill='%239ca3af'>?</text>\
</svg>";
  const avatarFile = document.getElementById('avatarFile');
  const btnUploadAvatar = document.getElementById('btnUploadAvatar');
  const btnRemoveAvatar = document.getElementById('btnRemoveAvatar');
  function clearAvatarSelection(){ if(!avatarGrid) return; avatarGrid.querySelectorAll('.avatar-option').forEach(b=>b.classList.remove('selected')); }
  if(avatarGrid){
    avatarGrid.addEventListener('click', (ev)=>{
      const btn = ev.target.closest('.avatar-option'); if(!btn) return;
      const src = btn.getAttribute('data-src');
      if(!src) return;
      clearAvatarSelection(); btn.classList.add('selected');
  // set preview and UI avatar
  try{ if(fGenderPreview) fGenderPreview.src = src; if(uiAvatarEl) uiAvatarEl.src = src; }catch(e){}
      // set the select value too for form persistence (safe check if avatarSelect isn't declared)
      try{ if(typeof avatarSelect !== 'undefined' && avatarSelect) avatarSelect.value = src; }catch(e){}
      // persist selection so it survives reloads and is applied to UI avatar
      try{
        localStorage.setItem('selectedAvatar', src);
        window.__selectedAvatarCurrent = src;
        window.__progress = Object.assign({}, window.__progress||{}, { avatar: src });
        window.saveProgress && window.saveProgress({ avatar: src });
  if(typeof USER_ID !== 'undefined' && USER_ID){ const me = agents.find(a=>a.id===USER_ID); if(me){ if(me.avatar !== src){ me.avatar = src; try{ AVATAR_CACHE && AVATAR_CACHE.delete && AVATAR_CACHE.delete(src); }catch(_){} try{ window.sockApi?.update({ avatar: src }); }catch(_){} } } }
      }catch(e){}
    });
    // restore saved selection (if any). Si no hay, usar placeholder con '?'
    try{
      const isValidSrc = (v)=> typeof v === 'string' && v.length > 0 && (/^data:/.test(v) || /^https?:/.test(v) || v.startsWith('/'));
      let saved = null;
      try{ saved = localStorage.getItem('selectedAvatar'); }catch(_){ saved = null; }
      // Si viene algo raro (e.g., "[object Object]" o JSON), intentar normalizar
      if(saved && !isValidSrc(saved)){
        try{ const parsed = JSON.parse(saved); if(isValidSrc(parsed)) saved = parsed; else saved = null; }catch(_){ saved = null; }
      }
      if(isValidSrc(saved)){
        // marcar opción si coincide con el grid
        try{
          const match = avatarGrid.querySelector(`.avatar-option[data-src="${CSS.escape(saved)}"]`);
          if(match){ clearAvatarSelection(); match.classList.add('selected'); }
        }catch(_){ }
        try{
          const src = (typeof saved === 'string') ? saved : String(saved || '');
          // Si el guardado es el placeholder, sólo reflejar en la vista previa
          if(fGenderPreview) fGenderPreview.src = src;
          if(src !== AVATAR_PLACEHOLDER){ if(uiAvatarEl) uiAvatarEl.src = src; }
        }catch(_){ }
      } else {
        // No hay avatar guardado: mostrar placeholder en la vista previa y no auto-seleccionar
        try{ if(fGenderPreview) fGenderPreview.src = AVATAR_PLACEHOLDER; }catch(_){ }
      }
    }catch(e){
      // Si hay error con localStorage: usar placeholder en la vista previa
      try{ if(fGenderPreview) fGenderPreview.src = AVATAR_PLACEHOLDER; }catch(_){ }
    }
  }
  // Soporte para subir foto como avatar (Data URL en cliente)
  if(btnUploadAvatar && avatarFile){
    btnUploadAvatar.addEventListener('click', ()=> avatarFile.click());
    avatarFile.addEventListener('change', (e)=>{
      const file = e.target.files && e.target.files[0];
      if(!file) return;
      if(!file.type.startsWith('image/')){ toast('El archivo debe ser una imagen.'); return; }
      const reader = new FileReader();
      reader.onload = ()=>{
        try{
          const src = reader.result; // data URL
          try{ if(fGenderPreview) fGenderPreview.src = src; if(uiAvatarEl) uiAvatarEl.src = src; }catch(_){ }
          try{ localStorage.setItem('selectedAvatar', src); }catch(_){ }
          try{
            window.__selectedAvatarCurrent = src;
            window.__progress = Object.assign({}, window.__progress||{}, { avatar: src });
            window.saveProgress && window.saveProgress({ avatar: src });
            if(typeof USER_ID !== 'undefined' && USER_ID){ const me = agents.find(a=>a.id===USER_ID); if(me){ if(me.avatar !== src){ me.avatar = src; try{ AVATAR_CACHE && AVATAR_CACHE.delete && AVATAR_CACHE.delete(src); }catch(_){} try{ window.sockApi?.update({ avatar: src }); }catch(_){} } } }
          }catch(_){ }
        }catch(_){ }
      };
      reader.onerror = ()=>{ toast('No se pudo leer la imagen.'); };
      reader.readAsDataURL(file);
    }, { passive:true });
  }
  // Quitar foto y volver a avatar por defecto
  if(btnRemoveAvatar){
    btnRemoveAvatar.addEventListener('click', ()=>{
      try{
        const src = AVATAR_PLACEHOLDER;
        // Actualizar vista previa y avatar del UI
        try{ if(fGenderPreview) fGenderPreview.src = src; }catch(_){ }
        try{ if(uiAvatarEl) uiAvatarEl.src = src; }catch(_){ }
        // Persistir y notificar servidor
        try{ localStorage.setItem('selectedAvatar', src); }catch(_){ }
        try{
          window.__selectedAvatarCurrent = src;
          window.__progress = Object.assign({}, window.__progress||{}, { avatar: src });
          window.saveProgress && window.saveProgress({ avatar: src });
          try{ window.sockApi?.update({ avatar: src }); }catch(_){ }
        }catch(_){ }
        toast('Se quitó la foto. Vista previa con ?');
      }catch(e){}
    });
  }
  function updateGenderPreview(){
    try{
      if(!fGender || !fGender.value || !fGenderPreview) return;
      if(fGender.value === 'M') fGenderPreview.src = MALE_IMG;
      else if(fGender.value === 'F') fGenderPreview.src = FEMALE_IMG;
      // Si es otro valor, mantener placeholder
    }catch(e){}
  }
  if(fGender){ fGender.addEventListener('change', updateGenderPreview); updateGenderPreview(); }
  const btnStart=$("#btnStart"), btnRandLikes=$("#btnRandLikes"), errBox=$("#errBox");
  const likesWrap=$("#likesWrap"), likesCount=$("#likesCount");
  const getBoxes=()=> Array.from(likesWrap.querySelectorAll('input[type="checkbox"]'));
  const getChecked=()=> getBoxes().filter(x=>x.checked);
  function updateLikesUI(){
    const count = getChecked().length;
    likesCount.textContent = count;
    const disableOthers = count >= 5;
    getBoxes().forEach(cb=>{
      if(!cb.checked){
        cb.disabled = disableOthers;
        cb.closest('.chip')?.classList.toggle('disabled', disableOthers);
      }else{
        cb.disabled = false;
        cb.closest('.chip')?.classList.remove('disabled');
      }
    });
    // Habilitar/deshabilitar el botón Comenzar según validación
    const nameOk = fName && fName.value.trim().length > 0;
    btnStart.disabled = !(nameOk && count === 5);
  }
  // Exponer para que el flujo de login pueda refrescar el estado del botón Comenzar
  try{ window.updateLikesUI = updateLikesUI; }catch(e){}
  function attachLimit(){getBoxes().forEach(cb=>{['click','change','touchend'].forEach(ev=>{cb.addEventListener(ev, ()=>{const checked=getChecked();if(checked.length>5){cb.checked=false;}updateLikesUI();},{passive:true});});});}
  attachLimit(); updateLikesUI();
  if(fName){
    fName.addEventListener('input', updateLikesUI);
  }
  btnRandLikes.onclick = ()=>{getBoxes().forEach(cb=>{ cb.checked=false; cb.disabled=false; cb.closest('.chip')?.classList.remove('disabled'); });const boxes = getBoxes(); let picks = 0;while(picks<5){ const i=(Math.random()*boxes.length)|0; if(!boxes[i].checked){ boxes[i].checked=true; picks++; } }updateLikesUI();};
// Asegurar que el botón Comenzar esté habilitado/deshabilitado al azar también
btnRandLikes.addEventListener('click', updateLikesUI);

  /* ===== CANVAS / MUNDO ===== */
  const canvas=$("#world"), ctx=canvas.getContext('2d', {alpha: false});
  const uiDock=$("#uiDock"), uiHideBtn=$("#uiHideBtn"), uiShowBtn=$("#uiShowBtn");
  // Mantener UI del mundo oculta al cargar; se mostrará tras crear personaje
  try{ if(uiDock) uiDock.style.display='none'; }catch(e){}
  // Controles de zoom fueron removidos; mantener referencias nulas para compatibilidad
  const zoomFab = null, zoomIn = null, zoomOut = null, docDock=$("#docDock"), govDock=$("#govDock"), topBar=null;
  const mini=$("#mini"), miniCanvas=$("#miniCanvas"), mctx=miniCanvas.getContext('2d');
  const stats=$("#stats"), toggleLinesBtn=$("#toggleLines");
  // El botón de líneas puede no existir: envolver en chequeo
  if(toggleLinesBtn){
    toggleLinesBtn.addEventListener('click', ()=>{
      SHOW_LINES = !SHOW_LINES;
      try{ toggleLinesBtn.textContent = SHOW_LINES ? 'Líneas ON' : 'Líneas OFF'; }catch(_){ }
    });
  }
  const btnShowAgentDoc=$("#btnShowAgentDoc"), btnShowGovDoc=$("#btnShowGovDoc"), accDocBody=$("#docBody");
  const panelDepositAll=null, accBankBody=$("#bankBody");
  // Cache de imágenes de avatar para no crear objetos por frame
  const AVATAR_CACHE = new Map();
  function getAvatarImage(src){
    if(!src) return null;
    let img = AVATAR_CACHE.get(src);
    if(!img){ img = new Image(); img.src = src; AVATAR_CACHE.set(src, img); }
    return img;
  }
  // Helper para actualizar el panel del banco desde progreso o desde el agente actual
  function __fmtAmount(n){ try{ return Math.floor(n||0); }catch(e){ return 0; } }
  window.updateBankPanel = function(amount=null, code=null){
    try{
      if(!accBankBody) return;
      // Si hay agente del usuario, priorizar su nombre y money actual
      const you = (typeof USER_ID !== 'undefined') ? agents.find(a=>a.id===USER_ID) : null;
      if(you){
        const val = __fmtAmount(you.money) + __fmtAmount(you.pendingDeposit);
        accBankBody.innerHTML = `Saldo de ${you.code}: <span class="balance-amount">${val}</span>`;
        return;
      }
      // Si aún no hay agente (antes de crear persona), usar progreso guardado
      const saved = (window.__progress||{});
      const val = __fmtAmount((amount!=null)?amount:saved.money);
      const label = code || (window.__user?.username || 'Tu cuenta');
      accBankBody.innerHTML = `Saldo de ${label}: <span class="balance-amount">${val}</span>`;
    // Guardar también en variable runtime si aún no está (usar string, nunca objeto)
    try{
      if(!window.__selectedAvatarCurrent && saved && typeof saved.avatar === 'string' && saved.avatar.length){
        window.__selectedAvatarCurrent = saved.avatar;
      }
    }catch(_){ }
    }catch(e){}
  };
  const btnHouse=$("#btnHouse"), btnShop=$("#btnShop");
  const btnShowMarried = $("#btnShowMarried"), marriedDock = $("#marriedDock"), marriedList = $("#marriedList");
  const builderModal=$("#builderModal"), btnBuy=$("#btnBuy"), btnBuilderClose=$("#btnBuilderClose"), builderMsg=$("#builderMsg");
  const shopModal=$("#shopModal"), shopList=$("#shopList"), shopMsg=$("#shopMsg"), btnShopClose=$("#btnShopClose");
  let govFundsEl=$("#govFunds"), govDescEl = $("#govDesc");
  const govSelectEl=$("#govSelect"), btnGovPlace=$("#btnGovPlace");
  const btnGovOpen = document.getElementById('btnGovOpen');
  // Botones de mostrar/ocultar el UI (flechas azules) usando variables existentes
  if(uiShowBtn && uiDock){ uiShowBtn.addEventListener('click', ()=>{ try{ uiDock.classList.remove('collapsed-left'); uiShowBtn.style.display='none'; }catch(_){ } }); }
  if(uiHideBtn && uiDock){ uiHideBtn.addEventListener('click', ()=>{ try{ uiDock.classList.add('collapsed-left'); uiShowBtn.style.display='grid'; }catch(_){ } }); }

  // Seguimiento de agente (btn flotante)
  let FOLLOW_AGENT = false;
  const CAM_FOLLOW_SMOOTH = 0.18; // 0..1 (más alto = más rápido)
  const followFab = document.getElementById('followFab');
  if (followFab){
    followFab.addEventListener('click', ()=>{
      try{
        if(!STARTED){ return; }
        if(typeof USER_ID==='undefined' || !agents){ return; }
        const me = agents.find(a=>a && a.id===USER_ID);
        if(!me){
          try{ toast('Crea tu personaje para usar Seguir.'); }catch(_){ }
          FOLLOW_AGENT = false; followFab.classList.remove('on');
          return;
        }
        FOLLOW_AGENT = !FOLLOW_AGENT;
        if(FOLLOW_AGENT){ followFab.classList.add('on'); } else { followFab.classList.remove('on'); }
        // Al activar, centra suavemente hacia el agente (una aproximación inicial)
        if(FOLLOW_AGENT){
          const vw = canvas.width/ZOOM, vh = canvas.height/ZOOM;
          const wantX = Math.max(0, Math.min(me.x - vw/2, Math.max(0, WORLD.w - vw)));
          const wantY = Math.max(0, Math.min(me.y - vh/2, Math.max(0, WORLD.h - vh)));
          cam.x = (cam.x*0.5) + (wantX*0.5);
          cam.y = (cam.y*0.5) + (wantY*0.5);
          clampCam();
        }
      }catch(_){ /* evitar reventar el handler */ }
    });
  }
  // Abrir panel de Gobierno desde el botón del UI
  if(btnGovOpen){
    btnGovOpen.addEventListener('click', ()=>{
      try{
        openGovPanel();
      }catch(_){ govDock && (govDock.style.display='flex'); }
    });
  }

  const btnGovClose = $("#btnGovClose");
  if(btnGovClose) btnGovClose.onclick = ()=> closeGovPanel();
  let placingGov = null, placingHouse = null, placingShop = null;
  const ownedShopsEl = document.getElementById('ownedShops');
  function updateOwnedShopsUI(){
    try{
      if(!ownedShopsEl) return;
      const myId = USER_ID;
      let count = 0;
      if(window.gameState && Array.isArray(window.gameState.shops)){
        count = window.gameState.shops.filter(s => s && s.ownerId === myId).length;
      } else {
        count = (shops||[]).filter(s => s && s.ownerId === myId).length;
      }
      ownedShopsEl.textContent = `Negocios: ${count}`;
    }catch(e){}
  }

  const isMobile = ()=> innerWidth<=768;
  let ZOOM=1.0, ZMIN=0.35, ZMAX=2.0, ZSTEP=0.15;
  const WORLD={w:0,h:0}; const cam={x:0,y:0};

  // En móviles: colapsar dock inicial y ocultar mini-mapa para más espacio
  function applyResponsiveUI(){
    try{
      const narrow = innerWidth <= 700;
      const dock = document.getElementById('uiDock');
      const bar  = document.getElementById('top-bar');
      const showBtn = document.getElementById('uiShowBtn');
      const miniEl = document.getElementById('mini');
      if(narrow){
        if(dock){ dock.classList.add('collapsed-left'); }
        if(bar){ bar.classList.add('collapsed-left'); }
        if(showBtn){ showBtn.style.display = 'grid'; }
        if(miniEl){ miniEl.style.display = 'none'; }
      } else {
        if(dock){ dock.classList.remove('collapsed-left'); }
        if(bar){ bar.classList.remove('collapsed-left'); }
        if(showBtn){ showBtn.style.display = 'none'; }
        if(miniEl){ miniEl.style.display = 'block'; }
      }
    }catch(_){ }
  }
  addEventListener('resize', applyResponsiveUI, { passive:true });
  // aplicar al cargar
  applyResponsiveUI();

  // --- Generador de números aleatorios determinista (semilla fija para el mundo) ---
  let _seed = 20250824; // Usa la fecha de hoy como semilla fija
  function seededRandom() {
    // LCG: https://en.wikipedia.org/wiki/Linear_congruential_generator
    _seed = (_seed * 1664525 + 1013904223) % 4294967296;
    return _seed / 4294967296;
  }
  function setSeed(s) { _seed = s >>> 0; }

  // Versiones deterministas de randi y rand para la generación del mundo
  function srandi(a, b) { return (seededRandom() * (b - a) + a) | 0; }
  function srand(a, b) { return a + seededRandom() * (b - a); }
  function setWorldSize(){
    const vw = innerWidth, vh = innerHeight;
    // Usuario pidió duplicar el mapa: mantenemos los multiplicadores aumentados
    WORLD.w = Math.floor(vw * (isMobile() ? 14.4 : 11.2));
    WORLD.h = Math.floor(vh * (isMobile() ? 6.4 : 5.2));
  }

  function fitCanvas(){ canvas.width=innerWidth; canvas.height=innerHeight; clampCam(); }
  function clampCam(){const vw = canvas.width/ZOOM, vh = canvas.height/ZOOM;const maxX = Math.max(0, WORLD.w - vw);const maxY = Math.max(0, WORLD.h - vh);cam.x = Math.max(0, Math.min(cam.x, maxX));cam.y = Math.max(0, Math.min(cam.y, maxY));}
  function toScreen(x,y){ return {x:(x-cam.x)*ZOOM, y:(y-cam.y)*ZOOM}; }
  function toWorld(px,py){ return {x: px/ZOOM + cam.x, y: py/ZOOM + cam.y}; }
  setWorldSize(); fitCanvas();
  addEventListener('resize', fitCanvas, {passive:true});

  /* ===== PAN/ZOOM ===== */
  const activePointers = new Map();let panPointerId = null;let pinchBaseDist = 0, pinchBaseZoom = 1, pinchCx = 0, pinchCy = 0;
  function isOverUI(sx,sy){
    const rects = [];
    const addRect = (el)=>{ if(!el) return; const cs = getComputedStyle(el); if(cs.display==='none' || cs.visibility==='hidden') return; rects.push(el.getBoundingClientRect()); };
  addRect(uiDock); addRect(docDock); addRect(govDock); addRect(mini); addRect(zoomFab); addRect(uiShowBtn); addRect(marriedDock);
    addRect(document.getElementById('docModal')); addRect(document.getElementById('marriedModal'));
  addRect(document.getElementById('followFab'));
    return rects.some(r => sx>=r.left && sx<=r.right && sy>=r.top && sy<=r.bottom);
  }
  function setZoom(newZ, anchorX=null, anchorY=null){const before = toWorld(anchorX??(canvas.width/2), anchorY??(canvas.height/2));ZOOM = Math.max(ZMIN, Math.min(ZMAX, newZ));const after  = toWorld(anchorX??(canvas.width/2), anchorY??(canvas.height/2));cam.x += (before.x - after.x); cam.y += (before.y - after.y); clampCam();}
  canvas.addEventListener('wheel', (e)=>{ e.preventDefault();if(isOverUI(e.clientX,e.clientY)) return;setZoom(ZOOM + (Math.sign(e.deltaY)>0?-ZSTEP:ZSTEP), e.clientX, e.clientY);}, {passive:false});
  canvas.addEventListener('pointerdown', (e)=>{if(isOverUI(e.clientX,e.clientY)) return;canvas.setPointerCapture(e.pointerId);activePointers.set(e.pointerId, {x:e.clientX, y:e.clientY});if(activePointers.size===1){panPointerId = e.pointerId;}else if(activePointers.size===2){const pts=[...activePointers.values()];pinchBaseDist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);pinchBaseZoom = ZOOM;pinchCx = (pts[0].x + pts[1].x)/2;pinchCy = (pts[0].y + pts[1].y)/2;panPointerId = null;}}, {passive:true});
  canvas.addEventListener('pointermove', (e)=>{if(!activePointers.has(e.pointerId)) return;const prev = activePointers.get(e.pointerId);activePointers.set(e.pointerId, {x:e.clientX, y:e.clientY});if(activePointers.size===1 && panPointerId===e.pointerId){const dx = (e.clientX - prev.x)/ZOOM;const dy = (e.clientY - prev.y)/ZOOM;cam.x -= dx; cam.y -= dy; clampCam();}else if(activePointers.size===2){const pts=[...activePointers.values()];const dist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y) || 1;const factor = dist / (pinchBaseDist||dist);setZoom(pinchBaseZoom * factor, pinchCx, pinchCy);}}, {passive:true});
  const clearPointer = (id)=>{if(!activePointers.has(id)) return;activePointers.delete(id);if(panPointerId===id) panPointerId=null;if(activePointers.size<2){ pinchBaseDist=0; }};
  canvas.addEventListener('pointerup',   e=> clearPointer(e.pointerId), {passive:true});
  canvas.addEventListener('pointercancel', e=> clearPointer(e.pointerId), {passive:true});
  // Botones de zoom eliminados: zoom por rueda/pinch permanece activo

  // Mapeo directo de imágenes para edificaciones
const BUILDING_IMAGES = {
  // Instituciones gubernamentales con URLs corregidas
  parque: '/assets/parque.png',
  escuela: '/assets/escuela.png', // URL alternativa 
  // biblioteca removed
  policia: '/assets/policia.png',
  hospital: '/assets/hospital.png',
  central_electrica: '/assets/electrica.png', // ACTUALIZADA
  cemetery: '/assets/20250827-081702.jpg',
  // Edificios generales
  house: '/assets/casa.png',
  bank: '/assets/banco.png',
  factory: '/assets/fabrica.png',
  mall: '/assets/mall.png',
  shop: '/assets/20250827-071843.png',
  
  // Gobierno
  gobierno: '/assets/Gobierno.png',
  
  // Tiendas específicas
  bar: '/assets/Bar.png',
  panadería: '/assets/panaderia.png',
  biblioteca: '/assets/20250831-110133.png',
  
  // Nuevas URLs agregadas para negocios faltantes
  // Nuevas URLs agregadas para negocios faltantes
  kiosco: '/assets/kiosco.png',
  juguería: '/assets/jugo.png',
  cafetería: '/assets/cafeteria.png',
  heladería: '/assets/heladeria.png',
  'pizzería': '/assets/pizzer-a.png',
  // (se removió la entrada de librería por solicitud)
  // 'librería': '/assets/fondo1.jpg',
  'juguetería': '/assets/jugueteria.png',
  'yoga studio': '/assets/yoga-estudio.png',
  'dance hall': '/assets/danza.png',
  'tienda deportes': '/assets/deportes.png',
  'arte & galería': '/assets/galeria.png',
  'cineclub': '/assets/cine-club.png',
  'gamer zone': '/assets/gamer.png',
  'senderismo': '/assets/senderismo.png',
  'foto-lab': '/assets/foto-club.png',
  'astro club': '/assets/astro-club.png',
  restaurante: '/assets/restaurante.png',
  
  // Otras instituciones
  bomberos: '/assets/bomberos.png', // ACTUALIZADA
  universidad: '/assets/librer-a.png', // placeholder (no tienes universidad.png)
  tribunal: '/assets/constructora.png', // placeholder si no hay tribunal
  teatro: '/assets/20250827-071830.png',
  estadio: '/assets/20250827-052454.png' // URL solicitada por el usuario
};

// Precarga de imágenes para mejor rendimiento
const BUILDING_IMAGE_CACHE = {};

// Street textures (vertical/horizontal)
const STREET_IMG_V = new Image(); // calle.jpg para verticales
const STREET_IMG_H = new Image(); // calle2.jpg para horizontales
STREET_IMG_V.src = '/assets/calle.jpg';
STREET_IMG_H.src = '/assets/calle2.jpg';
const STREET_PAT_CACHE = { v:null, h:null, keyV:null, keyH:null };

function getStreetPattern(ctx, orientation){
  try{
    const IMG = orientation==='h'? STREET_IMG_H : STREET_IMG_V;
    if(!IMG || !IMG.complete || IMG.naturalWidth===0) return null;
    const key = `${orientation}_${Math.round(ZOOM*100)}`; // patrón no depende de cámara, solo de zoom
    if(orientation==='h' && STREET_PAT_CACHE.keyH === key && STREET_PAT_CACHE.h) return STREET_PAT_CACHE.h;
    if(orientation==='v' && STREET_PAT_CACHE.keyV === key && STREET_PAT_CACHE.v) return STREET_PAT_CACHE.v;
    const iw = IMG.naturalWidth, ih = IMG.naturalHeight;
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = Math.max(64, Math.round(iw * Math.max(1, ZOOM)));
    patternCanvas.height = Math.max(64, Math.round(ih * Math.max(1, ZOOM)));
    const pc = patternCanvas.getContext('2d');
    pc.clearRect(0,0,patternCanvas.width, patternCanvas.height);
    pc.drawImage(IMG, 0,0,patternCanvas.width, patternCanvas.height);
    const pat = ctx.createPattern(patternCanvas,'repeat');
    if(orientation==='h'){ STREET_PAT_CACHE.h = pat; STREET_PAT_CACHE.keyH = key; }
    else { STREET_PAT_CACHE.v = pat; STREET_PAT_CACHE.keyV = key; }
    return pat;
  }catch(e){ console.warn('getStreetPattern error', e); return null; }
}

function preloadImages() {
  console.log("Iniciando precarga de imágenes con manejo de errores mejorado...");
  
  for (const key in BUILDING_IMAGES) {
    try {
      const img = new Image();
      
      img.onload = function() {
        console.log(`Imagen cargada: ${key}`);
      };
      
      img.onerror = function() {
        console.warn(`Error al cargar la imagen: ${key} -> ${BUILDING_IMAGES[key]}. Usando fallback.`);
        // Crear un fallback simple que no cause errores
        BUILDING_IMAGE_CACHE[key] = { 
          error: true, 
          complete: true,
          naturalWidth: 100
        };
      };
      
      img.src = BUILDING_IMAGES[key];
      BUILDING_IMAGE_CACHE[key] = img;
    } catch(e) {
      console.error(`Error general con imagen ${key}:`, e);
    }
  }
}

// Ejecutar precarga inmediatamente
preloadImages();
setTimeout(()=>{
  // Si muchas fallan, sugiere revisar assets en servidor
  try{
    const total = Object.keys(BUILDING_IMAGES).length;
    const errors = Object.values(BUILDING_IMAGE_CACHE).filter(v => v && v.error).length;
    if(errors > 6){ console.warn(`[debug] ${errors}/${total} imágenes fallaron. Revisa /api/debug/assets-list y /api/debug/asset?name=archivo.png`); }
  }catch(_){ }
}, 1500);

// Limpiar cualquier entrada residual de 'librería' en el cache (por versiones antiguas)
if (BUILDING_IMAGE_CACHE['librería']) { delete BUILDING_IMAGE_CACHE['librería']; }

// Imagen de fondo del mundo: usar el JPG local directamente para evitar 404 por PNG
const BG_IMG = new Image();
BG_IMG.onload = () => { console.log('Background image loaded:', BG_IMG.src); };
BG_IMG.onerror = function() { console.warn('Background image not found at /assets/fondo1.jpg — usando color de respaldo'); };
BG_IMG.src = '/assets/fondo1.jpg';

// ====== Restricción de arena eliminada: ahora se puede construir en cualquier lugar ======
// Mantendremos funciones stub para no romper llamadas existentes
function isPointSand(){ return true; }
function isRectOnSand(){ return true; }
function sampleSandPoint(){ return {x: Math.random()*WORLD.w, y: Math.random()*WORLD.h}; }

function relocateInitialBuildingsToSand(){
  try{
  if(!(BG_IMG && BG_IMG.complete)) return; // esperar a la imagen
    const groups = [];
    // Algunas estructuras individuales
    if(typeof cemetery==='object') groups.push([cemetery]);
    if(typeof government==='object') groups.push([government]);
    // Colecciones (si existen)
    if(Array.isArray(banks)) groups.push(banks);
    if(Array.isArray(malls)) groups.push(malls);
    if(Array.isArray(factories)) groups.push(factories);
    if(Array.isArray(houses)) groups.push(houses);
    if(Array.isArray(roadRects)) groups.push(roadRects); // caminos podrían quedarse igual, pero incluimos por consistencia
    if(Array.isArray(avenidas)) groups.push(avenidas);
    if(Array.isArray(roundabouts)) groups.push(roundabouts);
    // Reposicionar cada rect que no caiga sobre arena
    const allOthers = ()=> groups.flat();
    for(const arr of groups){
      for(const rect of arr){
        if(!rect || isRectOnSand(rect)) continue;
        const original = {x:rect.x,y:rect.y};
        let placed=false;
        for(let t=0;t<140;t++){
          const p = sampleSandPoint();
            rect.x = Math.max(5, Math.min(WORLD.w - rect.w - 5, Math.round(p.x - rect.w/2)));
            rect.y = Math.max(5, Math.min(WORLD.h - rect.h - 5, Math.round(p.y - rect.h/2)));
            if(isRectOnSand(rect) && !allOthers().some(o=> o!==rect && rectsOverlapWithMargin(o, rect, 4))){ placed=true; break; }
        }
        if(!placed){ rect.x = original.x; rect.y = original.y; }
      }
    }
    console.log('[terrain] Reubicación inicial a arena completada');
  }catch(e){ console.warn('[terrain] relocate fail', e); }
}

// ... no street texture feature (restored to solid fills)

  /* ===== CONFIGURACIÓN ===== */
  const CFG = {
  LINES_ON:false, PARKS:8, SCHOOLS:8, FACTORIES:12, BANKS:8, MALLS:4, HOUSE_SIZE:70, OWNED_HOUSE_SIZE_MULT:1.4, CEM_W:220, CEM_H:130, N_INIT:24,  // Más infraestructuras y casas iniciales
  HOME_REST_DURATION:0,
    // Radio base de los agentes (en unidades de mundo). Aumentado para que se vean más grandes.
  R_ADULT:7.5, R_CHILD:6.0, R_ELDER:7.0, SPEED:60, WORK_DURATION:20, EARN_PER_SHIFT:20, WORK_COOLDOWN:2,
    // Tamaños mínimos en pantalla para que no desaparezcan con el zoom.
  MIN_AGENT_PX: 12,
  NAME_FONT_PX: 13,
    YEARS_PER_SECOND:1/86400, ADULT_AGE:18, ELDER_AGE:65, DEATH_AGE:90,
    HOUSE_BUY_COST:3000,
    GOV_TAX_EVERY: 20*60,      // cada 20 min
    WEALTH_TAX_BASE: 0.01,     // 1.0% base
    INSTITUTION_TAX_PER: 0.001,// +0.1% por institución
    WEALTH_TAX_MAX: 0.06,      // 6% tope de seguridad
    EMPLOYEE_SALARY: 25, SALARY_PAY_EVERY: 120,
    GOV_RENT_EVERY: 10*60, GOV_RENT_AMOUNT: 5, 
  POST_DEPOSIT_EXPLORE: 0, // desactivado: ir directo a trabajar otra vez
  WORK_EXPLORE_TIME: 60, // segundos vagando tras cada turno de trabajo
  WORK_COIN_INTERVAL: 1, // cada segundo una moneda animada
  WORK_COIN_LIFE: 1600, // ms visible
  MANAGE_DURATION: 12, // segundos gestionando negocio antes de cobrar caja
  MANAGE_BOOST_TIME: 120, // segundos de impulso de ventas tras gestionar
  MANAGE_BOOST_MULT: 1.2, // multiplicador a ganancias de cada compra durante el boost
  SHOP_PURCHASE_INTERVAL: 300, // 5 min entre compras máximas
    COST_ROAD: 40,
    COST_PARK: 80, COST_SCHOOL: 120, COST_LIBRARY: 150, COST_POLICE: 200, COST_HOSPITAL: 250, COST_POWER: 350,
    SHOP_W:120, SHOP_H:80, VISIT_RADIUS:220, VISIT_RATE: 0.003, PRICE_MIN:1, PRICE_MAX:3,
    SHOP_DWELL: 5, NEW_SHOP_FORCE_WINDOW: 120,
  SHOP_PAYOUT_CHUNK: 100,
    OWNER_MANAGE_VS_WORK_RATIO: 0.3, // 30% de probabilidad de gestionar negocio vs trabajar
  // Exploración del mapa por bots
  EXPLORE_SECTORS_X: 12,
  EXPLORE_SECTORS_Y: 9,
  EXPLORE_REACH_RADIUS: 18,
  };

  const VEHICLES = {
    bicicleta:      { name:'Bicicleta',      cost:50,   speed: 100, icon:'🚲' },
    moto:           { name:'Motocicleta',    cost:200,  speed: 180, icon:'🛵' },
    auto_compacto:  { name:'Auto Compacto',  cost:800,  speed: 260, icon:'🚗' },
    auto_deportivo: { name:'Auto Deportivo', cost:2500, speed: 360, icon:'🏎️' }
  };

  // === Efectos de monedas durante el trabajo ===
  const workCoins = []; // {x,y,spawn,life,vy}
  function spawnWorkCoin(x,y){
    workCoins.push({ x, y, spawn: performance.now(), life: (CFG.WORK_COIN_LIFE||1500), vy: -0.02 - Math.random()*0.04 });
  }
  function updateAndDrawWorkCoins(dt){
    const now = performance.now();
    const dtMs = (dt||0) * 1000; // dt en segundos -> ms
    for(let i=workCoins.length-1;i>=0;i--){
      const c = workCoins[i];
      const t = now - c.spawn;
      if(t > c.life){ workCoins.splice(i,1); continue; }
      c.y += c.vy * dtMs; // movimiento vertical suave
    }
    for(const c of workCoins){
      const t = now - c.spawn;
      const alpha = 1 - (t / c.life);
      const p = toScreen(c.x, c.y);
      ctx.save(); ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.arc(p.x, p.y, 6*ZOOM, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#92400e'; ctx.font = `${10*ZOOM}px ui-monospace,monospace`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('$', p.x, p.y+0.5*ZOOM);
      ctx.restore();
    }
  }

  /* ===== Tipos de Instituciones (25) ===== */
  const GOV_TYPES = [
    {k:'parque', label:'Parque', cost:CFG.COST_PARK, w:130,h:90, icon:'🌳', fill:'rgba(12,81,58,0.92)', stroke:'rgba(31,122,90,0.95)'},
    {k:'escuela', label:'Escuela', cost:CFG.COST_SCHOOL, w:140,h:95, icon:'📚', fill:'rgba(51,65,85,0.92)', stroke:'rgba(148,163,184,0.95)'},
    {k:'policia', label:'Policía', cost:CFG.COST_POLICE, w:150,h:80, icon:'🚓', fill:'#3b82f6', stroke:'#dbeafe'},
    {k:'hospital', label:'Hospital', cost:CFG.COST_HOSPITAL, w:180,h:100, icon:'🏥', fill:'#f1f5f9', stroke:'#ef4444'},
    {k:'central_electrica', label:'Central Eléctrica', cost:CFG.COST_POWER, w:200,h:120, icon:'⚡', fill:'#475569', stroke:'#facc15'},
    {k:'bomberos', label:'Cuerpo de Bomberos', cost:220, w:160,h:85, icon:'🚒', fill:'#7c2d12', stroke:'#fecaca'},
    {k:'registro_civil', label:'Registro Civil', cost:180, w:150,h:85, icon:'🪪', fill:'#0f172a', stroke:'#94a3b8'},
    {k:'universidad', label:'Universidad Pública', cost:300, w:200,h:120, icon:'🎓', fill:'#1e293b', stroke:'#93c5fd'},
    {k:'tribunal', label:'Tribunal / Corte', cost:260, w:170,h:95, icon:'⚖️', fill:'#111827', stroke:'#9ca3baf'},
    {k:'museo', label:'Museo', cost:200, w:160,h:90, icon:'🏛️', fill:'#3f3f46', stroke:'#cbd5e1'},
  {k:'biblioteca', label:'Biblioteca', cost:CFG.COST_LIBRARY, w:140,h:90, icon:'📖', fill:'#a16207', stroke:'#fde047'},
    {k:'teatro', label:'Teatro', cost:190, w:160,h:90, icon:'🎭', fill:'#1f2937', stroke:'#9ca3baf'},
  {k:'estadio', label:'Estadio', cost:420, w:320,h:220, icon:'🏟️', fill:'#0b3a1e', stroke:'#10b981'},
    {k:'terminal', label:'Terminal Terrestre', cost:260, w:200,h:110, icon:'🚌', fill:'#0c4a6e', stroke:'#7dd3fc'},
    {k:'correos', label:'Correos del Estado', cost:170, w:150,h:85, icon:'📮', fill:'#0b1f3a', stroke:'#60a5fa'},
    {k:'banco_central', label:'Banco Central', cost:300, w:180,h:100, icon:'🏦', fill:'#2d3748', stroke:'#fde68a'},
    {k:'aduana', label:'Aduana', cost:240, w:170,h:95, icon:'🚢', fill:'#1e3a8a', stroke:'#93c5fd'},
    {k:'carcel', label:'Centro de Rehabilitación', cost:280, w:200,h:110, icon:'🗝️', fill:'#111827', stroke:'#64748b'},
    {k:'planta_agua', label:'Planta de Agua', cost:260, w:190,h:110, icon:'🚰', fill:'#0e7490', stroke:'#67e8f9'},
    {k:'reciclaje', label:'Planta de Reciclaje', cost:220, w:180,h:100, icon:'♻️', fill:'#14532d', stroke:'#86efac'},
    {k:'centro_cultural', label:'Centro Cultural', cost:190, w:160,h:90, icon:'🎨', fill:'#3b0764', stroke:'#d8b4fe'},
    {k:'mercado_central', label:'Mercado Central', cost:210, w:180,h:100, icon:'🥚', fill:'#78350f', stroke:'#fde68a'},
    {k:'instituto_tecnologico', label:'Instituto Tecnológico', cost:230, w:180,h:100, icon:'🧪', fill:'#0f172a', stroke:'#60a5fa'},
    {k:'centro_investigacion', label:'Centro de Investigación', cost:260, w:190,h:105, icon:'🔬', fill:'#164e63', stroke:'#a5f3fc'},
    {k:'observatorio', label:'Observatorio', cost:240, w:170,h:95, icon:'🔭', fill:'#1e293b', stroke:'#c7d2fe'}
  ];

  /* ===== Estructuras almacenadas ===== */
  const streets=[], factories=[], banks=[], malls=[], houses=[], barrios=[], deceased=[], avenidas=[], roundabouts=[], shops=[];

  // helper: lista de negocios visibles en el mapa grande
  function getVisibleShops(){
    // Preferir el estado del servidor si existe, sino usar el array local
  // Devolver todas las tiendas (incluyendo panaderías). El usuario pidió que se muestren todas las panaderías en el mapa grande.
  return (window.gameState && Array.isArray(window.gameState.shops)) ? window.gameState.shops : shops;
  }

  // helper: eliminar panaderías no compradas (robusto)
  function removeUnownedPanaderias(){
  // NO-OP: previously removed unowned panaderias; left empty to keep panaderías visible
  return;
  }
  const SHOP_TYPES = [
  {k:'panadería', icon:'🥖', like:'pan', price:1, buyCost: 400},
      {k:'kiosco', icon:'🏪', like:'kiosco', price:1, buyCost: 450},
      {k:'juguería', icon:'🥣', like:'jugos', price:1, buyCost: 500},
      {k:'cafetería', icon:'☕', like:'café', price:2, buyCost: 800},
      {k:'heladería', icon:'🍨', like:'helado', price:2, buyCost: 850},
      {k:'pizzería', icon:'🍕', like:'pizza', price:2, buyCost: 900},
  // 'librería' removida por solicitud
      {k:'juguetería', icon:'🧸', like:'juguetes', price:2, buyCost: 1000},
      {k:'yoga studio', icon:'🧘', like:'yoga', price:2, buyCost: 1100},
      {k:'dance hall', icon:'💃', like:'baile', price:2, buyCost: 1100},
      {k:'tienda deportes', icon:'🏅', like:'deporte', price:2, buyCost: 1200},
      {k:'arte & galería', icon:'🎨', like:'arte', price:2, buyCost: 1300},
      {k:'cineclub', icon:'🎬', like:'cine', price:2, buyCost: 1400},
      {k:'gamer zone', icon:'🎮', like:'videojuegos', price:2, buyCost: 1400},
      {k:'senderismo', icon:'🧾', like:'naturaleza', price:2, buyCost: 1500},
      {k:'foto-lab', icon:'📷', like:'fotografía', price:2, buyCost: 1500},
      {k:'astro club', icon:'🔭', like:'astronomía', price:2, buyCost: 1600},
      {k:'restaurante', icon:'🍽️', like:'comida', price:3, buyCost: 2500},
      {k:'electrónica', icon:'🔌', like:'electrónica', price:3, buyCost: 3000},
      {k:'tech hub', icon:'🖥️', like:'tecnología', price:3, buyCost: 3500},
      {k:'bar', icon:'🍻', like:'bebidas', price:2, buyCost: 1200},
  ];

  // porcentaje de ganancia adicional por cada venta basado en el costo de compra
  CFG.SHOP_PROFIT_FACTOR = CFG.SHOP_PROFIT_FACTOR || 0.002;

  /* Áreas clave */
  const builder={x:0,y:0,w:220,h:110}, cemetery={x:0,y:0,w:CFG.CEM_W,h:CFG.CEM_H}, government={x:0,y:0,w:240,h:140,funds:0, placed:[]};
  const roadRects=[];
  const cityBlocks = [];
  let urbanZone = {x:0, y:0, w:0, h:0};

  // Aplicar estado del servidor a estructuras locales visibles
  function applyServerState(payload){
    try{
      if(payload?.government){
        if(typeof payload.government.funds === 'number') government.funds = payload.government.funds;
        government.placed.length = 0;
        (payload.government.placed||[]).forEach(g=> government.placed.push({...g}));
        if(typeof window.updateGovDesc === 'function') window.updateGovDesc();
      }
      if(Array.isArray(payload?.houses)){
        window.__netHouses = payload.houses.map(h=> ({...h}));
      }
      if (Array.isArray(payload?.shops)) {
        // Reemplazar el array local de tiendas con los datos del servidor
  // Cargar todas las tiendas tal cual vienen del servidor (incluyendo panaderías)
  shops.length = 0;
  shops.push(...payload.shops);
      }
    }catch(e){ console.warn('applyServerState error', e); }
  }

  /* Utils */
  const randi=(a,b)=> (Math.random()*(b-a)+a)|0, rand=(a,b)=> a + Math.random()*(b-a), clamp=(v,a,b)=> Math.max(a,Math.min(b,v));
  const centerOf=r=> ({x:r.x+r.w/2, y:r.y+r.h/2});
  // Compat: algunos fragmentos antiguos usaban 'CenterOf' (mayúscula). Expón alias seguro.
  try{ window.centerOf = centerOf; window.CenterOf = centerOf; }catch(_){ }
  const rectsOverlap=(a,b)=> !(a.x+a.w<=b.x || b.x+b.w<=a.x || a.y+a.h<=b.y || b.y+b.h<=a.y);
  // Función global para remover elementos por labels (case-insensitive) de las colecciones visibles
  function removeByLabels(labels){
    try{
      const needle = (s) => (s || '').toString().trim().toLowerCase();
      const set = new Set((labels||[]).map(l => (''+l).toString().trim().toLowerCase()));
      const removeFromList = (lst) => {
        for(let i = lst.length - 1; i >= 0; i--){
          const it = lst[i];
          const lab = needle(it && (it.label || it.k || it.kind || it.type));
          if(lab && set.has(lab)) lst.splice(i,1);
        }
      };
      // listas globales
      try{ removeFromList(government.placed); }catch(e){}
      try{ removeFromList(shops); }catch(e){}

      // ===== Cobertura de exploración (para que bots recorran todo el mapa) =====
      let EXPLORE_GRID = null; // matriz booleana [sy][sx]
      function ensureExploreGrid(){
        const sx = CFG.EXPLORE_SECTORS_X, sy = CFG.EXPLORE_SECTORS_Y;
        if(!EXPLORE_GRID || EXPLORE_GRID.length!==sy || EXPLORE_GRID[0]?.length!==sx){
          EXPLORE_GRID = Array.from({length: sy}, ()=> Array.from({length: sx}, ()=> false));
        }
        return EXPLORE_GRID;
      }
      function markVisitedAt(x, y){
        const grid = ensureExploreGrid();
        const sx = CFG.EXPLORE_SECTORS_X, sy = CFG.EXPLORE_SECTORS_Y;
        const ix = Math.min(sx-1, Math.max(0, Math.floor(x / (WORLD.w / sx))));
        const iy = Math.min(sy-1, Math.max(0, Math.floor(y / (WORLD.h / sy))));
        grid[iy][ix] = true;
      }
      function nextUnvisitedTarget(){
        const grid = ensureExploreGrid();
        const sx = CFG.EXPLORE_SECTORS_X, sy = CFG.EXPLORE_SECTORS_Y;
        // lista de celdas no visitadas
        const cells = [];
        for(let iy=0; iy<sy; iy++){
          for(let ix=0; ix<sx; ix++){
            if(!grid[iy][ix]){
              const cx = (ix + 0.5) * (WORLD.w / sx);
              const cy = (iy + 0.5) * (WORLD.h / sy);
              cells.push({ix, iy, x: cx, y: cy});
            }
          }
        }
        if(cells.length===0){
          // reset coverage para seguir patrullando
          for(let iy=0; iy<sy; iy++) for(let ix=0; ix<sx; ix++) grid[iy][ix] = false;
          // escoger centro después de reiniciar
          return { x: WORLD.w/2, y: WORLD.h/2 };
        }
        // elegir la más lejana al azar entre top-k para dispersión
        const k = Math.min(8, cells.length);
        // mezclar un poco
        for(let i=cells.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [cells[i],cells[j]]=[cells[j],cells[i]]; }
        const sample = cells.slice(0, k);
        // opcional: priorizar por distancia desde un punto aleatorio
        const px = Math.random()*WORLD.w, py = Math.random()*WORLD.h;
        sample.sort((a,b)=> (Math.hypot(b.x-px,b.y-py) - Math.hypot(a.x-px,a.y-py)) );
        return { x: sample[0].x, y: sample[0].y };
      }
      try{ removeFromList(factories); }catch(e){}
      try{ removeFromList(banks); }catch(e){}
      try{ removeFromList(malls); }catch(e){}
      try{ removeFromList(houses); }catch(e){}
      try{ // También limpiar listas de vías y roundabouts si etiquetadas
        if(Array.isArray(roadRects)){ for(let i=roadRects.length-1;i>=0;i--){ const it = roadRects[i]; const lab = needle(it && (it.label||it.k||it.kind||it.type)); if(lab && set.has(lab)) roadRects.splice(i,1); } }
        if(Array.isArray(avenidas)){ for(let i=avenidas.length-1;i>=0;i--){ const it = avenidas[i]; const lab = needle(it && (it.label||it.k||it.kind||it.type)); if(lab && set.has(lab)) avenidas.splice(i,1); } }
        if(Array.isArray(roundabouts)){ for(let i=roundabouts.length-1;i>=0;i--){ const it = roundabouts[i]; const lab = needle(it && (it.label||it.k||it.kind||it.type)); if(lab && set.has(lab)) roundabouts.splice(i,1); } }
      }catch(e){}
      // también limpiar estado del servidor si aplica
      if(window.gameState){
        try{ if(Array.isArray(window.gameState.shops)) window.gameState.shops = window.gameState.shops.filter(s => !set.has(needle(s && (s.label || s.k || s.kind || s.type)))); }catch(e){}
        try{ if(window.gameState.government && Array.isArray(window.gameState.government.placed)) window.gameState.government.placed = window.gameState.government.placed.filter(g => !set.has(needle(g && (g.label || g.k || g.kind || g.type)))); }catch(e){}
      }
  // Use debug logging to avoid spamming the console every frame; enable by setting window.__verboseRemoval = true
  if (window.__verboseRemoval) console.debug('removeByLabels executed for', Array.from(set));
    }catch(e){ console.warn('removeByLabels error', e); }
  }
  const inside=(pt,r)=> pt.x>=r.x && pt.x<=r.x+r.w && pt.y>=r.y && pt.y<=r.y+r.h;
  const rectsOverlapWithMargin = (rectA, rectB, margin) => {
    const paddedB = { x: rectB.x - margin, y: rectB.y - margin, w: rectB.w + margin*2, h: rectB.h + margin*2 };
    return rectsOverlap(rectA, paddedB);
  };

  // ===== Cobertura de exploración (scope global) =====
  // Las versiones anteriores quedaron dentro de removeByLabels(), lo que hacía
  // que no existieran en el ámbito global. Las definimos aquí para que el bucle
  // principal pueda usarlas sin ReferenceError.
  let __EXPLORE_GRID = null; // matriz booleana [sy][sx]
  function ensureExploreGrid(){
    const sx = CFG.EXPLORE_SECTORS_X, sy = CFG.EXPLORE_SECTORS_Y;
    if(!__EXPLORE_GRID || __EXPLORE_GRID.length!==sy || __EXPLORE_GRID[0]?.length!==sx){
      __EXPLORE_GRID = Array.from({length: sy}, ()=> Array.from({length: sx}, ()=> false));
    }
    return __EXPLORE_GRID;
  }
  function markVisitedAt(x, y){
    const grid = ensureExploreGrid();
    const sx = CFG.EXPLORE_SECTORS_X, sy = CFG.EXPLORE_SECTORS_Y;
    const ix = Math.min(sx-1, Math.max(0, Math.floor(x / (WORLD.w / sx))));
    const iy = Math.min(sy-1, Math.max(0, Math.floor(y / (WORLD.h / sy))));
    grid[iy][ix] = true;
  }
  function nextUnvisitedTarget(){
    const grid = ensureExploreGrid();
    const sx = CFG.EXPLORE_SECTORS_X, sy = CFG.EXPLORE_SECTORS_Y;
    const cells = [];
    for(let iy=0; iy<sy; iy++){
      for(let ix=0; ix<sx; ix++){
        if(!grid[iy][ix]){
          const cx = (ix + 0.5) * (WORLD.w / sx);
          const cy = (iy + 0.5) * (WORLD.h / sy);
          cells.push({ix, iy, x: cx, y: cy});
        }
      }
    }
    if(cells.length===0){
      for(let iy=0; iy<sy; iy++) for(let ix=0; ix<sx; ix++) grid[iy][ix] = false;
      return { x: WORLD.w/2, y: WORLD.h/2 };
    }
    const k = Math.min(8, cells.length);
    for(let i=cells.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [cells[i],cells[j]]=[cells[j],cells[i]]; }
    const sample = cells.slice(0, k);
    const px = Math.random()*WORLD.w, py = Math.random()*WORLD.h;
    sample.sort((a,b)=> (Math.hypot(b.x-px,b.y-py) - Math.hypot(a.x-px,a.y-py)) );
    return { x: sample[0].x, y: sample[0].y };
  }

  function isOnRoad(agent) {
    const pt = { x: agent.x, y: agent.y };
    if (avenidas.some(r => inside(pt, r))) return true;
    if (roadRects.some(r => inside(pt, r))) return true;
    if (roundabouts.some(r => {
      const dist = Math.hypot(pt.x - r.cx, pt.y - r.cy);
      return dist < r.w / 2;
    })) return true;
    return false;
  }
  function getCurrentRoad(agent) {
    const pt = { x: agent.x, y: agent.y };
    for (const road of [...avenidas, ...roadRects]) { if (inside(pt, road)) return road; }
    for (const r of roundabouts) { const dist = Math.hypot(pt.x - r.cx, pt.y - r.cy); if (dist < r.w / 2) return r; }
    return null;
  }

  function scatterRects(n, [wmin,wmax], [hmin,hmax], avoid=[] , bounds=null, sameTypeMargin = 8){
    const placed=[]; const wr=bounds || {x:0,y:0,w:WORLD.w,h:WORLD.h}; let tries=0; const generalMargin = 8;
    while(placed.length<n && tries<3000){tries++;
      const w = srandi(wmin, wmax), h=srandi(hmin,hmax);
      const x = srandi(wr.x+30, wr.x+wr.w-w-30), y = srandi(wr.y+30, wr.y+wr.h-h-30);
      const rect={x,y,w,h};
      if(placed.some(r=>rectsOverlapWithMargin(r,rect, sameTypeMargin))) continue;
      if(avoid.some(r=>rectsOverlapWithMargin(r,rect, generalMargin))) continue;
      placed.push(rect);
    }
    return placed;
  }

  /**
 * Distribuye edificios uniformemente en una zona dada
 * @param {number} n - Número de edificios a colocar
 * @param {array} widthRange - Rango de anchura [min, max]
 * @param {array} heightRange - Rango de altura [min, max]
 * @param {array} avoid - Edificios a evitar
 * @param {object} zone - Zona donde distribuir (x,y,w,h)
 * @param {number} margin - Margen mínimo entre edificios
 */
function distributeEvenly(n, widthRange, heightRange, avoid, zone, margin) {
  const placed = [];
  const [wmin, wmax] = widthRange;
  const [hmin, hmax] = heightRange;

  const maxAttempts = Math.max(500, n * 400);
  let attempts = 0;

  while (placed.length < n && attempts < maxAttempts) {
    attempts++;
    const w = randi(wmin, wmax);
    const h = randi(hmin, hmax);
    const x = rand(Math.max(zone.x + 8, 0), Math.max(zone.x + 8, zone.x + zone.w - w - 8));
    const y = rand(Math.max(zone.y + 8, 0), Math.max(zone.y + 8, zone.y + zone.h - h - 8));
    const rect = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };

    const collides = [...avoid, ...placed].some(o => rectsOverlapWithMargin(rect, o, margin));
    if (!collides) placed.push(rect);
  }

  if (placed.length < n && typeof scatterRects === 'function') {
    const remaining = scatterRects(n - placed.length, widthRange, heightRange, [...avoid, ...placed], zone, margin);
    placed.push(...remaining);
  }

  return placed;
}

  function makeBarriosYCasas(totalNeeded, urbanArea, avoidList = []) {
    // Nueva lógica: sin barrios. Casas dispersas por todo el mapa.
    barrios.length = 0; cityBlocks.length = 0; houses.length = 0;
    const attemptsMax = totalNeeded * 800;
    let attempts = 0;
    while(houses.length < totalNeeded && attempts < attemptsMax){
      attempts++;
      const size = CFG.HOUSE_SIZE;
      const x = Math.round(rand(20, WORLD.w - size - 20));
      const y = Math.round(rand(20, WORLD.h - size - 20));
      const rect = {x,y,w:size,h:size, ownerId:null, rentedBy:null};
      if(houses.some(h=>rectsOverlapWithMargin(h, rect, 18))) continue;
      if(avenidas.some(r=>rectsOverlapWithMargin(r, rect, 12))) continue;
      if(roundabouts.some(r=>rectsOverlapWithMargin(r, rect, 12))) continue;
      houses.push(rect);
    }
    console.log('[world] Casas dispersas generadas:', houses.length);
  }

  // Asignación / arriendo
  function ensurePlayerHasHouse(agent){
    if(!agent) return;
    // ya es dueño de una casa
    if(typeof agent.houseIdx === 'number' && houses[agent.houseIdx]) return;
    // ya renta una
    const rentedIdx = houses.findIndex(h=> h && h.rentedBy === agent.id);
    if(rentedIdx>=0){ agent.houseIdx = rentedIdx; return; }
    // buscar una libre
    const freeIdx = houses.findIndex(h=> h && !h.ownerId && !h.rentedBy);
    if(freeIdx>=0){
      houses[freeIdx].rentedBy = agent.id; agent.houseIdx = freeIdx; toast('Se te asignó una casa en arriendo. Paga 50 créditos cada hora.');
      try{
        // Guardar índice de casa rentada para próximas sesiones si todavía no se guardó
        if(window.saveProgress){
          window.__progress = Object.assign({}, window.__progress||{}, { rentedHouseIdx: freeIdx });
          if(!window.__savedRentedIdxOnce){ window.saveProgress({ rentedHouseIdx: freeIdx }); window.__savedRentedIdxOnce = true; }
        }
      }catch(_){ }
    }
  }

  // Cobro periódico de arriendo cada hora real
  let lastRentCheck = Date.now();
  function processRent(dtSeconds){
    // Ejecutar cada ~60s acumulando hasta 3600s
    if(!window.__rentAccum) window.__rentAccum = 0;
    window.__rentAccum += dtSeconds;
    if(window.__rentAccum < 3600) return;
    window.__rentAccum = 0;
    for(const a of agents){
      if(!a || !a.id) continue;
      if(typeof a.houseIdx !== 'number' || !houses[a.houseIdx]) continue;
      const h = houses[a.houseIdx];
      // Debe estar rentando (no dueño)
      if(h.ownerId && h.ownerId === a.id) continue;
      if(h.rentedBy !== a.id) continue;
      const rentCost = 50;
      if((a.money||0) >= rentCost){
        a.money -= rentCost;
        // Sumar a fondos del gobierno (si existe estructura)
  try{ government.funds = (government.funds||0) + rentCost; if(!govFundsEl) govFundsEl=document.getElementById('govFunds'); if(govFundsEl) govFundsEl.textContent = `Fondo: ${Math.floor(government.funds)}`; }catch(_){ }
        toast(`${a.name||'Jugador'} pagó arriendo: -${rentCost}`);
      } else {
        toast(`${a.name||'Jugador'} no pudo pagar arriendo (saldo insuficiente)`);
      }
    }
  }

  function buildAvenidas(urbanArea, avoidRect = null){
    avenidas.length=0; roundabouts.length=0;
    const avW=26;
    // Más divisiones para un mapa más denso (más avenidas/calles)
    const vDivs = Math.max(6, Math.floor((urbanArea.w/1200))); // vertical divisiones crecientes según ancho
    const hDivs = Math.max(4, Math.floor((urbanArea.h/900)));  // horizontales según alto
    const vPoints = [], hPoints = [];
    for (let i = 1; i < vDivs; i++) vPoints.push(urbanArea.x + Math.floor(urbanArea.w * i / vDivs));
    for (let i = 1; i < hDivs; i++) hPoints.push(urbanArea.y + Math.floor(urbanArea.h * i / hDivs));
    for (const vx of vPoints) avenidas.push({x:vx-avW/2, y:urbanArea.y, w:avW, h:urbanArea.h});
    for (const hy of hPoints) avenidas.push({x:urbanArea.x, y:hy-avW/2, w:urbanArea.w, h:avW});
    for (const vx of vPoints) for (const hy of hPoints) {
      if (Math.random() > 0.6) continue;
      const rRadius = randi(50, 85);
      const newRoundabout = {x:vx-rRadius, y:hy-rRadius, w:rRadius*2, h:rRadius*2, cx:vx, cy:hy};
      if (avoidRect && rectsOverlap(newRoundabout, avoidRect)) continue;
      roundabouts.push(newRoundabout);
    }
  }

  function regenInfrastructure(preserveHouses=false){
    streets.length=factories.length=banks.length=malls.length=0; government.placed.length=0;
    if(!preserveHouses){ houses.length=0; barrios.length=0; }

    // --- Semilla fija para el mundo ---
    setSeed(20250824);

    // Gobierno en el centro
    const parkW = 220, parkH = 140, parkGap = 24;
    const govComplexW = government.w + 2 * parkW + 2 * parkGap;
    const govComplexH = government.h + 2 * parkH + 2 * parkGap;
    const govComplexRect = {
        x: WORLD.w / 2 - govComplexW / 2,
        y: WORLD.h / 2 - govComplexH / 2,
        w: govComplexW,
        h: govComplexH
    };
    buildAvenidas({x:0, y:0, w:WORLD.w, h:WORLD.h}, govComplexRect);

    // Posicionar el gobierno
    government.x = govComplexRect.x + parkW + parkGap;
    government.y = govComplexRect.y + parkH + parkGap;
    // Agregar el edificio de gobierno como imagen
    government.placed.push({
      k: 'gobierno',
      label: 'Gobierno',
      x: government.x,
      y: government.y,
      w: government.w,
      h: government.h
    });
    
  // Cementerio en la parte inferior céntrica del mapa (antes de distribuir otros edificios)
  const bottomMargin = 40;
  cemetery.x = Math.round(WORLD.w / 2 - cemetery.w / 2);
  cemetery.y = WORLD.h - cemetery.h - bottomMargin;
    
    // Distribuir parques más pequeños por el mapa
    const parkType = GOV_TYPES.find(t=>t.k==='parque');
    if(parkType) {
      // Definir tamaños más pequeños para los parques
      const smallParkW = 100; // reducido de ~220
      const smallParkH = 70;  // reducido de ~140
      const mediumParkW = 120;
      const mediumParkH = 85;
      
      // Crear lista de áreas a evitar
      const avoidList = [
        government, 
        cemetery, 
        ...avenidas, 
        ...roundabouts, 
        ...houses, 
        ...barrios,
        // Crear un área de exclusión alrededor del gobierno (margen extra)
        {
          x: government.x - 300, 
          y: government.y - 300, 
          w: government.w + 600, 
          h: government.h + 600
        }
      ];
      
      // Generar parques pequeños distribuidos por el mapa usando CFG.PARKS
      const parksCount = CFG.PARKS || 8;
      const parkLocations = scatterRects(
        parksCount,
        [smallParkW, mediumParkW], 
        [smallParkH, mediumParkH], 
        avoidList, 
        null, 
        120 // margen entre parques
      );
      
      // Iconos variados para los parques
      const parkIcons = [
        '🌳🌲', '🌲🌳', '🌴🌳', '🌳🌴', 
        '🌲🌴', '🌴🌲', '🌳', '🌲', '🌴'
      ];
      
      // Agregar parques al mapa con variedad de iconos
      parkLocations.forEach((park, i) => {
        const randomIcon = parkIcons[Math.floor(Math.random() * parkIcons.length)];
        
        government.placed.push({
          ...parkType,
          x: park.x,
          y: park.y,
          w: park.w,
          h: park.h,
          icon: randomIcon,
          fill: '#22c55e',
          stroke: '#166534',
          label: `Parque ${i+1}`
        });
      });
      // --- Colocar 4 bibliotecas distribuidas evitando solapamientos ---
      try{
        const bibliotecaType = GOV_TYPES.find(t => t.k === 'biblioteca');
        if(bibliotecaType){
          const libs = scatterRects(4, [bibliotecaType.w, bibliotecaType.w], [bibliotecaType.h, bibliotecaType.h], avoidList, null, 100);
          libs.forEach((b, idx) => {
            government.placed.push({...bibliotecaType, ...b, label: `Biblioteca ${idx+1}`} );
          });
          // añadir bibliotecas a la lista de evitación
          avoidList.push(...libs);
        }
      }catch(e){ console.warn('Error placing bibliotecas', e); }
      // Eliminar explícitamente 'Parque 8' si existe
      for (let i = government.placed.length - 1; i >= 0; i--) {
        const it = government.placed[i];
        if (it && typeof it.label === 'string' && it.label.trim() === 'Parque 8') {
          government.placed.splice(i, 1);
        }
      }
      
      // Agregar un parque grande especial en una zona alejada del mapa
      const bigParkLocation = scatterRects(
        1, 
        [160, 160], 
        [120, 120], 
        [...avoidList, ...parkLocations], 
        null, 
        150
      );
      
      if (bigParkLocation.length > 0) {
        government.placed.push({
          ...parkType,
          x: bigParkLocation[0].x,
          y: bigParkLocation[0].y,
          w: bigParkLocation[0].w,
          h: bigParkLocation[0].h,
          icon: '🌳🌲🌴',
          fill: '#15803d', // verde más intenso
          stroke: '#166534',
          label: 'Parque Central'
        });
      }
      
      // Agregar estos parques a la lista de evitación para otras estructuras
      avoidList.push(...parkLocations);
      if (bigParkLocation.length > 0) avoidList.push(bigParkLocation[0]);

      // Eliminar parques situados en la esquina inferior derecha (no queremos parque allí)
      const parkCornerThreshold = 100; // px desde borde
      for (let i = government.placed.length - 1; i >= 0; i--) {
        const g = government.placed[i];
        if (g && g.k === 'parque') {
          if ((g.x + (g.w || 0) > WORLD.w - parkCornerThreshold) && (g.y + (g.h || 0) > WORLD.h - parkCornerThreshold)) {
            government.placed.splice(i, 1);
          }
        }
      }
    }

  // Cementerio ya fue posicionado en la parte inferior céntrica

    // Llamar a la función para crear barrios y casas (sin duplicación)
    if (!preserveHouses) {
      makeBarriosYCasas(CFG.N_INIT + 24, {x: 0, y: 0, w: WORLD.w, h: WORLD.h}, []);
    }

    // Crear lista de evitación actualizada (después de crear casas)
    let avoidList = [government, ...avenidas, ...roundabouts, ...government.placed, ...houses, ...barrios];
    // Cementerio ya posicionado
    avoidList.push(cemetery);

    // Eliminar la avenida/calle que cruza por debajo del gobierno (horizontal central)
    // Buscar la avenida horizontal más cercana al centro vertical del gobierno
    const govY = government.y + government.h/2;
    for(let i=avenidas.length-1;i>=0;i--){
      const av = avenidas[i];
      if(av.w > av.h && Math.abs((av.y+av.h/2)-govY) < 40){
        avenidas.splice(i,1);
      }
    }

    // Escuelas y hospitales cerca del centro, iconos grandes
  // Asegurar que no se coloquen más de 1 estadio en total (conteo defensivo)
  // declarar el contador aquí antes de usarlo
  let estadioTotalCount = 0;
  const initialGovTypes = ['escuela', 'hospital', 'policia'];
  for(const typeKey of initialGovTypes) {
  if (typeKey === 'estadio' && estadioTotalCount >= 1) continue;
    const type = GOV_TYPES.find(t => t.k === typeKey);
    if(type) {
      const newBuildings = scatterRects(2, [type.w, type.w], [type.h, type.h], avoidList, null, 50);
      newBuildings.forEach(b => {
        government.placed.push({...type, ...b, icon: type.icon.repeat(3)});
  if (type.k === 'estadio') estadioTotalCount++;
      });
      avoidList.push(...newBuildings);
    }
  }

    // Negocios y fábricas con distribución organizada
    const sameTypeDist = 120; // Aumentado para garantizar más separación
    const urbanZones = [
      {x: 100, y: 100, w: WORLD.w/2 - 200, h: WORLD.h/2 - 200},
      {x: WORLD.w/2 + 100, y: 100, w: WORLD.w/2 - 200, h: WORLD.h/2 - 200},
      {x: 100, y: WORLD.h/2 + 100, w: WORLD.w/2 - 200, h: WORLD.h/2 - 200},
      {x: WORLD.w/2 + 100, y: WORLD.h/2 + 100, w: WORLD.w/2 - 200, h: WORLD.h/2 - 200}
    ];

    // Distribuir fábricas ordenadamente
    const factoryPositions = distributeEvenly(
      CFG.FACTORIES,
      [140, 180],
      [90, 120],
      avoidList,
      urbanZones[0],
      sameTypeDist
    );
    factories.push(...factoryPositions);
    // Filtrar fábricas con tamaño fuera del rango (defensa contra tamaños raros)
    const filteredFactories = factories.filter(f => {
      const wOk = f.w >= 120 && f.w <= 200;
      const hOk = f.h >= 70 && f.h <= 140;
      return wOk && hOk;
    });

    // Asegurar separación entre fábricas (misma clase): no dejar dos fábricas muy cercanas
    const minFactorySeparation = 140; // px
    const finalFactories = [];
    for (const f of filteredFactories) {
      const tooClose = finalFactories.some(existing => rectsOverlapWithMargin(existing, f, minFactorySeparation));
      if (!tooClose) finalFactories.push(f);
    }

    // Reemplazar factories con el set finalizado
    factories.length = 0; factories.push(...finalFactories);
    avoidList.push(...factories);

    // Distribuir bancos ordenadamente
    const bankPositions = distributeEvenly(
      CFG.BANKS,
      [110, 140],
      [70, 90],
      avoidList,
      urbanZones[1],
      sameTypeDist
    );
    if (bankPositions.length > 0) { bankPositions[bankPositions.length - 1].isFuchsia = true; }
    banks.push(...bankPositions);
    avoidList.push(...banks);

    // Distribuir centros comerciales ordenadamente
    const mallPositions = distributeEvenly(
      CFG.MALLS,
      [110, 140],
      [75, 95],
      avoidList,
      urbanZones[2],
      sameTypeDist
    );
    malls.push(...mallPositions);
    avoidList.push(...malls);
    // --- Remove specific items per user request ---
    try{
      // Remove 'Biblioteca 3' if it was added
      for (let i = government.placed.length - 1; i >= 0; i--) {
        const it = government.placed[i];
        if (it && typeof it.label === 'string' && it.label.trim() === 'Biblioteca 3') {
          government.placed.splice(i, 1);
        }
      }

      // Remove any mall located in the bottom-left corner of the world
      const removedMalls = [];
      for (let i = malls.length - 1; i >= 0; i--) {
        const m = malls[i];
        if (!m) continue;
        const c = centerOf(m);
        // bottom-left heuristic: x in left 25% and y in bottom 25%
        if (c.x < WORLD.w * 0.25 && c.y > WORLD.h * 0.75) {
          removedMalls.push(m);
          malls.splice(i, 1);
        }
      }
      // Remove removed malls from avoidList as well
      if (removedMalls.length > 0) {
        for (const rm of removedMalls) {
          const idx = avoidList.indexOf(rm);
          if (idx !== -1) avoidList.splice(idx, 1);
        }
        console.log('Removed malls in bottom-left corner:', removedMalls.length);
      }
    }catch(e){ console.warn('Error removing requested items', e); }

    // Distribuir instituciones gubernamentales uniformemente
  const govTypes = ['escuela', 'hospital', 'policia', 'estadio', 'central_electrica', 'bomberos'];
    const placedGovBuildings = [];
    let zoneIndex = 3; // Comenzamos con la última zona

    for(const typeKey of govTypes) {
      // Si la clave es 'estadio' y ya alcanzamos el límite, saltarla
  if (typeKey === 'estadio' && estadioTotalCount >= 1) continue;
      const type = GOV_TYPES.find(t => t.k === typeKey);
      if(type) {
        // Nota: no incrementamos aún; lo haremos después de colocar realmente el/los estadios
        const zone = urbanZones[zoneIndex % urbanZones.length];
        zoneIndex++;
        
        let positions = [];
        // Si es estadio, intentar ubicar un solo estadio (preferir esquina inferior izquierda)
        if (type.k === 'estadio') {
          const w = type.w, h = type.h;
          const marginCorner = 60; // margen inicial para la esquina

          // helper: probar colocar en rect (con pequeño retroceso interior si colisiona)
          const tryPlaceRect = (x0, y0) => {
            const maxShift = 6; // intentos
            const step = 40; // px por intento
            for (let i = 0; i < maxShift; i++) {
              const x = x0 + i * step; // desplazar hacia el interior a la derecha
              const y = y0 - i * step; // desplazar hacia el interior hacia arriba
              const rect = { x: Math.max(10, Math.min(x, WORLD.w - w - 10)), y: Math.max(10, Math.min(y, WORLD.h - h - 10)), w, h };
              const collides = [...avoidList, ...placedGovBuildings].some(a => rectsOverlapWithMargin(rect, a, 50));
              if (!collides) return rect;
            }
            return null;
          };

          // Intentar forzar el estadio en la esquina inferior izquierda (SW)
          const swX = marginCorner;
          const swY = WORLD.h - h - marginCorner;
          const r = tryPlaceRect(swX, swY);
          if (r) {
            positions = [r];
          } else {
            // fallback: encontrar un solo lugar por distribución
            positions = distributeEvenly(
              1,
              [type.w, type.w],
              [type.h, type.h],
              [...avoidList, ...placedGovBuildings],
              zone,
              sameTypeDist
            );
          }
        } else {
          positions = distributeEvenly(
            2, // Dos de cada tipo
            [type.w, type.w],
            [type.h, type.h],
            [...avoidList, ...placedGovBuildings],
            zone,
            sameTypeDist
          );
        }

        positions.forEach(pos => {
          const govBuilding = {...type, ...pos, icon: type.icon.repeat(3)};
          government.placed.push(govBuilding);
          placedGovBuildings.push(govBuilding);
        });
        // Si hemos colocado estadios, aumentar el contador para evitar más colocaciones
        if (type.k === 'estadio' && positions && positions.length > 0) {
          estadioTotalCount += positions.length;
        }
      }
    }

    // Agregar todos los edificios gubernamentales a la lista de evitación
    avoidList.push(...placedGovBuildings);

    // --- Garantizar que no haya solapamientos entre casas, parques y edificaciones ---
    function tryShiftRect(rect, others, margin) {
      const step = 20;
      const maxRadius = 600;
      for (let r = step; r <= maxRadius; r += step) {
        // probar 8 direcciones alrededor
        const dirs = [[r,0],[-r,0],[0,r],[0,-r],[r,r],[-r,-r],[r,-r],[-r,r]];
        for (const d of dirs) {
          const nx = Math.max(5, Math.min(WORLD.w - rect.w - 5, rect.x + d[0]));
          const ny = Math.max(5, Math.min(WORLD.h - rect.h - 5, rect.y + d[1]));
          const cand = {x: nx, y: ny, w: rect.w, h: rect.h};
          const coll = others.some(o => o !== rect && rectsOverlapWithMargin(cand, o, margin));
          if (!coll) { rect.x = nx; rect.y = ny; return true; }
        }
      }
      return false;
    }

    // Mover un edificio fuera de la calle/avenida si su centro está sobre una vía
    function moveBuildingOffRoad(label){
      try{
        if(!label) return false;
        const needle = (''+label).toString().trim().toLowerCase();
        const lists = [...government.placed, ...shops, ...factories, ...banks, ...malls, ...houses];
        const allOthers = [...government.placed, ...shops, ...factories, ...banks, ...malls, ...houses];
        const isOnAnyRoad = (rect) => {
          const c = centerOf(rect);
          for(const r of [...avenidas, ...roadRects]){ if(inside(c, r)) return true; }
          for(const ra of roundabouts){ const d = Math.hypot(c.x - ra.cx, c.y - ra.cy); if(d < ra.w/2) return true; }
          return false;
        };

        for(const it of lists){
          if(!it) continue;
          const lab = (it.label || it.k || it.kind || it.type || '').toString().trim().toLowerCase();
          if(lab !== needle) continue;
          // if already moved before, skip
          if(it.__movedOffRoad) return true;
          if(!isOnAnyRoad(it)) { it.__movedOffRoad = true; return true; }
          // try simple shifts first
          if(tryShiftRect(it, allOthers, 40)){
            if(!isOnAnyRoad(it)) { it.__movedOffRoad = true; return true; }
          }
          // spiral search for nearest free spot not on road
          const startCx = Math.max(5, Math.min(WORLD.w - it.w - 5, it.x));
          const startCy = Math.max(5, Math.min(WORLD.h - it.h - 5, it.y));
          const step = 20;
          const maxR = Math.max(WORLD.w, WORLD.h);
          for(let r=step; r<=maxR; r+=step){
            const steps = Math.max(8, Math.floor((2*Math.PI*r)/step));
            for(let s=0;s<steps;s++){
              const ang = (s/steps) * Math.PI * 2;
              const nx = Math.round(startCx + Math.cos(ang) * r);
              const ny = Math.round(startCy + Math.sin(ang) * r);
              const cand = { x: Math.max(5, Math.min(WORLD.w - it.w - 5, nx)), y: Math.max(5, Math.min(WORLD.h - it.h - 5, ny)), w: it.w, h: it.h };
              // avoid overlaps
              const coll = allOthers.some(o => o !== it && rectsOverlapWithMargin(cand, o, 6));
              if(coll) continue;
              // ensure not on road
              if(!isOnAnyRoad(cand)){
                it.x = cand.x; it.y = cand.y; it.__movedOffRoad = true; return true;
              }
            }
          }
          // fallback: keep original but mark attempted
          it.__movedOffRoad = true;
          return false;
        }
        return false;
      }catch(e){ console.warn('moveBuildingOffRoad error', e); return false; }
    }

    // Si existen dos hospitales muy juntos, forzarlos a los extremos izquierdo/derecho
    try{
      const hosp = government.placed.filter(g => ((g.k||g.kind||'').toString().toLowerCase().includes('hospital')));
      if(hosp.length >= 2){
        const a = hosp[0], b = hosp[1];
        const ca = centerOf(a), cb = centerOf(b);
        const closeThresh = 220;
        if(Math.hypot(ca.x - cb.x, ca.y - cb.y) < closeThresh){
          const marginEdge = 40;
          // Ubicar uno a la izquierda y otro a la derecha, centrados verticalmente
          a.x = Math.max(10, marginEdge);
          a.y = Math.max(10, Math.min(WORLD.h - a.h - 10, Math.floor(WORLD.h/2 - a.h - 20)));
          b.x = Math.max(10, WORLD.w - b.w - marginEdge);
          b.y = Math.max(10, Math.min(WORLD.h - b.h - 10, Math.floor(WORLD.h/2 + 20)));
          // Intentar desplazar ligeramente si colisionan con otras cosas
          const all = [...government.placed, ...shops, ...factories, ...banks, ...malls, ...houses];
          tryShiftRect(a, all, 60);
          tryShiftRect(b, all, 60);
          console.log('Hospitals repositioned to left/right to reduce clustering');
        }
      }
    }catch(e){ console.warn('hospital reposition error', e); }

    // Intentar separar edificios del mismo tipo para evitar que queden muy cercanos.
    // Soporta distancias por tipo (ej: 'central_electrica' más separada).
    function enforceSameTypeSeparation(minSeparation = 220){
      try{
        const groups = {};
        const gather = (it) => {
          if(!it) return null;
          return it.k || it.kind || (it.label && it.label.toLowerCase());
        };

        // Distancias específicas por tipo (px). Añadir/ajustar según necesidad.
        const perTypeSep = {
          'central_electrica': 320,
          'hospital': 260,
          'biblioteca': 160,
          'escuela': 160
        };

        const candidates = [...government.placed, ...shops, ...factories, ...banks, ...malls, ...houses];
        for(const c of candidates){
          const key = gather(c);
          if(!key) continue;
          const nk = (''+key).toString().toLowerCase();
          (groups[nk] ||= []).push(c);
        }

        const getSepFor = (obj) => {
          const key = (''+(obj.k || obj.kind || (obj.label||'')).toString()).toLowerCase();
          return perTypeSep[key] || minSeparation;
        };

        for(const key in groups){
          const arr = groups[key];
          if(arr.length < 2) continue;
          for(let i=0;i<arr.length;i++){
            for(let j=i+1;j<arr.length;j++){
              const a = arr[i], b = arr[j];
              const ca = centerOf(a), cb = centerOf(b);
              const dist = Math.hypot(ca.x - cb.x, ca.y - cb.y);
              const sepA = getSepFor(a), sepB = getSepFor(b);
              const needed = Math.max(sepA, sepB, minSeparation);
              if(dist < needed){
                const others = [...government.placed, ...shops, ...factories, ...banks, ...malls, ...houses];
                // intentar mover b primero con margen 'needed'
                if(!tryShiftRect(b, others, needed)){
                  // intentar mover a
                  if(!tryShiftRect(a, others, needed)){
                    // intentar mover b con un margen aún mayor como último intento
                    tryShiftRect(b, others, Math.max(needed, 420));
                  }
                }
              }
            }
          }
        }
      }catch(e){ console.warn('enforceSameTypeSeparation error', e); }
    }

    // Forzar unicidad por sector: una sola instancia de cada tipo por sector (excepto casas)
    function enforceSectorUniqueness(nx = 4, ny = 4){
      try{
        const allLists = [...government.placed, ...shops, ...factories, ...banks, ...malls];
        const sectorW = Math.max(1, Math.floor(WORLD.w / nx));
        const sectorH = Math.max(1, Math.floor(WORLD.h / ny));
        const sectorHas = new Map(); // key: sx+','+sy -> Set of type keys

        const getTypeKey = (it) => ('' + (it.k || it.kind || it.label || it.type || '')).toLowerCase();
        const sectorOf = (x,y) => {
          const sx = Math.min(nx-1, Math.max(0, Math.floor(x / sectorW)));
          const sy = Math.min(ny-1, Math.max(0, Math.floor(y / sectorH)));
          return `${sx},${sy}`;
        };

        // populate
        for(const it of allLists){
          if(!it) continue;
          const t = getTypeKey(it);
          if(!t) continue;
          const c = centerOf(it);
          const s = sectorOf(c.x, c.y);
          const set = sectorHas.get(s) || new Set();
          set.add(t);
          sectorHas.set(s, set);
        }

        // Now enforce: for each item, if its sector already had same type more than once,
        // move duplicates to nearest sector without that type.
        const sectors = [];
        for(let sx=0;sx<nx;sx++) for(let sy=0;sy<ny;sy++) sectors.push({sx,sy,x:sx*sectorW,y:sy*sectorH,w:sectorW,h:sectorH});

        const findNearestAvailableSector = (fromS, typeKey) => {
          const [fx,fy] = fromS.split(',').map(Number);
          let best = null; let bestDist = Infinity;
          for(const s of sectors){
            const key = `${s.sx},${s.sy}`;
            const set = sectorHas.get(key);
            if(set && set.has(typeKey)) continue;
            const cx = s.x + s.w/2, cy = s.y + s.h/2;
            const dist = Math.hypot((fx*s.w + s.w/2) - cx, (fy*s.h + s.h/2) - cy);
            if(dist < bestDist){ bestDist = dist; best = s; }
          }
          return best;
        };

        for(const it of allLists.slice()){ // clone to be safe
          if(!it) continue;
          const t = getTypeKey(it);
          if(!t) continue;
          // skip houses
          if(t === 'house' || t === 'houses') continue;
          const c = centerOf(it);
          const sKey = sectorOf(c.x, c.y);
          const set = sectorHas.get(sKey) || new Set();
          // count how many of this type in this sector
          let count = 0;
          for(const o of allLists){ if(getTypeKey(o) === t && sectorOf(centerOf(o).x, centerOf(o).y) === sKey) count++; }
          if(count <= 1) continue; // ok

          // find nearest sector without this type
          const target = findNearestAvailableSector(sKey, t);
          if(target){
            // move item to center of target with small jitter
            const jitter = 20;
            it.x = Math.max(5, Math.min(WORLD.w - it.w - 5, Math.round(target.x + (target.w/2) - it.w/2 + (Math.random()*jitter*2 - jitter))));
            it.y = Math.max(5, Math.min(WORLD.h - it.h - 5, Math.round(target.y + (target.h/2) - it.h/2 + (Math.random()*jitter*2 - jitter))));
            // try to shift if collision
            const others = [...government.placed, ...shops, ...factories, ...banks, ...malls, ...houses];
            tryShiftRect(it, others, 40);
            // update maps
            const oldSet = sectorHas.get(sKey);
            if(oldSet) { oldSet.delete(t); }
            const newKey = `${target.sx},${target.sy}`;
            const newSet = sectorHas.get(newKey) || new Set();
            newSet.add(t); sectorHas.set(newKey, newSet);
          }
        }
      }catch(e){ console.warn('enforceSectorUniqueness error', e); }
    }

    function removeRectFromCollections(r){
      const lists = [houses, government.placed, shops, factories, banks, malls];
      for(const lst of lists){ const idx = lst.indexOf(r); if(idx!==-1){ lst.splice(idx,1); return true; } }
      return false;
    }

  // removeByLabels definida en ámbito global más arriba

    function enforceNoOverlap(margin = 6){
      const all = [...houses, ...government.placed, ...shops, ...factories, ...banks, ...malls];
      for (let i = 0; i < all.length; i++){
        for (let j = i + 1; j < all.length; j++){
          const a = all[i], b = all[j];
          if (rectsOverlapWithMargin(a, b, margin)){
            // intentar mover b primero
            const others = all.slice();
            if (!tryShiftRect(b, others, margin)){
              // intentar mover a si b no pudo
              if (!tryShiftRect(a, others, margin)){
                // como último recurso, eliminar b
                removeRectFromCollections(b);
                // también sacarlo del array 'all' para no seguir comparándolo
                all.splice(j,1); j--; continue;
              }
            }
          }
        }
      }
    }

  // Forzar unicidad por sector antes de separar por tipo
  enforceSectorUniqueness(4,4);
  // Intentar primero separar edificios iguales con una distancia mayor
  enforceSameTypeSeparation(220);
  // Ejecutar la limpieza final con un margen conservador
  enforceNoOverlap(8);

  // Garantizar que nada quede montado o debajo del cementerio
  try {
    const others = [...houses, ...government.placed, ...shops, ...factories, ...banks, ...malls];
    for (let i = others.length - 1; i >= 0; i--) {
      const o = others[i];
      if (!o) continue;
      if (rectsOverlapWithMargin(o, cemetery, 0)) {
        // intentar desplazar el objeto lejos del cementerio, si no se puede, eliminarlo
        if (!tryShiftRect(o, [cemetery, ...others], Math.max(20, Math.ceil(Math.min(cemetery.w, cemetery.h) / 4)))) {
          removeRectFromCollections(o);
        }
      }
    }
  } catch (e) { console.warn('cemetery overlap enforcement error', e); }
  }

  /* AGREGAR FUNCIÓN PARA DIBUJAR EDIFICIOS CON IMÁGENES */
  function drawBuildingWithImage(rect, type, fallbackFill, fallbackStroke) {
    const key = type.k || type;
    
    try {
      const img = BUILDING_IMAGE_CACHE[key];
      
      // Usar imagen sólo si existe y se cargó correctamente
      if (img && !img.error && img.complete && img.naturalWidth > 0) {
        const {x, y, w, h} = rect;
        const screenPos = toScreen(x, y);
        ctx.drawImage(img, screenPos.x, screenPos.y, w * ZOOM, h * ZOOM);
        return;
      }
    } catch (e) {
      console.warn(`Error al dibujar imagen para ${key}:`, e);
    }
    
    // Fallback: Dibujar rectángulo con color
    const fill = fallbackFill || '#334155';
    const stroke = fallbackStroke || '#94a3b8';
    drawRoundRect(rect, fill, stroke);
    
    // Mostrar ícono si está disponible
    if (rect.icon) {
      const p = toScreen(rect.x, rect.y);
      const w = rect.w * ZOOM, h = rect.h * ZOOM;
      ctx.font = `${Math.max(16, 24 * ZOOM)}px system-ui,Segoe UI,Arial,emoji`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(rect.icon, p.x + w/2, p.y + h/2 + 8 * ZOOM);
    }
  }

  /* ===== DIBUJO ===== */
  function drawRoundRect(r, fill, stroke, rad=10, lw=3){const p=toScreen(r.x,r.y); const w=r.w*ZOOM, h=r.h*ZOOM, rr=Math.min(rad*ZOOM,w/2,h/2);ctx.beginPath(); ctx.moveTo(p.x+rr,p.y);ctx.arcTo(p.x+w,p.y,p.x+w,p.y+h,rr); ctx.arcTo(p.x+w,p.y+h,p.x,p.y+h,rr);ctx.arcTo(p.x,p.y+h,p.x,p.y,rr); ctx.arcTo(p.x,p.y,p.x+w,p.y,rr); ctx.closePath();ctx.fillStyle=fill; ctx.fill(); ctx.strokeStyle=stroke; ctx.lineWidth=lw*ZOOM; ctx.stroke();}
  function drawLabelIcon(rect, label, emoji, iconSize = 32){
    const p = toScreen(rect.x, rect.y);
    ctx.font = `700 ${Math.max(8, 12 * ZOOM)}px system-ui,Segoe UI,Arial`;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
  // sombra de texto eliminada
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    ctx.textAlign = 'left'; ctx.fillText(label, p.x + 10 * ZOOM, p.y + 20 * ZOOM);
    ctx.font = `700 ${Math.max(10, iconSize * ZOOM)}px system-ui,Segoe UI,Arial,emoji`;
    ctx.textAlign = 'center';
    const iconX = p.x + (rect.w * ZOOM) - (10 * ZOOM);
    const iconY = p.y + (rect.h * ZOOM) / 2 + (iconSize * 0.18) * ZOOM;
    ctx.fillText(emoji, iconX, iconY);
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; // asegurado sin sombra
  }
  function drawGrid(){
  if(!CFG.LINES_ON) return; // grid desactivado
  const step = 120*ZOOM;
  ctx.lineWidth=1; ctx.strokeStyle='#27324c'; ctx.globalAlpha=0.45;
  const xStart = Math.floor((cam.x)/(step/ZOOM))*(step/ZOOM), xEnd = cam.x + canvas.width/ZOOM + step/ZOOM;
  for(let x=xStart; x<=xEnd; x+=step/ZOOM){ 
    const p1=toScreen(x,0); 
    ctx.beginPath(); 
    ctx.moveTo(p1.x,0); 
    ctx.lineTo(p1.x,canvas.height); 
    ctx.stroke(); 
  }
  const yStart = Math.floor((cam.y)/(step/ZOOM))*(step/ZOOM), yEnd = cam.y + canvas.height/ZOOM + step/ZOOM;
  for(let y=yStart; y<=yEnd; y+=step/ZOOM){ 
    const p1=toScreen(0,y); 
    ctx.beginPath(); 
    ctx.moveTo(0,p1.y); 
    ctx.lineTo(canvas.width,p1.y); 
    ctx.stroke(); 
  }
  ctx.globalAlpha=1;
}

  function drawAvenidas(){
    for(const av of avenidas){
      const p = toScreen(av.x, av.y);
      const w = av.w * ZOOM, h = av.h * ZOOM;
      // Determinar orientación: vertical si es más alto que ancho
      const orientation = h > w ? 'v' : 'h';
      const pat = getStreetPattern(ctx, orientation);
      if(pat){
        ctx.save(); ctx.translate(p.x, p.y); ctx.fillStyle = pat; ctx.fillRect(0,0,w,h); ctx.restore();
      } else {
        ctx.fillStyle = '#555'; ctx.fillRect(p.x,p.y,w,h);
      }
      // líneas blancas laterales
      ctx.strokeStyle='#f3f4f6'; ctx.lineWidth=2*ZOOM; ctx.strokeRect(p.x,p.y,w,h);
      // línea discontinua central
      ctx.save();
      ctx.strokeStyle='#ffffff'; ctx.lineWidth=3*ZOOM; ctx.setLineDash([14*ZOOM, 18*ZOOM]);
      ctx.beginPath();
      if(orientation==='v'){
        ctx.moveTo(p.x + w/2, p.y); ctx.lineTo(p.x + w/2, p.y + h);
      } else {
        ctx.moveTo(p.x, p.y + h/2); ctx.lineTo(p.x + w, p.y + h/2);
      }
      ctx.stroke(); ctx.restore();
    }
  }
  function drawRoundabouts(){
    for(const r of roundabouts){
      const p = toScreen(r.cx, r.cy);
      const radius = r.w/2 * ZOOM;
      ctx.fillStyle = 'rgba(75,85,99,0.95)';
      ctx.strokeStyle = 'rgba(156,163,175,0.95)';
      ctx.lineWidth = 2 * ZOOM;
      ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(12,81,58,0.92)'; ctx.beginPath(); ctx.arc(p.x, p.y, radius * 0.6, 0, Math.PI*2); ctx.fill();
    }
  }
  function drawBarrios(){
    for(const b of barrios){
      const p = toScreen(b.x, b.y);
      const bw = b.w * ZOOM, bh = b.h * ZOOM;
      // Si hay una imagen de fondo global, no rellenamos el barrio (background ya está tileado)
      if (!(BG_IMG && BG_IMG.complete && BG_IMG.naturalWidth > 0)) {
        ctx.fillStyle = 'rgba(12,18,42,0.55)'; ctx.fillRect(p.x, p.y, bw, bh);
      }
      // Borde del barrio: omitir si hay casas dentro (el usuario pidió quitar el recuadro en barrios con casas)
      const hasHouseInBarrio = houses.some(hh => inside(centerOf(hh), b));
      if (!hasHouseInBarrio) {
        ctx.strokeStyle = 'rgba(51,65,85,0.9)'; ctx.lineWidth = 2 * ZOOM; ctx.strokeRect(p.x, p.y, bw, bh);
      }
      // Etiqueta del barrio
      ctx.font = `700 ${Math.max(10, 14 * ZOOM)}px system-ui,Segoe UI`;
      ctx.fillStyle = 'rgba(34,34,34,0.95)';
      // Dar sombra ligera para mejorar legibilidad
  // sombra de texto eliminada
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
      ctx.fillText(b.name, p.x + 8 * ZOOM, p.y + 18 * ZOOM);
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; // asegurado sin sombra
    }
  }

  // Dibuja la imagen de fondo repetida (tile) a lo largo del mundo, ajustándose al zoom/cámara
  function drawTiledBackground(){
    if (!(BG_IMG && BG_IMG.complete && BG_IMG.naturalWidth > 0)) return;
    const tileW = BG_IMG.naturalWidth;
    const tileH = BG_IMG.naturalHeight;
    const vx0 = cam.x, vy0 = cam.y;
    const vw = canvas.width / ZOOM, vh = canvas.height / ZOOM;
    const i0 = Math.max(Math.floor(vx0 / tileW) - 1, 0);
    const j0 = Math.max(Math.floor(vy0 / tileH) - 1, 0);
    const i1 = Math.min(Math.ceil((vx0 + vw) / tileW) + 1, Math.ceil(WORLD.w / tileW));
    const j1 = Math.min(Math.ceil((vy0 + vh) / tileH) + 1, Math.ceil(WORLD.h / tileH));
    ctx.imageSmoothingEnabled = false;
    for(let i=i0;i<i1;i++){
      for(let j=j0;j<j1;j++){
        const wx = i*tileW, wy = j*tileH;
        const p = toScreen(wx, wy);
        // Redondear para evitar sub-pixel gaps y solapar +1px
        const sx = Math.round(p.x), sy = Math.round(p.y);
        const sw = Math.round(tileW*ZOOM)+1, sh = Math.round(tileH*ZOOM)+1;
        ctx.drawImage(BG_IMG, sx, sy, sw, sh);
      }
    }
  }

  function drawWorld(){
  // Asegurar que las panaderías no compradas se eliminen antes de dibujar
  try{ removeUnownedPanaderias(); }catch(e){}

  // Eliminar etiquetas solicitadas por el usuario (ej: 'Hospital 3', 'Escuela 2', etc.)
  // Esta operación solo debe ejecutarse una vez por sesión para evitar spam de CPU
  try{
    if(!window.__labelsRemoved){
      removeByLabels(['hospital 3','escuela 2','central electrica 2','policia 2','policia 4','central electrica 1','edificio 7','central eléctrica 2','panaderia 4','panaderia 5','panadería 4','panadería 5']);
      window.__labelsRemoved = true;
    }
  }catch(e){ console.warn('Error invoking removeByLabels', e); }

  // Las panaderías solo deben mostrarse cuando tengan ownerId; la función
  // removeUnownedPanaderias() y los filtros en getVisibleShops() se encargan
  // de ocultar las panaderías que no han sido compradas.

  // Fondo base del canvas (claro). Las imágenes de barrio se dibujan por barrio en drawBarrios
  ctx.fillStyle = '#fff8e1'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Dibujar el fondo tileado del mundo (se adapta a cam.x/cam.y y ZOOM)
    drawTiledBackground();
    drawGrid();
    // Dibujar barrios (los barrios ya no necesitan pintar la imagen)
    drawBarrios();
    drawAvenidas(); drawRoundabouts();
    for(const r of roadRects){
      const p = toScreen(r.x, r.y);
      const w = r.w * ZOOM, h = r.h * ZOOM;
      const pat = getStreetPattern(ctx);
      if(pat){
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }else{
        ctx.fillStyle='rgba(75,85,99,0.95)';
        ctx.fillRect(p.x, p.y, w, h);
      }
      ctx.strokeStyle='rgba(156,163,175,0.9)';ctx.lineWidth=1*ZOOM; ctx.strokeRect(p.x,p.y,w,h);
    }


  // Preferir arrays sincronizadas desde el servidor cuando estén disponibles
  const renderShopsRaw = (window.gameState && Array.isArray(window.gameState.shops)) ? window.gameState.shops : shops;
  // Mostrar todas las tiendas, incluidas las panaderías
  const renderShops = renderShopsRaw;
    const renderHouses = window.__netHouses || houses;
  const renderGovernmentPlaced = (window.gameState && window.gameState.government && Array.isArray(window.gameState.government.placed) && window.gameState.government.placed.length > 0) ? window.gameState.government.placed : government.placed;
  const usingServerGov = (window.gameState && window.gameState.government && Array.isArray(window.gameState.government.placed) && renderGovernmentPlaced === window.gameState.government.placed);

  // Intento único de mover 'Central Eléctrica 1' fuera de una calle si está sobre ella
  try{ moveBuildingOffRoad('Central Eléctrica 1'); }catch(e){ /* ignore */ }

  // Mantener visible sólo UNA panadería al comienzo (prefiere una con ownerId si existe)
  try{
    if(!window.__keptOnePanaderia){
      (function keepSinglePanaderia(){
        try{
          const allShops = (window.gameState && Array.isArray(window.gameState.shops)) ? window.gameState.shops : shops;
          const isPan = s => (s && (s.k || s.kind || s.label || '').toString().toLowerCase().includes('panader'));
          const panList = allShops.filter(isPan);
          if(panList.length <= 1) return;
          // prefer owned panaderia
          let keeper = panList.find(p=>p.ownerId!=null && p.ownerId!=='' );
          if(!keeper) keeper = panList[0];
          // remove others from shops array
          for(let i = shops.length-1; i>=0; i--){ if(isPan(shops[i]) && shops[i] !== keeper) shops.splice(i,1); }
          // also from server shadow
          if(window.gameState && Array.isArray(window.gameState.shops)){
            window.gameState.shops = window.gameState.shops.filter(s => !isPan(s) || s === keeper);
          }
          window.__keptOnePanaderia = true;
          console.log('keepSinglePanaderia: kept', keeper && (keeper.label||keeper.k||keeper.id||keeper._id)||'unknown');
        }catch(e){ console.warn('keepSinglePanaderia error', e); }
      })();
    }
  }catch(e){ }

    factories.forEach(f => {
      drawBuildingWithImage(f, 'factory', '#44403c', '#fbbf24');
    });

    drawBuildingWithImage(cemetery, 'cemetery', 'rgba(51,65,85,0.92)', 'rgba(148,163,184,0.95)');

    banks.forEach(b => {
      drawBuildingWithImage(b, 'bank', '#2d3748', '#fde68a');
    });
    malls.forEach(m => {
      drawBuildingWithImage(m, 'mall', '#1e293b', '#38bdf8');
    });
    renderShops.forEach(s => {
      drawBuildingWithImage(s, s.kind, '#8B5CF6', '#c4b5fd');
    });

    // Mostrar dinero acumulado de cada negocio comprado
    try{
      for(const s of renderShops){
        if(!s || !s.ownerId) continue; // solo negocios con dueño
        const amount = Math.floor(s.cashbox || 0);
        if(amount <= 0) continue; // no mostrar cuando está vacío
        const p = toScreen(s.x, s.y);
        const w = s.w * ZOOM;
        const now = performance.now();
        const age = now - (s._lastCashboxChange || 0);
        // Fade suave después de 12s sin cambios
        let alpha = 1.0;
        const FADE_DELAY = 12000, FADE_LEN = 6000;
        if(age > FADE_DELAY){
          alpha = Math.max(0.15, 1 - (age-FADE_DELAY)/FADE_LEN);
        }
        const label = `💰 ${amount}`;
        ctx.save();
        ctx.font = `${11*ZOOM}px ui-monospace,monospace`;
        const metrics = ctx.measureText(label);
        const bw = metrics.width + 14;
        const bh = 16*ZOOM;
        const cx = p.x + w/2;
        const topY = p.y - 4*ZOOM;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgba(30,41,59,0.90)';
        ctx.strokeStyle = 'rgba(234,179,8,0.85)';
        ctx.lineWidth = 1;
        if(ctx.roundRect){ ctx.beginPath(); ctx.roundRect(cx-bw/2, topY-bh, bw, bh, 4*ZOOM); ctx.fill(); ctx.stroke(); }
        else { ctx.fillRect(cx-bw/2, topY-bh, bw, bh); ctx.strokeRect(cx-bw/2, topY-bh, bw, bh); }
        ctx.fillStyle = '#fcd34d'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(label, cx, topY-bh/2+1);
        ctx.restore();
      }
    }catch(_){ }

  // Etiquetas de edificaciones ocultas por solicitud del usuario

    for(const inst of renderGovernmentPlaced){
      // Si los datos provienen del servidor, algunos campos (k/key/type) pueden faltar.
      // Asumir que los objetos dentro de government.placed del servidor son instituciones
      // y forzar su tratamiento como 'gobierno' cuando falte la clave.
      const heuristicsGov = (inst.k === 'gobierno') || (inst.key === 'gobierno') || (inst.type === 'gobierno') || (inst.label && typeof inst.label === 'string' && inst.label.toLowerCase().includes('gobierno'));
      const isGov = heuristicsGov || usingServerGov || (inst.kind && (inst.kind === 'gobierno' || inst.kind === 'government'));
      if(isGov){
        const iw = inst.w || (government.w || 240);
        const ih = inst.h || (government.h || 140);
        const p = toScreen(inst.x, inst.y);
        const w = iw * 2 * ZOOM, h = ih * 2 * ZOOM;
        // Centrar la imagen en el mismo punto central
        const px = p.x + (iw * ZOOM)/2 - w/2;
        const py = p.y + (ih * ZOOM)/2 - h/2;

        // Usar la imagen del objeto BUILDING_IMAGES
        const img = BUILDING_IMAGE_CACHE['gobierno'];

        if (img && img.complete && img.naturalWidth !== 0 && !img.error) {
          ctx.drawImage(img, px, py, w, h);
        } else {
          // Fallback si la imagen no está disponible
          ctx.fillStyle = 'rgba(0, 82, 204, 0.8)';
          ctx.fillRect(px, py, w, h);
          ctx.strokeStyle = '#60a5fa';
          ctx.lineWidth = 2;
          ctx.strokeRect(px, py, w, h);
          // No texto del edificio
        }
      } else if(inst.k === 'carcel'){
        const p = toScreen(inst.x, inst.y);
        const w = inst.w * ZOOM, h = inst.h * ZOOM;
        ctx.fillStyle = 'rgba(20,20,20,0.9)';
        ctx.fillRect(p.x, p.y, w, h);
        ctx.fillStyle = 'rgba(220,220,220,0.95)';
        const bars = Math.max(3, Math.floor(inst.w/10));
        for(let i=0;i<bars;i++){ const bx = p.x + 4 + i*(w-8)/(bars-1); ctx.fillRect(bx, p.y+4, 2, h-8); }
        // Sin texto "CÁRCEL"
      } else {
        // Usar drawBuildingWithImage en lugar de drawLabelIcon (sin textos)
        drawBuildingWithImage(inst, inst.k, inst.fill, inst.stroke);
      }
    }

    // Dibujar casas con posible marcador de arriendo
    renderHouses.forEach(h => {
      if(!h) return;
      const stroke = h.ownerId ? '#22d3ee' : '#94a3b8';
      // Owned house: slightly different fill
      const fill = h.owned ? '#2f4858' : '#334155';
      drawBuildingWithImage(h, 'house', fill, stroke);
      try{
        if(!h) return;
        const isRented = h.rentedBy && !h.ownerId;
        if(isRented || h._markerInitial){
          const p = toScreen(h.x, h.y);
          const w = h.w * ZOOM;
          const labelInitial = h._markerInitial || '?';
          ctx.save();
          ctx.font = `${12*ZOOM}px ui-monospace,monospace`;
          const label = '✓ ' + labelInitial;
          const metrics = ctx.measureText(label);
          const bw = metrics.width + 12;
          const bh = 16*ZOOM;
          const cx = p.x + w/2;
          const topY = p.y - 8*ZOOM;
          ctx.fillStyle = 'rgba(15,50,28,0.92)';
          ctx.strokeStyle = 'rgba(60,160,90,0.9)';
          ctx.lineWidth = 1;
          // Fondo redondeado manual si roundRect no existe
          if(ctx.roundRect){ ctx.beginPath(); ctx.roundRect(cx-bw/2, topY-bh, bw, bh, 4*ZOOM); ctx.fill(); ctx.stroke(); }
          else { ctx.fillRect(cx-bw/2, topY-bh, bw, bh); ctx.strokeRect(cx-bw/2, topY-bh, bw, bh); }
          ctx.fillStyle = '#5eff94'; ctx.textAlign='left'; ctx.textBaseline='middle';
          ctx.fillText('✓', cx-bw/2+6, topY-bh/2);
          ctx.fillStyle='#fff'; ctx.fillText(labelInitial, cx-bw/2+20, topY-bh/2);
          ctx.restore();
        }
        if(h._highlightUntil && performance.now() < h._highlightUntil){
          const p2 = toScreen(h.x, h.y); const w2 = h.w * ZOOM, h2 = h.h * ZOOM;
          ctx.save(); ctx.strokeStyle = '#41d77c'; ctx.lineWidth = 3; ctx.globalAlpha = 0.85; ctx.strokeRect(p2.x-2, p2.y-2, w2+4, h2+4); ctx.restore();
        }
      }catch(_){ }
    });
  }

  function drawSocialLines() {
    if (!SHOW_LINES || !socialConnections.length) return;
    ctx.lineWidth = 1.5 * ZOOM;
    for (const conn of socialConnections) {
      const pa = toScreen(conn.a.x, conn.a.y);
      const pb = toScreen(conn.b.x, conn.b.y);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
      // Base blanca tenue y más roja a mayor coincidencia de gustos
      let color = 'rgba(255,255,255,0.55)'; // blanco
      if (conn.matches === 2) color = 'rgba(255, 200, 200, 0.7)';
      else if (conn.matches === 3) color = 'rgba(252, 165, 165, 0.85)';
      else if (conn.matches === 4) color = 'rgba(244, 63, 94, 0.95)';
      else if (conn.matches >= 5) color = 'rgba(220, 38, 38, 1.0)';
      ctx.strokeStyle = color; ctx.stroke();
    }
  }
  function updateSocialLogic() {
    const newConnections = [];
    // Mostrar sugerencia de "media naranja" cuando el jugador coincide en 4 gustos con alguien cercano
    const player = agents.find(a => a.id === USER_ID);
    const HEART = '💘';
    const SEEN_SET = (window.__seenLovePrompts = window.__seenLovePrompts || new Set());
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      if (a.state === 'child') continue;
      for (let j = i + 1; j < agents.length; j++) {
        const b = agents[j];
        if (b.state === 'child') continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 50) {
          const matches = likeMatches(a, b);
          newConnections.push({ a, b, matches });
          // Prompt de media naranja: sólo involucra al jugador; 4 coincidencias, cerca
          if (player && (a.id === player.id || b.id === player.id) && matches >= 4 && d < 30) {
            const other = (a.id === player.id) ? b : a;
            const key = player.id + '|' + other.id;
            if (!SEEN_SET.has(key)) {
              SEEN_SET.add(key);
              try{
                showLovePrompt(other);
              }catch(_){ /* ignore UI errors */ }
            }
          }
          const near = d < 28;
          const aOwnsHouse = a.houseIdx !== null && houses[a.houseIdx] && houses[a.houseIdx].ownerId === a.id;
          const bOwnsHouse = b.houseIdx !== null && houses[b.houseIdx] && houses[b.houseIdx].ownerId === b.id;
          if (near && matches >= 5 && (aOwnsHouse || bOwnsHouse) && a.state === 'single' && b.state === 'single' && a.cooldownSocial <= 0 && b.cooldownSocial <= 0) {
            a.state = 'paired'; b.state = 'paired';
            a.spouseId = b.id; b.spouseId = a.id;
            a.cooldownSocial = 120; b.cooldownSocial = 120;
            a.justMarried = performance.now(); b.justMarried = performance.now();
            toast(`${a.code} y ${b.code} se han casado! 💕`);

            let targetHome = null;
            if (aOwnsHouse) {
                if (b.houseIdx !== null && houses[b.houseIdx] && houses[b.houseIdx].rentedBy === b.id) {
                    houses[b.houseIdx].rentedBy = null;
                }
                b.houseIdx = a.houseIdx;
                targetHome = houses[a.houseIdx];
            } else {
                if (a.houseIdx !== null && houses[a.houseIdx] && houses[a.houseIdx].rentedBy === a.id) {
                    houses[a.houseIdx].rentedBy = null;
                }
                a.houseIdx = b.houseIdx;
                targetHome = houses[b.houseIdx];
            }
            if (targetHome) {
                const homeCenter = centerOf(targetHome);
                a.target = homeCenter; a.targetRole = 'home'; b.target = homeCenter; b.targetRole = 'home';
              }
          }
        }
      }
    } socialConnections = newConnections;
  }

  function payoutChunkToOwner(shop, chunk = CFG.SHOP_PAYOUT_CHUNK){
    if(!shop || !shop.ownerId) return false;
    const owner = agents.find(a => a.id === shop.ownerId);
    if(!owner) return false;
    if((shop.cashbox || 0) < chunk) return false;
    shop.cashbox -= chunk;
    owner.money = (owner.money || 0) + chunk;
    toast(`Se acreditaron ${chunk} al dueño de ${shop.kind}. Caja restante: ${Math.floor(shop.cashbox)}.`);
    return true;
  }

  // ====== DIBUJO DE REMOTOS SUAVIZADO ======
  function renderRemotePlayers(){
    const now = performance.now();
    if (!window.gameState || !Array.isArray(window.gameState.players)) return;

    // Ingesta + delay adaptativo
    for (const p of window.gameState.players) {
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
      const id = p.id;

      const buf = (REMOTE.BUFFER[id] ||= []);
      buf.push({ x: p.x, y: p.y, t: now });
      if (buf.length > REMOTE.MAX_BUF) buf.shift();

      const st = (REMOTE.STATS[id] ||= { delay: REMOTE.BASE_DELAY, iat: [], lastTs: 0 });
      if (st.lastTs) {
        const iat = now - st.lastTs;
        st.iat.push(iat); if (st.iat.length > 20) st.iat.shift();
        const sorted = st.iat.slice().sort((a,b)=>a-b);
        const p80 = sorted.length ? sorted[Math.floor(sorted.length*0.8)-1] || sorted[sorted.length-1] : REMOTE.BASE_DELAY;
        st.delay = Math.min(REMOTE.DELAY_MAX, Math.max(REMOTE.BASE_DELAY, (p80||REMOTE.BASE_DELAY) + REMOTE.EXTRA_GUARD));
      }
      st.lastTs = now;
    }

    // Catmull–Rom
    function catmullRom(p0, p1, p2, p3, u){
      const u2 = u*u, u3 = u2*u;
      const a0 = -0.5, a1 = 1.5, a2 = -1.5, a3 = 0.5;
      const b0 = 1.0,  b1 = -2.5, b2 = 2.0,  b3 = -0.5;
      const c0 = -0.5, c1 = 0.0,  c2 = 0.5,  c3 = 0.0;
      const d0 = 0.0,  d1 = 1.0,  d2 = 0.0,  d3 = 0.0;
      const x = (a0*p0.x + a1*p1.x + a2*p2.x + a3*p3.x)*u3 +
                (b0*p0.x + b1*p1.x + b2*p2.x + b3*p3.x)*u2 +
                (c0*p0.x + c1*p1.x + c2*p2.x + c3*p3.x)*u  +
                (d0*p0.x + d1*p1.x + d2*p2.x + d3*p3.x);
      const y = (a0*p0.y + a1*p1.y + a2*p2.y + a3*p3.y)*u3 +
                (b0*p0.y + b1*p1.y + b2*p2.y + b3*p3.y)*u2 +
                (c0*p0.y + c1*p1.y + c2*p2.y + c3*p3.y)*u  +
                (d0*p0.y + d1*p1.y + d2*p2.y + d3*p3.y);
      return {x,y};
    }

    for (const p of window.gameState.players) {
      // Only render remote players, not the local player
      if (p.id === window.playerId) continue;
      const id  = p.id;
      const buf = REMOTE.BUFFER[id];
      if (!buf || buf.length === 0) continue;

      const st = REMOTE.STATS[id] || { delay: REMOTE.BASE_DELAY };
      const renderTime = now - st.delay;

      let idx = -1;
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i].t <= renderTime && renderTime <= buf[i+1].t) { idx = i; break; }
      }

      let target;
      if (idx >= 0) {
        const p1 = buf[idx], p2 = buf[idx+1];
        const p0 = buf[idx-1] || p1, p3 = buf[idx+2] || p2;
        const u  = (renderTime - p1.t) / Math.max(1, (p2.t - p1.t));
        target = catmullRom(p0, p1, p2, p3, Math.max(0, Math.min(1, u)));
      } else {
        const last = buf[buf.length - 1], prev = buf[buf.length - 2] || last;
        const denom = Math.max(1, (last.t - prev.t));
        const vx = (last.x - prev.x) / denom, vy = (last.y - prev.y) / denom;
        const dt = Math.max(0, renderTime - last.t);
        target = { x: last.x + vx * dt, y: last.y + vy * dt };
      }

      const s = (REMOTE.SMOOTH[id] ||= { x: target.x, y: target.y, vx:0, vy:0 });
      let dx = target.x - s.x, dy = target.y - s.y;
      const dist2 = dx*dx + dy*dy;
      if (dist2 > REMOTE.DEADZONE*REMOTE.DEADZONE) {
        const dt = 1/60;
        const k  = REMOTE.K;
        const ax = k*k*dx - 2*k*s.vx;
        const ay = k*k*dy - 2*k*s.vy;
        s.vx += ax * dt; s.vy += ay * dt;
        s.x  += s.vx * dt; s.y  += s.vy * dt;
      } else {
        s.x = target.x; s.y = target.y; s.vx = 0; s.vy = 0;
      }

  const pt = toScreen(s.x, s.y);
  const baseR = (p.state==='child'?CFG.R_CHILD:CFG.R_ADULT) * ZOOM;
  const r = baseR;
  // Solo imagen de avatar (sin círculo de fondo)
  try{
    const img = getAvatarImage(p.avatar);
    if(img && img.complete){
      ctx.save();
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r*0.95, 0, Math.PI*2); ctx.clip();
      const d = r*1.8; ctx.drawImage(img, pt.x - d/2, pt.y - d/2, d, d);
      ctx.restore();
    }
  }catch(e){}
  // Mostrar nombre siempre visible con tamaño fijo en pixeles, independiente del zoom
  ctx.font = `700 ${CFG.NAME_FONT_PX}px ui-monospace,monospace`;
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  // Escalar nombre de jugador remoto con el zoom; ocultar si muy pequeño
  const rpNamePx = CFG.NAME_FONT_PX * ZOOM;
  const rpNameOffset = Math.max(6, 10 * ZOOM);
  if (rpNamePx >= 6) {
    ctx.font = `700 ${rpNamePx}px ui-monospace,monospace`; ctx.fillStyle='#fff'; ctx.textAlign='center';
    ctx.fillText(`${p.name||p.code||'P'}`, pt.x, pt.y - (r + rpNameOffset));
  }
    }
  }

  let __lastTime = performance.now();
  function loop(){
    if(!STARTED){ requestAnimationFrame(loop); return; }
    const nowMs = performance.now();
    let dt = (nowMs - __lastTime) / 1000; __lastTime = nowMs; dt = Math.min(dt, 0.05);
    frameCount++;
  if(!window.__gamePaused){ updateSocialLogic(); }
  // Bloqueo por arriendo pendiente: detener actualizaciones de agentes hasta que pague
  const rentBlocked = (typeof window.__rentBlocked !== 'undefined') && window.__rentBlocked;
  if(rentBlocked){
    // Solo dibujar mundo y UI básica; saltar lógica avanzada
    try{ drawWorld(); }catch(_){ }
    requestAnimationFrame(loop); return;
  }
  // Procesar alquileres de casas (solo en modo local/offline para no duplicar con servidor)
  try{ if(!window.__gamePaused && typeof hasNet==='function' && !hasNet()) processRent(dt); }catch(_){ }
  // Seguimiento continuo del agente (si está activado) antes de dibujar el mundo
    try{
      if (FOLLOW_AGENT && typeof USER_ID !== 'undefined' && agents) {
        const me = agents.find(a => a && a.id === USER_ID);
        if (me) {
          const vw = canvas.width / ZOOM, vh = canvas.height / ZOOM;
          const wantX = Math.max(0, Math.min(me.x - vw / 2, Math.max(0, WORLD.w - vw)));
          const wantY = Math.max(0, Math.min(me.y - vh / 2, Math.max(0, WORLD.h - vh)));
          // Suavizado dependiente de dt (aprox. exponencial)
          const s = CAM_FOLLOW_SMOOTH;
          const alpha = 1 - Math.pow(1 - s, Math.max(1, 60*dt));
          cam.x += (wantX - cam.x) * alpha;
          cam.y += (wantY - cam.y) * alpha;
          clampCam();
        }
      }
    }catch(_){ }
  drawWorld();
  if(!window.__gamePaused){ drawSocialLines(); }

    // Dibujar efectos de monedas (después de dibujar el mundo para que queden sobre fábricas)
  try{ updateAndDrawWorkCoins(dt); }catch(_){ }

    // ======= Jugadores remotos con smoothing nuevo =======
  try{ if(!window.__gamePaused) renderRemotePlayers(); }catch(e){}

    const nowS = performance.now()/1000;

  if(!window.__gamePaused) for(const a of agents){
      a.cooldownSocial = Math.max(0, a.cooldownSocial - dt);
      if (a.employedAtShopId) {
        const myWorkplace = shops.find(s => s.id === a.employedAtShopId);
        if (myWorkplace) { a.target = centerOf(myWorkplace); a.targetRole = 'work_shop'; }
      }
  if (!a.forcedShopId && !a.workingUntil && !a.exploreUntil && !a.restUntil && !a.employedAtShopId && (!a.targetRole || a.targetRole==='idle') && nowS >= (a.nextWorkAt || 0)) {
  const myOwnedShops = shops.filter(s => s.ownerId === a.id);
        if (myOwnedShops.length > 0 && Math.random() < CFG.OWNER_MANAGE_VS_WORK_RATIO) {
          const shopToManage = myOwnedShops[(Math.random() * myOwnedShops.length) |  0];
          a.target = centerOf(shopToManage);
         
         
                  
         
         
          a.targetRole = 'manage_shop';
          a._shopTargetId = shopToManage.id;
               } else {
          const f = factories[(Math.random()*factories.length)|0];
          if (f) { a.goingToWork = true; a.workFactoryId = factories.indexOf(f); a.target = centerOf(f); a.targetRole = 'go_work'; }
        }
      }
  if(a.workingUntil && nowS>=a.workingUntil){
        a.workingUntil=null; a.target=null; a.targetRole='idle';
        a.exploreUntil = nowS + (CFG.WORK_EXPLORE_TIME||60);
        a.restUntil = null; a.nextWorkAt = a.exploreUntil + 5; // luego de explorar irá a casa
      }
    // Exploración -> hogar
    if(a.exploreUntil && nowS>=a.exploreUntil){
        a.exploreUntil=null;
        if(a.houseIdx!=null && houses[a.houseIdx]){ a.target=centerOf(houses[a.houseIdx]); a.targetRole='home'; a.restUntil = nowS + 8; }
    }
    // Descanso en casa completo -> habilitar nuevo turno de trabajo tras cooldown
    if(a.restUntil && nowS>=a.restUntil){ a.restUntil=null; a.nextWorkAt = nowS + (CFG.WORK_COOLDOWN||2); }

  if(!a.forcedShopId && !a.workingUntil && !a.goingToBank && !a.employedAtShopId && (!a.targetRole || a.targetRole==='idle' || a.targetRole==='home' || a.targetRole==='explore')) {
        if (!a.forcedShopId && Math.random() < CFG.VISIT_RATE) {
          // Sólo considerar negocios que ya tienen dueño (comprados). Las panaderías y otros tipos
          // que no estén comprados no deberían atraer visitas porque no existen físicamente.
          const liked = shops.filter(s => s.ownerId && a.likes.includes(s.like) && s.ownerId !== a.id);
          if(liked.length){



            let best=null, bestD=1e9;
            for(const s of liked){
              const d=Math.hypot(a.x-(s.x+s.w/2), a.y-(s.y+s.h/2));
              if(d<bestD && d<CFG.VISIT_RADIUS){ best=s; bestD=d; }
            }
            if(best){ a.target={x:best.x+best.w/2,y:best.y+best.h/2}; a.targetRole='shop'; a._shopTargetId = best.id; }
          }
          // Si sigue idle, asignar exploración del mapa
          if((!a.targetRole || a.targetRole==='idle' || a.targetRole==='home') && !a.target){
            const t = nextUnvisitedTarget();
            a.target = t; a.targetRole = 'explore';
          }
        }
      }
      if(a.targetRole==='shop' && a.target){
        const c=a.target;
        if(Math.hypot(a.x-c.x,a.y-c.y)<16){
          const s = shops.find(q=>q.id===a._shopTargetId);
          if(s){
            // Comprar sólo si pasó intervalo de compra y tiene dinero
            const okInterval = (nowS - (a.lastPurchaseAt||0)) >= (CFG.SHOP_PURCHASE_INTERVAL||300);
            if(okInterval){
              const price = clamp(s.price, CFG.PRICE_MIN, CFG.PRICE_MAX);
              if(a.money>=price){
                a.money-=price;
                const bonus = Math.round((s.buyCost || 0) * CFG.SHOP_PROFIT_FACTOR);
                let saleProfit = price + bonus; 
                if(s._managedBoostUntil && nowS < s._managedBoostUntil){ saleProfit = Math.round(saleProfit * (CFG.MANAGE_BOOST_MULT||1.2)); }
                s.cashbox = (s.cashbox || 0) + saleProfit; s._lastCashboxChange = performance.now();
                a.lastPurchaseAt = nowS;
              }
            }
          }
          a.target=null; a.targetRole='idle'; a._shopTargetId=null;
        }
      }
      if(a.targetRole==='manage_shop' && a.target){
        const c=a.target;
        if(Math.hypot(a.x-c.x,a.y-c.y)<16){
          const s = shops.find(q => q.id === a._shopTargetId);
          // Inicia fase de gestión cronometrada si no estaba
          if(!a.managingUntil){
            a.managingUntil = nowS + (CFG.MANAGE_DURATION||10);
            a.vx=0; a.vy=0; // quedarse quieto
            a._manageShopRef = s ? s.id : null;
            if(s){ s._beingManagedUntil = a.managingUntil; }
          }
          // Si ya terminó el tiempo de gestión, pagar y aplicar boost
          if(a.managingUntil && nowS >= a.managingUntil){
            const s2 = shops.find(q=>q.id===a._manageShopRef);
            if(s2 && s2.ownerId === a.id){
              const amount = Math.floor(s2.cashbox||0);
              if(amount>0){
                a.money = (a.money||0) + amount; s2.cashbox=0; s2._lastCashboxChange = performance.now();
                s2._managedBoostUntil = nowS + (CFG.MANAGE_BOOST_TIME||120);
                toast(`${a.code} cobró caja (+${amount}) y aplicó impulso.`);
                try{ window.saveProgress && window.saveProgress({ money: Math.floor(a.money), shops: shops.filter(sh=>sh.ownerId===a.id) }); }catch(_){ }
              } else {
                s2._managedBoostUntil = nowS + (CFG.MANAGE_BOOST_TIME||120);
                toast(`Impulso aplicado (caja vacía).`);
              }
            }
            a.managingUntil=null; a._manageShopRef=null; a._shopTargetId=null; a.target=null; a.targetRole='idle';
            a.nextWorkAt = nowS + CFG.WORK_COOLDOWN;
          }
        } else {
          // si se aleja antes de terminar, cancelar
          if(a.managingUntil && nowS < a.managingUntil && Math.hypot(a.x-c.x,a.y-c.y)>40){ a.managingUntil=null; a._manageShopRef=null; }
        }
      }
      
      let currentSpeed = a.speed;
      let onRoad = null;
      if (a.vehicle) {
        const vehicleData = VEHICLES[a.vehicle];
        if (vehicleData) { currentSpeed = vehicleData.speed; }
        onRoad = getCurrentRoad(a);
      }
      if (a.goingToWork && a.target && a.targetRole === 'go_work') {
        const c = a.target;
        if (Math.hypot(a.x - c.x, a.y - c.y) < 16) {
          a.goingToWork = false; a.workingUntil = nowS + CFG.WORK_DURATION; a.vx = 0; a.vy = 0; a.target = null; a.targetRole = 'work';
          a._lastWorkCoinSpawn = performance.now(); // para animaciones
        }
      }
      if(a.target){
        const t = a.target;
        let dx = t.x - a.x, dy = t.y - a.y;
        const dd = Math.hypot(dx, dy) || 1;
        const nx = dx / dd, ny = dy / dd;
        a.vx = nx * currentSpeed; a.vy = ny * currentSpeed;
        if (dd < CFG.EXPLORE_REACH_RADIUS) {
          // marcar sector visitado si era exploración
          if(a.targetRole === 'explore'){ markVisitedAt(a.x, a.y); a.target = null; a.targetRole = 'idle'; }
          else if (['work', 'work_shop', 'home', 'bank', 'shop', 'manage_shop'].includes(a.targetRole)) { a.target = null; a.targetRole = 'idle'; }
        }
      } else {
        const isWorkingInFactory = a.workingUntil && nowS < a.workingUntil;
        const isWorkingInShop = a.employedAtShopId;
        if (isWorkingInFactory || isWorkingInShop) {
          a.vx = 0; a.vy = 0;
        } else {
          const jit = 40;
          a.vx += rand(-jit, jit) * dt; a.vy += rand(-jit, jit) * dt;
          const spd = Math.hypot(a.vx, a.vy) || 1;
          const cap = currentSpeed;
          if (spd > cap) { a.vx = (a.vx/spd)*cap; a.vy = (a.vy/spd)*cap; }
        }
      }

      // Watchdog: si no está trabajando ni yendo al banco ni tiene target y pasó cooldown, enviar a trabajar de nuevo
  // Reinicio si desincroniza
  if(a.workingUntil && nowS - a.workingUntil > 5){ a.workingUntil=null; a.exploreUntil=null; a.restUntil=null; a.nextWorkAt=nowS; }

      // Generar moneda y sumar dinero en tiempo real cada segundo durante trabajo en fábrica
      if(a.targetRole==='work' && a.workingUntil && nowS < a.workingUntil){
        const fac = factories[a.workFactoryId|0];
        const nowPerf = performance.now();
        if(fac){
          if(!a._lastWorkCoinSpawn){ a._lastWorkCoinSpawn = nowPerf; }
          const intervalMs = (CFG.WORK_COIN_INTERVAL||1)*1000;
          while(nowPerf - a._lastWorkCoinSpawn >= intervalMs){
            a._lastWorkCoinSpawn += intervalMs;
            const c = centerOf(fac);
            spawnWorkCoin(c.x + rand(-10,10), c.y + rand(-8,8));
            // Pago distribuido: EARN_PER_SHIFT proporcional al progreso de 20s
            const perCoin = (CFG.EARN_PER_SHIFT || 20) / (CFG.WORK_DURATION || 20);
            a.money += perCoin;
            try{ if(a.id===USER_ID){ const mEl=document.getElementById('money'); if(mEl) mEl.textContent = Math.floor(a.money); } }catch(_){ }
          }
        }
      }
      a.x += a.vx * dt; a.y += a.vy * dt;
      if(a.x<4||a.x>WORLD.w-4){ a.vx*=-1; a.x=clamp(a.x,4,WORLD.w-4); }
      if(a.y<4||a.y>WORLD.h-4){ a.vy*=-1; a.y=clamp(a.y,4,WORLD.h-4); }

      const age = (yearsSince(a.bornEpoch)|0);
      if (a.state === 'paired' && a.cooldownSocial <= 0 && age > 22 && age < 45 && Math.random() < 0.00015) {
          const children = agents.filter(c => c.parents && c.parents.includes(a.id));
          if (children.length < 3) {
              const spouse = agents.find(s => s.id === a.spouseId);
              if (spouse) {
                  const home = a.houseIdx !== null ? houses[a.houseIdx] : null;
                  if (home && home.ownerId) {
                      const baby = makeAgent('child', { parents: [a.id, spouse.id], ageYears: 0 });
                      baby.x = home.x + home.w/2; baby.y = home.y + home.h/2; baby.houseIdx = a.houseIdx;
                      agents.push(baby); toast(`¡Ha nacido un bebé en la familia de ${a.code} y ${spouse.code}!`);
                      a.cooldownSocial = 120; spouse.cooldownSocial = 120;
                  }
              }
          }
      }

  const p=toScreen(a.x,a.y);
  const baseR = (a.state==='child'?CFG.R_CHILD:CFG.R_ADULT) * ZOOM;
    // Dibujo unificado de todos los agentes (locales y remotos ya sincronizados en agents[] si aplica)
    try{
      for(const ag of agents){
        const pt = toScreen(ag.x, ag.y);
  const baseR = (ag.state==='child'?CFG.R_CHILD:CFG.R_ADULT) * ZOOM;
  const r = baseR;
        let drew=false;
        try{
          if(ag.avatar){ const img=getAvatarImage(ag.avatar); if(img&&img.complete&&img.naturalWidth){ ctx.save(); ctx.beginPath(); ctx.arc(pt.x,pt.y,r*0.95,0,Math.PI*2); ctx.clip(); const d=r*1.8; ctx.drawImage(img, pt.x-d/2, pt.y-d/2, d, d); ctx.restore(); drew=true; } }
        }catch(_){ }
        if(!drew){
          const nameLow=(ag.name||ag.code||'').toLowerCase(); const femaleHints=['a','as','ia','ía']; const seemsF=(ag.gender==='F')||femaleHints.some(s=>nameLow.endsWith(s));
          ctx.beginPath(); ctx.arc(pt.x, pt.y, r*0.95, 0, Math.PI*2);
          ctx.fillStyle= seemsF? 'rgba(255,105,180,0.85)':'rgba(64,132,255,0.85)'; ctx.fill();
          ctx.lineWidth=2; ctx.strokeStyle=seemsF? 'rgba(255,182,210,0.9)':'rgba(120,180,255,0.9)'; ctx.stroke();
        }
        if (ag.justMarried && (performance.now() - ag.justMarried < 5000)){
          ctx.font=`700 ${Math.max(12, 18*ZOOM)}px system-ui,Segoe UI,Arial,emoji`; ctx.textAlign='center'; ctx.fillText('💕', pt.x, pt.y - 25*ZOOM);
        } else if (ag.justMarried) { ag.justMarried=null; }
  const ageYrs=(yearsSince(ag.bornEpoch)|0);
  // Etiqueta de nombre escala 1:1 con el zoom (y se oculta si es muy pequeña)
  const namePx = CFG.NAME_FONT_PX * ZOOM;
  const nameOffset = Math.max(6, 10 * ZOOM);
  if (namePx >= 6) {
    ctx.font = `700 ${namePx}px ui-monospace,monospace`; ctx.fillStyle='#fff'; ctx.textAlign='center';
    ctx.fillText(`${ag.name||ag.code}·${ageYrs}`, pt.x, pt.y - (r + nameOffset));
  }
      }
    }catch(_){ }
    }
    const total$=Math.round(agents.reduce((s,x)=>s+(x.money||0),0));
    const instCount = government.placed.length;
    try{
      const visibleShops = (window.gameState && Array.isArray(window.gameState.shops)) ? window.gameState.shops.length : shops.length;
      stats.textContent = `Pob: ${agents.length} | $ total: ${total$} | 🏛️ Fondo: ${Math.floor(government.funds)} | 🏪 ${visibleShops} | Instituciones: ${instCount}/25`;
    }catch(e){
      stats.textContent = `Pob: ${agents.length} | $ total: ${total$} | 🏛️ Fondo: ${Math.floor(government.funds)} | 🏪 ${shops.length} | Instituciones: ${instCount}/25`;
    }
    // Actualizar panel del banco en tiempo real con el jugador local
    try{
      if(typeof window.updateBankPanel === 'function'){
        const me = agents.find(a=>a.id===USER_ID);
        if(me){ window.updateBankPanel(me.money, me.code); }
        else { window.updateBankPanel(); }
      }
    }catch(_){ }
  drawMiniMap();
    // Enviar mi posición al servidor cada ~120ms
    try{
      if(hasNet() && window.playerId){
        const t = performance.now();
        if(t - __lastNetSend > 120){
          const me = agents.find(a=>a.id===USER_ID);
          if(me){
            const currentMoney = Math.floor(me.money || 0);
            // Solo enviar actualización si el estado ha cambiado para no interferir
            // con la lógica de inactividad del servidor.
            if (me.x !== __lastSentState.x || me.y !== __lastSentState.y || currentMoney !== __lastSentState.money) {
              window.sockApi?.update({ x: me.x, y: me.y, money: currentMoney });
              __lastSentState.x = me.x;
              __lastSentState.y = me.y;
              __lastSentState.money = currentMoney;
            }
          }
          __lastNetSend = t;
        }
      }
    }catch(e){}
    requestAnimationFrame(loop);
  }

  function bankReport(){
    const lines = [];
    const player = agents.find(a => a.id === USER_ID);
    if (player){
      const playerDisplay = player.name || player.fullName || player.code || player.id;
      lines.push(`Jugador: ${playerDisplay} (${player.code || player.id}): $${Math.floor(player.money)}`);
    }
    const otherAgents = agents.filter(a => a.id !== USER_ID && a.state !== 'child');
    if (otherAgents.length > 0) {
        if (player) lines.push('---');
    // Mostrar nombre completo si está disponible, si no mostrar código
    const agentLines = otherAgents.map(a => {
      const display = a.name || a.fullName || a.code || a.id;
      return `${display}: $${Math.floor(a.money)}`;
    });
        lines.push(...agentLines.sort());
    }
    return lines.join('\n') || 'Sin fondos por ahora.';
  }
  function fullDocument(){
    // Construye HTML del reporte con tablas y métricas amigables
    const total$ = Math.round(agents.reduce((s,x)=>s+(x.money||0),0));
    const me = agents.find(a => a.id === USER_ID) || null;
    const meName = me ? (me.name || me.fullName || me.code || me.id) : '—';
    const meCode = me ? (me.code || me.id) : '—';

    // Origen de datos de usuarios conectados
    let users = [];
    if (window.gameState && Array.isArray(window.gameState.players)) {
      users = window.gameState.players.map(p => {
        const local = agents.find(a => (p.id && a.id === p.id) || (p.code && a.code === p.code));
        return local ? Object.assign({}, p, { _localName: local.name, _localCode: local.code || local.id }) : p;
      });
    } else {
      users = agents;
    }
    const filtered = users.filter(u => !u.isBot && (!u.state || u.state !== 'child'));

    // Negocios propios del jugador
    const myId = me ? me.id : null;
    const myShops = (window.gameState?.shops || shops || []).filter(s => myId && s && s.ownerId === myId);
    const myShopsCount = myShops.length;

    // Tabla: negocios propios
    const shopRows = myShops.map(s => {
      const kind = s.kind || s.k || 'negocio';
      // buscar metadata del tipo para precio y costo de compra
      const meta = (Array.isArray(SHOP_TYPES) ? SHOP_TYPES.find(t => t.k === kind) : null) || {};
      const label = meta.label || kind;
      const price = (typeof meta.price === 'number' ? meta.price : (s.price || '—'));
      const buyCost = (typeof meta.buyCost === 'number' ? meta.buyCost : (s.buyCost || '—'));
      return `<tr><td>${label}</td><td style="text-align:right">${price}</td><td style="text-align:right">${buyCost}</td></tr>`;
    }).join('');
    const shopsTable = `
      <table style="width:100%; border-collapse:collapse; margin:6px 0;">
        <thead>
          <tr>
            <th style="text-align:left; border-bottom:1px solid #ddd; padding:4px 2px;">Negocio</th>
            <th style="text-align:right; border-bottom:1px solid #ddd; padding:4px 2px;">Precio</th>
            <th style="text-align:right; border-bottom:1px solid #ddd; padding:4px 2px;">Costo compra</th>
          </tr>
        </thead>
        <tbody>${shopRows || `<tr><td colspan="3" style="padding:6px 2px; color:#6b7280;">No has comprado negocios todavía.</td></tr>`}</tbody>
      </table>`;

  // Nota: el documento del agente NO incluye instituciones del gobierno

    // Tabla: finanzas por agente
    const finRows = agents
      .filter(a => a && a.state !== 'child')
      .map(a => {
        const nm = a.name || a.fullName || a.code || a.id;
        const money = Math.floor(a.money || 0);
        return `<tr><td>${nm}</td><td style="text-align:right">${money}</td></tr>`;
      })
      .sort((ra, rb) => {
        // sort by money desc parsing inner text between tags; fallback no-op
        const ma = parseInt((ra.match(/>(\-?\d+)</)||[])[1]||'0',10);
        const mb = parseInt((rb.match(/>(\-?\d+)</)||[])[1]||'0',10);
        return mb - ma;
      })
      .join('');
    const finTable = `
      <table style="width:100%; border-collapse:collapse; margin:6px 0;">
        <thead>
          <tr>
            <th style="text-align:left; border-bottom:1px solid #ddd; padding:4px 2px;">Agente</th>
            <th style="text-align:right; border-bottom:1px solid #ddd; padding:4px 2px;">Créditos</th>
          </tr>
        </thead>
        <tbody>${finRows || `<tr><td colspan="2" style="padding:6px 2px; color:#6b7280;">Sin fondos por ahora.</td></tr>`}</tbody>
      </table>`;

    // Lista de usuarios conectados (ligera)
    const userList = filtered.map(u => {
      let displayName = u._localName || u.name || u.fullName || u.displayName || '';
      const codeRef = (u._localCode || u.code || u.id || '');
      if(!displayName || displayName.trim().length <= 2) displayName = codeRef || 'Usuario';
      return `<li>${displayName}${codeRef ? ` <span style="color:#6b7280">(${codeRef})</span>` : ''}</li>`;
    }).join('');

    // Resumen superior
    const summary = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
        <div><strong>Jugador:</strong> ${meName} <span style="color:#6b7280">(${meCode})</span></div>
        <div style="text-align:right"><strong>Total créditos:</strong> ${total$}</div>
        <div><strong>Mis negocios comprados:</strong> ${myShopsCount}</div>
        <div style="text-align:right"><strong>Fondo Gobierno:</strong> ${Math.floor(government.funds)}</div>
        <div><strong>Negocios en el mundo:</strong> ${(window.gameState?.shops||shops||[]).length}</div>
        <div style="text-align:right"><strong>Instituciones:</strong> ${(government.placed||[]).length}</div>
      </div>`;

    return `
      <div>
        <h2 style="margin:0 0 6px 0; font-size:22px;">Documento del Agente</h2>
        ${summary}
        <h3 style="margin:8px 0 4px; font-size:18px;">Mis Negocios</h3>
        ${shopsTable}
        <h3 style="margin:8px 0 4px; font-size:18px;">Usuarios en el mundo (${filtered.length})</h3>
        <ul style="margin:4px 0 10px 18px;">${userList || '<li>No hay usuarios conectados.</li>'}</ul>
        <h3 style="margin:8px 0 4px; font-size:18px;">Finanzas por Agente</h3>
        ${finTable}
      </div>
    `;
  }

  function fullGovDocument(){
    // Documento del Gobierno: saldo, edificaciones (instituciones) e impuestos
    const funds = Math.floor(government.funds || 0);
    const inst = Array.isArray(government.placed) ? government.placed : [];
    const n = inst.length;
    const effRate = Math.min(CFG.WEALTH_TAX_MAX, CFG.WEALTH_TAX_BASE + n*CFG.INSTITUTION_TAX_PER);
    const taxInfo = {
      base: CFG.WEALTH_TAX_BASE,
      perInst: CFG.INSTITUTION_TAX_PER,
      cap: CFG.WEALTH_TAX_MAX,
      effective: effRate
    };

    const instRows = inst.map(g => {
      const kind = g.kind || g.k || 'inst';
      const label = (typeof kind === 'string' ? kind.replace(/_/g,' ') : 'Institución');
      const cost = g.cost != null ? g.cost : (CFG && CFG[`COST_${String(kind).toUpperCase()}`]) || '—';
      return `<tr><td>${label}</td><td style="text-align:right">${cost}</td><td style="text-align:right">${Math.round(g.x||0)},${Math.round(g.y||0)}</td></tr>`;
    }).join('');
    const instTable = `
      <table style="width:100%; border-collapse:collapse; margin:6px 0;">
        <thead>
          <tr>
            <th style="text-align:left; border-bottom:1px solid #ddd; padding:4px 2px;">Institución</th>
            <th style="text-align:right; border-bottom:1px solid #ddd; padding:4px 2px;">Costo</th>
            <th style="text-align:right; border-bottom:1px solid #ddd; padding:4px 2px;">Ubicación</th>
          </tr>
        </thead>
        <tbody>${instRows || `<tr><td colspan="3" style="padding:6px 2px; color:#6b7280;">Sin instituciones aún.</td></tr>`}</tbody>
      </table>`;

    const taxTable = `
      <table style="width:100%; border-collapse:collapse; margin:6px 0;">
        <tbody>
          <tr><td>Base</td><td style="text-align:right">${(taxInfo.base*100).toFixed(1)}%</td></tr>
          <tr><td>Por institución</td><td style="text-align:right">${(taxInfo.perInst*100).toFixed(1)}%</td></tr>
          <tr><td>Tope</td><td style="text-align:right">${(taxInfo.cap*100).toFixed(1)}%</td></tr>
          <tr><td>Efectiva (${n} inst.)</td><td style="text-align:right">${(taxInfo.effective*100).toFixed(1)}%</td></tr>
        </tbody>
      </table>`;

    return `
      <div>
        <h2 style="margin:0 0 6px 0; font-size:22px;">Documento del Gobierno</h2>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
          <div><strong>Saldo del Gobierno:</strong> ${funds}</div>
          <div style="text-align:right"><strong>Instituciones:</strong> ${n}/25</div>
        </div>
        <h3 style="margin:8px 0 4px; font-size:18px;">Edificaciones</h3>
        ${instTable}
        <h3 style="margin:8px 0 4px; font-size:18px;">Impuestos</h3>
        ${taxTable}
      </div>
    `;
  }
  function generateMarriedList() {
      const lines = [];
      const processed = new Set();
      const couples = agents.filter(a => a.state === 'paired');
      for (const p1 of couples) {
          if (processed.has(p1.id)) continue;
          const p2 = agents.find(a => a.id === p1.spouseId);
          if (!p2) continue;
          lines.push(`Familia: ${p1.code} ❤ ${p2.code}`);
          processed.add(p1.id); processed.add(p2.id);
          const children = agents.filter(c => c.parents && c.parents.includes(p1.id));
          if (children.length > 0) {
              for (const child of children) {
                  const age = (yearsSince(child.bornEpoch)|0);
                  lines.push(`  - ${child.code} (${age} años)`);
              }
          } else { lines.push(`  (Sin hijos por ahora)`); }
          lines.push('');
      }
      return lines.length > 0 ? lines.join('\n') : "No hay familias casadas todavía.";
  }

  function automaticRoadConstruction() { /* lógica opcional */ }

  // Modales para Documento y Casados (pausan el juego)
  function pauseGame(){ try{ window.__gamePaused = true; }catch(_){} }
  function resumeGame(){ try{ window.__gamePaused = false; }catch(_){} }
  // Hook en loop para pausar render/lógica
  const __origUpdateSocialLogic = updateSocialLogic;
  function isPaused(){ return !!window.__gamePaused; }
  updateSocialLogic = function(){ if(isPaused()) return; return __origUpdateSocialLogic(); };

  const docModal = document.getElementById('docModal');
  const marriedModal = document.getElementById('marriedModal');
  const btnDocClose = document.getElementById('btnDocClose');
  const btnMarriedClose = document.getElementById('btnMarriedClose');
  const docBodyModal = document.getElementById('docBodyModal');
  const docTitle = document.getElementById('docTitle');
  const marriedListModal = document.getElementById('marriedListModal');

  // Documento del Agente (rojo en la imagen)
  if(btnShowAgentDoc) btnShowAgentDoc.onclick = ()=>{
    pauseGame();
    if(docTitle) docTitle.textContent = '📄 Documento del Agente';
    if(!window.__docInterval){ window.__docInterval = setInterval(()=>{ docBodyModal.innerHTML = fullDocument(); }, 1000); }
    docBodyModal.innerHTML = fullDocument();
    docModal.style.display = 'flex';
  };
  // Documento del Gobierno (amarillo en la imagen)
  if(btnShowGovDoc) btnShowGovDoc.onclick = ()=>{
    pauseGame();
    if(docTitle) docTitle.textContent = '📑 Documento del Gobierno';
    if(!window.__docInterval){ window.__docInterval = setInterval(()=>{ docBodyModal.innerHTML = fullGovDocument(); }, 1000); }
    // Reutilizamos el mismo intervalo pero con contenido de gobierno
    clearInterval(window.__docInterval); window.__docInterval = setInterval(()=>{ docBodyModal.innerHTML = fullGovDocument(); }, 1000);
    docBodyModal.innerHTML = fullGovDocument();
    docModal.style.display = 'flex';
  };
  btnShowMarried.onclick = ()=>{
    pauseGame();
    marriedListModal.textContent = generateMarriedList();
    marriedModal.style.display = 'flex';
  };
  btnDocClose && (btnDocClose.onclick = ()=>{
    docModal.style.display = 'none';
    if(window.__docInterval){ clearInterval(window.__docInterval); window.__docInterval = null; }
    resumeGame();
  });
  btnMarriedClose && (btnMarriedClose.onclick = ()=>{
    marriedModal.style.display = 'none';
    resumeGame();
  });

  // Gobierno: abrir vía edificio en el mapa (no botón)
  // openGovPanel(target) posiciona el panel sobre el edificio (target en coords del mundo)
  function openGovPanel(target){
    if(!target) { govDock.style.display = 'flex'; populateGovSelect(); return; }
    try{
      const screenPos = toScreen(target.x, target.y);
      const dockW = Math.min(window.innerWidth * 0.9, govDock.offsetWidth || 340);
      const dockH = Math.min(window.innerHeight * 0.8, govDock.offsetHeight || 220);
      // centrar sobre el edificio y desplazar hacia arriba para que quede encima
      let left = screenPos.x + (target.w * ZOOM)/2 - dockW/2;
      let top = screenPos.y - dockH - 10; // 10px de espacio
      // asegurarse de que quede dentro de la ventana
      left = Math.max(6, Math.min(left, window.innerWidth - dockW - 6));
      top = Math.max(6, Math.min(top, window.innerHeight - dockH - 6));
      govDock.style.position = 'fixed';
      govDock.style.left = `${left}px`;
      govDock.style.top = `${top}px`;
      govDock.style.width = `${dockW}px`;
      govDock.style.display = 'flex';
      populateGovSelect();
    }catch(e){ govDock.style.display = 'flex'; populateGovSelect(); }
  }
  function closeGovPanel(){ govDock.style.display = 'none'; }
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeGovPanel(); });
  document.addEventListener('pointerdown', (e)=>{
    try{
      if(govDock.style.display !== 'flex') return;
      const gd = govDock.getBoundingClientRect();
      if(e.clientX < gd.left || e.clientX > gd.right || e.clientY < gd.top || e.clientY > gd.bottom){ closeGovPanel(); }
    }catch(e){}
  }, {passive:true});
  // Handlers duplicados eliminados (se usan los addEventListener definidos arriba para uiShowBtn/uiHideBtn)
  // Botón de depósito eliminado: el saldo se refleja en tiempo real en el panel del banco.

  function setVisibleWorldUI(on){
  // No forzar mostrar formulario aquí; el flujo de login controla su visibilidad
  // $("#formBar").style.display = on ? 'none' : 'block';
    canvas.style.display = on ? 'block':'none';
    uiDock.style.display = on ? 'flex':'none';
  // Mostrar la botonera siempre que el mundo esté activo (independiente del UI)
  // topBar removido: botones Documento/Casados viven dentro del UI
  // Asegurar que el UI no arrastre a la botonera
  try{ if(on){ uiDock.classList.remove('collapsed-left'); } }catch(e){}
    // Controles de zoom eliminados
    try{
      const collapsed = document.getElementById('uiDock')?.classList.contains('collapsed-left');
      // Minimap siempre visible (debajo del UI por z-index)
      document.getElementById('mini').style.display = on ? 'block' : 'none';
  // Iconos gestionados por CSS; no cambiar texto
    }catch(_){ mini.style.display = on ? 'block':'none'; }
  show($("#uiShowBtn"),false);
    docDock.style.display = 'none'; govDock.style.display = 'none';
  }

  function startWorldWithUser({name,gender,age,likes,usd}){
  // Al crear persona, ocultar el formulario y mostrar la UI del mundo
  try{ $("#formBar").style.display='none'; }catch(e){}
    setVisibleWorldUI(true); 
    STARTED=true; 
    setWorldSize(); 
    fitCanvas(); 
    regenInfrastructure(false);
  // Reubicar edificaciones iniciales a parches de arena si fuera necesario
  try{ relocateInitialBuildingsToSand(); }catch(e){ console.warn('relocateInitialBuildingsToSand error', e); }
  // Mantener las panaderías tal como vienen (no eliminar al iniciar)
    populateGovSelect(); // ← AÑADIR ESTA LÍNEA
    
  const addCredits = Math.max(0, parseInt(usd||'0',10))*100;
  // Si hay progreso guardado (login), usar ese saldo en vez de reiniciar a 400
  const saved = (window.__progress || {});
  let startMoney = (typeof saved.money === 'number') ? Math.floor(saved.money) : (400 + addCredits);
  // Si hay perfil guardado, preferirlo para no re-seleccionar
  try{
    if(saved && saved.name){ name = saved.name; }
    if(saved && Array.isArray(saved.likes) && saved.likes.length){ likes = saved.likes.slice(); }
    if(saved && saved.gender){ gender = saved.gender; }
    if(saved && typeof saved.age === 'number'){ age = saved.age; }
  }catch(e){}
  // Determinar avatar elegido (localStorage > progreso guardado > preview > por defecto)
  let chosenAvatar = null;
  try{
    const pick = window.__selectedAvatarCurrent || localStorage.getItem('selectedAvatar') || (window.__progress && window.__progress.avatar) || (fGenderPreview && fGenderPreview.src) || '/assets/avatar1.png';
    chosenAvatar = (typeof pick === 'string' && pick.length) ? pick : '/assets/avatar1.png';
  }catch(e){ chosenAvatar = '/assets/avatar1.png'; }
  const user=makeAgent('adult',{name, gender, ageYears:age, likes, startMoney: startMoney, avatar: chosenAvatar});
  // Restaurar posición y temporizadores si existen en progreso
  try{
    if(saved.world && typeof saved.world==='object'){
      const w = saved.world;
      if(Number.isFinite(w.x) && Number.isFinite(w.y)){ user.x = w.x; user.y = w.y; }
      if(typeof w.goingToWork==='boolean') user.goingToWork = w.goingToWork;
      if(Number.isFinite(w.workFactoryId)) user.workFactoryId = w.workFactoryId;
      if(typeof w.targetRole==='string') user.targetRole = w.targetRole;
      if(w.target && Number.isFinite(w.target.x) && Number.isFinite(w.target.y)) user.target = { x:w.target.x, y:w.target.y };
      const nowS0 = performance.now()/1000;
      // Guardado periódico de estado del jugador (posición + temporizadores restantes)
      try{
        window.__lastWorldSaveAt = window.__lastWorldSaveAt || 0;
        if(nowS - window.__lastWorldSaveAt > 2){
          window.__lastWorldSaveAt = nowS;
          const me = agents && (typeof USER_ID!=='undefined' ? agents.find(a=>a.id===USER_ID) : null);
          if(me){
            const world = { x: Math.floor(me.x||0), y: Math.floor(me.y||0), goingToWork: !!me.goingToWork, workFactoryId: (typeof me.workFactoryId==='number'? me.workFactoryId : null), targetRole: me.targetRole || null };
            if(me.target && typeof me.target.x==='number' && typeof me.target.y==='number') world.target = { x: Math.floor(me.target.x), y: Math.floor(me.target.y) };
            // Convertir tiempos absolutos a restantes
            const left = (t)=> (typeof t==='number' && t>nowS) ? Math.floor(t - nowS) : 0;
            world.workingLeft = left(me.workingUntil);
            world.exploreLeft = left(me.exploreUntil);
            world.restLeft = left(me.restUntil);
            world.cooldownLeft = left(me.nextWorkAt);
            window.saveProgress && window.saveProgress({ world });
          }
        }
      }catch(_){ }
      if(Number.isFinite(w.workingLeft) && w.workingLeft>0){ user.workingUntil = nowS0 + w.workingLeft; }
      if(Number.isFinite(w.exploreLeft) && w.exploreLeft>0){ user.exploreUntil = nowS0 + w.exploreLeft; }
      if(Number.isFinite(w.restLeft) && w.restLeft>0){ user.restUntil = nowS0 + w.restLeft; }
      if(Number.isFinite(w.cooldownLeft) && w.cooldownLeft>0){ user.nextWorkAt = nowS0 + w.cooldownLeft; }
    }
  }catch(_){ }
  // Restaurar casa rentada previa si existe en progreso
  try{
    if(typeof saved.rentedHouseIdx === 'number' && houses[saved.rentedHouseIdx]){
      const hRest = houses[saved.rentedHouseIdx];
      if(!hRest.ownerId && (!hRest.rentedBy || hRest.rentedBy === user.id)){
        hRest.rentedBy = user.id; user.houseIdx = saved.rentedHouseIdx;
      }
    }
  }catch(_){ }
  // Restaurar marcador e inicial de casa rentada persistente
  try{
    if(saved.rentalHouse && typeof saved.rentalHouse==='object'){
      const rh = saved.rentalHouse;
      if(typeof user.houseIdx==='number' && houses[user.houseIdx]){
        const h=houses[user.houseIdx];
        if(rh.initial){ h._markerInitial = rh.initial; }
      }
    }
  }catch(_){ }
  // Asignar casa en arriendo inicial si no posee (nueva sesión sin registro previo)
  try{ ensurePlayerHasHouse(user); }catch(e){}
  if(user.houseIdx == null){ toast('Debes arrendar una casa para vivir.'); }
  // Colocar al jugador en el centro de su casa solo si no había posición persistida
  try{ if((!saved.world || !Number.isFinite(saved.world.x) || !Number.isFinite(saved.world.y)) && typeof user.houseIdx==='number' && houses[user.houseIdx]){ const h=houses[user.houseIdx]; user.x = h.x + h.w/2; user.y = h.y + h.h/2; } }catch(_){ }
  // Restaurar fondos de gobierno al UI si venían en progreso
  try{ if(saved && typeof saved.governmentFunds==='number'){ if(window.government) window.government.funds = saved.governmentFunds; const el=document.getElementById('govFunds'); if(el) el.textContent = `Fondo: ${Math.floor(saved.governmentFunds)}`; } }catch(_){ }
  // Solo forzar ir a trabajar si no había estado previo
  try{
    const hadState = !!(saved.world && (Number.isFinite(saved.world.x)||saved.world.goingToWork||saved.world.workingLeft||saved.world.exploreLeft||saved.world.restLeft||saved.world.cooldownLeft));
    if(!hadState && factories && factories.length){
      let bestF=null, bestD=1e12; const ux=user.x, uy=user.y;
      for(const f of factories){ const c=centerOf(f); const d=Math.hypot(ux-c.x, uy-c.y); if(d<bestD){ bestD=d; bestF=f; } }
      if(bestF){
        user.goingToWork = true;
        user.workFactoryId = factories.indexOf(bestF);
        user.target = centerOf(bestF);
        user.targetRole = 'go_work';
        user.nextWorkAt = 0;
      }
    }
  }catch(_){ }
  // Programar ventana de arriendo tras 3 segundos y bloquear juego hasta pagar
  try{
  const alreadyPaid = !!(window.__progress && window.__progress.initialRentPaid);
    window.__rentBlocked = !alreadyPaid; // bloquear solo si no ha pagado antes
    if(window.__rentBlockTimeout) clearTimeout(window.__rentBlockTimeout);
  if(alreadyPaid || window.__skipInitialRentPrompt){
      // Para usuarios que regresan, asegurar marcador en su casa asignada
      try{
        if(typeof user.houseIdx==='number' && houses[user.houseIdx]){
          const h=houses[user.houseIdx];
          if(!h._markerInitial){
            const baseInitial = (user.name||user.code||'U').trim().charAt(0).toUpperCase() || 'U';
            window.__houseInitialCounts = window.__houseInitialCounts || {};
            const count = (window.__houseInitialCounts[baseInitial]||0)+1; window.__houseInitialCounts[baseInitial]=count;
            h._markerInitial = baseInitial + (count>1?count:'');
            try{ window.__progress = Object.assign({}, window.__progress||{}, { rentalHouse: { x:h.x,y:h.y,w:h.w,h:h.h, initial:h._markerInitial } }); window.saveProgress && window.saveProgress({ rentalHouse: window.__progress.rentalHouse }); }catch(_){ }
          }
        }
      }catch(_){ }
      /* no mostrar prompt */
  }
  else if(!window.__skipInitialRentPrompt) window.__rentBlockTimeout = setTimeout(()=>{
      try{
        const existing = document.getElementById('rentPrompt'); if(existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id='rentOverlay';
        overlay.style.position='fixed'; overlay.style.left=0; overlay.style.top=0; overlay.style.width='100%'; overlay.style.height='100%';
        overlay.style.background='rgba(0,0,0,0.55)'; overlay.style.backdropFilter='blur(3px)'; overlay.style.zIndex=9998;
        const rentDiv = document.createElement('div');
        rentDiv.id = 'rentPrompt';
        rentDiv.style.position='fixed'; rentDiv.style.zIndex=9999; rentDiv.style.top='50%'; rentDiv.style.left='50%'; rentDiv.style.transform='translate(-50%, -50%)';
  rentDiv.style.background='linear-gradient(160deg,#20252b,#16191d)'; rentDiv.style.color='#fff'; rentDiv.style.padding='22px 24px'; rentDiv.style.border='1px solid #3a4451'; rentDiv.style.borderRadius='10px'; rentDiv.style.font='14px ui-monospace,monospace'; rentDiv.style.width='320px'; rentDiv.style.boxShadow='none';
        const title = document.createElement('div'); title.textContent='Arriendo inicial requerido'; title.style.fontSize='16px'; title.style.fontWeight='700'; title.style.marginBottom='10px';
        const msg = document.createElement('div'); msg.textContent = 'Para continuar debes pagar 50 créditos de arriendo de tu vivienda asignada.'; msg.style.marginBottom='14px'; msg.style.lineHeight='1.35';
        const payBtn = document.createElement('button'); payBtn.textContent='Pagar arriendo (50)'; payBtn.style.background='#41d77c'; payBtn.style.color='#06210f'; payBtn.style.fontWeight='700'; payBtn.style.padding='10px 14px'; payBtn.style.border='none'; payBtn.style.cursor='pointer'; payBtn.style.borderRadius='6px'; payBtn.style.fontFamily='ui-monospace,monospace'; payBtn.style.fontSize='14px'; payBtn.style.width='100%';
        const warn = document.createElement('div'); warn.textContent='El mundo está pausado hasta que pagues.'; warn.style.fontSize='11px'; warn.style.opacity='0.75'; warn.style.marginTop='10px'; warn.style.textAlign='center';
        payBtn.onclick = ()=>{
          try{
            const rentCost = 50;
            if(user.money >= rentCost){
              user.money -= rentCost; toast('Arriendo inicial pagado: -50');
              try{ government.funds = (government.funds||0)+rentCost; if(!govFundsEl) govFundsEl=document.getElementById('govFunds'); if(govFundsEl) govFundsEl.textContent = `Fondo: ${Math.floor(government.funds)}`; }catch(_){ }
              // Guardar bandera de pago inicial en progreso persistente
              try{
                window.__progress = Object.assign({}, window.__progress||{}, { initialRentPaid: true, money: Math.floor(user.money), rentedHouseIdx: user.houseIdx });
                window.saveProgress && window.saveProgress({ initialRentPaid: true, money: Math.floor(user.money), rentedHouseIdx: user.houseIdx });
              }catch(_){ }
              window.__rentBlocked = false;
              // Enfocar cámara sobre la casa del usuario y aplicar zoom cercano temporal
              try{
                if(typeof user.houseIdx === 'number' && houses[user.houseIdx]){
                  const h = houses[user.houseIdx];
                  // Crear identificador único para la casa arrendada
                  const baseInitial = (user.name||user.code||'U').trim().charAt(0).toUpperCase() || 'U';
                  window.__houseInitialCounts = window.__houseInitialCounts || {};
                  const count = (window.__houseInitialCounts[baseInitial]||0)+1; window.__houseInitialCounts[baseInitial]=count;
                  h._markerInitial = baseInitial + (count>1?count:'');
                  h._markerAssignedAt = performance.now();
                    try{ window.__progress = Object.assign({}, window.__progress||{}, { rentalHouse: { x:h.x,y:h.y,w:h.w,h:h.h, initial:h._markerInitial } }); window.saveProgress && window.saveProgress({ rentalHouse: window.__progress.rentalHouse }); }catch(_){ }
                  // Ajustar zoom y cámara
                  const targetZoom = Math.min(4, Math.max(ZOOM, 3));
                  ZOOM = targetZoom;
                  const cx = h.x + h.w/2, cy = h.y + h.h/2;
                  cam.x = Math.max(0, cx - (canvas.width/ZOOM)/2);
                  cam.y = Math.max(0, cy - (canvas.height/ZOOM)/2);
                  clampCam();
                  // Bandera para animación breve si se quiere
                  h._highlightUntil = performance.now() + 6000;
                }
              }catch(e){ console.warn('focus house error', e); }
              overlay.remove(); rentDiv.remove();
            } else {
              toast('Saldo insuficiente. Reúne 50 créditos.');
            }
          }catch(_){ }
        };
        rentDiv.appendChild(title); rentDiv.appendChild(msg); rentDiv.appendChild(payBtn); rentDiv.appendChild(warn);
        document.body.appendChild(overlay); document.body.appendChild(rentDiv);
      }catch(_){ window.__rentBlocked=false; }
  }, 3000);
  }catch(_){ }
  // Restaurar vehículo comprado previamente (y velocidad) antes de insertar al array para que se aplique de inmediato
  try{
    const savedVehicle = (saved && saved.vehicle) || (window.__progress && window.__progress.vehicle);
    if(savedVehicle){
      user.vehicle = savedVehicle;
      if(VEHICLES && VEHICLES[savedVehicle]){
        user.speed = VEHICLES[savedVehicle].speed;
      }
    }
  }catch(_){ }
  // Registrar al jugador local en la simulación y fijar su ID
  try{
    agents.push(user);
    USER_ID = user.id;
    // También sincronizar el id local usado por el render de remotos
    window.playerId = user.id;
  try{ if(typeof user.money==='number'){ window.__progress = Object.assign({}, window.__progress||{}, { money: Math.floor(user.money) }); } }catch(_){ }
  }catch(e){}
  // Reflejar también banco (si se usa en UI) como propiedad del agente para cálculos locales
  if(typeof saved.bank === 'number') try{ user.bank = Math.max(0, Math.floor(saved.bank)); }catch(e){}
  // Guardar inmediatamente el perfil elegido para futuras sesiones
  try{
  const patch = { name: user.name, avatar: user.avatar, likes: (user.likes||[]).slice(0,5), gender: user.gender, age: age };
  try{ if(fGender && (!fGender.value || !['M','F'].includes(fGender.value)) && ['M','F'].includes(user.gender)){ fGender.value = user.gender; } }catch(_){ }
    // Si faltan país/correo/teléfono en el progreso, intentar tomarlos del modal de autenticación
    try{
      const authCountry = document.getElementById('authCountry');
      const authEmail = document.getElementById('authEmail');
      const authPhone = document.getElementById('authPhone');
      if(authCountry && authCountry.value && !(window.__progress && 'country' in window.__progress)) patch.country = authCountry.value;
      if(authEmail && authEmail.value && !(window.__progress && 'email' in window.__progress)) patch.email = authEmail.value;
      if(authPhone && authPhone.value && authPhone.value.trim().length && !(window.__progress && 'phone' in window.__progress)) patch.phone = authPhone.value;
    }catch(_){ }
    window.__progress = Object.assign({}, window.__progress||{}, patch);
    window.saveProgress && window.saveProgress(patch);
  }catch(e){}
  try{ const _selectedAvatarAtStart = chosenAvatar; window.sockApi?.createPlayer({ code: user.code, gender: user.gender, avatar: user.avatar, startMoney: Math.floor(startMoney) }, ()=>{
      // Tras crear jugador en el servidor, si hay progreso, restaurar ítems colocados
      try{
    const prog = (window.__progress||{});
        if(prog && (Array.isArray(prog.shops) || Array.isArray(prog.houses))){
          window.sock?.emit('restoreItems', { shops: prog.shops||[], houses: prog.houses||[] }, ()=>{});
        }
        // Restaurar vehículo actual y lista de vehículos adquiridos
        try{
          if(prog && prog.vehicle){
            user.vehicle = prog.vehicle;
            try{ if(VEHICLES && VEHICLES[prog.vehicle]) user.speed = VEHICLES[prog.vehicle].speed; }catch(_){ }
            window.sockApi?.update({ vehicle: prog.vehicle });
          }
          if(prog && Array.isArray(prog.vehicles)){ window.__progress.vehicles = prog.vehicles.slice(); }
          // Aplicar perfil guardado al agente si aún no está
          if(prog && prog.name){ user.name = prog.name; }
          if(prog && Array.isArray(prog.likes) && !user.likes?.length){ user.likes = prog.likes.slice(); }
          // Solo sobreescribir avatar si no hubo uno seleccionado distinto al default al iniciar
          try{
            if(prog && prog.avatar){
              const defA = '/assets/avatar1.png';
              if(!user.avatar || user.avatar === defA || user.avatar === prog.avatar){ user.avatar = prog.avatar; }
              // Si existe un avatar seleccionado en localStorage distinto, priorizarlo
              try{ const sel = localStorage.getItem('selectedAvatar'); if(sel && sel !== prog.avatar){ user.avatar = sel; } }catch(_){ }
            }
            // Propagar imagen final al panel UI
            const uiA = document.getElementById('uiAvatar'); if(uiA && user.avatar) uiA.src = user.avatar;
          }catch(_){ }
          try{ window.updateCarMenuHighlight && window.updateCarMenuHighlight(); }catch(e){}
        }catch(e){}
      }catch(e){}
    }); }catch(e){}
    if(!hasNet()){
      for(let i=0;i<CFG.N_INIT;i++) {agents.push(makeAgent('adult',{ageYears:rand(18,60)}));}
    }
    agents.forEach(a => { if (assignRental(a)) { const home = houses[a.houseIdx]; if (home) { a.target = centerOf(home); a.targetRole = 'home'; } } });
    const b0=cityBlocks[0]; if(b0){ cam.x = Math.max(0, b0.x - 40); cam.y = Math.max(0, b0.y - 40); clampCam(); }
    updateGovDesc();
  try{ window.updateOwnedShopsUI = updateOwnedShopsUI; updateOwnedShopsUI(); }catch(e){}
  try{ window.updateCarMenuHighlight && window.updateCarMenuHighlight(); }catch(e){}
  // Refrescar panel del banco con el nuevo jugador
  try{ window.updateBankPanel && window.updateBankPanel(); }catch(e){}
  // Cargar iniciales compartidas (casas rentadas de otros usuarios)
  try{
    (async function(){
      try{
        const res = await fetch('/api/rentals');
        if(!res.ok) return;
        const data = await res.json();
        if(!(data && data.ok && Array.isArray(data.rentals))) return;
        const rentals = data.rentals;
        // Evitar duplicar marcador propio
        const myId = USER_ID;
        for(const r of rentals){
          try{
            if(!r) continue;
            if(r.userId && r.userId === myId) continue; // ya lo tengo local
            const idx = typeof r.rentedHouseIdx === 'number' ? r.rentedHouseIdx : null;
            let targetHouse = null;
            if(idx!=null && houses[idx]) targetHouse = houses[idx];
            // Fallback por proximidad geométrica si no coincide índice
            if(!targetHouse && r.rentalHouse){
              const rx = r.rentalHouse.x||0, ry = r.rentalHouse.y||0;
              let best=null, bestD=1e12;
              for(const h of houses){
                if(!h) continue;
                const d = Math.hypot((h.x||0)-rx, (h.y||0)-ry);
                if(d < bestD){ bestD = d; best = h; }
              }
              if(bestD < 25) targetHouse = best; // tolerancia
            }
            if(targetHouse && !targetHouse._markerInitial && r.initial){
              targetHouse._markerInitial = String(r.initial).slice(0,3);
            }
          }catch(_){ }
        }
      }catch(_){ }
    })();
  }catch(_){ }
    try{
  const uiAvatar = document.getElementById('uiAvatar');
  if(uiAvatar && user.avatar) uiAvatar.src = user.avatar;
      const userName = document.getElementById('userName');
      if(userName){
        const full = user.name || user.code || 'Usuario';
        // Set immediately
        userName.textContent = full;
        userName.setAttribute('data-fullname', full);

        // If something else (CSS/other script) ends up leaving only an initial,
        // retry a few times to ensure the full name is shown (handles race conditions).
        if((userName.textContent || '').length <= 2 && (full || '').length > 2){
          setTimeout(()=>{ try{ document.getElementById('userName').textContent = full; }catch(e){} }, 100);
          setTimeout(()=>{ try{ document.getElementById('userName').textContent = full; }catch(e){} }, 1000);
          let _sync = null;
          _sync = setInterval(()=>{
            try{
              const el = document.getElementById('userName');
              if(!el) return;
              if(el.textContent === full){ clearInterval(_sync); return; }
              el.textContent = full;
            }catch(e){}
          }, 1500);
          setTimeout(()=>{ try{ clearInterval(_sync); }catch(e){} }, 8000);
        }
      }
    }catch(e){}
    loop();
  }
  const startHandler = ()=>{
    // Seguridad extra: exigir sesión iniciada antes de crear personaje
    if(!window.__user){ toast('Inicia sesión primero.'); return; }
  // Determinar género desde el registro (M/F) con fallbacks: campo oculto -> progreso -> usuario -> selección del modal
  let gender = (fGender.value||'').trim();
  // Preferir el género del progreso por encima del usuario (es el perfil activo de juego)
  try{ if((!gender || !['M','F'].includes(gender)) && window.__progress && window.__progress.gender){ gender = String(window.__progress.gender); } }catch(_){ }
  // Luego intentar con el perfil del usuario
  try{ if((!gender || !['M','F'].includes(gender)) && window.__user && window.__user.gender){ gender = String(window.__user.gender); } }catch(_){ }
  // Último recurso: si el modal sigue en el DOM y tiene un valor válido, úsalo
  try{ if((!gender || !['M','F'].includes(gender))){ const el = document.getElementById('authGender'); if(el && ['M','F'].includes(el.value)) gender = el.value; } }catch(_){ }
  const name=fName.value.trim();
  const age=Math.max(20, Math.min(89, parseInt(fAge.value||'20',10)));
  const likes=getChecked().map(x=>x.value);
  const usd=fUsd.value;
  if(!['M','F'].includes(gender)){ toast('Selecciona género en el registro (Hombre o Mujer).'); return; }
  // Campos extra (país/correo/teléfono) se piden en el registro; aquí no se vuelven a pedir ni validar
    if(!name || likes.length!==5){ errBox.style.display='inline-block'; toast('Completa nombre y marca 5 gustos.'); return; }
    errBox.style.display='none';
    startWorldWithUser({name,gender,age,likes,usd});
  };
  btnStart.addEventListener('click', startHandler);
  $("#formInner").addEventListener('submit',(e)=>{ e.preventDefault(); startHandler(); });

  
  canvas.addEventListener('click', (e)=>{
    if(!STARTED) return;
    const rect = canvas.getBoundingClientRect(); const pt = toWorld(e.clientX-rect.left, e.clientY-rect.top);
    if(isOverUI(e.clientX,e.clientY)) return;
    // Si se hace click en el edificio del gobierno, abrir el panel de gobierno
    try{
      // rect gobierno principal
      if(pt && government && typeof government.x === 'number'){
        if(pt.x >= government.x && pt.x <= government.x + government.w && pt.y >= government.y && pt.y <= government.y + government.h){
          openGovPanel(government); return;
        }
      }
      // también verificar edificaciones gubernamentales colocadas
      for(const inst of government.placed || []){
        if(inst && inst.k === 'gobierno'){
          if(pt.x >= inst.x && pt.x <= inst.x + inst.w && pt.y >= inst.y && pt.y <= inst.y + inst.h){ openGovPanel(inst); return; }
        }
      }
    }catch(e){}

  const allBuildings = [cemetery,government,...banks,...malls,...factories,...houses,...(window.__netHouses||[]),...roadRects,...getVisibleShops(), ...avenidas, ...roundabouts, ...government.placed];
  // Eliminar Edificio 5 y Edificio 6 si existen (petición del usuario)
  try{ removeByLabels(['edificio 5','edificio 6']); }catch(e){ }

    if(placingHouse){
      const u=agents.find(a=>a.id===placingHouse.ownerId); if(!u){ placingHouse=null; return; }
  const newH = {x: pt.x - placingHouse.size.w/2, y: pt.y - placingHouse.size.h/2, w: placingHouse.size.w, h: placingHouse.size.h, ownerId:u.id, rentedBy:null, owned:true};
  // Restricción de arena eliminada
      if(allBuildings.some(r=>rectsOverlapWithMargin(r,newH, 8))){ toast('No se puede colocar (muy cerca de otro edificio).'); return; }
      if((u.money||0) < placingHouse.cost){ toast('Saldo insuficiente.'); placingHouse=null; return; }
      if(hasNet()){
  window.sock?.emit('placeHouse', newH, (res)=>{
          if(res?.ok){ u.money -= placingHouse.cost; houses.push(newH); u.houseIdx = houses.length-1; placingHouse=null; toast('Casa propia construida 🏠'); }
          else { toast(res?.msg||'Error al colocar casa'); placingHouse=null; }
        });
        return;
      }
  u.money -= placingHouse.cost;
      if(u.houseIdx !== null && houses[u.houseIdx]) { houses[u.houseIdx].rentedBy = null; }
  houses.push(newH); u.houseIdx = houses.length-1; placingHouse=null;
  try{ window.saveProgress && window.saveProgress({ money: Math.floor(u.money), houses: houses.filter(h=>h.ownerId===u.id) }); }catch(e){}
  toast('Casa propia construida 🏠'); return;
    }

    // Colocación de negocio desde el menú (ej: panadería). Debe aparecer justo donde se hace click.
    if(placingShop){
      const u = agents.find(a => a.id === placingShop.ownerId);
      if(!u){ placingShop = null; return; }
      const size = placingShop.size || {w: CFG.SHOP_W, h: CFG.SHOP_H};
      const newShop = { x: pt.x - size.w/2, y: pt.y - size.h/2, w: size.w, h: size.h, kind: placingShop.kind.k || placingShop.kind, ownerId: u.id };
  // Restricción de arena eliminada
      // comprobar colisiones
      if(allBuildings.some(r => rectsOverlapWithMargin(r, newShop, 8))){ toast('No se puede colocar el negocio aquí (colisión).'); placingShop = null; return; }
      if((u.money || 0) < (placingShop.price || 0)){ toast('Saldo insuficiente.'); placingShop = null; return; }
      // enviar al servidor si corresponde
      if(hasNet()){
        window.sock?.emit('placeShop', newShop, (res) => {
          if(res?.ok){ u.money -= (placingShop.price || 0); shops.push(newShop); placingShop = null; try{ window.saveProgress && window.saveProgress({ money: Math.floor(u.money), shops: shops.filter(s=>s.ownerId===u.id) }); }catch(e){} updateOwnedShopsUI(); toast('Negocio colocado.'); }
          else { toast(res?.msg || 'Error al colocar negocio'); placingShop = null; }
        });
      }else{
  u.money -= (placingShop.price || 0);
  shops.push(newShop);
  try{ window.saveProgress && window.saveProgress({ money: Math.floor(u.money), shops: shops.filter(s=>s.ownerId===u.id) }); }catch(e){} placingShop = null;
        updateOwnedShopsUI();
        toast('Negocio colocado (local).');
      }
      return;
    }
    if(placingShop){
      const u=agents.find(a=>a.id===placingShop.ownerId); if(!u){ placingShop=null; return; }
      const rectShop = {x: pt.x - placingShop.size.w/2, y: pt.y - placingShop.size.h/2, w: placingShop.size.w, h: placingShop.size.h};
  // Restricción de arena eliminada
      if(allBuildings.some(r=>rectsOverlapWithMargin(r,rectShop, 8))){ toast('No se puede colocar aquí (muy cerca).'); return; }
      if((u.money||0) < placingShop.price){ toast('Saldo insuficiente.'); placingShop=null; return; }
      const newShop = { 
  ownerId:u.id, 
  x:rectShop.x, 
  y:rectShop.y, 
  w:rectShop.w, 
  h:rectShop.h, 
  kind:placingShop.kind.k,  // Ahora esto es correcto
  icon:placingShop.kind.icon, 
  like:placingShop.kind.like, 
  price:placingShop.kind.price, 
  buyCost: placingShop.kind.buyCost 
};
      if(hasNet()){
        console.log("Intentando colocar negocio vía red...");
        window.sock?.emit('placeShop', newShop, (res)=>{
          console.log("Respuesta del servidor:", res);
          if(res?.ok){ u.money -= placingShop.price; newShop.id='S'+(shops.length+1); newShop.cashbox=0; shops.push(newShop); placingShop=null; updateOwnedShopsUI(); toast('Negocio colocado 🏪'); }
          else { toast(res?.msg||'Error al colocar negocio'); placingShop=null; }
        });
        return;
      }
  u.money -= placingShop.price;
      newShop.id='S'+(shops.length+1); newShop.cashbox=0; shops.push(newShop);
  placingShop=null; try{ window.saveProgress && window.saveProgress({ money: Math.floor(u.money), shops: shops.filter(s=>s.ownerId===u.id) }); }catch(e){} updateOwnedShopsUI(); toast('Negocio colocado 🏪'); return;
    }
    if(placingGov){
      const rectX = { x: pt.x - placingGov.w/2, y: pt.y - placingGov.h/2, w: placingGov.w, h: placingGov.h, label: placingGov.label, icon: placingGov.icon, fill: placingGov.fill, stroke: placingGov.stroke, k: placingGov.k };
      rectX.x = clamp(rectX.x, 10, WORLD.w - rectX.w - 10);
      rectX.y = clamp(rectX.y, 10, WORLD.h - rectX.h - 10);
  // Restricción de arena eliminada
      if(allBuildings.some(r=>rectsOverlapWithMargin(r,rectX, 8))){ toast('No se puede colocar aquí (muy cerca).'); return; }
      if(government.funds < placingGov.cost){ toast('Fondos insuficientes.'); placingGov=null; return; }
      if(hasNet()){
        const payload = { ...rectX, cost: placingGov.cost };
        window.sock?.emit('placeGov', payload, (res)=>{
          if(res?.ok){ government.funds -= placingGov.cost; government.placed.push(rectX); updateGovDesc(); placingGov=null; toast('Construcción realizada ✅'); }
          else { toast(res?.msg||'No se pudo construir'); placingGov=null; }
        });
        return;
      }
      government.funds -= placingGov.cost;
      government.placed.push(rectX);
      govFundsEl.textContent = `Fondo: ${Math.floor(government.funds)}`;
      placingGov=null; toast('Construcción realizada ✅');
      updateGovDesc();
      return;
    }

    for(const b of banks){ if(inside(pt,b)){const you = USER_ID? agents.find(a=>a.id===USER_ID) : null; if(you){ const your$ = Math.floor((you.money||0) + (you.pendingDeposit||0)); accBankBody.innerHTML = `Saldo de ${you.code}: <span class="balance-amount">${your$}</span>`; } else { accBankBody.textContent = 'Crea tu persona primero.'; } toast('Banco abierto');return;} }
    for(const s of getVisibleShops()){
      if(inside(pt,s) && s.ownerId === USER_ID){
        if(s.hasEmployee){
          const employee = agents.find(a => a.id === s.employeeId);
          if(employee){ employee.employedAtShopId = null; employee.target = null; employee.targetRole = 'idle'; }
          s.hasEmployee = false; s.employeeId = null; s.wage = 0;
          toast("Empleado despedido.");
        } else {
          const candidate = agents.find(a => a.id !== USER_ID && !a.employedAtShopId && !shops.some(shop => shop.ownerId === a.id));
          if(candidate){
            s.hasEmployee = true; s.employeeId = candidate.id;
            s.wage = Math.ceil(CFG.EARN_PER_SHIFT * 1.25);
            candidate.employedAtShopId = s.id;
            candidate.target = centerOf(s); candidate.targetRole = 'work_shop';
            candidate.workingUntil = null; candidate.goingToBank = false;
            toast(`Empleado ${candidate.code} contratado! 👔`);
          } else {
            toast("No hay personal disponible para contratar.");
          }
        }
        return;
      }
    }
  });
  console.log("Clic en canvas procesado");

  function drawMiniMap(){
    const w=miniCanvas.width, h=miniCanvas.height; mctx.clearRect(0,0,w,h);
    // Mini-mapa: usar la misma imagen de fondo (escalada) si está disponible
    if (BG_IMG && BG_IMG.complete && BG_IMG.naturalWidth > 0) {
      const iw = BG_IMG.naturalWidth, ih = BG_IMG.naturalHeight;
      const scale = Math.max(w / iw, h / ih);
      const iwScaled = iw * scale, ihScaled = ih * scale;
      const dx = (w - iwScaled) / 2, dy = (h - ihScaled) / 2;
      mctx.drawImage(BG_IMG, dx, dy, iwScaled, ihScaled);
    } else {
      mctx.fillStyle='#fff8e1'; mctx.fillRect(0,0,w,h);
    }
    const sx = w / WORLD.w, sy = h / WORLD.h;
    const mrect=(r,fill)=>{ mctx.fillStyle=fill; mctx.fillRect(Math.max(0,r.x*sx), Math.max(0,r.y*sy), Math.max(1,r.w*sx), Math.max(1,r.h*sy)); };
    cityBlocks.forEach(r=>mrect(r,'#334155'));
    roadRects.forEach(r=>mrect(r,'#9ca3af')); factories.forEach(r=>mrect(r,'#8b5cf6'));
  banks.forEach(r=>mrect(r,'#fde047')); malls.forEach(r=>mrect(r,'#ef4444')); getVisibleShops().forEach(r=>mrect(r,'#94a3b8'));
    mrect(cemetery,'#cbd5e1'); mrect(government,'#60a5fa');
    government.placed.forEach(r=>{
      if(r.k === 'carcel'){
        mctx.fillStyle = '#111'; mctx.fillRect(Math.max(0,r.x*sx), Math.max(0,r.y*sy), Math.max(1,r.w*sx), Math.max(1,r.h*sy));
        mctx.fillStyle = '#fff'; const bars = 3; const bx = Math.max(0,r.x*sx), by = Math.max(0,r.y*sy), bw = Math.max(1,r.w*sx), bh = Math.max(1,r.h*sy);
        for(let i=0;i<bars;i++){ const px = bx + 4 + i*(bw-8)/(bars-1); mctx.fillRect(px, by+4, 2, bh-8); }
        ctx.fillStyle = '#fff'; ctx.font=`700 ${Math.max(10, 14*ZOOM)}px system-ui`; ctx.textAlign='center'; ctx.fillText('CÁRCEL', p.x + w/2, p.y + 18*ZOOM);
      } else { mrect(r, r.fill || '#94a3b8'); }
    });
    const vw = canvas.width/ZOOM, vh = canvas.height/ZOOM;
    mctx.strokeStyle='#22d3ee'; mctx.lineWidth=1; mctx.strokeRect(cam.x*sx, cam.y*sy, vw*sx, vh*sy);
    if(USER_ID){
      const u=agents.find(a=>a.id===USER_ID);
      if(u){
        const playerX = u.x * sx;
        const playerY = u.y * sy;
        mctx.fillStyle = 'rgba(255, 255, 0, 0.7)';
        mctx.beginPath(); mctx.arc(playerX, playerY, 6, 0, Math.PI * 2); mctx.fill();
        mctx.fillStyle = '#FFFF00';
        mctx.beginPath(); mctx.arc(playerX, playerY, 2.5, 0, Math.PI * 2); mctx.fill();
      }
    }
  }
  miniCanvas.addEventListener('click', (e)=>{const r=miniCanvas.getBoundingClientRect();const mx=e.clientX-r.left, my=e.clientY-r.top;const sx = mx / miniCanvas.width, sy = my / miniCanvas.height;const vw = canvas.width/ZOOM, vh = canvas.height/ZOOM;cam.x = Math.min(Math.max(0, sx*WORLD.w - vw/2), Math.max(0, WORLD.w - vw));cam.y = Math.min(Math.max(0, sy*WORLD.h - vh/2), Math.max(0, WORLD.h - vh));clampCam();});

  function openBuilderMenu(){if(!STARTED){ toast('Primero inicia el mundo.'); return; }if(!USER_ID){ toast('Crea tu persona primero.'); return; }const u=agents.find(a=>a.id===USER_ID); if(!u){ toast('No encontré tu persona.'); return; }$("#builderMsg").textContent = `Tu saldo: ${Math.floor(u.money)}.`;show(builderModal,true);}
  btnBuilderClose.onclick = ()=> show(builderModal,false);
  btnBuy.onclick = ()=>{const u=agents.find(a=>a.id===USER_ID); if(!u) return; if(u.houseIdx!=null && houses[u.houseIdx]?.ownerId===u.id){ $("#builderMsg").textContent='Ya eres dueño de una casa.'; return; } if(u.money<CFG.HOUSE_BUY_COST){ $("#builderMsg").textContent=`No te alcanza para comprar (${CFG.HOUSE_BUY_COST}).`; return; } const big= Math.round(CFG.HOUSE_SIZE * (CFG.OWNED_HOUSE_SIZE_MULT||1.4)); placingHouse = {cost: CFG.HOUSE_BUY_COST, size:{w:big, h:big}, ownerId: u.id, owned:true}; show(builderModal,false); toast('Modo colocación: toca un espacio libre (casa propia grande).'); };

  function openShopMenu(){
      if(!STARTED){ toast('Primero inicia el mundo.'); return; }
      if(!USER_ID){ toast('Crea tu persona primero.'); return; }
      const u=agents.find(a=>a.id===USER_ID);
      if(!u){ toast('No encontré tu persona.'); return; }
      shopList.innerHTML='';
      const sortedShops = [...SHOP_TYPES].sort((a, b) => a.buyCost - b.buyCost);
      sortedShops.forEach(t=>{
          const b=document.createElement('button');
          b.className='btn';
          // miniatura de la imagen si existe
          const imgUrl = (BUILDING_IMAGES && BUILDING_IMAGES[t.k]) ? BUILDING_IMAGES[t.k] : null;
          if(imgUrl){
            const img = document.createElement('img'); img.src = imgUrl; img.alt = t.k; img.style.width='40px'; img.style.height='40px'; img.style.objectFit='cover'; img.style.borderRadius='8px'; img.style.marginRight='8px'; img.style.verticalAlign='middle';
            b.appendChild(img);
          }
          const span = document.createElement('span'); span.textContent = `${t.icon} ${t.k} (Costo: ${t.buyCost}, Venta: $${t.price})`;
          b.appendChild(span);
          b.onclick=()=>{
              if(u.money < t.buyCost){ $("#shopMsg").textContent=`No te alcanza. Necesitas ${t.buyCost}.`; return; }
              placingShop = {ownerId:u.id, kind:t, price:t.buyCost, size:{w:CFG.SHOP_W,h:CFG.SHOP_H}};
              show(shopModal,false); toast('Modo colocación: toca el mapa.');
          };
          shopList.appendChild(b);
      });
      $("#shopMsg").textContent = `Tu saldo: ${Math.floor(u.money)}. El precio de venta es la ganancia por cliente.`;
      show(shopModal,true);
  }
  btnShopClose.onclick = ()=> show(shopModal,false);
  btnHouse.onclick = ()=> openBuilderMenu();
  btnShop.onclick  = ()=> openShopMenu();

  function populateGovSelect(){
    govSelectEl.innerHTML = '';
    GOV_TYPES.forEach(t=>{
      const opt=document.createElement('option');
      opt.value=t.k;
      opt.textContent = `${t.icon} ${t.label} (Costo: ${t.cost})`;
      govSelectEl.appendChild(opt);
    });
  }
  function selectedGovType(){
    const k = govSelectEl.value;
    return GOV_TYPES.find(x=>x.k===k) || GOV_TYPES[0];
  }
  function updateGovDesc(){
    const n = government.placed.length;
    const rate = Math.min(CFG.WEALTH_TAX_MAX, CFG.WEALTH_TAX_BASE + n*CFG.INSTITUTION_TAX_PER);
    govDescEl.textContent = `Instituciones: ${n}/25 · Impuesto actual: ${(rate*100).toFixed(1)}% (Base 1.0% + 0.1% × ${n}).`;
    govFundsEl.textContent = `Fondo: ${Math.floor(government.funds)}`;
  }
  btnGovPlace.onclick = ()=>{
    if(!STARTED){ toast('Inicia el mundo primero.'); return; }
    const typ = selectedGovType();
    if(government.funds < typ.cost){ toast('Fondos insuficientes.'); return; }
    placingGov = {...typ};
    toast(`Modo colocación: ${typ.label}. Haz clic en el mapa.`);
  }

  setInterval(()=>{if(!STARTED) return; if(hasNet()) return;
    const n = government.placed.length;
    const effRate = Math.min(CFG.WEALTH_TAX_MAX, CFG.WEALTH_TAX_BASE + n*CFG.INSTITUTION_TAX_PER);
    let collected = 0;
    for(const a of agents){
      const taxAmount = (a.money || 0) * effRate;
      if(a.money >= taxAmount){ a.money -= taxAmount; collected += taxAmount; }
    }
    government.funds += collected;
    if(collected > 0){ govFundsEl.textContent = `Fondo: ${Math.floor(government.funds)} (+${Math.round(collected)})`; toast(`Gobierno recaudó ${Math.round(collected)} créditos (tasa ${(effRate*100).toFixed(1)}%).`); }
    updateGovDesc();
  }, CFG.GOV_TAX_EVERY*1000);

  // (Intervalo de cobro de alquiler eliminado: ahora se procesa dentro del loop con processRent acumulando 1 hora real)

  setInterval(()=>{if(!STARTED) return; if(hasNet()) return;
    for(const shop of shops){
      if(shop.hasEmployee && shop.employeeId && shop.ownerId){
        const owner = agents.find(a => a.id === shop.ownerId);
        const employee = agents.find(a => a.id === shop.employeeId);
        if(!owner || !employee) continue;
        if(shop.cashbox >= shop.wage){ shop.cashbox -= shop.wage; employee.money += shop.wage; toast(`Nómina pagada en ${shop.kind}. Caja ahora: ${Math.floor(shop.cashbox)}.`); }
        else { toast(`Caja insuficiente en ${shop.kind}. ¡El empleado ${employee.code} ha renunciado!`); shop.hasEmployee = false; shop.employeeId = null; shop.wage = 0; employee.employedAtShopId = null; employee.target = null; employee.targetRole = 'idle'; }
      }
    }
  }, CFG.SALARY_PAY_EVERY * 1000);

  const carTypeSelect = $('#carTypeSelect'), btnBuyCar = $('#btnBuyCar'), carMsg = $('#carMsg');
  // Resaltar vehículos ya comprados en el menú del concesionario
  function updateCarMenuHighlight(){
    try{
      const sel = carTypeSelect; if(!sel) return;
      // Propia lista guardada en progreso
      const owned = new Set((window.__progress && Array.isArray(window.__progress.vehicles)) ? window.__progress.vehicles : []);
      // Vehículo actual del usuario (si ya hay agente) o del progreso
      let current = null;
      try{
        // Prioridad: agente vivo > progreso guardado
        if(typeof USER_ID !== 'undefined' && USER_ID){
          const u = agents.find(a => a.id === USER_ID);
          if(u && u.vehicle) current = u.vehicle;
        }
        if(!current && window.__progress && window.__progress.vehicle){ current = window.__progress.vehicle; }
      }catch(e){}
      // Actualizar cada opción (excepto placeholder)
      for(const opt of sel.options){
        if(!opt.value) continue;
        if(!opt.dataset.baseLabel){ opt.dataset.baseLabel = opt.textContent; }
        const base = opt.dataset.baseLabel;
        const isOwned = owned.has(opt.value);
        const isCurrent = current && (opt.value === current);
        // Texto
        opt.textContent = isOwned ? `${base} ✓ Comprado${isCurrent? ' (actual)':''}` : base;
        // Estilos (nota: algunos navegadores limitan estilos en <option>)
        opt.style.fontWeight = isOwned ? '700' : '400';
        opt.style.backgroundColor = isOwned ? 'rgba(34,197,94,0.22)' : '';
        opt.style.color = isOwned ? '' : '';
      }
      if(current){ sel.value = current; }
    }catch(e){}
  }
  // Exponer para que otras partes (auth) refresquen el estado visual
  try{ window.updateCarMenuHighlight = updateCarMenuHighlight; }catch(e){}

  btnBuyCar.addEventListener('click', () => {
      if(!USER_ID) { toast('Debes iniciar la simulación.'); return; }
      const u = agents.find(a => a.id === USER_ID);
      if(!u) { toast('Error: No se encontró a tu agente.'); return; }
      const vType = carTypeSelect.value;
      if (!vType || !VEHICLES[vType]) { carMsg.textContent = 'Por favor, selecciona un vehículo.'; carMsg.style.color = 'var(--warn)'; return; }
      const vehicle = VEHICLES[vType];
      // Bloquear compra duplicada: si ya lo tienes, sólo activarlo sin costo
      try{
        const prog = (window.__progress || {});
        const ownedList = Array.isArray(prog.vehicles) ? prog.vehicles : [];
        const alreadyOwned = ownedList.includes(vType) || (u.vehicle === vType);
        if(alreadyOwned){
          // Activar como vehículo actual, persistir y notificar
          u.vehicle = vType;
          try{ window.saveProgress && window.saveProgress({ vehicle: vType }); }catch(_){ }
          try{ window.sockApi?.update({ vehicle: vType }); }catch(_){ }
          carMsg.textContent = `Ya tienes ${vehicle.name}. Se activó como vehículo actual.`;
          carMsg.style.color = 'var(--ok)';
          toast('Vehículo ya comprado. Activado.');
          try{ updateCarMenuHighlight(); }catch(_){ }
          return;
        }
      }catch(_){ }
      if (u.money >= vehicle.cost){
        u.money -= vehicle.cost;
        u.vehicle = vType;
        try{
          const prog = (window.__progress || {});
          const list = Array.isArray(prog.vehicles) ? prog.vehicles.slice() : [];
          if(!list.includes(vType)) list.push(vType);
          window.__progress.vehicles = list;
          window.saveProgress && window.saveProgress({ money: Math.floor(u.money), vehicle: vType, vehicles: list });
        }catch(e){}
        try{ window.sockApi?.update({ vehicle: vType }); }catch(e){}
        carMsg.textContent = `¡${vehicle.name} comprado!`;
        carMsg.style.color = 'var(--ok)';
        toast(`¡Vehículo comprado! Tu velocidad aumentó.`);
  // Refrescar marcas visuales de "Comprado"
  try{ updateCarMenuHighlight(); }catch(e){}
      }
      else { carMsg.textContent = `Créditos insuficientes. Necesitas ${vehicle.cost}.`; carMsg.style.color = 'var(--bad)'; }
  });

  // Eventos para notificar cuando todas las imágenes estén cargadas
window.addEventListener('load', () => {
  // Esperar un momento para asegurarse que las imágenes se procesen
  setTimeout(() => {
    console.log("Todas las imágenes de edificios han sido precargadas");
  }, 1000);
});

// Función para crear agentes (personas en el mundo)
function makeAgent(state, options = {}) {
  const id = 'A' + (Math.random() * 1000000 | 0);
  const gender = options.gender || (Math.random() < 0.5 ? 'M' : 'F');
  const now = Date.now() / 1000;
  const ageYears = options.ageYears || (state === 'child' ? rand(1, 14) : rand(18, 65));
  const bornEpoch = now - ageYears * 31536000; // años a segundos
  
  // Código de agente (iniciales o letras aleatorias)
  const code = options.name ? 
               options.name.split(' ').map(n => n[0]).join('').toUpperCase() : 
               String.fromCharCode(65 + (Math.random() * 26 | 0)) + 
               String.fromCharCode(65 + (Math.random() * 26 | 0));
  
  // Posición inicial aleatoria
  const x = rand(100, WORLD.w - 100);
  const y = rand(100, WORLD.h - 100);
  
  // Intereses/gustos
  const allInterests = ['pan', 'kiosco', 'jugos', 'café', 'helado', 'pizza', 
                        'libros', 'juguetes', 'yoga', 'baile', 'deporte', 'arte', 
                        'cine', 'videojuegos', 'naturaleza', 'fotografía', 
                        'astronomía', 'comida', 'electrónica', 'tecnología'];
  const likes = options.likes || [];
  while (likes.length < 5) {
    const interest = allInterests[Math.floor(Math.random() * allInterests.length)];
    if (!likes.includes(interest)) likes.push(interest);
  }
  
  // Asignar avatar aleatorio a NPC si no se especifica y no es el jugador
  const presetAvatars = ['/assets/avatar1.png','/assets/avatar2.png','/assets/avatar3.png','/assets/avatar4.png'];
  let finalAvatar = options.avatar || null;
  if(!finalAvatar){
    // Si es un NPC (no se marcó explicitamente isPlayer), tomar uno al azar
    if(!options.isPlayer){ finalAvatar = presetAvatars[Math.floor(Math.random()*presetAvatars.length)]; }
  }
  return {
    id,
    code,
  name: options.name || code,
    state,
    gender,
    bornEpoch,
    x,
    y,
    vx: 0,
    vy: 0,
    speed: CFG.SPEED,
    money: options.startMoney || rand(100, 500),
    pendingDeposit: 0,
    houseIdx: null,
    likes,
  // avatar seleccionado (del grid, preview o subida por el usuario)
  avatar: finalAvatar,
    target: null,
    targetRole: 'idle',
    cooldownSocial: 0,
    parents: options.parents || null,
    spouseId: null
  };
}

// Variables globales que faltan
let STARTED = false;
let USER_ID = null;
let agents = [];
// Exponer referencias globales para persistencia/manual save
try{ window.agents = agents; }catch(_){ }
try{ Object.defineProperty(window,'USER_ID',{ get(){ return USER_ID; }, set(v){ USER_ID=v; } }); }catch(_){ }
let frameCount = 0;
let SHOW_LINES = true;
let socialConnections = [];

// Función para calcular años desde una fecha
function yearsSince(epochSeconds) {
  return (Date.now() / 1000 - epochSeconds) / 31536000;
}

// Función para contar coincidencias entre gustos
function likeMatches(a, b) {
  if (!a.likes || !b.likes) return 0;
  return a.likes.filter(like => b.likes.includes(like)).length;
}

// Popup "media naranja"
function showLovePrompt(otherAgent){
  // Evitar múltiples a la vez
  if(document.getElementById('lovePrompt')) return;
  const wrap = document.createElement('div');
  wrap.id = 'lovePrompt';
  wrap.style.position = 'fixed'; wrap.style.inset = '0'; wrap.style.zIndex='70';
  wrap.style.display='flex'; wrap.style.alignItems='center'; wrap.style.justifyContent='center';
  wrap.style.background='rgba(0,0,0,0.45)';
  const box = document.createElement('div');
  box.className = 'modalBox'; box.style.width='min(440px,92vw)';
  const name = otherAgent.name || otherAgent.fullName || otherAgent.code || 'esta persona';
  box.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px">
      <div style="font-size:28px">💖</div>
      <div>
        <h3 style="margin:0">¿Deseas conocer a tu media naranja?</h3>
        <div class="hint">Coinciden en varios gustos con <b>${name}</b>.</div>
      </div>
    </div>
    <div class="actions" style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
      <button id="btnLoveNo" class="btn">No</button>
      <button id="btnLoveYes" class="btn primary">Sí</button>
    </div>
  `;
  wrap.appendChild(box);
  document.body.appendChild(wrap);
  const close = ()=>{ try{ wrap.remove(); }catch(_){ } };
  wrap.addEventListener('click', (e)=>{ if(e.target===wrap) close(); });
  document.getElementById('btnLoveNo').addEventListener('click', close);
  document.getElementById('btnLoveYes').addEventListener('click', ()=>{
    try{
      // Acción simple: marcar objetivo para acercarse y mostrar un toast
      const me = agents.find(a=>a.id===USER_ID);
      if(me){ me.target = { x: otherAgent.x, y: otherAgent.y }; me.targetRole = 'meet'; me.cooldownSocial = (me.cooldownSocial||0) + 30; }
      toast('¡Ve a conocer a tu media naranja! 💘');
      openChatWith(otherAgent);
    }catch(_){ }
    close();
  });
}

// Chat simple entre jugador y otro agente
function ensureChatUI(){
  if(document.getElementById('chatDock')) return;
  const dock = document.createElement('div');
  dock.id = 'chatDock';
  dock.style.position='fixed'; dock.style.right='16px'; dock.style.bottom='16px'; dock.style.zIndex='65';
  dock.style.width='min(320px, 90vw)'; dock.style.maxHeight='60vh'; dock.style.display='none';
  dock.style.background='rgba(17,24,39,0.92)'; dock.style.border='1px solid #334155'; dock.style.borderRadius='10px'; dock.style.boxShadow='none';
  dock.innerHTML = `
    <div id="chatHeader" style="padding:8px 10px;border-bottom:1px solid #334155;display:flex;align-items:center;gap:8px;justify-content:space-between">
      <div id="chatTitle" style="font-weight:600">Chat</div>
      <button id="chatClose" class="btn">×</button>
    </div>
    <div id="chatBody" style="padding:10px; overflow:auto; max-height:36vh; font-size:14px; line-height:1.3"></div>
    <div style="padding:8px 10px;border-top:1px solid #334155;display:flex;gap:6px;align-items:center">
      <input id="chatInput" class="input" placeholder="Escribe un mensaje…" style="flex:1;min-width:0"/>
      <button id="chatSend" class="btn primary">Enviar</button>
    </div>
    <div style="padding:6px 10px 10px;display:flex;gap:8px;align-items:center">
      <button id="sendRoses" class="btn">🌹 Rosas</button>
      <button id="sendChoco" class="btn">🍫 Chocolates</button>
    </div>
  `;
  document.body.appendChild(dock);
  document.getElementById('chatClose').addEventListener('click', ()=> dock.style.display='none');
}

let __chatPeer = null;
function openChatWith(other){
  ensureChatUI(); __chatPeer = other; const dock = document.getElementById('chatDock'); if(!dock) return;
  dock.style.display='block';
  const title = document.getElementById('chatTitle');
  if(title){ title.textContent = 'Chat con ' + (other.name || other.code || other.id); }
  const body = document.getElementById('chatBody'); if(body){ body.innerHTML = ''; }
  const send = (gift=null)=>{
    const input = document.getElementById('chatInput'); const text = (input?.value || '').trim();
    if(!text && !gift) return;
    const to = other.id; const payload = { to, text: text || null, gift: gift||null };
    if(window.sockApi && window.sock){ window.sockApi.sendChat(payload, ()=>{}); }
    renderIncomingMsg({ from: { id: 'me', name:'Tú' }, to: { id: other.id }, text, gift, ts: Date.now() });
    if(input) input.value='';
  };
  document.getElementById('chatSend').onclick = ()=> send(null);
  document.getElementById('chatInput').onkeydown = (e)=>{ if(e.key==='Enter'){ e.preventDefault(); send(null); } };
  document.getElementById('sendRoses').onclick = ()=> send('roses');
  document.getElementById('sendChoco').onclick = ()=> send('chocolates');
}

function renderIncomingMsg(msg){
  try{
    const body = document.getElementById('chatBody'); if(!body) return;
    const meId = USER_ID;
    const isMine = msg.from && (msg.from.id==='me' || msg.from.id===meId);
    const who = isMine ? 'Tú' : (msg.from?.name || msg.from?.id || 'Alguien');
    const line = document.createElement('div');
    line.style.margin = '4px 0';
    line.style.textAlign = isMine ? 'right' : 'left';
    const gift = msg.gift==='roses' ? ' 🌹' : (msg.gift==='chocolates' ? ' 🍫' : '');
    const text = (msg.text ? msg.text : '') + gift;
    line.textContent = who + ': ' + text;
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
  }catch(_){ }
}

// Mensajes entrantes desde socket
window.__onChatMessage = function(msg){
  try{
    // Abrir chat si llega algo del peer actual o si aún no hay chat abierto
    ensureChatUI();
    const dock = document.getElementById('chatDock'); if(dock) dock.style.display='block';
    renderIncomingMsg(msg);
  }catch(_){ }
}

// Función para asignar alquiler
function assignRental(agent) {
  if (agent.houseIdx !== null) return false;
  const availableHouses = houses.filter(h => h.ownerId !== agent.id && !h.rentedBy);
  if (availableHouses.length === 0) return false;
  const randomHouse = availableHouses[Math.floor(Math.random() * availableHouses.length)];
  randomHouse.rentedBy = agent.id;
  agent.houseIdx = houses.indexOf(randomHouse);
  return true;
}

// (Removido) Mejora de contraseña: botón y modal

// Asegurar que el avatar por defecto esté presente en el progreso
function ensureDefaultAvatar(progress) {
  if (!progress.avatar) {
    progress.avatar = '/assets/avatar1.png'; // avatar por defecto
    try { window.saveProgress && window.saveProgress({ avatar: progress.avatar }); } catch(e){}
  }
}

// Al cargar el progreso del usuario, asegúrate de que tenga avatar
try {
  if (window.__progress) ensureDefaultAvatar(window.__progress);
} catch(e){}

// Al guardar el personaje, asegúrate de que tenga avatar
btnStart && btnStart.addEventListener('click', function() {
  try {
    if (window.__progress) ensureDefaultAvatar(window.__progress);
  } catch(e){}
});