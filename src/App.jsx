import React,{useEffect,useMemo,useState}from'react';
import{Wifi,WifiOff,RefreshCw,AlertTriangle}from'lucide-react';

const CFG={
 BTCUSDT:{t:'BTC',name:'Bitcoin',trigger:87500,d:0},
 ETHUSDT:{t:'ETH',name:'Ethereum',trigger:2800,d:2},
 SOLUSDT:{t:'SOL',name:'Solana',trigger:120,d:2}
};
const SYMS=Object.keys(CFG);
const blank=()=>({price:0,prev:0,buy:0,sell:0,bid:0,ask:0,imb:0,spread:0,k1:null,p1:null,k4:null,p4:null,oi:null,oi0:null,oiPct:null,funding:null});
const initial=Object.fromEntries(SYMS.map(s=>[s,blank()]));
const money=(v,d=0)=>Number.isFinite(v)?'$'+v.toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const compact=v=>Number.isFinite(v)?new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:2}).format(v):'—';
const pc=(v,d=1)=>Number.isFinite(v)?(v>=0?'+':'')+v.toFixed(d)+'%':'—';
async function json(u){const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw Error(r.status);return r.json()}
const candle=d=>({o:+d[1],h:+d[2],l:+d[3],c:+d[4],v:+d[5]});

function signal(sym,s){
 const c=CFG[sym];
 if(!s.price||!s.p1||!s.p4)return{label:'LOADING',tone:'neutral',score:0,reasons:['Waiting for live market data']};
 const breakout=s.p1.c>c.trigger;
 const deltaBull=s.buy>s.sell*1.08,deltaBear=s.sell>s.buy*1.08;
 const bookBull=s.imb>.08,bookBear=s.imb<-.08;
 const oiBull=s.oiPct!=null&&s.oiPct>.15,oiBear=s.oiPct!=null&&s.oiPct<-.15;
 const oneBear=s.k1&&s.k1.l<s.p1.l&&s.price<s.p1.c;
 const fourBear=s.price<s.p4.l;
 if(breakout){
  let score=4,reasons=['1H candle closed above '+money(c.trigger,c.d)];
  if(deltaBull){score+=2;reasons.push('Aggressive buy flow / rolling CVD positive')}
  if(bookBull){score+=2;reasons.push('Top-20 depth favors bids')}
  if(oiBull){score+=1;reasons.push('Open interest building')}
  if(s.price>=c.trigger){score+=1;reasons.push('Breakout level still holding')}
  if(deltaBear||bookBear)return{label:'FALSE-BREAKOUT RISK',tone:'warn',score,reasons:[...reasons,'Order flow contradicts the breakout']};
  return score>=7?{label:'CONFIRMED BREAKOUT',tone:'bull',score,reasons}:{label:'WEAK / UNCONFIRMED',tone:'warn',score,reasons:[...reasons,'Needs stronger order-flow confirmation']};
 }
 if((oneBear||fourBear)&&(deltaBear||bookBear||oiBear)){
  const r=[];
  if(oneBear)r.push('1H structure made a lower low');
  if(fourBear)r.push('Price is below prior 4H low');
  if(deltaBear)r.push('Aggressive sell flow dominates');
  if(bookBear)r.push('Top-20 depth favors asks');
  if(oiBear)r.push('Open interest falling / deleveraging');
  return{label:'BEARISH STRUCTURE',tone:'bear',score:Math.min(10,5+r.length),reasons:r};
 }
 if(s.price>c.trigger*.995)return{label:'AT TRIGGER',tone:'warn',score:3,reasons:['Testing breakout level',deltaBull?'Order flow supportive':'Order flow not decisive']};
 return{label:'WAIT',tone:'neutral',score:1,reasons:['No confirmed breakout or bearish structure change']};
}

