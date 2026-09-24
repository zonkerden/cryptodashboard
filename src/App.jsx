import { useEffect, useMemo, useRef, useState } from 'react';
import { AreaChart, Area, Bar, CartesianGrid, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, usePlotArea, useYAxisScale } from 'recharts';
import { Activity, Bell, CandlestickChart, ChevronDown, CircleDot, Crosshair, Eye, Layers3, LineChart, LockKeyhole, Menu, Minus, MousePointer2, PanelRightClose, Plus, Search, Settings, SlidersHorizontal, Star, TrendingUp, Wifi, WifiOff, Zap } from 'lucide-react';

const API = 'https://api.binance.com/api/v3';
const STREAM = 'wss://stream.binance.com:9443/stream';
const MARKETS = {
  BTCUSDT: { base: 'BTC', quote: 'USDT', precision: 2 },
  ETHUSDT: { base: 'ETH', quote: 'USDT', precision: 2 },
  SOLUSDT: { base: 'SOL', quote: 'USDT', precision: 2 },
};
const TIMEFRAMES = {
  '1m': { interval: '1m', label: '1m' }, '5m': { interval: '5m', label: '5m' },
  '15m': { interval: '15m', label: '15m' }, '1H': { interval: '1h', label: '1h' }, '4H': { interval: '4h', label: '4h' },
};
const FLOW_WINDOWS = { '5m': 1, '15m': 3, '1H': 12, '4H': 48 };
const TRIGGERS = { BTCUSDT: 87500, ETHUSDT: 2800, SOLUSDT: 120 };
const FLOW_HISTORY_KEY = 'orbitflow_depth_history_v1';
const FALLBACK_CANDLES = Array.from({ length: 100 }, (_, index) => {
  const base = 112450 + Math.sin(index / 7) * 580 + index * 5.7;
  const open = base + Math.sin(index * 1.7) * 105;
  const close = base + Math.cos(index * 1.41) * 112;
  return { timestamp: Date.now() - (99 - index) * 300000, time: new Date(Date.now() - (99 - index) * 300000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), open, high: Math.max(open, close) + 65 + (index % 5) * 11, low: Math.min(open, close) - 55 - (index % 4) * 13, close, volume: 55 + Math.abs(Math.sin(index * .8)) * 170 };
});

const cx = (...classes) => classes.filter(Boolean).join(' ');
const compact = (value, digits = 1) => Number.isFinite(value) ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: digits }).format(value) : '—';
const price = (value, precision = 2) => Number.isFinite(value) && value !== 0 ? value.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision }) : '—';

function calculateVWAP(candles) {
  let pv = 0; let volume = 0;
  return candles.map((candle) => {
    const typical = (candle.high + candle.low + candle.close) / 3;
    pv += typical * candle.volume; volume += candle.volume;
    return { ...candle, vwap: volume ? pv / volume : candle.close, range: [candle.low, candle.high], volumeColor: candle.close >= candle.open ? '#22ab94' : '#f7525f' };
  });
}

function calculateProfile(candles, count = 28) {
  if (!candles.length) return [];
  const min = Math.min(...candles.map((c) => c.low)); const max = Math.max(...candles.map((c) => c.high)); const size = (max - min) / count;
  if (!Number.isFinite(size) || size <= 0) return [];
  const bins = Array.from({ length: count }, (_, index) => ({ low: min + index * size, high: min + (index + 1) * size, buy: 0, sell: 0 }));
  candles.forEach((candle) => {
    const range = Math.max(candle.high - candle.low, size * .2);
    const closeLocation = Math.min(1, Math.max(0, (candle.close - candle.low) / range));
    const buyShare = .25 + closeLocation * .5;
    bins.forEach((bin) => {
      const overlap = Math.max(0, Math.min(candle.high, bin.high) - Math.max(candle.low, bin.low));
      if (!overlap) return;
      const allocated = candle.volume * (overlap / range);
      bin.buy += allocated * buyShare; bin.sell += allocated * (1 - buyShare);
    });
  });
  return bins;
}

const mapKline = (row) => ({ timestamp: Number(row[0]), time: new Date(Number(row[0])).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) });
const flowFromKlines = (rows, count) => {
  const sample = rows.slice(-count); const quoteVolume = sample.reduce((sum, row) => sum + Number(row[7] || 0), 0); const takerBuy = sample.reduce((sum, row) => sum + Number(row[10] || 0), 0); const delta = takerBuy * 2 - quoteVolume;
  return { delta, deltaPct: quoteVolume ? delta / quoteVolume * 100 : 0 };
};
const oiChange = (rows, count) => { const newest = Number(rows.at(-1)?.sumOpenInterest || 0); const oldest = Number(rows[Math.max(0, rows.length - 1 - count)]?.sumOpenInterest || 0); return oldest ? (newest - oldest) / oldest * 100 : null; };
const loadDepthHistory = () => { try { return JSON.parse(localStorage.getItem(FLOW_HISTORY_KEY) || '{}'); } catch { return {}; } };

