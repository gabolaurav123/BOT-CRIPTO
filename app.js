const API_CANDIDATES = [
  {
    label: "Binance Global",
    rest: "https://api.binance.com",
    ws: "wss://data-stream.binance.vision/ws/!miniTicker@arr",
  },
  {
    label: "Binance Global respaldo",
    rest: "https://api1.binance.com",
    ws: "wss://data-stream.binance.vision/ws/!miniTicker@arr",
  },
  {
    label: "Binance.US",
    rest: "https://api.binance.us",
    ws: "wss://stream.binance.us:9443/ws/!miniTicker@arr",
  },
];

const COIN_LOGOS = {
  BTC: "btc",
  ETH: "eth",
  BNB: "bnb",
  SOL: "sol",
  DOGE: "doge",
  XRP: "xrp",
  ADA: "ada",
  AVAX: "avax",
  LINK: "link",
  DOT: "dot",
  LTC: "ltc",
  BCH: "bch",
  TRX: "trx",
  MATIC: "matic",
  POL: "pol",
  SHIB: "shib",
  UNI: "uni",
  ATOM: "atom",
  ETC: "etc",
  NEAR: "near",
  APT: "apt",
  ARB: "arb",
  OP: "op",
  FIL: "fil",
  INJ: "inj",
  PEPE: "pepe",
  SUI: "sui",
  TON: "ton",
  SEI: "sei",
};

const DEMO_SYMBOLS = [
  ["BTCUSDT", "BTC", 64280, 2.8, 1820000000],
  ["ETHUSDT", "ETH", 3420, 1.9, 980000000],
  ["BNBUSDT", "BNB", 585, 1.2, 320000000],
  ["SOLUSDT", "SOL", 148.4, 5.4, 620000000],
  ["DOGEUSDT", "DOGE", 0.124, 7.8, 410000000],
  ["XRPUSDT", "XRP", 0.512, -0.7, 260000000],
  ["ADAUSDT", "ADA", 0.384, 3.1, 190000000],
  ["AVAXUSDT", "AVAX", 29.8, 4.6, 170000000],
  ["LINKUSDT", "LINK", 14.9, 2.4, 145000000],
  ["PEPEUSDT", "PEPE", 0.000011, 12.4, 210000000],
];

const state = {
  activeApi: null,
  markets: [],
  marketMap: new Map(),
  selectedSymbol: null,
  klines: new Map(),
  positions: [],
  alerts: [],
  riskProfile: "balanced",
  budget: 50,
  search: "",
  sort: "score",
  socket: null,
  notificationEnabled: false,
  liveMode: false,
  backend: {
    available: false,
    loading: false,
    status: null,
    error: null,
  },
  renderPending: false,
};

const els = {
  connectionStatus: document.querySelector("#connectionStatus"),
  lastUpdate: document.querySelector("#lastUpdate"),
  budgetInput: document.querySelector("#budgetInput"),
  searchInput: document.querySelector("#searchInput"),
  refreshBtn: document.querySelector("#refreshBtn"),
  sortSelect: document.querySelector("#sortSelect"),
  marketList: document.querySelector("#marketList"),
  positionsList: document.querySelector("#positionsList"),
  alertsList: document.querySelector("#alertsList"),
  notifyBtn: document.querySelector("#notifyBtn"),
  clearAlertsBtn: document.querySelector("#clearAlertsBtn"),
  clearClosedBtn: document.querySelector("#clearClosedBtn"),
  equityValue: document.querySelector("#equityValue"),
  cashValue: document.querySelector("#cashValue"),
  goalProgress: document.querySelector("#goalProgress"),
  bestSignal: document.querySelector("#bestSignal"),
  bestSignalDetail: document.querySelector("#bestSignalDetail"),
  marketsCount: document.querySelector("#marketsCount"),
  deepScanCount: document.querySelector("#deepScanCount"),
  spotUsdtValue: document.querySelector("#spotUsdtValue"),
  spotBalanceDetail: document.querySelector("#spotBalanceDetail"),
  botUsableValue: document.querySelector("#botUsableValue"),
  botCapitalLimit: document.querySelector("#botCapitalLimit"),
  botPnlValue: document.querySelector("#botPnlValue"),
  dailyGoalText: document.querySelector("#dailyGoalText"),
  bobRateValue: document.querySelector("#bobRateValue"),
  bobRateDetail: document.querySelector("#bobRateDetail"),
  backendStatus: document.querySelector("#backendStatus"),
  botModeValue: document.querySelector("#botModeValue"),
  botModeDetail: document.querySelector("#botModeDetail"),
  botEnabledValue: document.querySelector("#botEnabledValue"),
  botLastScan: document.querySelector("#botLastScan"),
  dailyLossLimit: document.querySelector("#dailyLossLimit"),
  feeValue: document.querySelector("#feeValue"),
  serverIpValue: document.querySelector("#serverIpValue"),
  serverIpDetail: document.querySelector("#serverIpDetail"),
  botDecision: document.querySelector("#botDecision"),
  startBotBtn: document.querySelector("#startBotBtn"),
  stopBotBtn: document.querySelector("#stopBotBtn"),
  scanBotBtn: document.querySelector("#scanBotBtn"),
  resetDayBtn: document.querySelector("#resetDayBtn"),
  backendRefreshBtn: document.querySelector("#backendRefreshBtn"),
  botPositionsList: document.querySelector("#botPositionsList"),
  logoutBtn: document.querySelector("#logoutBtn"),
  riskNotice: document.querySelector("#riskNotice"),
  detailTitle: document.querySelector("#detailTitle"),
  detailSubtitle: document.querySelector("#detailSubtitle"),
  detailBadge: document.querySelector("#detailBadge"),
  detailPrice: document.querySelector("#detailPrice"),
  detailRsi: document.querySelector("#detailRsi"),
  detailProjection: document.querySelector("#detailProjection"),
  detailRisk: document.querySelector("#detailRisk"),
  suggestedAmount: document.querySelector("#suggestedAmount"),
  levelsText: document.querySelector("#levelsText"),
  acceptTradeBtn: document.querySelector("#acceptTradeBtn"),
  priceChart: document.querySelector("#priceChart"),
  rowTemplate: document.querySelector("#marketRowTemplate"),
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 6,
});

const compactMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

const percentFmt = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return "--";
  const maximumFractionDigits = value < 0.01 ? 8 : value < 1 ? 5 : value < 100 ? 3 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(value);
}

function formatTablePrice(value) {
  if (!Number.isFinite(value)) return "--";
  if (value < 0.0001) return `$${value.toExponential(2)}`;
  if (value < 0.01) return `$${Number(value).toPrecision(4)}`;
  if (value < 1) return `$${value.toFixed(4)}`;
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatPct(value) {
  if (!Number.isFinite(value)) return "--";
  return `${percentFmt.format(value)}%`;
}

function setStatus(kind, text) {
  els.connectionStatus.className = `status-pill status-${kind}`;
  els.connectionStatus.innerHTML = `<span class="pulse"></span>${text}`;
}

function storageKey(name) {
  return `cryptoRadar:${name}`;
}

function loadStorage() {
  state.budget = Number(localStorage.getItem(storageKey("budget"))) || 50;
  state.riskProfile = localStorage.getItem(storageKey("riskProfile")) || "balanced";
  state.positions = safeParse(localStorage.getItem(storageKey("positions")), []);
  state.alerts = safeParse(localStorage.getItem(storageKey("alerts")), []);
  els.budgetInput.value = state.budget;
  document.querySelectorAll("[data-risk]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.risk === state.riskProfile);
  });
}

function saveStorage() {
  localStorage.setItem(storageKey("budget"), String(state.budget));
  localStorage.setItem(storageKey("riskProfile"), state.riskProfile);
  localStorage.setItem(storageKey("positions"), JSON.stringify(state.positions));
  localStorage.setItem(storageKey("alerts"), JSON.stringify(state.alerts.slice(0, 60)));
}

function safeParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function backendRequest(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `${response.status} ${response.statusText}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshBackendStatus() {
  if (state.backend.loading) return;
  state.backend.loading = true;
  try {
    const status = await backendRequest("/api/bot/status");
    state.backend.available = true;
    state.backend.status = status;
    state.backend.error = null;
  } catch (error) {
    state.backend.available = false;
    state.backend.error = error.message;
  } finally {
    state.backend.loading = false;
    renderBackendStatus();
    renderSummary();
    if (window.lucide) window.lucide.createIcons();
  }
}

async function callBotAction(path) {
  setBackendButtons(false);
  try {
    const status = await backendRequest(path, { method: "POST", body: "{}" });
    state.backend.available = true;
    state.backend.status = status;
    state.backend.error = null;
  } catch (error) {
    state.backend.error = error.message;
    addAlert("Error backend", error.message, "warning");
  } finally {
    setBackendButtons(true);
    renderBackendStatus();
    renderSummary();
  }
}

function setBackendButtons(enabled) {
  [els.startBotBtn, els.stopBotBtn, els.scanBotBtn, els.resetDayBtn, els.backendRefreshBtn].forEach((button) => {
    if (button) button.disabled = !enabled;
  });
}

async function boot() {
  loadStorage();
  bindEvents();
  renderAll();
  refreshBackendStatus();
  window.setInterval(refreshBackendStatus, 15000);
  await loadMarketData();
  if (window.lucide) window.lucide.createIcons();
}

function bindEvents() {
  els.budgetInput.addEventListener("change", () => {
    state.budget = clamp(Number(els.budgetInput.value) || 50, 10, 1000000);
    els.budgetInput.value = state.budget;
    saveStorage();
    recalculateMarkets();
    selectDefaultMarket({ preferActionable: true });
    renderAll();
  });

  document.querySelectorAll("[data-risk]").forEach((button) => {
    button.addEventListener("click", () => {
      state.riskProfile = button.dataset.risk;
      document.querySelectorAll("[data-risk]").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      saveStorage();
      recalculateMarkets();
      selectDefaultMarket({ preferActionable: true });
      renderAll();
    });
  });

  els.searchInput.addEventListener("input", () => {
    state.search = els.searchInput.value.trim().toUpperCase();
    renderMarketList();
  });

  els.sortSelect.addEventListener("change", () => {
    state.sort = els.sortSelect.value;
    renderMarketList();
  });

  els.refreshBtn.addEventListener("click", async () => {
    els.refreshBtn.classList.add("is-spinning");
    await loadMarketData();
    els.refreshBtn.classList.remove("is-spinning");
  });

  els.acceptTradeBtn.addEventListener("click", () => {
    const market = state.marketMap.get(state.selectedSymbol);
    if (market) openSimulatedTrade(market);
  });

  els.notifyBtn.addEventListener("click", enableNotifications);

  els.clearClosedBtn.addEventListener("click", () => {
    state.positions = state.positions.filter((position) => position.status === "open");
    saveStorage();
    renderPortfolio();
  });

  els.clearAlertsBtn.addEventListener("click", () => {
    state.alerts = [];
    saveStorage();
    renderPortfolio();
  });

  els.startBotBtn.addEventListener("click", () => callBotAction("/api/bot/start"));
  els.stopBotBtn.addEventListener("click", () => callBotAction("/api/bot/stop"));
  els.scanBotBtn.addEventListener("click", () => callBotAction("/api/bot/scan"));
  els.resetDayBtn.addEventListener("click", () => {
    if (window.confirm("Reiniciar el PnL diario? El bot quedara pausado hasta que lo inicies manualmente.")) {
      callBotAction("/api/bot/reset-day");
    }
  });
  els.backendRefreshBtn.addEventListener("click", refreshBackendStatus);
  els.logoutBtn.addEventListener("click", logout);

  document.querySelectorAll(".rail-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".rail-button").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      const target = document.querySelector(`[data-panel="${button.dataset.view}"]`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

async function logout() {
  await backendRequest("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => null);
  window.location.href = "/login.html";
}

async function loadMarketData() {
  setStatus("muted", "Conectando");
  closeSocket();

  for (const candidate of API_CANDIDATES) {
    try {
      const exchangeInfo = await fetchJson(`${candidate.rest}/api/v3/exchangeInfo`);
      const tickers = await fetchJson(`${candidate.rest}/api/v3/ticker/24hr`);
      hydrateMarkets(candidate, exchangeInfo, tickers);
      state.activeApi = candidate;
      state.liveMode = true;
      setStatus("live", `${candidate.label} en vivo`);
      addAlert("Conexion establecida", `Escaneando ${state.markets.length} pares spot USDT desde ${candidate.label}.`, "info");
      renderAll();
      await enrichTopMarkets();
      connectSocket(candidate);
      return;
    } catch (error) {
      console.warn(`No se pudo usar ${candidate.label}`, error);
    }
  }

  buildDemoMarkets();
  state.liveMode = false;
  setStatus("demo", "Modo demo");
  addAlert("Binance no respondio", "Se cargo una muestra local. Reintenta actualizar para volver a datos reales.", "warning");
  renderAll();
}

function hydrateMarkets(api, exchangeInfo, tickers) {
  const tradable = new Map(
    exchangeInfo.symbols
      .filter((item) => item.status === "TRADING" && item.quoteAsset === "USDT" && item.isSpotTradingAllowed !== false)
      .map((item) => [item.symbol, item])
  );

  state.markets = tickers
    .filter((ticker) => tradable.has(ticker.symbol))
    .map((ticker) => {
      const info = tradable.get(ticker.symbol);
      const market = buildMarketFromTicker(ticker, info);
      market.source = api.label;
      return market;
    })
    .filter((market) => market.price > 0 && market.volumeQuote > 0);

  recalculateMarkets();
  selectDefaultMarket({ preferActionable: true });
  updateLastUpdate();
}

function buildMarketFromTicker(ticker, info = {}) {
  const filters = Object.fromEntries((info.filters || []).map((filter) => [filter.filterType, filter]));
  const minNotional = Number(filters.NOTIONAL?.minNotional || filters.MIN_NOTIONAL?.minNotional || 5);
  const baseAsset = info.baseAsset || ticker.symbol.replace(/USDT$/, "");
  return {
    symbol: ticker.symbol,
    baseAsset,
    quoteAsset: "USDT",
    price: Number(ticker.lastPrice),
    openPrice: Number(ticker.openPrice),
    highPrice: Number(ticker.highPrice),
    lowPrice: Number(ticker.lowPrice),
    changePct: Number(ticker.priceChangePercent),
    volumeQuote: Number(ticker.quoteVolume),
    trades: Number(ticker.count || 0),
    minNotional,
    rsi: null,
    smaFast: null,
    smaSlow: null,
    projection4h: null,
    volatility: null,
    score: 0,
    signal: "watch",
    risk: "moderado",
    amount: 0,
    stop: null,
    target: null,
    target2: null,
    reason: "",
  };
}

function buildDemoMarkets() {
  state.markets = DEMO_SYMBOLS.map(([symbol, baseAsset, price, changePct, volumeQuote]) => {
    const openPrice = price / (1 + changePct / 100);
    const wave = Array.from({ length: 120 }, (_, index) => {
      const drift = 1 + (index - 60) * (changePct / 100 / 120);
      const noise = Math.sin(index / 5) * 0.012 + Math.cos(index / 11) * 0.008;
      return [Date.now() - (120 - index) * 3600000, openPrice * drift * (1 + noise)];
    });
    const market = buildMarketFromTicker(
      {
        symbol,
        lastPrice: price,
        openPrice,
        highPrice: price * 1.05,
        lowPrice: price * 0.95,
        priceChangePercent: changePct,
        quoteVolume: volumeQuote,
        count: 100000,
      },
      { baseAsset, filters: [{ filterType: "NOTIONAL", minNotional: "5" }] }
    );
    state.klines.set(symbol, wave);
    applyTechnicalIndicators(market, wave);
    return market;
  });
  recalculateMarkets();
  selectDefaultMarket({ preferActionable: true });
  updateLastUpdate();
}

function selectDefaultMarket(options = {}) {
  if (!state.markets.length) return;
  const current = state.marketMap.get(state.selectedSymbol);
  const currentActionable = current?.signal === "buy" && current.amount > 0;
  if (current && (!options.preferActionable || currentActionable)) return;
  const ranked = [...state.markets].sort((a, b) => b.score - a.score);
  const actionable = ranked.find((market) => market.signal === "buy" && market.amount > 0);
  state.selectedSymbol = (options.preferActionable && actionable ? actionable : ranked[0]).symbol;
}

function updateLastUpdate() {
  const now = new Date();
  els.lastUpdate.textContent = `Actualizado ${now.toLocaleTimeString("es-BO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}`;
}

async function enrichTopMarkets() {
  const top = [...state.markets]
    .sort((a, b) => b.volumeQuote - a.volumeQuote)
    .slice(0, 80);

  const queue = [...top];
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const market = queue.shift();
      try {
        const data = await fetchJson(`${state.activeApi.rest}/api/v3/klines?symbol=${market.symbol}&interval=1h&limit=120`, 9000);
        const candles = data.map((row) => [Number(row[0]), Number(row[4]), Number(row[5]), Number(row[7])]);
        state.klines.set(market.symbol, candles);
        applyTechnicalIndicators(market, candles);
      } catch (error) {
        console.warn(`No se pudo analizar ${market.symbol}`, error);
      }
      recalculateMarket(market);
      scheduleRender();
    }
  });

  await Promise.all(workers);
  recalculateMarkets();
  selectDefaultMarket({ preferActionable: true });
  renderAll();
}

