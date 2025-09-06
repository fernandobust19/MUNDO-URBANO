// socket.js - cliente Socket.IO mínimo
(function(){
	'use strict';
	// Prefer polling first to avoid websocket handshake failures, then upgrade
	const sock = io({ transports: ['polling', 'websocket'] });
	window.sock = sock;

	// Exponer API sencilla para main.js
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
		update(patch){ sock.emit('update', patch); }
	};
	window.sockApi = api;

	sock.on('connect', () => {
		// conectado
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
		// guarda último estado para el renderer en main.js
		window.gameState = payload;
			// exponer gobierno para helpers y HUD
			window.government = payload?.government || window.government;
			if (typeof window.updateGovDesc === 'function') window.updateGovDesc();
			// actualizar contador de negocios propios si existe helper
			try{ if(typeof window.updateOwnedShopsUI === 'function') window.updateOwnedShopsUI(); }catch(e){}
			// podrías dibujar jugadores/tienda/casas aquí
		try{ window.__dbgUpdate?.({ connected:sock.connected, players:Array.isArray(payload?.players)?payload.players.length:0, lastState:new Date().toLocaleTimeString() }); }catch(e){}
		} catch (e) {}
	});

	// eventos de servidor (opcional por ahora)
	sock.on('playerJoined', () => {});
	sock.on('playerLeft', () => {});
	sock.on('shopPlaced', () => {});
	sock.on('housePlaced', () => {});
	sock.on('govPlaced', () => { if (typeof window.updateGovDesc === 'function') window.updateGovDesc(); });
})();