function classifyStructure(symbol, currentPrice, frames, structure) {
  const trigger = TRIGGERS[symbol]; const hourly = frames['1H'] || {}; const confirmations = [hourly.deltaPct > .5, hourly.depth > 5, (hourly.oiPct ?? 0) > .1].filter(Boolean).length; const contradictions = [hourly.deltaPct < -.5, hourly.depth < -5, (hourly.oiPct ?? 0) < -.1].filter(Boolean).length;
  const breakout = currentPrice >= trigger; const bearishStructure = structure.last1h && structure.previous1h && structure.last1h.low < structure.previous1h.low && structure.last1h.close < structure.previous1h.close;
  if (breakout && confirmations >= 2) return { label: 'CONFIRMED BREAKOUT', tone: 'bull', score: Math.min(10, 6 + confirmations), trigger };
  if (breakout && contradictions >= 2) return { label: 'FALSE-BREAKOUT RISK', tone: 'warn', score: 5, trigger };
  if (breakout) return { label: 'WEAK / UNCONFIRMED', tone: 'warn', score: 4, trigger };
  if (bearishStructure && (hourly.deltaPct < -.5 || hourly.depth < -5)) return { label: 'BEARISH STRUCTURE', tone: 'bear', score: 7, trigger };
  if (currentPrice >= trigger * .995) return { label: 'AT TRIGGER', tone: 'warn', score: 3, trigger };
  return { label: 'WAIT', tone: 'neutral', score: 1, trigger };
}

function Candlestick({ x, y, width, height, payload }) {
  if (!payload || !Number.isFinite(payload.open)) return null;
  const { open, close, high, low } = payload; const color = close >= open ? '#22ab94' : '#f7525f'; const range = Math.max(high - low, Number.EPSILON); const scale = height / range;
  const openY = y + (high - open) * scale; const closeY = y + (high - close) * scale; const bodyY = Math.min(openY, closeY); const bodyHeight = Math.max(1.5, Math.abs(closeY - openY)); const bodyWidth = Math.max(2, width * .66); const bodyX = x + (width - bodyWidth) / 2;
  return <g><line x1={x + width / 2} x2={x + width / 2} y1={y} y2={y + height} stroke={color} strokeWidth="1"/><rect x={bodyX} y={bodyY} width={bodyWidth} height={bodyHeight} fill={color} rx=".6"/></g>;
}

function VolumeProfileLayer({ profile, visible }) {
  const yScale = useYAxisScale('price');
  const plotArea = usePlotArea();
  if (!visible || !profile.length || !yScale || !plotArea) return null;

  const maxVolume = Math.max(...profile.map((bin) => bin.buy + bin.sell), 1);
  const maxWidth = plotArea.width * .24;

  return <g className="volume-profile">{profile.map((bin) => {
    const y1 = yScale(bin.high); const y2 = yScale(bin.low); const total = bin.buy + bin.sell;
    const width = total / maxVolume * maxWidth; const buyWidth = width * (bin.buy / total);
    const x = plotArea.x + plotArea.width - width; const y = Math.min(y1, y2); const height = Math.max(2, Math.abs(y2 - y1) - .5);
    return <g key={bin.low}><rect x={x} y={y} width={width - buyWidth} height={height} fill="#f7525f" fillOpacity=".32"/><rect x={x + width - buyWidth} y={y} width={buyWidth} height={height} fill="#22ab94" fillOpacity=".42"/></g>;
  })}</g>;
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.[0]?.payload) return null; const c = payload[0].payload;
  return <div className="chart-tooltip"><div className="tooltip-time">{new Date(c.timestamp).toLocaleString()}</div><div className="tooltip-grid"><span>O <b>{price(c.open)}</b></span><span>H <b>{price(c.high)}</b></span><span>L <b>{price(c.low)}</b></span><span>C <b className={c.close >= c.open ? 'positive' : 'negative'}>{price(c.close)}</b></span></div><div className="tooltip-volume">Vol {compact(c.volume, 2)} {c.base}</div></div>;
}
function Toggle({ active, children, onClick }) { return <button type="button" className={cx('indicator-chip', active && 'active')} onClick={onClick}><Eye size={12}/>{children}</button>; }
function ToolbarButton({ children, active, title }) { return <button type="button" className={cx('tool-button', active && 'active')} title={title}>{children}</button>; }

