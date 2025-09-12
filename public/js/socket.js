// socket.js - cliente Socket.IO tolerante a cargas asíncronas
(function(){
	'use strict';

	const SOCKET_CDN = 'https://cdn.socket.io/4.7.5/socket.io.min.js';

	function waitForIO(timeoutMs){
		return new Promise((resolve, reject)=>{
			const t0 = performance.now();
			const tick = ()=>{
				if (window.io) return resolve(window.io);
				if (performance.now() - t0 > timeoutMs) return reject(new Error('timeout'));
				setTimeout(tick, 50);
			};
			tick();
		});
	}

	function injectCdn(){
		return new Promise((resolve, reject)=>{
			if (window.io) return resolve();
			// Evitar inyectar dos veces
			const exists = Array.from(document.scripts).some(s => (s.src||'').includes('socket.io')); 
			if (exists) return resolve();
			const s = document.createElement('script');
			s.src = SOCKET_CDN; s.defer = true; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer';
			s.onload = ()=> resolve();
			s.onerror = ()=> reject(new Error('No se pudo cargar Socket.IO desde CDN'));
			document.head.appendChild(s);
		});
	}

	async function boot(){
		try{
			// Esperar a que index.html cargue /socket.io/socket.io.js; si no llega, usar CDN
			try { await waitForIO(2500); } catch(_e) { await injectCdn(); await waitForIO(6000); }
		}catch(e){
			console.warn('Socket.IO no disponible; modo offline.', e);
			window.sock = null; window.sockApi = { createPlayer(){}, update(){} };
			return;
		}

		const sock = io({ transports: ['polling', 'websocket'] });
		window.sock = sock;

		// Exponer API sencilla para original.js
		const api = {
			createPlayer(data, cb){
				if(!sock.connected){
					const once = () => { sock.off('connect', once); api.createPlayer(data, cb); };
					sock.on('connect', once);
					return;
				}
				sock.emit('createPlayer', data, (res)=>{
					if(res?.ok && res.id){ window.playerId = res.id; }
					if(typeof cb === 'function') cb(res);
				});
			},
			update(patch){ try{ sock.emit('update', patch); }catch(_){ } },
			sendChat({ to, toName, text, gift }, cb){ try{ sock.emit('chat:send', { to, toName, text, gift }, (res)=> cb && cb(res)); }catch(_){ cb && cb({ ok:false }); } },
			payInitialRent(cb){ try{ sock.emit('pay:initialRent', {}, (res)=> cb && cb(res)); }catch(_){ cb && cb({ ok:false }); } }
		};
		window.sockApi = api;

		sock.on('connect', () => {
			try{ window.__dbgUpdate?.({ connected:true, players:(window.gameState?.players?.length||0), lastState:'connect' }); }catch(e){}
			// modo auto: crea jugador al conectar si no existe
			try{
				const usp = new URLSearchParams(location.search);
				if(usp.get('auto')==='1' && !window.playerId){
					const name = (document.querySelector('#fName')?.value || '').trim() || 'Player';
					const gender = document.querySelector('#fGender')?.value || 'M';
					window.sockApi?.createPlayer({ code:name, gender }, ()=>{});
				}
			}catch(e){}
		});

		sock.on('state', (payload) => {
			try {
				window.gameState = payload;
				window.government = payload?.government || window.government;
				if (typeof window.updateGovDesc === 'function') window.updateGovDesc();
				try{ if(typeof window.updateOwnedShopsUI === 'function') window.updateOwnedShopsUI(); }catch(e){}
				try{ window.__dbgUpdate?.({ connected:sock.connected, players:Array.isArray(payload?.players)?payload.players.length:0, lastState:new Date().toLocaleTimeString() }); }catch(e){}
			} catch (e) {}
		});

		// eventos de servidor (opcional por ahora)
		sock.on('playerJoined', () => {});
		sock.on('playerLeft', () => {});
		sock.on('shopPlaced', () => {});
		sock.on('housePlaced', () => {});
		sock.on('gov:updated', (gov) => {
			try{
				if(gov && typeof gov.funds === 'number') {
					window.government = gov; if(typeof window.updateGovDesc === 'function') window.updateGovDesc();
				}
			}catch(e){}
		});
		sock.on('govPlaced', () => { if (typeof window.updateGovDesc === 'function') window.updateGovDesc(); });
		// Cobro de arriendo confirmado por el servidor (al crear jugador o manual)
		sock.on('rent:charged', (payload)=>{
			try{
				const amt = Math.floor(payload?.amount||0);
				const m = Math.floor(payload?.money||0);
				const gf = (payload && typeof payload.governmentFunds==='number') ? Math.floor(payload.governmentFunds) : null;
				if(window.playerId && window.gameState && Array.isArray(window.gameState.players)){
					const me = window.gameState.players.find(p=>p && p.id===window.playerId);
					if(me){ me.money = m; }
					// También actualizar el agente local en el array principal
					if(window.agents && Array.isArray(window.agents)){
						const localAgent = window.agents.find(a => a && a.id === window.playerId);
						if(localAgent) localAgent.money = m;
					}
				}
				if(gf != null){
					try{ window.government = window.government || {}; window.government.funds = gf; if(typeof window.updateGovDesc==='function') window.updateGovDesc(); }catch(e){}
				}
				try{ if(typeof window.toast==='function'){ window.toast(`Arriendo cobrado: -${amt}`); } }catch(e){}
			}catch(e){}
		});
		// Chat entrante
		sock.on('chat:msg', (msg)=>{ try{ window.__onChatMessage && window.__onChatMessage(msg); }catch(e){} });
	}

	// Iniciar
	boot();
})();
