import crypto from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "bot-state.json");

const DEFAULT_ALLOWED_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "DOGEUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "DOTUSDT",
  "LTCUSDT",
  "BCHUSDT",
  "TRXUSDT",
  "NEARUSDT",
];

const STABLE_OR_WRAPPED_BASES = new Set([
  "USDC",
  "FDUSD",
  "TUSD",
  "USDP",
  "DAI",
  "BUSD",
  "EUR",
  "TRY",
  "BRL",
  "AEUR",
  "WBTC",
]);

const CONFIG = {
  port: Number(process.env.PORT || 8080),
  binanceBaseUrl: stripTrailingSlash(process.env.BINANCE_BASE_URL || "https://api.binance.com"),
  apiKey: process.env.BINANCE_API_KEY || "",
  apiSecret: process.env.BINANCE_API_SECRET || "",
  liveTrading: envBool("BOT_LIVE_TRADING", false),
  autoStart: envBool("BOT_AUTO_START", false),
  maxCapitalUsdt: envNum("BOT_MAX_CAPITAL_USDT", 50),
  maxTradeUsdt: envNum("BOT_MAX_TRADE_USDT", 5),
  maxOpenPositions: Math.max(1, envNum("BOT_MAX_OPEN_POSITIONS", 4)),
  dailyProfitTargetUsdt: envNum("BOT_DAILY_PROFIT_TARGET_USDT", 10),
  dailyMaxLossUsdt: envNum("BOT_DAILY_MAX_LOSS_USDT", 2.5),
  minScore: envNum("BOT_MIN_SCORE", 82),
  scanIntervalMs: Math.max(15000, envNum("BOT_SCAN_INTERVAL_MS", 60000)),
  takerFeeRate: envNum("BOT_TAKER_FEE_RATE", 0.001),
  stopLossPct: envNum("BOT_STOP_LOSS_PCT", 1.8),
  takeProfitPct: envNum("BOT_TAKE_PROFIT_PCT", 1.2),
  trailingStopPct: envNum("BOT_TRAILING_STOP_PCT", 0.7),
  allowedSymbols: parseSymbolList(process.env.BOT_ALLOWED_SYMBOLS, DEFAULT_ALLOWED_SYMBOLS),
  excludedSymbols: parseSymbolList(process.env.BOT_EXCLUDED_SYMBOLS, []),
  recvWindow: 5000,
  timezone: "America/La_Paz",
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

const marketCache = {
  exchangeInfo: null,
  exchangeInfoAt: 0,
  tickers: null,
  tickersAt: 0,
  fx: null,
  fxAt: 0,
  commission: new Map(),
};

const botState = loadState();
let botTimer = null;
let scanInProgress = false;

if (CONFIG.autoStart) {
  botState.enabled = true;
  botState.startedAt = botState.startedAt || Date.now();
  saveState();
}

scheduleBotLoop();

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await routeApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { ok: false, error: publicError(error) });
  }
});

server.listen(CONFIG.port, () => {
  console.log(`BOT-CRIPTO listening on http://127.0.0.1:${CONFIG.port}`);
});

async function routeApi(req, res, url) {
  if (url.pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      now: new Date().toISOString(),
      binanceConfigured: hasKeys(),
      liveTrading: CONFIG.liveTrading,
      botEnabled: botState.enabled,
    });
    return;
  }

  if (url.pathname === "/api/config" && req.method === "GET") {
    sendJson(res, 200, safeConfig());
    return;
  }

  if (url.pathname === "/api/account" && req.method === "GET") {
    sendJson(res, 200, await getAccountSummary());
    return;
  }

  if (url.pathname === "/api/fx/usdtbob" && req.method === "GET") {
    sendJson(res, 200, await getUsdtBobRate());
    return;
  }

  if (url.pathname === "/api/market/snapshot" && req.method === "GET") {
    const scan = await scanMarket({ includeDepth: false, limit: 30 });
    sendJson(res, 200, { ok: true, markets: scan });
    return;
  }

  if (url.pathname === "/api/bot/status" && req.method === "GET") {
    sendJson(res, 200, await buildBotStatus());
    return;
  }

  if (url.pathname === "/api/bot/start" && req.method === "POST") {
    botState.enabled = true;
    botState.startedAt = Date.now();
    addBotAlert("Bot iniciado", CONFIG.liveTrading ? "Modo live habilitado por variables de entorno." : "Modo paper, no ejecuta ordenes reales.");
    saveState();
    scheduleBotLoop(true);
    sendJson(res, 200, await buildBotStatus());
    return;
  }

  if (url.pathname === "/api/bot/stop" && req.method === "POST") {
    botState.enabled = false;
    addBotAlert("Bot pausado", "No abrira posiciones nuevas hasta que lo vuelvas a iniciar.");
    saveState();
    scheduleBotLoop();
    sendJson(res, 200, await buildBotStatus());
    return;
  }

  if (url.pathname === "/api/bot/scan" && req.method === "POST") {
    await runBotScan({ manual: true });
    sendJson(res, 200, await buildBotStatus());
    return;
  }

  if (url.pathname === "/api/bot/close" && req.method === "POST") {
    const body = await readJsonBody(req);
    const position = botState.positions.find((item) => item.id === body.positionId && item.status === "open");
    if (!position) {
      sendJson(res, 404, { ok: false, error: "Open position not found." });
      return;
    }
    await closePosition(position, "manual close");
    sendJson(res, 200, await buildBotStatus());
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found." });
}

