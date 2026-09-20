import React, { useState, useEffect, useMemo } from 'react';
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
  Layers,
  AlignEndHorizontal
} from 'lucide-react';

// --- Crash Catcher (Error Boundary) ---
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
        <div className="min-h-screen bg-slate-950 text-slate-200 p-10 flex flex-col items-center justify-center font-sans">
          <div className="bg-rose-950/30 p-8 rounded-xl border border-rose-500/50 max-w-2xl w-full shadow-2xl">
            <h1 className="text-2xl font-bold text-rose-400 mb-4 flex items-center gap-2">
              <Activity /> Dashboard Crash Prevented
            </h1>
            <p className="text-slate-300 mb-4">An indicator encountered invalid data before it could load. Here is the exact error:</p>
            <pre className="bg-slate-900 p-4 rounded text-sm text-rose-300 overflow-x-auto border border-slate-800 mb-6">
              {this.state.error && this.state.error.toString()}
            </pre>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded font-bold transition-colors shadow-lg"
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

// --- Custom Recharts Shapes & Formulas ---
const CustomCandlestick = (props) => {
  const { x, y, width, height, payload, isHeikinAshi } = props;
  
  if (!payload) return null;

  const o = isHeikinAshi ? payload.haOpen : payload.open;
  const c = isHeikinAshi ? payload.haClose : payload.close;
  const h = isHeikinAshi ? payload.haHigh : payload.high;
  const l = isHeikinAshi ? payload.haLow : payload.low;

  if (typeof o !== 'number') return null;
  if (!isFinite(x) || !isFinite(y) || !isFinite(width) || !isFinite(height)) return null;

  const isUp = c >= o;
  const color = isUp ? '#10b981' : '#ef4444'; 
  const range = h - l;
  
  if (range === 0 || !isFinite(range)) {
    return <line x1={x} y1={y} x2={x + width} y2={y} stroke={color} strokeWidth={2} />;
  }

  const ratio = height / range;
  const openY = y + (h - o) * ratio;
  const closeY = y + (h - c) * ratio;

  const topY = Math.min(openY, closeY);
  const bottomY = Math.max(openY, closeY);
  const bodyHeight = Math.max(bottomY - topY, 2); 

  return (
    <g>
      <line x1={x + width / 2} y1={y} x2={x + width / 2} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={x + width * 0.2} y={topY} width={width * 0.6} height={bodyHeight} fill={color} stroke={color} />
    </g>
  );
};

