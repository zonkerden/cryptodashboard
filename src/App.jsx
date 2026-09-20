import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  ResponsiveContainer, 
  ComposedChart, 
  Line,
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend,
  ReferenceLine,
  Customized
} from 'recharts';
import { 
  Activity, 
  Wifi, 
  WifiOff, 
  Loader2, 
  BarChart2, 
  TrendingUp, 
  Gauge,
  Newspaper,
  ExternalLink,
  Clock,
  List,
  AlignEndHorizontal,
  Layers,
  Settings,
  TrendingDown
} from 'lucide-react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("Dashboard caught an error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen bg-[#131722] text-[#D1D4DC] p-10 flex flex-col items-center justify-center font-sans">
          <div className="bg-[#1E222D] p-8 rounded-xl border border-[#F23645]/50 max-w-2xl w-full shadow-2xl">
            <h1 className="text-2xl font-bold text-[#F23645] mb-4 flex items-center gap-2">
              <Activity /> Dashboard Crash Prevented
            </h1>
            <p className="text-[#D1D4DC] mb-4">An indicator encountered invalid data before it could load. Here is the exact error:</p>
            <pre className="bg-[#131722] p-4 rounded text-sm text-[#F23645] overflow-x-auto border border-[#2A2E39] mb-6">
              {this.state.error && this.state.error.toString()}
            </pre>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2.5 bg-[#2962FF] hover:bg-[#1E4BD8] text-white rounded font-bold transition-colors shadow-lg"
            >
              Reload Dashboard
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const formatNumber = (num, minDec = 2, maxDec = 2) => {
  if (num === undefined || num === null || isNaN(num)) return '0.00';
  return Number(num).toLocaleString(undefined, { minimumFractionDigits: minDec, maximumFractionDigits: maxDec });
};

// TradingView Color Palette
const TV_COLORS = {
  bg: '#131722',
  panel: '#1E222D',
  border: '#2A2E39',
  text: '#D1D4DC',
  textMuted: '#787B86',
  green: '#089981',
  red: '#F23645',
  blue: '#2962FF'
};

const CustomCandlestick = (props) => {
  const { x, y, width, height, payload, isHeikinAshi } = props;
  if (!payload) return null;
  const o = isHeikinAshi ? payload.haOpen : payload.open;
  const c = isHeikinAshi ? payload.haClose : payload.close;
  const h = isHeikinAshi ? payload.haHigh : payload.high;
  const l = isHeikinAshi ? payload.haLow : payload.low;
  if (typeof o !== 'number' || !isFinite(x) || !isFinite(y) || !isFinite(width) || !isFinite(height)) return null;

  const isUp = c >= o;
  const color = isUp ? TV_COLORS.green : TV_COLORS.red; 
  const range = h - l;
  if (range === 0 || !isFinite(range)) return <line x1={x} y1={y} x2={x + width} y2={y} stroke={color} strokeWidth={2} />;

  const ratio = height / range;
  const openY = y + (h - o) * ratio;
  const closeY = y + (h - c) * ratio;
  const topY = Math.min(openY, closeY);
  const bottomY = Math.max(openY, closeY);
  const bodyHeight = Math.max(bottomY - topY, 2); 

  return (
    <g>
      <line x1={x + width / 2} y1={y} x2={x + width / 2} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={x + width * 0.15} y={topY} width={width * 0.7} height={bodyHeight} fill={color} stroke={color} />
    </g>
  );
};

const calculateHeikinAshi = (data) => {
  if (!data || data.length === 0) return [];
  let prevHaOpen = data[0].open;
  let prevHaClose = data[0].close;
  return data.map((point, index) => {
    const haClose = (point.open + point.high + point.low + point.close) / 4;
    let haOpen = index === 0 ? (point.open + point.close) / 2 : (prevHaOpen + prevHaClose) / 2;
    const haHigh = Math.max(point.high, haOpen, haClose);
    const haLow = Math.min(point.low, haOpen, haClose);
    prevHaOpen = haOpen;
    prevHaClose = haClose;
    return { ...point, haOpen, haHigh, haLow, haClose, haCandleRange: [haLow, haHigh] };
  });
};

const calculateSMA = (data, period) => {
  if (!data || data.length === 0) return [];
  return data.map((point, index, arr) => {
    if (index < period - 1) return { ...point, sma: null };
    const sum = arr.slice(index - period + 1, index + 1).reduce((acc, val) => acc + (val.price || 0), 0);
    return { ...point, sma: sum / period };
  });
};

const calculateEMA = (data, period) => {
  if (!data || data.length === 0) return [];
  const k = 2 / (period + 1);
  let ema = data[0]?.price || 0;
  return data.map((point, index) => {
    if (index === 0) return { ...point, ema: null };
    ema = (point.price || 0) * k + ema * (1 - k);
    return { ...point, ema };
  });
};

const calculateMACD = (data) => {
  if (!data || data.length === 0) return [];
  const calcGenericEMA = (arr, period, key) => {
    const k = 2 / (period + 1);
    let ema = arr[0]?.[key] || 0;
    return arr.map((point, index) => {
      if (index === 0) return ema;
      ema = (point[key] || 0) * k + ema * (1 - k);
      return ema;
    });
  };
  const ema12 = calcGenericEMA(data, 12, 'price');
  const ema26 = calcGenericEMA(data, 26, 'price');
  const withMacdLine = data.map((point, i) => ({ ...point, macdLine: ema12[i] - ema26[i] }));
  const signalLine = calcGenericEMA(withMacdLine, 9, 'macdLine');
  return withMacdLine.map((point, i) => {
    const hist = point.macdLine - signalLine[i];
    return { ...point, macdSignal: signalLine[i], macdHistPos: hist >= 0 ? hist : 0, macdHistNeg: hist < 0 ? hist : 0 };
  });
};

const calculateBollingerBands = (data, period = 20, multiplier = 2) => {
  if (!data || data.length === 0) return [];
  return data.map((point, index, arr) => {
    if (index < period - 1) return { ...point, bbUpper: null, bbLower: null };
    const slice = arr.slice(index - period + 1, index + 1);
    const sum = slice.reduce((acc, val) => acc + (val.price || 0), 0);
    const sma = sum / period;
    const variance = slice.reduce((acc, val) => acc + Math.pow((val.price || 0) - sma, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    return { ...point, bbUpper: sma + stdDev * multiplier, bbLower: sma - stdDev * multiplier };
  });
};

const calculateRSI = (data, period = 14) => {
  if (!data || data.length === 0) return [];
  let avgGain = 0, avgLoss = 0;
  return data.map((point, index, arr) => {
    if (index === 0) return { ...point, rsi: null };
    const diff = (point.price || 0) - (arr[index - 1].price || 0);
    const gain = Math.max(0, diff), loss = Math.max(0, -diff);
    if (index < period) {
      avgGain += gain; avgLoss += loss; return { ...point, rsi: null };
    } else if (index === period) {
      avgGain /= period; avgLoss /= period;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    const rs = avgGain / (avgLoss === 0 ? 1 : avgLoss);
    return { ...point, rsi: 100 - (100 / (1 + rs)) };
  });
};

const calculateVWAP = (data) => {
  if (!data || data.length === 0) return [];
  let cumVol = 0, cumVolPrice = 0;
  return data.map(point => {
    const typPrice = point.candleRange ? (point.candleRange[0] + point.candleRange[1] + (point.close || point.price)) / 3 : point.price;
    const vol = point.volume || 0;
    cumVol += vol;
    cumVolPrice += typPrice * vol;
    return { ...point, vwap: cumVol === 0 ? null : cumVolPrice / cumVol };
  });
};

const calculateAutoSR = (data) => {
  if (!data || data.length < 15) return [];
  let pivots = [];
  for (let i = 5; i < data.length - 5; i++) {
    const slice = data.slice(i - 5, i + 6);
    const high = data[i].high !== undefined ? data[i].high : data[i].price;
    const low = data[i].low !== undefined ? data[i].low : data[i].price;
    const isHigh = slice.every(d => (d.high !== undefined ? d.high : d.price) <= high);
    const isLow = slice.every(d => (d.low !== undefined ? d.low : d.price) >= low);
    if (isHigh) pivots.push({ type: 'resistance', price: high, weight: 1 });
    if (isLow) pivots.push({ type: 'support', price: low, weight: 1 });
  }
  let grouped = [];
  pivots.forEach(p => {
    const existing = grouped.find(g => Math.abs(g.price - p.price) / p.price < 0.005); 
    if (existing) existing.weight += 1;
    else grouped.push({ ...p });
  });
  return grouped.sort((a,b) => b.weight - a.weight).slice(0, 5);
};

const TIMEFRAMES = {
  'LIVE': { label: 'Live', interval: '1m', limit: 100 },
  '1M': { label: '1M', interval: '4h', limit: 180 },
  '6M': { label: '6M', interval: '1d', limit: 180 },
  '1Y': { label: '1Y', interval: '1d', limit: 365 },
  '5Y': { label: '5Y', interval: '1w', limit: 260 },
};

const COIN_CONFIG = {
  'BTCUSDT': { label: 'BTC', name: 'Bitcoin', color: '#F7931A' },
  'ETHUSDT': { label: 'ETH', name: 'Ethereum', color: '#627EEA' },
  'SOLUSDT': { label: 'SOL', name: 'Solana', color: '#14F195' }
};

const formatTime = (timestamp, tf) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (tf === 'LIVE') return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (tf === '1M') return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit' });
  if (tf === '5Y') return date.toLocaleDateString([], { year: 'numeric', month: 'short' });
  return date.toLocaleDateString([], { year: '2-digit', month: 'short', day: 'numeric' });
};

// Sleek Toggle Switch
const ToggleSwitch = ({ checked, onChange, colorClass }) => (
  <label className="flex items-center cursor-pointer">
    <div className="relative">
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
      <div className={`w-8 h-4 rounded-full transition-colors duration-300 ease-in-out ${checked ? colorClass : 'bg-[#2A2E39]'}`}></div>
      <div className={`absolute left-0.5 top-0.5 bg-white w-3 h-3 rounded-full transition-transform duration-300 ease-in-out ${checked ? 'transform translate-x-4' : ''}`}></div>
    </div>
  </label>
);

const IndicatorRow = ({ label, checked, onChange, colorClass, isPro }) => (
  <div className="flex items-center justify-between py-1.5 hover:bg-[#2A2E39]/30 px-2 rounded -mx-2 transition-colors">
    <div className="flex items-center gap-3">
      <ToggleSwitch checked={checked} onChange={onChange} colorClass={colorClass} />
      <span className={`text-[13px] font-medium ${checked ? 'text-[#D1D4DC]' : 'text-[#787B86]'}`}>
        {label} {isPro && <span className={checked ? colorClass.replace('bg-', 'text-') : 'text-[#787B86]'}>(Pro)</span>}
      </span>
    </div>
  </div>
);

function LiveCryptoDashboard() {
  const [selectedPair, setSelectedPair] = useState('BTCUSDT');
  const [selectedTimeframe, setSelectedTimeframe] = useState('LIVE');
  const [chartType, setChartType] = useState('candle');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wsStatus, setWsStatus] = useState('connecting'); 
  const [fngData, setFngData] = useState(null);
  const [newsData, setNewsData] = useState([]);
  
  const [recentTrades, setRecentTrades] = useState([]);
  const [orderBook, setOrderBook] = useState({ bids: [], asks: [], maxVol: 0 });
  const [tickers, setTickers] = useState({});

  // Indicators
  const [showSMA, setShowSMA] = useState(true);
  const [showEMA, setShowEMA] = useState(false);
  const [showFib, setShowFib] = useState(false);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showVPVR, setShowVPVR] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);
  const [showAutoSR, setShowAutoSR] = useState(false);
  const [showVWAP, setShowVWAP] = useState(false);
  
  const smaPeriod = 14;
  const emaPeriod = 9;

  // Sentiment & News Fetch
  useEffect(() => {
    let isMounted = true;
    fetch('https://api.alternative.me/fng/')
      .then(res => res.json())
      .then(json => { if (isMounted && json?.data?.length > 0) setFngData({ value: parseInt(json.data[0].value, 10), classification: json.data[0].value_classification }); })
      .catch(() => {});
      
    const rssUrl = encodeURIComponent('https://cointelegraph.com/rss');
    fetch(`https://api.rss2json.com/v1/api.json?rss_url=${rssUrl}`)
      .then(res => res.json())
      .then(json => {
        if (isMounted && json?.items) {
          setNewsData(json.items.slice(0, 8).map((item, i) => ({
            id: item.guid || String(i), url: item.link, title: item.title, source: 'CoinTelegraph', time: Math.floor(new Date(item.pubDate).getTime() / 1000)
          })));
        }
      })
      .catch(() => {});
      
    return () => { isMounted = false; };
  }, []);

  // Tickers Fetch
  useEffect(() => {
    let isMounted = true;
    const fetchTickers = async () => {
      try {
        const res = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT","SOLUSDT"]');
        if (!res.ok) return;
        const data = await res.json();
        if (isMounted && Array.isArray(data)) {
          const formatted = data.reduce((acc, curr) => {
            acc[curr.symbol] = { price: parseFloat(curr.lastPrice), change: parseFloat(curr.priceChangePercent), high: parseFloat(curr.highPrice), low: parseFloat(curr.lowPrice), vol: parseFloat(curr.volume) };
            return acc;
          }, {});
          setTickers(formatted);
        }
      } catch (err) {}
    };
    fetchTickers();
    const interval = setInterval(fetchTickers, 5000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  // Order Book & Trades Polling Fallback
  useEffect(() => {
    let isMounted = true;
    let fallbackInterval = setInterval(async () => {
      if (!isMounted) return;
      try {
        const depthRes = await fetch(`https://api.binance.com/api/v3/depth?symbol=${selectedPair}&limit=15`);
        if (depthRes.ok) {
          const depthData = await depthRes.json();
          const formatDepth = (arr) => arr.map(item => ({ price: parseFloat(item[0]), qty: parseFloat(item[1]) }));
          const bids = formatDepth(depthData.bids);
          const asks = formatDepth(depthData.asks).reverse(); // Reverse so highest ask is at top
          let bidsTotal = 0; let asksTotal = 0;
          const mappedBids = bids.map(b => { bidsTotal += b.qty; return { ...b, total: bidsTotal }; });
          const mappedAsks = asks.map(a => { asksTotal += a.qty; return { ...a, total: asksTotal }; });
          setOrderBook({ bids: mappedBids, asks: mappedAsks, maxVol: Math.max(bidsTotal, asksTotal) });
        }
        const tradeRes = await fetch(`https://api.binance.com/api/v3/trades?symbol=${selectedPair}&limit=20`);
        if (tradeRes.ok) {
          const tradeData = await tradeRes.json();
          const formattedTrades = tradeData.reverse().map(t => ({
            id: t.id, price: parseFloat(t.price), qty: parseFloat(t.qty), time: t.time, isSell: t.isBuyerMaker
          }));
          setRecentTrades(formattedTrades);
        }
      } catch (e) {}
    }, 2000);
    return () => { isMounted = false; clearInterval(fallbackInterval); };
  }, [selectedPair]);

  // Main Chart Data Polling
  useEffect(() => {
    let pollInterval = null;
    let isMounted = true;
    const tfConfig = TIMEFRAMES[selectedTimeframe];
    const fetchWithFallback = async (endpoint) => {
      const endpoints = ['https://api.binance.com', 'https://data-api.binance.vision'];
      for (let base of endpoints) { try { const res = await fetch(`${base}${endpoint}`); if (res.ok) return res; } catch (err) { } }
      throw new Error('API failed');
    };

    const fetchHistoricalAndStartPolling = async () => {
      try {
        setLoading(true);
        const res = await fetchWithFallback(`/api/v3/klines?symbol=${selectedPair}&interval=${tfConfig.interval}&limit=${tfConfig.limit}`);
        const json = await res.json();
        if (!isMounted) return;
        if (Array.isArray(json) && json.length > 0) {
          const historicalData = json.map(d => ({
            timestamp: d[0], time: formatTime(d[0], selectedTimeframe), open: parseFloat(d[1]) || 0, high: parseFloat(d[2]) || 0, low: parseFloat(d[3]) || 0, close: parseFloat(d[4]) || 0, price: parseFloat(d[4]) || 0, volume: parseFloat(d[5]) || 0, candleRange: [parseFloat(d[3]) || 0, parseFloat(d[2]) || 0]
          }));
          setData(historicalData);
          setWsStatus('connected');
        } else setData([]);
        setLoading(false);

        pollInterval = setInterval(async () => {
          try {
            const priceRes = await fetchWithFallback(`/api/v3/klines?symbol=${selectedPair}&interval=${tfConfig.interval}&limit=1`);
            const priceData = await priceRes.json();
            if (!isMounted || !Array.isArray(priceData) || priceData.length === 0) return;
            const latestKline = priceData[0];
            const klineStartTime = latestKline[0];
            setData(prevData => {
              if (!prevData || prevData.length === 0) return prevData;
              const lastPoint = prevData[prevData.length - 1];
              const newDataPoint = { timestamp: klineStartTime, time: formatTime(klineStartTime, selectedTimeframe), open: parseFloat(latestKline[1]) || 0, high: parseFloat(latestKline[2]) || 0, low: parseFloat(latestKline[3]) || 0, close: parseFloat(latestKline[4]) || 0, price: parseFloat(latestKline[4]) || 0, volume: parseFloat(latestKline[5]) || 0, candleRange: [parseFloat(latestKline[3]) || 0, parseFloat(latestKline[2]) || 0] };
              if (klineStartTime > lastPoint.timestamp) return [...prevData.slice(1), newDataPoint];
              else return [...prevData.slice(0, prevData.length - 1), newDataPoint];
            });
            setWsStatus('connected');
          } catch (pollError) { if (isMounted) setWsStatus('error'); }
        }, 3000); 
      } catch (error) { if (isMounted) { setLoading(false); setData([]); setWsStatus('error'); } }
    };
    fetchHistoricalAndStartPolling();
    return () => { isMounted = false; if (pollInterval) clearInterval(pollInterval); };
  }, [selectedPair, selectedTimeframe]);

  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    let processed = calculateHeikinAshi(data);
    processed = calculateSMA(processed, smaPeriod);
    processed = calculateEMA(processed, emaPeriod);
    processed = calculateBollingerBands(processed, 20);
    processed = calculateRSI(processed, 14);
    processed = calculateMACD(processed);
    processed = calculateVWAP(processed);
    return processed;
  }, [data, smaPeriod, emaPeriod]);

  const fibLevels = useMemo(() => {
    if (!showFib || !data || data.length === 0) return null;
    const prices = data.map(d => d.price || 0);
    if (prices.length === 0) return null;
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const diff = high - low;
    if (diff === 0 || !isFinite(diff)) return null;
    return { 0: high, 0.236: high - diff * 0.236, 0.382: high - diff * 0.382, 0.5: high - diff * 0.5, 0.618: high - diff * 0.618, 1: low };
  }, [data, showFib]);

  const autoSRLevels = useMemo(() => {
    if (!showAutoSR || !data || data.length === 0) return [];
    return calculateAutoSR(data);
  }, [data, showAutoSR]);

  const renderVPVR = useCallback((props) => {
    if (!showVPVR || !chartData || chartData.length === 0) return null;
    const { yAxisMap, offset } = props;
    const yAxis = yAxisMap?.price || yAxisMap?.[0] || Object.values(yAxisMap || {})[0];
    if (!yAxis || !yAxis.scale || !offset) return null;
    const yScale = yAxis.scale;
    const binsCount = 50;
    let minPrice = Math.min(...chartData.map(d => d.low !== undefined ? d.low : d.price));
    let maxPrice = Math.max(...chartData.map(d => d.high !== undefined ? d.high : d.price));
    if (minPrice === maxPrice || !isFinite(minPrice) || !isFinite(maxPrice)) return null;
    const binSize = (maxPrice - minPrice) / binsCount;
    const bins = Array.from({ length: binsCount }, (_, i) => ({
      top: minPrice + ((i + 1) * binSize), bottom: minPrice + (i * binSize), volume: 0, upVolume: 0, downVolume: 0
    }));
    chartData.forEach(d => {
      const typPrice = d.candleRange ? (d.candleRange[0] + d.candleRange[1] + (d.close || d.price)) / 3 : d.price;
      const vol = d.volume || 0;
      let idx = Math.floor((typPrice - minPrice) / binSize);
      if (idx >= binsCount) idx = binsCount - 1;
      if (idx < 0) idx = 0;
      bins[idx].volume += vol;
      const isUp = (d.close || d.price) >= (d.open || d.price);
      if (isUp) bins[idx].upVolume += vol;
      else bins[idx].downVolume += vol;
    });
    const maxVol = Math.max(...bins.map(b => b.volume));
    if (maxVol <= 0 || !isFinite(maxVol)) return null;
    const maxBarWidth = offset.width * 0.25; 
    const startX = offset.left + offset.width;

    return (
      <g className="vpvr-layer">
        {bins.map((bin, i) => {
          const y1 = yScale(bin.top);
          const y2 = yScale(bin.bottom);
          const topY = Math.min(y1, y2);
          const rectHeight = Math.max(Math.abs(y1 - y2) - 1, 1); 
          const totalWidth = (bin.volume / maxVol) * maxBarWidth;
          if (totalWidth <= 0 || !isFinite(totalWidth)) return null;
          const upWidth = bin.volume > 0 ? (bin.upVolume / bin.volume) * totalWidth : 0;
          const downWidth = bin.volume > 0 ? (bin.downVolume / bin.volume) * totalWidth : 0;
          return (
            <g key={`vpvr-${i}`}>
              <rect x={startX - totalWidth} y={topY} width={downWidth} height={rectHeight} fill={TV_COLORS.red} fillOpacity={0.4} />
              <rect x={startX - totalWidth + downWidth} y={topY} width={upWidth} height={rectHeight} fill={TV_COLORS.blue} fillOpacity={0.4} />
            </g>
          );
        })}
      </g>
    );
  }, [showVPVR, chartData]);

  const selectedTicker = tickers[selectedPair] || {};
  const currentPrice = chartData.length > 0 ? chartData[chartData.length - 1].price : 0;
  
  return (
    <div className="h-screen w-screen bg-[#131722] text-[#D1D4DC] flex flex-col overflow-hidden font-sans selection:bg-[#2962FF]/30">
      
      {/* 1. TOP HEADER (Navbar) */}
      <header className="h-14 border-b border-[#2A2E39] bg-[#1E222D] flex items-center justify-between px-4 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="bg-[#2962FF] p-1.5 rounded text-white"><TrendingUp size={20} strokeWidth={2.5} /></div>
          <span className="font-bold text-lg tracking-tight text-white hidden sm:block">Crypto<span className="text-[#2962FF]">Terminal</span></span>
        </div>
        
        {/* Ticker Overview */}
        <div className="flex items-center gap-6 text-sm">
          {Object.keys(COIN_CONFIG).map(pair => {
            const t = tickers[pair];
            if (!t) return null;
            const isUp = t.change >= 0;
            return (
              <div key={pair} className="hidden md:flex items-center gap-2 cursor-pointer hover:bg-[#2A2E39] px-2 py-1 rounded transition-colors" onClick={() => setSelectedPair(pair)}>
                <span className="font-bold" style={{color: selectedPair === pair ? TV_COLORS.blue : TV_COLORS.text}}>{COIN_CONFIG[pair].label}</span>
                <span className="font-mono">{formatNumber(t.price, 2, pair==='BTCUSDT'?2:4)}</span>
                <span className={isUp ? 'text-[#089981]' : 'text-[#F23645]'}>{isUp ? '▲' : '▼'}{Math.abs(t.change).toFixed(2)}%</span>
              </div>
            )
          })}
        </div>

        {/* Status */}
        <div className="flex items-center gap-3">
          {wsStatus === 'connected' ? (
             <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[#089981]/10 text-[#089981] text-[11px] font-bold tracking-wide">
               <div className="w-1.5 h-1.5 rounded-full bg-[#089981] animate-pulse"></div> LIVE
             </span>
          ) : (
             <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[#F7931A]/10 text-[#F7931A] text-[11px] font-bold tracking-wide">
               <Loader2 size={12} className="animate-spin" /> CONNECTING
             </span>
          )}
        </div>
      </header>

      {/* 2. MAIN LAYOUT (Flex-1) */}
      <div className="flex-1 flex min-h-0">
        
        {/* LEFT COLUMN: Chart + Sub-toolbar + Bottom News */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#131722] border-r border-[#2A2E39]">
          
          {/* Sub-toolbar (Chart Controls) */}
          <div className="h-12 border-b border-[#2A2E39] flex items-center px-4 gap-4 shrink-0 overflow-x-auto [&::-webkit-scrollbar]:hidden">
            <div className="flex bg-[#1E222D] rounded p-0.5">
              {Object.keys(COIN_CONFIG).map(coinKey => (
                <button key={coinKey} onClick={() => setSelectedPair(coinKey)} className={`px-3 py-1 rounded text-[13px] font-medium transition-colors ${selectedPair === coinKey ? 'bg-[#2A2E39] text-white' : 'text-[#787B86] hover:text-[#D1D4DC]'}`}>
                  {COIN_CONFIG[coinKey].label}
                </button>
              ))}
            </div>
            <div className="w-px h-5 bg-[#2A2E39]"></div>
            <div className="flex bg-[#1E222D] rounded p-0.5">
              {Object.keys(TIMEFRAMES).map(tfKey => (
                <button key={tfKey} onClick={() => setSelectedTimeframe(tfKey)} className={`px-2.5 py-1 rounded text-[13px] font-medium transition-colors ${selectedTimeframe === tfKey ? 'bg-[#2A2E39] text-[#2962FF]' : 'text-[#787B86] hover:text-[#D1D4DC]'}`}>
                  {TIMEFRAMES[tfKey].label}
                </button>
              ))}
            </div>
            <div className="w-px h-5 bg-[#2A2E39]"></div>
            <div className="flex bg-[#1E222D] rounded p-0.5">
              <button onClick={() => setChartType('line')} className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[13px] font-medium transition-colors ${chartType === 'line' ? 'bg-[#2A2E39] text-white' : 'text-[#787B86] hover:text-[#D1D4DC]'}`}>Line</button>
              <button onClick={() => setChartType('candle')} className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[13px] font-medium transition-colors ${chartType === 'candle' ? 'bg-[#2A2E39] text-white' : 'text-[#787B86] hover:text-[#D1D4DC]'}`}>Candles</button>
              <button onClick={() => setChartType('heikinAshi')} className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[13px] font-medium transition-colors ${chartType === 'heikinAshi' ? 'bg-[#2A2E39] text-[#2962FF]' : 'text-[#787B86] hover:text-[#D1D4DC]'}`}>Heikin Ashi</button>
            </div>
          </div>

          {/* Actual Chart Container */}
          <div className="flex-1 flex flex-col relative min-h-0">
            {loading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-[#787B86] z-20">
                <Loader2 className="w-10 h-10 animate-spin mb-4 text-[#2962FF]" />
                <p>Loading Chart Data...</p>
              </div>
            ) : (
              <>
                {/* Main Price Chart */}
                <div className="flex-1 w-full min-h-[250px] relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 15, right: 0, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2A2E39" vertical={false} />
                      <XAxis dataKey="time" stroke="#787B86" tick={showRSI || showMACD ? false : { fill: '#787B86', fontSize: 11 }} tickMargin={8} minTickGap={30} axisLine={{ stroke: '#2A2E39' }} tickLine={false} />
                      <YAxis yAxisId="price" domain={['auto', 'auto']} stroke="#787B86" tick={{ fill: '#787B86', fontSize: 11, fontFamily: 'monospace' }} tickFormatter={(val) => val.toLocaleString()} width={65} orientation="right" axisLine={false} tickLine={false} />
                      <YAxis yAxisId="volume" orientation="left" domain={[0, 'auto']} hide={true} />
                      
                      <Tooltip 
                        cursor={{ stroke: '#2A2E39', strokeWidth: 1, strokeDasharray: '4 4' }}
                        contentStyle={{ backgroundColor: '#1E222D', borderColor: '#2A2E39', color: '#D1D4DC', borderRadius: '4px', padding: '8px', fontSize: '13px' }}
                        itemStyle={{ color: '#D1D4DC', padding: '2px 0' }} labelStyle={{ color: '#787B86', marginBottom: '4px', fontSize: '12px' }}
                        formatter={(value, name, props) => {
                          if (name === 'Volume') return [Number(value || 0).toLocaleString(), name];
                          if (name === 'Candles' || name === 'candleRange') return [`O: ${formatNumber(props.payload.open)} H: ${formatNumber(props.payload.high)} L: ${formatNumber(props.payload.low)} C: ${formatNumber(props.payload.close)}`, 'OHLC'];
                          if (name === 'Heikin Ashi' || name === 'haCandleRange') return [`O: ${formatNumber(props.payload.haOpen)} H: ${formatNumber(props.payload.haHigh)} L: ${formatNumber(props.payload.haLow)} C: ${formatNumber(props.payload.haClose)}`, 'Heikin Ashi'];
                          if (name === 'RSI' || name === 'macdLine' || name === 'macdSignal' || name === 'macdHistPos' || name === 'macdHistNeg') return []; 
                          return [formatNumber(value), name];
                        }}
                      />
                      
                      {showFib && fibLevels && Object.entries(fibLevels).map(([key, val]) => (
                        <ReferenceLine key={key} yAxisId="price" y={val} stroke={TV_COLORS.blue} strokeDasharray="3 3" strokeOpacity={0.4} label={{ position: 'insideTopLeft', value: `${(Number(key)*100).toFixed(1)}%`, fill: TV_COLORS.blue, fontSize: 10 }} />
                      ))}
                      
                      {showAutoSR && autoSRLevels.map((lvl, idx) => (
                        <ReferenceLine key={`sr-${idx}`} yAxisId="price" y={lvl.price} stroke={lvl.type === 'support' ? TV_COLORS.green : TV_COLORS.red} strokeDasharray="3 3" strokeOpacity={0.6} label={{ position: lvl.type === 'support' ? 'insideBottomLeft' : 'insideTopLeft', value: `${lvl.type === 'support' ? 'Support' : 'Resistance'}`, fill: lvl.type === 'support' ? TV_COLORS.green : TV_COLORS.red, fontSize: 10 }} />
                      ))}

                      <Customized component={renderVPVR} />
                      {showVolume && <Bar yAxisId="volume" dataKey="volume" fill={TV_COLORS.blue} opacity={0.3} name="Volume" isAnimationActive={false} />}
                      
                      {showBollinger && (
                        <>
                          <Line yAxisId="price" type="monotone" dataKey="bbUpper" stroke="#787B86" strokeDasharray="3 3" dot={false} strokeWidth={1} name="BB Upper" isAnimationActive={false} />
                          <Line yAxisId="price" type="monotone" dataKey="bbLower" stroke="#787B86" strokeDasharray="3 3" dot={false} strokeWidth={1} name="BB Lower" isAnimationActive={false} />
                        </>
                      )}
                      
                      {showSMA && <Line yAxisId="price" type="monotone" dataKey="sma" stroke="#00BCD4" dot={false} strokeWidth={1.5} name={`SMA (${smaPeriod})`} isAnimationActive={false} />}
                      {showEMA && <Line yAxisId="price" type="monotone" dataKey="ema" stroke="#9C27B0" dot={false} strokeWidth={1.5} name={`EMA (${emaPeriod})`} isAnimationActive={false} />}
                      {showVWAP && <Line yAxisId="price" type="monotone" dataKey="vwap" stroke={TV_COLORS.red} strokeDasharray="5 5" dot={false} strokeWidth={1.5} name="VWAP" isAnimationActive={false} /> }
                      
                      {chartType === 'line' && <Line yAxisId="price" type="monotone" dataKey="price" stroke={TV_COLORS.blue} dot={false} strokeWidth={2} name="Price Action" isAnimationActive={false} />}
                      {chartType === 'candle' && <Bar yAxisId="price" dataKey="candleRange" shape={(props) => <CustomCandlestick {...props} />} name="Candles" isAnimationActive={false} />}
                      {chartType === 'heikinAshi' && <Bar yAxisId="price" dataKey="haCandleRange" shape={(props) => <CustomCandlestick {...props} isHeikinAshi={true} />} name="Heikin Ashi" isAnimationActive={false} />}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Subcharts: RSI */}
                {showRSI && (
                  <div className="w-full h-32 shrink-0 border-t border-[#2A2E39] pt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2A2E39" vertical={false} />
                        <XAxis dataKey="time" stroke="#787B86" tick={showMACD ? false : { fill: '#787B86', fontSize: 11 }} tickMargin={8} minTickGap={30} axisLine={false} tickLine={false} />
                        <YAxis domain={[0, 100]} stroke="#787B86" tick={{ fill: '#787B86', fontSize: 11, fontFamily: 'monospace' }} width={65} orientation="right" ticks={[30, 50, 70]} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ backgroundColor: '#1E222D', borderColor: '#2A2E39' }} labelStyle={{ display: 'none' }} itemStyle={{ color: '#9C27B0', fontSize: '12px' }} formatter={(value) => [Number(value).toFixed(2), 'RSI']} />
                        <ReferenceLine y={70} stroke={TV_COLORS.red} strokeDasharray="3 3" strokeOpacity={0.5} />
                        <ReferenceLine y={30} stroke={TV_COLORS.green} strokeDasharray="3 3" strokeOpacity={0.5} />
                        <Line type="monotone" dataKey="rsi" stroke="#9C27B0" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
                
                {/* Subcharts: MACD */}
                {showMACD && (
                  <div className="w-full h-32 shrink-0 border-t border-[#2A2E39] pt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2A2E39" vertical={false} />
                        <XAxis dataKey="time" stroke="#787B86" tick={{ fill: '#787B86', fontSize: 11 }} tickMargin={8} minTickGap={30} axisLine={false} tickLine={false} />
                        <YAxis domain={['auto', 'auto']} stroke="#787B86" tick={{ fill: '#787B86', fontSize: 11, fontFamily: 'monospace' }} width={65} orientation="right" axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ backgroundColor: '#1E222D', borderColor: '#2A2E39' }} labelStyle={{ display: 'none' }} formatter={(value, name) => [Number(value).toFixed(2), name.replace('macd', '')]} />
                        <Bar dataKey="macdHistPos" stackId="a" fill={TV_COLORS.green} isAnimationActive={false} />
                        <Bar dataKey="macdHistNeg" stackId="a" fill={TV_COLORS.red} isAnimationActive={false} />
                        <Line type="monotone" dataKey="macdLine" stroke={TV_COLORS.blue} dot={false} strokeWidth={1.5} isAnimationActive={false} />
                        <Line type="monotone" dataKey="macdSignal" stroke="#FF9800" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Bottom Pane: Market News horizontally scrolling */}
          <div className="h-44 border-t border-[#2A2E39] bg-[#1E222D] p-3 flex flex-col shrink-0">
            <h3 className="text-[13px] font-bold text-[#D1D4DC] flex items-center gap-2 mb-3 px-1">
              <Newspaper size={14} className="text-[#2962FF]" /> Top Headlines
            </h3>
            <div className="flex-1 flex gap-4 overflow-x-auto [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:bg-[#2A2E39] [&::-webkit-scrollbar-track]:bg-transparent pb-2">
              {newsData.length > 0 ? newsData.map(article => (
                <a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer" className="w-72 shrink-0 bg-[#131722] border border-[#2A2E39] rounded p-3 hover:border-[#787B86] transition-colors flex flex-col justify-between">
                  <div>
                    <div className="text-[10px] text-[#2962FF] font-bold uppercase tracking-wider mb-1.5">{article.source}</div>
                    <h4 className="text-[13px] text-[#D1D4DC] leading-snug line-clamp-2 hover:text-white transition-colors">{article.title}</h4>
                  </div>
                  <div className="text-[11px] text-[#787B86] flex items-center gap-1.5 mt-2">
                    <Clock size={12} /> {new Date(article.time * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                  </div>
                </a>
              )) : (
                <div className="text-[12px] text-[#787B86] px-1">Waiting for news feed...</div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Sidebar (Details, DOM, Trades, Settings) */}
        <aside className="w-80 lg:w-96 flex flex-col bg-[#1E222D] shrink-0 z-10 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-[#2A2E39]">
          
          {/* Section 1: Top Asset Header */}
          <div className="p-4 border-b border-[#2A2E39]">
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center gap-2">
                 <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white bg-[#2A2E39]">
                   {COIN_CONFIG[selectedPair]?.name.charAt(0)}
                 </div>
                 <div>
                   <h2 className="text-lg font-bold text-white leading-tight">{COIN_CONFIG[selectedPair]?.name}</h2>
                   <div className="text-[12px] text-[#787B86] leading-tight">{selectedPair}</div>
                 </div>
              </div>
              <div className="text-right">
                 <div className="text-xl font-mono font-bold text-white leading-tight">{formatNumber(currentPrice, 2, 2)}</div>
                 <div className={`text-[12px] font-bold ${selectedTicker.change >= 0 ? 'text-[#089981]' : 'text-[#F23645]'}`}>
                   {selectedTicker.change >= 0 ? '+' : ''}{selectedTicker.change?.toFixed(2)}%
                 </div>
              </div>
            </div>
            
            {/* Quick Sentiment Bar */}
            {fngData && (
              <div className="mt-3 bg-[#131722] rounded p-2 flex items-center justify-between border border-[#2A2E39]">
                <span className="text-[11px] font-bold text-[#787B86] uppercase">Sentiment</span>
                <div className="flex items-center gap-2">
                  <div className="text-[11px] font-bold" style={{color: fngData.value > 50 ? TV_COLORS.green : TV_COLORS.red}}>{fngData.classification} ({fngData.value})</div>
                  <div className="w-16 h-1.5 bg-[#2A2E39] rounded-full overflow-hidden">
                    <div className="h-full" style={{width: `${fngData.value}%`, backgroundColor: fngData.value > 50 ? TV_COLORS.green : TV_COLORS.red}}></div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Order Book (DOM) */}
          <div className="p-4 border-b border-[#2A2E39] flex flex-col h-72">
             <h3 className="text-[13px] font-bold text-[#D1D4DC] flex items-center gap-2 mb-3">
              <Layers size={14} className="text-[#787B86]" /> Order Book (DOM)
             </h3>
             <div className="flex-1 flex flex-col font-mono text-[11px] tabular-nums min-h-0">
                <div className="grid grid-cols-3 text-[#787B86] pb-1.5 mb-1 border-b border-[#2A2E39]">
                  <span className="text-left">Price</span>
                  <span className="text-right">Size</span>
                  <span className="text-right">Total</span>
                </div>
                {/* Asks */}
                <div className="flex flex-col-reverse justify-end flex-1 overflow-hidden">
                  {orderBook.asks.slice(0, 7).map((ask, i) => (
                    <div key={`ask-${i}`} className="grid grid-cols-3 relative py-[3px] z-10 hover:bg-[#2A2E39]/50 transition-colors">
                      <div className="absolute top-0 right-0 h-full bg-[#F23645]/15 z-0" style={{ width: `${(ask.total / orderBook.maxVol) * 100}%` }} />
                      <span className="text-[#F23645] z-10 text-left pl-1">{formatNumber(ask.price, 2, 2)}</span>
                      <span className="text-[#D1D4DC] z-10 text-right">{ask.qty.toFixed(3)}</span>
                      <span className="text-[#787B86] z-10 text-right pr-1">{ask.total.toFixed(3)}</span>
                    </div>
                  ))}
                </div>
                {/* Spread */}
                <div className="py-2 flex items-center justify-between text-[13px] font-bold bg-[#131722] px-2 rounded my-1 border border-[#2A2E39]">
                  <span style={{color: selectedTicker.change >= 0 ? TV_COLORS.green : TV_COLORS.red}}>{formatNumber(selectedTicker.price, 2, 2)}</span>
                  {selectedTicker.change >= 0 ? <TrendingUp size={14} color={TV_COLORS.green}/> : <TrendingDown size={14} color={TV_COLORS.red}/>}
                </div>
                {/* Bids */}
                <div className="flex flex-col flex-1 overflow-hidden">
                  {orderBook.bids.slice(0, 7).map((bid, i) => (
                    <div key={`bid-${i}`} className="grid grid-cols-3 relative py-[3px] z-10 hover:bg-[#2A2E39]/50 transition-colors">
                      <div className="absolute top-0 right-0 h-full bg-[#089981]/15 z-0" style={{ width: `${(bid.total / orderBook.maxVol) * 100}%` }} />
                      <span className="text-[#089981] z-10 text-left pl-1">{formatNumber(bid.price, 2, 2)}</span>
                      <span className="text-[#D1D4DC] z-10 text-right">{bid.qty.toFixed(3)}</span>
                      <span className="text-[#787B86] z-10 text-right pr-1">{bid.total.toFixed(3)}</span>
                    </div>
                  ))}
                </div>
             </div>
          </div>

          {/* Section 3: Recent Trades (Time & Sales) */}
          <div className="p-4 border-b border-[#2A2E39] flex flex-col h-48 shrink-0">
             <h3 className="text-[13px] font-bold text-[#D1D4DC] flex items-center gap-2 mb-3">
              <List size={14} className="text-[#787B86]" /> Recent Trades
             </h3>
             <div className="flex-1 flex flex-col font-mono text-[11px] tabular-nums min-h-0 bg-[#131722] border border-[#2A2E39] rounded">
                <div className="grid grid-cols-3 text-[#787B86] p-1.5 border-b border-[#2A2E39] bg-[#1E222D]">
                  <span className="text-left">Price</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Time</span>
                </div>
                <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden p-1">
                  {recentTrades.map(trade => (
                    <div key={trade.id} className="grid grid-cols-3 py-1 hover:bg-[#2A2E39]/30 px-1 rounded transition-colors">
                      <span className={`text-left font-bold ${trade.isSell ? 'text-[#F23645]' : 'text-[#089981]'}`}>{formatNumber(trade.price, 2, 2)}</span>
                      <span className="text-right text-[#D1D4DC]">{trade.qty.toFixed(4)}</span>
                      <span className="text-right text-[#787B86]">{new Date(trade.time).toLocaleTimeString([], {hour12:false})}</span>
                    </div>
                  ))}
                </div>
             </div>
          </div>

          {/* Section 4: Indicator Toggles */}
          <div className="p-4 flex-1">
             <h3 className="text-[13px] font-bold text-[#D1D4DC] flex items-center gap-2 mb-3">
              <Settings size={14} className="text-[#787B86]" /> Chart Studies
             </h3>
             <div className="space-y-0.5">
                <IndicatorRow label="VPVR" isPro checked={showVPVR} onChange={(e) => setShowVPVR(e.target.checked)} colorClass="bg-[#2962FF]" />
                <IndicatorRow label="VWAP" isPro checked={showVWAP} onChange={(e) => setShowVWAP(e.target.checked)} colorClass="bg-[#F23645]" />
                <IndicatorRow label="Auto S/R" isPro checked={showAutoSR} onChange={(e) => setShowAutoSR(e.target.checked)} colorClass="bg-[#089981]" />
                <div className="my-2 border-t border-[#2A2E39] mx-2"></div>
                <IndicatorRow label="SMA (14)" checked={showSMA} onChange={(e) => setShowSMA(e.target.checked)} colorClass="bg-[#00BCD4]" />
                <IndicatorRow label="EMA (9)" checked={showEMA} onChange={(e) => setShowEMA(e.target.checked)} colorClass="bg-[#9C27B0]" />
                <IndicatorRow label="Bollinger Bands (20)" checked={showBollinger} onChange={(e) => setShowBollinger(e.target.checked)} colorClass="bg-[#D1D4DC]" />
                <IndicatorRow label="Volume Overlay" checked={showVolume} onChange={(e) => setShowVolume(e.target.checked)} colorClass="bg-[#2962FF]" />
                <div className="my-2 border-t border-[#2A2E39] mx-2"></div>
                <IndicatorRow label="MACD (12,26,9) pane" checked={showMACD} onChange={(e) => setShowMACD(e.target.checked)} colorClass="bg-[#FF9800]" />
                <IndicatorRow label="RSI (14) pane" checked={showRSI} onChange={(e) => setShowRSI(e.target.checked)} colorClass="bg-[#9C27B0]" />
             </div>
          </div>

        </aside>
      </div>

    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <LiveCryptoDashboard />
    </ErrorBoundary>
  );
}