async function serveStatic(req, res, url) {
  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(__dirname, safePath);
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (status === 204) {
    res.end();
    return;
  }
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function loadState() {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(STATE_FILE)) return createDefaultState();
  try {
    return { ...createDefaultState(), ...JSON.parse(readFileSync(STATE_FILE, "utf8")) };
  } catch {
    return createDefaultState();
  }
}

function createDefaultState() {
  return {
    enabled: false,
    startedAt: null,
    dayKey: dayKey(),
    dailyRealizedPnl: 0,
    positions: [],
    trades: [],
    alerts: [],
    lastScanAt: null,
    lastDecision: "Sin escaneo todavia.",
    lastError: null,
  };
}

function saveState() {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(botState, null, 2));
}

function resetDailyIfNeeded() {
  const key = dayKey();
  if (botState.dayKey === key) return;
  botState.dayKey = key;
  botState.dailyRealizedPnl = 0;
  addBotAlert("Nuevo dia operativo", "Se reiniciaron los limites diarios de PnL.");
  saveState();
}

function dayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CONFIG.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function scheduleBotLoop(runNow = false) {
  if (botTimer) clearTimeout(botTimer);
  if (!botState.enabled) return;
  if (runNow) runBotScan().catch((error) => console.error(error));
  botTimer = setTimeout(async () => {
    await runBotScan().catch((error) => console.error(error));
    scheduleBotLoop();
  }, CONFIG.scanIntervalMs);
}

async function runBotScan(options = {}) {
  if (!botState.enabled && !options.manual) return;
  if (scanInProgress) return;
  scanInProgress = true;
  resetDailyIfNeeded();

  try {
    const account = await getAccountSummary();
    const scan = await scanMarket({ includeDepth: true, limit: 30 });
    const marketsBySymbol = new Map(scan.map((market) => [market.symbol, market]));
    await manageOpenPositions(marketsBySymbol);

    const openPositions = botState.positions.filter((item) => item.status === "open");
    const openExposure = openPositions.reduce((sum, position) => sum + position.amountUsdt, 0);
    const remainingCapital = Math.max(0, CONFIG.maxCapitalUsdt - openExposure);
    const freeUsdt = account.spot?.USDT?.free ?? 0;
    const availableUsdt = Math.max(0, Math.min(freeUsdt, remainingCapital));

    if (!botState.enabled) {
      botState.lastDecision = "Bot pausado.";
    } else if (botState.dailyRealizedPnl >= CONFIG.dailyProfitTargetUsdt) {
      botState.lastDecision = `Objetivo diario alcanzado: ${botState.dailyRealizedPnl.toFixed(2)} USDT.`;
    } else if (botState.dailyRealizedPnl <= -Math.abs(CONFIG.dailyMaxLossUsdt)) {
      botState.enabled = false;
      botState.lastDecision = `Perdida diaria maxima alcanzada: ${botState.dailyRealizedPnl.toFixed(2)} USDT. Bot pausado.`;
      addBotAlert("Limite de perdida diaria", botState.lastDecision);
    } else if (openPositions.length >= CONFIG.maxOpenPositions) {
      botState.lastDecision = "Maximo de posiciones abiertas alcanzado.";
    } else if (availableUsdt < 5) {
      botState.lastDecision = `USDT disponible para el bot insuficiente: ${availableUsdt.toFixed(2)}.`;
    } else {
      const candidate = scan.find((market) => canEnterMarket(market, openPositions));
      if (candidate) {
        await openPosition(candidate, availableUsdt);
      } else {
        botState.lastDecision = "No hay entrada con ventaja suficiente segun filtros actuales.";
      }
    }

    botState.lastScanAt = Date.now();
    botState.lastError = null;
    saveState();
  } catch (error) {
    botState.lastError = publicError(error);
    addBotAlert("Error de escaneo", botState.lastError);
    saveState();
  } finally {
    scanInProgress = false;
  }
}

