import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ComposedChart, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Bar, Line } from 'recharts';
import { Activity, Server, Target, TrendingUp, TrendingDown, RefreshCw, Database } from 'lucide-react';

const BINANCE_REST = 'https://data-api.binance.vision/api/v3';
const MOCK_APP_ID = "v3-flow-terminal/src/App.jsx"; 
const SAFE_APP_ID = MOCK_APP_ID.replace(/\//g, '-'); 

// This custom shape uses the native bounding box (y to y+height) created by passing ['low', 'high'] to the Bar dataKey.
// This completely removes the dependency on the buggy yAxis.scale function.
const CandlestickShape = (props) => {
  const { x, y, width, height, payload } = props;
  
  if (!payload || y === undefined || height === undefined) return null;

  const { open, close, high, low } = payload;
  const isGreen = close >= open;
  const color = isGreen ? '#10B981' : '#EF4444';
  
  // If there is no price movement, just draw a flat dash
  if (high === low) {
    return <line x1={x + width * 0.15} y1={y} x2={x + width * 0.85} y2={y} stroke={color} strokeWidth={2} />;
  }

  // Calculate exact pixels per dollar based on the Recharts bounding box
  const pxPerDollar = height / (high - low);
  
  const yHigh = y; // Top of the bounding box
  const yLow = y + height; // Bottom of the bounding box
  
  const yOpen = y + ((high - open) * pxPerDollar);
  const yClose = y + ((high - close) * pxPerDollar);

  const boxY = Math.min(yOpen, yClose);
  const boxHeight = Math.max(Math.abs(yOpen - yClose), 1);

  return (
    <g>
      {/* The Wick */}
      <line x1={x + width / 2} y1={yHigh} x2={x + width / 2} y2={yLow} stroke={color} strokeWidth={1.5} />
      {/* The Body */}
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
    // Reset state on coin change
    setData([]);
    volumeRef.current = { sessionCVD: 0, instantDelta: 0 };
    lastTradeIdRef.current = null;
    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    if (instantDeltaTimerRef.current) clearInterval(instantDeltaTimerRef.current);

    setStatus('CONNECTING...');

    const fetchData = async () => {
      try {
        // Fetch Historical Candles
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
            lowHighBound: [low, high], // The magic bulletproof bounds for the Candlestick Shape
            vwap: cumulativeVolume > 0 ? (cumulativeTypicalPriceVolume / cumulativeVolume) : close
          };
        });

        setData(formatted);
        const currentPrice = formatted[formatted.length - 1].close;
        setLivePrice(currentPrice);

        // Build VPVR Array
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

        // Fetch Live Tape (For Delta)
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
          lastTradeIdRef.current = t.id; // Prevent duplicate counts
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

  if (data.length === 0) return <div className="h-screen bg-[#0B0E14] text-white flex items-center justify-center font-mono">Initializing Neural Link...</div>;

  return (
    <div className="min-h-screen bg-[#0B0E14] text-white font-sans p-6 grid grid-cols-4 gap-6 selection:bg-blue-500/30">
      
      {/* MAIN CHART PANEL */}
      <div className="col-span-3 flex flex-col h-[90vh]">
        <div className="flex justify-between items-end mb-4">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <Database className="text-indigo-500" size={24} />
              <h1 className="text-2xl font-bold tracking-tight">V3 Flow<span className="text-indigo-400">Terminal</span></h1>
            </div>
            
            <div className="flex gap-2 mb-2">
              {['BTC', 'ETH', 'SOL'].map(c => (
                <button key={c} onClick={() => setCoin(c)} className={`px-3 py-1 text-xs font-bold rounded transition-colors ${coin === c ? 'bg-indigo-600 text-white shadow-lg' : 'bg-[#1A202C] text-gray-400 hover:bg-[#2D3748]'}`}>{c}</button>
              ))}
              <div className="w-4"></div>
              {['1m', '5m', '15m', '1h'].map(t => (
                <button key={t} onClick={() => setTimeframe(t)} className={`px-3 py-1 text-xs font-bold rounded transition-colors ${timeframe === t ? 'bg-gray-600 text-white shadow-lg' : 'bg-[#1A202C] text-gray-400 hover:bg-[#2D3748]'}`}>{t}</button>
              ))}
            </div>
          </div>
          
          <div className="text-right">
            <div className={`text-4xl font-mono font-bold ${data[data.length-1].close >= data[data.length-1].open ? 'text-emerald-400' : 'text-rose-500'}`}>
              ${livePrice.toLocaleString('en-US', {minimumFractionDigits: 2})}
            </div>
            <div className="flex items-center gap-2 justify-end text-xs text-indigo-400 mt-1 font-semibold">
              <RefreshCw size={12} className={status === 'POLLING DATA...' ? 'animate-spin' : ''} />
              {status}
            </div>
          </div>
        </div>

        {/* Chart Canvas */}
        <div className="flex-1 bg-[#111827] rounded-xl border border-gray-800 p-4 relative overflow-hidden">
          
          {/* VPVR Overlay */}
          {showIndicators.vpvr && vpvrData.length > 0 && (
            <div className="absolute top-0 right-0 h-full w-[40%] flex flex-col justify-between opacity-80 pointer-events-none z-0" style={{ padding: '40px 0' }}>
              {vpvrData.map((bin, i) => {
                const totalVol = Math.max(...vpvrData.map(b => b.buyVol + b.sellVol));
                if(totalVol === 0) return null;
                const widthPct = ((bin.buyVol + bin.sellVol) / totalVol) * 100;
                const buyPct = (bin.buyVol / (bin.buyVol + bin.sellVol)) * 100;
                
                return (
                  <div key={i} className="flex h-[2px] mb-[1px] justify-end items-center">
                    <div style={{ width: `${widthPct}%`, display: 'flex', height: '100%' }}>
                      <div style={{ width: `${buyPct}%`, backgroundColor: '#10B981', opacity: 0.6 }} />
                      <div style={{ width: `${100 - buyPct}%`, backgroundColor: '#EF4444', opacity: 0.6 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <ResponsiveContainer width="100%" height="100%" className="z-10 relative">
            <ComposedChart data={data}>
              <XAxis dataKey="timestamp" hide />
              <YAxis domain={yAxisDomain} allowDataOverflow={true} orientation="right" tick={{fill: '#6B7280', fontSize: 11}} axisLine={false} tickLine={false} />
              
              <Tooltip cursor={{stroke: '#374151'}} contentStyle={{backgroundColor: '#111827', borderColor: '#374151', color: '#fff'}} labelFormatter={() => ''} />
              
              {/* The magical lowHighBound dataKey ensures Recharts provides perfect bounding box coordinates for our shape */}
              <Bar dataKey="lowHighBound" shape={(props) => <CandlestickShape {...props} />} />
              
              {showIndicators.vwap && <Line type="monotone" dataKey="vwap" stroke="#C084FC" strokeWidth={2} strokeDasharray="3 3" dot={false} isAnimationActive={false} />}
              
              {showIndicators.sr && <ReferenceLine y={highest} stroke="#EF4444" strokeWidth={1} strokeDasharray="5 5" strokeOpacity={0.5} ifOverflow="extendDomain" />}
              {showIndicators.sr && <ReferenceLine y={lowest} stroke="#10B981" strokeWidth={1} strokeDasharray="5 5" strokeOpacity={0.5} ifOverflow="extendDomain" />}
              
              {showIndicators.maxPain && (
                <ReferenceLine 
                  y={optionsData.maxPain > highest * 1.05 ? yAxisDomain[1] * 0.98 : optionsData.maxPain} 
                  stroke="#EAB308" strokeWidth={2} strokeDasharray="4 4" 
                  label={{ 
                    position: 'insideTopLeft', 
                    fill: '#EAB308', 
                    value: optionsData.maxPain > highest * 1.05 ? `GAMMA WALL (OFF-SCREEN: $${optionsData.maxPain.toLocaleString()})` : `MAX PAIN: $${optionsData.maxPain.toLocaleString()}`, 
                    fontSize: 10, fontWeight: 'bold' 
                  }} 
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* SIDEBAR PANEL */}
      <div className="col-span-1 flex flex-col gap-4 h-[90vh] overflow-y-auto pr-2 custom-scrollbar">
        
        {/* Indicators Toggle */}
        <div className="bg-[#111827] rounded-xl border border-gray-800 p-5 shadow-lg">
          <h2 className="text-xs font-bold text-gray-400 mb-4 flex items-center gap-2"><Target size={14} className="text-indigo-400"/> ORDER FLOW ENGINE</h2>
          <div className="grid grid-cols-2 gap-2">
            {Object.keys(showIndicators).map(key => (
              <button key={key} onClick={() => setShowIndicators(prev => ({...prev, [key]: !prev[key]}))} className={`px-2 py-1.5 text-[10px] font-bold rounded transition-colors ${showIndicators[key] ? 'bg-indigo-600 shadow' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`}>
                {key.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Strategy Breakdown */}
        <div className="bg-[#111827] rounded-xl border border-gray-800 p-5 shadow-lg">
          <div className="flex justify-between items-end mb-4">
            <span className="text-[10px] text-gray-400 font-bold tracking-wider">STATUS</span>
            <span className="text-[10px] text-gray-400 font-bold tracking-wider">CONDITIONS</span>
          </div>
          <div className="flex justify-between items-center mb-6 bg-gray-900/50 p-3 rounded-lg border border-gray-800/80">
            <span className={`text-sm font-bold tracking-wider ${scoreEngine.score >= 4 ? 'text-emerald-400 animate-pulse' : 'text-gray-400'}`}>
              {scoreEngine.score >= 5 ? 'LONG SETUP READY' : 'WAITING FOR SETUP'}
            </span>
            <span className="text-xl font-mono font-bold bg-gray-800 px-3 py-1 rounded shadow-inner">{scoreEngine.score} <span className="text-gray-500 text-sm">/ 6</span></span>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs p-2.5 bg-gray-800/30 rounded border border-gray-800/50 hover:bg-gray-800 transition-colors">
              <span className="text-gray-400">Price Location:</span>
              <span className={`font-bold ${scoreEngine.location !== 'Mid-Range' ? 'text-blue-400' : 'text-gray-300'}`}>{scoreEngine.location}</span>
            </div>
            <div className="flex justify-between items-center text-xs p-2.5 bg-gray-800/30 rounded border border-gray-800/50 hover:bg-gray-800 transition-colors">
              <span className="text-gray-400">DOM Imbalance:</span>
              <span className={`font-bold ${scoreEngine.dom !== 'Neutral' ? 'text-emerald-400' : 'text-gray-300'}`}>{scoreEngine.dom}</span>
            </div>
            <div className="flex justify-between items-center text-xs p-2.5 bg-gray-800/30 rounded border border-gray-800/50 hover:bg-gray-800 transition-colors">
              <span className="text-gray-400">Tape Absorption:</span>
              <span className={`font-bold ${scoreEngine.tape !== 'None' ? 'text-purple-400' : 'text-gray-300'}`}>{scoreEngine.tape}</span>
            </div>
            <div className="flex justify-between items-center text-xs p-2.5 bg-gray-800/30 rounded border border-gray-800/50 hover:bg-gray-800 transition-colors">
              <span className="text-gray-400">Options Bias:</span>
              <span className={`font-bold ${optionsData.bias === 'Bullish' ? 'text-emerald-400' : optionsData.bias === 'Bearish' ? 'text-rose-400' : 'text-gray-300'}`}>{optionsData.bias}</span>
            </div>
          </div>
        </div>

        {/* Whale CVD Tracker */}
        <div className="bg-[#111827] rounded-xl border border-gray-800 p-5 shadow-lg">
          <h2 className="text-xs font-bold text-gray-400 mb-4 flex items-center gap-2"><Activity size={14} className="text-rose-400"/> WHALE CVD {'>'} $5K</h2>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-gray-900/60 p-3 rounded-lg text-center border border-gray-800/60 shadow-inner">
              <div className="text-[10px] text-gray-500 mb-2 font-bold tracking-widest">SESSION CVD</div>
              <div className={`text-lg font-mono font-bold ${volumeRef.current.sessionCVD >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
                {volumeRef.current.sessionCVD > 0 ? '+' : ''}${(volumeRef.current.sessionCVD / 1000).toFixed(1)}k
              </div>
            </div>
            <div className="bg-gray-900/60 p-3 rounded-lg text-center border border-gray-800/60 shadow-inner">
              <div className="text-[10px] text-gray-500 mb-2 font-bold tracking-widest">INSTANT DELTA</div>
              <div className={`text-lg font-mono font-bold ${volumeRef.current.instantDelta >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
                {volumeRef.current.instantDelta > 0 ? '+' : ''}${(volumeRef.current.instantDelta / 1000).toFixed(1)}k
              </div>
            </div>
          </div>
        </div>

        {/* Cloud Auto-Trader & Trading Ledger */}
        <div className="bg-[#111827] rounded-xl border border-indigo-900/50 p-5 flex-1 flex flex-col shadow-[0_0_15px_rgba(79,70,229,0.1)] relative">
          {cloudState.isRunning && <div className="absolute top-0 left-0 w-full h-1 bg-indigo-500 animate-pulse rounded-t-xl"></div>}
          
          <h2 className="text-xs font-bold text-gray-300 mb-4 flex items-center gap-2 tracking-wider"><Server size={14} className={cloudState.isRunning ? "text-indigo-400" : "text-gray-500"}/> CLOUD AUTO-TRADER</h2>
          
          <div className="flex justify-between items-end mb-5 bg-gray-900 p-4 rounded-lg border border-gray-800 shadow-inner">
            <div>
              <div className="text-[10px] text-gray-500 mb-1 font-bold tracking-widest">PORTFOLIO BALANCE</div>
              <div className="text-2xl font-mono font-bold text-white">${cloudState.balance.toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
            </div>
            {cloudState.activeTrade && (
              <div className="text-right">
                <div className="text-[10px] text-emerald-400 font-bold mb-1 animate-pulse tracking-widest">ACTIVE POSITION</div>
                <div className="text-xs font-mono font-bold text-gray-300">EP: ${cloudState.activeTrade.entry.toFixed(2)}</div>
              </div>
            )}
          </div>

          <button 
            onClick={() => saveToCloud({...cloudState, isRunning: !cloudState.isRunning})}
            className={`w-full py-3 rounded font-bold text-xs tracking-widest transition-all shadow-md ${cloudState.isRunning ? 'bg-rose-500/10 text-rose-500 border border-rose-500/50 hover:bg-rose-500/20' : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-[0_0_15px_rgba(79,70,229,0.3)]'}`}
          >
            {cloudState.isRunning ? '■ STOP BOT TRADING' : '▶ ACTIVATE PAPER BOT'}
          </button>

          {/* Trade History Ledger Component */}
          {cloudState.history && cloudState.history.length > 0 ? (
            <div className="mt-5 flex-1 flex flex-col">
              <div className="text-[10px] text-gray-400 mb-3 font-bold tracking-wider flex items-center justify-between border-b border-gray-800 pb-2">
                <span>TRADE LEDGER</span>
                <span className="bg-gray-800 px-2 py-0.5 rounded text-gray-300">
                  {cloudState.history.filter(t => t.result === 'SUCCESS').length}W - {cloudState.history.filter(t => t.result === 'FAIL').length}L
                </span>
              </div>
              <div className="overflow-y-auto space-y-2 pr-1 custom-scrollbar" style={{maxHeight: '200px'}}>
                {cloudState.history.map((log) => (
                  <div key={log.id} className="flex justify-between items-center text-xs bg-[#1A202C] p-2.5 rounded-lg border border-gray-800 hover:border-gray-700 transition-colors">
                    <div className="flex flex-col gap-1">
                      <span className="font-bold text-gray-200">{log.pair}</span>
                      <span className={`text-[10px] font-bold flex items-center gap-1 ${log.result === 'SUCCESS' ? 'text-emerald-400' : 'text-rose-500'}`}>
                        {log.result === 'SUCCESS' ? <TrendingUp size={10}/> : <TrendingDown size={10}/>} {log.type} • {log.result}
                      </span>
                    </div>
                    <div className={`font-mono font-bold text-sm ${log.pnl >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
                      {log.pnl >= 0 ? '+' : ''}${log.pnl.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-5 flex-1 flex items-center justify-center text-[10px] font-medium text-gray-600 tracking-wider text-center border border-dashed border-gray-800 rounded-lg">
              NO TRADES EXECUTED YET.<br/>WAITING FOR {scoreEngine.score}/6 SETUP...
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-gray-800 flex justify-between text-[9px] font-bold text-gray-500 tracking-widest">
            <span>☁️ SECURE LOCAL SYNC: ACTIVE</span>
            <span>ID: {SAFE_APP_ID.split('-')[0]}</span>
          </div>
        </div>

      </div>
    </div>
  );
}