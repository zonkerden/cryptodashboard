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
  BarChart
} from 'recharts';
import { 
  Activity, 
  Wifi, 
  WifiOff, 
  Loader2, 
  TrendingUp, 
  TrendingDown,
  Crosshair,
  Database,
  RefreshCw,
  PieChart,
  Magnet
} from 'lucide-react';

// Safe Candlestick Graphic
const CustomCandlestick = (props) => {
  const { x, y, width, height, payload } = props;
  if (!payload) return null;
  
  const isBull = payload.close >= payload.open;
  const color = isBull ? '#10b981' : '#f43f5e';
  const h = payload.high; 
  const l = payload.low; 
  const o = payload.open; 
  const c = payload.close;
  const range = h - l;
  
  if (range === 0 || !isFinite(range)) {
    return <line x1={x} y1={y} x2={x+width} y2={y} stroke={color}/>;
  }
  
  const r = height / range;
  const ty = Math.min(y + (h - o)*r, y + (h - c)*r);
  const by = Math.max(y + (h - o)*r, y + (h - c)*r);
  
  return (
    <g>
      <line x1={x+width/2} y1={y} x2={x+width/2} y2={y+height} stroke={color} />
      <rect x={x+width*0.2} y={ty} width={width*0.6} height={Math.max(by-ty, 2)} fill={color} stroke={color}/>
    </g>
  );
};

const calculateSMA = (data, period) => {
  return data.map((point, index, arr) => {
    if (index < period - 1) return { ...point, sma: null };
    let sum = 0;
    for(let i = index - period + 1; i <= index; i++) sum += arr[i].price;
    return { ...point, sma: sum / period };
  });
};

const calculateVWAP = (data) => {
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  return data.map((point) => {
    const typicalPrice = (point.high + point.low + point.close) / 3;
    const vol = point.volume || 0;
    cumulativeTPV += typicalPrice * vol;
    cumulativeVolume += vol;
    return {
      ...point,
      vwap: cumulativeVolume === 0 ? point.price : cumulativeTPV / cumulativeVolume
    };
  });
};

const calculateAutoSR = (data) => {
  if (!data || data.length < 20) return { support: null, resistance: null };
  let highs = [];
  let lows = [];
  for(let i = 2; i < data.length - 2; i++) {
    if (data[i].high > data[i-1].high && data[i].high > data[i-2].high && data[i].high > data[i+1].high && data[i].high > data[i+2].high) {
      highs.push(data[i].high);
    }
    if (data[i].low < data[i-1].low && data[i].low < data[i-2].low && data[i].low < data[i+1].low && data[i].low < data[i+2].low) {
      lows.push(data[i].low);
    }
  }
  const currentPrice = data[data.length - 1].price;
  const supports = lows.filter(l => l < currentPrice).sort((a,b) => b - a);
  const resistances = highs.filter(h => h > currentPrice).sort((a,b) => a - b);
  
  return {
    support: supports.length > 0 ? supports[0] : null,
    resistance: resistances.length > 0 ? resistances[0] : null
  };
};

const TIMEFRAMES = {
  '1m': { label: '1m', interval: '1m', limit: 150 },
  '5m': { label: '5m', interval: '5m', limit: 150 },
  '15m': { label: '15m', interval: '15m', limit: 150 },
  '1H': { label: '1H', interval: '1h', limit: 150 }
};

const COIN_CONFIG = {
  'BTCUSDT': { label: 'BTC', name: 'Bitcoin' },
  'ETHUSDT': { label: 'ETH', name: 'Ethereum' },
  'SOLUSDT': { label: 'SOL', name: 'Solana' }
};

