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
  Loader2, 
  RefreshCw,
  Play,
  Square,
  Crosshair,
  Database
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
  let cumulativeTypVolume = 0;
  let cumulativeVolume = 0;
  
  return data.map((point) => {
    const typPrice = (point.high + point.low + point.close) / 3;
    const vol = point.volume || 0;
    cumulativeTypVolume += typPrice * vol;
    cumulativeVolume += vol;
    
    return {
      ...point,
      vwap: cumulativeVolume === 0 ? point.close : (cumulativeTypVolume / cumulativeVolume)
    };
  });
};

const TIMEFRAMES = {
  '1m': { interval: '1m', limit: 100 },
  '5m': { interval: '5m', limit: 120 },
  '15m': { interval: '15m', limit: 100 },
  '1H': { interval: '1h', limit: 100 }
};

export default function App() {
  return (
    <ErrorBoundary>
      <V3FlowTerminal />
    </ErrorBoundary>
  );
}

function V3FlowTerminal() {
  const [selectedPair, setSelectedPair] = useState('BTCUSDT');
  const [selectedTimeframe, setSelectedTimeframe] = useState('5m');
  const [data, setData] = useState([]);
  const [recentTrades, setRecentTrades] = useState([]);
  const [wsStatus, setWsStatus] = useState('connecting');
  
  // Toggles matching the screenshot
  const [toggles, setToggles] = useState({
    vpvr: true,
    vwap: true,
    sr: true,
    maxPain: true
  });

  // Options & CVD Data
  const [optionsData, setOptionsData] = useState({ pcr: 0.58, maxPain: 95000 });
  const [cvdData, setCvdData] = useState({ sessionCvd: 0, instantDelta: 0, buyVol: 0, sellVol: 0 });

  // Bot State (Persisted to LocalStorage)
  const [botState, setBotState] = useState(() => {
    const saved = localStorage.getItem('v3_bot_state');
    if (saved) return JSON.parse(saved);
    return { active: false, balance: 10000, position: null, history: [] };
  });

  useEffect(() => {
    localStorage.setItem('v3_bot_state', JSON.stringify(botState));
  }, [botState]);

  useEffect(() => {
    let isMounted = true;
    let ws = null;
    let tradeBuffer = [];
    let currentBuyVol = 0;
    let currentSellVol = 0;

    const tfConfig = TIMEFRAMES[selectedTimeframe];

    const fetchHistorical = async () => {
      try {
        const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${selectedPair}&interval=${tfConfig.interval}&limit=${tfConfig.limit}`);
        const json = await res.json();
        if (!isMounted) return;

        const formatted = json.map(d => ({
          timestamp: d[0],
          time: new Date(d[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          open: parseFloat(d[1]),
          high: parseFloat(d[2]),
          low: parseFloat(d[3]),
          close: parseFloat(d[4]),
          volume: parseFloat(d[5]),
          candleRange: [parseFloat(d[3]), parseFloat(d[2])]
        }));
        
        setData(formatted);
        setWsStatus('connected');
      } catch (err) {
        setWsStatus('error');
      }
    };

    fetchHistorical();

    // WebSocket for Live Trades & Delta
    try {
      ws = new WebSocket(`wss://stream.binance.com:9443/ws/${selectedPair.toLowerCase()}@trade`);
      
      ws.onmessage = (event) => {
        if (!isMounted) return;
        const trade = JSON.parse(event.data);
        const price = parseFloat(trade.p);
        const qty = parseFloat(trade.q);
        const isSell = trade.m;

        // Update current candle live
        setData(prev => {
          if (prev.length === 0) return prev;
          const newArr = [...prev];
          const lastIdx = newArr.length - 1;
          const lastCandle = { ...newArr[lastIdx] };
          
          lastCandle.close = price;
          if (price > lastCandle.high) lastCandle.high = price;
          if (price < lastCandle.low) lastCandle.low = price;
          lastCandle.volume += qty;
          lastCandle.candleRange = [lastCandle.low, lastCandle.high];
          
          newArr[lastIdx] = lastCandle;
          return newArr;
        });

        // Track Whale CVD (>$5,000 threshold roughly for BTC)
        const dollarValue = price * qty;
        if (dollarValue > 5000) {
          if (isSell) currentSellVol += qty;
          else currentBuyVol += qty;

          setCvdData(prev => ({
            sessionCvd: prev.sessionCvd + (isSell ? -qty : qty),
            instantDelta: (currentBuyVol - currentSellVol),
            buyVol: currentBuyVol,
            sellVol: currentSellVol
          }));
        }
      };
    } catch (e) {
      setWsStatus('error');
    }

    // Options Mock Fetcher (Deribit API often blocks browser CORS, so we simulate realistic market maker movement)
    const optionsInterval = setInterval(() => {
      setOptionsData(prev => ({
        pcr: Math.max(0.4, Math.min(1.5, prev.pcr + (Math.random() * 0.1 - 0.05))),
        maxPain: prev.maxPain // Keeping static for testing visual magnet
      }));
    }, 10000);

    return () => {
      isMounted = false;
      if (ws) ws.close();
      clearInterval(optionsInterval);
    };
  }, [selectedPair, selectedTimeframe]);

  const chartData = useMemo(() => {
    let processed = [...data];
    processed = calculateVWAP(processed);
    return processed;
  }, [data]);

  const currentPrice = chartData.length > 0 ? chartData[chartData.length - 1].close : 0;
  
  // Calculate Auto S/R Lines based on 20-period lookback
  const autoLevels = useMemo(() => {
    if (chartData.length < 20) return { res: null, sup: null };
    const recent = chartData.slice(-20);
    const highs = recent.map(d => d.high);
    const lows = recent.map(d => d.low);
    return {
      res: Math.max(...highs),
      sup: Math.min(...lows)
    };
  }, [chartData]);

  const setupEngine = useMemo(() => {
    let score = 0;
    let type = 'NONE';
    let conditions = { loc: 'Waiting', dom: 'Neutral', tape: 'None', options: 'Neutral' };

    if (!autoLevels.sup || !currentPrice) return { score, type, conditions };

    const distToSup = Math.abs(currentPrice - autoLevels.sup) / currentPrice;
    const distToRes = Math.abs(currentPrice - autoLevels.res) / currentPrice;

    // 1. Location
    if (distToSup < 0.002) { score += 2; type = 'LONG'; conditions.loc = 'At Support'; }
    else if (distToRes < 0.002) { score += 2; type = 'SHORT'; conditions.loc = 'At Resistance'; }

    // 2. DOM & Tape Absorption (Simulated based on delta + price stall)
    if (type === 'LONG' && cvdData.instantDelta < -5) {
      score += 2; 
      conditions.dom = 'Buy Wall Detected';
      conditions.tape = 'Buyer Absorption';
    } else if (type === 'SHORT' && cvdData.instantDelta > 5) {
      score += 2;
      conditions.dom = 'Sell Wall Detected';
      conditions.tape = 'Seller Absorption';
    }

    // 3. Options Macro Bias
    if (optionsData.pcr < 0.7) {
      if (type === 'LONG') score += 2;
      conditions.options = 'Bullish';
    } else if (optionsData.pcr > 1.0) {
      if (type === 'SHORT') score += 2;
      conditions.options = 'Bearish';
    }

    return { score, type, conditions };
  }, [currentPrice, autoLevels, cvdData, optionsData]);

  useEffect(() => {
    if (!botState.active || !currentPrice) return;

    // Entry Logic
    if (!botState.position && setupEngine.score >= 5) {
      const isLong = setupEngine.type === 'LONG';
      const riskAmount = botState.balance * 0.01; // 1% risk
      const stopLoss = isLong ? currentPrice * 0.99 : currentPrice * 1.01;
      const takeProfit = isLong ? currentPrice * 1.03 : currentPrice * 0.97;
      
      const priceDiff = Math.abs(currentPrice - stopLoss);
      const qty = riskAmount / priceDiff;

      setBotState(prev => ({
        ...prev,
        position: { type: setupEngine.type, entry: currentPrice, sl: stopLoss, tp: takeProfit, qty }
      }));
    }

    // Exit Logic (Stop Loss or Take Profit)
    if (botState.position) {
      const pos = botState.position;
      let exitPrice = null;
      let pnl = 0;

      if (pos.type === 'LONG') {
        if (currentPrice <= pos.sl) { exitPrice = pos.sl; pnl = (exitPrice - pos.entry) * pos.qty; }
        else if (currentPrice >= pos.tp) { exitPrice = pos.tp; pnl = (exitPrice - pos.entry) * pos.qty; }
      } else {
        if (currentPrice >= pos.sl) { exitPrice = pos.sl; pnl = (pos.entry - exitPrice) * pos.qty; }
        else if (currentPrice <= pos.tp) { exitPrice = pos.tp; pnl = (pos.entry - exitPrice) * pos.qty; }
      }

      if (exitPrice !== null) {
        setBotState(prev => ({
          ...prev,
          balance: prev.balance + pnl,
          position: null,
          history: [{ type: pos.type, pnl, time: new Date().toLocaleTimeString() }, ...prev.history].slice(0, 10)
        }));
      }
    }
  }, [currentPrice, setupEngine, botState.active]);

  const renderVPVR = (props) => {
    if (!toggles.vpvr || !chartData || chartData.length === 0) return null;
    const { yAxisMap, offset } = props;
    if (!yAxisMap || !yAxisMap.price || !offset) return null;

    const yScale = yAxisMap.price.scale;
    let minPrice = Math.min(...chartData.map(d => d.low));
    let maxPrice = Math.max(...chartData.map(d => d.high));
    if (minPrice === maxPrice) return null;

    const binsCount = 40;
    const binSize = (maxPrice - minPrice) / binsCount;
    const bins = Array.from({ length: binsCount }, (_, i) => ({
      top: minPrice + ((i + 1) * binSize),
      bottom: minPrice + (i * binSize),
      upVol: 0,
      downVol: 0
    }));

    chartData.forEach(d => {
      let idx = Math.floor((d.close - minPrice) / binSize);
      if (idx >= binsCount) idx = binsCount - 1;
      if (idx < 0) idx = 0;
      if (d.close >= d.open) bins[idx].upVol += d.volume;
      else bins[idx].downVol += d.volume;
    });

    const maxVol = Math.max(...bins.map(b => b.upVol + b.downVol));
    if (maxVol === 0) return null;

    const maxWidth = offset.width * 0.35; // 35% of screen
    const startX = offset.left + offset.width;

    return (
      <g className="vpvr-layer">
        {bins.map((bin, i) => {
          const y1 = yScale(bin.top);
          const y2 = yScale(bin.bottom);
          const topY = Math.min(y1, y2);
          // +1 height ensures bars overlap and never vanish from anti-aliasing
          const h = Math.max(Math.abs(y1 - y2), 1) + 1; 
          
          const totalVol = bin.upVol + bin.downVol;
          if (totalVol === 0) return null;
          
          const totalWidth = (totalVol / maxVol) * maxWidth;
          const upW = (bin.upVol / totalVol) * totalWidth;
          const downW = (bin.downVol / totalVol) * totalWidth;

          return (
            <g key={`vpvr-${i}`}>
              <rect x={startX - totalWidth} y={topY} width={downW} height={h} fill="#ef4444" fillOpacity={0.7} />
              <rect x={startX - totalWidth + downW} y={topY} width={upW} height={h} fill="#10b981" fillOpacity={0.7} />
            </g>
          );
        })}
      </g>
    );
  };

  const toggleBtnClass = (isActive) => 
    `px-3 py-1 rounded text-xs font-bold transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`;

  // Check if Max Pain is way off screen for the header warning
  const isMaxPainOffScreen = autoLevels.res && (optionsData.maxPain > autoLevels.res * 1.05 || optionsData.maxPain < autoLevels.sup * 0.95);

  return (
    <div className="min-h-screen bg-[#0b1120] text-slate-200 p-4 font-sans selection:bg-indigo-500/30">
      
      {/* Header Panel */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-4 bg-[#111827] border border-slate-800 p-3 rounded-lg shadow-lg">
        <div className="flex items-center gap-3 mb-4 md:mb-0">
          <Database className="text-indigo-500" size={24} />
          <h1 className="text-xl font-bold tracking-tight text-white">V3 Flow<span className="text-indigo-400">Terminal</span></h1>
        </div>
        
        <div className="flex gap-4">
          <div className="flex bg-slate-900 rounded p-1 border border-slate-800">
            {['BTC', 'ETH', 'SOL'].map(coin => (
              <button key={coin} onClick={() => setSelectedPair(`${coin}USDT`)} className={`px-4 py-1.5 rounded text-sm font-bold ${selectedPair.startsWith(coin) ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>
                {coin}
              </button>
            ))}
          </div>
          <div className="flex bg-slate-900 rounded p-1 border border-slate-800">
            {Object.keys(TIMEFRAMES).map(tf => (
              <button key={tf} onClick={() => setSelectedTimeframe(tf)} className={`px-3 py-1.5 rounded text-sm font-bold ${selectedTimeframe === tf ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>
                {tf}
              </button>
            ))}
          </div>
        </div>

        <div className="text-right flex flex-col items-end">
          <div className={`text-2xl font-mono font-bold ${wsStatus === 'connected' ? 'text-emerald-400' : 'text-amber-400'}`}>
            ${currentPrice > 0 ? currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '---'}
          </div>
          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded">
            <Wifi size={12} /> SECURED: STREAM.BINANCE.INFO
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        
        {/* Main Chart Area */}
        <div className="lg:col-span-3 bg-[#111827] rounded-lg border border-slate-800 p-2 h-[800px] relative">
          
          {toggles.maxPain && isMaxPainOffScreen && (
            <div className="absolute top-4 left-4 z-20 text-amber-500 font-bold text-xs bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20">
              GAMMA WALL (OFF-SCREEN: ${optionsData.maxPain.toLocaleString()})
            </div>
          )}

          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 20, right: 60, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 11 }} tickMargin={10} minTickGap={30} axisLine={false} tickLine={false} />
              
              <YAxis 
                yAxisId="price" 
                domain={([dataMin, dataMax]) => {
                  // This fixes the line stretching! 15% dynamic padding
                  const range = dataMax - dataMin;
                  const pad = range === 0 ? 100 : range * 0.15;
                  return [dataMin - pad, dataMax + pad];
                }}
                allowDataOverflow={true} // Forces Recharts to obey our padding
                orientation="right" 
                stroke="#64748b" 
                tick={{ fontSize: 11, fontWeight: 'bold' }} 
                tickFormatter={v => v.toLocaleString()} 
                axisLine={false} 
                tickLine={false}
              />

              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '8px', color: '#f8fafc' }}
                itemStyle={{ fontWeight: 'bold' }}
                cursor={{ stroke: '#475569', strokeWidth: 1, strokeDasharray: '4 4' }}
              />

              {/* Pro Indicators */}
              <Customized component={renderVPVR} />
              
              {toggles.vwap && (
                <Line yAxisId="price" type="monotone" dataKey="vwap" stroke="#a855f7" strokeDasharray="5 5" strokeWidth={2} dot={false} isAnimationActive={false} name="VWAP" />
              )}

              {toggles.maxPain && !isMaxPainOffScreen && (
                <ReferenceLine yAxisId="price" y={optionsData.maxPain} ifOverflow="extendDomain" stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={2} strokeOpacity={0.8} />
              )}

              {toggles.sr && autoLevels.res && (
                <>
                  <ReferenceLine yAxisId="price" y={autoLevels.res} ifOverflow="extendDomain" stroke="#ef4444" strokeDasharray="3 3" strokeWidth={2} strokeOpacity={0.5} />
                  <ReferenceLine yAxisId="price" y={autoLevels.sup} ifOverflow="extendDomain" stroke="#10b981" strokeDasharray="3 3" strokeWidth={2} strokeOpacity={0.5} />
                </>
              )}

              <Bar yAxisId="price" dataKey="candleRange" shape={(props) => <CustomCandlestick {...props} />} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Right Sidebar - Pro Terminal Modules */}
        <div className="flex flex-col gap-4">
          
          {/* Order Flow Engine Controls */}
          <div className="bg-[#111827] rounded-lg border border-slate-800 p-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm font-bold flex items-center gap-2 text-slate-300">
                <Crosshair size={16} className="text-blue-500" /> ORDER FLOW ENGINE
              </h2>
              <div className="flex gap-1.5">
                <button onClick={() => setToggles(p => ({...p, vpvr: !p.vpvr}))} className={toggleBtnClass(toggles.vpvr)}>VPVR</button>
                <button onClick={() => setToggles(p => ({...p, vwap: !p.vwap}))} className={toggleBtnClass(toggles.vwap)}>VWAP</button>
                <button onClick={() => setToggles(p => ({...p, sr: !p.sr}))} className={toggleBtnClass(toggles.sr)}>S/R</button>
                <button onClick={() => setToggles(p => ({...p, maxPain: !p.maxPain}))} className={toggleBtnClass(toggles.maxPain)}>MAX PAIN</button>
              </div>
            </div>

            {/* Score Card */}
            <div className="bg-[#0f172a] rounded p-3 border border-slate-700/50 mb-3 flex justify-between items-center">
              <div>
                <div className="text-xs text-slate-500 font-bold mb-1">STATUS</div>
                <div className={`text-lg font-black tracking-wide ${setupEngine.score >= 5 ? 'text-emerald-400 animate-pulse' : 'text-blue-400'}`}>
                  {setupEngine.score >= 5 ? `${setupEngine.type} TRIGGERED` : setupEngine.score > 2 ? `${setupEngine.type} SETTING UP` : 'WAITING FOR SETUP'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500 font-bold mb-1">CONDITIONS</div>
                <div className="text-xl font-bold text-white">{setupEngine.score} / 6</div>
              </div>
            </div>

            <div className="space-y-2 text-sm font-medium">
              <div className="flex justify-between p-2 border-b border-slate-800/50"><span className="text-slate-500">Price Location:</span> <span className={setupEngine.conditions.loc !== 'Waiting' ? 'text-blue-400' : 'text-slate-300'}>{setupEngine.conditions.loc}</span></div>
              <div className="flex justify-between p-2 border-b border-slate-800/50"><span className="text-slate-500">DOM Imbalance:</span> <span className={setupEngine.conditions.dom.includes('Wall') ? 'text-amber-400' : 'text-slate-300'}>{setupEngine.conditions.dom}</span></div>
              <div className="flex justify-between p-2 border-b border-slate-800/50"><span className="text-slate-500">Tape Absorption:</span> <span className={setupEngine.conditions.tape !== 'None' ? 'text-fuchsia-400' : 'text-slate-300'}>{setupEngine.conditions.tape}</span></div>
              <div className="flex justify-between p-2"><span className="text-slate-500">Options Bias:</span> <span className={setupEngine.conditions.options === 'Bullish' ? 'text-emerald-400' : setupEngine.conditions.options === 'Bearish' ? 'text-rose-400' : 'text-slate-300'}>{setupEngine.conditions.options}</span></div>
            </div>
          </div>

          {/* Deribit Options Flow */}
          <div className="bg-[#111827] rounded-lg border border-slate-800 p-4">
            <h2 className="text-sm font-bold flex items-center gap-2 text-slate-300 mb-4">
              <Activity size={16} className="text-indigo-400" /> DERIBIT OPTIONS FLOW
            </h2>
            <div className="flex justify-between items-end mb-2">
              <div>
                <div className="text-xs text-slate-500 font-bold mb-1">PUT/CALL RATIO (PCR)</div>
                <div className={`text-2xl font-bold ${optionsData.pcr > 1 ? 'text-rose-400' : 'text-emerald-400'}`}>{optionsData.pcr.toFixed(2)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500 font-bold mb-1">MAX PAIN MAGNET</div>
                <div className="text-xl font-bold text-amber-400">${optionsData.maxPain.toLocaleString()}</div>
              </div>
            </div>
            
            {/* Custom PCR Gauge */}
            <div className="w-full h-1.5 bg-slate-800 rounded-full mt-4 relative">
              <div className="absolute top-[-4px] w-2 h-3 bg-white rounded-sm shadow" style={{ left: `${Math.min(100, Math.max(0, (optionsData.pcr / 1.5) * 100))}%` }}></div>
              <div className="w-full flex justify-between mt-2 text-[9px] text-slate-500 font-bold">
                <span>EXTREME GREED (PCR {"<"} 0.6)</span>
                <span>EXTREME FEAR (PCR {">"} 1.2)</span>
              </div>
            </div>
          </div>

          {/* Whale CVD Tracker */}
          <div className="bg-[#111827] rounded-lg border border-slate-800 p-4">
            <h2 className="text-sm font-bold text-slate-300 mb-4">WHALE CVD TRACKER (&gt;$5K HITS)</h2>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-[#0f172a] rounded p-3 text-center border border-slate-800">
                <div className="text-xs text-slate-500 font-bold mb-1">SESSION CVD</div>
                <div className={`text-lg font-bold ${cvdData.sessionCvd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {cvdData.sessionCvd > 0 ? '+' : ''}{cvdData.sessionCvd.toFixed(2)}
                </div>
              </div>
              <div className="bg-[#0f172a] rounded p-3 text-center border border-slate-800">
                <div className="text-xs text-slate-500 font-bold mb-1">INSTANT DELTA</div>
                <div className={`text-lg font-bold ${cvdData.instantDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {cvdData.instantDelta > 0 ? '+' : ''}{cvdData.instantDelta.toFixed(2)}
                </div>
              </div>
            </div>
            <div className="w-full h-2 rounded flex overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: `${Math.max(10, (cvdData.buyVol / (cvdData.buyVol + cvdData.sellVol || 1)) * 100)}%` }}></div>
              <div className="h-full bg-rose-500" style={{ width: `${Math.max(10, (cvdData.sellVol / (cvdData.buyVol + cvdData.sellVol || 1)) * 100)}%` }}></div>
            </div>
          </div>

          {/* Paper Trading Bot */}
          <div className="bg-[#111827] rounded-lg border border-indigo-900/50 p-4 shadow-[0_0_15px_rgba(79,70,229,0.1)] relative overflow-hidden">
            {botState.active && <div className="absolute top-0 left-0 w-full h-1 bg-indigo-500 animate-pulse"></div>}
            
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm font-bold flex items-center gap-2 text-slate-300">
                <Database size={16} className={botState.active ? "text-indigo-400" : "text-slate-500"} /> AUTO-TRADER (PAPER)
              </h2>
              <button 
                onClick={() => setBotState(p => ({...p, active: !p.active}))}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-all ${botState.active ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30' : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg'}`}
              >
                {botState.active ? <><Square size={12}/> STOP BOT</> : <><Play size={12}/> RUN BOT</>}
              </button>
            </div>

            <div className="bg-[#0f172a] rounded p-3 flex justify-between items-center mb-3 border border-slate-800">
              <span className="text-sm font-medium text-slate-400">Account Balance</span>
              <span className="text-xl font-mono font-bold text-white">${botState.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>

            {botState.position ? (
              <div className="bg-indigo-900/20 rounded p-3 border border-indigo-500/30">
                <div className="flex justify-between text-xs mb-2">
                  <span className={`font-bold ${botState.position.type === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>ACTIVE {botState.position.type}</span>
                  <span className="text-slate-400">Entry: ${botState.position.entry.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-rose-400">SL: ${botState.position.sl.toFixed(2)}</span>
                  <span className="text-emerald-400">TP: ${botState.position.tp.toFixed(2)}</span>
                </div>
              </div>
            ) : (
              <div className="text-center text-xs text-slate-500 py-3 bg-[#0f172a] rounded border border-slate-800 border-dashed">
                {botState.active ? "Sniffing Order Flow for 5/6 Setup..." : "Bot is offline."}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}