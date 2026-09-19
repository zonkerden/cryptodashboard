import React, { useState, useEffect, useMemo } from 'react';
import { 
  ResponsiveContainer, 
  ComposedChart, 
  LineChart,
  Line,
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend,
  ReferenceLine
} from 'recharts';
import { Activity, Radio, Wifi, WifiOff, Loader2, BarChart2, TrendingUp } from 'lucide-react';

// This custom component draws the Wick and Body of the candlestick
const CustomCandlestick = (props) => {
  const { x, y, width, height, payload } = props;
  const isUp = payload.close >= payload.open;
  const color = isUp ? '#10b981' : '#ef4444'; // Emerald for Up, Rose for Down

  // Calculate the total range (High to Low)
  const range = payload.high - payload.low;
  
  // If there's no movement, just draw a flat line
  if (range === 0) {
    return <line x1={x} y1={y} x2={x + width} y2={y} stroke={color} strokeWidth={2} />;
  }

  // Calculate the ratio of pixels per dollar
  const ratio = height / range;
  
  // Calculate exact Y coordinates for the Open and Close of the body
  const openY = y + (payload.high - payload.open) * ratio;
  const closeY = y + (payload.high - payload.close) * ratio;

  const topY = Math.min(openY, closeY);
  const bottomY = Math.max(openY, closeY);
  const bodyHeight = Math.max(bottomY - topY, 2); // Ensure body is at least 2px tall so it's visible

  return (
    <g>
      {/* Wick (High to Low) */}
      <line x1={x + width / 2} y1={y} x2={x + width / 2} y2={y + height} stroke={color} strokeWidth={1} />
      {/* Body (Open to Close) */}
      <rect x={x + width * 0.2} y={topY} width={width * 0.6} height={bodyHeight} fill={color} stroke={color} />
    </g>
  );
};

// Calculates the Simple Moving Average (SMA)
const calculateSMA = (data, period) => {
  return data.map((point, index, arr) => {
    if (index < period - 1) return { ...point, sma: null };
    const sum = arr.slice(index - period + 1, index + 1).reduce((acc, val) => acc + val.price, 0);
    return { ...point, sma: sum / period };
  });
};

// Calculates the Exponential Moving Average (EMA)
const calculateEMA = (data, period) => {
  const k = 2 / (period + 1);
  let ema = data[0]?.price || 0;
  return data.map((point, index) => {
    if (index === 0) return { ...point, ema: null };
    ema = point.price * k + ema * (1 - k);
    return { ...point, ema };
  });
};

