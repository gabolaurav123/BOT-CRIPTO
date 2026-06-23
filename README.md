# Binance Crypto Radar

Panel local de monitoreo y paper trading para pares spot `USDT` de Binance.

## Uso

1. Abre una terminal en esta carpeta.
2. Ejecuta un servidor estatico, por ejemplo:

```powershell
python -m http.server 5173
```

3. Abre `http://127.0.0.1:5173`.

## Alcance

- Usa endpoints publicos de Binance: `exchangeInfo`, `ticker/24hr`, `klines` y stream `!miniTicker@arr`.
- No usa credenciales, no entra a tu cuenta, no ejecuta ordenes reales.
- Guarda presupuesto, alertas y posiciones simuladas en `localStorage`.
- Si Binance Global esta bloqueado por region, intenta Binance.US. Si ambos fallan, carga datos demo.

## Seguridad

Las senales son educativas y no son asesoria financiera. El mercado cripto puede perder capital rapidamente; usa el modo simulado antes de considerar una integracion real con API keys.