function useMarketData(symbol, timeframe) {
  const [candles, setCandles] = useState([]); const [trades, setTrades] = useState([]); const [book, setBook] = useState({ bids: [], asks: [] });
  const [ticker, setTicker] = useState({ change: 0, high: 0, low: 0, volume: 0, quoteVolume: 0 }); const [status, setStatus] = useState('connecting'); const [flow, setFlow] = useState({ buy: 0, sell: 0, sessionDelta: 0, rollingDelta: 0 }); const rollingTrades = useRef([]);
  useEffect(() => {
    let mounted = true; let socket; let retryTimer; const interval = TIMEFRAMES[timeframe].interval; const lower = symbol.toLowerCase();
    queueMicrotask(() => { if (mounted) { setStatus('connecting'); setTrades([]); setBook({ bids: [], asks: [] }); setFlow({ buy: 0, sell: 0, sessionDelta: 0, rollingDelta: 0 }); } }); rollingTrades.current = [];
    const loadHistory = async () => {
      try {
        const [kr, tr] = await Promise.all([fetch(`${API}/klines?symbol=${symbol}&interval=${interval}&limit=180`), fetch(`${API}/ticker/24hr?symbol=${symbol}`)]);
        if (!kr.ok || !tr.ok) throw new Error('Market endpoint unavailable'); const [rows, t] = await Promise.all([kr.json(), tr.json()]); if (!mounted) return;
        setCandles(rows.map(mapKline)); setTicker({ change: Number(t.priceChangePercent), high: Number(t.highPrice), low: Number(t.lowPrice), volume: Number(t.volume), quoteVolume: Number(t.quoteVolume) });
      } catch { if (mounted) { setCandles(FALLBACK_CANDLES); setStatus('offline'); } }
    };
    const connect = () => {
      const streams = [`${lower}@kline_${interval}`, `${lower}@aggTrade`, `${lower}@depth20@100ms`, `${lower}@ticker`].join('/'); socket = new WebSocket(`${STREAM}?streams=${streams}`);
      socket.onopen = () => mounted && setStatus('live'); socket.onerror = () => mounted && setStatus('reconnecting'); socket.onclose = () => { if (mounted) { setStatus('reconnecting'); retryTimer = window.setTimeout(connect, 1800); } };
      socket.onmessage = (event) => {
        if (!mounted) return; const message = JSON.parse(event.data); const payload = message.data; const stream = message.stream || '';
        if (stream.includes('@kline_')) { const k = payload.k; const next = mapKline([k.t, k.o, k.h, k.l, k.c, k.v]); setCandles((previous) => { const index = previous.findIndex((item) => item.timestamp === next.timestamp); if (index === -1) return [...previous, next].slice(-180); const updated = [...previous]; updated[index] = next; return updated; }); }
        if (stream.includes('@aggTrade')) {
          const tradePrice = Number(payload.p); const quantity = Number(payload.q); const notional = tradePrice * quantity; const side = payload.m ? 'sell' : 'buy'; const trade = { id: payload.a, price: tradePrice, quantity, notional, side, time: payload.T };
          setTrades((previous) => [trade, ...previous].slice(0, 32)); const now = Number(payload.T); rollingTrades.current = [...rollingTrades.current, { time: now, signed: side === 'buy' ? notional : -notional }].filter((item) => now - item.time <= 60000); const rollingDelta = rollingTrades.current.reduce((sum, item) => sum + item.signed, 0);
          setFlow((previous) => ({ buy: previous.buy + (side === 'buy' ? notional : 0), sell: previous.sell + (side === 'sell' ? notional : 0), sessionDelta: previous.sessionDelta + (side === 'buy' ? notional : -notional), rollingDelta }));
        }
        if (stream.includes('@depth20')) setBook({ bids: payload.bids.map(([p, s]) => ({ price: Number(p), size: Number(s) })), asks: payload.asks.map(([p, s]) => ({ price: Number(p), size: Number(s) })) });
        if (stream.endsWith('@ticker')) setTicker({ change: Number(payload.P), high: Number(payload.h), low: Number(payload.l), volume: Number(payload.v), quoteVolume: Number(payload.q) });
      };
    };
    loadHistory(); connect(); return () => { mounted = false; window.clearTimeout(retryTimer); socket?.close(); };
  }, [symbol, timeframe]);
  return { candles, trades, book, ticker, status, flow };
}