function canEnterMarket(market, openPositions) {
  if (market.score < CONFIG.minScore) return false;
  if (market.risk === "alto") return false;
  if (market.projection4h < 0.25) return false;
  if (market.rsi > 72 || market.rsi < 42) return false;
  if (market.depthBias < -0.08) return false;
  if (openPositions.some((position) => position.symbol === market.symbol)) return false;
  return true;
}

async function openPosition(market, availableUsdt) {
  const symbolInfo = await getSymbolInfo(market.symbol);
  const minNotional = symbolInfo.minNotional || 5;
  const amountUsdt = Math.min(CONFIG.maxTradeUsdt, availableUsdt, CONFIG.maxCapitalUsdt);
  if (amountUsdt < minNotional) {
    botState.lastDecision = `${market.symbol} descartado: monto ${amountUsdt.toFixed(2)} menor al minimo ${minNotional}.`;
    return;
  }

  const feeRate = await getCommissionRate(market.symbol);
  const expectedStop = market.price * (1 - CONFIG.stopLossPct / 100);
  const expectedTarget = market.price * (1 + (CONFIG.takeProfitPct + feeRate * 200) / 100);
  const order = await placeMarketBuy(market.symbol, amountUsdt);
  const quantity = order.executedQty || amountUsdt / market.price;
  const entryPrice = order.avgPrice || market.price;
  const cost = order.cummulativeQuoteQty || amountUsdt;

  const position = {
    id: crypto.randomUUID(),
    symbol: market.symbol,
    baseAsset: market.baseAsset,
    status: "open",
    mode: CONFIG.liveTrading ? "live" : "paper",
    amountUsdt: Number(cost),
    quantity: Number(quantity),
    entryPrice: Number(entryPrice),
    feeRate,
    stop: expectedStop,
    target: expectedTarget,
    peakPrice: Number(entryPrice),
    scoreAtEntry: market.score,
    openedAt: Date.now(),
    buyOrderId: order.orderId || null,
    reason: market.reason,
  };

  botState.positions.unshift(position);
  botState.lastDecision = `Entrada ${position.mode}: ${market.symbol} por ${position.amountUsdt.toFixed(2)} USDT.`;
  addBotAlert("Entrada del bot", `${market.symbol}: ${position.amountUsdt.toFixed(2)} USDT a ${position.entryPrice}.`);
  saveState();
}

async function manageOpenPositions(marketsBySymbol) {
  for (const position of botState.positions.filter((item) => item.status === "open")) {
    const market = marketsBySymbol.get(position.symbol) || (await getMarketForSymbol(position.symbol));
    if (!market?.price) continue;

    position.peakPrice = Math.max(position.peakPrice || position.entryPrice, market.price);
    const trailingStop = position.peakPrice * (1 - CONFIG.trailingStopPct / 100);
    const pnl = estimatePositionPnl(position, market.price);
    let reason = "";

    if (market.price <= position.stop) reason = "stop-loss";
    else if (position.peakPrice > position.entryPrice * 1.008 && market.price <= trailingStop) reason = "trailing-stop";
    else if (market.price >= position.target) reason = "take-profit";
    else if (market.score < 50 && pnl.netUsdt <= 0) reason = "senal-debil";
    else if (botState.dailyRealizedPnl + pnl.netUsdt <= -Math.abs(CONFIG.dailyMaxLossUsdt)) reason = "proteccion-perdida-diaria";

    if (reason) await closePosition(position, reason, market.price);
  }
}

async function closePosition(position, reason, currentPrice = null) {
  const market = currentPrice ? { price: currentPrice } : await getMarketForSymbol(position.symbol);
  const exitPrice = market?.price || position.entryPrice;
  const order = await placeMarketSell(position.symbol, position.quantity);
  const executedQty = order.executedQty || position.quantity;
  const quote = order.cummulativeQuoteQty || executedQty * exitPrice;
  const avgPrice = order.avgPrice || quote / executedQty || exitPrice;
  const pnl = estimatePositionPnl(position, avgPrice, quote);

  position.status = "closed";
  position.closedAt = Date.now();
  position.exitPrice = Number(avgPrice);
  position.exitReason = reason;
  position.sellOrderId = order.orderId || null;
  position.realizedPnlUsdt = pnl.netUsdt;
  botState.dailyRealizedPnl += pnl.netUsdt;
  botState.trades.unshift({
    id: crypto.randomUUID(),
    symbol: position.symbol,
    reason,
    mode: position.mode,
    amountUsdt: position.amountUsdt,
    pnlUsdt: pnl.netUsdt,
    openedAt: position.openedAt,
    closedAt: position.closedAt,
  });
  botState.trades = botState.trades.slice(0, 100);
  botState.lastDecision = `Salida ${position.symbol}: ${reason}, PnL ${pnl.netUsdt.toFixed(4)} USDT.`;
  addBotAlert("Salida del bot", botState.lastDecision);
  saveState();
}