// Calculates Bollinger Bands (20 period, 2 StdDev)
const calculateBollingerBands = (data, period = 20, multiplier = 2) => {
  return data.map((point, index, arr) => {
    if (index < period - 1) return { ...point, bbUpper: null, bbLower: null };
    const slice = arr.slice(index - period + 1, index + 1);
    const sum = slice.reduce((acc, val) => acc + val.price, 0);
    const sma = sum / period;
    const variance = slice.reduce((acc, val) => acc + Math.pow(val.price - sma, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    return {
      ...point,
      bbUpper: sma + stdDev * multiplier,
      bbLower: sma - stdDev * multiplier
    };
  });
};

// Calculates the Relative Strength Index (RSI)
const calculateRSI = (data, period = 14) => {
  let avgGain = 0;
  let avgLoss = 0;

  return data.map((point, index, arr) => {
    if (index === 0) return { ...point, rsi: null };
    
    const diff = point.price - arr[index - 1].price;
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
  const date = new Date(timestamp);
  if (tf === 'LIVE') return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (tf === '1M') return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit' });
  if (tf === '5Y') return date.toLocaleDateString([], { year: 'numeric', month: 'short' });
  return date.toLocaleDateString([], { year: '2-digit', month: 'short', day: 'numeric' });
};

export default function LiveCryptoDashboard() {
  const [selectedPair, setSelectedPair] = useState('BTCUSDT');
  const [selectedTimeframe, setSelectedTimeframe] = useState('LIVE');
  const [chartType, setChartType] = useState('candle'); // 'line' or 'candle'
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wsStatus, setWsStatus] = useState('connecting'); // connecting, connected, error, disconnected
  
  // Indicator Toggles
  const [showSMA, setShowSMA] = useState(true);
  const [showEMA, setShowEMA] = useState(false);
  const [showFib, setShowFib] = useState(false);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [showRSI, setShowRSI] = useState(false);
  
  const smaPeriod = 14;
  const emaPeriod = 9;

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
        } catch (err) {
          // Ignore and try next
        }
      }
      throw new Error('NetworkError: All API fallback endpoints failed.');
    };

    const fetchHistoricalAndStartPolling = async () => {
      try {
        setLoading(true);
        const res = await fetchWithFallback(`/api/v3/klines?symbol=${selectedPair}&interval=${tfConfig.interval}&limit=${tfConfig.limit}`);
        const json = await res.json();
        
        if (!isMounted) return;

        // Map Binance response to include OHLC (Open, High, Low, Close)
        const historicalData = json.map(d => ({
          timestamp: d[0],
          time: formatTime(d[0], selectedTimeframe),
          open: parseFloat(d[1]),
          high: parseFloat(d[2]),
          low: parseFloat(d[3]),
          close: parseFloat(d[4]),
          price: parseFloat(d[4]), // Maintain 'price' for backwards compatibility with moving averages
          volume: parseFloat(d[5]), 
          candleRange: [parseFloat(d[3]), parseFloat(d[2])] // [low, high] required for the Recharts Bar boundary
        }));
        
        setData(historicalData);
        setLoading(false);
        setWsStatus('connected');

        pollInterval = setInterval(async () => {
          try {
            const priceRes = await fetchWithFallback(`/api/v3/klines?symbol=${selectedPair}&interval=${tfConfig.interval}&limit=1`);
            const priceData = await priceRes.json();
            
            if (!isMounted) return;

            const latestKline = priceData[0];
            const klineStartTime = latestKline[0];
            const currentOpen = parseFloat(latestKline[1]);
            const currentHigh = parseFloat(latestKline[2]);
            const currentLow = parseFloat(latestKline[3]);
            const currentClose = parseFloat(latestKline[4]);
            const currentVolume = parseFloat(latestKline[5]);

            setData(prevData => {
              if (prevData.length === 0) return prevData;
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
          setWsStatus('error');
        }
      }
    };

    fetchHistoricalAndStartPolling();

    return () => {
      isMounted = false;
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [selectedPair, selectedTimeframe]);

  // Process the chart data to include our MAs and RSI
  const chartData = useMemo(() => {
    if (data.length === 0) return [];
    let processed = calculateSMA(data, smaPeriod);
    processed = calculateEMA(processed, emaPeriod);
    processed = calculateBollingerBands(processed, 20);
    processed = calculateRSI(processed, 14);
    return processed;
  }, [data, smaPeriod, emaPeriod]);

  // Calculate dynamic Fibonacci Retracement levels
  const fibLevels = useMemo(() => {
    if (!showFib || data.length === 0) return null;
    const prices = data.map(d => d.price);
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const diff = high - low;
    
    if (diff === 0) return null;

    return {
      0: high,
      0.236: high - diff * 0.236,
      0.382: high - diff * 0.382,
      0.5: high - diff * 0.5,
      0.618: high - diff * 0.618,
      1: low
    };
  }, [data, showFib]);

  const currentPrice = data.length > 0 ? data[data.length - 1].price : 0;
  const previousPrice = data.length > 1 ? data[data.length - 2].price : 0;
  const isPriceUp = currentPrice >= previousPrice;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-6 font-sans">
      <div className="max-w-7xl mx-auto">
        
        {/* Header Section */}
        <header className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-2">
              {/* Asset Selector */}
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

              {/* Timeframe Selector */}
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

              {/* Chart Type Selector */}
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
              </div>

              <span className="px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-300 items-center gap-1.5 shadow-sm hidden lg:flex">
                <Radio size={12} className="text-blue-400" /> Binance
              </span>
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

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          
          {/* Main Chart Area */}
          <div className="lg:col-span-3 bg-slate-900 rounded-xl p-2 sm:p-4 shadow-xl border border-slate-800 relative flex flex-col transition-all duration-300">
            
            {loading ? (
              <div className="w-full h-[500px] flex flex-col items-center justify-center text-slate-500">
                <Loader2 className="w-10 h-10 animate-spin mb-4 text-blue-500" />
                <p>Fetching historical data...</p>
              </div>
            ) : (
              <>
                {/* Main Price Chart */}
                <div className={`w-full relative transition-all duration-300 ${showRSI ? 'h-[350px]' : 'h-[500px]'}`}>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03] z-0">
                    <span className="text-[10rem] font-bold tracking-tighter text-white">
                      {COIN_CONFIG[selectedPair].label}
                    </span>
                  </div>
                  
                  <ResponsiveContainer width="100%" height="100%" className="relative z-10">
                    <ComposedChart data={chartData} syncId="cryptoSync" margin={{ top: 20, right: 10, left: 20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      
                      <XAxis 
                        dataKey="time" 
                        stroke="#e2e8f0" 
                        tick={showRSI ? false : { fill: '#e2e8f0', fontSize: 13, fontWeight: 600 }}
                        tickMargin={12}
                        minTickGap={30}
                        axisLine={{ stroke: '#334155' }}
                      />
                      
                      <YAxis 
                        yAxisId="price"
                        domain={['auto', 'auto']} 
                        stroke="#e2e8f0" 
                        tick={{ fill: '#e2e8f0', fontSize: 13, fontWeight: 600 }}
                        tickFormatter={(val) => `$${val.toLocaleString()}`}
                        width={80}
                        axisLine={{ stroke: '#334155' }}
                        tickLine={{ stroke: '#334155' }}
                      />

                      <YAxis 
                        yAxisId="volume" 
                        orientation="right" 
                        domain={[0, dataMax => dataMax * 4]} 
                        hide={true} 
                      />

                      {/* Tooltip Formatter setup to handle both OHLC Candles and standard Line price */}
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc', borderRadius: '0.5rem', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.5)' }}
                        itemStyle={{ color: '#e2e8f0', fontSize: '14px', padding: '2px 0' }}
                        labelStyle={{ color: '#94a3b8', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}
                        formatter={(value, name, props) => {
                          if (name === 'Volume') return [Number(value).toLocaleString(), name];
                          if (name === 'Candles' || name === 'candleRange') {
                            const { open, high, low, close } = props.payload;
                            return [`O: ${open.toLocaleString()} | H: ${high.toLocaleString()} | L: ${low.toLocaleString()} | C: ${close.toLocaleString()}`, 'OHLC'];
                          }
                          if (name === 'RSI') return []; 
                          return [`$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, name];
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
                      
                      {/* Render either Line or Candlesticks based on user selection */}
                      {chartType === 'line' ? (
                        <Line 
                          yAxisId="price"
                          type="monotone" 
                          dataKey="price" 
                          stroke="#fbbf24" // Yellowish tone
                          dot={false} 
                          strokeWidth={2.5} 
                          name="Price Action" 
                          isAnimationActive={false} 
                        />
                      ) : (
                        <Bar 
                          yAxisId="price"
                          dataKey="candleRange" 
                          shape={<CustomCandlestick />} 
                          name="Candles" 
                          isAnimationActive={false} 
                        />
                      )}

                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Secondary RSI Chart */}
                {showRSI && (
                  <div className="w-full h-[150px] relative mt-2 border-t border-slate-800 pt-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} syncId="cryptoSync" margin={{ top: 5, right: 10, left: 20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                        <XAxis 
                          dataKey="time" 
                          stroke="#e2e8f0" 
                          tick={{ fill: '#e2e8f0', fontSize: 13, fontWeight: 600 }}
                          tickMargin={12}
                          minTickGap={30}
                          axisLine={{ stroke: '#334155' }}
                        />
                        <YAxis 
                          domain={[0, 100]} 
                          stroke="#e2e8f0" 
                          tick={{ fill: '#e2e8f0', fontSize: 12, fontWeight: 600 }} 
                          width={80} 
                          ticks={[30, 50, 70]} 
                          axisLine={{ stroke: '#334155' }} 
                          tickLine={{ stroke: '#334155' }}
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc', borderRadius: '0.5rem', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.5)' }}
                          itemStyle={{ color: '#d946ef', fontSize: '14px', fontWeight: 'bold' }}
                          labelStyle={{ display: 'none' }}
                          formatter={(value, name) => {
                            if (name === 'rsi') return [Number(value).toFixed(2), 'RSI'];
                            return [];
                          }}
                        />
                        <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.6} />
                        <ReferenceLine y={30} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.6} />
                        
                        <Line 
                          type="monotone" 
                          dataKey="rsi" 
                          stroke="#d946ef" 
                          dot={false} 
                          strokeWidth={2} 
                          name="rsi" 
                          isAnimationActive={false} 
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Side Controls Panel */}
          <div className="bg-slate-900 rounded-xl p-5 shadow-xl border border-slate-800 h-fit flex flex-col gap-6">
            <div>
              <h2 className="text-lg font-semibold mb-4 text-slate-100 flex items-center gap-2">
                <Activity size={18} className="text-blue-500" />
                Indicators
              </h2>
              
              <div className="space-y-4">
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

            {/* Live Status Widget */}
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

          </div>
        </div>
      </div>
    </div>
  );
}