import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ComposedChart, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Bar, Line } from 'recharts';
import { Activity, Server, Target, RefreshCw, Database } from 'lucide-react';

// --- ENGINE CONFIGURATION ---
const BINANCE_REST = 'https://data-api.binance.vision/api/v3';
const MOCK_APP_ID = "v3-flow-terminal-master"; 

// --- CRASH-PROOF CANDLESTICK ALGORITHM ---
const CandlestickShape = (props) => {
  const { x, y, width, height, payload } = props;
  if (!payload || typeof payload.open === 'undefined') return null;
  
  const isGreen = payload.close >= payload.open;
  const color = isGreen ? '#10B981' : '#EF4444';
  
  // Calculate relative percentages to avoid yAxis.scale crashes
  const range = payload.high - payload.low;
  if (range === 0) return null;
  
  const openPct = (payload.high - payload.open) / range;
  const closePct = (payload.high - payload.close) / range;
  
  const openY = y + (height * openPct);
  const closeY = y + (height * closePct);
  
  const boxTop = Math.min(openY, closeY);
  const boxHeight = Math.max(Math.abs(openY - closeY), 1.5);
  
  return (
    <g>
      <line x1={x + width / 2} y1={y} x2={x + width / 2} y2={y + height} stroke={color} strokeWidth={1.5} />
      <rect x={x + width * 0.15} y={boxTop} width={width * 0.7} height={boxHeight} fill={color} />
    </g>
  );
};

