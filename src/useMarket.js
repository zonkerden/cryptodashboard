import { useEffect, useState } from 'react';
import { demoMarket, emptyMarket } from './engine';

export default function useMarket(symbol, mode) {
  const [snapshot, setSnapshot] = useState({ market: emptyMarket(), status: 'Connecting' });
  useEffect(() => {
    let disposed = false;
    let timer, retry, socket;
    let market = emptyMarket();
    let status = mode === 'demo' ? 'Demo feed' : 'Connecting';
    let tick = 0;
    const publish = () => { if (!disposed) setSnapshot({ market: { ...market }, status }); };
    if (mode === 'demo') {
      market = demoMarket(symbol, tick++);
      timer = setInterval(() => { market = demoMarket(symbol, tick++); publish(); }, 1000);
      const first = setTimeout(publish, 0);
      return () => { disposed = true; clearTimeout(first); clearInterval(timer); };
    }
    const controller = new AbortController();
    fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1m&limit=60`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error('History unavailable'); return r.json(); })
      .then(rows => {
        if (disposed) return;
        const merged = new Map(rows.map(r => [r[0], { time: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] }]));
        market.candles.forEach(c => merged.set(c.time, c));
        market.candles = [...merged.values()].sort((a, b) => a.time - b.time).slice(-60);
      }).catch(() => { /* Stream candles continue warmup if REST is unavailable. */ });
    const connect = () => {
      if (disposed) return;
      status = 'Connecting';
      const pair = `${symbol.toLowerCase()}usdt`;
      socket = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${pair}@trade/${pair}@depth20@100ms/${pair}@kline_1m`);
      socket.onopen = () => { status = 'Live feed'; };
      socket.onmessage = event => {
        if (disposed) return;
        try {
          const p = JSON.parse(event.data).data;
          const now = Date.now();
          if (p.bids && p.asks) { market.bids = p.bids.map(b => b.map(Number)); market.asks = p.asks.map(a => a.map(Number)); market.bookAt = now; }
          if (p.e === 'trade') {
            market.price = +p.p; market.tradeAt = now;
            market.trades = [...market.trades.filter(t => now - t.time < 60000), { price: +p.p, qty: +p.q, sell: p.m, time: p.T }].slice(-20000);
          }
          if (p.e === 'kline') {
            const k = p.k;
            const candle = { time: k.t, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
            market.candles = [...market.candles.filter(c => c.time !== k.t), candle].sort((a, b) => a.time - b.time).slice(-60);
          }
        } catch { status = 'Feed error'; }
      };
      socket.onerror = () => { status = 'Feed unavailable'; };
      socket.onclose = () => { status = 'Reconnecting'; market.bookAt = 0; market.tradeAt = 0; if (!disposed) retry = setTimeout(connect, 5000); };
    };
    connect();
    timer = setInterval(publish, 1000);
    return () => { disposed = true; controller.abort(); clearInterval(timer); clearTimeout(retry); socket?.close(); };
  }, [symbol, mode]);
  return snapshot;
}
