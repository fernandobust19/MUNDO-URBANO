# MUNDO URBANO

## Casas y Arriendo

- En la PRIMERA sesión de un jugador nuevo, tras ~3 segundos aparece una ventana que exige pagar el arriendo inicial (50 créditos). La simulación se pausa hasta pagar.
- Una vez pagado el arriendo inicial se guarda la bandera `initialRentPaid` y NO se vuelve a mostrar ese mensaje en futuras sesiones.
- La casa asignada en arriendo se persiste mediante `rentedHouseIdx`; al volver a iniciar sesión el jugador reaparece con la misma casa sin volver a pagar el arriendo inicial.
- Al pagar por primera vez:
  - Se descuenta 50 del saldo del jugador.
  - Se suma a los fondos del gobierno.
  - La cámara hace zoom y centra la casa asignada.
  - La casa recibe un marcador con ✓ y una inicial única (si la inicial ya existe se agrega un número secuencial).
  - Se resalta la casa unos segundos con un borde verde.
- El arriendo periódico (cada hora real acumulada de simulación local/offline) descuenta 50 si hay saldo; si no, muestra mensaje de saldo insuficiente (sin expulsar todavía).

## Casas Propias (Compra)

- Un jugador puede comprar su propia casa si tiene suficiente dinero (costo configurable: `CFG.HOUSE_BUY_COST`).
- Las casas propias se colocan libremente en cualquier lugar válido del mapa al entrar en modo colocación.
- Las casas propias son más grandes: usan `CFG.HOUSE_SIZE * CFG.OWNED_HOUSE_SIZE_MULT` (multiplicador por defecto 1.4).
- Se marcan internamente con `owned:true` y se dibujan con un color de relleno diferente.

## Marcadores de Casas

- Casas arrendadas: muestran etiqueta flotante "✓ <Inicial>" en verde.
- El sistema de iniciales genera un conteo por letra para evitar duplicados (A, A2, A3...).
- Casas propias mantienen su marcador si ya fue asignado al momento del arriendo inicial.

## Persistencia

- Campos persistidos clave:
  - `initialRentPaid`: evita que el prompt de arriendo vuelva a aparecer.
  - `rentedHouseIdx`: índice de la casa arrendada para restaurarla en futuras sesiones.
  - `money`, `houses` (propias), `shops` (negocios del jugador), `vehicle`.
- Al pagar arriendo inicial y en compras/pagos relevantes se llama a `saveProgress`.

## Negocios y Caja (Cashbox)

- Cada negocio comprado acumula ganancias en `cashbox` cuando otros agentes realizan compras.
- Se muestra un rótulo flotante sobre el negocio con el formato `💰 <monto>` mientras el monto sea > 0 (con un desvanecido gradual si no cambia por un tiempo).
- El dueño puede "gestionar" su negocio (rol interno `manage_shop`): al llegar se transfiere TODO el monto de la caja a su dinero y la caja se reinicia a 0.
- La acción de gestión genera un `toast` y persiste el nuevo saldo y listado de negocios del jugador.

## Configuración Relevante en `original.js`

- `HOUSE_SIZE`: Tamaño base de las casas de arriendo.
- `OWNED_HOUSE_SIZE_MULT`: Multiplicador para casas compradas (más grandes).
- `HOUSE_BUY_COST`: Costo de compra de casa propia.
- `processRent(...)`: Lógica de cobro periódico (acumulando 1 hora real). 

## Flujo Resumido

1. Inicia sesión / crea personaje.
2. Se asigna una casa en arriendo automáticamente si hay disponible.
3. Tras 3 segundos aparece ventana de pago de arriendo inicial (bloquea el juego).
4. El jugador paga; se centra y resalta su casa.
5. Puede luego comprar una casa propia (más grande) y colocarla libremente.

## Próximas Mejoras Sugeridas

- Evicción automática si no paga arriendo varias horas seguidas.
- Panel de listado de casas (arrendadas vs. propias) con teletransporte.
- Historial de pagos en UI del gobierno.
- Animación suave de zoom (easing) al enfocar la casa.
- Panel de resumen de negocios (ver caja total y retirar sin desplazarse físicamente).
- Indicadores de estado del agente (trabajando, explorando, descansando) en la UI.
