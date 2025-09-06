// Archivo restaurado: sin <script> ni IIFE innecesario
  const $ = s => document.querySelector(s);
  const show = (el, on=true)=> el.style.display = on? 'flex':'none';
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
  const fGenderPreview = document.getElementById('fGenderPreview');
  const MALE_IMG = 'https://i.postimg.cc/x8cc0drr/20250820-102743.png';
  const FEMALE_IMG = 'https://i.postimg.cc/C1vRTqQH/20250820-103145.png';
  function updateGenderPreview(){ try{ if(!fGender || !fGender.value) return; fGenderPreview.src = fGender.value === 'M' ? MALE_IMG : FEMALE_IMG; }catch(e){} }
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
  const zoomFab=$("#zoomFab"), zoomIn=$("#zoomIn"), zoomOut=$("#zoomOut"), docDock=$("#docDock"), govDock=$("#govDock"), topBar=$("#top-bar");
  const mini=$("#mini"), miniCanvas=$("#miniCanvas"), mctx=miniCanvas.getContext('2d');
  const stats=$("#stats"), toggleLinesBtn=$("#toggleLines");
  const btnShowDoc=$("#btnShowDoc"), accDocBody=$("#docBody");
  const panelDepositAll=$("#panelDepositAll"), accBankBody=$("#bankBody");
  const btnHouse=$("#btnHouse"), btnShop=$("#btnShop");
  const btnShowMarried = $("#btnShowMarried"), marriedDock = $("#marriedDock"), marriedList = $("#marriedList");
  const builderModal=$("#builderModal"), btnBuy=$("#btnBuy"), btnBuilderClose=$("#btnBuilderClose"), builderMsg=$("#builderMsg");
  const shopModal=$("#shopModal"), shopList=$("#shopList"), shopMsg=$("#shopMsg"), btnShopClose=$("#btnShopClose");
  const govFundsEl=$("#govFunds"), govDescEl = $("#govDesc");
  const govSelectEl=$("#govSelect"), btnGovPlace=$("#btnGovPlace");
  let placingGov = null, placingHouse = null, placingShop = null;

  const isMobile = ()=> innerWidth<=768;
  let ZOOM=1.0, ZMIN=0.6, ZMAX=2.0, ZSTEP=0.15;
  const WORLD={w:0,h:0}; const cam={x:0,y:0};

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
  function setWorldSize(){const vw=innerWidth, vh=innerHeight;WORLD.w = Math.floor(vw * (isMobile()? 3.6 : 2.8));WORLD.h = Math.floor(vh * (isMobile()? 3.2 : 2.6));}
  function fitCanvas(){ canvas.width=innerWidth; canvas.height=innerHeight; clampCam(); }
  function clampCam(){const vw = canvas.width/ZOOM, vh = canvas.height/ZOOM;const maxX = Math.max(0, WORLD.w - vw);const maxY = Math.max(0, WORLD.h - vh);cam.x = Math.max(0, Math.min(cam.x, maxX));cam.y = Math.max(0, Math.min(cam.y, maxY));}
  function toScreen(x,y){ return {x:(x-cam.x)*ZOOM, y:(y-cam.y)*ZOOM}; }
  function toWorld(px,py){ return {x: px/ZOOM + cam.x, y: py/ZOOM + cam.y}; }
  setWorldSize(); fitCanvas();
  addEventListener('resize', fitCanvas, {passive:true});

  /* ===== PAN/ZOOM ===== */
  const activePointers = new Map();let panPointerId = null;let pinchBaseDist = 0, pinchBaseZoom = 1, pinchCx = 0, pinchCy = 0;
  function isOverUI(sx,sy){const rects = [];const addRect = (el)=>{if(!el) return;const cs = getComputedStyle(el);if(cs.display==='none' || cs.visibility==='hidden') return;rects.push(el.getBoundingClientRect());};addRect(uiDock); addRect(docDock); addRect(govDock); addRect(topBar); addRect(mini); addRect(zoomFab); addRect(uiShowBtn); addRect(marriedDock); return rects.some(r => sx>=r.left && sx<=r.right && sy>=r.top && sy<=r.bottom);}
  function setZoom(newZ, anchorX=null, anchorY=null){const before = toWorld(anchorX??(canvas.width/2), anchorY??(canvas.height/2));ZOOM = Math.max(ZMIN, Math.min(ZMAX, newZ));const after  = toWorld(anchorX??(canvas.width/2), anchorY??(canvas.height/2));cam.x += (before.x - after.x); cam.y += (before.y - after.y); clampCam();}
  canvas.addEventListener('wheel', (e)=>{ e.preventDefault();if(isOverUI(e.clientX,e.clientY)) return;setZoom(ZOOM + (Math.sign(e.deltaY)>0?-ZSTEP:ZSTEP), e.clientX, e.clientY);}, {passive:false});
  canvas.addEventListener('pointerdown', (e)=>{if(isOverUI(e.clientX,e.clientY)) return;canvas.setPointerCapture(e.pointerId);activePointers.set(e.pointerId, {x:e.clientX, y:e.clientY});if(activePointers.size===1){panPointerId = e.pointerId;}else if(activePointers.size===2){const pts=[...activePointers.values()];pinchBaseDist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);pinchBaseZoom = ZOOM;pinchCx = (pts[0].x + pts[1].x)/2;pinchCy = (pts[0].y + pts[1].y)/2;panPointerId = null;}}, {passive:true});
  canvas.addEventListener('pointermove', (e)=>{if(!activePointers.has(e.pointerId)) return;const prev = activePointers.get(e.pointerId);activePointers.set(e.pointerId, {x:e.clientX, y:e.clientY});if(activePointers.size===1 && panPointerId===e.pointerId){const dx = (e.clientX - prev.x)/ZOOM;const dy = (e.clientY - prev.y)/ZOOM;cam.x -= dx; cam.y -= dy; clampCam();}else if(activePointers.size===2){const pts=[...activePointers.values()];const dist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y) || 1;const factor = dist / (pinchBaseDist||dist);setZoom(pinchBaseZoom * factor, pinchCx, pinchCy);}}, {passive:true});
  const clearPointer = (id)=>{if(!activePointers.has(id)) return;activePointers.delete(id);if(panPointerId===id) panPointerId=null;if(activePointers.size<2){ pinchBaseDist=0; }};
  canvas.addEventListener('pointerup',   e=> clearPointer(e.pointerId), {passive:true});
  canvas.addEventListener('pointercancel', e=> clearPointer(e.pointerId), {passive:true});
  $("#zoomIn").onclick = ()=> setZoom(ZOOM+ZSTEP, canvas.width/2, canvas.height/2);
  $("#zoomOut").onclick= ()=> setZoom(ZOOM-ZSTEP, canvas.width/2, canvas.height/2);

  // Mapeo directo de imágenes para edificaciones