async function placeMarketBuy(symbol, quoteOrderQty) {
  if (!CONFIG.liveTrading) {
    const market = await getMarketForSymbol(symbol);
    const price = market?.price || 1;
    return {
      orderId: `paper-buy-${Date.now()}`,
      executedQty: quoteOrderQty / price,
      cummulativeQuoteQty: quoteOrderQty,
      avgPrice: price,
    };
  }
  assertTradingReady();
  const result = await binanceSignedRequest("POST", "/api/v3/order", {
    symbol,
    side: "BUY",
    type: "MARKET",
    quoteOrderQty: toFixedTrim(quoteOrderQty, 2),
    newClientOrderId: `bc_buy_${Date.now()}`,
  });
  return normalizeOrder(result);
}

async function placeMarketSell(symbol, quantity) {
  if (!CONFIG.liveTrading) {
    const market = await getMarketForSymbol(symbol);
    const price = market?.price || 1;
    return {
      orderId: `paper-sell-${Date.now()}`,
      executedQty: quantity,
      cummulativeQuoteQty: quantity * price,
      avgPrice: price,
    };
  }
  assertTradingReady();
  const info = await getSymbolInfo(symbol);
  const account = await getAccountSummary();
  const freeBase = account.spot?.[info.baseAsset]?.free ?? 0;
  const sellQty = roundStep(Math.min(quantity, freeBase), info.stepSize);
  if (sellQty <= 0) throw new Error(`No hay ${info.baseAsset} libre para vender.`);
  const result = await binanceSignedRequest("POST", "/api/v3/order", {
    symbol,
    side: "SELL",
    type: "MARKET",
    quantity: toFixedTrim(sellQty, info.quantityPrecision),
    newClientOrderId: `bc_sell_${Date.now()}`,
  });
  return normalizeOrder(result);
}

function normalizeOrder(order) {
  const executedQty = Number(order.executedQty || 0);
  const cummulativeQuoteQty = Number(order.cummulativeQuoteQty || 0);
  const avgPrice = executedQty > 0 ? cummulativeQuoteQty / executedQty : 0;
  return {
    orderId: order.orderId,
    executedQty,
    cummulativeQuoteQty,
    avgPrice,
    raw: order,
  };
}

function estimatePositionPnl(position, currentPrice, quoteOverride = null) {
  const currentValue = quoteOverride ?? position.quantity * currentPrice;
  const gross = currentValue - position.amountUsdt;
  const fees = position.amountUsdt * position.feeRate + currentValue * position.feeRate;
  return {
    grossUsdt: gross,
    feesUsdt: fees,
    netUsdt: gross - fees,
    netPct: position.amountUsdt ? ((gross - fees) / position.amountUsdt) * 100 : 0,
  };
}

async function scanMarket(options = {}) {
  const exchangeInfo = await getExchangeInfo();
  const tickers = await get24hTickers();
  const tradable = new Map(
    exchangeInfo.symbols
      .filter((item) => item.status === "TRADING" && item.quoteAsset === "USDT" && item.isSpotTradingAllowed !== false)
      .map((item) => [item.symbol, item])
  );

  const allowed = new Set(CONFIG.allowedSymbols);
  const excluded = new Set(CONFIG.excludedSymbols);
  const candidates = tickers
    .filter((ticker) => tradable.has(ticker.symbol))
    .filter((ticker) => !excluded.has(ticker.symbol))
    .filter((ticker) => !allowed.size || allowed.has(ticker.symbol))
    .map((ticker) => buildMarketFromTicker(ticker, tradable.get(ticker.symbol)))
    .filter((market) => market.price > 0 && market.volumeQuote > 1000000)
    .filter((market) => !STABLE_OR_WRAPPED_BASES.has(market.baseAsset))
    .sort((a, b) => b.volumeQuote - a.volumeQuote)
    .slice(0, options.limit || 30);

  const queue = [...candidates];
  const workers = Array.from({ length: 5 }, async () => {
    while (queue.length) {
      const market = queue.shift();
      const klines = await getKlines(market.symbol, "1h", 120).catch(() => []);
      applyTechnicalIndicators(market, klines);
      if (options.includeDepth) {
        market.depthBias = await getOrderBookBias(market.symbol).catch(() => 0);
      }
      recalculateMarket(market);
    }
  });
  await Promise.all(workers);
  return candidates.sort((a, b) => b.score - a.score);
}

