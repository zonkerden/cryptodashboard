import React,{useEffect,useMemo,useRef,useState}from'react';
import{Wifi,WifiOff,RefreshCw,AlertTriangle,Database}from'lucide-react';

const CFG={
 BTCUSDT:{t:'BTC',name:'Bitcoin',trigger:87500,d:0},
 ETHUSDT:{t:'ETH',name:'Ethereum',trigger:2800,d:2},
 SOLUSDT:{t:'SOL',name:'Solana',trigger:120,d:2}
};
const SYMS=Object.keys(CFG),WINDOWS={'5m':5,'15m':15,'1H':60,'4H':240},STORE='flow_history_v2';
const blank=()=>({price:0,buy:0,sell:0,cvd:0,bid:0,ask:0,imb:0,spread:0,c1:null,p1:null,c4:null,p4:null,oi:null,funding:null});
const initial=Object.fromEntries(SYMS.map(s=>[s,blank()]));
const emptyFlows=()=>Object.fromEntries(SYMS.map(s=>[s,Object.fromEntries(Object.keys(WINDOWS).map(w=>[w,{delta:0,deltaPct:0,oiPct:null,imb:null,samples:0}]))]));
const money=(v,d=0)=>Number.isFinite(v)?'$'+v.toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const compact=v=>Number.isFinite(v)?new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:2}).format(v):'—';
const pc=(v,d=1)=>Number.isFinite(v)?(v>=0?'+':'')+v.toFixed(d)+'%':'—';
async function json(u){const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw Error(r.status);return r.json()}
const candle=d=>({o:+d[1],h:+d[2],l:+d[3],c:+d[4],v:+d[5]});
function loadHistory(){try{const x=JSON.parse(localStorage.getItem(STORE)||'{}');return Object.fromEntries(SYMS.map(s=>[s,Array.isArray(x[s])?x[s]:[]]))}catch{return Object.fromEntries(SYMS.map(s=>[s,[]]))}}
function flowFromKlines(rows,n){const r=rows.slice(-n),quote=r.reduce((a,x)=>a+(+x[7]||0),0),buy=r.reduce((a,x)=>a+(+x[10]||0),0),delta=2*buy-quote;return{delta,deltaPct:quote?delta/quote*100:0}}
function depthAverage(hist,mins,fallback){const cut=Date.now()-mins*60000,rows=hist.filter(x=>x.ts>=cut&&Number.isFinite(x.imb));if(!rows.length)return{imb:fallback,samples:0};return{imb:rows.reduce((a,x)=>a+x.imb,0)/rows.length,samples:rows.length}}
function oiChange(rows,n){if(!rows?.length)return null;const last=+(rows.at(-1)?.sumOpenInterest||0),idx=Math.max(0,rows.length-1-n),old=+(rows[idx]?.sumOpenInterest||0);return old?(last-old)/old*100:null}

function classify(sym,s,f){
 const c=CFG[sym],f1=f?.['1H']||{},f4=f?.['4H']||{};
 if(!s.price||!s.c1||!s.p1||!s.c4||!s.p4)return{label:'LOADING',tone:'neutral',score:0,reasons:['Waiting for market structure data']};
 const breakout=s.c1.c>c.trigger;
 const bull=[f1.deltaPct>0.5,f1.imb>0.05,(f1.oiPct??0)>0.1],bear=[f1.deltaPct<-.5,f1.imb<-.05,(f1.oiPct??0)<-.1];
 const bullN=bull.filter(Boolean).length,bearN=bear.filter(Boolean).length;
 const bear1=s.c1.l<s.p1.l&&s.c1.c<s.p1.c,bear4=s.c4.l<s.p4.l&&s.c4.c<s.p4.c;
 if(breakout){
  let score=4+bullN*2+(s.price>=c.trigger?1:0);
  const reasons=['Last closed 1H candle is above '+money(c.trigger,c.d)];
  if(f1.deltaPct>0.5)reasons.push('1H taker-flow delta is positive');
  if(f1.imb>0.05)reasons.push('Persistent depth imbalance favors bids');
  if((f1.oiPct??0)>0.1)reasons.push('1H open interest is expanding');
  if(bearN>=2)return{label:'FALSE-BREAKOUT RISK',tone:'warn',score:Math.min(10,score),reasons:[...reasons,'Two or more order-flow/derivatives signals contradict price']};
  return bullN>=2&&s.price>=c.trigger?{label:'CONFIRMED BREAKOUT',tone:'bull',score:Math.min(10,score),reasons}:{label:'WEAK / UNCONFIRMED',tone:'warn',score:Math.min(10,score),reasons:[...reasons,'Needs at least two supportive flow confirmations and level hold']};
 }
 if((bear1||bear4)&&(bearN>=1||(f4.deltaPct<0&&f4.imb<0))){
  const reasons=[];
  if(bear1)reasons.push('Closed 1H structure made a lower low/lower close');
  if(bear4)reasons.push('Closed 4H structure made a lower low/lower close');
  if(f1.deltaPct<-.5)reasons.push('1H aggressive sell flow dominates');
  if(f1.imb<-.05)reasons.push('1H persistent depth favors asks');
  if((f1.oiPct??0)<-.1)reasons.push('1H OI is contracting / deleveraging');
  return{label:'BEARISH STRUCTURE',tone:'bear',score:Math.min(10,5+reasons.length),reasons};
 }
 if(s.price>c.trigger*.995)return{label:'AT TRIGGER',tone:'warn',score:3,reasons:['Price is testing the breakout zone',f1.deltaPct>0?'1H taker flow is supportive':'1H taker flow is not supportive']};
 return{label:'WAIT',tone:'neutral',score:1,reasons:['No confirmed breakout or bearish structure change']};
}

