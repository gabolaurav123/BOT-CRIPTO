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

const UNIVERSE_MODE = (process.env.BOT_UNIVERSE_MODE || "conservative").toLowerCase();

const CONFIG = {
  port: Number(process.env.PORT || 8080),
  binanceBaseUrl: stripTrailingSlash(process.env.BINANCE_BASE_URL || "https://api.binance.com"),
  apiKey: process.env.BINANCE_API_KEY || "",
  apiSecret: process.env.BINANCE_API_SECRET || "",
  appUsername: process.env.APP_USERNAME || "",
  appPassword: process.env.APP_PASSWORD || "",
  appSessionSecret: process.env.APP_SESSION_SECRET || "",
  liveTrading: envBool("BOT_LIVE_TRADING", false),
  autoStart: envBool("BOT_AUTO_START", false),
  maxCapitalUsdt: envNum("BOT_MAX_CAPITAL_USDT", 50),
  maxTradeUsdt: envNum("BOT_MAX_TRADE_USDT", 6),
  maxOpenPositions: Math.max(1, envNum("BOT_MAX_OPEN_POSITIONS", 4)),
  dailyProfitTargetUsdt: envNum("BOT_DAILY_PROFIT_TARGET_USDT", 10),
  dailyMaxLossUsdt: envNum("BOT_DAILY_MAX_LOSS_USDT", 1),
  minNotionalBufferPct: envNum("BOT_MIN_NOTIONAL_BUFFER_PCT", 12),
  allowRescueTopUp: envBool("BOT_ALLOW_RESCUE_TOP_UP", true),
  rescueTopUpBufferPct: envNum("BOT_RESCUE_TOP_UP_BUFFER_PCT", 15),
  maxRescueTopUpUsdt: envNum("BOT_MAX_RESCUE_TOP_UP_USDT", 8),
  retryNotionalClose: envBool("BOT_RETRY_NOTIONAL_CLOSE", true),
  minScore: envNum("BOT_MIN_SCORE", 82),
  highRiskMinScore: envNum("BOT_HIGH_RISK_MIN_SCORE", 90),
  scanIntervalMs: Math.max(15000, envNum("BOT_SCAN_INTERVAL_MS", 60000)),
  positionCheckIntervalMs: Math.max(3000, envNum("BOT_POSITION_CHECK_INTERVAL_MS", 10000)),
  statusExitGuard: envBool("BOT_STATUS_EXIT_GUARD", true),
  scanUniverseLimit: Math.max(30, envNum("BOT_SCAN_UNIVERSE_LIMIT", 140)),
  minQuoteVolumeUsdt: envNum("BOT_MIN_QUOTE_VOLUME_USDT", 2500000),
  max24hChangePct: envNum("BOT_MAX_24H_CHANGE_PCT", 35),
  maxSpreadPct: envNum("BOT_MAX_SPREAD_PCT", 0.35),
  maxPositionLossPct: envNum("BOT_MAX_POSITION_LOSS_PCT", 1.4),
  exitWeakScore: envNum("BOT_EXIT_WEAK_SCORE", 62),
  takerFeeRate: envNum("BOT_TAKER_FEE_RATE", 0.001),
  stopLossPct: envNum("BOT_STOP_LOSS_PCT", 1.8),
  takeProfitPct: envNum("BOT_TAKE_PROFIT_PCT", 1.2),
  trailingStopPct: envNum("BOT_TRAILING_STOP_PCT", 0.7),
  allowHighRisk: envBool("BOT_ALLOW_HIGH_RISK", false),
  highRiskMaxTradeUsdt: envNum("BOT_HIGH_RISK_MAX_TRADE_USDT", 6),
  maxHighRiskOpenPositions: Math.max(0, envNum("BOT_MAX_HIGH_RISK_OPEN_POSITIONS", 1)),
  highRiskMax24hChangePct: envNum("BOT_HIGH_RISK_MAX_24H_CHANGE_PCT", 18),
  highRiskMaxSpreadPct: envNum("BOT_HIGH_RISK_MAX_SPREAD_PCT", 0.2),
  highRiskMinDepthBias: envNum("BOT_HIGH_RISK_MIN_DEPTH_BIAS", 0.08),
  highRiskRsiMin: envNum("BOT_HIGH_RISK_RSI_MIN", 48),
  highRiskRsiMax: envNum("BOT_HIGH_RISK_RSI_MAX", 64),
  highRiskMaxPositionLossPct: envNum("BOT_HIGH_RISK_MAX_POSITION_LOSS_PCT", 0.8),
  highRiskExitWeakScore: envNum("BOT_HIGH_RISK_EXIT_WEAK_SCORE", 72),
  highRiskStopLossPct: envNum("BOT_HIGH_RISK_STOP_LOSS_PCT", 1.2),
  highRiskTakeProfitPct: envNum("BOT_HIGH_RISK_TAKE_PROFIT_PCT", 1.8),
  universeMode: UNIVERSE_MODE,
  allowedSymbols: parseSymbolList(process.env.BOT_ALLOWED_SYMBOLS, UNIVERSE_MODE === "dynamic" ? [] : DEFAULT_ALLOWED_SYMBOLS),
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

const AUTH_COOKIE = "bot_cripto_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const marketCache = {
  exchangeInfo: null,
  exchangeInfoAt: 0,
  tickers: null,
  tickersAt: 0,
  fx: null,
  fxAt: 0,
  serverIp: null,
  serverIpAt: 0,
  commission: new Map(),
};