async function getMarketForSymbol(symbol) {
  const ticker = await binancePublicRequest(`/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`);
  const info = await getSymbolInfo(symbol);
  const market = buildMarketFromTicker(ticker, info.raw);
  const klines = await getKlines(symbol, "1h", 120).catch(() => []);
  applyTechnicalIndicators(market, klines);
  market.depthBias = await getOrderBookBias(symbol).catch(() => 0);
  recalculateMarket(market);
  return market;
}

function buildMarketFromTicker(ticker, info = {}) {
  const filters = Object.fromEntries((info.filters || []).map((filter) => [filter.filterType, filter]));
  const minNotional = Number(filters.NOTIONAL?.minNotional || filters.MIN_NOTIONAL?.minNotional || 5);
  return {
    symbol: ticker.symbol,
    baseAsset: info.baseAsset || ticker.symbol.replace(/USDT$/, ""),
    price: Number(ticker.lastPrice),
    openPrice: Number(ticker.openPrice),
    highPrice: Number(ticker.highPrice),
    lowPrice: Number(ticker.lowPrice),
    changePct: Number(ticker.priceChangePercent),
    volumeQuote: Number(ticker.quoteVolume),
    minNotional,
    rsi: null,
    smaFast: null,
    smaSlow: null,
    projection4h: null,
    volatility: null,
    depthBias: 0,
    score: 0,
    signal: "watch",
    risk: "moderado",
    reason: "",
  };
}

function applyTechnicalIndicators(market, candles) {
  const closes = candles.map((item) => Number(item[4] ?? item[1])).filter(Number.isFinite);
  if (closes.length < 25) return;
  market.rsi = calculateRsi(closes, 14);
  market.smaFast = average(closes.slice(-7));
  market.smaSlow = average(closes.slice(-25));
  const latest = closes.at(-1);
  const hourlyReturns = closes.slice(1).map((value, index) => Math.abs(value / closes[index] - 1));
  market.volatility = average(hourlyReturns.slice(-24)) * 100;
  market.projection4h = projectMove(closes.slice(-36), 4);
  market.price = latest || market.price;
}

function recalculateMarket(market) {
  const dayRange = market.price ? ((market.highPrice - market.lowPrice) / market.price) * 100 : 0;
  const trendBias = market.smaFast && market.smaSlow ? (market.smaFast / market.smaSlow - 1) * 100 : market.changePct / 4;
  const rsiScore = market.rsi == null ? 0 : market.rsi > 78 ? -18 : market.rsi > 68 ? -4 : market.rsi > 48 ? 12 : market.rsi > 38 ? 4 : -12;
  const projectionScore = market.projection4h == null ? 0 : clamp(market.projection4h * 4, -18, 18);
  const momentumScore = clamp(market.changePct * 1.5, -20, 18);
  const liquidityScore = clamp(Math.log10(Math.max(market.volumeQuote, 1)) * 5, 0, 38);
  const trendScore = clamp(trendBias * 3, -18, 18);
  const depthScore = clamp(market.depthBias * 35, -12, 12);
  const riskPenalty = dayRange > 22 ? 18 : dayRange > 14 ? 10 : dayRange < 2 ? 4 : 0;
  market.score = Math.round(clamp(34 + liquidityScore + momentumScore + rsiScore + trendScore + projectionScore + depthScore - riskPenalty, 0, 100));
  market.risk = classifyRisk(market, dayRange);
  market.signal = market.score >= CONFIG.minScore && market.risk !== "alto" ? "buy" : market.score >= 60 ? "watch" : "avoid";
  market.reason = buildReason(market);
}

function classifyRisk(market, dayRange) {
  const hourlyVol = market.volatility ?? dayRange / 8;
  if (hourlyVol < 0.9 && dayRange < 7 && market.volumeQuote > 20000000) return "mas seguro";
  if (hourlyVol > 2.2 || dayRange > 16 || market.volumeQuote < 2500000) return "alto";
  return "moderado";
}

