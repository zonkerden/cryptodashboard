export const FEE = 0.001;
export const emptyMarket = () => ({ price: 0, candles: [], bids: [], asks: [], trades: [], bookAt: 0, tradeAt: 0 });

export function analyze(market, now = Date.now()) {
  const { price, candles, bids, asks } = market;
  const trades = market.trades.filter(t => now - t.time < 60000);
  const buy = trades.filter(t => !t.sell).reduce((s, t) => s + t.price * t.qty, 0);
  const sell = trades.filter(t => t.sell).reduce((s, t) => s + t.price * t.qty, 0);
  const bidSize = bids.reduce((s, b) => s + b[0] * b[1], 0);
  const askSize = asks.reduce((s, a) => s + a[0] * a[1], 0);
  const imbalance = (bidSize - askSize) / (bidSize + askSize || 1);
  const delta = (buy - sell) / (buy + sell || 1);
  const volume = candles.reduce((s, c) => s + c.volume, 0);
  const vwap = candles.reduce((s, c) => s + (c.high + c.low + c.close) / 3 * c.volume, 0) / (volume || 1);
  const ranges = candles.slice(-14).map((c, i, arr) => Math.max(c.high - c.low, Math.abs(c.high - (arr[i - 1]?.close ?? c.open)), Math.abs(c.low - (arr[i - 1]?.close ?? c.open))));
  const atr = ranges.reduce((s, n) => s + n, 0) / (ranges.length || 1);
  const spread = bids.length && asks.length ? (asks[0][0] - bids[0][0]) / price * 10000 : Infinity;
  const fresh = now - market.bookAt < 5000 && now - market.tradeAt < 5000;
  const ready = price > 0 && candles.length >= 20 && bids.length > 0 && asks.length > 0 && fresh;
  const long = imbalance > 0.12 && delta > 0.12 && price >= vwap;
  const short = imbalance < -0.12 && delta < -0.12 && price < vwap;
  const direction = long ? 'LONG' : short ? 'SHORT' : 'WAIT';
  const side = short ? -1 : 1;
  const entry = (short ? bids[0]?.[0] : asks[0]?.[0]) || price;
  const distance = Math.max(atr * 1.5, price * 0.003);
  const stop = entry - side * distance;
  const target = entry + side * distance * 3;
  const netRR = (distance * 3 - (entry + target) * FEE) / (distance + (entry + stop) * FEE);
  const score = Math.round((Number(side * imbalance > 0.12) + Number(side * delta > 0.12) + Number(side * (price - vwap) >= 0) + Number(spread < 5)) * 25);
  const allowed = ready && direction === 'LONG' && spread < 5 && netRR >= 1.4;
  return { buy, sell, imbalance, delta, vwap, atr, spread, fresh, ready, direction, entry, stop, target, score, netRR, allowed,
    reason: !ready ? 'Waiting for fresh depth, trades and 20 candles.' : spread >= 5 ? 'Spread exceeds the 5 bps limit.' : short ? 'Sell pressure detected. Spot bot waits for a long setup.' : !long ? 'Flow and trend are not aligned. Preserve capital.' : netRR < 1.4 ? 'Reward after estimated fees is too low.' : 'Buy pressure, bid liquidity and VWAP are aligned.' };
}

export function stepAccount(account, market, signal, risk, now = Date.now(), manual = false) {
  const position = account.position;
  if (!signal.ready) return account;
  const bid = market.bids[0][0];
  const ask = market.asks[0][0];
  if (position) {
    const reason = manual ? 'Manual close' : bid <= position.stop ? 'Stop loss' : bid >= position.target ? 'Take profit' : null;
    if (!reason) return account;
    const pnl = (bid - position.entry) * position.qty - (position.entry + bid) * position.qty * FEE;
    return { ...account, balance: account.balance + pnl, position: null, lastExit: now, history: [{ ...position, exit: bid, pnl, reason, closed: now }, ...account.history].slice(0, 100) };
  }
  if (!account.running || !signal.allowed || now - account.lastExit < 30000) return account;
  const unitRisk = ask - signal.stop + (ask + signal.stop) * FEE;
  const qty = Math.min(account.balance * risk / 100 / unitRisk, account.balance / (ask * (1 + FEE)));
  if (!(qty > 0) || account.balance <= 0) return account;
  return { ...account, position: { entry: ask, stop: signal.stop, target: signal.target, qty, opened: now } };
}

export function demoMarket(symbol, tick, now = Date.now()) {
  const base = { BTC: 67420, ETH: 3520, SOL: 148.6 }[symbol];
  const price = base * (1 + Math.sin(tick / 18) * 0.002 + tick % 120 * 0.000008);
  const candles = Array.from({ length: 60 }, (_, i) => {
    const close = price * (0.995 + i * 0.00008 + Math.sin(i * 0.8 + tick / 18) * 0.0008);
    return { time: now - (59 - i) * 60000, open: close * 0.9997, close, high: close * 1.0006, low: close * 0.9993, volume: 5 + (i * 7 % 19) };
  });
  const bullish = Math.sin(tick / 24) > -0.35;
  const bids = Array.from({ length: 20 }, (_, i) => [price * (1 - (i + 1) * 0.00002), (bullish ? 2.4 : 0.7) + (i * 3 % 7) / 5]);
  const asks = Array.from({ length: 20 }, (_, i) => [price * (1 + (i + 1) * 0.00002), (bullish ? 0.6 : 2.5) + (i * 2 % 5) / 5]);
  const trades = Array.from({ length: 32 }, (_, i) => ({ price: price * (1 + Math.sin(i) * 0.00004), qty: 0.1 + i % 5 * 0.07, sell: bullish ? i % 5 === 0 : i % 5 !== 0, time: now - i * 1300 }));
  return { price, candles, bids, asks, trades, bookAt: now, tradeAt: now };
}