export default function App(){
 const[m,setM]=useState(initial),[sel,setSel]=useState('BTCUSDT'),[live,setLive]=useState(false),[refreshed,setRefreshed]=useState(null);
 async function slow(){
  await Promise.all(SYMS.map(async sym=>{try{
   const[k1,k4,oi,f]=await Promise.all([
    json('https://api.binance.com/api/v3/klines?symbol='+sym+'&interval=1h&limit=4'),
    json('https://api.binance.com/api/v3/klines?symbol='+sym+'&interval=4h&limit=4'),
    json('https://fapi.binance.com/fapi/v1/openInterest?symbol='+sym),
    json('https://fapi.binance.com/fapi/v1/premiumIndex?symbol='+sym)
   ]);
   setM(p=>{const old=p[sym],now=+oi.openInterest,start=old.oi0??now;return{...p,[sym]:{...old,k1:candle(k1.at(-1)),p1:candle(k1.at(-2)),k4:candle(k4.at(-1)),p4:candle(k4.at(-2)),oi:now,oi0:start,oiPct:start?(now-start)/start*100:0,funding:+f.lastFundingRate}}})
  }catch(e){console.error(sym,e)}}));
  setRefreshed(Date.now())
 }
 useEffect(()=>{slow();const id=setInterval(slow,30000);return()=>clearInterval(id)},[]);
 useEffect(()=>{
  const streams=SYMS.flatMap(s=>{const x=s.toLowerCase();return[x+'@aggTrade',x+'@depth20@100ms']}).join('/');
  const ws=new WebSocket('wss://stream.binance.com:9443/stream?streams='+streams);
  ws.onopen=()=>setLive(true);ws.onclose=()=>setLive(false);ws.onerror=()=>setLive(false);
  ws.onmessage=e=>{const z=JSON.parse(e.data),st=z.stream||'',sym=SYMS.find(s=>st.startsWith(s.toLowerCase()));if(!sym)return;const d=z.data;
   if(st.includes('@aggTrade')){const price=+d.p,usd=price*(+d.q),sell=d.m===true;setM(p=>{const o=p[sym],buy=o.buy*.997+(sell?0:usd),sv=o.sell*.997+(sell?usd:0);return{...p,[sym]:{...o,prev:o.price||price,price,buy,sell:sv}}})}
   else{const bids=d.bids||d.b||[],asks=d.asks||d.a||[],bid=bids.reduce((a,x)=>a+(+x[0])*(+x[1]),0),ask=asks.reduce((a,x)=>a+(+x[0])*(+x[1]),0),bb=bids[0]?+bids[0][0]:0,aa=asks[0]?+asks[0][0]:0,mid=(bb+aa)/2||1;setM(p=>({...p,[sym]:{...p[sym],bid,ask,imb:(bid-ask)/(bid+ask||1),spread:aa&&bb?(aa-bb)/mid*10000:0}}))}
  };
  return()=>ws.close()
 },[]);
 const sigs=useMemo(()=>Object.fromEntries(SYMS.map(s=>[s,signal(s,m[s])])),[m]);
 const s=m[sel],c=CFG[sel],sig=sigs[sel],flow=s.buy+s.sell||1,buyPct=s.buy/flow*100,dist=s.price?(c.trigger-s.price)/s.price*100:null;
 return <main className="shell">
  <header><div><span className="eyebrow">LIVE ORDER FLOW MONITOR</span><h1>BTC · ETH · SOL <em>Trigger Watch</em></h1><p>1H breakout confirmation + order flow + 1H/4H bearish structure checks.</p></div><div className={'live '+(live?'ok':'bad')}>{live?<Wifi size={16}/>:<WifiOff size={16}/>} {live?'Binance live':'Reconnecting'}</div></header>
  <section className="cards">{SYMS.map(sym=>{const x=m[sym],a=CFG[sym],g=sigs[sym],d=x.price?(a.trigger-x.price)/x.price*100:null;return <button key={sym} onClick={()=>setSel(sym)} className={'card '+(sel===sym?'selected':'')}><div className="head"><div><b>{a.t}</b><small>{a.name}</small></div><span className={'pill '+g.tone}>{g.label}</span></div><strong className="price">{money(x.price,a.d)}</strong><div className="row"><span>Trigger</span><b>{money(a.trigger,a.d)}</b></div><div className="row"><span>Distance</span><b>{d==null?'—':pc(d,2)}</b></div><div className="bar"><i style={{width:Math.max(0,Math.min(100,(x.imb+1)*50))+'%'}}/></div><div className="row tiny"><span>Top-20 bid/ask imbalance</span><b>{pc(x.imb*100,0)}</b></div></button>})}</section>
  <section className="grid">
   <article className="panel hero"><div className="title"><div><span>{c.t} SIGNAL ENGINE</span><h2>{sig.label}</h2></div><b className={'score '+sig.tone}>{Math.round(sig.score)}/10</b></div><div className="big">{money(s.price,c.d)}<small>Trigger {money(c.trigger,c.d)} · {dist==null?'—':Math.abs(dist).toFixed(2)+'% '+(dist>0?'below':'above')}</small></div><div className="reasons">{sig.reasons.map((r,i)=><div key={i}>● {r}</div>)}</div><div className="levels"><div><span>Closed 1H</span><b>{money(s.p1?.c,c.d)}</b></div><div><span>Prior 1H low</span><b>{money(s.p1?.l,c.d)}</b></div><div><span>Prior 4H low</span><b>{money(s.p4?.l,c.d)}</b></div><div><span>Current 4H high</span><b>{money(s.k4?.h,c.d)}</b></div></div></article>
   <article className="panel"><span className="eyebrow">AGGRESSIVE FLOW / CVD</span><div className={(s.buy-s.sell)>=0?'metric green':'metric red'}>{(s.buy-s.sell)>=0?'+':''}{compact(s.buy-s.sell)}</div><div className="split"><i style={{width:buyPct+'%'}}/><b style={{width:(100-buyPct)+'%'}}/></div><div className="metrics"><div><span>Buys</span><b className="green">{compact(s.buy)}</b></div><div><span>Sells</span><b className="red">{compact(s.sell)}</b></div></div></article>
   <article className="panel"><span className="eyebrow">ORDER BOOK DEPTH</span><div className={s.imb>=0?'metric green':'metric red'}>{pc(s.imb*100)}</div><div className="metrics"><div><span>Bid liquidity</span><b>{compact(s.bid)}</b></div><div><span>Ask liquidity</span><b>{compact(s.ask)}</b></div><div><span>Spread</span><b>{s.spread.toFixed(2)} bps</b></div><div><span>Reading</span><b>{s.imb>.08?'Bid-heavy':s.imb<-.08?'Ask-heavy':'Balanced'}</b></div></div></article>
   <article className="panel"><span className="eyebrow">DERIVATIVES</span><div className="metric">{compact(s.oi)}</div><div className="metrics"><div><span>OI since load</span><b>{pc(s.oiPct)}</b></div><div><span>Funding</span><b>{s.funding==null?'—':(s.funding*100).toFixed(4)+'%'}</b></div></div><p className="note">OI change is session-relative. OI and funding use live Binance Futures data.</p></article>
   <article className="panel rules"><span className="eyebrow">CLASSIFICATION RULES</span><div className="rulesgrid"><div><b>CONFIRMED</b><p>1H close above trigger with supportive CVD/depth and level holding.</p></div><div><b>WEAK</b><p>Price breaks but flow confirmation is insufficient.</p></div><div><b>FALSE-BREAKOUT RISK</b><p>Price breaks while CVD or depth contradicts the move.</p></div><div><b>BEARISH STRUCTURE</b><p>1H/4H support damage plus sell flow, ask pressure or deleveraging.</p></div></div></article>
  </section>
  <footer><span>{refreshed?'Candle/OI refreshed '+new Date(refreshed).toLocaleTimeString():'Loading…'}</span><button onClick={slow}><RefreshCw size={14}/> Refresh</button><span className="warning"><AlertTriangle size={13}/> Monitoring tool, not financial advice.</span></footer>
 </main>
}