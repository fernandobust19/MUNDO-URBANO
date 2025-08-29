<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mundo Urbano</title>
    <style>
        :root {
            --ok: #22c55e;
            --warn: #f59e0b;
            --bad: #ef4444;
        }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #0f172a;
            color: #e2e8f0;
        }
        #formBar {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: #1e293b;
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        .form-container {
            width: 90%;
            max-width: 500px;
            background-color: #0f172a;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        .form-group {
            margin-bottom: 15px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }
        input, select {
            width: 100%;
            padding: 8px;
            border: 1px solid #475569;
            border-radius: 4px;
            background-color: #1e293b;
            color: #e2e8f0;
        }
        .gender-preview {
            margin-top: 10px;
            text-align: center;
        }
        #fGenderPreview {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            object-fit: cover;
        }
        .likes-container {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 10px;
        }
        .chip {
            background-color: #334155;
            border-radius: 16px;
            padding: 5px 10px;
            display: flex;
            align-items: center;
            cursor: pointer;
        }
        .chip.disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .chip input {
            margin-right: 5px;
            width: auto;
        }
        .likes-counter {
            text-align: right;
            margin-bottom: 5px;
            color: #94a3b8;
        }
        .btn-primary {
            background-color: #3b82f6;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 10px 15px;
            width: 100%;
            font-size: 16px;
            cursor: pointer;
        }
        .btn-secondary {
            background-color: #475569;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 8px;
            cursor: pointer;
        }
        .error-box {
            background-color: rgba(239, 68, 68, 0.2);
            border-left: 4px solid #ef4444;
            padding: 10px;
            margin: 10px 0;
            display: none;
        }
        canvas {
            display: block;
            width: 100%;
            height: 100vh;
        }
        #toast {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background-color: #334155;
            color: white;
            padding: 10px 20px;
            border-radius: 4px;
            z-index: 2000;
            display: none;
        }
    </style>