const BUILDING_IMAGES = {
  // Instituciones gubernamentales con URLs corregidas
  parque: 'https://i.postimg.cc/C52F49Yd/20250827-033954.jpg',
  escuela: 'https://i.postimg.cc/x1PTBFPx/escuela.png', // URL alternativa 
  biblioteca: 'https://i.postimg.cc/pdYZwHmh/biblioteca.png',
  policia: 'https://i.postimg.cc/YCHr4sgt/policia.png',
  hospital: 'https://i.postimg.cc/y8yV0yXc/hospital.png',
  central_electrica: 'https://i.postimg.cc/8zfXn9dM/electrica.png', // ACTUALIZADA
  cemetery: 'https://i.postimg.cc/0NzPkDMD/20250827-081702.jpg',
  // Edificios generales
  house: 'https://i.postimg.cc/BQpptNmR/20250827-030930.png',
  bank: 'https://i.postimg.cc/4x5TcfRw/banco.png',
  factory: 'https://i.postimg.cc/y8JFgdRC/20250826-102250.png',
  mall: 'https://i.postimg.cc/13ykskVF/mall.png',
  shop: 'https://i.postimg.cc/Bnd2x05L/20250827-071843.png',
  
  // Gobierno
  gobierno: 'https://i.postimg.cc/PJ2mZvKT/20250826-103751.png',
  
  // Tiendas específicas
  panadería: 'https://i.postimg.cc/sDHYgSvJ/20250827-065353.png',
  bar: 'https://i.postimg.cc/Pqfdyv2c/Bar.png',
  
  // Nuevas URLs agregadas para negocios faltantes
  kiosco: 'https://i.postimg.cc/xjp7LhNK/kiosco.png',
  juguería: 'https://i.postimg.cc/Y0TbTcQZ/jugo.png',
  cafetería: 'https://i.postimg.cc/J4gfCv11/cafeteria.png',
  heladería: 'https://i.postimg.cc/Bnd2x05L/20250827-071843.png',
  pizzería: 'https://i.postimg.cc/nhb3kJFQ/pizzería.png',
  librería: 'https://i.postimg.cc/jSncineclubrWK8w/librería.png',
  juguetería: 'https://i.postimg.cc/P5W2VRJV/jugueteria.png',
  'yoga studio': 'https://i.postimg.cc/8Ps23NgK/yoga_estudio.png',
  'dance hall': 'https://i.postimg.cc/Nfj8tbfM/20250827-071830.png',
  'tienda deportes': 'https://i.postimg.cc/XvWDV0t0/deportes.png',
  'arte & galería': 'https://i.postimg.cc/VvZ36HnW/galeria.png',
  cineclub: 'https://i.postimg.cc/8cz2TVJC/cine_club.png',
  'gamer zone': 'https://i.postimg.cc/c48DwHSS/gamer.png',
  senderismo: 'https://i.postimg.cc/PrxHj1YM/senderismo.png',
  'foto-lab': 'https://i.postimg.cc/pVkv4shT/foto_club.png',
  'astro club': 'https://i.postimg.cc/c4bS46cG/astro_club.png',
  restaurante: 'https://i.postimg.cc/vHwKPbTd/20250827_070529.png',
  
  // Otras instituciones
  bomberos: 'https://i.postimg.cc/KYzPHMhV/bomberos.png', // ACTUALIZADA
  universidad: 'https://i.imgur.com/hvsZIsB.png', // URL alternativa
  tribunal: 'https://i.imgur.com/zZ8FVOB.png', // URL alternativa
  teatro: 'https://i.postimg.cc/Nfj8tbfM/20250827-071830.png',
  estadio: 'https://i.imgur.com/BtFQu1V.png' // URL alternativa
};

// Precarga de imágenes para mejor rendimiento
const BUILDING_IMAGE_CACHE = {};

