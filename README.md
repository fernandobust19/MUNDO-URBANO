# MUNDO URBANO

## Casas y Arriendo

- Al ingresar al mundo pasan 3 segundos y aparece una ventana que exige pagar el arriendo inicial (50 créditos). La simulación se pausa hasta pagar.
- Al pagar:
  - Se descuenta 50 del saldo del jugador.
  - Se suma a los fondos del gobierno.
  - La cámara hace zoom y centra la casa asignada.
  - La casa recibe un marcador con ✓ y una inicial única (si la inicial ya existe se agrega un número secuencial).
  - Se resalta la casa unos segundos con un borde verde.
- El arriendo periódico (cada hora) descuenta 50 si hay saldo; si no, muestra mensaje de saldo insuficiente.

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

- Al pagar arriendo inicial y en cada cobro periódico se intenta guardar progreso (`saveProgress`) reflejando el nuevo saldo.

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