const botState = loadState();
let botTimer = null;
let positionTimer = null;
let scanInProgress = false;
let positionGuardInProgress = false;

if (CONFIG.autoStart) {
  botState.enabled = true;
  botState.startedAt = botState.startedAt || Date.now();
  saveState();
}

scheduleBotLoop();
schedulePositionGuard();

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (!isPublicRoute(url) && !isAuthenticated(req)) {
      if (url.pathname.startsWith("/api/")) {
        sendJson(res, 401, { ok: false, error: "Authentication required." });
      } else {
        redirect(res, "/login.html");
      }
      return;
    }

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
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    if (!authConfigured()) {
      sendJson(res, 503, { ok: false, error: "Auth is not configured. Set APP_USERNAME, APP_PASSWORD and APP_SESSION_SECRET." });
      return;
    }
    const body = await readJsonBody(req);
    if (safeEqual(body.username || "", CONFIG.appUsername) && safeEqual(body.password || "", CONFIG.appPassword)) {
      setSessionCookie(res, createSessionToken(CONFIG.appUsername));
      sendJson(res, 200, { ok: true, username: CONFIG.appUsername });
      return;
    }
    sendJson(res, 401, { ok: false, error: "Usuario o contrasena incorrectos." });
    return;
  }

  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    sendJson(res, 200, { ok: true, username: sessionUser(req) });
    return;
  }

  if (url.pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      now: new Date().toISOString(),
      binanceConfigured: hasKeys(),
      liveTrading: CONFIG.liveTrading,
      botEnabled: botState.enabled,
      authConfigured: authConfigured(),
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

  if (url.pathname === "/api/server-ip" && req.method === "GET") {
    sendJson(res, 200, await getServerPublicIp());
    return;
  }

  if (url.pathname === "/api/fx/usdtbob" && req.method === "GET") {
    sendJson(res, 200, await getUsdtBobRate());
    return;
  }

  if (url.pathname === "/api/market/snapshot" && req.method === "GET") {
    const scan = await scanMarket({ includeDepth: false, limit: CONFIG.scanUniverseLimit });
    sendJson(res, 200, { ok: true, markets: scan });
    return;
  }

  if (url.pathname === "/api/bot/status" && req.method === "GET") {
    if (CONFIG.statusExitGuard && hasOpenPositions()) await runPositionGuard();
    sendJson(res, 200, await buildBotStatus());
    return;
  }

  if (url.pathname === "/api/bot/start" && req.method === "POST") {
    botState.enabled = true;
    botState.startedAt = Date.now();
    addBotAlert("Bot iniciado", CONFIG.liveTrading ? "Modo live habilitado por variables de entorno." : "Modo paper, no ejecuta ordenes reales.");
    saveState();
    scheduleBotLoop(true);
    schedulePositionGuard(true);
    sendJson(res, 200, await buildBotStatus());
    return;
  }

  if (url.pathname === "/api/bot/stop" && req.method === "POST") {
    botState.enabled = false;
    addBotAlert("Bot pausado", "No abrira posiciones nuevas hasta que lo vuelvas a iniciar.");
    saveState();
    scheduleBotLoop();
    schedulePositionGuard();
    sendJson(res, 200, await buildBotStatus());
    return;
  }

  if (url.pathname === "/api/bot/reset-day" && req.method === "POST") {
    resetTradingDay("Reinicio manual del dia operativo. El bot queda pausado hasta que lo inicies.");
    botState.enabled = false;
    scheduleBotLoop();
    schedulePositionGuard();
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
    const position = body.positionId
      ? botState.positions.find((item) => item.id === body.positionId && item.status === "open")
      : botState.positions.find((item) => item.symbol === body.symbol && item.status === "open");
    if (!position) {
      sendJson(res, 404, { ok: false, error: "Open position not found." });
      return;
    }
    try {
      await closePosition(position, "manual close", null, { forceWalletBalance: Boolean(body.force) });
    } catch (error) {
      const status = await buildBotStatus();
      sendJson(res, 200, { ...status, closeError: publicError(error) });
      return;
    }
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

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
  });
  res.end();
}