function preloadImages() {
  console.log("Iniciando precarga de imágenes con manejo de errores mejorado...");
  
  for (const key in BUILDING_IMAGES) {
    try {
      const img = new Image();
      
      img.onload = function() {
        console.log(`Imagen cargada: ${key}`);
      };
      
      img.onerror = function() {
        console.warn(`Error al cargar la imagen: ${key}. Usando fallback.`);
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

  /* ===== CONFIGURACIÓN ===== */
  const CFG = {
  LINES_ON:true, PARKS:4, SCHOOLS:4, FACTORIES:6, BANKS:4, MALLS:2, HOUSE_SIZE:70, CEM_W:220, CEM_H:130, N_INIT:10,  // Aumentado HOUSE_SIZE de 22 a 70
    R_ADULT:3.0, R_CHILD:2.4, R_ELDER:3.0, SPEED:60, WORK_DURATION:10, EARN_PER_SHIFT:15, WORK_COOLDOWN:45,
    YEARS_PER_SECOND:1/86400, ADULT_AGE:18, ELDER_AGE:65, DEATH_AGE:90,
    HOUSE_BUY_COST:3000,
    GOV_TAX_EVERY: 20*60,      // cada 20 min
    WEALTH_TAX_BASE: 0.01,     // 1.0% base
    INSTITUTION_TAX_PER: 0.001,// +0.1% por institución
    WEALTH_TAX_MAX: 0.06,      // 6% tope de seguridad
    EMPLOYEE_SALARY: 25, SALARY_PAY_EVERY: 120,
    GOV_RENT_EVERY: 10*60, GOV_RENT_AMOUNT: 5, 
    COST_ROAD: 40,
    COST_PARK: 80, COST_SCHOOL: 120, COST_LIBRARY: 150, COST_POLICE: 200, COST_HOSPITAL: 250, COST_POWER: 350,
    SHOP_W:120, SHOP_H:80, VISIT_RADIUS:220, VISIT_RATE: 0.003, PRICE_MIN:1, PRICE_MAX:3,
    SHOP_DWELL: 5, NEW_SHOP_FORCE_WINDOW: 120,
    SHOP_PAYOUT_CHUNK: 100,
    OWNER_MANAGE_VS_WORK_RATIO: 0.3, // 30% de probabilidad de gestionar negocio vs trabajar
  };

  const VEHICLES = {
    bicicleta:      { name:'Bicicleta',      cost:50,   speed: 100, icon:'🚲' },
    moto:           { name:'Motocicleta',    cost:200,  speed: 180, icon:'🛵' },
    auto_compacto:  { name:'Auto Compacto',  cost:800,  speed: 260, icon:'🚗' },
    auto_deportivo: { name:'Auto Deportivo', cost:2500, speed: 360, icon:'🏎️' }
  };

  /* ===== Tipos de Instituciones (25) ===== */
  const GOV_TYPES = [
    {k:'parque', label:'Parque', cost:CFG.COST_PARK, w:130,h:90, icon:'🌳', fill:'rgba(12,81,58,0.92)', stroke:'rgba(31,122,90,0.95)'},
    {k:'escuela', label:'Escuela', cost:CFG.COST_SCHOOL, w:140,h:95, icon:'📚', fill:'rgba(51,65,85,0.92)', stroke:'rgba(148,163,184,0.95)'},
    {k:'biblioteca', label:'Biblioteca', cost:CFG.COST_LIBRARY, w:140,h:90, icon:'📖', fill:'#a16207', stroke:'#fde047'},
    {k:'policia', label:'Policía', cost:CFG.COST_POLICE, w:150,h:80, icon:'🚓', fill:'#3b82f6', stroke:'#dbeafe'},
    {k:'hospital', label:'Hospital', cost:CFG.COST_HOSPITAL, w:180,h:100, icon:'🏥', fill:'#f1f5f9', stroke:'#ef4444'},
    {k:'central_electrica', label:'Central Eléctrica', cost:CFG.COST_POWER, w:200,h:120, icon:'⚡', fill:'#475569', stroke:'#facc15'},
    {k:'bomberos', label:'Cuerpo de Bomberos', cost:220, w:160,h:85, icon:'🚒', fill:'#7c2d12', stroke:'#fecaca'},
    {k:'registro_civil', label:'Registro Civil', cost:180, w:150,h:85, icon:'🪪', fill:'#0f172a', stroke:'#94a3b8'},
    {k:'universidad', label:'Universidad Pública', cost:300, w:200,h:120, icon:'🎓', fill:'#1e293b', stroke:'#93c5fd'},
    {k:'tribunal', label:'Tribunal / Corte', cost:260, w:170,h:95, icon:'⚖️', fill:'#111827', stroke:'#9ca3baf'},
    {k:'museo', label:'Museo', cost:200, w:160,h:90, icon:'🏛️', fill:'#3f3f46', stroke:'#cbd5e1'},
    {k:'teatro', label:'Teatro', cost:190, w:160,h:90, icon:'🎭', fill:'#1f2937', stroke:'#9ca3baf'},
    {k:'estadio', label:'Estadio', cost:350, w:230,h:140, icon:'🏟️', fill:'#0b3a1e', stroke:'#10b981'},
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
  const SHOP_TYPES = [
      {k:'panadería', icon:'🥖', like:'pan', price:1, buyCost: 400},
      {k:'kiosco', icon:'🏪', like:'kiosco', price:1, buyCost: 450},
      {k:'juguería', icon:'🥣', like:'jugos', price:1, buyCost: 500},
      {k:'cafetería', icon:'☕', like:'café', price:2, buyCost: 800},
      {k:'heladería', icon:'🍨', like:'helado', price:2, buyCost: 850},
      {k:'pizzería', icon:'🍕', like:'pizza', price:2, buyCost: 900},
      {k:'librería', icon:'📚', like:'libros', price:2, buyCost: 1000},
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
        shops.length = 0;
        shops.push(...payload.shops);
      }
    }catch(e){ console.warn('applyServerState error', e); }
  }

  /* Utils */
  const randi=(a,b)=> (Math.random()*(b-a)+a)|0, rand=(a,b)=> a + Math.random()*(b-a), clamp=(v,a,b)=> Math.max(a,Math.min(b,v));
  const centerOf=r=> ({x:r.x+r.w/2, y:r.y+r.h/2});
  const rectsOverlap=(a,b)=> !(a.x+a.w<=b.x || b.x+b.w<=a.x || a.y+a.h<=b.y || b.y+b.h<=a.y);
  const inside=(pt,r)=> pt.x>=r.x && pt.x<=r.x+r.w && pt.y>=r.y && pt.y<=r.y+r.h;
  const rectsOverlapWithMargin = (rectA, rectB, margin) => {
    const paddedB = { x: rectB.x - margin, y: rectB.y - margin, w: rectB.w + margin*2, h: rectB.h + margin*2 };
    return rectsOverlap(rectA, paddedB);
  };

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
  const grid = {
    cols: Math.floor(Math.sqrt(n * zone.w / zone.h)),
    rows: Math.ceil(Math.sqrt(n * zone.h / zone.w))
  };
  
  // Asegurar que tengamos suficientes celdas
  while (grid.cols * grid.rows < n) {
    grid.cols++;
  }
  
  const cellWidth = zone.w / grid.cols;
  const cellHeight = zone.h / grid.rows;
  
  let count = 0;
  let maxTries = 100; // Límite de intentos
  
  // Intenta colocar edificios en cada celda
  for (let row = 0; row < grid.rows && count < n; row++) {
    for (let col = 0; col < grid.cols && count < n; col++) {
      let tries = 0;
      let placed_in_cell = false;
      
      while (!placed_in_cell && tries < maxTries) {
        tries++;
        
        // Tamaño del edificio
        const w = srandi(wmin, wmax);
        const h = srandi(hmin, hmax);
        
        // Posición dentro de la celda con un margen
        const cellMargin = margin / 2;
        const x = zone.x + col * cellWidth + srandi(cellMargin, cellWidth - w - cellMargin);
        const y = zone.y + row * cellHeight + srandi(cellMargin, cellHeight - h - cellMargin);
        
        const rect = {x, y, w, h};
        
        // Verificar colisiones
        let collision = false;
        
        // Comprobar colisión con edificios a evitar
        for (const avoidRect of avoid) {
          if (rectsOverlapWithMargin(rect, avoidRect, margin)) {
            collision = true;
            break;
          }
        }
        
        // Comprobar colisión con edificios ya colocados
        if (!collision) {
          for (const placedRect of placed) {
            if (rectsOverlapWithMargin(rect, placedRect, margin)) {
              collision = true;
              break;
            }
          }
        }
        
        // Si no hay colisiones, colocar el edificio
        if (!collision) {
          placed.push(rect);
          placed_in_cell = true;
          count++;
        }
      }
    }
  }
  
  // Si no pudimos colocar todos, intentar rellenar los que faltan
  if (count < n) {
    const remaining = scatterRects(
      n - count,
      widthRange,
      heightRange,
      [...avoid, ...placed],
      zone,
      margin
    );
    placed.push(...remaining);
  }
  
  return placed;
}

  function makeBarriosYCasas(totalNeeded, urbanArea, avoidList = []) {
    barrios.length = 0;
    houses.length = 0;
    cityBlocks.length = 0;

    // Casas en 4 barrios organizados simétricamente
    barrios.length = 0; 
    houses.length = 0; 
    cityBlocks.length = 0;

    const barrioMargin = 40; // Margen desde los bordes
    const barrioSize = {
      w: 380, 
      h: 320
    };

    // Posiciones más simétricas para los barrios
    const barriosPos = [
      {x: barrioMargin, y: barrioMargin}, // Noroeste
      {x: WORLD.w - barrioSize.w - barrioMargin, y: barrioMargin}, // Noreste
      {x: barrioMargin, y: WORLD.h - barrioSize.h - barrioMargin}, // Suroeste
      {x: WORLD.w - barrioSize.w - barrioMargin, y: WORLD.h - barrioSize.h - barrioMargin} // Sureste
    ];

    // Crear los barrios equidistantes
    for(let i=0; i<4; i++){
      const b = {
        ...barriosPos[i], 
        w: barrioSize.w, 
        h: barrioSize.h, 
        name: `Barrio ${i+1}`
      };
      barrios.push(b);
      cityBlocks.push(b);
    }
    // Distribuir casas en los 4 barrios con tamaños variables más grandes
    const pad = 24; // Aumentado padding de 18 a 24 para más espacio
    let totalMade = 0;
    const housesPerBarrio = Math.ceil(totalNeeded / barrios.length);
    for (const b of barrios) {
      let madeInThisBarrio = 0;
      // Usar tamaños variables: 60-90 píxeles para variar como otras edificaciones
      const minHouseSize = 60, maxHouseSize = 90;
      const colsH = Math.max(4, Math.floor((b.w - pad * 2) / (maxHouseSize + 15))); // Ajustado para tamaños mayores
      const rowsH = Math.max(3, Math.floor((b.h - pad * 2) / (maxHouseSize + 15)));
      for (let ry = 0; ry < rowsH && madeInThisBarrio < housesPerBarrio && totalMade < totalNeeded; ry++) {
        for (let rx = 0; rx < colsH && madeInThisBarrio < housesPerBarrio && totalMade < totalNeeded; rx++) {
          // Tamaño aleatorio para cada casa (como fábricas o bancos)
          const hsize = srandi(minHouseSize, maxHouseSize);
          const hx = b.x + pad + rx * (maxHouseSize + 15); // Usar max para espaciado consistente
          const hy = b.y + pad + ry * (maxHouseSize + 15);
          const newH = { x: hx, y: hy, w: hsize, h: hsize, ownerId: null, rentedBy: null };
          if ([...avenidas, ...roundabouts].some(av => rectsOverlapWithMargin(av, newH, 8))) continue;
          houses.push(newH);
          totalMade++; madeInThisBarrio++;
        }
      }
    }
  }

  function buildAvenidas(urbanArea, avoidRect = null){
    avenidas.length=0; roundabouts.length=0;
    const avW=26;
    const vDivs = 4, hDivs = 3;
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
      
      // Generar parques pequeños distribuidos por el mapa
      const parksCount = 8; // aumentado de los 8 originales
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
    }

    // Cementerio alejado (esquina inferior derecha)
    cemetery.x = WORLD.w - cemetery.w - 40;
    cemetery.y = WORLD.h - cemetery.h - 40;

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
    const initialGovTypes = ['escuela', 'hospital', 'policia', 'biblioteca'];
    for(const typeKey of initialGovTypes) {
        const type = GOV_TYPES.find(t => t.k === typeKey);
        if(type) {
            const newBuildings = scatterRects(2, [type.w, type.w], [type.h, type.h], avoidList, null, 50);
            newBuildings.forEach(b => government.placed.push({...type, ...b, icon: type.icon.repeat(3)}));
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

    // Distribuir instituciones gubernamentales uniformemente
    const govTypes = ['escuela', 'hospital', 'policia', 'biblioteca', 'central_electrica', 'bomberos'];
    const placedGovBuildings = [];
    let zoneIndex = 3; // Comenzamos con la última zona

    for(const typeKey of govTypes) {
      const type = GOV_TYPES.find(t => t.k === typeKey);
      if(type) {
        const zone = urbanZones[zoneIndex % urbanZones.length];
        zoneIndex++;
        
        const positions = distributeEvenly(
          2, // Dos de cada tipo
          [type.w, type.w],
          [type.h, type.h],
          [...avoidList, ...placedGovBuildings],
          zone,
          sameTypeDist
        );
        
        positions.forEach(pos => {
          const govBuilding = {...type, ...pos, icon: type.icon.repeat(3)};
          government.placed.push(govBuilding);
          placedGovBuildings.push(govBuilding);
        });
      }
    }

    // Agregar todos los edificios gubernamentales a la lista de evitación
    avoidList.push(...placedGovBuildings);
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
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 2 * ZOOM;
    ctx.textAlign = 'left'; ctx.fillText(label, p.x + 10 * ZOOM, p.y + 20 * ZOOM);
    ctx.font = `700 ${Math.max(10, iconSize * ZOOM)}px system-ui,Segoe UI,Arial,emoji`;
    ctx.textAlign = 'center';
    const iconX = p.x + (rect.w * ZOOM) - (10 * ZOOM);
    const iconY = p.y + (rect.h * ZOOM) / 2 + (iconSize * 0.18) * ZOOM;
    ctx.fillText(emoji, iconX, iconY);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
  }
  function drawGrid(){
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
      const p=toScreen(av.x,av.y);
      ctx.fillStyle='rgba(75,85,99,0.95)'; ctx.fillRect(p.x,p.y,av.w*ZOOM,av.h*ZOOM);
      ctx.strokeStyle='rgba(156,163,175,0.95)'; ctx.lineWidth=2*ZOOM; ctx.strokeRect(p.x,p.y,av.w*ZOOM,av.h*ZOOM);
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
      const p=toScreen(b.x,b.y);
      ctx.fillStyle='rgba(12,18,42,0.55)'; ctx.fillRect(p.x,p.y,b.w*ZOOM,b.h*ZOOM);
      ctx.strokeStyle='rgba(51,65,85,0.9)'; ctx.lineWidth=2*ZOOM; ctx.strokeRect(p.x,p.y,b.w*ZOOM,b.h*ZOOM);
      ctx.font=`700 ${Math.max(10,14*ZOOM)}px system-ui,Segoe UI`; ctx.fillStyle='rgba(147,197,253,0.95)';
      ctx.fillText(b.name, p.x+8*ZOOM, p.y+18*ZOOM);
    }
  }

  function drawWorld(){
    ctx.fillStyle = '#0b1220';ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawGrid(); drawAvenidas(); drawRoundabouts();
    for(const r of roadRects){const p=toScreen(r.x,r.y);ctx.fillStyle='rgba(75,85,99,0.95)';ctx.fillRect(p.x,p.y,r.w*ZOOM,r.h*ZOOM);ctx.strokeStyle='rgba(156,163,175,0.9)';ctx.lineWidth=1*ZOOM; ctx.strokeRect(p.x,p.y,r.w*ZOOM,r.h*ZOOM);}

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
    shops.forEach(s => {
      drawBuildingWithImage(s, s.kind, '#8B5CF6', '#c4b5fd');
    });

    for(const inst of government.placed){
      if(inst.k === 'gobierno'){
        const p = toScreen(inst.x, inst.y);
        const w = inst.w * 2 * ZOOM, h = inst.h * 2 * ZOOM;
        // Centrar la imagen en el mismo punto central
        const px = p.x + (inst.w * ZOOM)/2 - w/2;
        const py = p.y + (inst.h * ZOOM)/2 - h/2;
        
        // Usar la imagen del objeto BUILDING_IMAGES
        const img = BUILDING_IMAGE_CACHE['gobierno'];
        
        if (img && img.complete && img.naturalWidth !== 0 && !img.error) {
          // Si la imagen está cargada correctamente, dibujarla
          ctx.drawImage(img, px, py, w, h);
        } else {
          // Fallback si la imagen no está disponible
          ctx.fillStyle = 'rgba(0, 82, 204, 0.8)';
          ctx.fillRect(px, py, w, h);
          ctx.strokeStyle = '#60a5fa';
          ctx.lineWidth = 2;
          ctx.strokeRect(px, py, w, h);
          ctx.fillStyle = 'white';
          ctx.textAlign = 'center';
          ctx.font = `700 ${Math.max(10, 14 * ZOOM)}px system-ui,Segoe UI`;
          ctx.fillText('GOBIERNO', px + w/2, py + h/2);
        }
      } else if(inst.k === 'carcel'){
        const p = toScreen(inst.x, inst.y);
        const w = inst.w * ZOOM, h = inst.h * ZOOM;
        ctx.fillStyle = 'rgba(20,20,20,0.9)';
        ctx.fillRect(p.x, p.y, w, h);
        ctx.fillStyle = 'rgba(220,220,220,0.95)';
        const bars = Math.max(3, Math.floor(inst.w/10));
        for(let i=0;i<bars;i++){ const bx = p.x + 6*ZOOM + i * (w - 12*ZOOM) / Math.max(1,bars-1); ctx.fillRect(bx, p.y+6*ZOOM, 3*ZOOM, h - 12*ZOOM); }
        ctx.fillStyle = '#fff'; ctx.font=`700 ${Math.max(10, 14*ZOOM)}px system-ui`; ctx.textAlign='center'; ctx.fillText('CÁRCEL', p.x + w/2, p.y + 18*ZOOM);
      } else {
        // Usar drawBuildingWithImage en lugar de drawLabelIcon
        drawBuildingWithImage(inst, inst.k, inst.fill, inst.stroke);
        
        // Mantener el nombre encima de la imagen para mayor claridad
        if (ZOOM >= 0.8) {
          const p = toScreen(inst.x, inst.y);
          ctx.font = `700 ${Math.max(8, 10 * ZOOM)}px system-ui,Segoe UI`;
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText(inst.label, p.x + (inst.w * ZOOM)/2, p.y + 12 * ZOOM);
        }
      }
    }

    houses.forEach(h => {
      drawBuildingWithImage(h, 'house', '#334155', h.ownerId ? '#22d3ee' : '#94a3b8');
    });
  }

  function drawSocialLines() {
    if (!SHOW_LINES || !socialConnections.length) return;
    ctx.lineWidth = 1.5 * ZOOM;
    for (const conn of socialConnections) {
      const pa = toScreen(conn.a.x, conn.a.y);
      const pb = toScreen(conn.b.x, conn.b.y);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
      let color = 'rgba(148,163,184,0.55)';
      if (conn.matches === 3) color = 'rgba(252, 165, 165, 0.8)';
      else if (conn.matches === 4) color = 'rgba(244, 63, 94, 0.9)';
      else if (conn.matches >= 5) color = 'rgba(220, 38, 38, 1.0)';
      ctx.strokeStyle = color; ctx.stroke();
    }
  }
  function updateSocialLogic() {
    const newConnections = [];
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
      ctx.beginPath();
      const r = (p.state==='child'?CFG.R_CHILD:CFG.R_ADULT)*ZOOM;
      ctx.arc(pt.x, pt.y, r, 0, Math.PI*2);
      ctx.fillStyle = (p.gender==='M') ? '#93c5fd' : '#fda4af';
      ctx.fill();
      if (ZOOM >= 0.7) {
        ctx.font = `700 ${Math.max(8,12*ZOOM)}px ui-monospace,monospace`;
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        ctx.fillText(`${p.code||'P'}`, pt.x, pt.y - 8*ZOOM);
      }
    }
  }

  let __lastTime = performance.now();
  function loop(){
    if(!STARTED){ requestAnimationFrame(loop); return; }
    const nowMs = performance.now();
    let dt = (nowMs - __lastTime) / 1000; __lastTime = nowMs; dt = Math.min(dt, 0.05);
    frameCount++;
    updateSocialLogic();
    drawWorld();
    drawSocialLines();

    // ======= Jugadores remotos con smoothing nuevo =======
    try{ renderRemotePlayers(); }catch(e){}

    const nowS = performance.now()/1000;

    for(const a of agents){
      // Only render the local player (not remote ones)
      if (a.id !== USER_ID) continue;
      a.cooldownSocial = Math.max(0, a.cooldownSocial - dt);
      if (a.employedAtShopId) {
        const myWorkplace = shops.find(s => s.id === a.employedAtShopId);
        if (myWorkplace) { a.target = centerOf(myWorkplace); a.targetRole = 'work_shop'; }
      }
      if (!a.forcedShopId && !a.workingUntil && !a.goingToBank && !a.employedAtShopId && (!a.targetRole || a.targetRole==='idle') && nowS >= (a.nextWorkAt || 0)) {
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
        a.workingUntil=null; a.pendingDeposit += CFG.EARN_PER_SHIFT; a.goingToBank=true;
        const b=banks[(Math.random()*banks.length)|0]; if(b){ a.target=centerOf(b); a.targetRole='bank'; }
      }
      if(a.goingToBank && a.target){
        const c=a.target; if(Math.hypot(a.x-c.x,a.y-c.y)<14){
          a.money += a.pendingDeposit; a.pendingDeposit=0; a.goingToBank=false; a.nextWorkAt = nowS + CFG.WORK_COOLDOWN;
          if(a.houseIdx!=null){ const h=houses[a.houseIdx]; if(h) a.target=centerOf(h), a.targetRole='home'; else a.target=null, a.targetRole='idle'; }
          else { a.target=null, a.targetRole='idle'; }
        }
      }
      if(!a.forcedShopId && !a.workingUntil && !a.goingToBank && !a.employedAtShopId && (!a.targetRole || a.targetRole==='idle' || a.targetRole==='home')) {
        if (!a.forcedShopId && Math.random() < CFG.VISIT_RATE) {
          const liked = shops.filter(s=> a.likes.includes(s.like) && s.ownerId !== a.id);
          if(liked.length){



            let best=null, bestD=1e9;
            for(const s of liked){
              const d=Math.hypot(a.x-(s.x+s.w/2), a.y-(s.y+s.h/2));
              if(d<bestD && d<CFG.VISIT_RADIUS){ best=s; bestD=d; }
            }
            if(best){ a.target={x:best.x+best.w/2,y:best.y+best.h/2}; a.targetRole='shop'; a._shopTargetId = best.id; }
          }
        }
      }
      if(a.targetRole==='shop' && a.target){
        const c=a.target;
        if(Math.hypot(a.x-c.x,a.y-c.y)<16){
          const s = shops.find(q=>q.id===a._shopTargetId);
          if(s){ const price = clamp(s.price, CFG.PRICE_MIN, CFG.PRICE_MAX); if(a.money>=price){ a.money-=price; const bonus = Math.round((s.buyCost || 0) * CFG.SHOP_PROFIT_FACTOR); const saleProfit = price + bonus; s.cashbox = (s.cashbox || 0) + saleProfit; } }
          a.target=null; a.targetRole='idle'; a._shopTargetId=null;
        }
      }
      if(a.targetRole==='manage_shop' && a.target){
        const c=a.target;
        if(Math.hypot(a.x-c.x,a.y-c.y)<16){
          const s = shops.find(q => q.id === a._shopTargetId);
          const paid = payoutChunkToOwner(s, CFG.SHOP_PAYOUT_CHUNK);
          if(!paid){ toast(`${a.code} gestionó ${s?.kind ?? 'su negocio'}, pero la caja no alcanza ${CFG.SHOP_PAYOUT_CHUNK}.`); }
          a.nextWorkAt = nowS + CFG.WORK_COOLDOWN; a.target=null; a.targetRole='idle'; a._shopTargetId=null;
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
        }
      }
      if(a.target){
        const t = a.target;
        let dx = t.x - a.x, dy = t.y - a.y;
        const dd = Math.hypot(dx, dy) || 1;
        const nx = dx / dd, ny = dy / dd;
        a.vx = nx * currentSpeed; a.vy = ny * currentSpeed;
        if (dd < 6) {
          if (['work', 'work_shop', 'home'].includes(a.targetRole)) { a.target = null; a.targetRole = 'idle'; }
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
      ctx.beginPath(); ctx.arc(p.x,p.y, (a.state==='child'?CFG.R_CHILD:CFG.R_ADULT)*ZOOM, 0, Math.PI*2);
      ctx.fillStyle = (a.gender==='M')?'#93c5fd':'#fda4af';
      ctx.fill();
      if ( a.id === USER_ID) { ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2 * ZOOM; ctx.stroke(); }
      if (a.justMarried && (performance.now() - a.justMarried < 5000)) {
          ctx.font=`700 ${Math.max(12, 18*ZOOM)}px system-ui,Segoe UI,Arial,emoji`;
          ctx.textAlign='center'; ctx.fillText('💕', p.x, p.y - 25 * ZOOM);
      } else if (a.justMarried) { a.justMarried = null; }
      if (ZOOM >= 0.7) {
        ctx.font=`700 ${Math.max(8,12*ZOOM)}px ui-monospace,monospace`;
        ctx.fillStyle='#fff'; ctx.textAlign='center';
        const age = (yearsSince(a.bornEpoch)|0);
        ctx.fillText(`${a.code}·${age}`, p.x, p.y-8*ZOOM);
      }
    }
    const total$=Math.round(agents.reduce((s,x)=>s+(x.money||0),0));
    const instCount = government.placed.length;
    stats.textContent = `Pob: ${agents.length} | $ total: ${total$} | 🏛️ Fondo: ${Math.floor(government.funds)} | 🏪 ${shops.length} | Instituciones: ${instCount}/25`;
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
    if (player) lines.push(`Jugador (${player.code}): $${Math.floor(player.money)}`);
    const otherAgents = agents.filter(a => a.id !== USER_ID && a.state !== 'child');
    if (otherAgents.length > 0) {
        if (player) lines.push('---');
        const agentLines = otherAgents.map(a => `${a.code}: $${Math.floor(a.money)}`);
        lines.push(...agentLines.sort());
    }
    return lines.join('\n') || 'Sin fondos por ahora.';
  }
  function fullDocument(){
    const total$=Math.round(agents.reduce((s,x)=>s+(x.money||0),0));
    const player = agents.find(a => a.id === USER_ID);
    const playerName = player ? player.code : '—';
    const lines=[];
    lines.push('# Documento');
    lines.push(`Jugador: ${playerName}`);
  // Quitar la línea antigua de población, solo mostrar créditos, fondo, negocios e instituciones
  lines.push(`Total créditos: ${total$} — Fondo Gobierno: ${Math.floor(government.funds)} — Negocios: ${shops.length} — Instituciones: ${government.placed.length}`);
    lines.push('');
    lines.push('## Usuarios en el mundo (tiempo real)');
    // Mostrar todos los usuarios conectados en tiempo real (de gameState)
    let users = [];
    if (window.gameState && Array.isArray(window.gameState.players)) {
      users = window.gameState.players;
    } else {
      users = agents;
    }
    // Filtrar solo humanos (no bots) y no niños si quieres
    const filtered = users.filter(u => !u.isBot && (!u.state || u.state !== 'child'));
    lines.push(`Población conectada: ${filtered.length}`);
    if(filtered.length > 0){
      for(const u of filtered){
        lines.push(`- ${u.code || u.name || u.id}`);
      }
    }else{
      lines.push('No hay usuarios conectados.');
    }
    lines.push('');
    lines.push('## Finanzas por Agente');
    lines.push(bankReport());
    return lines.join('\n');
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

  btnShowDoc.onclick = ()=>{
    const isVisible = docDock.style.display === 'flex';
    if (!isVisible) {
      // Actualizar el documento cada segundo mientras está abierto
      if(!window.__docInterval){
        window.__docInterval = setInterval(()=>{
          $("#docBody").textContent = fullDocument();
        }, 1000);
      }
      $("#docBody").textContent = fullDocument();
      docDock.style.display = 'flex';
    } else {
      docDock.style.display = 'none';
      if(window.__docInterval){
        clearInterval(window.__docInterval);
        window.__docInterval = null;
      }
    }
  };
  btnShowMarried.onclick = ()=>{ const isVisible = marriedDock.style.display === 'flex'; if (!isVisible) { $("#marriedList").textContent = generateMarriedList(); marriedDock.style.display = 'flex'; } else { marriedDock.style.display = 'none'; } }; $("#btnShowGov").onclick = ()=>{ const isVisible = govDock.style.display === 'flex'; if (!isVisible) { govDock.style.display = 'flex'; populateGovSelect(); } else { govDock.style.display = 'none'; } };
  $("#uiHideBtn").onclick = ()=>{ $("#uiDock").style.transform='translateY(-130%)'; show($("#uiShowBtn"),true); };
  $("#uiShowBtn").onclick = ()=>{ $("#uiDock").style.transform='translateY(0)'; show($("#uiShowBtn"),false); };
  panelDepositAll.onclick = ()=>{ if(!USER_ID){ toast('Crea tu persona primero.'); return; } const u=agents.find(a=>a.id===USER_ID); if(!u) return; u.money += (u.pendingDeposit||0); u.pendingDeposit=0; accBankBody.innerHTML = `Saldo de ${u.code}: <span class="balance-amount">${Math.floor(u.money)}</span>`; toast('Depósito realizado.'); };

  function setVisibleWorldUI(on){
    $("#formBar").style.display = on ? 'none' : 'block';
    canvas.style.display = on ? 'block':'none';
    uiDock.style.display = on ? 'flex':'none';
    topBar.style.display = on ? 'flex':'none';
    zoomFab.style.display = on ? 'flex':'none';
    mini.style.display = on ? 'block':'none';
    show($("#uiShowBtn"),false);
    docDock.style.display = 'none'; govDock.style.display = 'none';
  }

  function startWorldWithUser({name,gender,age,likes,usd}){
    $("#formBar").style.display='none'; 
    setVisibleWorldUI(true); 
    STARTED=true; 
    setWorldSize(); 
    fitCanvas(); 
    regenInfrastructure(false);
    populateGovSelect(); // ← AÑADIR ESTA LÍNEA
    
    const addCredits = Math.max(0, parseInt(usd||'0',10))*100;
    let startMoney = 400 + addCredits;
    const user=makeAgent('adult',{name, gender, ageYears:age, likes, startMoney: startMoney});
    try{ user.avatar = (gender === 'M') ? 'https://i.postimg.cc/x8cc0drr/20250820-102743.png' : 'https://i.postimg.cc/C1vRTqQH/20250820-103145.png'; }catch(e){}
    agents.push(user); USER_ID=user.id;
    try{ window.sockApi?.createPlayer({ code: user.code, gender: user.gender, avatar: user.avatar, startMoney: Math.floor(user.money||0) }, ()=>{}); }catch(e){}
    if(!hasNet()){
      for(let i=0;i<CFG.N_INIT;i++) {agents.push(makeAgent('adult',{ageYears:rand(18,60)}));}
    }
    agents.forEach(a => { if (assignRental(a)) { const home = houses[a.houseIdx]; if (home) { a.target = centerOf(home); a.targetRole = 'home'; } } });
    const b0=cityBlocks[0]; if(b0){ cam.x = Math.max(0, b0.x - 40); cam.y = Math.max(0, b0.y - 40); clampCam(); }
    updateGovDesc();
    try{ const uiAvatar = document.getElementById('uiAvatar'); if(uiAvatar && user.avatar) uiAvatar.src = user.avatar; const userName = document.getElementById('userName'); if(userName) userName.textContent = user.code || user.name || 'Usuario'; }catch(e){}
    loop();
  }
  const startHandler = ()=>{const name=fName.value.trim(),gender=fGender.value,age=Math.max(0, Math.min(120, parseInt(fAge.value||'0',10))),likes=getChecked().map(x=>x.value),usd=fUsd.value;if(!name || likes.length!==5){ errBox.style.display='inline-block'; toast('Completa nombre y marca 5 gustos.'); return; }errBox.style.display='none';startWorldWithUser({name,gender,age,likes,usd});};
  btnStart.addEventListener('click', startHandler);
  $("#formInner").addEventListener('submit',(e)=>{ e.preventDefault(); startHandler(); });

  
  canvas.addEventListener('click', (e)=>{
    if(!STARTED) return;
    const rect = canvas.getBoundingClientRect(); const pt = toWorld(e.clientX-rect.left, e.clientY-rect.top);
    if(isOverUI(e.clientX,e.clientY)) return;

  const allBuildings = [cemetery,government,...banks,...malls,...factories,...houses,...(window.__netHouses||[]),...roadRects,...shops, ...avenidas, ...roundabouts, ...government.placed];

    if(placingHouse){
      const u=agents.find(a=>a.id===placingHouse.ownerId); if(!u){ placingHouse=null; return; }
      const newH = {x: pt.x - placingHouse.size.w/2, y: pt.y - placingHouse.size.h/2, w: placingHouse.size.w, h: placingHouse.size.h, ownerId:u.id, rentedBy:null};
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
      toast('Casa propia construida 🏠'); return;
    }
    if(placingShop){
      const u=agents.find(a=>a.id===placingShop.ownerId); if(!u){ placingShop=null; return; }
      const rectShop = {x: pt.x - placingShop.size.w/2, y: pt.y - placingShop.size.h/2, w: placingShop.size.w, h: placingShop.size.h};
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
          if(res?.ok){ u.money -= placingShop.price; newShop.id='S'+(shops.length+1); newShop.cashbox=0; shops.push(newShop); placingShop=null; toast('Negocio colocado 🏪'); }
          else { toast(res?.msg||'Error al colocar negocio'); placingShop=null; }
        });
        return;
      }
      u.money -= placingShop.price;
      newShop.id='S'+(shops.length+1); newShop.cashbox=0; shops.push(newShop);
      placingShop=null; toast('Negocio colocado 🏪'); return;
    }
    if(placingGov){
      const rectX = { x: pt.x - placingGov.w/2, y: pt.y - placingGov.h/2, w: placingGov.w, h: placingGov.h, label: placingGov.label, icon: placingGov.icon, fill: placingGov.fill, stroke: placingGov.stroke, k: placingGov.k };
      rectX.x = clamp(rectX.x, 10, WORLD.w - rectX.w - 10);
      rectX.y = clamp(rectX.y, 10, WORLD.h - rectX.h - 10);
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
    for(const s of shops){
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
    mctx.fillStyle='#0b142b'; mctx.fillRect(0,0,w,h);
    const sx = w / WORLD.w, sy = h / WORLD.h;
    const mrect=(r,fill)=>{ mctx.fillStyle=fill; mctx.fillRect(Math.max(0,r.x*sx), Math.max(0,r.y*sy), Math.max(1,r.w*sx), Math.max(1,r.h*sy)); };
    cityBlocks.forEach(r=>mrect(r,'#334155'));
    roadRects.forEach(r=>mrect(r,'#9ca3af')); factories.forEach(r=>mrect(r,'#8b5cf6'));
    banks.forEach(r=>mrect(r,'#fde047')); malls.forEach(r=>mrect(r,'#ef4444')); shops.forEach(r=>mrect(r,'#94a3b8'));
    mrect(cemetery,'#cbd5e1'); mrect(government,'#60a5fa');
    government.placed.forEach(r=>{
      if(r.k === 'carcel'){
        mctx.fillStyle = '#111'; mctx.fillRect(Math.max(0,r.x*sx), Math.max(0,r.y*sy), Math.max(1,r.w*sx), Math.max(1,r.h*sy));
        mctx.fillStyle = '#fff'; const bars = 3; const bx = Math.max(0,r.x*sx), by = Math.max(0,r.y*sy), bw = Math.max(1,r.w*sx), bh = Math.max(1,r.h*sy);
        for(let i=0;i<bars;i++){ const px = bx + 4 + i*(bw-8)/(bars-1); mctx.fillRect(px, by+4, 2, bh-8); }
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
  btnBuy.onclick = ()=>{const u=agents.find(a=>a.id===USER_ID); if(!u) return;if(u.houseIdx!=null && houses[u.houseIdx]?.ownerId===u.id){ $("#builderMsg").textContent='Ya eres dueño de una casa.'; return; }if(u.money<CFG.HOUSE_BUY_COST){ $("#builderMsg").textContent=`No te alcanza para comprar (${CFG.HOUSE_BUY_COST}).`; return; }placingHouse = {cost: CFG.HOUSE_BUY_COST, size:{w:CFG.HOUSE_SIZE, h:CFG.HOUSE_SIZE}, ownerId: u.id};show(builderModal,false);toast('Modo colocación: toca un espacio libre.');};

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
          b.textContent=`${t.icon} ${t.k} (Costo: ${t.buyCost}, Venta: $${t.price})`;
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

  setInterval(()=>{if(!STARTED) return; if(hasNet()) return; let rentCollected = 0; let renters = 0;for(const h of houses){if(h.rentedBy){const renter = agents.find(a => a.id === h.rentedBy);if(renter && renter.money >= CFG.GOV_RENT_AMOUNT){renter.money -= CFG.GOV_RENT_AMOUNT; rentCollected += CFG.GOV_RENT_AMOUNT; renters++;}}}government.funds += rentCollected;if(rentCollected > 0){govFundsEl.textContent = `Fondo: ${Math.floor(government.funds)} (+${Math.round(rentCollected)})`;toast(`Gobierno recaudó ${Math.round(rentCollected)} en alquileres de ${renters} personas.`);} }, CFG.GOV_RENT_EVERY*1000);

  setInterval(()=>{ if(!STARTED) return; if(hasNet()) return;
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
  btnBuyCar.addEventListener('click', () => {
      if(!USER_ID) { toast('Debes iniciar la simulación.'); return; }
      const u = agents.find(a => a.id === USER_ID);
      if(!u) { toast('Error: No se encontró a tu agente.'); return; }
      const vType = carTypeSelect.value;
      if (!vType || !VEHICLES[vType]) { carMsg.textContent = 'Por favor, selecciona un vehículo.'; carMsg.style.color = 'var(--warn)'; return; }
      const vehicle = VEHICLES[vType];
      if (u.money >= vehicle.cost){ u.money -= vehicle.cost; u.vehicle = vType; carMsg.textContent = `¡${vehicle.name} comprado!`; carMsg.style.color = 'var(--ok)'; toast(`¡Vehículo comprado! Tu velocidad aumentó.`); }
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
  
  return {
    id,
    code,
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