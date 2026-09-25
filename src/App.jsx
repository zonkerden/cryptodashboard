import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  ResponsiveContainer, 
  ComposedChart, 
  Line,
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ReferenceLine,
  Customized
} from 'recharts';
import { 
  Activity, 
  Wifi, 
  WifiOff, 
  RefreshCw,
  Play,
  Square,
  Crosshair,
  Database,
  TrendingUp,
  TrendingDown,
  Clock
} from 'lucide-react';

if (typeof window !== 'undefined' && !document.getElementById('tailwind-cdn')) {
  const script = document.createElement('script');
  script.id = 'tailwind-cdn';
  script.src = 'https://cdn.tailwindcss.com';
  document.head.appendChild(script);
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("Terminal Crash:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0b1120] text-slate-200 p-10 flex flex-col items-center justify-center font-sans">
          <div className="bg-rose-950/30 p-8 rounded-xl border border-rose-500/50 max-w-2xl w-full shadow-2xl text-center">
            <h1 className="text-2xl font-bold text-rose-400 mb-4 flex items-center justify-center gap-2">
              <Activity /> Dashboard Crash Prevented
            </h1>
            <p className="text-slate-300 mb-4">A background calculation failed. Reloading the data feed will fix this.</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded font-bold transition-colors shadow-lg"
            >
              Restart Terminal
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const CustomCandlestick = (props) => {
  const { x, y, width, height, payload } = props;
  if (!payload || typeof payload.open !== 'number') return null;

  const o = payload.open;
  const c = payload.close;
  const h = payload.high;
  const l = payload.low;

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

const calculateVWAP = (data) => {
  if (!data || data.length === 0) return [];
  let cumulativeTypVol = 0;
  let cumulativeVol = 0;
  
  return data.map((point) => {
    const typPrice = (point.high + point.low + point.close) / 3;
    const vol = point.volume || 0;
    cumulativeTypVol += (typPrice * vol);
    cumulativeVol += vol;
    return {
      ...point,
      vwap: cumulativeVol === 0 ? point.close : (cumulativeTypVol / cumulativeVol)
    };
  });
};

const TIMEFRAMES = {
  '1m': { interval: '1m', limit: 120 },
  '5m': { interval: '5m', limit: 120 },
  '15m': { interval: '15m', limit: 120 },
  '1H': { interval: '1h', limit: 120 }
};

function V3FlowTerminal() {
  // Main State
  const [selectedPair, setSelectedPair] = useState('BTCUSDT');
  const [selectedTimeframe, setSelectedTimeframe] = useState('5m');
  const [wsStatus, setWsStatus] = useState('connecting');
  const [livePrice, setLivePrice] = useState(0); 
  const [uiTick, setUiTick] = useState(0); // Forces chart re-render safely
  
  // Indicators & Overlays
  const [toggles, setToggles] = useState({
    vpvr: true,
    vwap: true,
    sr: true,
    maxPain: true
  });

  // Flow State
  const [optionsData, setOptionsData] = useState({ pcr: 0.58, maxPain: 0 });
  const [cvdData, setCvdData] = useState({ sessionCvd: 0, instantDelta: 0, buyVol: 0, sellVol: 0 });

  // Bot State (LocalStorage Persistence)
  const [botState, setBotState] = useState(() => {
    try {
      const saved = localStorage.getItem('v3_bot_data');
      if (saved) return JSON.parse(saved);
    } catch(e){}
    return { active: false, balance: 10000, position: null, history: [] };
  });

  useEffect(() => {
    localStorage.setItem('v3_bot_data', JSON.stringify(botState));
  }, [botState]);

  // High-Performance Data Refs (Bypasses React Freezing)
  const chartDataRef = useRef([]);
  const volumeRef = useRef({ buy: 0, sell: 0, rollingBuy: 0, rollingSell: 0 });
  const wsRef = useRef(null);

  // --- NEW: Live Deribit Options Flow Engine ---
  useEffect(() => {
    let isMounted = true;
    
    const fetchOptionsData = async () => {
      // Extract base coin (BTC, ETH, SOL)
      const coin = selectedPair.replace('USDT', '');
      
      try {
        const res = await fetch(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${coin}&kind=option`);
        const json = await res.json();
        
        if (!isMounted || !json.result) return;
        
        let totalCalls = 0;
        let totalPuts = 0;
        let strikesOI = {}; // Tracks Open Interest per strike price
        
        // Sift through the entire options book
        json.result.forEach(contract => {
          // Deribit Contract format: BTC-27SEP26-90000-C
          const parts = contract.instrument_name.split('-');
          if (parts.length !== 4) return;
          
          const strike = parseFloat(parts[2]);
          const type = parts[3]; // 'C' for Call, 'P' for Put
          const oi = contract.open_interest || 0;
          
          if (type === 'C') totalCalls += oi;
          if (type === 'P') totalPuts += oi;
          
          if (!strikesOI[strike]) strikesOI[strike] = 0;
          strikesOI[strike] += oi;
        });
        
        // 1. Calculate Real Put/Call Ratio
        const pcr = totalCalls > 0 ? (totalPuts / totalCalls) : 0.5;
        
        // 2. Find Gamma Wall (The specific Strike Price with the highest Open Interest)
        let maxPainStrike = 0;
        let highestOI = 0;
        
        for (const [strike, oi] of Object.entries(strikesOI)) {
          if (oi > highestOI) {
            highestOI = oi;
            maxPainStrike = parseFloat(strike);
          }
        }
        
        if (maxPainStrike > 0) {
          setOptionsData({ pcr, maxPain: maxPainStrike });
        }
      } catch (error) {
        console.warn("Deribit API blocked or unavailable. Waiting for next cycle.");
      }
    };

    // Fetch immediately on coin swap, then loop every 5 minutes
    fetchOptionsData();
    const optionsInterval = setInterval(fetchOptionsData, 300000); 

    return () => {
      isMounted = false;
      clearInterval(optionsInterval);
    };
  }, [selectedPair]);

  useEffect(() => {
    let isMounted = true;
    setWsStatus('connecting');

    const tfConfig = TIMEFRAMES[selectedTimeframe];
    chartDataRef.current = [];
    
    // WIPE THE MEMORY BANK ON COIN/TIMEFRAME SWAP
    volumeRef.current = { buy: 0, sell: 0, rollingBuy: 0, rollingSell: 0 };
    setCvdData({ sessionCvd: 0, instantDelta: 0, buyVol: 0, sellVol: 0 });

    // 1. Race Multiple REST Endpoints for Historical Data (Bypasses ISP Blocks)
    const fetchHistorical = async () => {
      const endpoints = [
        'https://data-api.binance.vision/api/v3/klines',
        'https://api.binance.com/api/v3/klines',
        'https://api4.binance.com/api/v3/klines'
      ];

      for (const base of endpoints) {
        try {
          const res = await fetch(`${base}?symbol=${selectedPair}&interval=${tfConfig.interval}&limit=${tfConfig.limit}`);
          if (!res.ok) continue;
          
          const json = await res.json();
          if (!isMounted) return;

          chartDataRef.current = json.map(d => ({
            timestamp: d[0],
            time: new Date(d[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5]),
            candleRange: [parseFloat(d[3]), parseFloat(d[2])]
          }));
          
          if (chartDataRef.current.length > 0) {
            setLivePrice(chartDataRef.current[chartDataRef.current.length - 1].close);
          }
          break; // Stop trying if successful
        } catch (e) {
          console.warn(`REST failed for ${base}, trying next...`);
        }
      }
      
      // Whether REST succeeds or fails, ALWAYS start the WebSocket
      startWebSocket();
    };

    // 2. Launch WebSocket or REST Fallback
    const startWebSocket = () => {
      if (wsRef.current) {
        if (typeof wsRef.current.close === 'function') wsRef.current.close();
        else clearInterval(wsRef.current);
      }

      const streamName = `${selectedPair.toLowerCase()}@kline_${tfConfig.interval}/${selectedPair.toLowerCase()}@trade`;
      // Use global stream.binance.info to bypass local Malaysian blockades
      const wsUrl = `wss://stream.binance.info:9443/stream?streams=${streamName}`;
      
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => { if (isMounted) setWsStatus('connected'); };
        
        ws.onmessage = (event) => {
          if (!isMounted) return;
          const msg = JSON.parse(event.data);
          if (!msg.data) return;

          // A. Handle Tick Trades (Whale Filter & Live Price)
          if (msg.stream.includes('@trade')) {
            const price = parseFloat(msg.data.p);
            const qty = parseFloat(msg.data.q);
            const isSell = msg.data.m;
            
            setLivePrice(price); // INSTANT UI update for top right ticker

            if (price * qty > 5000) {
              if (isSell) {
                volumeRef.current.sell += qty;
                volumeRef.current.rollingSell += qty;
              } else {
                volumeRef.current.buy += qty;
                volumeRef.current.rollingBuy += qty;
              }
            }
          }
          
          // B. Handle Candlesticks
          if (msg.stream.includes('@kline')) {
            const k = msg.data.k;
            const liveCandle = {
              timestamp: k.t,
              time: new Date(k.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
              volume: parseFloat(k.v),
              candleRange: [parseFloat(k.l), parseFloat(k.h)]
            };

            const arr = chartDataRef.current;
            if (arr.length === 0) {
              arr.push(liveCandle);
            } else {
              const lastIdx = arr.length - 1;
              if (liveCandle.timestamp > arr[lastIdx].timestamp) {
                arr.push(liveCandle); // Spawn new candle
                if (arr.length > tfConfig.limit) arr.shift();
              } else {
                arr[lastIdx] = liveCandle; // Update current candle
              }
            }
          }
        };

        ws.onerror = () => { if (isMounted) setWsStatus('error'); };
        ws.onclose = () => { if (isMounted && wsStatus === 'connected') setWsStatus('error'); };
      } catch (err) {
        console.warn("WebSocket blocked by Sandbox. Falling back to HTTP Polling.");
        if (isMounted) setWsStatus('polling');
        
        // Setup REST Polling Fallback if WebSocket is banned
        wsRef.current = setInterval(async () => {
          if (!isMounted) return;
          try {
            // 1. Fetch trades for Tape & Live Price
            const tradeRes = await fetch(`https://api.binance.com/api/v3/trades?symbol=${selectedPair}&limit=20`);
            if (tradeRes.ok) {
              const trades = await tradeRes.json();
              if (trades.length > 0) {
                setLivePrice(parseFloat(trades[trades.length - 1].price));
                trades.forEach(t => {
                  const p = parseFloat(t.price);
                  const q = parseFloat(t.qty);
                  if (p * q > 5000) {
                    if (t.isBuyerMaker) {
                      volumeRef.current.sell += q;
                      volumeRef.current.rollingSell += q;
                    } else {
                      volumeRef.current.buy += q;
                      volumeRef.current.rollingBuy += q;
                    }
                  }
                });
              }
            }

            // 2. Fetch Latest Kline
            const klineRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${selectedPair}&interval=${tfConfig.interval}&limit=1`);
            if (klineRes.ok) {
              const kline = await klineRes.json();
              if (kline.length > 0) {
                const d = kline[0];
                const liveCandle = {
                  timestamp: d[0],
                  time: new Date(d[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  open: parseFloat(d[1]),
                  high: parseFloat(d[2]),
                  low: parseFloat(d[3]),
                  close: parseFloat(d[4]),
                  volume: parseFloat(d[5]),
                  candleRange: [parseFloat(d[3]), parseFloat(d[2])]
                };
                
                const arr = chartDataRef.current;
                if (arr.length === 0) {
                  arr.push(liveCandle);
                } else {
                  const lastIdx = arr.length - 1;
                  if (liveCandle.timestamp > arr[lastIdx].timestamp) {
                    arr.push(liveCandle);
                    if (arr.length > tfConfig.limit) arr.shift();
                  } else {
                    arr[lastIdx] = liveCandle;
                  }
                }
              }
            }
          } catch(e) {}
        }, 2500);
      }
    };

    fetchHistorical();

    // 3. UI Update Loop (2 FPS to prevent React freezing)
    const renderLoop = setInterval(() => {
      if (!isMounted) return;
      setUiTick(t => t + 1); // Triggers re-render of chart
      
      const v = volumeRef.current;
      setCvdData({
        sessionCvd: v.buy - v.sell,
        instantDelta: v.rollingBuy - v.rollingSell,
        buyVol: v.buy,
        sellVol: v.sell
      });
    }, 500);

    // 4. Rolling 20s Velocity Reset for Delta
    const velocityLoop = setInterval(() => {
      volumeRef.current.rollingBuy = 0;
      volumeRef.current.rollingSell = 0;
    }, 20000);

    return () => {
      isMounted = false;
      if (wsRef.current) {
        if (typeof wsRef.current.close === 'function') {
          wsRef.current.close();
        } else {
          clearInterval(wsRef.current);
        }
      }
      clearInterval(renderLoop);
      clearInterval(velocityLoop);
    };
  }, [selectedPair, selectedTimeframe]);

  const chartData = useMemo(() => {
    // We pass uiTick to force this memo to recalculate every 500ms
    return calculateVWAP([...chartDataRef.current]);
  }, [uiTick]);

  const autoLevels = useMemo(() => {
    if (chartData.length < 20) return { res: null, sup: null };
    const recent = chartData.slice(-20);
    return {
      res: Math.max(...recent.map(d => d.high)),
      sup: Math.min(...recent.map(d => d.low))
    };
  }, [chartData]);

  // Perfectly clamps Y-Axis to prevent stretching or squashing
  const yAxisDomain = useMemo(() => {
    if (chartData.length === 0) return ['auto', 'auto'];
    
    let min = Math.min(...chartData.map(d => d.low));
    let max = Math.max(...chartData.map(d => d.high));
    
    if (toggles.sr && autoLevels.sup && autoLevels.res) {
      min = Math.min(min, autoLevels.sup);
      max = Math.max(max, autoLevels.res);
    }
    
    // Add 10% breathing room above and below the highest/lowest points
    const range = max - min;
    const padding = range === 0 ? min * 0.05 : range * 0.1;
    
    return [min - padding, max + padding];
  }, [chartData, toggles.sr, autoLevels]);

  const isMaxPainOffScreen = optionsData.maxPain > yAxisDomain[1] || optionsData.maxPain < yAxisDomain[0];

  const setupEngine = useMemo(() => {
    let score = 0;
    let type = 'NONE';
    let conditions = { loc: 'Waiting', dom: 'Neutral', tape: 'None', options: 'Neutral' };

    if (!autoLevels.sup || !livePrice) return { score, type, conditions };

    const distToSup = Math.abs(livePrice - autoLevels.sup) / livePrice;
    const distToRes = Math.abs(livePrice - autoLevels.res) / livePrice;

    // 1. Location (0.5% detection zone)
    if (distToSup < 0.005) { score += 2; type = 'LONG'; conditions.loc = 'At Support'; }
    else if (distToRes < 0.005) { score += 2; type = 'SHORT'; conditions.loc = 'At Resistance'; }

    // 2. Live Delta & Tape Absorption
    if (type === 'LONG') {
      if (cvdData.instantDelta < -5) { score += 2; conditions.dom = 'Buy Wall Detected'; conditions.tape = 'Buyer Absorption'; } 
      else if (cvdData.instantDelta > 5) { score += 1; conditions.dom = 'Heavy Bids'; conditions.tape = 'Aggressive Buying'; }
    } else if (type === 'SHORT') {
      if (cvdData.instantDelta > 5) { score += 2; conditions.dom = 'Sell Wall Detected'; conditions.tape = 'Seller Absorption'; } 
      else if (cvdData.instantDelta < -5) { score += 1; conditions.dom = 'Heavy Asks'; conditions.tape = 'Aggressive Selling'; }
    }

    // 3. Options Macro Bias
    if (optionsData.pcr < 0.8) { if (type === 'LONG') score += 2; conditions.options = 'Bullish'; } 
    else if (optionsData.pcr > 1.0) { if (type === 'SHORT') score += 2; conditions.options = 'Bearish'; }

    return { score, type, conditions };
  }, [livePrice, autoLevels, cvdData.instantDelta, optionsData.pcr]);

  useEffect(() => {
    if (!botState.active || !livePrice) return;

    if (!botState.position && setupEngine.score >= 5) {
      const isLong = setupEngine.type === 'LONG';
      const riskAmt = botState.balance * 0.01;
      const sl = isLong ? livePrice * 0.99 : livePrice * 1.01;
      const tp = isLong ? livePrice * 1.03 : livePrice * 0.97;
      const qty = riskAmt / Math.abs(livePrice - sl);

      setBotState(prev => ({ ...prev, position: { type: setupEngine.type, entry: livePrice, sl, tp, qty } }));
    }

    if (botState.position) {
      const pos = botState.position;
      let exitPrice = null;
      let pnl = 0;

      if (pos.type === 'LONG') {
        if (livePrice <= pos.sl) { exitPrice = pos.sl; pnl = (exitPrice - pos.entry) * pos.qty; }
        else if (livePrice >= pos.tp) { exitPrice = pos.tp; pnl = (exitPrice - pos.entry) * pos.qty; }
      } else {
        if (livePrice >= pos.sl) { exitPrice = pos.sl; pnl = (pos.entry - exitPrice) * pos.qty; }
        else if (livePrice <= pos.tp) { exitPrice = pos.tp; pnl = (pos.entry - exitPrice) * pos.qty; }
      }

      if (exitPrice !== null) {
        setBotState(prev => ({
          ...prev,
          balance: prev.balance + pnl,
          position: null,
          history: [{ type: pos.type, pnl, time: new Date().toLocaleTimeString() }, ...prev.history].slice(0, 5)
        }));
      }
    }
  }, [livePrice, setupEngine.score, botState.active]);

  const renderVPVR = (props) => {
    if (!toggles.vpvr || chartData.length === 0) return null;
    const { yAxisMap, offset } = props;
    if (!yAxisMap || !yAxisMap.price || !offset) return null;

    const yScale = yAxisMap.price.scale;
    let minPrice = Math.min(...chartData.map(d => d.low));
    let maxPrice = Math.max(...chartData.map(d => d.high));
    if (minPrice === maxPrice || isNaN(minPrice) || isNaN(maxPrice)) return null;

    const binsCount = 40;
    const binSize = (maxPrice - minPrice) / binsCount;
    const bins = Array.from({ length: binsCount }, (_, i) => ({
      top: minPrice + ((i + 1) * binSize),
      bottom: minPrice + (i * binSize),
      upVol: 0, downVol: 0
    }));

    chartData.forEach(d => {
      if (!d.close || !d.volume) return;
      let idx = Math.floor((d.close - minPrice) / binSize);
      if (idx >= binsCount) idx = binsCount - 1;
      if (idx < 0) idx = 0;
      if (d.close >= d.open) bins[idx].upVol += d.volume;
      else bins[idx].downVol += d.volume;
    });

    const maxVol = Math.max(...bins.map(b => b.upVol + b.downVol));
    if (maxVol === 0) return null;

    const maxWidth = offset.width * 0.35; 
    const startX = offset.left + offset.width;

    return (
      <g className="vpvr-layer">
        {bins.map((bin, i) => {
          const topY = Math.min(yScale(bin.top), yScale(bin.bottom));
          const h = Math.max(Math.abs(yScale(bin.top) - yScale(bin.bottom)), 1.5); 
          const totalVol = bin.upVol + bin.downVol;
          if (totalVol === 0) return null;
          
          const totalW = (totalVol / maxVol) * maxWidth;
          const upW = (bin.upVol / totalVol) * totalW;
          const downW = (bin.downVol / totalVol) * totalW;

          return (
            <g key={`vpvr-${i}`}>
              <rect x={startX - totalW} y={topY} width={downW} height={h} fill="#ef4444" fillOpacity={0.7} />
              <rect x={startX - totalW + downW} y={topY} width={upW} height={h} fill="#10b981" fillOpacity={0.7} />
            </g>
          );
        })}
      </g>
    );
  };

  const toggleBtnClass = (isActive, colorClass) => 
    `px-3 py-1.5 rounded text-xs font-bold transition-all border ${isActive ? `${colorClass} shadow-lg` : 'bg-transparent border-slate-700 text-slate-500 hover:text-slate-300'}`;

  return (
    <div className="min-h-screen bg-[#060a14] text-slate-200 p-4 font-sans selection:bg-indigo-500/30">
      
      {/* Top Navbar */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-4 bg-[#0a101f] border border-slate-800 p-4 rounded-xl shadow-2xl">
        <div className="flex items-center gap-3 mb-4 md:mb-0">
          <Database className="text-indigo-500" size={24} />
          <h1 className="text-2xl font-bold tracking-tight text-white">V3 Flow<span className="text-indigo-400">Terminal</span></h1>
        </div>
        
        <div className="flex gap-4">
          <div className="flex bg-[#050810] rounded border border-slate-800 p-1">
            {['BTC', 'ETH', 'SOL'].map(coin => (
              <button key={coin} onClick={() => setSelectedPair(`${coin}USDT`)} className={`px-4 py-1.5 rounded text-sm font-bold transition-all ${selectedPair.startsWith(coin) ? 'bg-slate-800 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}>
                {coin}
              </button>
            ))}
          </div>
          <div className="flex bg-[#050810] rounded border border-slate-800 p-1">
            {Object.keys(TIMEFRAMES).map(tf => (
              <button key={tf} onClick={() => setSelectedTimeframe(tf)} className={`px-3 py-1.5 rounded text-sm font-bold transition-all ${selectedTimeframe === tf ? 'bg-slate-800 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}>
                {tf}
              </button>
            ))}
          </div>
        </div>

        <div className="text-right flex flex-col items-end">
          <div className="text-3xl font-mono font-bold text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]">
            ${livePrice > 0 ? livePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-emerald-500 tracking-widest mt-1">
            {wsStatus === 'connected' ? <Wifi size={12} /> : <RefreshCw size={12} className="animate-spin text-amber-500" />}
            {wsStatus === 'connected' ? 'SECURED: STREAM.BINANCE.INFO' : 'POLLING DATA...'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        
        {/* Main Chart Canvas */}
        <div className="xl:col-span-3 bg-[#0a101f] rounded-xl border border-slate-800 p-2 h-[880px] relative overflow-hidden shadow-2xl">
          
          {toggles.maxPain && isMaxPainOffScreen && (
            <div className="absolute top-4 left-4 right-4 z-20 flex items-center gap-2">
              <div className="h-[1px] border-b border-dashed border-amber-500/50 flex-grow"></div>
              <div className="text-amber-500 font-bold text-xs bg-[#0a101f] px-2 py-0.5 rounded border border-amber-500/30 whitespace-nowrap">
                GAMMA WALL (OFF-SCREEN: ${optionsData.maxPain.toLocaleString()})
              </div>
              <div className="h-[1px] border-b border-dashed border-amber-500/50 flex-grow"></div>
            </div>
          )}

          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 20, right: 60, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#131c2f" vertical={false} />
              <XAxis dataKey="time" stroke="#475569" tick={{ fontSize: 11 }} tickMargin={10} minTickGap={30} axisLine={false} tickLine={false} />
              
              <YAxis 
                yAxisId="price" 
                domain={yAxisDomain} 
                orientation="right" 
                stroke="#475569" 
                tick={{ fontSize: 11, fontWeight: 'bold' }} 
                tickFormatter={v => v.toLocaleString()} 
                axisLine={false} 
                tickLine={false}
              />

              <Tooltip 
                contentStyle={{ backgroundColor: '#050810', borderColor: '#1e293b', borderRadius: '8px', color: '#f8fafc' }}
                itemStyle={{ fontWeight: 'bold' }} cursor={{ stroke: '#334155', strokeWidth: 1, strokeDasharray: '4 4' }}
              />

              <Customized component={renderVPVR} />
              
              {toggles.vwap && (
                <Line yAxisId="price" type="monotone" dataKey="vwap" stroke="#a855f7" strokeDasharray="5 5" strokeWidth={2} dot={false} isAnimationActive={false} name="VWAP" />
              )}

              {toggles.maxPain && !isMaxPainOffScreen && (
                <ReferenceLine yAxisId="price" y={optionsData.maxPain} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={2} strokeOpacity={0.8} />
              )}

              {toggles.sr && autoLevels.res && (
                <>
                  <ReferenceLine yAxisId="price" y={autoLevels.res} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={2} strokeOpacity={0.6} />
                  <ReferenceLine yAxisId="price" y={autoLevels.sup} stroke="#10b981" strokeDasharray="3 3" strokeWidth={2} strokeOpacity={0.6} />
                </>
              )}

              <Bar yAxisId="price" dataKey="candleRange" shape={(props) => <CustomCandlestick {...props} />} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Right Sidebar Control Panels */}
        <div className="flex flex-col gap-4">
          
          <div className="bg-[#0a101f] rounded-xl border border-slate-800 p-5 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-sm font-bold flex items-center gap-2 text-slate-100 tracking-wide">
                <Crosshair size={16} className="text-blue-500" /> ORDER FLOW ENGINE
              </h2>
              <div className="flex gap-1">
                <button onClick={() => setToggles(p => ({...p, vpvr: !p.vpvr}))} className={toggleBtnClass(toggles.vpvr, 'bg-blue-600/20 text-blue-400 border-blue-500/50')}>VPVR</button>
                <button onClick={() => setToggles(p => ({...p, vwap: !p.vwap}))} className={toggleBtnClass(toggles.vwap, 'bg-purple-600/20 text-purple-400 border-purple-500/50')}>VWAP</button>
                <button onClick={() => setToggles(p => ({...p, sr: !p.sr}))} className={toggleBtnClass(toggles.sr, 'bg-emerald-600/20 text-emerald-400 border-emerald-500/50')}>S/R</button>
                <button onClick={() => setToggles(p => ({...p, maxPain: !p.maxPain}))} className={toggleBtnClass(toggles.maxPain, 'bg-amber-600/20 text-amber-400 border-amber-500/50')}>MAX PAIN</button>
              </div>
            </div>

            <div className="bg-[#050810] rounded-xl p-4 border border-slate-800/80 mb-5 flex justify-between items-center shadow-inner">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">STATUS</div>
                <div className={`text-lg font-black tracking-wide ${setupEngine.score >= 5 ? 'text-emerald-400 animate-pulse' : 'text-blue-400'}`}>
                  {setupEngine.score >= 5 ? `${setupEngine.type} TRIGGERED` : setupEngine.score > 2 ? `${setupEngine.type} SETTING UP` : 'WAITING FOR SETUP'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">CONDITIONS</div>
                <div className="text-2xl font-bold text-white bg-slate-900 px-3 py-1 rounded border border-slate-700 shadow-inner">
                  {setupEngine.score} <span className="text-slate-500 text-lg">/ 6</span>
                </div>
              </div>
            </div>

            <div className="space-y-1 text-sm font-medium border border-slate-800/50 rounded-lg p-2 bg-[#080d18]">
              <div className="flex justify-between p-2 rounded hover:bg-slate-800/30 transition-colors"><span className="text-slate-500">Price Location:</span> <span className={setupEngine.conditions.loc !== 'Waiting' ? 'text-blue-400 font-bold' : 'text-slate-300'}>{setupEngine.conditions.loc}</span></div>
              <div className="flex justify-between p-2 rounded hover:bg-slate-800/30 transition-colors"><span className="text-slate-500">DOM Imbalance:</span> <span className={setupEngine.conditions.dom.includes('Wall') ? 'text-amber-400 font-bold' : 'text-slate-300'}>{setupEngine.conditions.dom}</span></div>
              <div className="flex justify-between p-2 rounded hover:bg-slate-800/30 transition-colors"><span className="text-slate-500">Tape Absorption:</span> <span className={setupEngine.conditions.tape !== 'None' ? 'text-fuchsia-400 font-bold' : 'text-slate-300'}>{setupEngine.conditions.tape}</span></div>
              <div className="flex justify-between p-2 rounded hover:bg-slate-800/30 transition-colors"><span className="text-slate-500">Options Bias:</span> <span className={setupEngine.conditions.options === 'Bullish' ? 'text-emerald-400 font-bold' : setupEngine.conditions.options === 'Bearish' ? 'text-rose-400 font-bold' : 'text-slate-300'}>{setupEngine.conditions.options}</span></div>
            </div>
          </div>

          <div className="bg-[#0a101f] rounded-xl border border-slate-800 p-5 shadow-2xl">
            <h2 className="text-xs font-bold flex items-center gap-2 text-slate-400 mb-5 uppercase tracking-wider">
              <Clock size={14} className="text-indigo-400" /> DERIBIT OPTIONS FLOW
            </h2>
            <div className="flex justify-between items-end mb-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">PUT/CALL RATIO (PCR)</div>
                <div className="text-4xl font-black tracking-tight text-emerald-400">{optionsData.pcr.toFixed(2)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1 flex items-center gap-1 justify-end">
                  <Crosshair size={10} className="text-amber-500" /> MAX PAIN MAGNET
                </div>
                <div className="text-2xl font-bold text-amber-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.3)]">${optionsData.maxPain.toLocaleString()}</div>
              </div>
            </div>
            
            <div className="w-full h-1.5 bg-slate-800 rounded-full mt-5 relative shadow-inner">
              <div className="absolute top-[-4px] w-3 h-3.5 bg-white rounded shadow-[0_0_10px_rgba(255,255,255,0.8)]" style={{ left: `${Math.min(100, Math.max(0, (optionsData.pcr / 1.5) * 100))}%` }}></div>
              <div className="w-full flex justify-between mt-3 text-[9px] text-slate-600 font-bold">
                <span>EXTREME GREED (PCR {"<"} 0.6)</span>
                <span>EXTREME FEAR (PCR {">"} 1.2)</span>
              </div>
            </div>
          </div>

          <div className="bg-[#0a101f] rounded-xl border border-slate-800 p-5 shadow-2xl">
            <h2 className="text-xs font-bold text-slate-400 mb-5 uppercase tracking-wider">Whale CVD Tracker (&gt;$5K Hits)</h2>
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div className="bg-[#050810] rounded-xl p-4 text-center border border-slate-800/80 shadow-inner">
                <div className="text-[10px] text-slate-500 font-bold mb-1 uppercase tracking-widest">Session CVD</div>
                <div className={`text-2xl font-black ${cvdData.sessionCvd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {cvdData.sessionCvd > 0 ? '+' : ''}{cvdData.sessionCvd.toFixed(2)}
                </div>
              </div>
              <div className="bg-[#050810] rounded-xl p-4 text-center border border-slate-800/80 shadow-inner">
                <div className="text-[10px] text-slate-500 font-bold mb-1 uppercase tracking-widest">Instant Delta</div>
                <div className={`text-2xl font-black ${cvdData.instantDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {cvdData.instantDelta > 0 ? '+' : ''}{cvdData.instantDelta.toFixed(2)}
                </div>
              </div>
            </div>
            
            <div className="flex justify-between text-[10px] font-bold mb-2 uppercase tracking-wide">
              <span className="text-emerald-500 flex items-center gap-1.5"><TrendingUp size={12}/> Market Buys</span>
              <span className="text-rose-500 flex items-center gap-1.5">Market Sells <TrendingDown size={12}/></span>
            </div>
            <div className="w-full h-2.5 rounded-full flex overflow-hidden bg-slate-800 shadow-inner">
              <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${Math.max(5, (cvdData.buyVol / (cvdData.buyVol + cvdData.sellVol || 1)) * 100)}%` }}></div>
              <div className="h-full bg-rose-500 transition-all duration-300" style={{ width: `${Math.max(5, (cvdData.sellVol / (cvdData.buyVol + cvdData.sellVol || 1)) * 100)}%` }}></div>
            </div>
          </div>

          <div className="bg-[#0a101f] rounded-xl border border-indigo-900/40 p-5 shadow-[0_0_20px_rgba(79,70,229,0.08)] relative overflow-hidden flex-grow flex flex-col justify-between">
            {botState.active && <div className="absolute top-0 left-0 w-full h-1 bg-indigo-500 animate-pulse shadow-[0_0_10px_rgba(99,102,241,1)]"></div>}
            
            <div>
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-xs font-bold flex items-center gap-2 text-slate-300 uppercase tracking-wider">
                  <Database size={14} className={botState.active ? "text-indigo-400" : "text-slate-500"} /> Paper Auto-Trader
                </h2>
                <button 
                  onClick={() => setBotState(p => ({...p, active: !p.active}))}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded text-[10px] uppercase font-bold transition-all shadow-md ${botState.active ? 'bg-rose-500/20 text-rose-400 border border-rose-500/50 hover:bg-rose-500/30' : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-[0_0_15px_rgba(79,70,229,0.4)]'}`}
                >
                  {botState.active ? <><Square size={10} fill="currentColor"/> Stop Bot</> : <><Play size={10} fill="currentColor"/> Run Bot</>}
                </button>
              </div>

              <div className="bg-[#050810] rounded-xl p-5 flex flex-col justify-center items-center mb-5 border border-slate-800/80 shadow-inner">
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-500 mb-1">Mock Portfolio</span>
                <span className="text-3xl font-mono font-black text-white tracking-tight">${botState.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>

              {botState.position ? (
                <div className="bg-indigo-900/20 rounded-xl p-4 border border-indigo-500/30">
                  <div className="flex justify-between text-xs mb-3">
                    <span className={`font-bold flex items-center gap-1.5 uppercase tracking-wide ${botState.position.type === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>
                       {botState.position.type === 'LONG' ? <TrendingUp size={14}/> : <TrendingDown size={14}/>} 
                       ACTIVE {botState.position.type}
                    </span>
                    <span className="text-slate-300 font-mono font-bold">Entry: ${botState.position.entry.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-[11px] font-mono font-bold bg-[#060a14] p-3 rounded-lg border border-indigo-900/50 shadow-inner">
                    <span className="text-rose-400">SL: ${botState.position.sl.toFixed(2)}</span>
                    <span className="text-emerald-400">TP: ${botState.position.tp.toFixed(2)}</span>
                  </div>
                </div>
              ) : (
                <div className="text-center text-[11px] font-medium text-slate-500 py-6 bg-[#050810] rounded-xl border border-slate-800 border-dashed">
                  {botState.active ? (
                    <span className="flex items-center justify-center gap-2"><RefreshCw size={14} className="animate-spin text-indigo-500"/> Sniffing Order Flow...</span>
                  ) : "Bot is currently offline."}
                </div>
              )}
            </div>

            <div className="text-center text-[9px] text-slate-600 mt-5 uppercase tracking-widest font-bold">
              Data feed active. Network bypass operational.
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <V3FlowTerminal />
    </ErrorBoundary>
  );
}