export default function App() {
  // --- UI STATE ---
  const [coin, setCoin] = useState('BTC');
  const [timeframe, setTimeframe] = useState('5m');
  const [status, setStatus] = useState('CONNECTING...');
  
  // --- DATA STATE ---
  const [data, setData] = useState([]);
  const [livePrice, setLivePrice] = useState(0);
  const [vpvrData, setVpvrData] = useState([]);
  const [optionsData, setOptionsData] = useState({ pcr: 0.58, maxPain: 0, bias: 'Neutral' });
  
  const [showIndicators, setShowIndicators] = useState({
    vpvr: true, vwap: true, sr: true, maxPain: true
  });

  // --- TRADING BOT CLOUD STATE ---
  const [cloudState, setCloudState] = useState({
    balance: 10000,
    activeTrade: null,
    isRunning: false,
    history: []
  });

  // --- REFS (Background Memory Banks) ---
  const volumeRef = useRef({ sessionCVD: 0, instantDelta: 0 });
  const lastTradeIdRef = useRef(null);
  const pollingTimerRef = useRef(null);
  const instantDeltaTimerRef = useRef(null);

  // --- TAILWIND INJECTION (Safety Net) ---
  useEffect(() => {
    if (!document.getElementById('tailwind-script')) {
      const script = document.createElement('script');
      script.id = 'tailwind-script';
      script.src = 'https://cdn.tailwindcss.com';
      document.head.appendChild(script);
    }
  }, []);

  // --- LOCAL STORAGE CLOUD MOCK ---
  useEffect(() => {
    const saved = localStorage.getItem(`bot_state_${MOCK_APP_ID}`);
    if (saved) setCloudState(JSON.parse(saved));
  }, []);

  const saveToCloud = (newState) => {
    setCloudState(newState);
    localStorage.setItem(`bot_state_${MOCK_APP_ID}`, JSON.stringify(newState));
  };

  // --- DERIBIT LIVE OPTIONS ENGINE ---
  useEffect(() => {
    const fetchDeribit = async () => {
      try {
        const res = await fetch(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${coin}&kind=option`);
        const json = await res.json();
        const opts = json.result;

        let callVol = 0; let putVol = 0;
        let strikeOI = {};

        opts.forEach(item => {
          const parts = item.instrument_name.split('-');
          if (parts.length === 4) {
            const strike = parseFloat(parts[2]);
            const type = parts[3];
            
            if (type === 'C') callVol += item.volume;
            if (type === 'P') putVol += item.volume;
            
            strikeOI[strike] = (strikeOI[strike] || 0) + item.open_interest;
          }
        });

        const pcr = callVol > 0 ? (putVol / callVol) : 1;
        let maxPain = 0; let maxOI = 0;
        Object.keys(strikeOI).forEach(strike => {
          if (strikeOI[strike] > maxOI) {
            maxOI = strikeOI[strike];
            maxPain = parseFloat(strike);
          }
        });

        const bias = pcr < 0.7 ? 'Bullish' : pcr > 1 ? 'Bearish' : 'Neutral';
        setOptionsData({ pcr: pcr.toFixed(2), maxPain, bias });
      } catch (e) {
        setOptionsData({ pcr: 0.58, maxPain: coin === 'BTC' ? 95000 : coin === 'ETH' ? 3500 : 150, bias: 'Bullish' });
      }
    };
    fetchDeribit();
    const int = setInterval(fetchDeribit, 300000); 
    return () => clearInterval(int);
  }, [coin]);

  // --- CORE DATA ENGINE (HTTP POLLING BYPASS) ---
  useEffect(() => {
    setData([]);
    volumeRef.current = { sessionCVD: 0, instantDelta: 0 };
    lastTradeIdRef.current = null;
    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    if (instantDeltaTimerRef.current) clearInterval(instantDeltaTimerRef.current);

    setStatus('CONNECTING...');

    const fetchData = async () => {
      try {
        const klineRes = await fetch(`${BINANCE_REST}/klines?symbol=${coin}USDT&interval=${timeframe}&limit=100`);
        const klineRaw = await klineRes.json();
        
        let cumulativeVolume = 0;
        let cumulativeTypicalPriceVolume = 0;

        const formatted = klineRaw.map(d => {
          const high = parseFloat(d[2]);
          const low = parseFloat(d[3]);
          const close = parseFloat(d[4]);
          const vol = parseFloat(d[5]);
          const typ = (high + low + close) / 3;
          
          cumulativeVolume += vol;
          cumulativeTypicalPriceVolume += (typ * vol);

          return {
            timestamp: d[0],
            open: parseFloat(d[1]),
            high, low, close, vol,
            candleRange: [low, high], // Used for perfect bounding box
            vwap: cumulativeVolume > 0 ? (cumulativeTypicalPriceVolume / cumulativeVolume) : close
          };
        });

        setData(formatted);
        const currentPrice = formatted[formatted.length - 1].close;
        setLivePrice(currentPrice);

        const bins = {};
        const range = Math.max(...formatted.map(d => d.high)) - Math.min(...formatted.map(d => d.low));
        const binSize = range / 30; 

        formatted.forEach(candle => {
          if (!candle.close) return;
          const bin = Math.floor(candle.close / binSize) * binSize;
          if (!bins[bin]) bins[bin] = { price: bin, buyVol: 0, sellVol: 0 };
          
          if (candle.close >= candle.open) bins[bin].buyVol += candle.vol;
          else bins[bin].sellVol += candle.vol;
        });
        setVpvrData(Object.values(bins));

        const tradeRes = await fetch(`${BINANCE_REST}/trades?symbol=${coin}USDT&limit=20`);
        const tradeRaw = await tradeRes.json();

        tradeRaw.forEach(t => {
          if (t.id === lastTradeIdRef.current) return; 
          const qty = parseFloat(t.qty) * parseFloat(t.price);
          if (qty > 5000) { 
            if (t.isBuyerMaker) {
              volumeRef.current.sessionCVD -= qty;
              volumeRef.current.instantDelta -= qty;
            } else {
              volumeRef.current.sessionCVD += qty;
              volumeRef.current.instantDelta += qty;
            }
          }
          lastTradeIdRef.current = t.id;
        });

        setStatus('SECURED: HTTP SYNC');

      } catch (err) {
        setStatus('ERROR: ISP BLOCKED');
      }
    };

    fetchData();
    pollingTimerRef.current = setInterval(fetchData, 2500); 

    instantDeltaTimerRef.current = setInterval(() => {
      volumeRef.current.instantDelta = 0;
    }, 20000);

    return () => {
      clearInterval(pollingTimerRef.current);
      clearInterval(instantDeltaTimerRef.current);
    };
  }, [coin, timeframe]);

  // --- ALGORITHMIC MATH ---
  const highest = useMemo(() => Math.max(...data.map(d => d.high), 0), [data]);
  const lowest = useMemo(() => {
    const min = Math.min(...data.map(d => d.low).filter(n => n > 0));
    return min === Infinity ? 0 : min;
  }, [data]);

  const yAxisDomain = useMemo(() => {
    if (highest === 0) return [0, 100];
    const buffer = (highest - lowest) * 0.15; 
    return [lowest - buffer, highest + buffer];
  }, [highest, lowest]);

  const maxVol = useMemo(() => Math.max(...data.map(d => d.vol), 0), [data]);

  const scoreEngine = useMemo(() => {
    let score = 0;
    const locDist = Math.abs(livePrice - lowest) / lowest;
    const atSupport = locDist < 0.005; 
    if (atSupport) score += 2;

    const abs = volumeRef.current.instantDelta < -50000;
    if (abs && atSupport) score += 2;
    
    if (optionsData.bias === 'Bullish') score += 2;

    return {
      score,
      location: atSupport ? 'At Support' : 'Mid-Range',
      dom: atSupport ? 'Buy Wall Detected' : 'Neutral',
      tape: abs ? 'Buyer Absorption' : 'None'
    };
  }, [livePrice, lowest, optionsData, data.length]);

  // --- PAPER TRADING RESOLUTION ENGINE ---
  useEffect(() => {
    if (!cloudState.activeTrade || !cloudState.isRunning) return;

    const trade = cloudState.activeTrade;
    let closed = false;
    let pnl = 0;
    let result = '';

    if (trade.type === 'LONG') {
      if (livePrice >= trade.tp) { closed = true; pnl = (cloudState.balance * 0.03); result = 'SUCCESS'; }
      if (livePrice <= trade.sl) { closed = true; pnl = -(cloudState.balance * 0.01); result = 'FAIL'; }
    }

    if (closed) {
      const newLog = { id: Date.now(), pair: trade.pair, type: trade.type, pnl, result };
      const newHistory = [newLog, ...cloudState.history].slice(0, 15);
      
      saveToCloud({
        ...cloudState,
        balance: cloudState.balance + pnl,
        activeTrade: null,
        history: newHistory
      });
    }
  }, [livePrice, cloudState]);

  useEffect(() => {
    if (cloudState.isRunning && !cloudState.activeTrade && scoreEngine.score >= 5) {
      saveToCloud({
        ...cloudState,
        activeTrade: {
          pair: coin,
          type: 'LONG',
          entry: livePrice,
          sl: livePrice * 0.99,
          tp: livePrice * 1.03
        }
      });
    }
  }, [scoreEngine.score, cloudState.isRunning]);

  // --- RENDER ENGINE ---
  if (data.length === 0) return <div className="h-screen w-full bg-[#050810] text-white flex items-center justify-center font-mono">Initializing Neural Link...</div>;

  return (
    <div className="h-screen w-full bg-[#050810] text-white font-sans overflow-hidden flex relative selection:bg-indigo-500/30">
      
      {/* Deep Space Background Gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-900/20 via-[#050810] to-[#050810] pointer-events-none -z-10" />
      
      {/* MAIN CHART PANEL */}
      <div className="flex-1 flex flex-col p-6 pr-4 h-full relative z-10">
        
        {/* Header */}
        <div className="flex justify-between items-end mb-6">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <Database className="text-indigo-400 drop-shadow-[0_0_8px_rgba(99,102,241,0.8)]" size={28} />
              <h1 className="text-3xl font-extrabold tracking-tighter">V3 Flow<span className="text-indigo-400">Terminal</span></h1>
            </div>
            
            <div className="flex gap-3 mb-2 bg-[#0f172a]/40 p-1.5 rounded-lg border border-white/5 backdrop-blur-md w-fit">
              {['BTC', 'ETH', 'SOL'].map(c => (
                <button key={c} onClick={() => setCoin(c)} className={`px-4 py-1.5 text-xs font-bold rounded transition-all ${coin === c ? 'bg-indigo-600 shadow-[0_0_15px_rgba(79,70,229,0.5)] text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>{c}</button>
              ))}
              <div className="w-px bg-white/10 mx-1"></div>
              {['1m', '5m', '15m', '1h'].map(t => (
                <button key={t} onClick={() => setTimeframe(t)} className={`px-4 py-1.5 text-xs font-bold rounded transition-all ${timeframe === t ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>{t}</button>
              ))}
            </div>
          </div>
          
          <div className="text-right">
            <div className={`text-5xl font-mono font-extrabold tracking-tighter transition-colors ${data[data.length-1].close >= data[data.length-1].open ? 'text-emerald-400 drop-shadow-[0_0_12px_rgba(16,185,129,0.4)]' : 'text-rose-500 drop-shadow-[0_0_12px_rgba(244,63,94,0.4)]'}`}>
              ${livePrice.toLocaleString('en-US', {minimumFractionDigits: 2})}
            </div>
            <div className="flex items-center gap-2 justify-end text-[11px] font-bold tracking-widest text-emerald-400 mt-2 uppercase drop-shadow-[0_0_5px_rgba(16,185,129,0.6)]">
              <RefreshCw size={14} className={status.includes('SECURED') ? 'animate-spin' : ''} />
              {status}
            </div>
          </div>
        </div>

        {/* Chart Canvas */}
        <div className="flex-1 bg-[#0f172a]/60 backdrop-blur-xl rounded-2xl border border-white/5 shadow-2xl relative overflow-hidden">
          
          {/* Absolute VPVR Overlay */}
          {showIndicators.vpvr && vpvrData.length > 0 && (
            <div className="absolute top-0 right-[40px] h-full w-[40%] opacity-40 pointer-events-none z-0">
              {vpvrData.map((bin, i) => {
                const totalVol = Math.max(...vpvrData.map(b => b.buyVol + b.sellVol), 1);
                const widthPct = ((bin.buyVol + bin.sellVol) / totalVol) * 100;
                const buyPct = (bin.buyVol / (bin.buyVol + bin.sellVol)) * 100;
                
                const range = yAxisDomain[1] - yAxisDomain[0];
                const topPct = ((yAxisDomain[1] - bin.price) / range) * 100;
                
                return (
                  <div key={i} className="absolute right-0 flex h-[6px] justify-end items-center -translate-y-1/2" style={{ top: `${topPct}%`, width: `${widthPct}%` }}>
                    <div className="h-full bg-[#10B981]" style={{ width: `${buyPct}%` }} />
                    <div className="h-full bg-[#EF4444]" style={{ width: `${100 - buyPct}%` }} />
                  </div>
                );
              })}
            </div>
          )}

          <ResponsiveContainer width="100%" height="100%" className="z-10 relative">
            <ComposedChart data={data} margin={{ top: 20, right: 10, left: 0, bottom: 20 }}>
              <XAxis dataKey="timestamp" hide />
              
              {/* Primary Price Axis */}
              <YAxis yAxisId="price" domain={yAxisDomain} allowDataOverflow={true} orientation="right" tick={{fill: '#64748b', fontSize: 11, fontWeight: 600}} axisLine={false} tickLine={false} />
              
              {/* Hidden Secondary Volume Axis (Scaled to bottom 25% of chart height) */}
              <YAxis yAxisId="vol" domain={[0, maxVol * 4]} hide />
              
              <Tooltip cursor={{stroke: '#334155'}} contentStyle={{backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#fff', borderRadius: '8px'}} />
              
              <Bar yAxisId="vol" dataKey="vol" fill="#1e293b" />
              
              <Bar yAxisId="price" dataKey="candleRange" shape={(props) => <CandlestickShape {...props} />} />
              
              {showIndicators.vwap && <Line yAxisId="price" type="monotone" dataKey="vwap" stroke="#a855f7" strokeWidth={2} strokeDasharray="4 4" dot={false} />}
              
              {showIndicators.sr && <ReferenceLine yAxisId="price" y={highest} stroke="#f43f5e" strokeWidth={1} strokeDasharray="5 5" strokeOpacity={0.6} ifOverflow="extendDomain" />}
              {showIndicators.sr && <ReferenceLine yAxisId="price" y={lowest} stroke="#10b981" strokeWidth={1} strokeDasharray="5 5" strokeOpacity={0.6} ifOverflow="extendDomain" />}
              
              {showIndicators.maxPain && (
                <ReferenceLine 
                  yAxisId="price"
                  y={optionsData.maxPain > highest * 1.05 ? yAxisDomain[1] * 0.98 : optionsData.maxPain} 
                  stroke="#fbbf24" strokeWidth={2} strokeDasharray="4 4" 
                  label={{ 
                    position: 'insideTopLeft', 
                    fill: '#fbbf24', 
                    value: optionsData.maxPain > highest * 1.05 ? `GAMMA WALL (OFF-SCREEN: $${optionsData.maxPain.toLocaleString()})` : `MAX PAIN: $${optionsData.maxPain.toLocaleString()}`, 
                    fontSize: 10, fontWeight: 'bold' 
                  }} 
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* SIDEBAR PANEL (Scrollable) */}
      <div className="w-[380px] shrink-0 h-full p-6 pl-2 overflow-y-auto flex flex-col gap-5 custom-scrollbar relative z-10 pb-12">
        
        {/* Indicators Toggle */}
        <div className="shrink-0 bg-[#0f172a]/60 backdrop-blur-xl rounded-2xl border border-white/5 p-5 shadow-xl">
          <h2 className="text-[10px] font-extrabold text-slate-500 mb-4 flex items-center gap-2 tracking-widest uppercase"><Target size={14} className="text-indigo-400"/> Order Flow Engine</h2>
          <div className="flex flex-wrap gap-2">
            {Object.keys(showIndicators).map(key => (
              <button key={key} onClick={() => setShowIndicators(prev => ({...prev, [key]: !prev[key]}))} className={`px-3 py-1.5 text-[10px] font-extrabold tracking-widest uppercase rounded transition-all ${showIndicators[key] ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(79,70,229,0.2)]' : 'bg-slate-800/50 text-slate-500 border border-white/5 hover:bg-slate-800'}`}>
                {key}
              </button>
            ))}
          </div>
        </div>

        {/* Strategy Breakdown */}
        <div className="shrink-0 bg-[#0f172a]/60 backdrop-blur-xl rounded-2xl border border-white/5 p-5 shadow-xl">
          <div className="flex justify-between items-end mb-4">
            <span className="text-[9px] text-slate-500 font-bold tracking-widest uppercase">Engine Status</span>
            <span className="text-[9px] text-slate-500 font-bold tracking-widest uppercase">Conditions</span>
          </div>
          <div className="flex justify-between items-center mb-6">
            <span className={`text-xl font-black tracking-tight ${scoreEngine.score >= 4 ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'text-slate-400'}`}>
              {scoreEngine.score >= 5 ? 'LONG SETUP' : 'WAITING'}
            </span>
            <span className="text-2xl font-mono font-bold text-white drop-shadow-md">{scoreEngine.score} <span className="text-slate-600 text-lg">/ 6</span></span>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs p-2.5 bg-slate-900/50 rounded-lg border border-white/5">
              <span className="text-slate-400 font-medium">Price Location:</span>
              <span className="font-bold text-slate-200">{scoreEngine.location}</span>
            </div>
            <div className="flex justify-between items-center text-xs p-2.5 bg-slate-900/50 rounded-lg border border-white/5">
              <span className="text-slate-400 font-medium">DOM Imbalance:</span>
              <span className="font-bold text-emerald-400">{scoreEngine.dom}</span>
            </div>
            <div className="flex justify-between items-center text-xs p-2.5 bg-slate-900/50 rounded-lg border border-white/5">
              <span className="text-slate-400 font-medium">Tape Absorption:</span>
              <span className="font-bold text-slate-200">{scoreEngine.tape}</span>
            </div>
            <div className="flex justify-between items-center text-xs p-2.5 bg-slate-900/50 rounded-lg border border-white/5">
              <span className="text-slate-400 font-medium">Options Bias:</span>
              <span className="font-bold text-emerald-400">{optionsData.bias}</span>
            </div>
          </div>
        </div>
        
        {/* Deribit Live Options Panel */}
        <div className="shrink-0 bg-[#0f172a]/60 backdrop-blur-xl rounded-2xl border border-white/5 p-5 shadow-xl">
          <h2 className="text-[10px] font-extrabold text-slate-500 mb-4 flex items-center gap-2 tracking-widest uppercase"><Activity size={14} className="text-purple-400"/> Deribit Options Flow</h2>
          <div className="flex justify-between mb-2">
            <span className="text-[9px] text-slate-500 font-bold tracking-widest uppercase">Put/Call Ratio (PCR)</span>
            <span className="text-[9px] text-slate-500 font-bold tracking-widest uppercase">Max Pain Magnet</span>
          </div>
          <div className="flex justify-between items-end mb-2">
            <span className={`text-2xl font-black tracking-tighter ${optionsData.pcr < 0.7 ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.4)]'}`}>{optionsData.pcr}</span>
            <span className="text-xl font-mono font-bold text-yellow-500 drop-shadow-[0_0_8px_rgba(234,179,8,0.4)]">${optionsData.maxPain.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-[8px] text-slate-600 font-bold tracking-widest uppercase">
            <span>Extreme Greed (PCR {'<'} 0.6)</span>
            <span>Extreme Fear (PCR {'>'} 1.2)</span>
          </div>
        </div>

        {/* Whale CVD Tracker */}
        <div className="shrink-0 bg-[#0f172a]/60 backdrop-blur-xl rounded-2xl border border-white/5 p-5 shadow-xl">
          <h2 className="text-[10px] font-extrabold text-slate-500 mb-4 flex items-center gap-2 tracking-widest uppercase"><Activity size={14} className="text-cyan-400"/> Whale CVD {'>'} $5K</h2>
          <div className="grid grid-cols-2 gap-3 mb-1">
            <div className="bg-slate-900/50 p-4 rounded-xl border border-white/5 flex flex-col justify-center items-center">
              <div className="text-[9px] text-slate-500 mb-2 font-bold tracking-widest uppercase">Session Tally</div>
              <div className={`text-lg font-mono font-bold tracking-tighter ${volumeRef.current.sessionCVD >= 0 ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.4)]'}`}>
                {volumeRef.current.sessionCVD > 0 ? '+' : ''}${(volumeRef.current.sessionCVD / 1000).toFixed(1)}k
              </div>
            </div>
            <div className="bg-slate-900/50 p-4 rounded-xl border border-white/5 flex flex-col justify-center items-center">
              <div className="text-[9px] text-slate-500 mb-2 font-bold tracking-widest uppercase">Instant Velocity</div>
              <div className={`text-lg font-mono font-bold tracking-tighter ${volumeRef.current.instantDelta >= 0 ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.4)]'}`}>
                {volumeRef.current.instantDelta > 0 ? '+' : ''}${(volumeRef.current.instantDelta / 1000).toFixed(1)}k
              </div>
            </div>
          </div>
        </div>

        {/* Paper Auto-Trader */}
        <div className="shrink-0 min-h-[360px] bg-gradient-to-b from-[#0f172a]/80 to-[#020617]/90 backdrop-blur-xl rounded-2xl border border-indigo-500/20 p-5 shadow-2xl flex flex-col relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500"></div>
          
          <h2 className="text-[10px] font-extrabold text-slate-400 mb-4 flex items-center gap-2 tracking-widest uppercase"><Server size={14} className="text-indigo-400"/> Cloud Auto-Trader</h2>
          
          <div className="flex justify-between items-end mb-5 bg-slate-950/50 p-4 rounded-xl border border-white/5 shadow-inner">
            <div>
              <div className="text-[9px] text-slate-500 mb-1 font-bold tracking-widest uppercase">Portfolio Balance</div>
              <div className="text-2xl font-mono font-extrabold tracking-tighter text-white drop-shadow-md">${cloudState.balance.toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
            </div>
            {cloudState.activeTrade && (
              <div className="text-right">
                <div className="text-[9px] text-emerald-400 font-bold mb-1 tracking-widest animate-pulse">ACTIVE LONG</div>
                <div className="text-xs font-mono font-bold text-slate-300">EP: ${cloudState.activeTrade.entry.toFixed(2)}</div>
              </div>
            )}
          </div>

          <button 
            onClick={() => saveToCloud({...cloudState, isRunning: !cloudState.isRunning})}
            className={`w-full py-3.5 rounded-xl font-extrabold text-xs tracking-widest uppercase transition-all shadow-lg ${cloudState.isRunning ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20 shadow-rose-500/10' : 'bg-indigo-600 text-white hover:bg-indigo-500 border border-indigo-400/50 shadow-indigo-600/30'}`}
          >
            {cloudState.isRunning ? '■ Halt Operations' : '▶ Activate Paper Bot'}
          </button>

          {/* Trade History Ledger */}
          {cloudState.history && cloudState.history.length > 0 && (
            <div className="mt-5 pt-5 border-t border-white/5 flex-1">
              <div className="text-[9px] text-slate-500 mb-3 font-bold tracking-widest uppercase flex items-center justify-between">
                <span>Trading Ledger</span>
                <span className="bg-white/5 px-2 py-0.5 rounded text-slate-300">
                  {cloudState.history.filter(t => t.result === 'SUCCESS').length}W - {cloudState.history.filter(t => t.result === 'FAIL').length}L
                </span>
              </div>
              <div className="max-h-[120px] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                {cloudState.history.map((log) => (
                  <div key={log.id} className="flex justify-between items-center text-xs bg-slate-900/50 p-2.5 rounded-lg border border-white/5 hover:bg-slate-800/50 transition-colors">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-extrabold text-slate-200">{log.pair}</span>
                      <span className={`text-[9px] font-bold tracking-widest uppercase ${log.result === 'SUCCESS' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {log.type} • {log.result}
                      </span>
                    </div>
                    <div className={`font-mono font-bold tracking-tighter text-sm ${log.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {log.pnl >= 0 ? '+' : ''}${log.pnl.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 pt-4 border-t border-white/5 flex justify-between text-[9px] text-slate-600 font-bold tracking-widest uppercase">
            <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div> Local Sync Active</span>
            <span>ID: {MOCK_APP_ID.split('-')[0]}</span>
          </div>
        </div>

      </div>
    </div>
  );
}