// --- Heikin Ashi Calculation ---
const calculateHeikinAshi = (data) => {
  if (!data || data.length === 0) return [];
  let prevHaOpen = data[0].open;
  let prevHaClose = data[0].close;

  return data.map((point, index) => {
    const haClose = (point.open + point.high + point.low + point.close) / 4;
    let haOpen;
    if (index === 0) {
      haOpen = (point.open + point.close) / 2;
    } else {
      haOpen = (prevHaOpen + prevHaClose) / 2;
    }
    const haHigh = Math.max(point.high, haOpen, haClose);
    const haLow = Math.min(point.low, haOpen, haClose);

    prevHaOpen = haOpen;
    prevHaClose = haClose;

    return {
      ...point,
      haOpen,
      haHigh,
      haLow,
      haClose,
      haCandleRange: [haLow, haHigh]
    };
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
  
  const withMacdLine = data.map((point, i) => ({
    ...point,
    macdLine: ema12[i] - ema26[i]
  }));

  const signalLine = calcGenericEMA(withMacdLine, 9, 'macdLine');

  return withMacdLine.map((point, i) => {
    const hist = point.macdLine - signalLine[i];
    return {
      ...point,
      macdSignal: signalLine[i],
      macdHistPos: hist >= 0 ? hist : 0,
      macdHistNeg: hist < 0 ? hist : 0,
    };
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
    return {
      ...point,
      bbUpper: sma + stdDev * multiplier,
      bbLower: sma - stdDev * multiplier
    };
  });
};

const calculateRSI = (data, period = 14) => {
  if (!data || data.length === 0) return [];
  let avgGain = 0;
  let avgLoss = 0;

  return data.map((point, index, arr) => {
    if (index === 0) return { ...point, rsi: null };
    
    const diff = (point.price || 0) - (arr[index - 1].price || 0);
    const gain = Math.max(0, diff);
    const loss = Math.max(0, -diff);

    if (index < period) {
      avgGain += gain;
      avgLoss += loss;
      return { ...point, rsi: null };
    } else if (index === period) {
      avgGain /= period;
      avgLoss /= period;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    const rs = avgGain / (avgLoss === 0 ? 1 : avgLoss);
    const rsi = 100 - (100 / (1 + rs));
    
    return { ...point, rsi };
  });
};

const calculateVWAP = (data) => {
  if (!data || data.length === 0) return [];
  let cumulativeVolume = 0;
  let cumulativePriceVolume = 0;

  return data.map((point) => {
    const high = point.high !== undefined ? point.high : point.price;
    const low = point.low !== undefined ? point.low : point.price;
    const close = point.close !== undefined ? point.close : point.price;
    const typicalPrice = (high + low + close) / 3;
    
    const volume = point.volume || 0;
    
    cumulativeVolume += volume;
    cumulativePriceVolume += typicalPrice * volume;
    
    const vwap = cumulativeVolume === 0 ? typicalPrice : cumulativePriceVolume / cumulativeVolume;
    
    return { ...point, vwap };
  });
};

const calculateAutoSR = (data) => {
  if (!data || data.length < 15) return [];
  const window = 5; 
  const levels = [];
  
  for (let i = window; i < data.length - window; i++) {
    let isHigh = true;
    let isLow = true;
    const currentHigh = data[i].high !== undefined ? data[i].high : data[i].price;
    const currentLow = data[i].low !== undefined ? data[i].low : data[i].price;

    for (let j = 1; j <= window; j++) {
      const bHigh = data[i-j].high !== undefined ? data[i-j].high : data[i-j].price;
      const aHigh = data[i+j].high !== undefined ? data[i+j].high : data[i+j].price;
      const bLow = data[i-j].low !== undefined ? data[i-j].low : data[i-j].price;
      const aLow = data[i+j].low !== undefined ? data[i+j].low : data[i+j].price;
      
      if (bHigh >= currentHigh || aHigh >= currentHigh) isHigh = false;
      if (bLow <= currentLow || aLow <= currentLow) isLow = false;
    }

    if (isHigh) levels.push({ price: currentHigh, type: 'resistance', strength: 1 });
    if (isLow) levels.push({ price: currentLow, type: 'support', strength: 1 });
  }

  const prices = data.map(d => d.price);
  const range = Math.max(...prices) - Math.min(...prices);
  const threshold = range * 0.02; 

  const clustered = [];
  levels.forEach(level => {
    const close = clustered.find(c => c.type === level.type && Math.abs(c.price - level.price) <= threshold);
    if (close) {
      close.price = (close.price * close.strength + level.price) / (close.strength + 1);
      close.strength += 1;
    } else {
      clustered.push({ ...level });
    }
  });

  return clustered.sort((a, b) => b.strength - a.strength).slice(0, 5);
};

const TIMEFRAMES = {
  'LIVE': { label: 'Live', interval: '1m', limit: 100 },
  '1M': { label: '1M', interval: '4h', limit: 180 },
  '6M': { label: '6M', interval: '1d', limit: 180 },
  '1Y': { label: '1Y', interval: '1d', limit: 365 },
  '5Y': { label: '5Y', interval: '1w', limit: 260 },
};

const COIN_CONFIG = {
  'BTCUSDT': { label: 'BTC', name: 'Bitcoin' },
  'ETHUSDT': { label: 'ETH', name: 'Ethereum' },
  'SOLUSDT': { label: 'SOL', name: 'Solana' }
};

const formatTime = (timestamp, tf) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (tf === 'LIVE') return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (tf === '1M') return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit' });
  if (tf === '5Y') return date.toLocaleDateString([], { year: 'numeric', month: 'short' });
  return date.toLocaleDateString([], { year: '2-digit', month: 'short', day: 'numeric' });
};

const getFngStyle = (value) => {
  if (!value || isNaN(value)) return { text: 'text-slate-500', bg: 'bg-slate-500' };
  if (value <= 25) return { text: 'text-rose-500', bg: 'bg-rose-500' };
  if (value <= 45) return { text: 'text-orange-400', bg: 'bg-orange-400' };
  if (value <= 55) return { text: 'text-yellow-400', bg: 'bg-yellow-400' };
  if (value <= 75) return { text: 'text-emerald-400', bg: 'bg-emerald-400' };
  return { text: 'text-emerald-500', bg: 'bg-emerald-500' }; 
};

const timeAgo = (unixTimestamp) => {
  if (!unixTimestamp) return 'Recently';
  const seconds = Math.floor(Date.now() / 1000 - unixTimestamp);
  if (isNaN(seconds) || seconds < 0) return 'Recently';
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + " years ago";
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + " months ago";
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + " days ago";
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + " hours ago";
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + " minutes ago";
  return Math.floor(seconds) + " seconds ago";
};

// --- Main Application Component ---
function LiveCryptoDashboard() {
  const [selectedPair, setSelectedPair] = useState('BTCUSDT');
  const [selectedTimeframe, setSelectedTimeframe] = useState('LIVE');
  const [chartType, setChartType] = useState('candle'); // 'line', 'candle', 'heikinAshi'
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wsStatus, setWsStatus] = useState('connecting'); 
  const [fngData, setFngData] = useState(null);
  const [newsData, setNewsData] = useState([]);
  const [newsLoading, setNewsLoading] = useState(true);
  
  const [recentTrades, setRecentTrades] = useState([]);
  const [orderBook, setOrderBook] = useState({ bids: [], asks: [], maxTotal: 0 }); 

  const [showSMA, setShowSMA] = useState(true);
  const [showEMA, setShowEMA] = useState(false);
  const [showFib, setShowFib] = useState(false);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showVPVR, setShowVPVR] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);
  const [showVWAP, setShowVWAP] = useState(false);
  const [showAutoSR, setShowAutoSR] = useState(false);
  
  const smaPeriod = 14;
  const emaPeriod = 9;

  useEffect(() => {
    let isMounted = true;
    const fetchFng = async () => {
      try {
        const res = await fetch('https://api.alternative.me/fng/');
        const json = await res.json();
        if (isMounted && json && json.data && json.data.length > 0) {
          setFngData({
            value: parseInt(json.data[0].value, 10),
            classification: json.data[0].value_classification
          });
        }
      } catch (err) {
        console.error("Failed to fetch Fear & Greed Index", err);
      }
    };
    fetchFng();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const fetchNews = async () => {
      try {
        const rssUrl = encodeURIComponent('https://cointelegraph.com/rss');
        const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${rssUrl}`);
        const json = await res.json();
        
        if (isMounted && json && json.items) {
          const formattedNews = json.items.slice(0, 6).map((item, index) => ({
            id: item.guid || String(index),
            url: item.link,
            title: item.title,
            source_info: { name: 'CoinTelegraph' },
            published_on: Math.floor(new Date(item.pubDate).getTime() / 1000)
          }));
          setNewsData(formattedNews);
          setNewsLoading(false);
        } else if (isMounted) {
           setNewsLoading(false);
        }
      } catch (err) {
        console.error("Failed to fetch Crypto News", err);
        if (isMounted) setNewsLoading(false);
      }
    };
    fetchNews();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    let isMounted = true;
    let tradeBuffer = []; 
    let ws = null;
    let renderInterval = null;
    let fallbackInterval = null;
    let isUsingFallback = false;

    const startRestFallback = () => {
      if (isUsingFallback || !isMounted) return;
      isUsingFallback = true;
      console.warn("WebSocket blocked. Falling back to REST API for trades.");
      
      if (renderInterval) clearInterval(renderInterval);
      
      fallbackInterval = setInterval(async () => {
        if (!isMounted) return;
        try {
          const res = await fetch(`https://api.binance.com/api/v3/trades?symbol=${selectedPair}&limit=15`);
          if (res.ok) {
            const json = await res.json();
            const formatted = json.reverse().map(t => ({
              id: t.id,
              price: parseFloat(t.price),
              qty: parseFloat(t.qty),
              time: t.time,
              isSell: t.isBuyerMaker
            }));
            setRecentTrades(formatted);
          }
        } catch (e) {
          // Ignore network errors
        }
      }, 3000);
    };

    try {
      ws = new WebSocket(`wss://stream.binance.com:9443/ws/${selectedPair.toLowerCase()}@trade`);
      setRecentTrades([]);
      
      ws.onerror = () => { startRestFallback(); };

      ws.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const trade = JSON.parse(event.data);
          if (!trade || !trade.p) return;

          tradeBuffer.unshift({
            id: trade.t || Date.now(),
            price: parseFloat(trade.p) || 0,
            qty: parseFloat(trade.q) || 0,
            time: trade.T || Date.now(),
            isSell: trade.m 
          });
          
          if (tradeBuffer.length > 30) tradeBuffer.length = 30;
        } catch (e) {
          console.error("Trade parsing error", e);
        }
      };

      renderInterval = setInterval(() => {
        if (tradeBuffer.length > 0) {
          setRecentTrades((prev) => {
            const combined = [...tradeBuffer, ...prev];
            tradeBuffer = []; 
            return combined.slice(0, 30); 
          });
        }
      }, 1000);

    } catch (error) {
      startRestFallback();
    }

    return () => {
      isMounted = false;
      if (ws) ws.close();
      if (renderInterval) clearInterval(renderInterval);
      if (fallbackInterval) clearInterval(fallbackInterval);
    };
  }, [selectedPair]);

  // Order Book Polling
  useEffect(() => {
    let isMounted = true;
    let interval = null;

    const fetchDepth = async () => {
      try {
        const res = await fetch(`https://api.binance.com/api/v3/depth?symbol=${selectedPair}&limit=10`);
        if (!res.ok) return;
        const data = await res.json();
        
        if (!isMounted) return;

        let cumulativeAsk = 0;
        const asks = data.asks.map(a => {
          const price = parseFloat(a[0]);
          const qty = parseFloat(a[1]);
          cumulativeAsk += qty;
          return { price, qty, total: cumulativeAsk };
        }).reverse(); 

        let cumulativeBid = 0;
        const bids = data.bids.map(b => {
          const price = parseFloat(b[0]);
          const qty = parseFloat(b[1]);
          cumulativeBid += qty;
          return { price, qty, total: cumulativeBid };
        });

        const maxTotal = Math.max(
          asks.length > 0 ? asks[0].total : 0, 
          bids.length > 0 ? bids[bids.length - 1].total : 0
        );

        setOrderBook({ asks, bids, maxTotal });
      } catch (err) {
        // Ignore network errors on polling
      }
    };

    fetchDepth(); 
    interval = setInterval(fetchDepth, 2000); 

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [selectedPair]);

  useEffect(() => {
    let pollInterval = null;
    let isMounted = true;
    const tfConfig = TIMEFRAMES[selectedTimeframe];

    const fetchWithFallback = async (endpoint) => {
      const endpoints = [
        'https://data-api.binance.vision', 
        'https://api.binance.com',         
        'https://api.binance.us'           
      ];
      
      for (let base of endpoints) {
        try {
          const res = await fetch(`${base}${endpoint}`);
          if (res.ok) return res;
        } catch (err) { }
      }
      throw new Error('NetworkError: All API fallback endpoints failed.');
    };

    const fetchHistoricalAndStartPolling = async () => {
      try {
        setLoading(true);
        const res = await fetchWithFallback(`/api/v3/klines?symbol=${selectedPair}&interval=${tfConfig.interval}&limit=${tfConfig.limit}`);
        const json = await res.json();
        
        if (!isMounted) return;

        if (Array.isArray(json) && json.length > 0) {
          const historicalData = json.map(d => ({
            timestamp: d[0],
            time: formatTime(d[0], selectedTimeframe),
            open: parseFloat(d[1]) || 0,
            high: parseFloat(d[2]) || 0,
            low: parseFloat(d[3]) || 0,
            close: parseFloat(d[4]) || 0,
            price: parseFloat(d[4]) || 0, 
            volume: parseFloat(d[5]) || 0, 
            candleRange: [parseFloat(d[3]) || 0, parseFloat(d[2]) || 0]
          }));
          
          setData(historicalData);
          setWsStatus('connected');
        } else {
          setData([]);
        }
        
        setLoading(false);

        pollInterval = setInterval(async () => {
          try {
            const priceRes = await fetchWithFallback(`/api/v3/klines?symbol=${selectedPair}&interval=${tfConfig.interval}&limit=1`);
            const priceData = await priceRes.json();
            
            if (!isMounted || !Array.isArray(priceData) || priceData.length === 0) return;

            const latestKline = priceData[0];
            const klineStartTime = latestKline[0];
            const currentOpen = parseFloat(latestKline[1]) || 0;
            const currentHigh = parseFloat(latestKline[2]) || 0;
            const currentLow = parseFloat(latestKline[3]) || 0;
            const currentClose = parseFloat(latestKline[4]) || 0;
            const currentVolume = parseFloat(latestKline[5]) || 0;

            setData(prevData => {
              if (!prevData || prevData.length === 0) return prevData;
              const lastPoint = prevData[prevData.length - 1];

              if (klineStartTime > lastPoint.timestamp) {
                const newPoint = {
                  timestamp: klineStartTime,
                  time: formatTime(klineStartTime, selectedTimeframe),
                  open: currentOpen,
                  high: currentHigh,
                  low: currentLow,
                  close: currentClose,
                  price: currentClose,
                  volume: currentVolume,
                  candleRange: [currentLow, currentHigh]
                };
                return [...prevData.slice(1), newPoint];
              } else {
                const updatedLastPoint = { 
                  ...lastPoint, 
                  open: currentOpen,
                  high: currentHigh,
                  low: currentLow,
                  close: currentClose,
                  price: currentClose, 
                  volume: currentVolume,
                  candleRange: [currentLow, currentHigh]
                };
                return [...prevData.slice(0, prevData.length - 1), updatedLastPoint];
              }
            });
            setWsStatus('connected');
          } catch (pollError) {
            console.error("Polling error:", pollError.message);
            if (isMounted) setWsStatus('error');
          }
        }, 3000); 

      } catch (error) {
        console.error("Failed to fetch initial data:", error.message);
        if (isMounted) {
          setLoading(false);
          setData([]); 
          setWsStatus('error');
        }
      }
    };

    fetchHistoricalAndStartPolling();

    return () => {
      isMounted = false;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [selectedPair, selectedTimeframe]);

  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    let processed = calculateHeikinAshi(data);
    processed = calculateSMA(processed, smaPeriod);
    processed = calculateEMA(processed, emaPeriod);
    processed = calculateVWAP(processed);
    processed = calculateBollingerBands(processed, 20);
    processed = calculateRSI(processed, 14);
    processed = calculateMACD(processed);
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

    return {
      0: high,
      0.236: high - diff * 0.236,
      0.382: high - diff * 0.382,
      0.5: high - diff * 0.5,
      0.618: high - diff * 0.618,
      1: low
    };
  }, [data, showFib]);

  const autoSRLevels = useMemo(() => {
    if (!showAutoSR || !data || data.length === 0) return [];
    return calculateAutoSR(data);
  }, [data, showAutoSR]);

  const renderVPVR = (props) => {
    if (!showVPVR || !chartData || chartData.length === 0) return null;
    const { yAxisMap, offset } = props;
    if (!yAxisMap || !yAxisMap.price || !offset) return null;

    const yScale = yAxisMap.price.scale;
    
    const binsCount = 50;
    let minPrice = Math.min(...chartData.map(d => d.low || d.price));
    let maxPrice = Math.max(...chartData.map(d => d.high || d.price));
    if (minPrice === maxPrice) return null;

    const binSize = (maxPrice - minPrice) / binsCount;
    const bins = Array.from({ length: binsCount }, (_, i) => ({
      top: minPrice + ((i + 1) * binSize),
      bottom: minPrice + (i * binSize),
      volume: 0,
      upVolume: 0,
      downVolume: 0
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
    if (maxVol === 0) return null;

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
          const upWidth = (bin.upVolume / bin.volume) * totalWidth || 0;
          const downWidth = (bin.downVolume / bin.volume) * totalWidth || 0;

          if (totalWidth === 0) return null;

          return (
            <g key={`vpvr-${i}`}>
              <rect x={startX - totalWidth} y={topY} width={downWidth} height={rectHeight} fill="#ef4444" fillOpacity={0.3} />
              <rect x={startX - totalWidth + downWidth} y={topY} width={upWidth} height={rectHeight} fill="#10b981" fillOpacity={0.3} />
            </g>
          );
        })}
      </g>
    );
  };

  const currentPrice = data && data.length > 0 ? (data[data.length - 1]?.price || 0) : 0;
  const previousPrice = data && data.length > 1 ? (data[data.length - 2]?.price || 0) : 0;
  const isPriceUp = currentPrice >= previousPrice;

  const numSubCharts = (showRSI ? 1 : 0) + (showMACD ? 1 : 0);
  const mainHeightClass = numSubCharts === 0 ? 'h-[600px]' : numSubCharts === 1 ? 'h-[450px]' : 'h-[350px]';
  const subHeightClass = numSubCharts === 2 ? 'h-[125px]' : 'h-[150px]';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-6 font-sans">
      <div className="max-w-7xl mx-auto">
        
        <header className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-2">
              <div className="flex bg-slate-900/80 rounded-lg p-1 border border-slate-700/50 shadow-inner">
                {Object.keys(COIN_CONFIG).map(coinKey => (
                  <button
                    key={coinKey}
                    onClick={() => setSelectedPair(coinKey)}
                    className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all duration-200 ${
                      selectedPair === coinKey 
                        ? 'bg-slate-700 text-white shadow-sm' 
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    {COIN_CONFIG[coinKey].label}
                  </button>
                ))}
              </div>

              <div className="flex bg-slate-900/80 rounded-lg p-1 border border-slate-700/50 shadow-inner">
                {Object.keys(TIMEFRAMES).map(tfKey => (
                  <button
                    key={tfKey}
                    onClick={() => setSelectedTimeframe(tfKey)}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all duration-200 ${
                      selectedTimeframe === tfKey 
                        ? 'bg-slate-700 text-white shadow-sm' 
                        : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {TIMEFRAMES[tfKey].label}
                  </button>
                ))}
              </div>

              <div className="flex bg-slate-900/80 rounded-lg p-1 border border-slate-700/50 shadow-inner">
                <button
                  onClick={() => setChartType('line')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all duration-200 ${
                    chartType === 'line' 
                      ? 'bg-slate-700 text-white shadow-sm' 
                      : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <TrendingUp size={14} /> Line
                </button>
                <button
                  onClick={() => setChartType('candle')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all duration-200 ${
                    chartType === 'candle' 
                      ? 'bg-slate-700 text-white shadow-sm' 
                      : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <BarChart2 size={14} /> Candles
                </button>
                <button
                  onClick={() => setChartType('heikinAshi')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all duration-200 ${
                    chartType === 'heikinAshi' 
                      ? 'bg-slate-700 text-white shadow-sm' 
                      : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <AlignEndHorizontal size={14} /> Heikin Ashi
                </button>
              </div>
            </div>
            <p className="text-slate-400 text-sm">Real-time market data & technical overlays</p>
          </div>
          
          <div className="text-left md:text-right">
            <div className={`text-3xl font-mono font-bold tracking-tight ${isPriceUp ? 'text-emerald-400' : 'text-rose-400'} flex items-center gap-2 justify-start md:justify-end transition-colors duration-300`}>
              ${currentPrice > 0 ? currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
            </div>
            <div className="text-sm text-slate-500 font-medium">Last Traded Price</div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
          
          <div className="lg:col-span-3 bg-slate-900 rounded-xl p-2 sm:p-4 shadow-xl border border-slate-800 relative flex flex-col transition-all duration-300">
            
            {loading ? (
              <div className="w-full h-[600px] flex flex-col items-center justify-center text-slate-500">
                <Loader2 className="w-10 h-10 animate-spin mb-4 text-blue-500" />
                <p>Fetching historical data...</p>
              </div>
            ) : data.length === 0 ? (
              <div className="w-full h-[600px] flex flex-col items-center justify-center text-rose-500">
                <WifiOff className="w-10 h-10 mb-4" />
                <p>Failed to load market data. Retrying...</p>
              </div>
            ) : (
              <>
                <div className={`w-full relative transition-all duration-300 ${mainHeightClass}`}>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03] z-0">
                    <span className="text-[10rem] font-bold tracking-tighter text-white">
                      {COIN_CONFIG[selectedPair]?.label}
                    </span>
                  </div>
                  
                  <ResponsiveContainer width="100%" height="100%" className="relative z-10">
                    <ComposedChart data={chartData} margin={{ top: 20, right: 10, left: 20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      
                      <XAxis 
                        dataKey="time" 
                        stroke="#e2e8f0" 
                        tick={numSubCharts === 0 ? { fill: '#e2e8f0', fontSize: 13, fontWeight: 600 } : false}
                        tickMargin={12}
                        minTickGap={30}
                        axisLine={{ stroke: '#334155' }}
                      />
                      
                      <YAxis 
                        yAxisId="price"
                        domain={['auto', 'auto']} 
                        stroke="#e2e8f0" 
                        tick={{ fill: '#e2e8f0', fontSize: 13, fontWeight: 600 }}
                        tickFormatter={(val) => `$${(val || 0).toLocaleString()}`}
                        width={80}
                        axisLine={{ stroke: '#334155' }}
                        tickLine={{ stroke: '#334155' }}
                      />

                      <YAxis yAxisId="volume" orientation="right" domain={[0, 'auto']} hide={true} />

                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc', borderRadius: '0.5rem', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.5)' }}
                        itemStyle={{ color: '#e2e8f0', fontSize: '14px', padding: '2px 0' }}
                        labelStyle={{ color: '#94a3b8', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}
                        formatter={(value, name, props) => {
                          if (name === 'Volume') return [Number(value || 0).toLocaleString(), name];
                          if (name === 'Candles' || name === 'candleRange') {
                            const p = props?.payload;
                            if (!p || p.open == null) return ['Loading...', 'OHLC'];
                            return [`O: ${p.open.toLocaleString()} | H: ${p.high.toLocaleString()} | L: ${p.low.toLocaleString()} | C: ${p.close.toLocaleString()}`, 'OHLC'];
                          }
                          if (name === 'Heikin Ashi' || name === 'haCandleRange') {
                            const p = props?.payload;
                            if (!p || p.haOpen == null) return ['Loading...', 'Heikin Ashi'];
                            return [`O: ${p.haOpen.toLocaleString(undefined, { maximumFractionDigits: 2 })} | H: ${p.haHigh.toLocaleString(undefined, { maximumFractionDigits: 2 })} | L: ${p.haLow.toLocaleString(undefined, { maximumFractionDigits: 2 })} | C: ${p.haClose.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, 'Heikin Ashi'];
                          }
                          if (name === 'RSI' || name === 'macdLine' || name === 'macdSignal' || name === 'macdHistPos' || name === 'macdHistNeg') return []; 
                          return [`$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, name];
                        }}
                      />
                      <Legend wrapperStyle={{ paddingTop: '15px' }} iconType="circle" />
                      
                      {showFib && fibLevels && (
                        <>
                          <ReferenceLine yAxisId="price" y={fibLevels[0]} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.6} label={{ position: 'insideTopLeft', value: '0.0%', fill: '#ef4444', fontSize: 11, fontWeight: 600 }} />
                          <ReferenceLine yAxisId="price" y={fibLevels[0.236]} stroke="#f97316" strokeDasharray="3 3" strokeOpacity={0.6} label={{ position: 'insideTopLeft', value: '23.6%', fill: '#f97316', fontSize: 11, fontWeight: 600 }} />
                          <ReferenceLine yAxisId="price" y={fibLevels[0.382]} stroke="#eab308" strokeDasharray="3 3" strokeOpacity={0.6} label={{ position: 'insideTopLeft', value: '38.2%', fill: '#eab308', fontSize: 11, fontWeight: 600 }} />
                          <ReferenceLine yAxisId="price" y={fibLevels[0.5]} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.6} label={{ position: 'insideTopLeft', value: '50.0%', fill: '#22c55e', fontSize: 11, fontWeight: 600 }} />
                          <ReferenceLine yAxisId="price" y={fibLevels[0.618]} stroke="#3b82f6" strokeDasharray="3 3" strokeOpacity={0.6} label={{ position: 'insideTopLeft', value: '61.8%', fill: '#3b82f6', fontSize: 11, fontWeight: 600 }} />
                          <ReferenceLine yAxisId="price" y={fibLevels[1]} stroke="#a855f7" strokeDasharray="3 3" strokeOpacity={0.6} label={{ position: 'insideTopLeft', value: '100.0%', fill: '#a855f7', fontSize: 11, fontWeight: 600 }} />
                        </>
                      )}

                      {showAutoSR && autoSRLevels && autoSRLevels.map((level, i) => (
                        <ReferenceLine 
                          key={`sr-${i}`} 
                          yAxisId="price" 
                          y={level.price} 
                          stroke={level.type === 'support' ? '#22c55e' : '#ef4444'} 
                          strokeDasharray="4 4" 
                          strokeOpacity={0.7} 
                          strokeWidth={2}
                          label={{ 
                            position: 'insideTopLeft', 
                            value: `${level.type === 'support' ? 'Support' : 'Resistance'} ($${level.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`, 
                            fill: level.type === 'support' ? '#22c55e' : '#ef4444', 
                            fontSize: 11, 
                            fontWeight: 600 
                          }} 
                        />
                      ))}

                      <Customized component={renderVPVR} />

                      {showVolume && (
                        <Bar yAxisId="volume" dataKey="volume" fill="#3b82f6" opacity={0.4} name="Volume" isAnimationActive={false} />
                      )}

                      {showBollinger && (
                        <>
                          <Line yAxisId="price" type="monotone" dataKey="bbUpper" stroke="#64748b" strokeDasharray="3 3" dot={false} strokeWidth={1} name="BB Upper" isAnimationActive={false} />
                          <Line yAxisId="price" type="monotone" dataKey="bbLower" stroke="#64748b" strokeDasharray="3 3" dot={false} strokeWidth={1} name="BB Lower" isAnimationActive={false} />
                        </>
                      )}

                      {showSMA && (
                        <Line yAxisId="price" type="monotone" dataKey="sma" stroke="#06b6d4" dot={false} strokeWidth={2} name={`SMA (${smaPeriod})`} isAnimationActive={false} />
                      )}
                      {showEMA && (
                        <Line yAxisId="price" type="monotone" dataKey="ema" stroke="#8b5cf6" dot={false} strokeWidth={2} name={`EMA (${emaPeriod})`} isAnimationActive={false} />
                      )}
                      {showVWAP && (
                        <Line yAxisId="price" type="monotone" dataKey="vwap" stroke="#f43f5e" strokeDasharray="5 5" dot={false} strokeWidth={2.5} name="VWAP" isAnimationActive={false} />
                      )}
                      
                      {chartType === 'line' && (
                        <Line yAxisId="price" type="monotone" dataKey="price" stroke="#fbbf24" dot={false} strokeWidth={2.5} name="Price Action" isAnimationActive={false} />
                      )}
                      
                      {chartType === 'candle' && (
                        <Bar yAxisId="price" dataKey="candleRange" shape={(props) => <CustomCandlestick {...props} />} name="Candles" isAnimationActive={false} />
                      )}

                      {chartType === 'heikinAshi' && (
                        <Bar yAxisId="price" dataKey="haCandleRange" shape={(props) => <CustomCandlestick {...props} isHeikinAshi={true} />} name="Heikin Ashi" isAnimationActive={false} />
                      )}

                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {showRSI && (
                  <div className={`w-full ${subHeightClass} relative mt-2 border-t border-slate-800 pt-3 transition-all duration-300`}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                        <XAxis dataKey="time" stroke="#e2e8f0" tick={showMACD ? false : { fill: '#e2e8f0', fontSize: 13, fontWeight: 600 }} tickMargin={12} minTickGap={30} axisLine={{ stroke: '#334155' }} />
                        <YAxis domain={[0, 100]} stroke="#e2e8f0" tick={{ fill: '#e2e8f0', fontSize: 12, fontWeight: 600 }} width={80} ticks={[30, 50, 70]} axisLine={{ stroke: '#334155' }} tickLine={{ stroke: '#334155' }} />
                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc', borderRadius: '0.5rem', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.5)' }} itemStyle={{ color: '#d946ef', fontSize: '14px', fontWeight: 'bold' }} labelStyle={{ display: 'none' }} formatter={(value, name) => { if (name === 'rsi') return [Number(value).toFixed(2), 'RSI']; return []; }} />
                        <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.6} />
                        <ReferenceLine y={30} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.6} />
                        <Line type="monotone" dataKey="rsi" stroke="#d946ef" dot={false} strokeWidth={2} name="rsi" isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {showMACD && (
                  <div className={`w-full ${subHeightClass} relative mt-2 border-t border-slate-800 pt-3 transition-all duration-300`}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                        <XAxis dataKey="time" stroke="#e2e8f0" tick={{ fill: '#e2e8f0', fontSize: 13, fontWeight: 600 }} tickMargin={12} minTickGap={30} axisLine={{ stroke: '#334155' }} />
                        <YAxis domain={['auto', 'auto']} stroke="#e2e8f0" tick={{ fill: '#e2e8f0', fontSize: 12, fontWeight: 600 }} width={80} axisLine={{ stroke: '#334155' }} tickLine={{ stroke: '#334155' }} />
                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc', borderRadius: '0.5rem', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.5)' }} labelStyle={{ display: 'none' }} formatter={(value, name) => { if (name === 'macdLine') return [Number(value).toFixed(2), 'MACD']; if (name === 'macdSignal') return [Number(value).toFixed(2), 'Signal']; if (name === 'macdHistPos' || name === 'macdHistNeg') return [Number(value).toFixed(2), 'Histogram']; return []; }} />
                        <Bar dataKey="macdHistPos" stackId="a" fill="#10b981" isAnimationActive={false} name="macdHistPos" />
                        <Bar dataKey="macdHistNeg" stackId="a" fill="#ef4444" isAnimationActive={false} name="macdHistNeg" />
                        <Line type="monotone" dataKey="macdLine" stroke="#3b82f6" dot={false} strokeWidth={1.5} name="macdLine" isAnimationActive={false} />
                        <Line type="monotone" dataKey="macdSignal" stroke="#f97316" dot={false} strokeWidth={1.5} name="macdSignal" isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="bg-slate-900 rounded-xl p-5 shadow-xl border border-slate-800 h-fit flex flex-col gap-6">
            <div>
              <h2 className="text-lg font-semibold mb-4 text-slate-100 flex items-center gap-2">
                <Activity size={18} className="text-blue-500" />
                Indicators
              </h2>
              
              <div className="space-y-4">
                
                <label className="flex items-center space-x-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center">
                    <input type="checkbox" checked={showVPVR} onChange={(e) => setShowVPVR(e.target.checked)} className="peer sr-only" />
                    <div className="w-10 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)] peer-checked:shadow-amber-500/50"></div>
                  </div>
                  <span className="text-amber-400 group-hover:text-amber-300 transition-colors text-sm font-bold flex items-center gap-1.5">VPVR (Pro)</span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center">
                    <input type="checkbox" checked={showVWAP} onChange={(e) => setShowVWAP(e.target.checked)} className="peer sr-only" />
                    <div className="w-10 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)] peer-checked:shadow-rose-500/50"></div>
                  </div>
                  <span className="text-rose-400 group-hover:text-rose-300 transition-colors text-sm font-bold flex items-center gap-1.5">VWAP (Pro)</span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center">
                    <input type="checkbox" checked={showAutoSR} onChange={(e) => setShowAutoSR(e.target.checked)} className="peer sr-only" />
                    <div className="w-10 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] peer-checked:shadow-emerald-500/50"></div>
                  </div>
                  <span className="text-emerald-400 group-hover:text-emerald-300 transition-colors text-sm font-bold flex items-center gap-1.5">Auto S/R (Pro)</span>
                </label>

                <hr className="border-slate-800 my-2" />

                <label className="flex items-center space-x-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center">
                    <input type="checkbox" checked={showSMA} onChange={(e) => setShowSMA(e.target.checked)} className="peer sr-only" />
                    <div className="w-10 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
                  </div>
                  <span className="text-slate-300 group-hover:text-white transition-colors text-sm font-medium">SMA (14)</span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center">
                    <input type="checkbox" checked={showEMA} onChange={(e) => setShowEMA(e.target.checked)} className="peer sr-only" />
                    <div className="w-10 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-500"></div>
                  </div>
                  <span className="text-slate-300 group-hover:text-white transition-colors text-sm font-medium">EMA (9)</span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center">
                    <input type="checkbox" checked={showRSI} onChange={(e) => setShowRSI(e.target.checked)} className="peer sr-only" />
                    <div className="w-10 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-fuchsia-500"></div>
                  </div>
                  <span className="text-slate-300 group-hover:text-white transition-colors text-sm font-medium">RSI (14)</span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center">
                    <input type="checkbox" checked={showMACD} onChange={(e) => setShowMACD(e.target.checked)} className="peer sr-only" />
                    <div className="w-10 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500"></div>
                  </div>
                  <span className="text-slate-300 group-hover:text-white transition-colors text-sm font-medium">MACD (12,26,9)</span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center">
                    <input type="checkbox" checked={showFib} onChange={(e) => setShowFib(e.target.checked)} className="peer sr-only" />
                    <div className="w-10 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"></div>
                  </div>
                  <span className="text-slate-300 group-hover:text-white transition-colors text-sm font-medium">Fibonacci Levels</span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center">
                    <input type="checkbox" checked={showBollinger} onChange={(e) => setShowBollinger(e.target.checked)} className="peer sr-only" />
                    <div className="w-10 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-slate-400"></div>
                  </div>
                  <span className="text-slate-300 group-hover:text-white transition-colors text-sm font-medium">Bollinger Bands (20)</span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center">
                    <input type="checkbox" checked={showVolume} onChange={(e) => setShowVolume(e.target.checked)} className="peer sr-only" />
                    <div className="w-10 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"></div>
                  </div>
                  <span className="text-slate-300 group-hover:text-white transition-colors text-sm font-medium">Volume Overlay</span>
                </label>
              </div>
            </div>
            
            <hr className="border-slate-800" />

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Connection Status</h3>
              <div className="p-3 bg-slate-950/50 rounded-lg border border-slate-800/80 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-300 flex items-center gap-2">
                  {wsStatus === 'connected' ? <Wifi size={16} className="text-emerald-500" /> : <WifiOff size={16} className="text-rose-500" />}
                  API Polling
                </span>
                
                <div className="flex items-center">
                  {wsStatus === 'connected' && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 text-xs font-bold tracking-wide">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                      LIVE
                    </span>
                  )}
                  {wsStatus === 'connecting' && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-amber-500/10 text-amber-400 text-xs font-bold tracking-wide">
                      <Loader2 size={12} className="animate-spin" />
                      CONNECTING
                    </span>
                  )}
                  {(wsStatus === 'error' || wsStatus === 'disconnected') && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-rose-500/10 text-rose-400 text-xs font-bold tracking-wide">
                      <span className="h-2 w-2 rounded-full bg-rose-500"></span>
                      OFFLINE
                    </span>
                  )}
                </div>
              </div>
            </div>

            <hr className="border-slate-800" />

            {/* Depth of Market (DOM) / Order Book */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                <Layers size={16} className="text-cyan-400" /> Order Book
              </h3>
              
              <div className="bg-slate-950/50 rounded-lg border border-slate-800/80 overflow-hidden flex flex-col">
                {/* Header Grid */}
                <div className="grid grid-cols-3 text-[10px] uppercase font-bold text-slate-500 p-2 border-b border-slate-800/80 bg-slate-900/50">
                  <span className="text-left">Price</span>
                  <span className="text-right">Size</span>
                  <span className="text-right">Total</span>
                </div>
                
                <div className="flex flex-col text-xs font-mono tabular-nums">
                  {/* Sells (Asks) */}
                  <div className="flex flex-col">
                    {orderBook.asks.length === 0 ? (
                      <div className="text-center py-4 text-slate-500 text-xs">Loading Asks...</div>
                    ) : (
                      orderBook.asks.map((ask, i) => (
                        <div key={`ask-${i}`} className="relative grid grid-cols-3 px-2 py-1 hover:bg-slate-800/80 transition-colors cursor-pointer group items-center">
                          {/* Background Volume Bar */}
                          <div className="absolute top-0 right-0 h-full bg-rose-500/20 transition-all duration-300 z-0" style={{ width: `${(ask.total / orderBook.maxTotal) * 100}%` }}></div>
                          <span className="text-left font-semibold text-rose-400 z-10 relative">{ask.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          <span className="text-right text-slate-200 z-10 relative">{ask.qty.toFixed(3)}</span>
                          <span className="text-right text-slate-400 z-10 relative">{ask.total.toFixed(3)}</span>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Market Spread / Current Price Divider */}
                  <div className="flex items-center justify-center py-2 bg-slate-800/60 border-y border-slate-700 my-0.5 shadow-inner">
                    <span className={`text-sm font-bold tracking-wider ${isPriceUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                      ${currentPrice > 0 ? currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                    </span>
                  </div>

                  {/* Buys (Bids) */}
                  <div className="flex flex-col">
                    {orderBook.bids.length === 0 ? (
                      <div className="text-center py-4 text-slate-500 text-xs">Loading Bids...</div>
                    ) : (
                      orderBook.bids.map((bid, i) => (
                        <div key={`bid-${i}`} className="relative grid grid-cols-3 px-2 py-1 hover:bg-slate-800/80 transition-colors cursor-pointer group items-center">
                          {/* Background Volume Bar */}
                          <div className="absolute top-0 right-0 h-full bg-emerald-500/20 transition-all duration-300 z-0" style={{ width: `${(bid.total / orderBook.maxTotal) * 100}%` }}></div>
                          <span className="text-left font-semibold text-emerald-400 z-10 relative">{bid.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          <span className="text-right text-slate-200 z-10 relative">{bid.qty.toFixed(3)}</span>
                          <span className="text-right text-slate-400 z-10 relative">{bid.total.toFixed(3)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            <hr className="border-slate-800" />

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                <List size={16} className="text-purple-400" /> Recent Trades (Live)
              </h3>
              
              <div className="bg-slate-950/50 rounded-lg border border-slate-800/80 overflow-hidden flex flex-col">
                <div className="grid grid-cols-3 text-[10px] uppercase font-bold text-slate-500 p-2 border-b border-slate-800/80 bg-slate-900/50">
                  <span className="text-left">Price</span>
                  <span className="text-right">Amount</span>
                  <span className="text-right">Time</span>
                </div>
                
                <div className="flex flex-col h-48 overflow-y-auto [&::-webkit-scrollbar]:hidden">
                  {recentTrades.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-slate-500 text-xs py-10">
                      <Loader2 size={14} className="animate-spin mr-2" /> Waiting for trades...
                    </div>
                  ) : (
                    recentTrades.map((trade) => (
                      <div key={trade.id} className="grid grid-cols-3 text-xs font-mono tabular-nums px-2 py-1.5 border-b border-slate-800/40 hover:bg-slate-800/50 transition-colors">
                        <span className={`text-left font-semibold ${trade.isSell ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {trade.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className="text-right text-slate-200">
                          {trade.qty.toFixed(3)}
                        </span>
                        <span className="text-right text-slate-400">
                          {new Date(trade.time).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <hr className="border-slate-800" />

            {fngData && (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                  <Gauge size={16} className="text-indigo-400" /> Market Sentiment
                </h3>
                <div className="p-4 bg-slate-950/50 rounded-lg border border-slate-800/80 flex flex-col items-center justify-center">
                  <div className="text-4xl font-bold font-mono text-slate-200">
                    {fngData.value}
                  </div>
                  <div className={`text-xs font-bold uppercase mt-1 tracking-wider ${getFngStyle(fngData.value).text}`}>
                    {fngData.classification}
                  </div>
                  
                  <div className="w-full h-2 bg-slate-800 rounded-full mt-4 overflow-hidden relative">
                    <div className={`absolute top-0 left-0 h-full transition-all duration-1000 ${getFngStyle(fngData.value).bg}`} style={{ width: `${fngData.value}%` }} />
                  </div>
                  <div className="w-full flex justify-between text-[10px] text-slate-500 font-bold mt-1 uppercase">
                    <span>Fear</span>
                    <span>Greed</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-900 rounded-xl p-5 shadow-xl border border-slate-800">
          <h2 className="text-xl font-semibold mb-6 text-slate-100 flex items-center gap-2">
            <Newspaper className="text-blue-500" /> 
            Latest Market News
          </h2>
          
          {newsLoading ? (
            <div className="w-full h-32 flex flex-col items-center justify-center text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin mb-3 text-blue-500" />
              <p className="text-sm">Fetching headlines...</p>
            </div>
          ) : newsData.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {newsData.map((article) => (
                <a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer" className="bg-slate-950/50 rounded-lg p-4 border border-slate-800/80 hover:border-slate-600 transition-all duration-200 group flex flex-col justify-between h-full">
                  <div>
                    <div className="flex justify-between items-start mb-3 gap-2">
                      <span className="text-xs font-bold text-blue-400 bg-blue-400/10 px-2 py-1 rounded">
                        {article.source_info?.name || 'News'}
                      </span>
                      <ExternalLink size={14} className="text-slate-500 group-hover:text-blue-400 transition-colors" />
                    </div>
                    <h3 className="text-slate-200 font-medium text-sm leading-snug mb-3 group-hover:text-blue-300 transition-colors line-clamp-3">
                      {article.title}
                    </h3>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-2">
                    <Clock size={12} />
                    {timeAgo(article.published_on)}
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="w-full text-center py-6 text-slate-500 text-sm">
              Unable to load recent news.
            </div>
          )}
        </div>

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