function applyTechnicalIndicators(market, candles) {
  const closes = candles.map((item) => Number(item[1])).filter(Number.isFinite);
  if (closes.length < 20) return;
  market.rsi = calculateRsi(closes, 14);
  market.smaFast = average(closes.slice(-7));
  market.smaSlow = average(closes.slice(-25));
  const latest = closes.at(-1);
  const hourlyReturns = closes.slice(1).map((value, index) => Math.abs(value / closes[index] - 1));
  market.volatility = average(hourlyReturns.slice(-24)) * 100;
  const projected = projectMove(closes.slice(-36), 4);
  market.projection4h = projected;
  market.price = latest || market.price;
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

function average(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
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

function recalculateMarkets() {
  const volumes = state.markets.map((market) => market.volumeQuote).sort((a, b) => a - b);
  state.markets.forEach((market) => recalculateMarket(market, volumes));
  state.marketMap = new Map(state.markets.map((market) => [market.symbol, market]));
}

function recalculateMarket(market, knownVolumes) {
  const volumes = knownVolumes || state.markets.map((item) => item.volumeQuote).sort((a, b) => a - b);
  const volumeRank = percentileRank(volumes, market.volumeQuote);
  const dayRange = market.price ? ((market.highPrice - market.lowPrice) / market.price) * 100 : 0;
  const trendBias = market.smaFast && market.smaSlow ? (market.smaFast / market.smaSlow - 1) * 100 : market.changePct / 4;
  const rsiScore = market.rsi == null ? 4 : market.rsi > 78 ? -18 : market.rsi > 68 ? -4 : market.rsi > 48 ? 12 : market.rsi > 38 ? 5 : -10;
  const projectionScore = market.projection4h == null ? 0 : clamp(market.projection4h * 4, -18, 18);
  const momentumScore = clamp(market.changePct * 1.8, -20, 22);
  const volumeScore = clamp(volumeRank * 24, 0, 24);
  const riskPenalty = dayRange > 24 ? 18 : dayRange > 15 ? 10 : dayRange < 3 ? 4 : 0;
  const trendScore = clamp(trendBias * 3, -18, 18);
  market.score = Math.round(clamp(42 + volumeScore + momentumScore + rsiScore + trendScore + projectionScore - riskPenalty, 0, 100));
  market.risk = classifyRisk(market, dayRange, volumeRank);
  market.signal = classifySignal(market);
  market.amount = calculateAllocation(market);
  const levels = calculateLevels(market);
  market.stop = levels.stop;
  market.target = levels.target;
  market.target2 = levels.target2;
  market.reason = buildReason(market);
}

function percentileRank(sortedValues, value) {
  if (!sortedValues.length) return 0;
  let index = 0;
  while (index < sortedValues.length && sortedValues[index] <= value) index += 1;
  return index / sortedValues.length;
}

function classifyRisk(market, dayRange, volumeRank) {
  const hourlyVol = market.volatility ?? dayRange / 8;
  if (hourlyVol < 0.9 && dayRange < 7 && volumeRank > 0.7) return "mas seguro";
  if (hourlyVol > 2.2 || dayRange > 16 || volumeRank < 0.35) return "alto";
  return "moderado";
}

function classifySignal(market) {
  if (market.score >= 76 && market.risk !== "alto") return "buy";
  if (market.score >= 82) return "buy";
  if (market.score >= 58) return "watch";
  return "avoid";
}

function calculateAllocation(market) {
  const cash = getPortfolioStats().cash;
  const riskCaps = {
    safe: { "mas seguro": 0.12, moderado: 0.07, alto: 0.025 },
    balanced: { "mas seguro": 0.16, moderado: 0.1, alto: 0.045 },
    aggressive: { "mas seguro": 0.2, moderado: 0.14, alto: 0.07 },
  };
  const cap = riskCaps[state.riskProfile][market.risk] ?? 0.05;
  const conviction = clamp((market.score - 55) / 35, 0, 1);
  const raw = state.budget * cap * (0.55 + conviction * 0.45);
  if (market.signal !== "buy") return 0;
  const capped = Math.min(cash, raw, state.budget * 0.22);
  const canUseMinimum = market.risk !== "alto" && cash >= market.minNotional && state.budget * cap >= market.minNotional * 0.75;
  const adjusted = capped < market.minNotional && canUseMinimum ? market.minNotional : capped;
  return adjusted >= market.minNotional ? adjusted : 0;
}

function calculateLevels(market) {
  const vol = clamp(market.volatility ?? ((market.highPrice - market.lowPrice) / market.price) * 12, 0.8, 8);
  const stopPct = market.risk === "alto" ? Math.min(7, vol * 2.1) : market.risk === "moderado" ? Math.min(5, vol * 1.8) : Math.min(3.5, vol * 1.5);
  const targetPct = stopPct * (market.risk === "alto" ? 1.5 : 1.35);
  return {
    stop: market.price * (1 - stopPct / 100),
    target: market.price * (1 + targetPct / 100),
    target2: market.price * (1 + targetPct * 1.8 / 100),
  };
}

function buildReason(market) {
  const parts = [];
  if (market.score >= 76) parts.push("senal fuerte");
  if (market.projection4h > 0) parts.push(`proy. 4h ${formatPct(market.projection4h)}`);
  if (market.rsi) parts.push(`RSI ${market.rsi.toFixed(0)}`);
  if (market.changePct > 0) parts.push(`24h ${formatPct(market.changePct)}`);
  if (!parts.length) parts.push("sin ventaja clara");
  return parts.join(" - ");
}

function connectSocket(candidate) {
  if (!candidate.ws || state.socket) return;
  try {
    const socket = new WebSocket(candidate.ws);
    state.socket = socket;
    socket.addEventListener("open", () => {
      setStatus("live", `${candidate.label} en vivo`);
    });
    socket.addEventListener("message", (event) => {
      const updates = JSON.parse(event.data);
      if (Array.isArray(updates)) applyTickerUpdates(updates);
    });
    socket.addEventListener("close", () => {
      if (state.socket === socket) state.socket = null;
    });
    socket.addEventListener("error", () => {
      socket.close();
    });
  } catch (error) {
    console.warn("WebSocket no disponible", error);
  }
}

function closeSocket() {
  if (state.socket) {
    state.socket.close();
    state.socket = null;
  }
}

function applyTickerUpdates(updates) {
  for (const update of updates) {
    const symbol = update.s;
    const market = state.marketMap.get(symbol);
    if (!market) continue;
    market.price = Number(update.c) || market.price;
    market.openPrice = Number(update.o) || market.openPrice;
    market.highPrice = Number(update.h) || market.highPrice;
    market.lowPrice = Number(update.l) || market.lowPrice;
    market.volumeQuote = Number(update.q) || market.volumeQuote;
    market.changePct = market.openPrice ? ((market.price - market.openPrice) / market.openPrice) * 100 : market.changePct;
    recalculateMarket(market);
  }
  checkPositionAlerts();
  updateLastUpdate();
  scheduleRender();
}

function scheduleRender() {
  if (state.renderPending) return;
  state.renderPending = true;
  window.requestAnimationFrame(() => {
    state.renderPending = false;
    renderAll();
  });
}

function getPortfolioStats() {
  let cash = state.budget;
  let openValue = 0;
  let openCost = 0;
  let realizedPnl = 0;

  for (const position of state.positions) {
    if (position.status === "open") {
      const market = state.marketMap.get(position.symbol);
      const current = market?.price || position.entryPrice;
      cash -= position.amountUsd;
      openCost += position.amountUsd;
      openValue += position.quantity * current;
    } else {
      realizedPnl += position.pnlUsd || 0;
    }
  }

  cash += realizedPnl;
  return {
    cash: Math.max(0, cash),
    equity: cash + openValue,
    openValue,
    openCost,
    realizedPnl,
  };
}

function openSimulatedTrade(market) {
  const stats = getPortfolioStats();
  const amount = Math.min(market.amount, stats.cash);
  if (amount <= 0 || amount < Math.min(market.minNotional, stats.cash + 0.01)) return;
  const position = {
    id: crypto.randomUUID(),
    symbol: market.symbol,
    baseAsset: market.baseAsset,
    amountUsd: amount,
    quantity: amount / market.price,
    entryPrice: market.price,
    stop: market.stop,
    target: market.target,
    target2: market.target2,
    scoreAtEntry: market.score,
    risk: market.risk,
    openedAt: Date.now(),
    status: "open",
  };
  state.positions.unshift(position);
  addAlert("Inversion simulada registrada", `${market.symbol}: ${money.format(amount)} a ${formatPrice(market.price)}. Stop ${formatPrice(market.stop)} - objetivo ${formatPrice(market.target)}.`, "trade");
  saveStorage();
  renderAll();
}

function closePosition(id, reason) {
  const position = state.positions.find((item) => item.id === id);
  if (!position || position.status !== "open") return;
  const market = state.marketMap.get(position.symbol);
  const exitPrice = market?.price || position.entryPrice;
  const exitValue = position.quantity * exitPrice;
  position.status = "closed";
  position.closedAt = Date.now();
  position.exitPrice = exitPrice;
  position.pnlUsd = exitValue - position.amountUsd;
  position.exitReason = reason;
  addAlert("Posicion cerrada", `${position.symbol}: ${reason}. Resultado ${money.format(position.pnlUsd)}.`, "exit");
  saveStorage();
  renderAll();
}

function checkPositionAlerts() {
  for (const position of state.positions.filter((item) => item.status === "open")) {
    const market = state.marketMap.get(position.symbol);
    if (!market) continue;
    const price = market.price;
    const pnlPct = (price / position.entryPrice - 1) * 100;
    let reason = "";
    if (price <= position.stop) reason = "tocar stop de riesgo";
    else if (price >= position.target2) reason = "alcanzar segundo objetivo";
    else if (price >= position.target && market.score < 70) reason = "tomar ganancia y senal se debilita";
    else if (pnlPct > 1.2 && market.score < 50) reason = "proteger ganancia por perdida de momentum";
    if (reason && position.lastSignalReason !== reason) {
      position.lastSignalReason = reason;
      addAlert("Alerta de salida", `${position.symbol}: considerar cerrar por ${reason}.`, "exit");
    }
  }
  saveStorage();
}

function addAlert(title, body, type = "info") {
  const signature = `${title}:${body}`;
  if (state.alerts[0]?.signature === signature) return;
  const alert = {
    id: crypto.randomUUID(),
    signature,
    title,
    body,
    type,
    createdAt: Date.now(),
  };
  state.alerts.unshift(alert);
  state.alerts = state.alerts.slice(0, 60);
  saveStorage();
  notify(alert);
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    addAlert("Notificaciones no disponibles", "Este navegador no permite notificaciones de escritorio.", "warning");
    return;
  }
  const permission = await Notification.requestPermission();
  state.notificationEnabled = permission === "granted";
  els.notifyBtn.textContent = state.notificationEnabled ? "Notificaciones activas" : "Activar notificaciones";
}

function notify(alert) {
  if (!state.notificationEnabled || !("Notification" in window) || Notification.permission !== "granted") return;
  new Notification(alert.title, { body: alert.body });
}

function renderAll() {
  renderSummary();
  renderMarketList();
  renderDetail();
  renderPortfolio();
  renderBackendStatus();
  if (window.lucide) window.lucide.createIcons();
}

function renderSummary() {
  const stats = getPortfolioStats();
  const best = [...state.markets].sort((a, b) => b.score - a.score)[0];
  const backend = state.backend.status;
  const botAccount = backend?.account?.bot;
  const spotUsdt = backend?.account?.spot?.USDT?.free;
  const fx = backend?.fx;
  const botPnl = backend?.totalBotPnlUsdt;
  els.equityValue.textContent = money.format(stats.equity);
  els.cashValue.textContent = money.format(stats.cash);
  els.goalProgress.textContent = `Meta $500: ${clamp((stats.equity / 500) * 100, 0, 999).toFixed(1)}%`;
  els.bestSignal.textContent = best ? best.symbol.replace("USDT", "") : "--";
  els.bestSignalDetail.textContent = best ? `${best.score}/100 - ${labelSignal(best.signal)} - ${best.reason}` : "Esperando mercado";
  els.marketsCount.textContent = String(state.markets.length);
  els.deepScanCount.textContent = `${state.klines.size} con indicadores profundos`;
  els.spotUsdtValue.textContent = Number.isFinite(spotUsdt) ? money.format(spotUsdt) : "--";
  els.spotBalanceDetail.textContent = state.backend.available ? "Saldo libre de Spot, no Funding" : "Backend no conectado";
  els.botUsableValue.textContent = Number.isFinite(botAccount?.availableForBotUsdt) ? money.format(botAccount.availableForBotUsdt) : "--";
  els.botCapitalLimit.textContent = Number.isFinite(botAccount?.maxCapitalUsdt) ? `Limite configurado: ${money.format(botAccount.maxCapitalUsdt)}` : "Limite configurado: --";
  els.botPnlValue.textContent = Number.isFinite(botPnl) ? money.format(botPnl) : "--";
  els.botPnlValue.classList.toggle("positive", botPnl > 0);
  els.botPnlValue.classList.toggle("negative", botPnl < 0);
  els.dailyGoalText.textContent = Number.isFinite(botAccount?.dailyProfitTargetUsdt) ? `Objetivo diario: ${money.format(botAccount.dailyProfitTargetUsdt)}` : "Objetivo diario: --";
  els.bobRateValue.textContent = Number.isFinite(fx?.mid) ? `Bs ${fx.mid.toFixed(2)}` : "--";
  els.bobRateDetail.textContent = fx?.source ? `${fx.source} - compra ${fx.buy?.toFixed?.(2) ?? "--"} / venta ${fx.sell?.toFixed?.(2) ?? "--"}` : "Binance P2P / fallback";
}

function renderBackendStatus() {
  const backend = state.backend.status;
  if (!state.backend.available || !backend) {
    els.backendStatus.className = "status-pill status-muted";
    els.backendStatus.innerHTML = `<span class="pulse"></span>Backend no conectado`;
    els.botModeValue.textContent = "--";
    els.botModeDetail.textContent = state.backend.error || "Sirve la app con npm start para operar";
    els.botEnabledValue.textContent = "--";
    els.botLastScan.textContent = "Sin backend";
    els.dailyLossLimit.textContent = "--";
    els.feeValue.textContent = "--";
    els.serverIpValue.textContent = "--";
    els.serverIpDetail.textContent = "Copiala en Binance API";
    els.riskNotice.textContent = "El bot necesita el backend para operar. Sin backend, este panel queda en modo analisis local y no puede enviar ordenes reales.";
    els.botDecision.textContent = "La web esta en modo analisis/paper local. Para operar usa el backend Node en Seenode.";
    els.botPositionsList.innerHTML = `<div class="empty-state">Backend no conectado. Las posiciones reales/paper del bot apareceran aqui.</div>`;
    setBackendButtons(false);
    els.backendRefreshBtn.disabled = false;
    return;
  }

  setBackendButtons(true);
  const openBackendPositions = backend.positions || [];
  els.backendStatus.className = `status-pill ${backend.mode === "live" ? "status-error" : "status-demo"}`;
  els.backendStatus.innerHTML = `<span class="pulse"></span>${backend.mode === "live" ? "LIVE" : "PAPER"} conectado`;
  els.riskNotice.textContent =
    backend.mode === "live"
      ? "Modo LIVE activo: el backend puede enviar ordenes reales de Spot usando solo el USDT libre permitido por los limites del bot. No garantiza ganancias."
      : "Modo PAPER activo: el bot analiza y simula, pero no envia ordenes reales hasta configurar BOT_LIVE_TRADING=true en el servidor.";
  els.botModeValue.textContent = backend.mode === "live" ? "Live real" : "Paper";
  els.botModeDetail.textContent = backend.configured
    ? `API ${backend.safeConfig.apiKey || "sin key"} - ${backend.safeConfig.universeMode || "conservative"}`
    : "Faltan variables Binance";
  els.botEnabledValue.textContent = backend.enabled ? "Activo" : openBackendPositions.length ? "Pausado, vigila salidas" : "Pausado";
  els.botLastScan.textContent = backend.lastPositionCheckAt
    ? `Ventas ${new Date(backend.lastPositionCheckAt).toLocaleTimeString("es-BO")}`
    : backend.lastScanAt
      ? `Escaneo ${new Date(backend.lastScanAt).toLocaleTimeString("es-BO")}`
      : "Sin escaneo";
  els.dailyLossLimit.textContent = money.format(-(backend.safeConfig.dailyMaxLossUsdt || 0));
  els.feeValue.textContent = `${((backend.safeConfig.takerFeeRateFallback || 0) * 100).toFixed(3)}%`;
  els.serverIpValue.textContent = backend.serverIp?.ip || "--";
  els.serverIpDetail.textContent = backend.serverIp?.source ? `Actualizada ${new Date(backend.serverIp.updatedAt).toLocaleTimeString("es-BO")}` : "No disponible";
  els.botDecision.textContent = backend.lastError ? `Error: ${backend.lastError}` : backend.lastDecision || "Sin decision reciente.";
  els.startBotBtn.disabled = backend.enabled;
  els.stopBotBtn.disabled = !backend.enabled;

  const positions = openBackendPositions;
  els.botPositionsList.innerHTML = "";
  if (!positions.length) {
    els.botPositionsList.innerHTML = `<div class="empty-state">No hay posiciones abiertas del bot.</div>`;
  } else {
    for (const position of positions) {
      els.botPositionsList.appendChild(renderBotPosition(position));
    }
  }
}

function renderBotPosition(position) {
  const row = document.createElement("article");
  row.className = "position-row";
  const pnl = Number(position.unrealizedPnlUsdt || 0);
  const pnlPct = Number(position.unrealizedPnlPct || 0);
  row.innerHTML = `
    <div class="position-main">
      <div class="position-title">
        <strong>${escapeHtml(position.baseAsset || position.symbol)} / USDT</strong>
        <span class="signal-badge ${position.mode === "live" ? "avoid" : "watch"}">${position.mode === "live" ? "Live" : "Paper"}</span>
        <span class="${pnl >= 0 ? "positive" : "negative"}">${money.format(pnl)} (${formatPct(pnlPct)})</span>
      </div>
      <div class="position-meta">
        <span>Entrada ${formatPrice(position.entryPrice)}</span>
        <span>Actual ${formatPrice(position.currentPrice)}</span>
        <span>Monto ${money.format(position.amountUsdt)}</span>
        <span>Stop ${formatPrice(position.stop)}</span>
        <span>Target ${formatPrice(position.target)}</span>
      </div>
      ${position.lastCloseError ? `<div class="position-error">No se pudo cerrar: ${escapeHtml(position.lastCloseError)}</div>` : ""}
    </div>
    <div class="position-actions"></div>
  `;
  const close = document.createElement("button");
  close.className = "danger-button";
  close.textContent = "Cerrar";
  close.addEventListener("click", () => closeBotPosition(position.id));
  row.querySelector(".position-actions").appendChild(close);
  return row;
}

async function closeBotPosition(positionId) {
  setBackendButtons(false);
  try {
    const status = await backendRequest("/api/bot/close", {
      method: "POST",
      body: JSON.stringify({ positionId, force: true }),
    });
    state.backend.status = status;
    state.backend.available = true;
    state.backend.error = null;
    if (status.closeError) addAlert("No se pudo cerrar posicion", status.closeError, "warning");
  } catch (error) {
    state.backend.error = error.message;
    if (els.botDecision) els.botDecision.textContent = `Error cerrando posicion: ${error.message}`;
    addAlert("Error cerrando posicion", error.message, "warning");
    await refreshBackendStatus();
  } finally {
    setBackendButtons(true);
    renderBackendStatus();
    renderSummary();
  }
}

function getVisibleMarkets() {
  let list = [...state.markets];
  if (state.search) {
    list = list.filter((market) => market.symbol.includes(state.search) || market.baseAsset.includes(state.search));
  }
  const sorters = {
    score: (a, b) => b.score - a.score,
    volume: (a, b) => b.volumeQuote - a.volumeQuote,
    change: (a, b) => b.changePct - a.changePct,
    risk: (a, b) => riskWeight(a.risk) - riskWeight(b.risk) || b.score - a.score,
  };
  return list.sort(sorters[state.sort] || sorters.score).slice(0, 120);
}

function riskWeight(risk) {
  return risk === "mas seguro" ? 0 : risk === "moderado" ? 1 : 2;
}

function renderMarketList() {
  const visible = getVisibleMarkets();
  els.marketList.innerHTML = "";
  if (!visible.length) {
    els.marketList.innerHTML = `<div class="empty-state">No hay mercados que coincidan con la busqueda.</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const market of visible) {
    const row = els.rowTemplate.content.firstElementChild.cloneNode(true);
    row.classList.toggle("is-selected", market.symbol === state.selectedSymbol);
    row.querySelector(".coin-symbol").textContent = market.baseAsset;
    row.querySelector(".coin-name").textContent = market.symbol;
    renderLogo(row.querySelector(".coin-logo"), market.baseAsset);
    row.querySelector(".coin-price").textContent = formatTablePrice(market.price);
    const change = row.querySelector(".coin-change");
    change.textContent = formatPct(market.changePct);
    change.classList.toggle("positive", market.changePct >= 0);
    change.classList.toggle("negative", market.changePct < 0);
    row.querySelector(".coin-volume").textContent = compactMoney.format(market.volumeQuote);
    row.querySelector(".score-fill").style.width = `${market.score}%`;
    const badge = row.querySelector(".signal-badge");
    badge.className = `signal-badge ${market.signal}`;
    badge.textContent = `${labelSignal(market.signal)} ${market.score}`;
    row.querySelector(".coin-button").addEventListener("click", () => selectMarket(market.symbol));
    const action = row.querySelector(".mini-action");
    action.disabled = market.signal !== "buy" || market.amount <= 0;
    action.addEventListener("click", () => {
      selectMarket(market.symbol);
      openSimulatedTrade(market);
    });
    fragment.appendChild(row);
  }
  els.marketList.appendChild(fragment);
}

function renderLogo(target, symbol) {
  target.innerHTML = "";
  const logo = COIN_LOGOS[symbol];
  if (!logo) {
    target.textContent = symbol.slice(0, 2);
    return;
  }
  const image = document.createElement("img");
  image.alt = `${symbol} logo`;
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  image.src = `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${logo}.svg`;
  image.addEventListener("error", () => {
    target.textContent = symbol.slice(0, 2);
  });
  target.appendChild(image);
}

function selectMarket(symbol) {
  state.selectedSymbol = symbol;
  const market = state.marketMap.get(symbol);
  if (market && !state.klines.has(symbol) && state.activeApi) {
    fetchJson(`${state.activeApi.rest}/api/v3/klines?symbol=${symbol}&interval=1h&limit=120`, 9000)
      .then((data) => {
        const candles = data.map((row) => [Number(row[0]), Number(row[4]), Number(row[5]), Number(row[7])]);
        state.klines.set(symbol, candles);
        applyTechnicalIndicators(market, candles);
        recalculateMarket(market);
        renderAll();
      })
      .catch(() => renderAll());
  }
  renderAll();
}

function renderDetail() {
  const market = state.marketMap.get(state.selectedSymbol);
  if (!market) {
    drawEmptyChart("Sin datos");
    return;
  }
  els.detailTitle.textContent = `${market.baseAsset} / USDT`;
  els.detailSubtitle.textContent = market.reason;
  els.detailBadge.className = `signal-badge ${market.signal}`;
  els.detailBadge.textContent = `${labelSignal(market.signal)} ${market.score}/100`;
  els.detailPrice.textContent = formatPrice(market.price);
  els.detailRsi.textContent = market.rsi == null ? "--" : market.rsi.toFixed(1);
  els.detailProjection.textContent = market.projection4h == null ? "--" : formatPct(market.projection4h);
  els.detailProjection.classList.toggle("positive", market.projection4h > 0);
  els.detailProjection.classList.toggle("negative", market.projection4h < 0);
  els.detailRisk.textContent = market.risk;
  els.suggestedAmount.textContent = money.format(market.amount);
  els.levelsText.textContent = market.stop ? `${formatPrice(market.stop)} / ${formatPrice(market.target)}` : "--";
  const stats = getPortfolioStats();
  els.acceptTradeBtn.disabled = market.signal !== "buy" || market.amount <= 0 || market.amount > stats.cash;
  drawChart(market);
}

function drawChart(market) {
  const candles = state.klines.get(market.symbol);
  if (!candles || candles.length < 2) {
    drawEmptyChart("Cargando velas 1h");
    return;
  }
  const canvas = els.priceChart;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfcfd";
  ctx.fillRect(0, 0, width, height);

  const values = candles.map((item) => item[1]);
  const min = Math.min(...values, market.stop || Infinity);
  const max = Math.max(...values, market.target2 || -Infinity);
  const pad = Math.max((max - min) * 0.12, market.price * 0.004);
  const y = (value) => height - 28 - ((value - min + pad) / (max - min + pad * 2)) * (height - 52);
  const x = (index) => 18 + (index / (values.length - 1)) * (width - 36);

  ctx.strokeStyle = "#d8dee4";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const yy = 24 + i * ((height - 52) / 3);
    ctx.beginPath();
    ctx.moveTo(18, yy);
    ctx.lineTo(width - 18, yy);
    ctx.stroke();
  }

  const isUp = values.at(-1) >= values[0];
  const gradient = ctx.createLinearGradient(0, 20, 0, height - 20);
  gradient.addColorStop(0, isUp ? "rgba(20, 138, 84, 0.28)" : "rgba(199, 59, 59, 0.24)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");

  ctx.beginPath();
  values.forEach((value, index) => {
    const xx = x(index);
    const yy = y(value);
    if (index === 0) ctx.moveTo(xx, yy);
    else ctx.lineTo(xx, yy);
  });
  ctx.lineTo(width - 18, height - 28);
  ctx.lineTo(18, height - 28);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  values.forEach((value, index) => {
    const xx = x(index);
    const yy = y(value);
    if (index === 0) ctx.moveTo(xx, yy);
    else ctx.lineTo(xx, yy);
  });
  ctx.strokeStyle = isUp ? "#148a54" : "#c73b3b";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  drawLevel(ctx, width, y(market.stop), "Stop", "#c73b3b");
  drawLevel(ctx, width, y(market.target), "Objetivo", "#148a54");
  drawLevel(ctx, width, y(market.target2), "Objetivo 2", "#07889b");
}

function drawLevel(ctx, width, y, label, color) {
  if (!Number.isFinite(y)) return;
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(18, y);
  ctx.lineTo(width - 18, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.font = "700 12px Inter, system-ui";
  ctx.fillText(label, 24, Math.max(16, y - 6));
  ctx.restore();
}

function drawEmptyChart(text) {
  const canvas = els.priceChart;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "#fbfcfd";
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "#66727f";
  ctx.font = "800 15px Inter, system-ui";
  ctx.textAlign = "center";
  ctx.fillText(text, rect.width / 2, rect.height / 2);
}

function renderPortfolio() {
  const open = state.positions.filter((position) => position.status === "open");
  const closed = state.positions.filter((position) => position.status === "closed").slice(0, 8);
  els.positionsList.innerHTML = "";
  if (!state.positions.length) {
    els.positionsList.innerHTML = `<div class="empty-state">Todavia no hay inversiones simuladas. Usa una senal con boton + para registrar una entrada.</div>`;
  } else {
    for (const position of [...open, ...closed]) {
      els.positionsList.appendChild(renderPosition(position));
    }
  }

  els.alertsList.innerHTML = "";
  if (!state.alerts.length) {
    els.alertsList.innerHTML = `<div class="empty-state">Las alertas apareceran cuando el mercado o una posicion cambie.</div>`;
  } else {
    for (const alert of state.alerts.slice(0, 15)) {
      const row = document.createElement("article");
      row.className = "alert-row";
      row.innerHTML = `<strong>${escapeHtml(alert.title)}</strong><p>${escapeHtml(alert.body)}</p><span>${new Date(alert.createdAt).toLocaleString("es-BO")}</span>`;
      els.alertsList.appendChild(row);
    }
  }
}

function renderPosition(position) {
  const market = state.marketMap.get(position.symbol);
  const currentPrice = market?.price || position.exitPrice || position.entryPrice;
  const value = position.quantity * currentPrice;
  const pnl = position.status === "open" ? value - position.amountUsd : position.pnlUsd || 0;
  const pnlPct = (pnl / position.amountUsd) * 100;
  const row = document.createElement("article");
  row.className = "position-row";
  const exitHint = position.status === "open" ? getExitHint(position, market) : position.exitReason || "cerrada";
  row.innerHTML = `
    <div class="position-main">
      <div class="position-title">
        <strong>${position.baseAsset} / USDT</strong>
        <span class="signal-badge ${position.status === "open" ? "watch" : "neutral"}">${position.status === "open" ? "Abierta" : "Cerrada"}</span>
        <span class="${pnl >= 0 ? "positive" : "negative"}">${money.format(pnl)} (${formatPct(pnlPct)})</span>
      </div>
      <div class="position-meta">
        <span>Entrada ${formatPrice(position.entryPrice)}</span>
        <span>Actual ${formatPrice(currentPrice)}</span>
        <span>Monto ${money.format(position.amountUsd)}</span>
        <span>${escapeHtml(exitHint)}</span>
      </div>
    </div>
    <div class="position-actions"></div>
  `;
  if (position.status === "open") {
    const close = document.createElement("button");
    close.className = "danger-button";
    close.textContent = "Cerrar";
    close.addEventListener("click", () => closePosition(position.id, "cierre manual"));
    row.querySelector(".position-actions").appendChild(close);
  }
  return row;
}

function getExitHint(position, market) {
  if (!market) return "esperando precio actual";
  if (market.price <= position.stop) return "salida: stop alcanzado";
  if (market.price >= position.target2) return "salida: segundo objetivo alcanzado";
  if (market.price >= position.target) return "vigilar: primer objetivo alcanzado";
  if (market.score < 50) return "vigilar: senal debil";
  return `mantener hasta ${formatPrice(position.target)} o stop ${formatPrice(position.stop)}`;
}

function labelSignal(signal) {
  if (signal === "buy") return "Entrada";
  if (signal === "avoid") return "Evitar";
  if (signal === "exit") return "Salir";
  return "Vigilar";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

window.addEventListener("resize", () => renderDetail());
boot();