function useMultiTimeframeFlow(symbol, currentPrice, liveImbalance) {
  const [snapshot, setSnapshot] = useState({ frames: {}, funding: null, openInterest: null, structure: {}, samples: 0, updatedAt: null });
  const historyRef = useRef(loadDepthHistory()); const liveRef = useRef({ price: currentPrice, imbalance: liveImbalance });
  useEffect(() => { liveRef.current = { price: currentPrice, imbalance: liveImbalance }; }, [currentPrice, liveImbalance]);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const urls = [
          `${API}/klines?symbol=${symbol}&interval=5m&limit=49`, `${API}/klines?symbol=${symbol}&interval=1h&limit=4`, `${API}/klines?symbol=${symbol}&interval=4h&limit=4`,
          `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=49`, `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`,
        ];
        const responses = await Promise.all(urls.map((url) => fetch(url))); if (responses.some((response) => !response.ok)) throw new Error('Multi-timeframe endpoint unavailable');
        const [flowRows, hourRows, fourHourRows, oiRows, premium] = await Promise.all(responses.map((response) => response.json())); if (!mounted) return;
        const history = historyRef.current[symbol] || []; const now = Date.now(); const frames = {};
        Object.entries(FLOW_WINDOWS).forEach(([window, count]) => {
          const minutes = count * 5; const depthRows = history.filter((item) => now - item.timestamp <= minutes * 60000); const depth = depthRows.length ? depthRows.reduce((sum, item) => sum + item.imbalance, 0) / depthRows.length : liveRef.current.imbalance;
          frames[window] = { ...flowFromKlines(flowRows, count), oiPct: oiChange(oiRows, count), depth, samples: depthRows.length };
        });
        const toStructure = (row) => row ? { high: Number(row[2]), low: Number(row[3]), close: Number(row[4]) } : null;
        setSnapshot({ frames, funding: Number(premium.lastFundingRate) * 100, openInterest: Number(oiRows.at(-1)?.sumOpenInterest || 0), structure: { last1h: toStructure(hourRows.at(-2)), previous1h: toStructure(hourRows.at(-3)), last4h: toStructure(fourHourRows.at(-2)), previous4h: toStructure(fourHourRows.at(-3)) }, samples: history.length, updatedAt: Date.now() });
      } catch { if (mounted) setSnapshot((previous) => ({ ...previous, updatedAt: Date.now() })); }
    };
    refresh(); const refreshTimer = window.setInterval(refresh, 30000); return () => { mounted = false; window.clearInterval(refreshTimer); };
  }, [symbol]);

  useEffect(() => {
    const sample = () => {
      if (!liveRef.current.price) return; const cutoff = Date.now() - 6 * 60 * 60 * 1000; const previous = historyRef.current[symbol] || [];
      historyRef.current = { ...historyRef.current, [symbol]: [...previous.filter((item) => item.timestamp >= cutoff), { timestamp: Date.now(), price: liveRef.current.price, imbalance: liveRef.current.imbalance }].slice(-1500) };
      localStorage.setItem(FLOW_HISTORY_KEY, JSON.stringify(historyRef.current));
    };
    sample(); const sampleTimer = window.setInterval(sample, 15000); return () => window.clearInterval(sampleTimer);
  }, [symbol]);

  return { ...snapshot, signal: classifyStructure(symbol, currentPrice, snapshot.frames, snapshot.structure) };
}

function OrderBook({ book, currentPrice, precision }) {
  const asks = book.asks.slice(0, 9).reverse(); const bids = book.bids.slice(0, 9); const max = Math.max(1, ...asks.map((l) => l.size), ...bids.map((l) => l.size)); const spread = book.asks[0] && book.bids[0] ? book.asks[0].price - book.bids[0].price : 0;
  const row = (level, side) => <div className="book-row" key={`${side}-${level.price}`}><span className={cx('book-depth', side)} style={{ width: `${level.size / max * 100}%` }}/><span className={side === 'bid' ? 'positive' : 'negative'}>{price(level.price, precision)}</span><span>{level.size.toFixed(4)}</span><span>{compact(level.price * level.size, 2)}</span></div>;
  return <div className="book-table"><div className="table-head"><span>Price (USDT)</span><span>Size</span><span>Sum</span></div><div className="book-levels asks">{asks.map((level) => row(level, 'ask'))}</div><div className="mid-price"><TrendingUp size={14}/><strong>{price(currentPrice, precision)}</strong><span>spread {spread ? price(spread, precision) : '—'}</span></div><div className="book-levels bids">{bids.map((level) => row(level, 'bid'))}</div></div>;
}
function TradeTape({ trades, precision }) { return <div className="tape-table"><div className="table-head"><span>Price</span><span>Size</span><span>Time</span></div>{trades.slice(0, 18).map((trade) => <div className="tape-row" key={trade.id}><span className={trade.side === 'buy' ? 'positive' : 'negative'}>{price(trade.price, precision)}</span><span>{trade.quantity.toFixed(5)}</span><span>{new Date(trade.time).toLocaleTimeString([], { hour12: false })}</span></div>)}{!trades.length && <div className="empty-row">Waiting for live trades…</div>}</div>; }

