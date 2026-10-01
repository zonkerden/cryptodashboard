import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ComposedChart, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Bar, Line, Cell } from 'recharts';
import { Activity, Server, Target, RefreshCw, Terminal, Cpu, RotateCcw } from 'lucide-react';

const MOCK_APP_ID = "v3-flow-terminal-master-live"; 

// 1. PURE FUNCTION RENDERERS (No JSX Props injection to prevent React 18 crashes)
const renderCustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length > 0) {
    const data = payload[0].payload;
    if (!data) return null;
    return (
      <div className="bg-[#09090b] border border-slate-800 p-3 rounded-lg shadow-xl font-mono text-xs text-slate-200 z-50">
        <div className="text-slate-400 mb-2 border-b border-slate-800 pb-1">
          {new Date(data.timestamp || Date.now()).toLocaleTimeString()}
        </div>
        <div className="flex justify-between gap-6"><span className="text-slate-500">Open:</span> <span>${(data.open || 0).toFixed(2)}</span></div>
        <div className="flex justify-between gap-6"><span className="text-slate-500">High:</span> <span className="text-emerald-400">${(data.high || 0).toFixed(2)}</span></div>
        <div className="flex justify-between gap-6"><span className="text-slate-500">Low:</span> <span className="text-rose-400">${(data.low || 0).toFixed(2)}</span></div>
        <div className="flex justify-between gap-6"><span className="text-slate-500">Close:</span> <span>${(data.close || 0).toFixed(2)}</span></div>
        <div className="flex justify-between gap-6 mt-1 pt-1 border-t border-slate-800"><span className="text-slate-500">Vol:</span> <span>{(data.vol || 0).toFixed(2)}</span></div>
        <div className="flex justify-between gap-6 mt-1"><span className="text-purple-400">VWAP:</span> <span className="text-purple-400">${(data.vwap || 0).toFixed(2)}</span></div>
      </div>
    );
  }
  return null;
};

const renderCandlestick = (props) => {
  const { x, y, width, height, payload } = props;
  
  if (x === undefined || y === undefined || width === undefined || height === undefined) return <g></g>;
  if (!payload || payload.open === undefined || payload.high === undefined) return <g></g>;
  
  const isGreen = payload.close >= payload.open;
  const color = isGreen ? '#10B981' : '#F43F5E';
  
  const range = payload.high - payload.low;
  if (range <= 0) return <g></g>;
  
  const openPct = (payload.high - payload.open) / range;
  const closePct = (payload.high - payload.close) / range;
  
  const openY = y + (height * openPct);
  const closeY = y + (height * closePct);
  
  const boxTop = Math.min(openY, closeY);
  const boxHeight = Math.max(Math.abs(openY - closeY), 1.5);
  
  return (
    <g>
      <line x1={x + width / 2} y1={y} x2={x + width / 2} y2={y + height} stroke={color} strokeWidth={1.5} opacity={0.8} />
      <rect x={x + width * 0.15} y={boxTop} width={width * 0.7} height={boxHeight} fill={color} stroke={color} strokeWidth={1} rx={1} />
    </g>
  );
};