export default function App(){
 const[m,setM]=useState(initial),[flows,setFlows]=useState(emptyFlows),[sel,setSel]=useState('BTCUSDT'),[win,setWin]=useState('1H'),[live,setLive]=useState(false),[refreshed,setRefreshed]=useState(null);
 const mRef=useRef(m),histRef=useRef(loadHistory()),cvdRef=useRef(Object.fromEntries(SYMS.map(s=>[s,histRef.current[s].at(-1)?.cvd||0])));
 useEffect(()=>{mRef.current=m},[m]);

 const refresh=async()=>{
  await Promise.all(SYMS.map(async sym=>{try{
   const[k1,k4,oi,f,flowK,oiH]=await Promise.all([
    json('https://api.binance.com/api/v3/klines?symbol='+sym+'&interval=1h&limit=5'),
    json('https://api.binance.com/api/v3/klines?symbol='+sym+'&interval=4h&limit=5'),
    json('https://fapi.binance.com/fapi/v1/openInterest?symbol='+sym),
    json('https://fapi.binance.com/fapi/v1/premiumIndex?symbol='+sym),
    json('https://api.binance.com/api/v3/klines?symbol='+sym+'&interval=5m&limit=49'),
    json('https://fapi.binance.com/futures/data/openInterestHist?symbol='+sym+'&period=5m&limit=49')
   ]);
   const c1=candle(k1.at(-2)),p1=candle(k1.at(-3)),c4=candle(k4.at(-2)),p4=candle(k4.at(-3));
   setM(p=>({...p,[sym]:{...p[sym],c1,p1,c4,p4,oi:+oi.openInterest,funding:+f.lastFundingRate}}));
   const next={};
   for(const[w,mins]of Object.entries(WINDOWS)){const n=Math.max(1,Math.round(mins/5)),q=flowFromKlines(flowK,n),dep=depthAverage(histRef.current[sym],mins,mRef.current[sym].imb);next[w]={...q,oiPct:oiChange(oiH,n),...dep}}
   setFlows(p=>({...p,[sym]:next}));
  }catch(e){console.error('refresh',sym,e)}}));
  setRefreshed(Date.now());
 };
 useEffect(()=>{refresh();const id=setInterval(refresh,30000);return()=>clearInterval(id)},[]);

 useEffect(()=>{
  const streams=SYMS.flatMap(s=>{const x=s.toLowerCase();return[x+'@aggTrade',x+'@depth20@100ms']}).join('/');
  const ws=new WebSocket('wss://stream.binance.com:9443/stream?streams='+streams);
  ws.onopen=()=>setLive(true);ws.onclose=()=>setLive(false);ws.onerror=()=>setLive(false);
  ws.onmessage=e=>{const z=JSON.parse(e.data),st=z.stream||'',sym=SYMS.find(s=>st.startsWith(s.toLowerCase()));if(!sym)return;const d=z.data;
   if(st.includes('@aggTrade')){const price=+d.p,usd=price*(+d.q),sell=d.m===true,sign=sell?-usd:usd;cvdRef.current[sym]+=sign;setM(p=>{const o=p[sym];return{...p,[sym]:{...o,price,buy:o.buy*.998+(sell?0:usd),sell:o.sell*.998+(sell?usd:0),cvd:cvdRef.current[sym]}}})}
   else{const bids=d.bids||d.b||[],asks=d.asks||d.a||[],bid=bids.reduce((a,x)=>a+(+x[0])*(+x[1]),0),ask=asks.reduce((a,x)=>a+(+x[0])*(+x[1]),0),bb=bids[0]?+bids[0][0]:0,aa=asks[0]?+asks[0][0]:0,mid=(bb+aa)/2||1;setM(p=>({...p,[sym]:{...p[sym],bid,ask,imb:(bid-ask)/(bid+ask||1),spread:aa&&bb?(aa-bb)/mid*10000:0}}))}
  };return()=>ws.close()
 },[]);

 useEffect(()=>{const id=setInterval(()=>{const now=Date.now(),cut=now-6*3600000;for(const sym of SYMS){const s=mRef.current[sym];if(!s.price)continue;histRef.current[sym]=[...histRef.current[sym].filter(x=>x.ts>=cut),{ts:now,price:s.price,imb:s.imb,cvd:cvdRef.current[sym],oi:s.oi}].slice(-1500)}localStorage.setItem(STORE,JSON.stringify(histRef.current));setFlows(p=>{const n={...p};for(const sym of SYMS){n[sym]={...n[sym]};for(const[w,mins]of Object.entries(WINDOWS)){const dep=depthAverage(histRef.current[sym],mins,mRef.current[sym].imb);n[sym][w]={...n[sym][w],...dep}}}return n})},15000);return()=>clearInterval(id)},[]);

 const sigs=useMemo(()=>Object.fromEntries(SYMS.map(s=>[s,classify(s,m[s],flows[s])])),[m,flows]);
 const s=m[sel],c=CFG[sel],sig=sigs[sel],fw=flows[sel]?.[win]||{},flow=s.buy+s.sell||1,buyPct=s.buy/flow*100,dist=s.price?(c.trigger-s.price)/s.price*100:null;
 return <main className="shell">
  <header><div><span className="eyebrow">PERSISTENT MULTI-TIMEFRAME ORDER FLOW</span><h1>BTC · ETH · SOL <em>Trigger Watch</em></h1><p>Price structure + taker flow + persistent depth + futures OI/funding. History survives browser refreshes.</p></div><div className="status-stack"><div className={'live '+(live?'ok':'bad')}>{live?<Wifi size={16}/>:<WifiOff size={16}/>} {live?'Binance live':'Reconnecting'}</div><div className="persist"><Database size={13}/> Local history {histRef.current[sel]?.length||0} pts</div></div></header>
  <section className="cards">{SYMS.map(sym=>{const x=m[sym],a=CFG[sym],g=sigs[sym],d=x.price?(a.trigger-x.price)/x.price*100:null;return <button key={sym} onClick={()=>setSel(sym)} className={'card '+(sel===sym?'selected':'')}><div className="head"><div><b>{a.t}</b><small>{a.name}</small></div><span className={'pill '+g.tone}>{g.label}</span></div><strong className="price">{money(x.price,a.d)}</strong><div className="row"><span>Trigger</span><b>{money(a.trigger,a.d)}</b></div><div className="row"><span>Distance</span><b>{d==null?'—':pc(d,2)}</b></div><div className="bar"><i style={{width:Math.max(0,Math.min(100,(x.imb+1)*50))+'%'}}/></div><div className="row tiny"><span>Live top-20 imbalance</span><b>{pc(x.imb*100,0)}</b></div></button>})}</section>
  <section className="windowbar"><span>FLOW WINDOW</span>{Object.keys(WINDOWS).map(w=><button key={w} onClick={()=>setWin(w)} className={win===w?'active':''}>{w}</button>)}</section>
  <section className="grid">
   <article className="panel hero"><div className="title"><div><span>{c.t} SIGNAL ENGINE · 1H TRIGGER / 4H STRUCTURE</span><h2>{sig.label}</h2></div><b className={'score '+sig.tone}>{Math.round(sig.score)}/10</b></div><div className="big">{money(s.price,c.d)}<small>Trigger {money(c.trigger,c.d)} · {dist==null?'—':Math.abs(dist).toFixed(2)+'% '+(dist>0?'below':'above')}</small></div><div className="reasons">{sig.reasons.map((r,i)=><div key={i}>● {r}</div>)}</div><div className="levels"><div><span>Last closed 1H</span><b>{money(s.c1?.c,c.d)}</b></div><div><span>Previous 1H low</span><b>{money(s.p1?.l,c.d)}</b></div><div><span>Last closed 4H</span><b>{money(s.c4?.c,c.d)}</b></div><div><span>Previous 4H low</span><b>{money(s.p4?.l,c.d)}</b></div></div></article>
   <article className="panel"><span className="eyebrow">{win} TAKER FLOW</span><div className={fw.deltaPct>=0?'metric green':'metric red'}>{pc(fw.deltaPct,2)}</div><div className="metrics"><div><span>Net delta</span><b className={fw.delta>=0?'green':'red'}>{compact(fw.delta)}</b></div><div><span>Interpretation</span><b>{fw.deltaPct>.5?'Buy aggression':fw.deltaPct<-.5?'Sell aggression':'Balanced'}</b></div></div><p className="note">Derived from Binance spot quote volume and taker-buy quote volume over the selected window.</p></article>
   <article className="panel"><span className="eyebrow">{win} PERSISTENT DEPTH</span><div className={(fw.imb??s.imb)>=0?'metric green':'metric red'}>{pc((fw.imb??s.imb)*100,1)}</div><div className="metrics"><div><span>Stored samples</span><b>{fw.samples||0}</b></div><div><span>Live spread</span><b>{s.spread.toFixed(2)} bps</b></div><div><span>Bid liquidity</span><b>{compact(s.bid)}</b></div><div><span>Ask liquidity</span><b>{compact(s.ask)}</b></div></div><p className="note">Depth history is sampled every 15 seconds and retained locally for six hours.</p></article>
   <article className="panel"><span className="eyebrow">{win} DERIVATIVES</span><div className="metric">{fw.oiPct==null?'—':pc(fw.oiPct,2)}</div><div className="metrics"><div><span>Open interest</span><b>{compact(s.oi)}</b></div><div><span>Funding</span><b>{s.funding==null?'—':(s.funding*100).toFixed(4)+'%'}</b></div></div><p className="note">OI history uses Binance Futures 5-minute history, aggregated to the selected window.</p></article>
   <article className="panel matrix"><span className="eyebrow">MULTI-TIMEFRAME FLOW MATRIX</span><div className="table"><div className="tr th"><span>Window</span><span>Taker Δ</span><span>OI Δ</span><span>Depth</span></div>{Object.keys(WINDOWS).map(w=>{const x=flows[sel]?.[w]||{};return <div className="tr" key={w}><b>{w}</b><span className={x.deltaPct>=0?'green':'red'}>{pc(x.deltaPct,1)}</span><span className={(x.oiPct??0)>=0?'green':'red'}>{x.oiPct==null?'—':pc(x.oiPct,1)}</span><span className={(x.imb??0)>=0?'green':'red'}>{x.imb==null?'—':pc(x.imb*100,0)}</span></div>})}</div></article>
   <article className="panel rules"><span className="eyebrow">CLASSIFICATION RULES</span><div className="rulesgrid"><div><b>CONFIRMED</b><p>Closed 1H above trigger, level holds, and at least two of taker flow, persistent depth, and OI agree.</p></div><div><b>WEAK</b><p>Price breaks but fewer than two flow confirmations agree.</p></div><div><b>FALSE-BREAKOUT RISK</b><p>Price breaks while at least two flow/derivatives signals contradict it.</p></div><div><b>BEARISH STRUCTURE</b><p>Closed 1H/4H lower structure plus bearish flow, depth, or deleveraging.</p></div></div></article>
  </section>
  <footer><span>{refreshed?'REST/OI refreshed '+new Date(refreshed).toLocaleTimeString():'Loading…'}</span><button onClick={refresh}><RefreshCw size={14}/> Refresh</button><span className="warning"><AlertTriangle size={13}/> Monitoring tool, not financial advice.</span></footer>
 </main>
}