function FlowPanel({ flow, imbalance, spreadBps, score }) {
  const total = flow.buy + flow.sell || 1; const buyPercent = flow.buy / total * 100;
  return <div className="flow-panel"><div className="flow-score"><div><span className="eyebrow">FLOW COMPOSITE</span><strong className={score.direction === 'LONG' ? 'positive' : score.direction === 'SHORT' ? 'negative' : ''}>{score.label}</strong></div><div className={cx('score-ring', score.direction.toLowerCase())}>{score.value}<small>/100</small></div></div><div className="flow-stat-grid"><div><span>60s Delta</span><b className={flow.rollingDelta >= 0 ? 'positive' : 'negative'}>{flow.rollingDelta >= 0 ? '+' : ''}${compact(flow.rollingDelta)}</b></div><div><span>Book imbalance</span><b className={imbalance >= 0 ? 'positive' : 'negative'}>{imbalance >= 0 ? '+' : ''}{imbalance.toFixed(1)}%</b></div><div><span>Session CVD</span><b className={flow.sessionDelta >= 0 ? 'positive' : 'negative'}>{flow.sessionDelta >= 0 ? '+' : ''}${compact(flow.sessionDelta)}</b></div><div><span>Spread</span><b>{spreadBps.toFixed(2)} bps</b></div></div><div className="aggressor-labels"><span>Market buys {buyPercent.toFixed(0)}%</span><span>Market sells {(100 - buyPercent).toFixed(0)}%</span></div><div className="aggressor-bar"><i style={{ width: `${buyPercent}%` }}/></div><p className="flow-note"><CircleDot size={11}/> Aggressor side from Binance maker flag · DOM uses top 10 levels</p></div>;
}

