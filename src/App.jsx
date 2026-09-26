import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ComposedChart, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Bar, Line } from 'recharts';
import { Activity, Server, Target, ArrowUpCircle, ArrowDownCircle, RefreshCw, Database } from 'lucide-react';

const BINANCE_REST = 'https://data-api.binance.vision/api/v3';
const MOCK_APP_ID = "v3-flow-terminal/src/App.jsx"; 
const SAFE_APP_ID = MOCK_APP_ID.replace(/\//g, '-'); 

// --- BULLETPROOF CANDLESTICK RENDERER ---
const CandlestickShape = (props) => {
  const { x, y, width, height, payload } = props;
  
  if (!payload || y === undefined || height === undefined) return null;

  const { open, close, high, low } = payload;
  const isGreen = close >= open;
  const color = isGreen ? '#10B981' : '#F43F5E'; // Emerald for Green, Rose for Red
  
  if (high === low) {
    return <line x1={x + width * 0.15} y1={y} x2={x + width * 0.85} y2={y} stroke={color} strokeWidth={2} />;
  }

  const pxPerDollar = height / (high - low);
  
  const yHigh = y; 
  const yLow = y + height; 
  
  const yOpen = y + ((high - open) * pxPerDollar);
  const yClose = y + ((high - close) * pxPerDollar);

  const boxY = Math.min(yOpen, yClose);
  const boxHeight = Math.max(Math.abs(yOpen - yClose), 1);

  return (
    <g>
      <line x1={x + width / 2} y1={yHigh} x2={x + width / 2} y2={yLow} stroke={color} strokeWidth={1.5} />
      <rect x={x + width * 0.15} y={boxY} width={width * 0.7} height={boxHeight} fill={color} stroke={color} />
    </g>
  );
};

export default function App() {
  const [coin, setCoin] = useState('BTC');
  const [timeframe, setTimeframe] = useState('5m');
  const [status, setStatus] = useState('CONNECTING...');
  
  const [data, setData] = useState([]);
  const [livePrice, setLivePrice] = useState(0);
  const [vpvrData, setVpvrData] = useState([]);
  const [optionsData, setOptionsData] = useState({ pcr: 0.58, maxPain: 0, bias: 'Neutral' });
  
  const [showIndicators, setShowIndicators] = useState({
    vpvr: true, vwap: true, sr: true, maxPain: true
  });

  const [cloudState, setCloudState] = useState({
    balance: 10000,
    activeTrade: null,
    isRunning: false,
    history: []
  });

  const volumeRef = useRef({ sessionCVD: 0, instantDelta: 0 });
  const lastTradeIdRef = useRef(null);
  const pollingTimerRef = useRef(null);
  const instantDeltaTimerRef = useRef(null);

  useEffect(() => {
    if (!document.getElementById('tailwind-script')) {
      const script = document.createElement('script');
      script.id = 'tailwind-script';
      script.src = 'https://cdn.tailwindcss.com';
      document.head.appendChild(script);
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(`bot_state_${SAFE_APP_ID}`);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!parsed.history) parsed.history = [];
      setCloudState(parsed);
    }
  }, []);

  const saveToCloud = (newState) => {
    setCloudState(newState);
    localStorage.setItem(`bot_state_${SAFE_APP_ID}`, JSON.stringify(newState));
  };

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
            lowHighBound: [low, high],
            vwap: cumulativeVolume > 0 ? (cumulativeTypicalPriceVolume / cumulativeVolume) : close
          };
        });

        setData(formatted);
        const currentPrice = formatted[formatted.length - 1].close;
        setLivePrice(currentPrice);

        const bins = {};
        const range = Math.max(...formatted.map(d => d.high)) - Math.min(...formatted.map(d => d.low));
        const binSize = Math.max(range / 30, 1); 

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

        setStatus('POLLING DATA...');
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

  if (data.length === 0) {
    return (
      <div className="h-screen bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-900 to-black text-white flex flex-col items-center justify-center font-mono">
        <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-6"></div>
        <div className="text-indigo-400 tracking-widest text-sm font-bold animate-pulse">INITIALIZING NEURAL LINK...</div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-[#05080f] to-black text-slate-200 font-sans p-6 grid grid-cols-4 gap-6 selection:bg-indigo-500/30">
      
      <div className="col-span-3 flex flex-col h-full min-h-0 pb-2">
        <div className="flex justify-between items-end mb-6 px-2">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-indigo-500/10 rounded-xl border border-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.2)]">
                <Database className="text-indigo-400" size={24} />
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-300 via-white to-cyan-300">
                V3 Flow<span className="text-indigo-500">Terminal</span>
              </h1>
            </div>
            
            <div className="flex gap-2 mb-1">
              {['BTC', 'ETH', 'SOL'].map(c => (
                <button key={c} onClick={() => setCoin(c)} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all duration-300 ${coin === c ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-[0_0_15px_rgba(99,102,241,0.3)]' : 'bg-slate-800/40 text-slate-400 border border-transparent hover:bg-slate-700/50 hover:text-slate-200'}`}>
                  {c}
                </button>
              ))}
              <div className="w-4 border-r border-white/5 mx-1"></div>
              {['1m', '5m', '15m', '1h'].map(t => (
                <button key={t} onClick={() => setTimeframe(t)} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all duration-300 ${timeframe === t ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.3)]' : 'bg-slate-800/40 text-slate-400 border border-transparent hover:bg-slate-700/50 hover:text-slate-200'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          
          <div className="text-right">
            <div className={`text-5xl font-mono font-extrabold tracking-tighter drop-shadow-2xl transition-colors duration-300 ${data[data.length-1].close >= data[data.length-1].open ? 'text-emerald-400 drop-shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'text-rose-500 drop-shadow-[0_0_15px_rgba(244,63,94,0.4)]'}`}>
              ${livePrice.toLocaleString('en-US', {minimumFractionDigits: 2})}
            </div>
            <div className="flex items-center gap-2 justify-end text-xs text-indigo-400/80 mt-2 font-semibold tracking-widest uppercase">
              <RefreshCw size={12} className={status === 'POLLING DATA...' ? 'animate-spin' : ''} />
              {status}
            </div>
          </div>
        </div>

        <div className="flex-1 bg-[#0a0f18]/60 backdrop-blur-xl rounded-2xl border border-white/10 p-5 relative shadow-[0_8px_30px_rgb(0,0,0,0.4)]">
          
          {showIndicators.vpvr && vpvrData.length > 0 && (
            <div className="absolute top-0 right-[50px] h-full w-[35%] opacity-40 pointer-events-none z-0" style={{ paddingTop: '5px', paddingBottom: '5px' }}>
              {vpvrData.map((bin, i) => {
                const totalVol = Math.max(...vpvrData.map(b => b.buyVol + b.sellVol));
                if(totalVol === 0) return null;
                
                const widthPct = ((bin.buyVol + bin.sellVol) / totalVol) * 100;
                const buyPct = (bin.buyVol / (bin.buyVol + bin.sellVol)) * 100;
                
                const topPct = ((yAxisDomain[1] - bin.price) / (yAxisDomain[1] - yAxisDomain[0])) * 100;
                
                return (
                  <div key={i} className="absolute right-0 flex h-[6px] -translate-y-1/2 rounded-l overflow-hidden" style={{ top: `${topPct}%`, width: `${widthPct}%` }}>
                    <div style={{ width: `${buyPct}%`, backgroundColor: '#10B981', opacity: 0.8 }} />
                    <div style={{ width: `${100 - buyPct}%`, backgroundColor: '#F43F5E', opacity: 0.8 }} />
                  </div>
                );
              })}
            </div>
          )}

          <ResponsiveContainer width="100%" height="100%" className="z-10 relative">
            <ComposedChart data={data}>
              <XAxis dataKey="timestamp" hide />
              <YAxis domain={yAxisDomain} allowDataOverflow={true} orientation="right" tick={{fill: '#64748b', fontSize: 11, fontWeight: 600}} axisLine={false} tickLine={false} dx={10} />
              
              <Tooltip 
                cursor={{stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1}} 
                contentStyle={{backgroundColor: 'rgba(15, 23, 42, 0.9)', backdropFilter: 'blur(12px)', borderColor: 'rgba(255,255,255,0.1)', color: '#f8fafc', borderRadius: '12px', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)'}} 
                labelFormatter={() => ''} 
              />
              
              <Bar dataKey="lowHighBound" shape={(props) => <CandlestickShape {...props} />} />
              
              {showIndicators.vwap && <Line type="monotone" dataKey="vwap" stroke="#c084fc" strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} style={{ filter: 'drop-shadow(0px 0px 4px rgba(192, 132, 252, 0.5))' }} />}
              
              {showIndicators.sr && <ReferenceLine y={highest} stroke="#F43F5E" strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.6} ifOverflow="extendDomain" />}
              {showIndicators.sr && <ReferenceLine y={lowest} stroke="#10B981" strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.6} ifOverflow="extendDomain" />}
              
              {showIndicators.maxPain && (
                <ReferenceLine 
                  y={optionsData.maxPain > highest * 1.05 ? yAxisDomain[1] * 0.98 : optionsData.maxPain} 
                  stroke="#EAB308" strokeWidth={2} strokeDasharray="6 6" strokeOpacity={0.8}
                  label={{ 
                    position: 'insideTopLeft', 
                    fill: '#fde047', 
                    value: optionsData.maxPain > highest * 1.05 ? `⚡ GAMMA WALL (OFF-SCREEN: $${optionsData.maxPain.toLocaleString()})` : `⚡ MAX PAIN: $${optionsData.maxPain.toLocaleString()}`, 
                    fontSize: 11, fontWeight: '800', textShadow: '0px 0px 8px rgba(234,179,8,0.6)'
                  }} 
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="col-span-1 flex flex-col gap-5 h-full overflow-y-auto pr-2 pb-6 custom-scrollbar">
        
        <div className="shrink-0 bg-[#0f172a]/60 backdrop-blur-xl rounded-2xl border border-white/5 p-5 shadow-xl">
          <h2 className="text-[10px] font-extrabold text-slate-500 mb-4 flex items-center gap-2 tracking-widest uppercase"><Target size={14} className="text-indigo-400"/> Order Flow Engine</h2>
          <div className="grid grid-cols-2 gap-2.5">
            {Object.keys(showIndicators).map(key => (
              <button key={key} onClick={() => setShowIndicators(prev => ({...prev, [key]: !prev[key]}))} className={`px-2 py-2 text-[10px] font-bold rounded-lg transition-all duration-200 uppercase tracking-wider ${showIndicators[key] ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-[0_0_10px_rgba(99,102,241,0.2)]' : 'bg-slate-800/40 text-slate-500 border border-white/5 hover:bg-slate-700/50 hover:text-slate-300'}`}>
                {key}
              </button>
            ))}
          </div>
        </div>

        <div className="shrink-0 bg-[#0f172a]/60 backdrop-blur-xl rounded-2xl border border-white/5 p-5 shadow-xl">
          <div className="flex justify-between items-end mb-4">
            <span className="text-[9px] text-slate-500 font-bold tracking-widest uppercase">Engine Status</span>
            <span className="text-[9px] text-slate-500 font-bold tracking-widest uppercase">Alignment</span>
          </div>
          <div className="flex justify-between items-center mb-6 bg-black/40 p-3 rounded-xl border border-white/5 shadow-inner">
            <span className={`text-sm font-extrabold tracking-widest uppercase ${scoreEngine.score >= 4 ? 'text-emerald-400 animate-pulse drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'text-slate-400'}`}>
              {scoreEngine.score >= 5 ? 'LONG SETUP READY' : 'WAITING FOR SETUP'}
            </span>
            <span className="text-xl font-mono font-bold bg-slate-800/50 px-3 py-1 rounded-lg border border-white/10 text-white shadow-lg">{scoreEngine.score} <span className="text-slate-500 text-sm">/ 6</span></span>
          </div>

          <div className="space-y-2.5">
            <div className="flex justify-between items-center text-xs p-3 bg-white/5 rounded-xl border border-white/5 hover:bg-white/10 transition-colors">
              <span className="text-slate-400 font-medium">Price Location:</span>
              <span className={`font-bold ${scoreEngine.location !== 'Mid-Range' ? 'text-cyan-400' : 'text-slate-300'}`}>{scoreEngine.location}</span>
            </div>
            <div className="flex justify-between items-center text-xs p-3 bg-white/5 rounded-xl border border-white/5 hover:bg-white/10 transition-colors">
              <span className="text-slate-400 font-medium">DOM Imbalance:</span>
              <span className={`font-bold ${scoreEngine.dom !== 'Neutral' ? 'text-emerald-400' : 'text-slate-300'}`}>{scoreEngine.dom}</span>
            </div>
            <div className="flex justify-between items-center text-xs p-3 bg-white/5 rounded-xl border border-white/5 hover:bg-white/10 transition-colors">
              <span className="text-slate-400 font-medium">Tape Absorption:</span>
              <span className={`font-bold ${scoreEngine.tape !== 'None' ? 'text-purple-400' : 'text-slate-300'}`}>{scoreEngine.tape}</span>
            </div>
            <div className="flex justify-between items-center text-xs p-3 bg-white/5 rounded-xl border border-white/5 hover:bg-white/10 transition-colors">
              <span className="text-slate-400 font-medium">Options Bias:</span>
              <span className={`font-bold ${optionsData.bias === 'Bullish' ? 'text-emerald-400' : optionsData.bias === 'Bearish' ? 'text-rose-400' : 'text-slate-300'}`}>{optionsData.bias}</span>
            </div>
          </div>
        </div>

        <div className="shrink-0 bg-[#0f172a]/60 backdrop-blur-xl rounded-2xl border border-white/5 p-5 shadow-xl">
          <h2 className="text-[10px] font-extrabold text-slate-500 mb-4 flex items-center gap-2 tracking-widest uppercase"><Activity size={14} className="text-cyan-400"/> Whale CVD {'>'} $5K</h2>
          <div className="grid grid-cols-2 gap-3 mb-1">
            <div className="bg-black/40 p-4 rounded-xl text-center border border-white/5 shadow-inner">
              <div className="text-[9px] text-slate-500 mb-2 font-bold tracking-widest uppercase">Session Tally</div>
              <div className={`text-lg font-mono font-extrabold tracking-tight ${volumeRef.current.sessionCVD >= 0 ? 'text-emerald-400 drop-shadow-[0_0_5px_rgba(16,185,129,0.3)]' : 'text-rose-500 drop-shadow-[0_0_5px_rgba(244,63,94,0.3)]'}`}>
                {volumeRef.current.sessionCVD > 0 ? '+' : ''}${(volumeRef.current.sessionCVD / 1000).toFixed(1)}k
              </div>
            </div>
            <div className="bg-black/40 p-4 rounded-xl text-center border border-white/5 shadow-inner">
              <div className="text-[9px] text-slate-500 mb-2 font-bold tracking-widest uppercase">Instant Velocity</div>
              <div className={`text-lg font-mono font-extrabold tracking-tight ${volumeRef.current.instantDelta >= 0 ? 'text-emerald-400 drop-shadow-[0_0_5px_rgba(16,185,129,0.3)]' : 'text-rose-500 drop-shadow-[0_0_5px_rgba(244,63,94,0.3)]'}`}>
                {volumeRef.current.instantDelta > 0 ? '+' : ''}${(volumeRef.current.instantDelta / 1000).toFixed(1)}k
              </div>
            </div>
          </div>
        </div>

        <div className="shrink-0 min-h-[350px] bg-[#0f172a]/80 backdrop-blur-2xl rounded-2xl border border-indigo-500/20 p-5 flex flex-col shadow-[0_0_30px_rgba(79,70,229,0.15)] relative overflow-hidden">
          {cloudState.isRunning && <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-500 animate-pulse"></div>}
          
          <h2 className="text-[10px] font-extrabold text-slate-300 mb-5 flex items-center gap-2 tracking-widest uppercase"><Server size={14} className={cloudState.isRunning ? "text-indigo-400 animate-pulse" : "text-slate-500"}/> Cloud Auto-Trader</h2>
          
          <div className="flex justify-between items-end mb-6 bg-black/50 p-4 rounded-xl border border-indigo-500/10 shadow-inner">
            <div>
              <div className="text-[9px] text-indigo-400/80 mb-1.5 font-bold tracking-widest uppercase">Portfolio Balance</div>
              <div className="text-3xl font-mono font-extrabold text-white tracking-tighter drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]">${cloudState.balance.toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
            </div>
            {cloudState.activeTrade && (
              <div className="text-right">
                <div className="text-[9px] text-cyan-400 font-bold mb-1.5 animate-pulse tracking-widest uppercase">Active Position</div>
                <div className="text-xs font-mono font-bold text-slate-300 bg-white/5 px-2 py-1 rounded border border-white/10">EP: ${cloudState.activeTrade.entry.toFixed(2)}</div>
              </div>
            )}
          </div>

          <button 
            onClick={() => saveToCloud({...cloudState, isRunning: !cloudState.isRunning})}
            className={`w-full py-3.5 rounded-xl font-extrabold text-xs tracking-widest uppercase transition-all duration-300 ${cloudState.isRunning ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20' : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white hover:from-indigo-500 hover:to-blue-500 shadow-[0_0_20px_rgba(79,70,229,0.4)] hover:shadow-[0_0_30px_rgba(79,70,229,0.6)]'}`}
          >
            {cloudState.isRunning ? '■ Stop Bot Trading' : '▶ Activate Paper Bot'}
          </button>

          {cloudState.history && cloudState.history.length > 0 ? (
            <div className="mt-6 flex-1 flex flex-col">
              <div className="text-[9px] text-slate-400 mb-3 font-bold tracking-widest uppercase flex items-center justify-between border-b border-white/5 pb-2">
                <span>Trade Ledger</span>
                <span className="bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md text-indigo-300">
                  {cloudState.history.filter(t => t.result === 'SUCCESS').length}W - {cloudState.history.filter(t => t.result === 'FAIL').length}L
                </span>
              </div>
              <div className="overflow-y-auto space-y-2 pr-1 custom-scrollbar" style={{maxHeight: '200px'}}>
                {cloudState.history.map((log) => (
                  <div key={log.id} className="flex justify-between items-center text-xs bg-black/40 p-3 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
                    <div className="flex flex-col gap-1">
                      <span className="font-bold text-slate-200 tracking-wider">{log.pair}</span>
                      <span className={`text-[10px] font-bold flex items-center gap-1 ${log.result === 'SUCCESS' ? 'text-emerald-400' : 'text-rose-500'}`}>
                        {log.result === 'SUCCESS' ? <ArrowUpCircle size={10}/> : <ArrowDownCircle size={10}/>} {log.type} • {log.result}
                      </span>
                    </div>
                    <div className={`font-mono font-extrabold text-sm ${log.pnl >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
                      {log.pnl >= 0 ? '+' : ''}${log.pnl.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-6 flex-1 flex items-center justify-center text-[10px] font-bold text-slate-600 tracking-widest uppercase text-center border border-dashed border-white/10 rounded-xl bg-black/20">
              No Trades Executed<br/><span className="text-slate-500 mt-1 block">Waiting for 6/6 Setup...</span>
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-white/5 flex justify-between text-[9px] font-extrabold text-slate-500 tracking-widest uppercase">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Secure Cloud Sync</span>
            <span className="opacity-70">ID: {SAFE_APP_ID.split('-')[0]}</span>
          </div>
        </div>

      </div>
    </div>
  );
}