</head>
<body>
    <div id="formBar">
        <form id="formInner" class="form-container">
            <h2>Crear Personaje</h2>
            
            <div class="form-group">
                <label for="fName">Nombre:</label>
                <input type="text" id="fName" placeholder="Tu nombre" required>
            </div>
            
            <div class="form-group">
                <label for="fGender">Género:</label>
                <select id="fGender" required>
                    <option value="M">Masculino</option>
                    <option value="F">Femenino</option>
                </select>
                <div class="gender-preview">
                    <img id="fGenderPreview" src="" alt="Avatar">
                </div>
            </div>
            
            <div class="form-group">
                <label for="fAge">Edad:</label>
                <input type="number" id="fAge" min="18" max="90" value="30">
            </div>
            
            <div class="form-group">
                <label for="fUsd">Dinero inicial ($):</label>
                <input type="number" id="fUsd" min="0" max="100" value="0">
            </div>
            
            <div class="form-group">
                <label>Selecciona 5 gustos:</label>
                <div id="likesCount" class="likes-counter">0/5</div>
                <div id="likesWrap" class="likes-container">
                    <div class="chip"><input type="checkbox" id="like1" value="música"><label for="like1">Música</label></div>
                    <div class="chip"><input type="checkbox" id="like2" value="arte"><label for="like2">Arte</label></div>
                    <div class="chip"><input type="checkbox" id="like3" value="deporte"><label for="like3">Deporte</label></div>
                    <div class="chip"><input type="checkbox" id="like4" value="naturaleza"><label for="like4">Naturaleza</label></div>
                    <div class="chip"><input type="checkbox" id="like5" value="lectura"><label for="like5">Lectura</label></div>
                    <div class="chip"><input type="checkbox" id="like6" value="cocina"><label for="like6">Cocina</label></div>
                    <div class="chip"><input type="checkbox" id="like7" value="baile"><label for="like7">Baile</label></div>
                    <div class="chip"><input type="checkbox" id="like8" value="tecnología"><label for="like8">Tecnología</label></div>
                    <div class="chip"><input type="checkbox" id="like9" value="cine"><label for="like9">Cine</label></div>
                    <div class="chip"><input type="checkbox" id="like10" value="viajes"><label for="like10">Viajes</label></div>
                    <div class="chip"><input type="checkbox" id="like11" value="videojuegos"><label for="like11">Videojuegos</label></div>
                    <div class="chip"><input type="checkbox" id="like12" value="café"><label for="like12">Café</label></div>
                </div>
                <button type="button" id="btnRandLikes" class="btn-secondary">Gustos aleatorios</button>
            </div>
            
            <div id="errBox" class="error-box">Por favor, completa todos los campos requeridos.</div>
            
            <button type="submit" id="btnStart" class="btn-primary">Comenzar</button>
        </form>
    </div>

    <canvas id="world"></canvas>
    <div id="toast"></div>
    
    <!-- Interfaces del juego -->
    <div id="uiDock" style="display:none;"></div>
    <div id="uiShowBtn" style="display:none;">Mostrar UI</div>
    <div id="uiHideBtn" style="display:none;">Ocultar UI</div>
    <div id="top-bar" style="display:none;"></div>
    <div id="zoomFab" style="display:none;">
        <button id="zoomIn">+</button>
        <button id="zoomOut">-</button>
    </div>
    <div id="mini" style="display:none;">
        <canvas id="miniCanvas" width="150" height="150"></canvas>
    </div>
    <div id="stats" style="display:none;"></div>
    <div id="toggleLines" style="display:none;">Toggle Líneas</div>

    <!-- Paneles específicos -->
    <div id="docDock" style="display:none;">
        <div id="docBody"></div>
    </div>
    <div id="bankBody" style="display:none;"></div>
    <div id="govDock" style="display:none;"></div>
    <div id="marriedDock" style="display:none;">
        <div id="marriedList"></div>
    </div>
    <div id="builderModal" style="display:none;">
        <button id="btnBuilderClose">X</button>
        <div id="builderMsg"></div>
        <button id="btnBuy">Comprar Casa</button>
    </div>
    <div id="shopModal" style="display:none;">
        <button id="btnShopClose">X</button>
        <div id="shopMsg"></div>
        <div id="shopList"></div>
    </div>
    
    <!-- Botones de acción -->
    <button id="btnShowDoc" style="display:none;">Documento</button>
    <button id="btnShowMarried" style="display:none;">Parejas</button>
    <button id="btnShowGov" style="display:none;">Gobierno</button>
    <button id="btnHouse" style="display:none;">Casa</button>
    <button id="btnShop" style="display:none;">Tienda</button>
    <div id="panelDepositAll" style="display:none;">Depositar Todo</div>
    <div id="govFunds" style="display:none;"></div>
    <div id="govDesc" style="display:none;"></div>
    <select id="govSelect" style="display:none;"></select>
    <button id="btnGovPlace" style="display:none;">Colocar</button>
    
    <!-- Vehículos -->
    <div id="carSection" style="display:none;">
        <select id="carTypeSelect">
            <option value="">Seleccionar vehículo</option>
            <option value="bicicleta">Bicicleta ($50)</option>
            <option value="moto">Motocicleta ($200)</option>
            <option value="auto_compacto">Auto Compacto ($800)</option>
            <option value="auto_deportivo">Auto Deportivo ($2500)</option>
        </select>
        <button id="btnBuyCar">Comprar</button>
        <div id="carMsg"></div>
    </div>

    <script>
        const toast = (msg)=>{
  const now = performance.now();
  if (now - toastLimiter.last < toastLimiter.gap) return;
  toastLimiter.last = now;
  const t="#toast"; // Corregido: Antes era ("#toast")
  const _t = document.querySelector(t);
  if(_t){ _t.textContent=msg; _t.style.display='block'; clearTimeout(toast._id); toast._id=setTimeout(()=>_t.style.display='none',2400); }
};
    </script>
    
    <script src="original.js"></script>
</body>
</html>