function MultiTimeframePanel({ data, currentPrice, precision }) {
  const [selectedWindow, setSelectedWindow] = useState('1H'); const selected = data.frames[selectedWindow] || {}; const distance = currentPrice ? (data.signal.trigger - currentPrice) / currentPrice * 100 : null;
  const signed = (value, suffix = '%') => Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(1)}${suffix}` : '—';
  return <div className="mtf-panel">
    <div className="mtf-summary"><span className="eyebrow">STRUCTURE + FLOW SIGNAL</span><strong className={`signal-${data.signal.tone}`}>{data.signal.label}</strong><small>Trigger {price(data.signal.trigger, precision)} · {distance === null ? '—' : `${Math.abs(distance).toFixed(2)}% ${distance > 0 ? 'below' : 'above'}`}</small></div>
    <div className="mtf-matrix"><div className="mtf-row head"><span>Window</span><span>Taker Δ</span><span>OI Δ</span><span>Depth</span></div>{Object.keys(FLOW_WINDOWS).map((window) => { const frame = data.frames[window] || {}; return <button key={window} className={cx('mtf-row', selectedWindow === window && 'active')} onClick={() => setSelectedWindow(window)}><b>{window}</b><span className={frame.deltaPct >= 0 ? 'positive' : 'negative'}>{signed(frame.deltaPct)}</span><span className={(frame.oiPct ?? 0) >= 0 ? 'positive' : 'negative'}>{signed(frame.oiPct)}</span><span className={(frame.depth ?? 0) >= 0 ? 'positive' : 'negative'}>{signed(frame.depth)}</span></button>; })}</div>
    <div className="mtf-detail"><div><span>{selectedWindow} net delta</span><b className={(selected.delta ?? 0) >= 0 ? 'positive' : 'negative'}>{selected.delta >= 0 ? '+' : '-'}${compact(Math.abs(selected.delta || 0), 2)}</b></div><div><span>Funding</span><b className={(data.funding ?? 0) >= 0 ? 'positive' : 'negative'}>{signed(data.funding, '%')}</b></div><div><span>Open interest</span><b>{compact(data.openInterest, 2)}</b></div><div><span>Depth samples</span><b>{selected.samples || 0}</b></div></div>
  </div>;
}

function OrderTicket({ symbol, currentPrice, precision }) {
  const market = MARKETS[symbol]; const [side, setSide] = useState('buy'); const [orderType, setOrderType] = useState('Limit'); const [amount, setAmount] = useState('0.010'); const [limitPrice, setLimitPrice] = useState('');
  const displayLimit = limitPrice || (currentPrice ? currentPrice.toFixed(precision) : ''); const estimated = Number(amount) * Number(displayLimit || currentPrice || 0);
  return <div className="order-ticket"><div className="side-switch"><button className={side === 'buy' ? 'buy active' : ''} onClick={() => setSide('buy')}>Buy</button><button className={side === 'sell' ? 'sell active' : ''} onClick={() => setSide('sell')}>Sell</button></div><div className="type-row">{['Limit', 'Market', 'Stop'].map((type) => <button className={orderType === type ? 'active' : ''} onClick={() => setOrderType(type)} key={type}>{type}</button>)}</div>{orderType !== 'Market' && <label className="order-field"><span>Price</span><input value={displayLimit} onChange={(e) => setLimitPrice(e.target.value)} inputMode="decimal"/><em>USDT</em></label>}<label className="order-field"><span>Amount</span><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"/><em>{market.base}</em></label><div className="allocation-row">{[25, 50, 75, 100].map((v) => <button key={v}>{v}%</button>)}</div><div className="order-summary"><span>Order value</span><b>≈ {price(estimated)} USDT</b></div><button className={cx('place-order', side)}>{side === 'buy' ? `Buy ${market.base}` : `Sell ${market.base}`}</button><div className="paper-notice"><LockKeyhole size={11}/> Paper execution only · no exchange account connected</div></div>;
}

export default function App() {
  const [symbol, setSymbol] = useState('BTCUSDT'); const [timeframe, setTimeframe] = useState('5m'); const [rightTab, setRightTab] = useState('book'); const [bottomTab, setBottomTab] = useState('flow'); const [indicators, setIndicators] = useState({ vwap: true, profile: true, levels: true }); const [orderPanelOpen, setOrderPanelOpen] = useState(true);
  const { candles, trades, book, ticker, status, flow } = useMarketData(symbol, timeframe); const market = MARKETS[symbol]; const chartData = useMemo(() => calculateVWAP(candles).map((item) => ({ ...item, base: market.base })), [candles, market.base]); const profile = useMemo(() => calculateProfile(chartData), [chartData]); const current = chartData.at(-1); const currentPrice = current?.close || 0; const previousClose = chartData.at(-2)?.close || currentPrice; const tickDirection = currentPrice >= previousClose ? 'up' : 'down';
  const levels = useMemo(() => { const sample = chartData.slice(-48, -1); return sample.length ? { resistance: Math.max(...sample.map((i) => i.high)), support: Math.min(...sample.map((i) => i.low)) } : { resistance: null, support: null }; }, [chartData]);
  const depth = (() => { const bid = book.bids.slice(0, 10).reduce((s, i) => s + i.price * i.size, 0); const ask = book.asks.slice(0, 10).reduce((s, i) => s + i.price * i.size, 0); const total = bid + ask; const imbalance = total ? (bid - ask) / total * 100 : 0; const spread = book.asks[0] && book.bids[0] ? book.asks[0].price - book.bids[0].price : 0; return { imbalance, spreadBps: currentPrice ? spread / currentPrice * 10000 : 0 }; })();
  const multiTimeframe = useMultiTimeframeFlow(symbol, currentPrice, depth.imbalance);
  const flowScore = (() => { const deltaSignal = Math.max(-35, Math.min(35, flow.rollingDelta / 4000)); const bookSignal = Math.max(-35, Math.min(35, depth.imbalance * .7)); const trendSignal = currentPrice && current?.vwap ? Math.max(-20, Math.min(20, (currentPrice - current.vwap) / currentPrice * 12000)) : 0; const signed = deltaSignal + bookSignal + trendSignal; const direction = signed > 14 ? 'LONG' : signed < -14 ? 'SHORT' : 'NEUTRAL'; return { direction, value: Math.round(Math.min(100, 50 + Math.abs(signed) * .72)), label: direction === 'NEUTRAL' ? 'BALANCED' : `${direction} PRESSURE` }; })();
  return <div className="terminal-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark"><CandlestickChart size={19}/></div><strong>ORBIT<span>FLOW</span></strong><small>PRO</small></div><nav className="main-nav"><button className="active">Terminal</button><button>Markets</button><button>Portfolio</button><button>Strategy Lab</button></nav><div className="top-actions"><button className="command"><Search size={14}/><span>Search markets</span><kbd>⌘ K</kbd></button><button className="icon-action"><Bell size={16}/><i/></button><button className="icon-action"><Settings size={16}/></button><div className="avatar">FK</div></div></header>
    <section className="marketbar"><button className="market-selector"><div className="asset-icon">₿</div><div><b>{market.base} / {market.quote}</b><span>Binance · Spot</span></div><ChevronDown size={14}/></button><Star size={15} className="star"/><div className={cx('market-price', tickDirection)}>{price(currentPrice, market.precision)}</div><div className={cx(ticker.change >= 0 ? 'positive' : 'negative', 'ticker-change')}>{ticker.change >= 0 ? '+' : ''}{ticker.change.toFixed(2)}%</div><div className="market-stat"><span>24h high</span><b>{price(ticker.high)}</b></div><div className="market-stat"><span>24h low</span><b>{price(ticker.low)}</b></div><div className="market-stat"><span>24h volume</span><b>{compact(ticker.volume, 2)} {market.base}</b></div><div className="market-stat"><span>Turnover</span><b>${compact(ticker.quoteVolume, 2)}</b></div><div className={cx('live-status', status)}>{status === 'live' ? <Wifi size={12}/> : <WifiOff size={12}/>}<span>{status}</span></div></section>
    <main className={cx('workspace', !orderPanelOpen && 'order-closed')}>
      <aside className="left-toolbar"><ToolbarButton active title="Cursor"><MousePointer2 size={17}/></ToolbarButton><ToolbarButton title="Crosshair"><Crosshair size={17}/></ToolbarButton><div className="tool-divider"/><ToolbarButton title="Trend line"><TrendingUp size={17}/></ToolbarButton><ToolbarButton title="Horizontal line"><Minus size={18}/></ToolbarButton><ToolbarButton title="Channels"><LineChart size={17}/></ToolbarButton><ToolbarButton title="Fibonacci"><Menu size={17}/></ToolbarButton><div className="tool-divider"/><ToolbarButton title="Measure"><Activity size={17}/></ToolbarButton><ToolbarButton title="Zoom"><Search size={17}/></ToolbarButton><div className="toolbar-spacer"/><ToolbarButton title="Magnet"><Zap size={16}/></ToolbarButton><ToolbarButton title="Lock"><LockKeyhole size={16}/></ToolbarButton></aside>
      <section className="chart-column">
        <div className="chart-controls"><div className="timeframes">{Object.keys(TIMEFRAMES).map((value) => <button key={value} className={timeframe === value ? 'active' : ''} onClick={() => setTimeframe(value)}>{value}</button>)}</div><div className="control-divider"/><button className="chart-type"><CandlestickChart size={15}/><ChevronDown size={12}/></button><Toggle active={indicators.vwap} onClick={() => setIndicators((v) => ({ ...v, vwap: !v.vwap }))}>VWAP</Toggle><Toggle active={indicators.profile} onClick={() => setIndicators((v) => ({ ...v, profile: !v.profile }))}>Volume Profile</Toggle><Toggle active={indicators.levels} onClick={() => setIndicators((v) => ({ ...v, levels: !v.levels }))}>S/R</Toggle><div className="chart-control-spacer"/><button className="plain-control"><SlidersHorizontal size={15}/></button><button className="plain-control"><Layers3 size={15}/></button></div>
        <div className="chart-canvas"><div className="chart-legend"><div><b>{market.base} / TetherUS</b><span>· {TIMEFRAMES[timeframe].label} · BINANCE</span><i className={status === 'live' ? 'online' : ''}/></div>{current && <div className="ohlc"><span>O <b>{price(current.open)}</b></span><span>H <b>{price(current.high)}</b></span><span>L <b>{price(current.low)}</b></span><span>C <b className={tickDirection === 'up' ? 'positive' : 'negative'}>{price(current.close)}</b></span></div>}</div>
          <ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} margin={{ top: 50, right: 15, left: 0, bottom: 6 }}><CartesianGrid stroke="#202630" strokeDasharray="2 2" vertical/><XAxis dataKey="time" minTickGap={54} tick={{ fill: '#7d8594', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#2b313c' }}/><YAxis yAxisId="price" orientation="right" domain={([min, max]) => { const pad = (max - min || max * .01) * .12; return [min - pad, max + pad]; }} tickFormatter={(v) => price(v, market.precision)} width={73} tick={{ fill: '#8b93a1', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#2b313c' }}/><YAxis yAxisId="volume" hide domain={[0, (max) => max * 4]}/><Tooltip content={<ChartTooltip/>} cursor={{ stroke: '#758195', strokeDasharray: '3 3', strokeWidth: 1 }}/><Bar yAxisId="volume" dataKey="volume" fill="#4c5565" opacity={.22} isAnimationActive={false}/><VolumeProfileLayer profile={profile} visible={indicators.profile}/>{indicators.vwap && <Area yAxisId="price" dataKey="vwap" stroke="#a78bfa" fill="none" strokeWidth={1.4} dot={false} isAnimationActive={false}/>} {indicators.levels && levels.resistance && <ReferenceLine yAxisId="price" y={levels.resistance} stroke="#f7525f" strokeOpacity={.45} strokeDasharray="5 4"/>}{indicators.levels && levels.support && <ReferenceLine yAxisId="price" y={levels.support} stroke="#22ab94" strokeOpacity={.45} strokeDasharray="5 4"/>}{currentPrice > 0 && <ReferenceLine yAxisId="price" y={currentPrice} stroke={tickDirection === 'up' ? '#22ab94' : '#f7525f'} strokeDasharray="2 2"/>}<Bar yAxisId="price" dataKey="range" shape={(props) => <Candlestick {...props}/>} isAnimationActive={false}/></ComposedChart></ResponsiveContainer>
        </div>
        <section className="bottom-panel"><div className="panel-tabs"><button className={bottomTab === 'flow' ? 'active' : ''} onClick={() => setBottomTab('flow')}>Order flow</button><button className={bottomTab === 'matrix' ? 'active' : ''} onClick={() => setBottomTab('matrix')}>MTF signals</button><button className={bottomTab === 'cvd' ? 'active' : ''} onClick={() => setBottomTab('cvd')}>CVD</button><button className={bottomTab === 'trades' ? 'active' : ''} onClick={() => setBottomTab('trades')}>Recent trades</button><span className="session-label">SESSION · {new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase()}</span></div>{bottomTab === 'flow' && <FlowPanel flow={flow} imbalance={depth.imbalance} spreadBps={depth.spreadBps} score={flowScore}/>} {bottomTab === 'matrix' && <MultiTimeframePanel data={multiTimeframe} currentPrice={currentPrice} precision={market.precision}/>} {bottomTab === 'cvd' && <div className="mini-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trades.slice().reverse().reduce((acc, trade, index) => { const previous = acc[index - 1]?.value || 0; acc.push({ index, value: previous + (trade.side === 'buy' ? trade.notional : -trade.notional) }); return acc; }, [])}><defs><linearGradient id="cvdFill"><stop offset="0" stopColor="#6c7cff" stopOpacity=".35"/><stop offset="1" stopColor="#6c7cff" stopOpacity="0"/></linearGradient></defs><Area dataKey="value" stroke="#8390ff" fill="url(#cvdFill)" strokeWidth={1.5} dot={false}/></AreaChart></ResponsiveContainer></div>}{bottomTab === 'trades' && <TradeTape trades={trades} precision={market.precision}/>}</section>
      </section>
      <aside className="market-panel"><div className="panel-tabs compact"><button className={rightTab === 'book' ? 'active' : ''} onClick={() => setRightTab('book')}>Order book</button><button className={rightTab === 'tape' ? 'active' : ''} onClick={() => setRightTab('tape')}>Trades</button><button className="panel-settings"><SlidersHorizontal size={13}/></button></div><div className="book-toolbar"><div><button className="depth-mode active"><i/><i/><i/></button><button className="depth-mode bids"><i/><i/><i/></button><button className="depth-mode asks"><i/><i/><i/></button></div><button>0.1 <ChevronDown size={10}/></button></div>{rightTab === 'book' ? <OrderBook book={book} currentPrice={currentPrice} precision={market.precision}/> : <TradeTape trades={trades} precision={market.precision}/>}</aside>
      <aside className="execution-panel"><div className="execution-head"><b>Paper trading</b><button onClick={() => setOrderPanelOpen(false)}><PanelRightClose size={15}/></button></div><div className="account-strip"><span>Available</span><b>10,000.00 USDT</b></div><OrderTicket symbol={symbol} currentPrice={currentPrice} precision={market.precision}/><div className="watchlist"><div className="watch-head"><b>Watchlist</b><button><Plus size={13}/></button></div>{Object.keys(MARKETS).map((item) => <button key={item} className={symbol === item ? 'active' : ''} onClick={() => setSymbol(item)}><span><i>{MARKETS[item].base === 'BTC' ? '₿' : MARKETS[item].base[0]}</i><b>{MARKETS[item].base}</b><small>/USDT</small></span><span><b>{item === symbol ? price(currentPrice) : item === 'ETHUSDT' ? '4,182.64' : '247.83'}</b><small className={item === 'SOLUSDT' ? 'negative' : 'positive'}>{item === 'SOLUSDT' ? '-1.24%' : '+2.18%'}</small></span></button>)}</div></aside>
      {!orderPanelOpen && <button className="open-execution" onClick={() => setOrderPanelOpen(true)}><PanelRightClose size={15}/> Trade</button>}
    </main>
    <footer className="statusbar"><span><i className={status === 'live' ? 'online' : ''}/> Binance market data</span><span>UTC+8</span><span className="status-spacer"/><span>Trades classify taker direction; volume profile is OHLCV-estimated</span></footer>
  </div>;
}