function buildReason(market) {
  const parts = [];
  parts.push(`score ${market.score}`);
  if (market.projection4h != null) parts.push(`proy4h ${market.projection4h.toFixed(2)}%`);
  if (market.rsi != null) parts.push(`RSI ${market.rsi.toFixed(0)}`);
  parts.push(`24h ${market.changePct.toFixed(2)}%`);
  if (market.depthBias) parts.push(`libro ${(market.depthBias * 100).toFixed(1)}%`);
  return parts.join(" - ");
}

async function getOrderBookBias(symbol) {
  const depth = await binancePublicRequest(`/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=50`);
  const bidNotional = depth.bids.slice(0, 20).reduce((sum, [price, qty]) => sum + Number(price) * Number(qty), 0);
  const askNotional = depth.asks.slice(0, 20).reduce((sum, [price, qty]) => sum + Number(price) * Number(qty), 0);
  const total = bidNotional + askNotional;
  return total ? (bidNotional - askNotional) / total : 0;
}

async function getAccountSummary() {
  if (!hasKeys()) {
    return {
      ok: false,
      configured: false,
      error: "Faltan BINANCE_API_KEY y BINANCE_API_SECRET en el servidor.",
      spot: {},
      bot: botLimitsSummary(0, 0),
    };
  }

  const account = await binanceSignedRequest("GET", "/api/v3/account", { omitZeroBalances: "true" });
  const spot = {};
  for (const balance of account.balances || []) {
    const free = Number(balance.free);
    const locked = Number(balance.locked);
    if (free || locked) spot[balance.asset] = { free, locked };
  }
  const usdtFree = spot.USDT?.free ?? 0;
  const openExposure = botState.positions
    .filter((position) => position.status === "open")
    .reduce((sum, position) => sum + position.amountUsdt, 0);
  return {
    ok: true,
    configured: true,
    canTradeLive: CONFIG.liveTrading,
    accountType: account.accountType || "SPOT",
    spot,
    bot: botLimitsSummary(usdtFree, openExposure),
  };
}

function botLimitsSummary(usdtFree, openExposure) {
  const remainingCapital = Math.max(0, CONFIG.maxCapitalUsdt - openExposure);
  return {
    maxCapitalUsdt: CONFIG.maxCapitalUsdt,
    maxTradeUsdt: CONFIG.maxTradeUsdt,
    maxOpenPositions: CONFIG.maxOpenPositions,
    dailyProfitTargetUsdt: CONFIG.dailyProfitTargetUsdt,
    dailyMaxLossUsdt: CONFIG.dailyMaxLossUsdt,
    freeSpotUsdt: usdtFree,
    openExposureUsdt: openExposure,
    availableForBotUsdt: Math.max(0, Math.min(usdtFree, remainingCapital)),
  };
}

async function buildBotStatus() {
  const fx = await getUsdtBobRate().catch((error) => ({ ok: false, error: publicError(error), mid: null }));
  const account = await getAccountSummary().catch((error) => ({ ok: false, error: publicError(error), spot: {}, bot: botLimitsSummary(0, 0) }));
  const prices = new Map();
  for (const position of botState.positions.filter((item) => item.status === "open")) {
    const market = await getMarketForSymbol(position.symbol).catch(() => null);
    if (market) prices.set(position.symbol, market.price);
  }
  const openPositions = botState.positions
    .filter((position) => position.status === "open")
    .map((position) => {
      const price = prices.get(position.symbol) || position.entryPrice;
      const pnl = estimatePositionPnl(position, price);
      return { ...position, currentPrice: price, unrealizedPnlUsdt: pnl.netUsdt, unrealizedPnlPct: pnl.netPct };
    });
  const unrealized = openPositions.reduce((sum, position) => sum + position.unrealizedPnlUsdt, 0);
  return {
    ok: true,
    enabled: botState.enabled,
    mode: CONFIG.liveTrading ? "live" : "paper",
    configured: hasKeys(),
    safeConfig: safeConfig(),
    account,
    fx,
    dayKey: botState.dayKey,
    dailyRealizedPnlUsdt: botState.dailyRealizedPnl,
    unrealizedPnlUsdt: unrealized,
    totalBotPnlUsdt: botState.dailyRealizedPnl + unrealized,
    totalBotPnlBob: fx.mid ? (botState.dailyRealizedPnl + unrealized) * fx.mid : null,
    positions: openPositions,
    closedPositions: botState.positions.filter((position) => position.status === "closed").slice(0, 20),
    trades: botState.trades.slice(0, 30),
    alerts: botState.alerts.slice(0, 30),
    lastScanAt: botState.lastScanAt,
    lastDecision: botState.lastDecision,
    lastError: botState.lastError,
  };
}

