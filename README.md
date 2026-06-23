# Binance Crypto Radar

Panel de monitoreo cripto con backend Node para Binance Spot. Por defecto trabaja en modo paper; solo opera real si configuras variables de entorno y activas `BOT_LIVE_TRADING=true`.

## Uso local

```powershell
npm start
```

Abre `http://127.0.0.1:8080`.

## Variables importantes

Copia `.env.example` a `.env` si vas a probar localmente. No subas `.env` a GitHub.

```env
APP_USERNAME=gaboLauraV123
APP_PASSWORD=
APP_SESSION_SECRET=
BINANCE_API_KEY=
BINANCE_API_SECRET=
BOT_LIVE_TRADING=false
BOT_MAX_CAPITAL_USDT=50
BOT_MAX_TRADE_USDT=6
BOT_DAILY_PROFIT_TARGET_USDT=10
BOT_DAILY_MAX_LOSS_USDT=2.5
BOT_MIN_NOTIONAL_BUFFER_PCT=12
BOT_ALLOW_RESCUE_TOP_UP=true
BOT_RESCUE_TOP_UP_BUFFER_PCT=15
BOT_MAX_RESCUE_TOP_UP_USDT=8
BOT_RETRY_NOTIONAL_CLOSE=true
BOT_POSITION_CHECK_INTERVAL_MS=3000
BOT_STATUS_EXIT_GUARD=true
BOT_UNIVERSE_MODE=dynamic
BOT_ALLOWED_SYMBOLS=ALL
BOT_ALLOW_HIGH_RISK=true
BOT_HIGH_RISK_MAX_TRADE_USDT=6
BOT_MAX_HIGH_RISK_OPEN_POSITIONS=1
BOT_HIGH_RISK_MAX_24H_CHANGE_PCT=18
BOT_HIGH_RISK_MAX_SPREAD_PCT=0.2
BOT_HIGH_RISK_MIN_DEPTH_BIAS=0.08
BOT_HIGH_RISK_RSI_MIN=48
BOT_HIGH_RISK_RSI_MAX=64
BOT_HIGH_RISK_MAX_POSITION_LOSS_PCT=0.8
BOT_MAX_POSITION_LOSS_PCT=1.4
BOT_POSITION_CHECK_INTERVAL_MS=10000
```

## Deploy en Seenode

- Framework: Node.js / Express compatible.
- Build command: dejar vacio o `npm install`.
- Start command: `npm start`.
- Port field: `8080`.
- Environment variables: copia las variables de `.env.example`.
- No agregues `PORT`; Seenode indica configurar el puerto en el campo de Port.
- `APP_PASSWORD` debe ser tu contrasena privada de acceso a la web.
- `APP_SESSION_SECRET` debe ser una cadena larga aleatoria para firmar sesiones.

## IP para Binance

Despues de desplegar en Seenode:

1. Entra a la web con tu usuario y contrasena.
2. Busca el bloque `Bot Spot con limites`.
3. Copia el valor `IP de salida`.
4. En Binance API Management selecciona `Restrict access to trusted IPs only`.
5. Pega esa IP y guarda.
6. Recién despues activa `Enable Spot & Margin & Stock Trading`.

Si la IP cambia despues de reiniciar o redeployar Seenode, Binance puede rechazar las ordenes. En ese caso necesitas IP fija de Seenode o seguir en `BOT_LIVE_TRADING=false`.

## Alcance del bot

- Usa solo saldo libre `USDT` de Spot.
- No usa Funding Wallet, Futures, Margin ni retiros.
- Limita capital con `BOT_MAX_CAPITAL_USDT`.
- Limita tamano por operacion con `BOT_MAX_TRADE_USDT`.
- Usa `BOT_MIN_NOTIONAL_BUFFER_PCT` para no operar pegado al minimo de Binance.
- Descarta entradas cuyo minimo de Binance no cabe en `BOT_MAX_TRADE_USDT`.
- Si una posicion queda bajo el minimo vendible, `BOT_ALLOW_RESCUE_TOP_UP=true` permite comprar un minimo extra y vender todo para volver a USDT.
- Si Binance rechaza un cierre por `NOTIONAL`, `BOT_RETRY_NOTIONAL_CLOSE=true` intenta rescatar y vender una vez mas.
- Revisa salidas con `BOT_POSITION_CHECK_INTERVAL_MS` y tambien antes de responder el estado del panel con `BOT_STATUS_EXIT_GUARD=true`.
- Pausa entradas si alcanza el objetivo diario o perdida diaria.
- Calcula PnL neto estimado con comision taker.
- Muestra USDT/BOB usando Binance P2P y fallback `bo.dolarapi.com`.
- En `BOT_UNIVERSE_MODE=dynamic` analiza muchas mas criptos spot USDT de Binance.
- Si tu hosting no permite variables vacias, usa `BOT_ALLOWED_SYMBOLS=ALL`.
- Las entradas de alto riesgo usan `BOT_HIGH_RISK_MAX_TRADE_USDT` y filtros mas estrictos.
- Las monedas volatiles se descartan si tienen spread alto, RSI estirado, demasiada subida en 24h o poca presion compradora en el libro.
- `BOT_HIGH_RISK_MAX_POSITION_LOSS_PCT` corta posiciones volatiles antes de que sigan cayendo.
- `BOT_POSITION_CHECK_INTERVAL_MS` revisa take-profit, stop y trailing sin esperar al escaneo completo de nuevas compras.

## Seguridad

La web requiere login con `APP_USERNAME` y `APP_PASSWORD`. Las claves de Binance se usan solo en el backend y nunca deben ir en `app.js`, `index.html` ni GitHub.

Las senales no son asesoria financiera. El mercado cripto puede perder capital rapidamente. Prueba primero con `BOT_LIVE_TRADING=false` o Binance Spot Testnet antes de operar real.