export default function App() {
  const [coin, setCoin] = useState('BTC');
  const [timeframe, setTimeframe] = useState('5m');
  const [status, setStatus] = useState('CONNECTING WSS...');
  
  const [data, setData] = useState([]);
  const [livePrice, setLivePrice] = useState(0);
  const [optionsData, setOptionsData] = useState({ pcr: 0.58, maxPain: 0, bias: 'Neutral', callVol: 100, putVol: 58 });
  
  const [showIndicators, setShowIndicators] = useState({
    vpvr: true, vwap: true, sr: true, maxPain: true
  });

  const [cloudState, setCloudState] = useState({
    balance: 10000,
    activeTrade: null,
    isRunning: false,
    history: []
  });

  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const volumeRef = useRef({ sessionCVD: 0, instantDelta: 0 });
  const instantDeltaTimerRef = useRef(null);

  // 2. STABLE INITIALIZATION
  useEffect(() => {
    document.title = "V3 FlowTerminal | Institutional Flow";

    if (!document.getElementById('tailwind-script')) {
      const script = document.createElement('script');
      script.id = 'tailwind-script';
      script.src = 'https://cdn.tailwindcss.com';
      document.head.appendChild(script);
    }

    if (!document.getElementById('premium-css')) {
      const style = document.createElement('style');
      style.id = 'premium-css';
      style.innerHTML = `
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700;800&family=Inter:wght@400;600;800&display=swap');
        body { font-family: 'Inter', sans-serif; background-color: #020617; margin: 0; padding: 0; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(2, 6, 23, 0.5); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(99, 102, 241, 0.4); border-radius: 4px; box-shadow: 0 0 10px rgba(99, 102, 241, 0.5); }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(99, 102, 241, 0.8); }
        .scanlines {
          background: linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0,0,0,0.1) 50%, rgba(0,0,0,0.1));
          background-size: 100% 4px;
          position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          pointer-events: none; z-index: 50; opacity: 0.15; 
        }
        .tech-grid {
          background-image: linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px),
                            linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px);
          background-size: 30px 30px;
        }
      `;
      document.head.appendChild(style);
    }

    try {
      const saved = localStorage.getItem(`bot_state_${MOCK_APP_ID}`);
      if (saved) {
        setCloudState(JSON.parse(saved));
      }
    } catch (e) {
      localStorage.removeItem(`bot_state_${MOCK_APP_ID}`);
    }
  }, []);

  const saveToCloud = (newState) => {
    setCloudState(newState);
    try {
      localStorage.setItem(`bot_state_${MOCK_APP_ID}`, JSON.stringify(newState));
    } catch (e) {
      console.error("Save failed", e);
    }
  };

  const executeReset = () => {
    saveToCloud({ balance: 10000, activeTrade: null, isRunning: false, history: [] });
    setShowResetConfirm(false);
  };

  // 3. DERIBIT OPTIONS POLLING
  useEffect(() => {
    let isMounted = true;
    const fetchDeribit = async () => {
      try {
        const fetchCurrency = coin === 'BTC' || coin === 'ETH' ? coin : 'USDC';
        const res = await fetch(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${fetchCurrency}&kind=option`);
        const json = await res.json();
        
        if (!json.result) throw new Error("API Error");
        const opts = json.result;

        let callVol = 0; let putVol = 0;
        let strikeOI = {};

        opts.forEach(item => {
          if (fetchCurrency === 'USDC' && !item.instrument_name.startsWith(coin)) return;
          const parts = item.instrument_name.split('-');
          if (parts.length === 4) {
            const strike = parseFloat(parts[2]);
            const type = parts[3];
            
            if (type === 'C') callVol += item.volume;
            if (type === 'P') putVol += item.volume;
            strikeOI[strike] = (strikeOI[strike] || 0) + item.open_interest;
          }
        });

        const pcrVal = callVol > 0 ? (putVol / callVol) : 1;
        let maxPain = 0; let maxOI = 0;
        Object.keys(strikeOI).forEach(strike => {
          if (strikeOI[strike] > maxOI) {
            maxOI = strikeOI[strike];
            maxPain = parseFloat(strike);
          }
        });

        const bias = pcrVal < 0.7 ? 'Bullish' : pcrVal > 1 ? 'Bearish' : 'Neutral';
        if (isMounted) {
          setOptionsData({ 
            pcr: parseFloat(pcrVal.toFixed(2)), 
            maxPain: maxPain || (coin === 'BTC' ? 65000 : coin === 'ETH' ? 3500 : 150), 
            bias,
            callVol: callVol || 100,
            putVol: putVol || 58
          });
        }
      } catch (e) {
        if (isMounted) setOptionsData({ pcr: 0.58, maxPain: coin === 'BTC' ? 64500 : coin === 'ETH' ? 3500 : 150, bias: 'Bullish', callVol: 100, putVol: 58 });
      }
    };
    
    fetchDeribit();
    const int = setInterval(fetchDeribit, 300000); 
    return () => { isMounted = false; clearInterval(int); };
  }, [coin]);

  // 4. WEBSOCKET ENGINE (BINANCE)
  useEffect(() => {
    let isMounted = true;
    let ws = null;

    setData([]); 
    volumeRef.current = { sessionCVD: 0, instantDelta: 0 };
    if (instantDeltaTimerRef.current) clearInterval(instantDeltaTimerRef.current);

    setStatus('CONNECTING WSS...');

    const symbol = `${coin}USDT`.toLowerCase();
    const streams = `${symbol}@trade/${symbol}@kline_${timeframe}`;
    
    ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

    ws.onopen = () => {
      if (isMounted) setStatus('SECURED: BINANCE INSTITUTIONAL WSS');
    };

    ws.onmessage = (event) => {
      if (!isMounted) return;
      try {
        const msg = JSON.parse(event.data);
        if (!msg.data) return;
        
        const payload = msg.data;

        if (payload.e === 'trade') {
          const price = parseFloat(payload.p) || 0;
          const qty = (parseFloat(payload.q) || 0) * price;
          const isSell = payload.m; 
          
          if (price > 0) setLivePrice(price);

          if (qty > 50000) { 
            if (isSell) { 
              volumeRef.current.sessionCVD -= qty;
              volumeRef.current.instantDelta -= qty;
            } else { 
              volumeRef.current.sessionCVD += qty;
              volumeRef.current.instantDelta += qty;
            }
          }
        }

        if (payload.e === 'kline') {
          const k = payload.k;
          
          setData(prevData => {
            const high = parseFloat(k.h) || 0;
            const low = parseFloat(k.l) || 0;
            const close = parseFloat(k.c) || 0;
            const open = parseFloat(k.o) || 0;
            const vol = parseFloat(k.v) || 0;
            const typ = (high + low + close) / 3;
            const timestamp = parseInt(k.t);

            if (prevData.length === 0) {
                return [{
                    timestamp, open, high, low, close, vol,
                    candleRange: [low, high],
                    vwap: close,
                    cumulativeVolume: vol,
                    cumulativeTypicalPriceVolume: (typ * vol)
                }];
            }
            
            const newData = [...prevData];
            const last = newData[newData.length - 1];
            
            if (timestamp === last.timestamp) {
              const prevCandle = newData.length > 1 ? newData[newData.length - 2] : null;
              let cumVol = prevCandle ? prevCandle.cumulativeVolume + vol : vol;
              let cumTypVol = prevCandle ? prevCandle.cumulativeTypicalPriceVolume + (typ * vol) : (typ * vol);
              
              newData[newData.length - 1] = {
                timestamp, open, high, low, close, vol,
                candleRange: [low, high],
                vwap: cumVol > 0 ? (cumTypVol / cumVol) : close,
                cumulativeVolume: cumVol,
                cumulativeTypicalPriceVolume: cumTypVol
              };
            } else if (timestamp > last.timestamp) {
              const cumVol = last.cumulativeVolume + vol;
              const cumTypVol = last.cumulativeTypicalPriceVolume + (typ * vol);
              
              newData.push({
                timestamp, open, high, low, close, vol,
                candleRange: [low, high],
                vwap: cumVol > 0 ? (cumTypVol / cumVol) : close,
                cumulativeVolume: cumVol,
                cumulativeTypicalPriceVolume: cumTypVol
              });
              
              if (newData.length > 100) newData.shift();
            }
            
            return newData;
          });
        }
      } catch (e) {
        // Safe catch
      }
    };
    
    ws.onerror = () => {
      if (isMounted) setStatus('ERROR: CONNECTION LOST');
    };

    instantDeltaTimerRef.current = setInterval(() => {
      volumeRef.current.instantDelta = 0;
    }, 20000);

    return () => {
      isMounted = false;
      if (ws) ws.close();
      if (instantDeltaTimerRef.current) clearInterval(instantDeltaTimerRef.current);
    };
  }, [coin, timeframe]);

  // 5. MEMOIZED DATA COMPUTATIONS
  const vpvrData = useMemo(() => {
    if (!data || data.length === 0) return [];
    const bins = {};
    const maxHigh = Math.max(...data.map(d => d.high));
    const minLow = Math.min(...data.map(d => d.low).filter(n => n > 0));
    
    const validMax = isNaN(maxHigh) ? 0 : maxHigh;
    const validMin = (isNaN(minLow) || minLow === Infinity) ? 0 : minLow;
    
    const range = validMax - validMin;
    const binSize = range / 30 || 1; 

    data.forEach(candle => {
      if (!candle.close) return;
      const bin = Math.floor(candle.close / binSize) * binSize;
      if (!bins[bin]) bins[bin] = { price: bin, buyVol: 0, sellVol: 0 };
      
      if (candle.close >= candle.open) bins[bin].buyVol += candle.vol;
      else bins[bin].sellVol += candle.vol;
    });
    return Object.values(bins);
  }, [data]);

  const highest = useMemo(() => {
    if (data.length === 0) return 0;
    const max = Math.max(...data.map(d => d.high));
    return isNaN(max) ? 0 : max;
  }, [data]);
  
  const lowest = useMemo(() => {
    if (data.length === 0) return 0;
    const min = Math.min(...data.map(d => d.low).filter(n => n > 0));
    return (min === Infinity || isNaN(min)) ? 0 : min;
  }, [data]);

  const yAxisDomain = useMemo(() => {
    if (highest === 0 || lowest === 0) return [0, 100];
    const buffer = (highest - lowest) * 0.15; 
    return [lowest - buffer, highest + buffer];
  }, [highest, lowest]);

  const maxVol = useMemo(() => {
    if (data.length === 0) return 0;
    const max = Math.max(...data.map(d => d.vol));
    return isNaN(max) ? 0 : max;
  }, [data]);

  const scoreEngine = useMemo(() => {
    let longScore = 0;
    let shortScore = 0;
    let currentVwap = data.length > 0 ? data[data.length - 1].vwap : livePrice;

    const safeLowest = lowest > 0 ? lowest : 1;
    const safeHighest = highest > 0 ? highest : 1;

    const distToSupport = Math.abs(livePrice - safeLowest) / safeLowest;
    const distToResistance = Math.abs(safeHighest - livePrice) / safeHighest;

    const atSupport = distToSupport < 0.005; 
    const atResistance = distToResistance < 0.005; 

    if (atSupport) longScore += 2;
    if (atResistance) shortScore += 2;

    const strongBuyDelta = volumeRef.current.instantDelta > 50000;
    const strongSellDelta = volumeRef.current.instantDelta < -50000;
    
    if (atSupport && strongBuyDelta) longScore += 2;
    if (atResistance && strongSellDelta) shortScore += 2;

    if (livePrice > currentVwap) longScore += 1;
    if (livePrice < currentVwap) shortScore += 1;
    
    if (optionsData.bias === 'Bullish') longScore += 1;
    if (optionsData.bias === 'Bearish') shortScore += 1;

    const isLongSetup = longScore >= shortScore;
    const finalScore = Math.max(longScore, shortScore);

    return {
      score: finalScore,
      type: isLongSetup ? 'LONG' : 'SHORT',
      conditions: [
        { label: 'Price Location', value: atSupport ? 'Support Bound' : atResistance ? 'Resistance Bound' : 'Mid-Range', good: atSupport || atResistance },
        { label: 'Trend Align (VWAP)', value: isLongSetup && livePrice > currentVwap ? 'Bullish' : (!isLongSetup && livePrice < currentVwap ? 'Bearish' : 'Fighting Trend'), good: (isLongSetup && livePrice > currentVwap) || (!isLongSetup && livePrice < currentVwap) },
        { label: 'Tape Flow', value: isLongSetup && strongBuyDelta ? 'Buyer Step-in' : (!isLongSetup && strongSellDelta ? 'Seller Step-in' : 'Neutral Tape'), good: (isLongSetup && strongBuyDelta) || (!isLongSetup && strongSellDelta) },
        { label: 'Options Bias', value: optionsData.bias, good: (isLongSetup && optionsData.bias === 'Bullish') || (!isLongSetup && optionsData.bias === 'Bearish') }
      ]
    };
  }, [livePrice, lowest, highest, optionsData, data.length]);

  // 6. AUTO-TRADER EXECUTION
  useEffect(() => {
    if (!cloudState.activeTrade || !cloudState.isRunning || livePrice === 0) return;

    const trade = cloudState.activeTrade;
    let closed = false;
    let pnl = 0;
    let result = '';
    let exitPrice = 0;

    if (trade.type === 'LONG') {
      if (livePrice >= trade.tp) { closed = true; pnl = (cloudState.balance * 0.03); result = 'SUCCESS'; exitPrice = trade.tp; }
      else if (livePrice <= trade.sl) { closed = true; pnl = -(cloudState.balance * 0.015); result = 'FAIL'; exitPrice = trade.sl; }
    } 
    else if (trade.type === 'SHORT') {
      if (livePrice <= trade.tp) { closed = true; pnl = (cloudState.balance * 0.03); result = 'SUCCESS'; exitPrice = trade.tp; }
      else if (livePrice >= trade.sl) { closed = true; pnl = -(cloudState.balance * 0.015); result = 'FAIL'; exitPrice = trade.sl; }
    }

    if (closed) {
      const newLog = { 
        id: Date.now(), 
        timestamp: Date.now(),
        pair: trade.pair, 
        type: trade.type, 
        entryPrice: trade.entry,
        exitPrice: exitPrice,
        pnl, 
        result 
      };
      const newHistory = [newLog, ...(cloudState.history || [])].slice(0, 15);
      
      saveToCloud({
        ...cloudState,
        balance: cloudState.balance + pnl,
        activeTrade: null,
        history: newHistory
      });
    }
  }, [livePrice, cloudState]);

  useEffect(() => {
    if (cloudState.isRunning && !cloudState.activeTrade && scoreEngine.score >= 5 && livePrice > 0) {
      const type = scoreEngine.type;
      saveToCloud({
        ...cloudState,
        activeTrade: {
          pair: coin,
          type: type,
          entry: livePrice,
          timestamp: Date.now(),
          sl: type === 'LONG' ? livePrice * 0.985 : livePrice * 1.015,
          tp: type === 'LONG' ? livePrice * 1.03 : livePrice * 0.97
        }
      });
    }
  }, [scoreEngine.score, scoreEngine.type, cloudState.isRunning, coin, livePrice]);

  if (data.length === 0) {
    return (
      <div className="h-screen w-full bg-[#020617] flex flex-col items-center justify-center font-mono relative overflow-hidden tech-grid">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-900/10 via-[#020617] to-[#020617]" />
        <div className="relative z-10 flex flex-col items-center">
          <div className="w-24 h-24 mb-8 relative flex items-center justify-center">
            <div className="absolute inset-0 border-t-2 border-indigo-500 rounded-full animate-spin"></div>
            <div className="absolute inset-2 border-r-2 border-cyan-400 rounded-full animate-[spin_2s_reverse_infinite]"></div>
            <div className="absolute inset-4 border-b-2 border-purple-500 rounded-full animate-spin"></div>
            <Cpu className="text-indigo-400 animate-pulse" size={24} />
          </div>
          <div className="text-cyan-400 font-extrabold tracking-[0.3em] text-xs uppercase flex items-center gap-3 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]">
            {status}
          </div>
        </div>
      </div>
    );
  }

  const totalOptionsVol = (optionsData.callVol || 0) + (optionsData.putVol || 0);
  const callPct = totalOptionsVol > 0 ? (optionsData.callVol / totalOptionsVol) * 100 : 50;
  const putPct = totalOptionsVol > 0 ? (optionsData.putVol / totalOptionsVol) * 100 : 50;

  return (
    <div className="h-screen w-full bg-[#020617] text-slate-200 font-sans overflow-y-auto lg:overflow-hidden flex flex-col lg:flex-row relative selection:bg-indigo-500/30 tech-grid">
      <div className="scanlines"></div>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-900/10 via-[#020617]/80 to-[#020617] pointer-events-none -z-10" />
      
      <div className="flex-none lg:flex-1 h-[55vh] lg:h-full flex flex-col p-3 lg:p-6 lg:pr-4 relative z-10 overflow-hidden">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-4 lg:mb-6 gap-3 lg:gap-0">
          <div className="w-full md:w-auto">
            <div className="flex items-center gap-3 mb-3 lg:mb-4">
              <div className="p-2 bg-[#09090b] border border-white/5 rounded-lg shadow-inner">
                <Terminal className="text-indigo-400" size={20} />
              </div>
              <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tighter text-white drop-shadow-md">V3 Flow<span className="text-indigo-500">Terminal</span></h1>
            </div>
            
            <div className="flex flex-wrap gap-2 mb-2 bg-[#09090b]/80 p-1.5 rounded-lg border border-white/5 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_30px_rgba(0,0,0,0.5)] w-full md:w-fit">
              {['BTC', 'ETH', 'SOL'].map(c => (
                <button key={c} onClick={() => setCoin(c)} className={`px-4 py-1.5 text-xs font-bold rounded transition-all ${coin === c ? 'bg-indigo-600 shadow-[0_0_15px_rgba(79,70,229,0.5)] text-white' : 'text-slate-400 hover:text-slate-300 hover:bg-white/5'}`}>{c}</button>
              ))}
              <div className="w-px bg-white/10 mx-1 hidden sm:block"></div>
              {['1m', '5m', '15m', '1h', '4h'].map(t => (
                <button key={t} onClick={() => setTimeframe(t)} className={`px-3 py-1.5 text-xs font-bold rounded transition-all ${timeframe === t ? 'bg-slate-800 text-slate-200 shadow-md border border-white/10' : 'text-slate-400 hover:text-slate-300 hover:bg-white/5'}`}>{t}</button>
              ))}
            </div>
          </div>
          
          <div className="text-left md:text-right flex flex-col items-start md:items-end w-full md:w-auto">
            <div className={`text-4xl lg:text-5xl font-mono font-black tracking-tighter transition-colors ${data[data.length-1].close >= data[data.length-1].open ? 'text-emerald-400 drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'text-rose-500 drop-shadow-[0_0_15px_rgba(244,63,94,0.3)]'}`}>
              ${livePrice.toLocaleString('en-US', {minimumFractionDigits: 2})}
            </div>
            <div className={`flex items-center gap-2 px-3 py-1 bg-[#09090b] border border-white/5 rounded-full text-[10px] font-bold tracking-widest mt-2 lg:mt-3 uppercase shadow-inner ${status.includes('ERROR') ? 'text-rose-500' : 'text-emerald-400'}`}>
              <RefreshCw size={12} className={status.includes('SECURED') || status.includes('CONNECTING') || status.includes('ROUTING') ? 'animate-spin' : ''} />
              {status}
            </div>
          </div>
        </div>

        <div className="flex-1 bg-[#09090b]/90 backdrop-blur-2xl rounded-2xl border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_20px_40px_rgba(0,0,0,0.5)] relative overflow-hidden">
          {showIndicators.vpvr && vpvrData.length > 0 && (
            <div className="absolute top-0 right-[35px] lg:right-[40px] h-full w-[35%] opacity-40 pointer-events-none z-0">
              {vpvrData.map((bin, i) => {
                const tv = Math.max(...vpvrData.map(b => b.buyVol + b.sellVol), 1);
                const widthPct = ((bin.buyVol + bin.sellVol) / tv) * 100;
                const bp = (bin.buyVol / (bin.buyVol + bin.sellVol)) * 100;
                const r = yAxisDomain[1] - yAxisDomain[0];
                const topPct = ((yAxisDomain[1] - bin.price) / r) * 100;
                
                return (
                  <div key={i} className="absolute right-0 flex h-[6px] justify-end items-center -translate-y-1/2" style={{ top: `${topPct}%`, width: `${widthPct}%` }}>
                    <div className="h-full bg-[#10B981]" style={{ width: `${bp}%` }} />
                    <div className="h-full bg-[#F43F5E]" style={{ width: `${100 - bp}%` }} />
                  </div>
                );
              })}
            </div>
          )}

          <ResponsiveContainer width="100%" height="100%" className="z-10 relative">
            <ComposedChart data={data} margin={{ top: 20, right: 10, left: 0, bottom: 20 }}>
              <defs>
                <linearGradient id="colorVolBuy" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10B981" stopOpacity={0.6}/>
                  <stop offset="100%" stopColor="#10B981" stopOpacity={0.0}/>
                </linearGradient>
                <linearGradient id="colorVolSell" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F43F5E" stopOpacity={0.6}/>
                  <stop offset="100%" stopColor="#F43F5E" stopOpacity={0.0}/>
                </linearGradient>
              </defs>

              <XAxis dataKey="timestamp" hide />
              <YAxis yAxisId="price" domain={yAxisDomain} allowDataOverflow={true} orientation="right" tick={{fill: '#cbd5e1', fontSize: 11, fontFamily: 'monospace'}} axisLine={false} tickLine={false} />
              <YAxis yAxisId="vol" domain={[0, maxVol * 4]} hide />
              
              <Tooltip cursor={{stroke: '#334155', strokeWidth: 1, strokeDasharray: '4 4'}} content={renderCustomTooltip} isAnimationActive={false} />
              
              <Bar yAxisId="vol" dataKey="vol" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.close >= entry.open ? "url(#colorVolBuy)" : "url(#colorVolSell)"} />
                ))}
              </Bar>
              
              <Bar yAxisId="price" dataKey="candleRange" shape={renderCandlestick} isAnimationActive={false} />
              
              {showIndicators.vwap && (
                <Line 
                  yAxisId="price" 
                  type="monotone" 
                  dataKey="vwap" 
                  stroke="#a855f7" 
                  strokeWidth={3} 
                  strokeDasharray="4 4" 
                  dot={false} 
                  isAnimationActive={false} 
                  style={{filter: 'drop-shadow(0px 0px 8px rgba(168,85,247,0.8))'}}
                />
              )}
              
              {showIndicators.sr && <ReferenceLine yAxisId="price" y={highest} stroke="#F43F5E" strokeWidth={1} strokeDasharray="5 5" strokeOpacity={0.8} ifOverflow="extendDomain" />}
              {showIndicators.sr && <ReferenceLine yAxisId="price" y={lowest} stroke="#10B981" strokeWidth={1} strokeDasharray="5 5" strokeOpacity={0.8} ifOverflow="extendDomain" />}
              
              {showIndicators.maxPain && optionsData.maxPain > 0 && (
                <ReferenceLine 
                  yAxisId="price" 
                  y={optionsData.maxPain} 
                  stroke="#fbbf24" 
                  strokeWidth={2} 
                  strokeDasharray="4 4"
                  label={{ position: 'insideTopLeft', value: `MAX PAIN: $${optionsData.maxPain.toLocaleString()}`, fill: '#fbbf24', fontSize: 11, fontWeight: 'bold' }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="w-full lg:w-[400px] shrink-0 h-auto lg:h-full p-3 lg:p-6 lg:pl-2 overflow-y-visible lg:overflow-y-auto flex flex-col gap-4 custom-scrollbar relative z-10 pb-12 lg:pb-6">
        <div className="shrink-0 bg-[#09090b] rounded-xl border border-white/5 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_30px_rgba(0,0,0,0.5)]">
          <h2 className="text-[11px] font-black text-slate-300 mb-4 flex items-center gap-2 tracking-[0.2em] uppercase drop-shadow-sm">
            <Target size={14} className="text-indigo-400"/> Order Flow Engine
          </h2>
          <div className="flex flex-wrap gap-2">
            {Object.keys(showIndicators).map(key => (
              <button key={key} onClick={() => setShowIndicators(prev => ({...prev, [key]: !prev[key]}))} className={`px-3 py-1.5 text-[10px] font-black tracking-[0.15em] uppercase rounded transition-all ${showIndicators[key] ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/40 shadow-[0_0_15px_rgba(79,70,229,0.15)]' : 'bg-[#020617] text-slate-400 border border-white/5 hover:border-white/10 hover:text-slate-300'}`}>
                {key}
              </button>
            ))}
          </div>
        </div>

        <div className="shrink-0 bg-[#09090b] rounded-xl border border-white/5 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_30px_rgba(0,0,0,0.5)]">
          <div className="flex justify-between items-end mb-4">
            <span className="text-[11px] text-slate-300 font-black tracking-[0.2em] uppercase">
              Algorithmic Score <span className={`ml-1 ${scoreEngine.type === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>[{scoreEngine.type}]</span>
            </span>
            <span className="text-2xl font-mono font-black text-white drop-shadow-md">{scoreEngine.score} <span className="text-slate-600 text-lg">/ 6</span></span>
          </div>
          
          <div className="space-y-2">
            {scoreEngine.conditions.map((cond, i) => (
              <div key={i} className="flex justify-between items-center p-2 rounded bg-[#020617] border border-white/5 shadow-inner">
                <span className="text-[11px] text-slate-400 font-bold tracking-wider">{cond.label}</span>
                <div className={`px-2 py-0.5 rounded-full text-[10px] font-black tracking-widest uppercase border ${cond.good ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.15)]' : 'bg-slate-800/50 border-slate-700/50 text-slate-500'}`}>
                  {cond.value}
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="shrink-0 bg-[#09090b] rounded-xl border border-white/5 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_30px_rgba(0,0,0,0.5)]">
          <h2 className="text-[11px] font-black text-slate-300 mb-4 flex items-center gap-2 tracking-[0.2em] uppercase drop-shadow-sm">
            <Activity size={14} className="text-amber-400"/> Institutional Options
          </h2>
          
          <div className="mb-5">
            <div className="flex justify-between items-end mb-2">
              <span className="text-[10px] text-slate-300 font-bold tracking-[0.1em] uppercase">Put/Call Ratio</span>
              <span className={`text-xl font-mono font-black tracking-tighter ${optionsData.pcr < 0.7 ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]' : 'text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.3)]'}`}>{optionsData.pcr}</span>
            </div>
            <div className="w-full h-2 bg-[#020617] rounded-full overflow-hidden flex shadow-inner border border-white/5">
              <div className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.6)] transition-all duration-1000" style={{ width: `${callPct}%` }}></div>
              <div className="h-full bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.6)] transition-all duration-1000" style={{ width: `${putPct}%` }}></div>
            </div>
            <div className="flex justify-between text-[9px] text-slate-400 font-bold tracking-widest uppercase mt-1.5">
              <span>Calls ({Math.round(callPct)}%)</span>
              <span>Puts ({Math.round(putPct)}%)</span>
            </div>
          </div>

          <div className="flex justify-between items-center p-3 rounded-lg bg-[#020617] border border-amber-500/20 shadow-[inset_0_0_10px_rgba(245,158,11,0.05)]">
            <span className="text-[11px] text-amber-500/80 font-bold tracking-widest uppercase">Max Pain Strike</span>
            <span className="text-lg font-mono font-black text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.3)]">
              ${(optionsData.maxPain || 0).toLocaleString()}
            </span>
          </div>
        </div>

        <div className="shrink-0 min-h-[350px] bg-[#09090b] rounded-xl border border-indigo-500/30 p-5 shadow-[0_0_30px_rgba(79,70,229,0.1),inset_0_1px_0_rgba(255,255,255,0.05)] flex flex-col relative overflow-hidden mb-8 lg:mb-0">
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-cyan-400 via-indigo-500 to-purple-500 shadow-[0_0_10px_rgba(99,102,241,0.8)]"></div>
          
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-[11px] font-black text-slate-300 flex items-center gap-2 tracking-[0.2em] uppercase drop-shadow-sm">
              <Server size={14} className="text-indigo-400"/> Cloud Auto-Trader
            </h2>
            
            {showResetConfirm ? (
              <div className="flex items-center gap-2">
                <button 
                  onClick={executeReset}
                  className="px-2 py-0.5 bg-rose-600 text-white rounded text-[9px] font-bold tracking-widest uppercase transition-all shadow-lg"
                >
                  Confirm Wipe
                </button>
                <button 
                  onClick={() => setShowResetConfirm(false)}
                  className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded text-[9px] font-bold tracking-widest uppercase transition-all"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button 
                onClick={() => setShowResetConfirm(true)}
                className="flex items-center gap-1.5 px-2 py-1 bg-[#020617] text-slate-400 hover:text-rose-400 border border-white/5 hover:border-rose-500/30 rounded text-[9px] font-bold tracking-widest uppercase transition-all shadow-inner"
                title="Reset Portfolio Balance & History"
              >
                <RotateCcw size={10} /> Reset
              </button>
            )}
          </div>
          
          <div className="flex justify-between items-end mb-5 bg-[#020617] p-4 rounded-lg border border-white/5 shadow-inner">
            <div>
              <div className="text-[10px] text-slate-300 mb-1 font-bold tracking-[0.2em] uppercase">Portfolio Balance</div>
              <div className="text-3xl font-mono font-black tracking-tighter text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">${(cloudState.balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
            </div>
            {cloudState.activeTrade && (
              <div className="text-right">
                <div className={`text-[10px] font-black mb-1 tracking-[0.2em] animate-pulse ${cloudState.activeTrade.type === 'LONG' ? 'text-emerald-400 drop-shadow-[0_0_5px_rgba(16,185,129,0.8)]' : 'text-rose-400 drop-shadow-[0_0_5px_rgba(244,63,94,0.8)]'}`}>
                  ACTIVE {cloudState.activeTrade.type}
                </div>
                <div className="text-[11px] font-mono font-bold text-slate-300 border border-slate-700/50 px-1.5 py-0.5 rounded bg-slate-900/50">EP: ${(cloudState.activeTrade.entry || 0).toFixed(2)}</div>
              </div>
            )}
          </div>

          <button 
            onClick={() => saveToCloud({...cloudState, isRunning: !cloudState.isRunning})}
            className={`w-full py-4 rounded-lg font-black text-[11px] tracking-[0.3em] uppercase transition-all shadow-lg border ${cloudState.isRunning ? 'bg-[#020617] text-rose-500 border-rose-500/40 hover:border-rose-500/70 hover:bg-rose-950/30 shadow-[0_0_15px_rgba(244,63,94,0.15)]' : 'bg-indigo-600 text-white hover:bg-indigo-500 border-indigo-400/50 shadow-[0_0_20px_rgba(79,70,229,0.3)] hover:shadow-[0_0_30px_rgba(79,70,229,0.5)]'}`}
          >
            {cloudState.isRunning ? '■ HALT ALGORITHM' : '▶ DEPLOY PAPER BOT'}
          </button>

          {cloudState.history && cloudState.history.length > 0 && (
            <div className="mt-5 pt-5 border-t border-white/5 flex-1 flex flex-col">
              <div className="text-[10px] text-slate-300 mb-3 font-black tracking-[0.2em] uppercase flex items-center justify-between">
                <span>Execution Ledger</span>
                <span className="bg-[#020617] px-2 py-0.5 rounded text-slate-300 border border-white/5 shadow-inner">
                  {cloudState.history.filter(t => t.result === 'SUCCESS').length}W - {cloudState.history.filter(t => t.result === 'FAIL').length}L
                </span>
              </div>
              <div className="max-h-[120px] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                {cloudState.history.map((log) => (
                  <div key={log.id} className="flex justify-between items-center text-xs bg-slate-900/50 p-2.5 rounded-lg border border-white/5 hover:bg-slate-800/50 transition-colors">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold text-slate-200">{log.pair}</span>
                        <span className="text-[8px] text-slate-500 font-mono tracking-wider">
                          {new Date(log.timestamp || log.id).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <span className={`text-[9px] font-bold tracking-widest uppercase ${log.result === 'SUCCESS' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {log.type} • {log.result}
                      </span>
                    </div>
                    <div className="flex flex-col items-end text-right">
                      <span className={`font-mono font-bold tracking-tighter text-sm ${log.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {log.pnl >= 0 ? '+' : ''}${(log.pnl || 0).toFixed(2)}
                      </span>
                      {log.entryPrice ? (
                        <span className="text-[9px] text-slate-300 font-mono mt-1 font-semibold bg-slate-950/50 px-1.5 py-0.5 rounded border border-white/5 shadow-inner">
                          Entry: ${log.entryPrice.toFixed(2)} → Sell: ${(log.exitPrice || 0).toFixed(2)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