async function getUsdtBobRate() {
  if (marketCache.fx && Date.now() - marketCache.fxAt < 60000) return marketCache.fx;
  try {
    const buy = await fetchP2pPrice("BUY");
    const sell = await fetchP2pPrice("SELL");
    const result = {
      ok: true,
      source: "Binance P2P",
      buy: buy.price,
      sell: sell.price,
      mid: (buy.price + sell.price) / 2,
      samples: { buy: buy.samples, sell: sell.samples },
      updatedAt: new Date().toISOString(),
    };
    marketCache.fx = result;
    marketCache.fxAt = Date.now();
    return result;
  } catch (error) {
    const fallback = await fetchJson("https://bo.dolarapi.com/v1/dolares/binance", {}, 10000);
    const result = {
      ok: true,
      source: "DolarApi Bolivia - Binance",
      buy: Number(fallback.compra),
      sell: Number(fallback.venta),
      mid: (Number(fallback.compra) + Number(fallback.venta)) / 2,
      updatedAt: fallback.fechaActualizacion || new Date().toISOString(),
      fallbackReason: publicError(error),
    };
    marketCache.fx = result;
    marketCache.fxAt = Date.now();
    return result;
  }
}

async function fetchP2pPrice(tradeType) {
  const response = await fetchJson(
    "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "BOT-CRIPTO/1.0",
      },
      body: JSON.stringify({
        page: 1,
        rows: 10,
        payTypes: [],
        asset: "USDT",
        tradeType,
        fiat: "BOB",
        merchantCheck: false,
      }),
    },
    12000
  );
  const prices = (response.data || [])
    .filter((row) => row.adv?.isTradable !== false)
    .filter((row) => Number(row.advertiser?.monthFinishRate || 1) >= 0.9)
    .map((row) => Number(row.adv.price))
    .filter(Number.isFinite)
    .slice(0, 7)
    .sort((a, b) => a - b);
  if (!prices.length) throw new Error(`Sin precios P2P ${tradeType}`);
  return { price: median(prices), samples: prices.length };
}

async function getCommissionRate(symbol) {
  if (marketCache.commission.has(symbol)) return marketCache.commission.get(symbol);
  if (!hasKeys()) return CONFIG.takerFeeRate;
  try {
    const data = await binanceSignedRequest("GET", "/api/v3/account/commission", { symbol });
    const standard = Number(data.standardCommission?.taker || CONFIG.takerFeeRate);
    const special = Number(data.specialCommission?.taker || 0);
    const tax = Number(data.taxCommission?.taker || 0);
    const rate = standard + special + tax;
    marketCache.commission.set(symbol, rate);
    return rate;
  } catch {
    marketCache.commission.set(symbol, CONFIG.takerFeeRate);
    return CONFIG.takerFeeRate;
  }
}

async function getExchangeInfo() {
  if (marketCache.exchangeInfo && Date.now() - marketCache.exchangeInfoAt < 10 * 60 * 1000) return marketCache.exchangeInfo;
  const data = await binancePublicRequest("/api/v3/exchangeInfo");
  marketCache.exchangeInfo = data;
  marketCache.exchangeInfoAt = Date.now();
  return data;
}

async function get24hTickers() {
  if (marketCache.tickers && Date.now() - marketCache.tickersAt < 15000) return marketCache.tickers;
  const data = await binancePublicRequest("/api/v3/ticker/24hr");
  marketCache.tickers = data;
  marketCache.tickersAt = Date.now();
  return data;
}