const formatTime = (timestamp, tf) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default function OrderFlowDashboard() {
  const [selectedPair, setSelectedPair] = useState('BTCUSDT');
  const [selectedTimeframe, setSelectedTimeframe] = useState('5m');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [wsStatus, setWsStatus] = useState('connecting');
  const [activeEndpoint, setActiveEndpoint] = useState('');
  
  const [orderFlowMetrics, setOrderFlowMetrics] = useState({
    delta: 0, cvd: 0, buyVol: 0, sellVol: 0, bidVol: 0, askVol: 0
  });

  // NEW: Options Data State
  const [optionsData, setOptionsData] = useState({
    pcr: 0, callOi: 0, putOi: 0, maxPain: null, bias: 'Neutral'
  });

  const [showIndicators, setShowIndicators] = useState({
    vpvr: true, sma: true, vwap: true, sr: true, maxPain: true
  });

  // --- Deribit Options Flow Poller ---
  useEffect(() => {
    let isMounted = true;
    const fetchOptionsFlow = async () => {
      try {
        const currency = selectedPair.replace('USDT', '');
        const res = await fetch(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`);
        const json = await res.json();
        
        if (!isMounted || !json.result) return;

        let callOi = 0;
        let putOi = 0;
        const strikeOi = {}; 

        json.result.forEach(item => {
          const nameParts = item.instrument_name.split('-');
          if (nameParts.length === 4) {
            const strike = parseFloat(nameParts[2]);
            const type = nameParts[3]; 
            const oi = item.open_interest || 0;

            if (type === 'C') callOi += oi;
            if (type === 'P') putOi += oi;

            if (!strikeOi[strike]) strikeOi[strike] = 0;
            strikeOi[strike] += oi;
          }
        });

        const pcr = callOi > 0 ? putOi / callOi : 0;
        
        let maxPain = null;
        let maxOi = 0;
        for (let strike in strikeOi) {
          if (strikeOi[strike] > maxOi) {
            maxOi = strikeOi[strike];
            maxPain = parseFloat(strike);
          }
        }

        // Bullish if calls outnumber puts heavily (< 0.8)
        // Bearish if puts outnumber calls heavily (> 1.2)
        let bias = 'Neutral';
        if (pcr < 0.85) bias = 'Bullish';
        if (pcr > 1.15) bias = 'Bearish';

        setOptionsData({ pcr, callOi, putOi, maxPain, bias });

      } catch (e) {
        console.warn("Deribit API blocked or unavailable.");
      }
    };

    fetchOptionsFlow();
    const interval = setInterval(fetchOptionsFlow, 300000); // Update every 5 mins
    return () => { isMounted = false; clearInterval(interval); };
  }, [selectedPair]);

  // --- Binance WebSockets / Fallback ---
  useEffect(() => {
    let isMounted = true;
    let sockets = []; 
    let fallbackInterval = null;
    let workingRestBase = '';
    let lastTradeId = 0;

    setOrderFlowMetrics({ delta: 0, cvd: 0, buyVol: 0, sellVol: 0, bidVol: 0, askVol: 0 });

    const REST_ENDPOINTS = [
      'https://api.binance.info',       
      'https://data-api.binance.vision',
      'https://api.binance.com'        
    ];

    const WS_ENDPOINTS = [
      'wss://stream.binance.info:9443',
      'wss://data-stream.binance.vision',
      'wss://stream.binance.com:9443'
    ];

    const fetchInitialData = async () => {
      setLoading(true);
      setWsStatus('connecting');
      const tf = TIMEFRAMES[selectedTimeframe];
      let successData = null;

      for (let base of REST_ENDPOINTS) {
        try {
          const res = await fetch(`${base}/api/v3/klines?symbol=${selectedPair}&interval=${tf.interval}&limit=${tf.limit}`);
          if (res.ok) {
            successData = await res.json();
            workingRestBase = base;
            break; 
          }
        } catch (err) {}
      }

      if (!isMounted) return;

      if (successData) {
        const formatted = successData.map(d => ({
          timestamp: d[0], time: formatTime(d[0], selectedTimeframe),
          open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]),
          close: parseFloat(d[4]), price: parseFloat(d[4]), volume: parseFloat(d[5]),
          candleRange: [parseFloat(d[3]), parseFloat(d[2])]
        }));
        setData(formatted);
        setLoading(false);
        startWebSockets(0);
      } else {
        setLoading(false);
        setWsStatus('error');
      }
    };

    const startRestPolling = (baseUrl) => {
      if (!isMounted) return;
      setWsStatus('polling');
      setActiveEndpoint('REST Proxy');

      fallbackInterval = setInterval(async () => {
        if (!isMounted) return;
        try {
          const streamSymbol = selectedPair.toUpperCase();
          const tf = TIMEFRAMES[selectedTimeframe];

          const klineRes = await fetch(`${baseUrl}/api/v3/klines?symbol=${streamSymbol}&interval=${tf.interval}&limit=1`);
          if (klineRes.ok) {
            const klineData = await klineRes.json();
            const k = klineData[0];
            const currentPrice = parseFloat(k[4]);
            
            setData(prev => {
              if (prev.length === 0) return prev;
              const last = prev[prev.length - 1];
              if (k[0] > last.timestamp) {
                return [...prev.slice(1), {
                  timestamp: k[0], time: formatTime(k[0], selectedTimeframe),
                  open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]),
                  close: currentPrice, price: currentPrice, volume: parseFloat(k[5]),
                  candleRange: [parseFloat(k[3]), parseFloat(k[2])]
                }];
              } else {
                return [...prev.slice(0, -1), { 
                  ...last, 
                  close: currentPrice, price: currentPrice, 
                  high: Math.max(last.high, parseFloat(k[2])), 
                  low: Math.min(last.low, parseFloat(k[3])), 
                  volume: parseFloat(k[5]), 
                  candleRange: [Math.min(last.low, parseFloat(k[3])), Math.max(last.high, parseFloat(k[2]))] 
                }];
              }
            });
          }

          const depthRes = await fetch(`${baseUrl}/api/v3/depth?symbol=${streamSymbol}&limit=20`);
          if (depthRes.ok) {
            const depthData = await depthRes.json();
            let bVol = 0; let aVol = 0;
            depthData.bids.forEach(b => bVol += parseFloat(b[1]));
            depthData.asks.forEach(a => aVol += parseFloat(a[1]));
            setOrderFlowMetrics(prev => ({ ...prev, bidVol: bVol, askVol: aVol }));
          }

          const tradesRes = await fetch(`${baseUrl}/api/v3/aggTrades?symbol=${streamSymbol}&limit=50`);
          if (tradesRes.ok) {
            const tradesData = await tradesRes.json();
            let newBuyVol = 0; let newSellVol = 0; let newDelta = 0;

            tradesData.forEach(msg => {
              if (msg.a > lastTradeId) {
                lastTradeId = msg.a;
                const qty = parseFloat(msg.q);
                const price = parseFloat(msg.p);
                if (qty * price >= 5000) {
                  const isBuy = !msg.m;
                  newBuyVol += isBuy ? qty : 0;
                  newSellVol += !isBuy ? qty : 0;
                  newDelta += isBuy ? qty : -qty;
                }
              }
            });

            if (newBuyVol > 0 || newSellVol > 0) {
              setOrderFlowMetrics(prev => ({
                ...prev,
                buyVol: prev.buyVol + newBuyVol,
                sellVol: prev.sellVol + newSellVol,
                delta: prev.delta + newDelta,
                cvd: prev.cvd + newDelta
              }));
            }
          }
        } catch(e) {}
      }, 3000);
    };

    const startWebSockets = (endpointIndex) => {
      if (endpointIndex >= WS_ENDPOINTS.length) {
        if (isMounted) {
           if (workingRestBase) startRestPolling(workingRestBase);
           else setWsStatus('error');
        }
        return;
      }

      const WS_BASE = WS_ENDPOINTS[endpointIndex];
      if (isMounted) setActiveEndpoint(WS_BASE.replace('wss://', '').split(':')[0]);
      
      const streamSymbol = selectedPair.toLowerCase();
      const tf = TIMEFRAMES[selectedTimeframe];

      sockets.forEach(s => { s.onclose = null; s.onerror = null; s.close(); });
      sockets = [];

      try {
        const klineWs = new WebSocket(`${WS_BASE}/ws/${streamSymbol}@kline_${tf.interval}`);
        const tradeWs = new WebSocket(`${WS_BASE}/ws/${streamSymbol}@aggTrade`);
        const depthWs = new WebSocket(`${WS_BASE}/ws/${streamSymbol}@depth20@100ms`);

        sockets.push(klineWs, tradeWs, depthWs);
        
        let connectedCount = 0;
        const onOpen = () => {
          connectedCount++;
          if (connectedCount === 3 && isMounted) setWsStatus('connected');
        };

        klineWs.onopen = onOpen; tradeWs.onopen = onOpen; depthWs.onopen = onOpen;

        const onError = () => {
           if (isMounted && wsStatus !== 'error') {
               setWsStatus('retrying');
               startWebSockets(endpointIndex + 1);
           }
        };

        klineWs.onerror = onError; tradeWs.onerror = onError; depthWs.onerror = onError;
        klineWs.onclose = onError;

        klineWs.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const msg = JSON.parse(event.data);
            if (msg.e !== 'kline') return;
            const k = msg.k;
            const currentPrice = parseFloat(k.c);
            
            setData(prev => {
              if (prev.length === 0) return prev;
              const last = prev[prev.length - 1];
              if (k.t > last.timestamp) {
                return [...prev.slice(1), {
                  timestamp: k.t, time: formatTime(k.t, selectedTimeframe),
                  open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l),
                  close: currentPrice, price: currentPrice, volume: parseFloat(k.v),
                  candleRange: [parseFloat(k.l), parseFloat(k.h)]
                }];
              } else {
                return [...prev.slice(0, -1), { 
                  ...last, 
                  close: currentPrice, price: currentPrice, 
                  high: Math.max(last.high, parseFloat(k.h)), 
                  low: Math.min(last.low, parseFloat(k.l)), 
                  volume: parseFloat(k.v), 
                  candleRange: [Math.min(last.low, parseFloat(k.l)), Math.max(last.high, parseFloat(k.h))] 
                }];
              }
            });
          } catch(e) {}
        };

        tradeWs.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const msg = JSON.parse(event.data);
            const qty = parseFloat(msg.q);
            const isMaker = msg.m; 
            
            if (qty * parseFloat(msg.p) < 5000) return;

            setOrderFlowMetrics(prev => {
              const isBuy = !isMaker;
              const currentDelta = isBuy ? qty : -qty;
              return {
                ...prev,
                buyVol: prev.buyVol + (isBuy ? qty : 0),
                sellVol: prev.sellVol + (!isBuy ? qty : 0),
                delta: prev.delta + currentDelta,
                cvd: prev.cvd + currentDelta
              };
            });
          } catch(e) {}
        };

        depthWs.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const msg = JSON.parse(event.data);
            let bVol = 0; let aVol = 0;
            if (msg.bids) msg.bids.forEach(b => bVol += parseFloat(b[1]));
            if (msg.asks) msg.asks.forEach(a => aVol += parseFloat(a[1]));
            setOrderFlowMetrics(prev => ({ ...prev, bidVol: bVol, askVol: aVol }));
          } catch(e) {}
        };

      } catch (err) {
        startWebSockets(endpointIndex + 1);
      }
    };

    fetchInitialData();

    return () => {
      isMounted = false;
      if (fallbackInterval) clearInterval(fallbackInterval);
      sockets.forEach(s => { s.onclose = null; s.onerror = null; s.close(); });
    };
  }, [selectedPair, selectedTimeframe]);

  const { chartData, autoSR, yDomain, volDomain, vpvrData } = useMemo(() => {
    if (data.length === 0) {
      return { chartData: [], autoSR: {support: null, resistance: null}, yDomain: [0, 100], volDomain: [0, 100], vpvrData: [] };
    }
    
    let processed = calculateSMA(data, 14);
    processed = calculateVWAP(processed);
    const sr = calculateAutoSR(data);
    
    const prices = data.map(d => d.price).filter(isFinite);
    const min = prices.length > 0 ? Math.min(...prices) : 0;
    const max = prices.length > 0 ? Math.max(...prices) : 100;
    const padding = (max - min) * 0.1;
    const safeDomain = [Math.max(0, min - padding), max + padding];

    const volumes = data.map(d => d.volume).filter(isFinite);
    const maxVol = volumes.length > 0 ? Math.max(...volumes) : 100;
    const safeVolDomain = [0, maxVol * 4]; 

    const binsCount = 40;
    const binSize = max > min ? (max - min) / binsCount : 1;
    const bins = Array.from({ length: binsCount }, (_, i) => ({
      priceLevel: min + (i * binSize) + (binSize / 2),
      vol: 0
    }));

    if (showIndicators.vpvr && max > min) {
      data.forEach(d => {
        const typPrice = (d.low + d.high + d.close) / 3;
        let idx = Math.floor((typPrice - min) / binSize);
        idx = Math.max(0, Math.min(idx, binsCount - 1));
        bins[idx].vol += (isFinite(d.volume) ? d.volume : 0);
      });
    }

    return { chartData: processed, autoSR: sr, yDomain: safeDomain, volDomain: safeVolDomain, vpvrData: bins };
  }, [data, showIndicators.vpvr]);

  const setupAnalysis = useMemo(() => {
    if (chartData.length < 2) return null;
    const currentPrice = chartData[chartData.length - 1].price;
    const prevPrice = chartData[chartData.length - 2].price;
    const sma = chartData[chartData.length - 1].sma;
    const vwap = chartData[chartData.length - 1].vwap;
    
    let isBullish = false;
    if (sma && currentPrice > sma && currentPrice > vwap) { isBullish = true; }
    else if (sma && currentPrice < sma && currentPrice < vwap) { isBullish = false; }

    let locationStr = 'Mid-Range';
    let atSupport = false; let atResistance = false;
    const s = autoSR.support; const r = autoSR.resistance;
    if (s && ((currentPrice - s) / s) < 0.005) { locationStr = `At Support`; atSupport = true; }
    else if (r && ((r - currentPrice) / r) < 0.005) { locationStr = `At Resistance`; atResistance = true; }

    const totalOrderBook = orderFlowMetrics.bidVol + orderFlowMetrics.askVol;
    const bidPct = totalOrderBook > 0 ? (orderFlowMetrics.bidVol / totalOrderBook) * 100 : 50;
    const bookStr = bidPct > 55 ? `Buy Wall Detected` : bidPct < 45 ? `Sell Wall Detected` : 'Balanced DOM';

    let absorption = 'None';
    const deltaMag = Math.abs(orderFlowMetrics.delta);
    const priceChange = Math.abs((currentPrice - prevPrice) / prevPrice);
    
    if (deltaMag > 5 && priceChange < 0.001) { 
      if (orderFlowMetrics.delta > 0) absorption = 'Seller Absorption';
      if (orderFlowMetrics.delta < 0) absorption = 'Buyer Absorption';
    }

    let score = 0;
    let setupType = 'WAITING FOR CONFIRMATION';
    let setupColor = 'text-slate-400';
    let bgPulse = '';

    // NEW: Calculate the 6-Point Score System
    if (isBullish || atSupport) {
      if (isBullish) score++;
      if (atSupport) score++;
      if (orderFlowMetrics.cvd > 0) score++;
      if (bidPct > 55) score++;
      if (absorption.includes('Buyer')) score++;
      if (optionsData.bias === 'Bullish') score++; // The 6th Confirmation Factor
      
      if (score >= 5) { setupType = 'HIGH PROB LONG'; setupColor = 'text-emerald-500'; bgPulse = 'bg-emerald-500/10 border-emerald-500/50'; }
      else if (score >= 3) { setupType = 'LONG SETTING UP'; setupColor = 'text-emerald-400'; }
    } else {
      if (!isBullish) score++;
      if (atResistance) score++;
      if (orderFlowMetrics.cvd < 0) score++;
      if (bidPct < 45) score++;
      if (absorption.includes('Seller')) score++;
      if (optionsData.bias === 'Bearish') score++; // The 6th Confirmation Factor

      if (score >= 5) { setupType = 'HIGH PROB SHORT'; setupColor = 'text-rose-500'; bgPulse = 'bg-rose-500/10 border-rose-500/50'; }
      else if (score >= 3) { setupType = 'SHORT SETTING UP'; setupColor = 'text-rose-400'; }
    }

    return {
      locationStr, bookStr, absorption,
      deltaStr: orderFlowMetrics.delta > 0 ? `+${orderFlowMetrics.delta.toFixed(2)}` : orderFlowMetrics.delta.toFixed(2),
      cvdStr: orderFlowMetrics.cvd > 0 ? `+${orderFlowMetrics.cvd.toFixed(2)}` : orderFlowMetrics.cvd.toFixed(2),
      setupType, setupColor, bgPulse, score,
      invalidation: setupType.includes('LONG') && s ? `< $${s.toFixed(2)}` : setupType.includes('SHORT') && r ? `> $${r.toFixed(2)}` : 'N/A'
    };

  }, [chartData, autoSR, orderFlowMetrics, optionsData.bias]);

  const currentPrice = chartData.length > 0 ? chartData[chartData.length - 1].price : 0;
  const isUp = chartData.length > 1 ? currentPrice >= chartData[chartData.length - 2].price : true;

  // Gauge calculations for the UI
  const pcrPercentage = Math.min(Math.max((optionsData.pcr / 1.5) * 100, 0), 100);

  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-200 flex flex-col font-sans overflow-hidden">
      
      <header className="h-16 border-b border-slate-800 bg-slate-900 flex items-center justify-between px-4 sm:px-6 shrink-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-1.5 rounded-lg text-white shadow-lg"><Database size={22} /></div>
          <span className="font-bold text-xl tracking-tight text-white hidden sm:block">V3 Flow<span className="text-indigo-400">Terminal</span></span>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex bg-slate-950 p-1 rounded-md border border-slate-800">
             {Object.keys(COIN_CONFIG).map(c => (
               <button key={c} onClick={() => setSelectedPair(c)} className={`px-3 py-1 rounded text-sm font-bold transition-all ${selectedPair === c ? 'bg-slate-800 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}>
                 {COIN_CONFIG[c].label}
               </button>
             ))}
          </div>
          <div className="flex bg-slate-950 p-1 rounded-md border border-slate-800 hidden md:flex">
             {Object.keys(TIMEFRAMES).map(t => (
               <button key={t} onClick={() => setSelectedTimeframe(t)} className={`px-3 py-1 rounded text-xs font-bold transition-all ${selectedTimeframe === t ? 'bg-slate-800 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}>
                 {TIMEFRAMES[t].label}
               </button>
             ))}
          </div>
        </div>

        <div className="flex flex-col items-end">
           <div className={`text-2xl font-mono font-bold tracking-tighter ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
             ${currentPrice.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}
           </div>
           
           <div className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
              {wsStatus === 'connected' ? (
                <><Wifi size={10} className="text-emerald-500"/> <span className="text-emerald-500/80">Secured: {activeEndpoint}</span></>
              ) : wsStatus === 'retrying' ? (
                <><RefreshCw size={10} className="text-amber-500 animate-spin"/> <span className="text-amber-500/80">Bypassing ISP...</span></>
              ) : wsStatus === 'polling' ? (
                <><Activity size={10} className="text-fuchsia-500 animate-pulse"/> <span className="text-fuchsia-500/80">REST Fallback Active</span></>
              ) : wsStatus === 'connecting' ? (
                <><Loader2 size={10} className="text-blue-500 animate-spin"/> <span className="text-blue-500/80">Connecting</span></>
              ) : (
                <><WifiOff size={10} className="text-rose-500"/> <span className="text-rose-500/80">Network Blocked</span></>
              )}
           </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0 bg-slate-950">
        
        {/* Left: Chart Area */}
        <div className="flex-1 relative flex flex-col min-w-0 border-r border-slate-800">
          {loading ? (
             <div className="absolute inset-0 flex items-center justify-center flex-col text-slate-500 z-50 bg-slate-950/90">
               <Loader2 className="w-10 h-10 animate-spin mb-4 text-indigo-500" />
               <p className="font-mono text-sm tracking-widest uppercase">Routing through regional nodes...</p>
             </div>
          ) : (
            <div className="flex-1 relative w-full h-full p-2">
              
              {/* Back Layer: VPVR Overlay */}
              {showIndicators.vpvr && vpvrData.length > 0 && (
                <div className="absolute top-[20px] bottom-[25px] right-[70px] left-0 opacity-20 pointer-events-none z-0">
                   <div className="w-[30%] h-full ml-auto">
                     <ResponsiveContainer width="100%" height="100%">
                        <BarChart layout="vertical" data={vpvrData} margin={{top:0, right:0, left:0, bottom:0}}>
                          <XAxis type="number" hide reversed domain={[0, 'dataMax']} />
                          <YAxis type="number" dataKey="priceLevel" hide domain={yDomain} />
                          <Bar dataKey="vol" fill="#3b82f6" isAnimationActive={false} />
                        </BarChart>
                     </ResponsiveContainer>
                   </div>
                </div>
              )}

              {/* Front Layer: Primary Price Action */}
              <div className="absolute inset-0 z-10 p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="time" stroke="#64748b" tick={{fill:'#94a3b8', fontSize:11}} tickMargin={10} minTickGap={30} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="price" domain={yDomain} stroke="#64748b" tick={{fill:'#94a3b8', fontSize:12, fontFamily:'monospace'}} width={70} orientation="right" axisLine={false} tickLine={false} />
                    <YAxis yAxisId="volume" hide domain={volDomain} />

                    <Tooltip 
                      cursor={{ stroke: '#334155', strokeWidth: 1, strokeDasharray: '4 4' }}
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc', borderRadius: '4px' }}
                      itemStyle={{ fontSize: '13px', fontWeight: 'bold' }}
                      labelStyle={{ color: '#64748b', fontSize: '12px', marginBottom: '4px' }}
                    />

                    <Bar yAxisId="volume" dataKey="volume" fill="#475569" opacity={0.3} isAnimationActive={false} name="Vol" />
                    
                    {showIndicators.sr && autoSR.support && <ReferenceLine yAxisId="price" y={autoSR.support} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.7} />}
                    {showIndicators.sr && autoSR.resistance && <ReferenceLine yAxisId="price" y={autoSR.resistance} stroke="#f43f5e" strokeDasharray="3 3" strokeOpacity={0.7} />}

                    {/* NEW: Options Max Pain Line */}
                    {showIndicators.maxPain && optionsData.maxPain && (
                      <ReferenceLine 
                        yAxisId="price" 
                        y={optionsData.maxPain} 
                        stroke="#eab308" 
                        strokeWidth={2} 
                        strokeOpacity={0.8}
                        label={{ position: 'insideTopLeft', value: 'GAMMA WALL (MAX PAIN)', fill: '#eab308', fontSize: 10, fontWeight: 'bold' }}
                      />
                    )}

                    {showIndicators.sma && <Line yAxisId="price" type="monotone" dataKey="sma" stroke="#0ea5e9" dot={false} strokeWidth={1.5} isAnimationActive={false} name="SMA14"/>}
                    {showIndicators.vwap && <Line yAxisId="price" type="monotone" dataKey="vwap" stroke="#d946ef" dot={false} strokeWidth={1.5} strokeDasharray="5 5" isAnimationActive={false} name="VWAP"/>}

                    <Bar yAxisId="price" dataKey="candleRange" isAnimationActive={false} name="Candle" shape={<CustomCandlestick />} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        {/* Right: Order Flow Engine Panel */}
        <div className="w-full lg:w-[420px] bg-slate-900 flex flex-col shrink-0 overflow-y-auto">
          
          <div className="p-4 border-b border-slate-800 bg-slate-950 flex justify-between items-center">
            <h2 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide">
              <Crosshair size={16} className="text-indigo-400"/> Order Flow Engine
            </h2>
            <div className="flex gap-2">
              <button onClick={() => setShowIndicators(p=>({...p, vpvr: !p.vpvr}))} className={`px-2 py-1 text-[10px] font-bold rounded ${showIndicators.vpvr ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-800 text-slate-500'}`}>VPVR</button>
              <button onClick={() => setShowIndicators(p=>({...p, vwap: !p.vwap}))} className={`px-2 py-1 text-[10px] font-bold rounded ${showIndicators.vwap ? 'bg-fuchsia-500/20 text-fuchsia-400' : 'bg-slate-800 text-slate-500'}`}>VWAP</button>
              <button onClick={() => setShowIndicators(p=>({...p, sr: !p.sr}))} className={`px-2 py-1 text-[10px] font-bold rounded ${showIndicators.sr ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>S/R</button>
              <button onClick={() => setShowIndicators(p=>({...p, maxPain: !p.maxPain}))} className={`px-2 py-1 text-[10px] font-bold rounded ${showIndicators.maxPain ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-slate-500'}`}>MAX PAIN</button>
            </div>
          </div>

          {setupAnalysis ? (
            <div className={`m-4 p-5 rounded-xl border transition-all duration-500 ${setupAnalysis.bgPulse || 'bg-slate-950 border-slate-800'}`}>
              <div className="flex justify-between items-start mb-4">
                 <div>
                   <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Status</div>
                   <div className={`text-lg font-bold tracking-tight ${setupAnalysis.setupColor}`}>{setupAnalysis.setupType}</div>
                 </div>
                 <div className="flex flex-col items-end">
                   <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Conditions</div>
                   <div className="text-lg font-mono font-bold text-white bg-slate-900 px-2 rounded border border-slate-700">{setupAnalysis.score} / 6</div>
                 </div>
              </div>

              <div className="space-y-2 text-xs">
                 <div className="flex justify-between p-2 bg-slate-900/50 rounded border border-slate-800/50">
                   <span className="text-slate-400">Price Location:</span>
                   <span className="font-bold text-slate-200">{setupAnalysis.locationStr}</span>
                 </div>
                 <div className="flex justify-between p-2 bg-slate-900/50 rounded border border-slate-800/50">
                   <span className="text-slate-400">DOM Imbalance:</span>
                   <span className="font-bold text-amber-400">{setupAnalysis.bookStr}</span>
                 </div>
                 <div className="flex justify-between p-2 bg-slate-900/50 rounded border border-slate-800/50">
                   <span className="text-slate-400">Tape Absorption:</span>
                   <span className={`font-bold ${setupAnalysis.absorption !== 'None' ? 'text-fuchsia-400' : 'text-slate-500'}`}>{setupAnalysis.absorption}</span>
                 </div>
                 <div className="flex justify-between p-2 bg-slate-900/50 rounded border border-slate-800/50">
                   <span className="text-slate-400">Options Bias:</span>
                   <span className={`font-bold ${optionsData.bias === 'Bullish' ? 'text-emerald-400' : optionsData.bias === 'Bearish' ? 'text-rose-400' : 'text-slate-300'}`}>{optionsData.bias}</span>
                 </div>
              </div>
            </div>
          ) : (
            <div className="m-4 p-8 text-center text-slate-500 text-sm border border-slate-800 border-dashed rounded-xl flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin"/> Parsing Setup...
            </div>
          )}

          {/* NEW: Options Flow Widget */}
          <div className="mx-4 p-4 bg-slate-950 border border-slate-800 rounded-xl flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase text-slate-500 tracking-wider flex items-center gap-1.5"><PieChart size={14}/> Deribit Options Flow</h3>
            
            <div className="flex justify-between items-end">
              <div>
                 <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">Put/Call Ratio (PCR)</div>
                 <div className={`text-2xl font-mono font-bold ${optionsData.bias === 'Bullish' ? 'text-emerald-400' : optionsData.bias === 'Bearish' ? 'text-rose-400' : 'text-slate-300'}`}>
                   {optionsData.pcr.toFixed(2)}
                 </div>
              </div>
              <div className="text-right">
                 <div className="text-[10px] text-slate-400 uppercase font-bold mb-1 flex items-center justify-end gap-1"><Magnet size={10}/> Max Pain Magnet</div>
                 <div className="text-lg font-mono font-bold text-amber-400">
                   {optionsData.maxPain ? `$${optionsData.maxPain.toLocaleString()}` : 'Calculating...'}
                 </div>
              </div>
            </div>

            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1 relative">
               <div className="absolute top-0 left-0 h-full transition-all duration-1000 bg-gradient-to-r from-emerald-500 via-slate-500 to-rose-500" style={{width: '100%'}}></div>
               <div className="absolute top-0 w-1 h-full bg-white shadow-[0_0_8px_white]" style={{left: `${pcrPercentage}%`, transition: 'left 1s ease'}}></div>
            </div>
            <div className="flex justify-between text-[9px] text-slate-500 font-bold uppercase mt-1">
              <span>Extreme Greed (PCR &lt; 0.6)</span>
              <span>Extreme Fear (PCR &gt; 1.2)</span>
            </div>
          </div>

          <div className="flex-1 mt-4 p-4 bg-slate-950 border-t border-slate-800 flex flex-col gap-4">
            <h3 className="text-xs font-bold uppercase text-slate-500 tracking-wider">Whale CVD Tracker (&gt;$5k Hits)</h3>
            
            <div className="grid grid-cols-2 gap-3">
               <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 flex flex-col items-center justify-center">
                 <span className="text-[10px] text-slate-400 uppercase font-bold mb-1">Session CVD</span>
                 <span className={`text-xl font-mono font-bold ${orderFlowMetrics.cvd > 0 ? 'text-emerald-400' : orderFlowMetrics.cvd < 0 ? 'text-rose-400' : 'text-slate-300'}`}>
                   {setupAnalysis?.cvdStr || '0.00'}
                 </span>
               </div>
               <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 flex flex-col items-center justify-center">
                 <span className="text-[10px] text-slate-400 uppercase font-bold mb-1">Instant Delta</span>
                 <span className={`text-xl font-mono font-bold ${orderFlowMetrics.delta > 0 ? 'text-emerald-400' : orderFlowMetrics.delta < 0 ? 'text-rose-400' : 'text-slate-300'}`}>
                   {setupAnalysis?.deltaStr || '0.00'}
                 </span>
               </div>
            </div>

            <div className="mt-2 bg-slate-900 p-3 rounded-lg border border-slate-800">
               <div className="flex justify-between text-xs mb-2 font-bold">
                 <span className="text-emerald-400 flex items-center gap-1"><TrendingUp size={12}/> Market Buys</span>
                 <span className="text-rose-400 flex items-center gap-1">Market Sells <TrendingDown size={12}/></span>
               </div>
               <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden flex">
                 <div className="h-full bg-emerald-500 transition-all duration-300" style={{width: `${orderFlowMetrics.buyVol + orderFlowMetrics.sellVol > 0 ? (orderFlowMetrics.buyVol / (orderFlowMetrics.buyVol + orderFlowMetrics.sellVol))*100 : 50}%`}}></div>
                 <div className="h-full bg-rose-500 transition-all duration-300" style={{flex: 1}}></div>
               </div>
            </div>
            
            <div className="text-[10px] text-slate-600 leading-tight mt-auto text-center px-4 pb-2">
              Deribit Options feed active. Network bypass operational.
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}