function isPublicRoute(url) {
  return (
    url.pathname === "/login.html" ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/api/health" ||
    url.pathname === "/api/auth/login" ||
    url.pathname === "/api/auth/logout"
  );
}

function authConfigured() {
  return Boolean(CONFIG.appUsername && CONFIG.appPassword && CONFIG.appSessionSecret);
}

function isAuthenticated(req) {
  return Boolean(sessionUser(req));
}

function sessionUser(req) {
  if (!authConfigured()) return null;
  const token = parseCookies(req.headers.cookie || "")[AUTH_COOKIE];
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedUser, expiresText, signature] = parts;
  const payload = `${encodedUser}.${expiresText}`;
  const expected = sign(payload);
  if (!safeEqual(signature, expected)) return null;
  const expires = Number(expiresText);
  if (!Number.isFinite(expires) || expires < Date.now()) return null;
  const username = Buffer.from(encodedUser, "base64url").toString("utf8");
  return username === CONFIG.appUsername ? username : null;
}

function createSessionToken(username) {
  const encodedUser = Buffer.from(username, "utf8").toString("base64url");
  const expires = String(Date.now() + SESSION_TTL_MS);
  const payload = `${encodedUser}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", `${AUTH_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${AUTH_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

function sign(payload) {
  return crypto.createHmac("sha256", CONFIG.appSessionSecret).update(payload).digest("base64url");
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
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
    lastPositionCheckAt: null,
    lastDecision: "Sin escaneo todavia.",
    lastError: null,
  };
}

function saveState() {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(botState, null, 2));
}

function hasOpenPositions() {
  return botState.positions.some((item) => item.status === "open");
}

function resetDailyIfNeeded() {
  const key = dayKey();
  if (botState.dayKey === key) return;
  resetTradingDay("Nuevo dia operativo. Se reiniciaron los limites diarios de PnL.");
}

function resetTradingDay(message) {
  botState.dayKey = dayKey();
  botState.dailyRealizedPnl = 0;
  botState.lastError = null;
  botState.lastDecision = message;
  addBotAlert("Dia operativo reiniciado", message);
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

function schedulePositionGuard(runNow = false) {
  if (positionTimer) clearTimeout(positionTimer);
  if (!botState.enabled && !hasOpenPositions()) return;
  if (runNow) runPositionGuard().catch((error) => console.error(error));
  positionTimer = setTimeout(async () => {
    await runPositionGuard().catch((error) => console.error(error));
    schedulePositionGuard();
  }, CONFIG.positionCheckIntervalMs);
}

async function runPositionGuard() {
  if (positionGuardInProgress) return;
  const openPositions = botState.positions.filter((item) => item.status === "open");
  if (!openPositions.length) return;

  positionGuardInProgress = true;
  resetDailyIfNeeded();
  try {
    await manageOpenPositions(new Map());
    botState.lastPositionCheckAt = Date.now();
    botState.lastError = null;
    saveState();
  } catch (error) {
    botState.lastError = publicError(error);
    addBotAlert("Error revisando posiciones", botState.lastError);
    saveState();
  } finally {
    positionGuardInProgress = false;
  }
}

async function runBotScan(options = {}) {
  if (!botState.enabled && !options.manual) return;
  if (scanInProgress) return;
  scanInProgress = true;
  resetDailyIfNeeded();

  try {
    const account = await getAccountSummary();
    const scan = await scanMarket({ includeDepth: true, limit: CONFIG.scanUniverseLimit });
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
      let opened = false;
      let hadCandidate = false;
      for (const candidate of scan.filter((market) => canEnterMarket(market, openPositions))) {
        hadCandidate = true;
        opened = await openPosition(candidate, availableUsdt);
        if (opened) break;
      }
      if (!opened && !hadCandidate) botState.lastDecision = "No hay entrada con ventaja suficiente segun filtros actuales.";
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
  const highRisk = market.risk === "alto";
  const requiredScore = highRisk ? CONFIG.highRiskMinScore : CONFIG.minScore;
  if (market.score < requiredScore) return false;
  if (highRisk && !CONFIG.allowHighRisk) return false;
  if (market.projection4h < (highRisk ? 0.55 : 0.25)) return false;
  if (market.rsi > (highRisk ? CONFIG.highRiskRsiMax : 72) || market.rsi < (highRisk ? CONFIG.highRiskRsiMin : 42)) return false;
  if (market.depthBias < -0.08) return false;
  if (market.spreadPct != null && market.spreadPct > (highRisk ? CONFIG.highRiskMaxSpreadPct : CONFIG.maxSpreadPct)) return false;
  if (highRisk && market.depthBias < CONFIG.highRiskMinDepthBias) return false;
  if (highRisk && market.changePct > CONFIG.highRiskMax24hChangePct) return false;
  if (highRisk && market.smaFast && market.smaSlow && market.smaFast <= market.smaSlow) return false;
  if (market.volumeQuote < CONFIG.minQuoteVolumeUsdt) return false;
  if (market.changePct > CONFIG.max24hChangePct) return false;
  if (openPositions.some((position) => position.symbol === market.symbol)) return false;
  if (highRisk && openPositions.filter((position) => position.risk === "alto").length >= CONFIG.maxHighRiskOpenPositions) return false;
  return true;
}

function getTradeSizeForMarket(market) {
  if (market.risk === "alto") return Math.min(CONFIG.highRiskMaxTradeUsdt, CONFIG.maxTradeUsdt);
  if (market.risk === "moderado") return CONFIG.maxTradeUsdt;
  return CONFIG.maxTradeUsdt;
}

function getRequiredNotional(symbolInfo) {
  const minNotional = symbolInfo.minNotional || 5;
  return minNotional * (1 + CONFIG.minNotionalBufferPct / 100);
}

function getExitConfigForMarket(market) {
  if (market.risk === "alto") {
    return {
      stopLossPct: CONFIG.highRiskStopLossPct,
      takeProfitPct: CONFIG.highRiskTakeProfitPct,
    };
  }
  return {
    stopLossPct: CONFIG.stopLossPct,
    takeProfitPct: CONFIG.takeProfitPct,
  };
}

async function openPosition(market, availableUsdt) {
  const symbolInfo = await getSymbolInfo(market.symbol);
  const minNotional = symbolInfo.minNotional || 5;
  const requiredNotional = getRequiredNotional(symbolInfo);
  const preferredSize = getTradeSizeForMarket(market);
  if (requiredNotional > preferredSize) {
    botState.lastDecision = `${market.symbol} descartado: Binance exige minimo seguro ${requiredNotional.toFixed(2)} USDT y el maximo por operacion es ${preferredSize.toFixed(2)} USDT.`;
    return false;
  }
  const amountUsdt = Math.min(preferredSize, availableUsdt, CONFIG.maxCapitalUsdt);
  if (amountUsdt < requiredNotional) {
    botState.lastDecision = `${market.symbol} descartado: monto ${amountUsdt.toFixed(2)} menor al minimo seguro ${requiredNotional.toFixed(2)} USDT.`;
    return false;
  }

  const feeRate = await getCommissionRate(market.symbol);
  const exitConfig = getExitConfigForMarket(market);
  const expectedStop = market.price * (1 - exitConfig.stopLossPct / 100);
  const expectedTarget = market.price * (1 + (exitConfig.takeProfitPct + feeRate * 200) / 100);
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
    risk: market.risk,
    openedAt: Date.now(),
    buyOrderId: order.orderId || null,
    reason: market.reason,
  };

  botState.positions.unshift(position);
  botState.lastDecision = `Entrada ${position.mode}: ${market.symbol} por ${position.amountUsdt.toFixed(2)} USDT.`;
  addBotAlert("Entrada del bot", `${market.symbol}: ${position.amountUsdt.toFixed(2)} USDT a ${position.entryPrice}.`);
  saveState();
  return true;
}

async function manageOpenPositions(marketsBySymbol) {
  for (const position of botState.positions.filter((item) => item.status === "open")) {
    const market = marketsBySymbol.get(position.symbol) || (await getMarketForSymbol(position.symbol));
    if (!market?.price) continue;

    position.peakPrice = Math.max(position.peakPrice || position.entryPrice, market.price);
    const trailingStop = position.peakPrice * (1 - CONFIG.trailingStopPct / 100);
    const pnl = estimatePositionPnl(position, market.price);
    const highRisk = position.risk === "alto";
    const maxLossPct = highRisk ? CONFIG.highRiskMaxPositionLossPct : CONFIG.maxPositionLossPct;
    const weakScore = highRisk ? CONFIG.highRiskExitWeakScore : CONFIG.exitWeakScore;
    let reason = "";

    if (market.price <= position.stop) reason = "stop-loss";
    else if (pnl.netPct <= -Math.abs(maxLossPct)) reason = "max-loss-position";
    else if (position.peakPrice > position.entryPrice * 1.008 && market.price <= trailingStop) reason = "trailing-stop";
    else if (market.price >= position.target) reason = "take-profit";
    else if (market.score < weakScore && pnl.netUsdt <= 0) reason = "senal-debil";
    else if ((market.projection4h ?? 0) < -0.2 && market.depthBias < -0.08 && pnl.netUsdt <= 0) reason = "reversion-bajista";
    else if (botState.dailyRealizedPnl + pnl.netUsdt <= -Math.abs(CONFIG.dailyMaxLossUsdt)) reason = "proteccion-perdida-diaria";

    if (reason) {
      await closePosition(position, reason, market.price).catch(() => {
        // closePosition stores the public error on the position; keep checking the rest.
      });
    }
  }
}

async function closePosition(position, reason, currentPrice = null, options = {}) {
  try {
    const market = currentPrice ? { price: currentPrice } : await getMarketForSymbol(position.symbol);
    const exitPrice = market?.price || position.entryPrice;
    const order = await closePositionOrder(position, exitPrice, options);
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
    position.lastCloseError = null;
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
  } catch (error) {
    const message = publicError(error);
    position.lastCloseError = message;
    position.lastCloseErrorAt = Date.now();
    botState.lastDecision = `No se pudo cerrar ${position.symbol}: ${message}`;
    addBotAlert("Error cerrando posicion", botState.lastDecision);
    saveState();
    throw error;
  }
}

async function closePositionOrder(position, exitPrice, options = {}) {
  await rescueBelowNotionalPosition(position, exitPrice, options);
  try {
    return await placeMarketSell(position.symbol, position.quantity, options);
  } catch (error) {
    if (!CONFIG.retryNotionalClose || !isNotionalError(error)) throw error;
    const retryPrice = await getCloseReferencePrice(position.symbol, exitPrice);
    await rescueBelowNotionalPosition(position, retryPrice, { ...options, forceRescue: true });
    return placeMarketSell(position.symbol, position.quantity, { ...options, skipNotionalPrecheck: true });
  }
}

async function rescueBelowNotionalPosition(position, exitPrice, options = {}) {
  if (!CONFIG.liveTrading || !CONFIG.allowRescueTopUp) return;
  const info = await getSymbolInfo(position.symbol);
  const account = await getAccountSummary();
  const { freeBase, sellQty } = getSellQuantityForPosition(position, info, account, options);
  const referencePrice = await getCloseReferencePrice(position.symbol, exitPrice);
  const currentNotional = sellQty * referencePrice;
  const targetNotional = info.minNotional * (1 + CONFIG.rescueTopUpBufferPct / 100);
  if (sellQty <= 0) {
    throw new Error(`No hay ${info.baseAsset} libre para vender. Balance libre reportado: ${freeBase}. Cantidad posicion: ${position.quantity}.`);
  }
  if (!options.forceRescue && currentNotional >= targetNotional) return;

  const quoteOrderQty = Math.max(targetNotional - currentNotional, targetNotional);
  if (quoteOrderQty > CONFIG.maxRescueTopUpUsdt) {
    throw new Error(
      `NOTIONAL minimo: ${position.symbol} vale ${currentNotional.toFixed(4)} USDT vendible (${freeBase} ${info.baseAsset}) y requiere rescate de ${quoteOrderQty.toFixed(2)} USDT, mayor al limite BOT_MAX_RESCUE_TOP_UP_USDT=${CONFIG.maxRescueTopUpUsdt}.`
    );
  }

  const freeUsdt = account.spot?.USDT?.free ?? 0;
  if (freeUsdt < quoteOrderQty) {
    throw new Error(
      `NOTIONAL minimo: ${position.symbol} vale ${currentNotional.toFixed(4)} USDT. Falta USDT libre para rescate (${quoteOrderQty.toFixed(2)} requerido).`
    );
  }

  const rescueOrder = await placeMarketBuy(position.symbol, quoteOrderQty);
  position.quantity += Number(rescueOrder.executedQty || 0);
  position.amountUsdt += Number(rescueOrder.cummulativeQuoteQty || quoteOrderQty);
  position.rescueTopUps = position.rescueTopUps || [];
  position.rescueTopUps.push({
    orderId: rescueOrder.orderId || null,
    quoteOrderQty,
    executedQty: rescueOrder.executedQty,
    cummulativeQuoteQty: rescueOrder.cummulativeQuoteQty,
    createdAt: Date.now(),
  });
  addBotAlert("Rescate por minimo Binance", `${position.symbol}: se compro ${quoteOrderQty.toFixed(2)} USDT extra para poder vender por encima del minimo NOTIONAL.`);
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

async function placeMarketSell(symbol, quantity, options = {}) {
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
  const positionLike = { symbol, quantity };
  const { freeBase, sellQty } = getSellQuantityForPosition(positionLike, info, account, options);
  const referencePrice = await getCloseReferencePrice(symbol, 0);
  const estimatedQuote = sellQty * referencePrice;
  if (!options.skipNotionalPrecheck && estimatedQuote > 0 && estimatedQuote < info.minNotional) {
    throw new Error(
      `NOTIONAL minimo: ${symbol} vale aprox. ${estimatedQuote.toFixed(4)} USDT y Binance exige ${info.minNotional} USDT. Espera que suba por encima del minimo o compra mas de esa moneda para poder vender todo.`
    );
  }
  if (sellQty <= 0) {
    throw new Error(`No hay ${info.baseAsset} libre para vender. Balance libre reportado: ${freeBase}. Cantidad posicion: ${quantity}.`);
  }
  if (info.marketMinQty && sellQty < info.marketMinQty) {
    throw new Error(`Cantidad minima: ${symbol} requiere ${info.marketMinQty} ${info.baseAsset} y solo se puede vender ${sellQty}.`);
  }
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

function getSellQuantityForPosition(position, info, account, options = {}) {
  const freeBase = account.spot?.[info.baseAsset]?.free ?? 0;
  const positionQty = Number(position.quantity || 0);
  const rawQty = options.forceWalletBalance ? freeBase : Math.min(positionQty, freeBase);
  const clippedQty = Math.min(rawQty, info.marketMaxQty || rawQty);
  const sellQty = roundStep(clippedQty, info.marketStepSize || info.stepSize);
  return { freeBase, positionQty, rawQty, sellQty };
}

async function getCloseReferencePrice(symbol, fallback = 0) {
  const prices = [];
  const avgPrice = await getAveragePrice(symbol).catch(() => 0);
  if (Number.isFinite(avgPrice) && avgPrice > 0) prices.push(avgPrice);
  if (Number.isFinite(fallback) && fallback > 0) prices.push(fallback);
  if (!prices.length) {
    const market = await getMarketForSymbol(symbol).catch(() => null);
    if (market?.price) prices.push(market.price);
  }
  return prices.length ? Math.min(...prices) : 0;
}

function isNotionalError(error) {
  return /notional|filter failure/i.test(publicError(error));
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
    .filter((market) => market.price > 0 && market.volumeQuote >= CONFIG.minQuoteVolumeUsdt)
    .filter((market) => !STABLE_OR_WRAPPED_BASES.has(market.baseAsset))
    .sort((a, b) => b.volumeQuote - a.volumeQuote)
    .slice(0, options.limit || CONFIG.scanUniverseLimit);

  const queue = [...candidates];
  const workers = Array.from({ length: 5 }, async () => {
    while (queue.length) {
      const market = queue.shift();
      const klines = await getKlines(market.symbol, "1h", 120).catch(() => []);
      applyTechnicalIndicators(market, klines);
      if (options.includeDepth) {
        Object.assign(market, await getOrderBookMetrics(market.symbol).catch(() => ({ depthBias: 0, spreadPct: null })));
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
  Object.assign(market, await getOrderBookMetrics(symbol).catch(() => ({ depthBias: 0, spreadPct: null })));
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
    spreadPct: null,
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
  const spreadPenalty = market.spreadPct == null ? 0 : market.spreadPct > 0.5 ? 14 : market.spreadPct > 0.25 ? 8 : market.spreadPct > 0.12 ? 3 : 0;
  const riskPenalty = dayRange > 22 ? 18 : dayRange > 14 ? 10 : dayRange < 2 ? 4 : 0;
  market.score = Math.round(clamp(34 + liquidityScore + momentumScore + rsiScore + trendScore + projectionScore + depthScore - riskPenalty - spreadPenalty, 0, 100));
  market.risk = classifyRisk(market, dayRange);
  const canSignalBuy = market.risk === "alto" ? CONFIG.allowHighRisk && market.score >= CONFIG.highRiskMinScore : market.score >= CONFIG.minScore;
  market.signal = canSignalBuy ? "buy" : market.score >= 60 ? "watch" : "avoid";
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
  if (market.spreadPct != null) parts.push(`spread ${market.spreadPct.toFixed(3)}%`);
  return parts.join(" - ");
}

async function getOrderBookMetrics(symbol) {
  const depth = await binancePublicRequest(`/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=50`);
  const bidNotional = depth.bids.slice(0, 20).reduce((sum, [price, qty]) => sum + Number(price) * Number(qty), 0);
  const askNotional = depth.asks.slice(0, 20).reduce((sum, [price, qty]) => sum + Number(price) * Number(qty), 0);
  const total = bidNotional + askNotional;
  const bestBid = Number(depth.bids[0]?.[0] || 0);
  const bestAsk = Number(depth.asks[0]?.[0] || 0);
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : 0;
  return {
    depthBias: total ? (bidNotional - askNotional) / total : 0,
    spreadPct: mid ? ((bestAsk - bestBid) / mid) * 100 : null,
  };
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
  const serverIp = await getServerPublicIp().catch((error) => ({ ok: false, error: publicError(error), ip: null }));
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
    serverIp,
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
    lastPositionCheckAt: botState.lastPositionCheckAt,
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

async function getServerPublicIp() {
  if (marketCache.serverIp && Date.now() - marketCache.serverIpAt < 5 * 60 * 1000) return marketCache.serverIp;
  const response = await fetchJson("https://api.ipify.org?format=json", {}, 10000);
  const result = {
    ok: true,
    ip: response.ip,
    source: "api.ipify.org",
    updatedAt: new Date().toISOString(),
  };
  marketCache.serverIp = result;
  marketCache.serverIpAt = Date.now();
  return result;
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

async function getAveragePrice(symbol) {
  const data = await binancePublicRequest(`/api/v3/avgPrice?symbol=${encodeURIComponent(symbol)}`);
  return Number(data.price || 0);
}

async function getSymbolInfo(symbol) {
  const exchangeInfo = await getExchangeInfo();
  const raw = exchangeInfo.symbols.find((item) => item.symbol === symbol);
  if (!raw) throw new Error(`Symbol not found: ${symbol}`);
  const filters = Object.fromEntries((raw.filters || []).map((filter) => [filter.filterType, filter]));
  const lot = filters.LOT_SIZE || {};
  const marketLot = filters.MARKET_LOT_SIZE || {};
  const minNotionalFilter = filters.NOTIONAL || filters.MIN_NOTIONAL || {};
  const lotStepSize = Number(lot.stepSize || 0.00000001);
  const marketStepSize = Number(marketLot.stepSize || 0);
  const lotMaxQty = Number(lot.maxQty || Number.MAX_SAFE_INTEGER);
  const marketMaxQty = Number(marketLot.maxQty || 0);
  const orderStepSize = marketStepSize > 0 ? marketStepSize : lotStepSize;
  return {
    raw,
    symbol,
    baseAsset: raw.baseAsset,
    quoteAsset: raw.quoteAsset,
    stepSize: lotStepSize,
    marketStepSize: orderStepSize,
    minQty: Number(lot.minQty || 0),
    marketMinQty: Number(marketLot.minQty || lot.minQty || 0),
    marketMaxQty: marketMaxQty > 0 ? marketMaxQty : lotMaxQty,
    minNotional: Number(minNotionalFilter.minNotional || 5),
    quantityPrecision: countDecimals(marketStepSize > 0 ? marketLot.stepSize : lot.stepSize || "0.00000001"),
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
    minNotionalBufferPct: CONFIG.minNotionalBufferPct,
    minScore: CONFIG.minScore,
    allowRescueTopUp: CONFIG.allowRescueTopUp,
    retryNotionalClose: CONFIG.retryNotionalClose,
    rescueTopUpBufferPct: CONFIG.rescueTopUpBufferPct,
    maxRescueTopUpUsdt: CONFIG.maxRescueTopUpUsdt,
    highRiskMinScore: CONFIG.highRiskMinScore,
    scanIntervalMs: CONFIG.scanIntervalMs,
    positionCheckIntervalMs: CONFIG.positionCheckIntervalMs,
    statusExitGuard: CONFIG.statusExitGuard,
    scanUniverseLimit: CONFIG.scanUniverseLimit,
    minQuoteVolumeUsdt: CONFIG.minQuoteVolumeUsdt,
    max24hChangePct: CONFIG.max24hChangePct,
    maxSpreadPct: CONFIG.maxSpreadPct,
    maxPositionLossPct: CONFIG.maxPositionLossPct,
    exitWeakScore: CONFIG.exitWeakScore,
    takerFeeRateFallback: CONFIG.takerFeeRate,
    stopLossPct: CONFIG.stopLossPct,
    takeProfitPct: CONFIG.takeProfitPct,
    trailingStopPct: CONFIG.trailingStopPct,
    allowHighRisk: CONFIG.allowHighRisk,
    highRiskMaxTradeUsdt: CONFIG.highRiskMaxTradeUsdt,
    maxHighRiskOpenPositions: CONFIG.maxHighRiskOpenPositions,
    highRiskMax24hChangePct: CONFIG.highRiskMax24hChangePct,
    highRiskMaxSpreadPct: CONFIG.highRiskMaxSpreadPct,
    highRiskMinDepthBias: CONFIG.highRiskMinDepthBias,
    highRiskRsiMin: CONFIG.highRiskRsiMin,
    highRiskRsiMax: CONFIG.highRiskRsiMax,
    highRiskMaxPositionLossPct: CONFIG.highRiskMaxPositionLossPct,
    highRiskExitWeakScore: CONFIG.highRiskExitWeakScore,
    highRiskStopLossPct: CONFIG.highRiskStopLossPct,
    highRiskTakeProfitPct: CONFIG.highRiskTakeProfitPct,
    universeMode: CONFIG.universeMode,
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
  const normalized = value.trim().toUpperCase();
  if (["ALL", "*", "DYNAMIC", "NONE"].includes(normalized)) return [];
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
  return Math.floor((value + Number.EPSILON) / stepSize) * stepSize;
}

function countDecimals(value) {
  const text = String(value);
  if (!text.includes(".")) return 0;
  return text.replace(/0+$/, "").split(".")[1]?.length || 0;
}

function toFixedTrim(value, decimals) {
  return Number(value).toFixed(decimals).replace(/\.?0+$/, "");
}