async function getKlines(symbol, interval, limit) {
  return binancePublicRequest(`/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);
}

async function getSymbolInfo(symbol) {
  const exchangeInfo = await getExchangeInfo();
  const raw = exchangeInfo.symbols.find((item) => item.symbol === symbol);
  if (!raw) throw new Error(`Symbol not found: ${symbol}`);
  const filters = Object.fromEntries((raw.filters || []).map((filter) => [filter.filterType, filter]));
  const lot = filters.LOT_SIZE || {};
  const minNotionalFilter = filters.NOTIONAL || filters.MIN_NOTIONAL || {};
  return {
    raw,
    symbol,
    baseAsset: raw.baseAsset,
    quoteAsset: raw.quoteAsset,
    stepSize: Number(lot.stepSize || 0.00000001),
    minQty: Number(lot.minQty || 0),
    minNotional: Number(minNotionalFilter.minNotional || 5),
    quantityPrecision: countDecimals(lot.stepSize || "0.00000001"),
  };
}

async function binancePublicRequest(apiPath) {
  return fetchJson(`${CONFIG.binanceBaseUrl}${apiPath}`, {}, 12000);
}

async function binanceSignedRequest(method, apiPath, params = {}) {
  assertKeys();
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, recvWindow: CONFIG.recvWindow, timestamp: Date.now() })) {
    if (value !== undefined && value !== null && value !== "") search.append(key, String(value));
  }
  const payload = search.toString();
  const signature = crypto.createHmac("sha256", CONFIG.apiSecret).update(payload).digest("hex");
  const signedPayload = `${payload}&signature=${signature}`;
  const headers = { "X-MBX-APIKEY": CONFIG.apiKey };

  if (method === "GET") {
    return fetchJson(`${CONFIG.binanceBaseUrl}${apiPath}?${signedPayload}`, { headers }, 12000);
  }

  return fetchJson(
    `${CONFIG.binanceBaseUrl}${apiPath}`,
    {
      method,
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: signedPayload,
    },
    12000
  );
}

async function fetchJson(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok || data?.code < 0) {
      throw new Error(data?.msg || data?.message || `${response.status} ${response.statusText}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function safeConfig() {
  return {
    binanceBaseUrl: CONFIG.binanceBaseUrl,
    apiKey: CONFIG.apiKey ? `${CONFIG.apiKey.slice(0, 4)}...${CONFIG.apiKey.slice(-4)}` : null,
    liveTrading: CONFIG.liveTrading,
    autoStart: CONFIG.autoStart,
    maxCapitalUsdt: CONFIG.maxCapitalUsdt,
    maxTradeUsdt: CONFIG.maxTradeUsdt,
    maxOpenPositions: CONFIG.maxOpenPositions,
    dailyProfitTargetUsdt: CONFIG.dailyProfitTargetUsdt,
    dailyMaxLossUsdt: CONFIG.dailyMaxLossUsdt,
    minScore: CONFIG.minScore,
    scanIntervalMs: CONFIG.scanIntervalMs,
    takerFeeRateFallback: CONFIG.takerFeeRate,
    stopLossPct: CONFIG.stopLossPct,
    takeProfitPct: CONFIG.takeProfitPct,
    trailingStopPct: CONFIG.trailingStopPct,
    allowedSymbols: CONFIG.allowedSymbols,
    excludedSymbols: CONFIG.excludedSymbols,
  };
}

function addBotAlert(title, body) {
  botState.alerts.unshift({ id: crypto.randomUUID(), title, body, createdAt: Date.now() });
  botState.alerts = botState.alerts.slice(0, 100);
}

function hasKeys() {
  return Boolean(CONFIG.apiKey && CONFIG.apiSecret);
}

function assertKeys() {
  if (!hasKeys()) throw new Error("Missing BINANCE_API_KEY or BINANCE_API_SECRET.");
}

function assertTradingReady() {
  assertKeys();
  if (!CONFIG.liveTrading) throw new Error("Live trading is disabled.");
}

function publicError(error) {
  return error?.message || String(error);
}

function parseSymbolList(value, fallback) {
  if (value == null) return [...fallback];
  return value
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function envBool(name, fallback) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function envNum(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function median(values) {
  const index = Math.floor(values.length / 2);
  return values.length % 2 ? values[index] : (values[index - 1] + values[index]) / 2;
}

function calculateRsi(closes, period) {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let index = closes.length - period; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  if (losses === 0) return 100;
  const rs = gains / period / (losses / period);
  return 100 - 100 / (1 + rs);
}

function projectMove(closes, hours) {
  if (closes.length < 8) return null;
  const logs = closes.map((value) => Math.log(value));
  const n = logs.length;
  const xMean = (n - 1) / 2;
  const yMean = average(logs);
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index += 1) {
    numerator += (index - xMean) * (logs[index] - yMean);
    denominator += (index - xMean) ** 2;
  }
  const slope = denominator ? numerator / denominator : 0;
  return (Math.exp(slope * hours) - 1) * 100;
}

function roundStep(value, stepSize) {
  if (!stepSize) return value;
  return Math.floor(value / stepSize) * stepSize;
}

function countDecimals(value) {
  const text = String(value);
  if (!text.includes(".")) return 0;
  return text.replace(/0+$/, "").split(".")[1]?.length || 0;
}

function toFixedTrim(value, decimals) {
  return Number(value).toFixed(decimals).replace(/\.?0+$/, "");
}
