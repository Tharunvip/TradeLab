const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const canvas=$('#chart-canvas'), chartWrap=$('#chart-wrap'), ctx=canvas.getContext('2d');

let tool='pointer', color='#1976b9', color2='#f0ae2c', opacity=.8, zoom=1;
let dragging=false, drawStart=null, drawingPoints=null, tempPath=null;
let panX=0, panY=0, grid=true, showCrosshair=false;
let drawings=[], selectedId=null, undoStack=[], redoStack=[], pasteBuffer=[];
let chartType='candle', activeIndicators={ema20:true, vwap:true, rsi:false, macd:false, bolinger:false};
let liveTimer=null, priceMarkerPos=0, cursorInChart=false;
const chartTabs=[{symbol:'NIFTY 50',name:'NIFTY50.chart',active:true},{symbol:'BANK NIFTY',name:'BANKNIFTY.chart',active:false},{symbol:'BTC/USD',name:'BTCUSD.chart',active:false}];
const files={Stocks:['NIFTY50.chart','BANKNIFTY.chart','RELIANCE.chart'],Crypto:['BTCUSD.chart','ETHUSD.chart'],Forex:['EURUSD.chart'],Strategies:['Breakout.strategy','SupportResistance.strategy'],'Saved Analysis':['Setup-01.chart','Setup-02.chart']};
const symbols=[{n:'NIFTY 50',m:'NSE · INDEX',b:24810},{n:'BANK NIFTY',m:'NSE · INDEX',b:51400},{n:'RELIANCE',m:'NSE',b:1420},{n:'TCS',m:'NSE',b:3880},{n:'INFY',m:'NSE',b:1850},{n:'BTC/USD',m:'CRYPTO',b:63400},{n:'ETH/USD',m:'CRYPTO',b:3150},{n:'EUR/USD',m:'FOREX',b:1.087},{n:'GOLD',m:'COMEX',b:2338}];
const watchPrices={};
symbols.forEach(s=>{watchPrices[s.n]={price:s.b+(Math.random()-.3)*s.b*.02,prev:s.b};const d=watchPrices[s.n];d.change=d.price-d.prev;d.pct=(d.change/d.prev)*100;});
const paletteColors=['#000000','#434343','#666666','#999999','#b7b7b7','#cccccc','#d9d9d9','#ffffff','#980000','#ff0000','#ff9900','#ffff00','#00ff00','#00ffff','#4a86e8','#0000ff','#9900ff','#ff00ff','#e6b8af','#f4cccc','#fce5cd','#fff2cc','#d9ead3','#d0e0e3','#c9daf8','#cfe2f3','#d9d2e9','#ead1dc','#dd7e6b','#ea9999','#f9cb9c','#ffe599','#b6d7a8','#a2c4c9','#a4c2f4','#9fc5e8','#b4a7d6','#d5a6bd','#cc4125','#e06666','#f6b26b','#ffd966','#93c47d','#76a5af','#6d9eeb','#6fa8dc','#8e7cc3','#c27ba0'];
let candles=[];
let currentSymbol='NIFTY 50', currentTimeframe='5m', currentFile='NIFTY50.chart';

function icons(){if(window.lucide)lucide.createIcons()}
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1800)}
function uid(){return'D'+Math.random().toString(36).slice(2,9)}

function buildPalette(){
  const p=$('#palette');p.innerHTML='';
  paletteColors.forEach(c=>{
    const b=document.createElement('button');b.style.background=c;b.title=c;
    b.addEventListener('click',e=>{e.shiftKey?(color2=c,$('#color-two').style.background=c):(color=c,$('#color-one').style.background=c);selectedId=null;updateProperties();});
    b.addEventListener('contextmenu',e=>{e.preventDefault();color2=c;$('#color-two').style.background=c;});
    p.append(b);
  });
  $('#color-one').style.background=color;$('#color-two').style.background=color2;
  $('#color-one').addEventListener('click',()=>{tempColor=color;swapColor()});
  $('#color-two').addEventListener('click',()=>{tempColor=color;color=color2;color2=tempColor;$('#color-one').style.background=color;$('#color-two').style.background=color2;});
}
let tempColor;
function swapColor(){tempColor=color;color=color2;color2=tempColor;$('#color-one').style.background=color;$('#color-two').style.background=color2;}

function setTool(next){
  tool=next;
  $$('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===next));
  const tName=next.replaceAll('-',' ').replace(/\b\w/g,c=>c.toUpperCase());
  $('#status-tool').textContent=tName;
  chartWrap.classList.toggle('crosshair-mode',next==='crosshair'||next==='pointer');
  if(!['pan','zoom','pointer','crosshair'].includes(next))selectedId=null,updateProperties();
  if(next==='pan'){canvas.style.cursor='grab'}else if(next==='zoom'){canvas.style.cursor='zoom-in'}else if(next==='eraser'){canvas.style.cursor='cell'}else if(next==='text'){canvas.style.cursor='text'}else if(['pointer','crosshair'].includes(next)){canvas.style.cursor='crosshair'}else{canvas.style.cursor='crosshair'}
  toast(`${tName} tool selected`);
}

function makeTree(){
  const tree=$('#file-tree');tree.innerHTML='';
  Object.entries(files).forEach(([folder,names])=>{
    const row=document.createElement('div');row.className='tree-folder';
    row.innerHTML='<i data-lucide="chevron-down"></i><i data-lucide="folder"></i>'+folder;
    let open=true;
    row.addEventListener('click',()=>{open=!open;row.querySelectorAll('.tree-file,.tree-folder').forEach(()=>{});const kids=[...tree.children].filter(c=>c.dataset.parent===folder);kids.forEach(k=>k.style.display=open?'flex':'none');row.querySelector('[data-lucide="chevron-down"]').style.transform=open?'rotate(0)':'rotate(-90deg)'});
    tree.append(row);
    names.forEach(name=>{
      const file=document.createElement('button');file.className='tree-file';file.dataset.parent=folder;
      file.innerHTML='<i data-lucide="'+(name.endsWith('.strategy')?'layout-list':'file-chart-column')+'"></i>'+name;
      file.addEventListener('click',e=>{e.stopPropagation();$$('.tree-file').forEach(x=>x.classList.remove('selected'));file.classList.add('selected');openSymbol(name);});
      file.addEventListener('contextmenu',e=>{e.preventDefault();if(confirm('Delete '+name+'?')){files[folder]=files[folder].filter(n=>n!==name);makeTree();toast(name+' deleted');}});
      tree.append(file);
    });
  });
  icons();
}

function openSymbol(name){
  const symbol=name.replace(/\.chart|\.strategy/,'').replace('NIFTY50','NIFTY 50').replace('BANKNIFTY','BANK NIFTY').replace('BTCUSD','BTC/USD').replace('ETHUSD','ETH/USD').replace('EURUSD','EUR/USD');
  currentSymbol=symbol;currentFile=name;
  $('#title-file').textContent=name;
  $('#symbol-name').textContent=symbol;
  $('#status-symbol').textContent=symbol;
  const meta=symbols.find(s=>s.n===symbol);if(meta){$('#market-name').textContent=meta.m;generateData(meta.b);}
  $('.symbol-icon').textContent=symbol.charAt(0);
  toast(`Opened ${name}`);
  saveStateNow();
  drawChart();
}

function sizeCanvas(){
  const r=chartWrap.getBoundingClientRect(),d=devicePixelRatio||1;
  canvas.width=r.width*d;canvas.height=r.height*d;
  canvas.style.width=r.width+'px';canvas.style.height=r.height+'px';
  ctx.setTransform(d,0,0,d,0,0);
  drawChart();
}

function generateData(basePrice){
  let price=basePrice||24810;candles=[];
  const n={'1m':120,'3m':96,'5m':72,'15m':60,'30m':48,'1H':36,'2H':30,'4H':24,'1D':30,'1W':26,'1M':24}[currentTimeframe]||72;
  const vol={'1m':.4,'3m':.6,'5m':.85,'15m':1.1,'30m':1.4,'1H':1.8,'2H':2.3,'4H':3,'1D':6,'1W':14,'1M':30}[currentTimeframe]||.85;
  for(let i=0;i<n;i++){
    const wave=Math.sin(i/5)*basePrice*.002+(Math.random()-.43)*basePrice*(vol*.004);
    const o=price+wave,h=o+Math.random()*basePrice*(vol*.0025)+basePrice*.0003,l=o-Math.random()*basePrice*(vol*.0023)-basePrice*.0003,c=l+Math.random()*(h-l);
    candles.push({o,h,l,c,v:Math.round(450+Math.random()*850)});
    price=c;
  }
  updateOHLC();
}

function updateOHLC(){
  if(!candles.length)return;
  const c=candles[candles.length-1],p=candles[candles.length-2]||c;
  const ch=c.c-p.o,pct=(ch/p.o)*100;
  const s=`O ${fmt(c.o)}   H ${fmt(c.h)}   L ${fmt(c.l)}   C ${fmt(c.c)}   ${ch>=0?'+':''}${fmt(ch)} (${pct>=0?'+':''}${pct.toFixed(2)}%)`;
  $('#ohlc').textContent=s;$('#status-ohlc').textContent=s.split('   ').slice(0,4).join('   ');
  const pm=$('#price-marker');pm.textContent=fmt(c.c);
  pm.style.background=ch>=0?'var(--green)':'var(--red)';
}
function fmt(v){return v<10?v.toFixed(4):v.toLocaleString(undefined,{maximumFractionDigits:2,minimumFractionDigits:2})}

function computeEMA(data,period){
  const k=2/(period+1),res=[];let ema=data[0];
  data.forEach(v=>{ema=v*k+ema*(1-k);res.push(ema);});
  return res;
}

function computeVWAP(candles){
  let cumPV=0,cumVol=0,res=[];
  candles.forEach(c=>{const tp=(c.h+c.l+c.c)/3;cumPV+=tp*c.v;cumVol+=c.v;res.push(cumVol?cumPV/cumVol:tp);});
  return res;
}

function computeBB(data,period=20,mult=2){
  const mid=[],upper=[],lower=[];
  for(let i=0;i<data.length;i++){
    const slice=data.slice(Math.max(0,i-period+1),i+1);
    const m=slice.reduce((a,b)=>a+b,0)/slice.length;
    const sd=Math.sqrt(slice.reduce((a,b)=>a+(b-m)**2,0)/slice.length);
    mid.push(m);upper.push(m+mult*sd);lower.push(m-mult*sd);
  }
  return{mid,upper,lower};
}

function computeRSI(candles,period=14){
  const changes=candles.slice(1).map((c,i)=>c.c-candles[i].c);
  const rsi=[50];let gain=0,loss=0;
  for(let i=0;i<changes.length;i++){
    const g=Math.max(0,changes[i]),l=Math.max(0,-changes[i]);
    if(i<period){gain+=g;loss+=l;if(i===period-1){gain/=period;loss/=period;rsi.push(loss===0?100:100-100/(1+gain/loss));}}
    else{gain=(gain*(period-1)+g)/period;loss=(loss*(period-1)+l)/period;rsi.push(loss===0?100:100-100/(1+gain/loss));}
  }
  while(rsi.length<candles.length)rsi.unshift(50);
  return rsi;
}

function drawChart(){
  const w=chartWrap.clientWidth,h=chartWrap.clientHeight;
  if(!w||!h)return;
  const dark=document.body.classList.contains('dark');
  const bg=getCSS('--canvas')||'#fff',line=getCSS('--grid')||'#e3e8ed',muted=getCSS('--muted')||'#777',textC=getCSS('--text')||'#333';
  ctx.clearRect(0,0,w,h);ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
  const left=10,top=24,right=58,bottom=38,chartW=w-left-right,chartH=h-top-bottom,volH=48;
  if(!candles.length)return;
  const values=candles.flatMap(c=>[c.h,c.l]);
  let max=Math.max(...values)+15,min=Math.min(...values)-15;
  if(activeIndicators.bolinger){const bb=computeBB(candles.map(c=>c.c));max=Math.max(max,...bb.upper);min=Math.min(min,...bb.lower);}
  const py=v=>top+(max-v)/(max-min)*(chartH-volH);
  const step=chartW/candles.length,body=Math.max(3,step*.55);
  ctx.save();ctx.translate(panX,panY);ctx.scale(zoom,zoom);ctx.translate(-panX/zoom,-panY/zoom);

  ctx.strokeStyle=line;ctx.lineWidth=1;
  if(grid){
    for(let i=0;i<=8;i++){const y=top+i*(chartH/8);ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();}
    for(let i=0;i<=12;i++){const x=left+i*(chartW/12);ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,top+chartH);ctx.stroke();}
  }
  ctx.strokeStyle=muted;ctx.beginPath();ctx.moveTo(w-right,top);ctx.lineTo(w-right,top+chartH);ctx.moveTo(left,top+chartH);ctx.lineTo(w-right,top+chartH);ctx.stroke();

  const closes=candles.map(c=>c.c);
  if(activeIndicators.ema20){
    const ema=computeEMA(closes,20);drawLinePlot(ema,left,step,py,dark?'#77b8df':'#e59b2c',1.7);
  }
  if(activeIndicators.vwap){
    const vw=computeVWAP(candles);drawLinePlot(vw,left,step,py,dark?'#c58ae0':'#b26bd1',1.5);
  }
  if(activeIndicators.bolinger){
    const bb=computeBB(closes);
    ctx.globalAlpha=.15;ctx.fillStyle=dark?'#4daaf7':'#1976b9';
    ctx.beginPath();for(let i=0;i<candles.length;i++){const x=left+i*step+step/2;y=py(bb.upper[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}
    for(let i=candles.length-1;i>=0;i--){const x=left+i*step+step/2;y=py(bb.lower[i]);ctx.lineTo(x,y);}
    ctx.closePath();ctx.fill();ctx.globalAlpha=1;
    drawLinePlot(bb.upper,left,step,py,dark?'#4daaf7':'#1976b9',1);
    drawLinePlot(bb.mid,left,step,py,dark?'#a9d2f5':'#6da8d8',1);
    drawLinePlot(bb.lower,left,step,py,dark?'#4daaf7':'#1976b9',1);
  }

  if(chartType==='candle'){
    candles.forEach((c,i)=>{
      const x=left+i*step+step/2,up=c.c>=c.o,col=up?'#1b9a62':'#d24d4a';
      ctx.strokeStyle=col;ctx.fillStyle=col;
      ctx.beginPath();ctx.moveTo(x,py(c.h));ctx.lineTo(x,py(c.l));ctx.stroke();
      const y=Math.min(py(c.o),py(c.c)),bh=Math.max(2,Math.abs(py(c.o)-py(c.c)));
      ctx.fillRect(x-body/2,y,body,bh);
    });
  }else if(chartType==='line'){
    drawLinePlot(closes,left,step,py,dark?'#77b8df':'#317ca5',1.8);
  }else if(chartType==='bar'){
    candles.forEach((c,i)=>{
      const x=left+i*step+step/2,up=c.c>=c.o,col=up?'#1b9a62':'#d24d4a';
      ctx.strokeStyle=col;ctx.lineWidth=1.2;
      ctx.beginPath();ctx.moveTo(x,py(c.h));ctx.lineTo(x,py(c.l));ctx.stroke();
      ctx.beginPath();ctx.moveTo(x-3,py(c.o));ctx.lineTo(x,py(c.o));ctx.stroke();
      ctx.beginPath();ctx.moveTo(x,py(c.c));ctx.lineTo(x+3,py(c.c));ctx.stroke();
    });
  }else if(chartType==='area'){
    ctx.globalAlpha=.25;ctx.fillStyle=dark?'#4daaf7':'#317ca5';
    ctx.beginPath();
    for(let i=0;i<closes.length;i++){const x=left+i*step+step/2,y=py(closes[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}
    ctx.lineTo(left+(closes.length-1)*step+step/2,top+chartH-volH);ctx.lineTo(left+step/2,top+chartH-volH);ctx.closePath();ctx.fill();
    ctx.globalAlpha=1;drawLinePlot(closes,left,step,py,dark?'#77b8df':'#317ca5',1.8);
  }

  candles.forEach((c,i)=>{
    const x=left+i*step+step/2;
    ctx.globalAlpha=.32;ctx.fillStyle='#3a6ea5';
    ctx.fillRect(x-body/2,top+chartH-volH+(volH-4)*(1-c.v/1400),body,(volH-4)*c.v/1400);
    ctx.globalAlpha=1;
  });

  if(activeIndicators.rsi){
    const rsi=computeRSI(candles);
    ctx.save();ctx.globalAlpha=.9;
    const rsiTop=top+chartH-volH-20,rsiBot=top+chartH-volH-2,rsiH=rsiBot-rsiTop;
    ctx.fillStyle=dark?'#1a2430':'#eef3f8';ctx.fillRect(left,rsiTop,chartW,rsiH);
    ctx.strokeStyle=muted;ctx.lineWidth=.5;
    [30,50,70].forEach(l=>{const y=rsiTop+(1-l/100)*rsiH;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();});
    ctx.strokeStyle='#8e44ad';ctx.lineWidth=1.2;
    ctx.beginPath();rsi.forEach((r,i)=>{const x=left+i*step+step/2,y=rsiTop+(1-r/100)*rsiH;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});ctx.stroke();
    ctx.fillStyle=muted;ctx.font='9px Consolas';ctx.fillText('RSI14',left+2,rsiTop+9);
    ctx.restore();
  }

  drawings.forEach(d=>{if(d.visible!==false)drawObject(d);});
  if(selectedId){const d=drawings.find(x=>x.id===selectedId);if(d)drawSelectionHandles(d);}

  ctx.restore();

  ctx.fillStyle=muted;ctx.font='10px Consolas,monospace';
  for(let i=0;i<6;i++){const val=min+(max-min)*(i/5);ctx.fillText(fmt(val),w-right+7,py(val)+3);}
  const times=makeTimeLabels(candles.length);
  times.forEach((t,i)=>{const x=left+i*chartW/Math.max(times.length-1,1);ctx.fillText(t,x-14,h-12);});
  ctx.fillText('VOLUME',left,top+chartH+17);
  const lastC=candles[candles.length-1];
  const up=lastC.c>=lastC.o;
  ctx.fillStyle=up?'#16834b':'#c33a32';ctx.fillRect(w-right+1,py(lastC.c)-1,58,2);
  ctx.fillStyle=bg;ctx.fillRect(w-right+2,py(lastC.c)-8,56,16);
  ctx.fillStyle=up?'#16834b':'#c33a32';ctx.fillText(fmt(lastC.c),w-right+4,py(lastC.c)+4);
}
function getCSS(v){return getComputedStyle(document.body).getPropertyValue(v).trim()}
function drawLinePlot(arr,left,step,py,color,w){
  ctx.strokeStyle=color;ctx.lineWidth=w;ctx.beginPath();
  arr.forEach((v,i)=>{const x=left+i*step+step/2,y=py(v);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
  ctx.stroke();
}
function makeTimeLabels(n){
  const base=['9:30','10:00','11:00','12:00','13:00','14:00','15:00','15:30','16:00'];
  if(n<=7)return base.slice(0,n+1);
  const out=[];const step=Math.ceil(n/7);
  for(let i=0;i<=7;i++)out.push(base[i]||'');
  return out;
}

function point(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}

function drawObject(d){
  ctx.save();ctx.globalAlpha=d.opacity!=null?d.opacity:opacity;
  ctx.strokeStyle=d.color||color;ctx.fillStyle=d.color||color;ctx.lineWidth=d.lineWidth||(d.tool==='marker'?12:2);
  if(d.tool==='eraser'){ctx.strokeStyle=getCSS('--canvas');ctx.lineWidth=d.lineWidth||14;ctx.globalCompositeOperation='destination-out';}
  const a=d.a,b=d.b,w=b.x-a.x,h=b.y-a.y;
  switch(d.tool){
    case'horizontal':ctx.beginPath();ctx.moveTo(0,a.y);ctx.lineTo(chartWrap.clientWidth,a.y);ctx.stroke();break;
    case'vertical':ctx.beginPath();ctx.moveTo(a.x,0);ctx.lineTo(a.x,chartWrap.clientHeight);ctx.stroke();break;
    case'trend':case'ray':ctx.beginPath();ctx.moveTo(a.x,a.y);if(d.tool==='ray'){const dx=b.x-a.x||1,dy=b.y-a.y,len=Math.sqrt(dx*dx+dy*dy)||1,sx=dx/len,sy=dy/len,ex=b.x+sx*4000,ey=b.y+sy*4000;ctx.lineTo(ex,ey);}else{ctx.lineTo(b.x,b.y);}ctx.stroke();break;
    case'arrow':ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();const ang=Math.atan2(b.y-a.y,b.x-a.x),al=12;
      ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-al*Math.cos(ang-.4),b.y-al*Math.sin(ang-.4));ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-al*Math.cos(ang+.4),b.y-al*Math.sin(ang+.4));ctx.stroke();break;
    case'rectangle':ctx.strokeRect(a.x,a.y,w,h);break;
    case'buy-zone':case'long':ctx.fillStyle='#1b9a6255';ctx.fillRect(a.x,a.y,w,h);ctx.strokeRect(a.x,a.y,w,h);
      if(d.tool==='long'){ctx.globalAlpha=1;ctx.fillStyle=getCSS('--text');ctx.font='bold 11px Segoe UI';ctx.fillText('LONG  R:R 1:2.5',a.x+6,a.y+16);}break;
    case'sell-zone':case'short':ctx.fillStyle='#d24d4a55';ctx.fillRect(a.x,a.y,w,h);ctx.strokeRect(a.x,a.y,w,h);
      if(d.tool==='short'){ctx.globalAlpha=1;ctx.fillStyle=getCSS('--text');ctx.font='bold 11px Segoe UI';ctx.fillText('SHORT  R:R 1:2.5',a.x+6,a.y+16);}break;
    case'circle':ctx.beginPath();ctx.ellipse(a.x+w/2,a.y+h/2,Math.abs(w/2),Math.abs(h/2),0,0,Math.PI*2);ctx.stroke();break;
    case'triangle':ctx.beginPath();ctx.moveTo(a.x+w/2,a.y);ctx.lineTo(a.x+w,a.y+h);ctx.lineTo(a.x,a.y+h);ctx.closePath();ctx.stroke();break;
    case'polygon':case'pitchfork':case'channel':
      if(d.points&&d.points.length>=2){ctx.beginPath();d.points.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));if(d.tool==='pitchfork'||d.tool==='polygon')ctx.closePath();ctx.stroke();}break;
    case'pencil':case'brush':case'marker':case'eraser':
      if(d.points&&d.points.length>1){ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();d.points.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));ctx.stroke();}break;
    case'fib-retrace':case'fib-extension':
      drawFib(d);break;
    case'fib-fan':
      drawFibFan(d);break;
    case'text':
      ctx.globalAlpha=d.opacity!=null?d.opacity:opacity;ctx.fillStyle=d.color||color;
      ctx.font=(d.fontSize||14)+'px Segoe UI,sans-serif';ctx.fillText(d.text||'Text',a.x,a.y);break;
  }
  ctx.globalCompositeOperation='source-over';
  ctx.restore();
}

function drawFib(d){
  const levels=d.tool==='fib-retrace'?[0,.236,.382,.5,.618,.786,1,1.272,1.618]:[0,.236,.382,.5,.618,.786,1,1.272,1.618,2,2.618,4.236];
  const labels=d.tool==='fib-retrace'?['0','.236','.382','.500','.618','.786','1','1.272','1.618']:['0','.236','.382','.500','.618','.786','1','1.272','1.618','2.000','2.618','4.236'];
  const a=d.a,b=d.b,total=b.y-a.y;
  const dark=document.body.classList.contains('dark');
  levels.forEach((lv,i)=>{
    const y=a.y+total*lv;
    ctx.strokeStyle=(i%2===0)?(dark?'#6db1e6':'#2a6fa8'):(dark?'#9d7bbd':'#7e57c2');
    ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(a.x,y);ctx.lineTo(b.x,y);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle=ctx.strokeStyle;ctx.font='9px Consolas';ctx.fillText(labels[i],b.x+4,y+3);
  });
  ctx.strokeStyle=d.color||color;ctx.lineWidth=2;ctx.setLineDash([]);
  ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(a.x,b.y);ctx.stroke();
}
function drawFibFan(d){
  const a=d.a,b=d.b;const dx=b.x-a.x,dy=b.y-a.y;
  const ratios=[.382,.5,.618];const dark=document.body.classList.contains('dark');
  ratios.forEach((r,i)=>{
    ctx.strokeStyle=dark?'#6db1e6':'#2a6fa8';ctx.lineWidth=1.2;
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(a.x+dx*(1+r),a.y+dy*(1+r));ctx.stroke();
  });
  ctx.strokeStyle=d.color||color;ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
}

function drawSelectionHandles(d){
  ctx.save();ctx.strokeStyle=getCSS('--blue');ctx.lineWidth=1;ctx.setLineDash([3,3]);
  const pts=getObjectPoints(d);
  ctx.fillStyle=getCSS('--blue');
  pts.forEach(p=>{ctx.strokeRect(p.x-5,p.y-5,10,10);ctx.fillRect(p.x-3,p.y-3,6,6);});
  const bb=getObjectBounds(d);
  ctx.strokeRect(bb.x,bb.y,bb.w,bb.h);
  ctx.restore();
}
function getObjectPoints(d){
  if(d.points)return d.points.slice();
  if(d.tool==='horizontal')return[{x:100,y:d.a.y},{x:chartWrap.clientWidth-100,y:d.a.y}];
  if(d.tool==='vertical')return[{x:d.a.x,y:100},{x:d.a.x,y:chartWrap.clientHeight-100}];
  return[d.a,d.b];
}
function getObjectBounds(d){
  const pts=getObjectPoints(d);
  const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
  return{x:Math.min(...xs)-3,y:Math.min(...ys)-3,w:Math.max(...xs)-Math.min(...xs)+6,h:Math.max(...ys)-Math.min(...ys)+6};
}

function hitTest(p){
  for(let i=drawings.length-1;i>=0;i--){
    const d=drawings[i];if(d.visible===false)continue;
    const bb=getObjectBounds(d);
    if(p.x>=bb.x-6&&p.x<=bb.x+bb.w+6&&p.y>=bb.y-6&&p.y<=bb.y+bb.h+6)return d;
  }
  return null;
}

function pushUndo(){undoStack.push(JSON.stringify(drawings));redoStack=[];if(undoStack.length>50)undoStack.shift();}
function doUndo(){if(!undoStack.length)return toast('Nothing to undo');redoStack.push(JSON.stringify(drawings));drawings=JSON.parse(undoStack.pop());selectedId=null;updateLayers();updateProperties();drawChart();toast('Undo');}
function doRedo(){if(!redoStack.length)return toast('Nothing to redo');undoStack.push(JSON.stringify(drawings));drawings=JSON.parse(redoStack.pop());selectedId=null;updateLayers();updateProperties();drawChart();toast('Redo');}

function addDrawing(d){pushUndo();drawings.push(d);selectedId=d.id;updateLayers();updateProperties();}

function updateLayers(){
  const lt=$('#layers .layer-tree');
  lt.innerHTML='<b data-group="drawings" data-open="1">⌄ Drawings <i style="float:right;cursor:pointer" title="Clear all" id="clear-all-drawings">🗑</i></b>';
  [...drawings].reverse().forEach(d=>{
    const el=document.createElement('span');el.style.paddingLeft='25px';el.style.color=d.id===selectedId?getCSS('--blue'):'var(--muted)';
    el.style.borderTop='1px solid var(--line2)';el.style.cursor='pointer';el.dataset.id=d.id;
    el.innerHTML=(d.visible===false?'◎':'◉')+' '+labelOf(d)+' <i data-vis style="float:right;cursor:pointer;font-style:normal" title="Toggle visibility">'+(d.visible===false?'◌':'◉')+'</i><i data-del style="float:right;cursor:pointer;padding:0 6px" title="Delete">✕</i>';
    el.addEventListener('click',e=>{if(e.target.dataset.vis){d.visible=d.visible===false;updateLayers();drawChart();}else if(e.target.dataset.del){deleteDrawing(d.id);}else{selectedId=d.id;updateProperties();updateLayers();drawChart();}});
    lt.append(el);
  });
  lt.innerHTML+='<b style="margin-top:8px" data-group="indicators" data-open="1">⌄ Indicators</b>';
  const inds=[['ema20','EMA 20'],['vwap','VWAP'],['rsi','RSI 14'],['bolinger','Bollinger Bands']];
  inds.forEach(([k,n])=>{
    const el=document.createElement('span');el.style.paddingLeft='25px';el.style.color='var(--muted)';el.style.borderTop='1px solid var(--line2)';el.style.cursor='pointer';
    el.innerHTML='▥ '+n+' <i style="float:right;cursor:pointer;font-style:normal" data-ind="'+k+'">'+(activeIndicators[k]?'◉':'◌')+'</i>';
    el.addEventListener('click',e=>{activeIndicators[k]=!activeIndicators[k];updateLayers();drawChart();toast(n+' '+(activeIndicators[k]?'enabled':'disabled'));});
    lt.append(el);
  });
  $('#clear-all-drawings')?.addEventListener('click',e=>{e.stopPropagation();if(drawings.length&&confirm('Clear all drawings?')){pushUndo();drawings=[];selectedId=null;updateLayers();updateProperties();drawChart();toast('All drawings cleared');}});
}
function labelOf(d){
  const m={pencil:'Pencil Stroke',brush:'Brush Stroke',marker:'Highlight',eraser:'Erased',trend:'Trend Line',horizontal:'Horizontal Line',vertical:'Vertical Line',ray:'Ray Line',channel:'Channel',arrow:'Arrow',rectangle:'Rectangle',circle:'Circle',triangle:'Triangle',polygon:'Polygon',pitchfork:'Pitchfork','fib-retrace':'Fib Retracement','fib-extension':'Fib Extension','fib-fan':'Fib Fan',text:'Text: '+(d.text||''),'buy-zone':'Buy Zone','sell-zone':'Sell Zone',long:'Long Position',short:'Short Position'};
  return m[d.tool]||d.tool;
}

function deleteDrawing(id){
  pushUndo();drawings=drawings.filter(d=>d.id!==id);
  if(selectedId===id)selectedId=null;
  updateLayers();updateProperties();drawChart();toast('Drawing deleted');
}

function updateProperties(){
  const p=$('#properties .panel-section-title').parentElement;
  const props=$('#properties .empty-properties');
  props.style.display='none';
  let html='<div class="panel-section-title">OBJECT PROPERTIES</div>';
  if(!selectedId){
    html='<div class="panel-section-title">OBJECT PROPERTIES</div><div class="empty-properties"><i data-lucide="mouse-pointer-2"></i><span>Select a drawing on the chart</span><small>Properties will appear here</small></div>';
    $('#properties').innerHTML=html;icons();return;
  }
  const d=drawings.find(x=>x.id===selectedId);if(!d)return;
  html+=`<div class="empty-properties" style="padding:12px 14px;align-items:stretch;gap:10px;text-align:left">
    <div><b>Type</b><br><span style="color:var(--muted)">${labelOf(d)}</span></div>
    <div><label style="display:block;margin-bottom:3px"><b>Color</b></label><input id="prop-color" type="color" value="${d.color||color}" style="width:100%;height:28px"></div>
    <div><label style="display:block;margin-bottom:3px"><b>Opacity ${Math.round((d.opacity!=null?d.opacity:opacity)*100)}%</b></label><input id="prop-opacity" type="range" min="10" max="100" value="${Math.round((d.opacity!=null?d.opacity:opacity)*100)}" style="width:100%;accent-color:var(--blue)"></div>
    <div><label style="display:block;margin-bottom:3px"><b>Line Width ${d.lineWidth||(d.tool==='marker'?12:2)}px</b></label><input id="prop-width" type="range" min="1" max="30" value="${d.lineWidth||(d.tool==='marker'?12:2)}" style="width:100%;accent-color:var(--blue)"></div>
    ${d.tool==='text'?`<div><label style="display:block;margin-bottom:3px"><b>Text</b></label><input id="prop-text" type="text" value="${d.text||''}" style="width:100%;padding:4px 6px;border:1px solid var(--line);background:var(--canvas)"></div>
    <div><label style="display:block;margin-bottom:3px"><b>Font Size ${d.fontSize||14}px</b></label><input id="prop-font" type="range" min="8" max="48" value="${d.fontSize||14}" style="width:100%;accent-color:var(--blue)"></div>`:''}
    <div style="display:flex;gap:6px;margin-top:6px">
      <button data-action="move-up" style="flex:1;padding:6px;border:1px solid var(--line);background:var(--chrome)">↑ Up</button>
      <button data-action="move-down" style="flex:1;padding:6px;border:1px solid var(--line);background:var(--chrome)">↓ Down</button>
      <button data-action="duplicate" style="flex:1;padding:6px;border:1px solid var(--line);background:var(--chrome)">⎘ Copy</button>
      <button data-action="delete" style="flex:1;padding:6px;border:1px solid var(--red);background:#ffe5e3;color:var(--red)">Delete</button>
    </div>
  </div>`;
  $('#properties').innerHTML=html;icons();
  $('#prop-color')?.addEventListener('input',e=>{d.color=e.target.value;drawChart();});
  $('#prop-opacity')?.addEventListener('input',e=>{d.opacity=e.target.value/100;updateProperties();drawChart();});
  $('#prop-width')?.addEventListener('input',e=>{d.lineWidth=+e.target.value;updateProperties();drawChart();});
  $('#prop-text')?.addEventListener('input',e=>{d.text=e.target.value;drawChart();});
  $('#prop-font')?.addEventListener('input',e=>{d.fontSize=+e.target.value;updateProperties();drawChart();});
  $$('#properties [data-action]').forEach(b=>b.addEventListener('click',()=>{
    const act=b.dataset.action,idx=drawings.indexOf(d);
    if(act==='move-up'&&idx<drawings.length-1){pushUndo();[drawings[idx],drawings[idx+1]]=[drawings[idx+1],drawings[idx]];updateLayers();drawChart();}
    if(act==='move-down'&&idx>0){pushUndo();[drawings[idx],drawings[idx-1]]=[drawings[idx-1],drawings[idx]];updateLayers();drawChart();}
    if(act==='duplicate'){const c=JSON.parse(JSON.stringify(d));c.id=uid();c.a={x:c.a.x+15,y:c.a.y+15};c.b={x:c.b.x+15,y:c.b.y+15};if(c.points)c.points=c.points.map(p=>({x:p.x+15,y:p.y+15}));addDrawing(c);toast('Duplicated');}
    if(act==='delete')deleteDrawing(d.id);
  }));
}

function buildTabs(){
  const tabs=$('#tabs');tabs.innerHTML='';
  chartTabs.forEach((t,i)=>{
    const el=document.createElement('button');el.className='tab'+(t.active?' active':'');el.dataset.symbol=t.symbol;
    el.innerHTML=(i===0?'● ':'')+t.name+' <span data-close>x</span>';
    el.addEventListener('click',e=>{
      if(e.target.dataset.close){
        e.stopPropagation();
        if(chartTabs.length===1)return toast('Keep at least one tab');
        const idx=chartTabs.indexOf(t);chartTabs.splice(idx,1);
        if(t.active)chartTabs[Math.max(0,idx-1)].active=true;
        buildTabs();if(chartTabs.find(x=>x.active))openTab(chartTabs.find(x=>x.active));
        return;
      }
      chartTabs.forEach(x=>x.active=false);t.active=true;buildTabs();openTab(t);
    });
    tabs.append(el);
  });
  const plus=document.createElement('button');plus.className='new-tab';plus.title='New chart';plus.textContent='+';
  plus.addEventListener('click',()=>{
    const base=prompt('Enter symbol name (e.g. RELIANCE, ETH/USD)','RELIANCE');
    if(base){
      const name=base.replace('/','')+'.chart';
      chartTabs.forEach(x=>x.active=false);
      chartTabs.push({symbol:base,name,active:true});
      if(!symbols.find(s=>s.n===base))symbols.push({n:base,m:'CUSTOM',b:100+Math.random()*900});
      buildTabs();openSymbol(name);
    }
  });
  tabs.append(plus);
}
function openTab(t){openSymbol(t.name)}

function buildWatchlist(){
  const w=$('#watchlist .watch-items');w.innerHTML='';
  Object.entries(watchPrices).forEach(([n,d])=>{
    const meta=symbols.find(s=>s.n===n);const up=d.change>=0;
    const b=document.createElement('button');b.style.display='grid';b.style.gridTemplateColumns='1fr auto';b.style.gridTemplateRows='17px 15px';
    b.style.width='100%';b.style.padding='6px 11px';b.style.textAlign='left';b.style.borderTop='1px solid var(--line2)';
    b.innerHTML=`<span style="font-weight:600">${n}<small style="display:block;color:var(--muted);font-size:9px;font-weight:400">${meta?.m||'MARKET'}</small></span>
      <b style="font:11px Consolas,monospace;text-align:right" class="${up?'up':'down'}">${fmt(d.price)}</b>
      <em style="grid-column:2;font-style:normal;font-size:10px;text-align:right;${up?'color:var(--green)':'color:var(--red)'}">${up?'+':''}${d.pct.toFixed(2)}%</em>`;
    b.addEventListener('click',()=>{openSymbol(n.replace('/','')+'.chart');buildTabs();});
    b.addEventListener('mouseenter',()=>b.style.background='var(--select)');
    b.addEventListener('mouseleave',()=>b.style.background='');
    w.append(b);
  });
}
function tickPrices(){
  Object.entries(watchPrices).forEach(([n,d])=>{
    const chg=(Math.random()-.48)*d.price*.0015;
    d.price=Math.max(.01,d.price+chg);
    d.change=d.price-d.prev;d.pct=(d.change/d.prev)*100;
  });
  buildWatchlist();
  if(candles.length){
    const c=candles[candles.length-1];const vol=(Math.random()-.48)*Math.abs(c.h-c.l)*.3;
    c.c=Math.max(c.l,Math.min(c.h,c.c+vol));if(++c._ticks>12){
      const o=c.c,h=o+Math.abs(vol)*4+Math.random()*5,l=o-Math.abs(vol)*4-Math.random()*5,c2=l+Math.random()*(h-l);
      candles.push({o,h,l,c:c2,v:Math.round(450+Math.random()*850),_ticks:0});
      if(candles.length>120)candles.shift();
    }
    updateOHLC();drawChart();
  }
}

function buildIndicatorsPopup(){
  const wrap=$('<div>');
  const el=document.createElement('div');el.className='modal-mask';
  el.innerHTML=`<div class="modal" style="width:440px">
    <div class="modal-header"><b>Indicators & Studies</b><button data-close>✕</button></div>
    <div class="modal-body" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px">
      ${[['ema20','EMA 20','Exponential moving average'],['vwap','VWAP','Volume-weighted avg price'],['rsi','RSI (14)','Relative strength index'],['bolinger','Bollinger Bands','20-period, 2σ bands'],['sma50','SMA 50','Simple moving average'],['macd','MACD','Moving avg convergence']].map(([k,n,d])=>`
        <label class="chk-card" style="padding:10px;border:1px solid var(--line);background:var(--canvas);cursor:pointer;${activeIndicators[k]?'border-color:var(--blue);background:var(--select)':''}">
          <input type="checkbox" data-k="${k}" ${activeIndicators[k]?'checked':''} style="margin-right:8px"> <b>${n}</b><br><small style="color:var(--muted)">${d}</small>
        </label>`).join('')}
    </div>
    <div class="modal-footer"><button data-close style="padding:6px 14px;border:1px solid var(--line);background:var(--chrome)">Close</button></div>
  </div>`;
  el.addEventListener('click',e=>{if(e.target===el||e.target.dataset.close!==undefined)el.remove();});
  el.querySelectorAll('[data-k]').forEach(cb=>cb.addEventListener('change',()=>{activeIndicators[cb.dataset.k]=cb.checked;drawChart();buildLayers();toast('Toggled');}));
  document.body.append(el);
}

function buildChartTypePopup(btn){
  const rect=btn.getBoundingClientRect();
  const el=document.createElement('div');el.className='menu-popup open';el.style.cssText=`display:block;left:${rect.left}px;top:${rect.bottom+2}px;min-width:150px`;
  [['candle','Candlesticks'],['line','Line Chart'],['bar','OHLC Bars'],['area','Area Chart']].forEach(([v,l])=>{
    const b=document.createElement('button');b.innerHTML=(chartType===v?'● ':'  ')+l;
    b.addEventListener('click',()=>{chartType=v;drawChart();toast('Chart: '+l);el.remove();});
    el.append(b);
  });
  document.body.append(el);
  setTimeout(()=>document.addEventListener('click',function rem(e){if(!el.contains(e.target)){el.remove();document.removeEventListener('click',rem);}}),0);
}

function saveStateNow(){
  const s={files,drawings,chartTabs,activeIndicators,chartType,currentSymbol,currentTimeframe,currentFile,theme:document.body.classList.contains('dark')?'dark':'light'};
  localStorage.setItem('trading-paint-state',JSON.stringify(s));
}
function loadState(){
  try{
    const s=JSON.parse(localStorage.getItem('trading-paint-state'));if(!s)return;
    if(s.files)Object.assign(files,s.files);
    if(s.drawings)drawings=s.drawings;
    if(s.chartTabs)chartTabs.splice(0,chartTabs.length,...s.chartTabs);
    if(s.activeIndicators)Object.assign(activeIndicators,s.activeIndicators);
    if(s.chartType)chartType=s.chartType;
    if(s.currentTimeframe)currentTimeframe=s.currentTimeframe;
    if(s.theme==='dark')document.body.classList.add('dark');
  }catch(e){}
}

function exportWorkspace(){
  const data={files,drawings,chartTabs,activeIndicators,chartType,currentSymbol,currentTimeframe,candles,exportedAt:Date.now()};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(currentFile||'workspace')+'.json';a.click();
  toast('Workspace exported');
}
function importWorkspace(file){
  const r=new FileReader();r.onload=()=>{
    try{const d=JSON.parse(r.result);
      if(d.files)Object.assign(files,d.files);
      if(d.drawings)drawings=d.drawings;
      if(d.chartTabs)chartTabs.splice(0,chartTabs.length,...d.chartTabs);
      if(d.activeIndicators)Object.assign(activeIndicators,d.activeIndicators);
      if(d.chartType)chartType=d.chartType;
      if(d.candles)candles=d.candles;
      makeTree();buildTabs();updateLayers();updateProperties();updateOHLC();drawChart();
      toast('Workspace imported');
    }catch(e){toast('Invalid file');}};
  r.readAsText(file);
}

function onPointerDown(e){
  const p=point(e);
  if(tool==='pan'){dragging=true;drawStart={x:e.clientX,y:e.clientY,panX,panY};canvas.style.cursor='grabbing';return;}
  if(tool==='zoom'){const f=e.button===2?.9:1.1;setZoom(zoom*f);return;}
  if(tool==='pointer'){const hit=hitTest(p);if(hit){selectedId=hit.id;drawStart={...p,obj:hit};dragging=true;updateProperties();updateLayers();}else{selectedId=null;updateProperties();updateLayers();}drawChart();return;}
  if(tool==='eraser'){const hit=hitTest(p);if(hit){pushUndo();drawings=drawings.filter(d=>d.id!==hit.id);updateLayers();drawChart();toast('Erased');return;}
    dragging=true;drawingPoints=[{...p}];tempPath={id:uid(),tool:'eraser',color:'transparent',points:drawingPoints,lineWidth:14};drawings.push(tempPath);return;}
  if(tool==='text'){
    const txt=prompt('Enter text:','Trading note');
    if(txt){addDrawing({id:uid(),tool:'text',a:p,b:{x:p.x+txt.length*8,y:p.y+16},color,opacity,text:txt,fontSize:14});drawChart();}
    return;
  }
  if(['pencil','brush','marker'].includes(tool)){
    dragging=true;drawingPoints=[{...p}];
    tempPath={id:uid(),tool,color,opacity,points:drawingPoints,lineWidth:tool==='marker'?12:(tool==='brush'?6:2)};
    drawings.push(tempPath);return;
  }
  if(['polygon','pitchfork','channel','fib-fan','fib-retrace','fib-extension'].includes(tool)){
    if(!drawingPoints){drawingPoints=[{...p}];tempPath={id:uid(),tool,color,opacity,a:{...p},b:{...p},points:drawingPoints};drawings.push(tempPath);toast('Click to add next point, double-click to finish');}
    else{drawingPoints.push({...p});tempPath.points=drawingPoints;tempPath.b={...p};}
    drawChart();return;
  }
  dragging=true;drawStart={...p};
  tempPath={id:uid(),tool,color,opacity,a:drawStart,b:{...drawStart}};
  drawings.push(tempPath);
}
function onPointerMove(e){
  const p=point(e);cursorInChart=true;
  $('#coordinates').textContent=`X: ${Math.round(p.x)}  Y: ${Math.round(p.y)}`;
  if(tool==='crosshair'||showCrosshair||tool==='pointer'){
    $('.crosshair-v').style.display='block';$('.crosshair-h').style.display='block';
    $('.crosshair-v').style.left=p.x+'px';$('.crosshair-h').style.top=p.y+'px';
    if(candles.length){
      const w=chartWrap.clientWidth,h=chartWrap.clientHeight;const left=10,right=58,top=24,bottom=38,chartW=w-left-right,chartH=h-top-bottom,volH=48;
      const values=candles.flatMap(c=>[c.h,c.l]);const max=Math.max(...values)+15,min=Math.min(...values)-15;
      const py=v=>top+(max-v)/(max-min)*(chartH-volH);
      const price=max-(p.y-top)/((chartH-volH)||1)*(max-min);
      const pm=$('#price-marker');pm.textContent=fmt(price);pm.style.top=(p.y-9)+'px';
    }
  }
  if(!dragging)return;
  if(tool==='pan'&&drawStart){panX=drawStart.panX+(e.clientX-drawStart.x);panY=drawStart.panY+(e.clientY-drawStart.y);drawChart();return;}
  if(tool==='pointer'&&drawStart?.obj){
    const d=drawStart.obj;const dx=p.x-drawStart.x,dy=p.y-drawStart.y;
    d.a={x:d.a.x+dx,y:d.a.y+dy};d.b={x:d.b.x+dx,y:d.b.y+dy};
    if(d.points)d.points=d.points.map(pt=>({x:pt.x+dx,y:pt.y+dy}));
    drawStart.x=p.x;drawStart.y=p.y;drawChart();return;
  }
  if(['pencil','brush','marker','eraser'].includes(tool)&&drawingPoints){drawingPoints.push({...p});drawChart();return;}
  if(['polygon','pitchfork','channel','fib-fan','fib-retrace','fib-extension'].includes(tool)&&tempPath){tempPath.b={...p};drawChart();return;}
  if(tempPath){tempPath.b={...p};drawChart();}
}
function onPointerUp(e){
  const p=point(e);cursorInChart=false;
  if(tool==='pan'){dragging=false;canvas.style.cursor='grab';return;}
  if(tool==='pointer'){if(dragging&&drawStart?.obj){pushUndo();toast('Drawing moved');}dragging=false;drawStart=null;return;}
  if(!dragging&&!['polygon','pitchfork','channel','fib-fan','fib-retrace','fib-extension','text'].includes(tool))return;
  if(['pencil','brush','marker','eraser'].includes(tool)&&drawingPoints){
    if(drawingPoints.length<2)drawings=drawings.filter(x=>x!==tempPath);
    drawingPoints=null;tempPath=null;dragging=false;updateLayers();updateProperties();drawChart();return;
  }
  if(['polygon','pitchfork','channel','fib-fan','fib-retrace','fib-extension'].includes(tool)){dragging=false;drawStart=null;return;}
  dragging=false;drawStart=null;
  if(tempPath){
    const dx=Math.abs(tempPath.a.x-tempPath.b.x),dy=Math.abs(tempPath.a.y-tempPath.b.y);
    if(dx<2&&dy<2&&!['horizontal','vertical'].includes(tool))drawings=drawings.filter(x=>x!==tempPath);
  }
  tempPath=null;updateLayers();updateProperties();drawChart();if(drawings.length)toast('Annotation added');
}
function onDoubleClick(){
  if(['polygon','pitchfork','channel','fib-fan','fib-retrace','fib-extension'].includes(tool)&&tempPath&&drawingPoints&&drawingPoints.length>=2){
    drawingPoints=null;tempPath=null;dragging=false;updateLayers();updateProperties();drawChart();toast('Shape added');
    setTool('pointer');
  }
}

function setZoom(v){zoom=Math.max(.2,Math.min(5,v));$('#zoom-slider').value=zoom*100;$('#zoom-value').textContent=Math.round(zoom*100)+'%';drawChart();}

buildPalette();
loadState();
const meta=symbols.find(s=>s.n===currentSymbol);if(meta)generateData(meta.b);
makeTree();buildTabs();buildWatchlist();updateLayers();updateProperties();updateOHLC();
setTimeout(()=>{icons();sizeCanvas();drawChart();},50);

$$('[data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));
$('#quick-undo').addEventListener('click',doUndo);
$('#quick-redo').addEventListener('click',doRedo);
$('#quick-save').addEventListener('click',()=>{saveStateNow();toast('Workspace saved locally');});
$('#theme-toggle').addEventListener('click',()=>{document.body.classList.toggle('dark');$('#theme-toggle i').setAttribute('data-lucide',document.body.classList.contains('dark')?'moon':'sun');icons();saveStateNow();drawChart();});

$$('.menu-button').forEach(b=>b.addEventListener('click',()=>{
  $$('.menu-button,.menu-popup').forEach(x=>x.classList.remove('open'));
  b.classList.add('open');const menu=$('#'+b.dataset.menu+'-menu');if(menu){menu.classList.add('open');menu.style.left=b.offsetLeft+'px';}
}));
document.addEventListener('click',e=>{if(!e.target.closest('.menu-bar'))$$('.menu-button,.menu-popup').forEach(x=>x.classList.remove('open'));});

$$('[data-action]').forEach(b=>b.addEventListener('click',()=>{
  const a=b.dataset.action;
  if(a==='upload'||a==='open')$('#file-input').click();
  if(a==='new-workspace'){if(confirm('Start new workspace? Unsaved changes will be lost.')){drawings=[];selectedId=null;undoStack=[];redoStack=[];updateLayers();updateProperties();drawChart();toast('New workspace');}}
  if(a==='zoom-in')setZoom(zoom+.1);
  if(a==='zoom-out')setZoom(zoom-.1);
  if(a==='zoom-reset'){zoom=1;panX=0;panY=0;setZoom(1);}
  if(a==='grid'){grid=!grid;drawChart();toast('Grid '+(grid?'on':'off'));}
  if(a==='crosshair'){showCrosshair=!showCrosshair;if(showCrosshair)setTool('crosshair');}
  if(a==='clear-drawings'){if(drawings.length&&confirm('Clear all drawings?')){pushUndo();drawings=[];selectedId=null;updateLayers();updateProperties();drawChart();toast('Drawings cleared');}}
  if(a==='undo')doUndo();
  if(a==='redo')doRedo();
  if(a==='save'){saveStateNow();if(confirm('Export as file too?'))exportWorkspace();}
}));

$('#file-input').addEventListener('change',e=>{
  [...e.target.files].forEach(f=>{
    if(f.name.endsWith('.json'))importWorkspace(f);
    else{files.Uploaded??=[];if(!files.Uploaded.includes(f.name))files.Uploaded.push(f.name);}
  });
  makeTree();toast(`${e.target.files.length} file(s) processed`);
});
$('#upload-button').addEventListener('click',()=>$('#file-input').click());
$('#drop-upload').addEventListener('click',()=>$('#file-input').click());
const drop=$('#drop-zone');
['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,x=>{x.preventDefault();drop.classList.add('dragging');}));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,x=>{x.preventDefault();drop.classList.remove('dragging');}));
drop.addEventListener('drop',e=>{
  [...e.dataTransfer.files].forEach(f=>{
    if(f.name.endsWith('.json'))importWorkspace(f);
    else{files.Uploaded??=[];if(!files.Uploaded.includes(f.name))files.Uploaded.push(f.name);}
  });
  makeTree();toast('Files processed');
});

$('#new-file').addEventListener('click',()=>{const name=prompt('Chart file name','New-Analysis.chart');if(name){files['Saved Analysis']=files['Saved Analysis']||[];files['Saved Analysis'].push(name);makeTree();saveStateNow();toast('New chart created');}});
$('#new-folder').addEventListener('click',()=>{const name=prompt('Folder name','New Folder');if(name){files[name]=[];makeTree();saveStateNow();toast('Folder created');}});
$('#file-search').addEventListener('input',e=>$$('.tree-file').forEach(f=>f.style.display=f.textContent.toLowerCase().includes(e.target.value.toLowerCase())?'flex':'none'));

$$('.inspector-tabs [data-panel]').forEach(b=>b.addEventListener('click',()=>{
  $$('.inspector-body').forEach(x=>x.classList.add('hidden'));
  $('#'+b.dataset.panel).classList.remove('hidden');
  $$('.inspector-tabs [data-panel]').forEach(x=>x.classList.toggle('active',x===b));
}));
$('#inspector-close').addEventListener('click',()=>$('#inspector').classList.toggle('collapsed'));
$('#right-toggle').addEventListener('click',()=>$('#inspector').classList.toggle('collapsed'));

$$('.timeframes button').forEach(b=>b.addEventListener('click',()=>{
  if(b.textContent==='Custom'){const t=prompt('Custom timeframe e.g. 7m, 3H, 45D','7m');if(t){$$('.timeframes button').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');currentTimeframe=t;$('#status-timeframe').textContent=t;const m=symbols.find(s=>s.n===currentSymbol);if(m)generateData(m.b);drawChart();toast('Timeframe: '+t);}return;}
  $$('.timeframes button').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');currentTimeframe=b.textContent;$('#status-timeframe').textContent=b.textContent;
  const m=symbols.find(s=>s.n===currentSymbol);if(m)generateData(m.b);drawChart();toast(`Timeframe ${b.textContent}`);
}));

const marketMatches=symbols.map(s=>`<button data-n="${s.n}"><b>${s.n}</b><br><small style="color:var(--muted)">${s.m}</small></button>`).join('');
$('#symbol-results').innerHTML=marketMatches;
$('#symbol-search').addEventListener('focus',()=>$('#symbol-results').classList.add('open'));
$('#symbol-search').addEventListener('input',e=>{
  $('#symbol-results').innerHTML=symbols.filter(s=>s.n.toLowerCase().includes(e.target.value.toLowerCase())).map(s=>`<button data-n="${s.n}"><b>${s.n}</b><br><small style="color:var(--muted)">${s.m}</small></button>`).join('');
  bindSymbolResults();
});
function bindSymbolResults(){
  $$('#symbol-results button').forEach(b=>b.addEventListener('click',()=>{
    openSymbol((b.dataset.n||b.textContent).replace('/','')+'.chart');
    $('#symbol-results').classList.remove('open');$('#symbol-search').value='';
  }));
}bindSymbolResults();
document.addEventListener('click',e=>{if(!e.target.closest('.symbol-search'))$('#symbol-results').classList.remove('open');});

$('#zoom-slider').addEventListener('input',e=>setZoom(e.target.value/100));
$('#zoom-minus').addEventListener('click',()=>setZoom(zoom-.1));
$('#zoom-plus').addEventListener('click',()=>setZoom(zoom+.1));
$('#opacity').addEventListener('input',e=>{opacity=e.target.value/100;});

canvas.addEventListener('pointerdown',onPointerDown);
canvas.addEventListener('pointermove',onPointerMove);
canvas.addEventListener('pointerup',onPointerUp);
canvas.addEventListener('pointercancel',onPointerUp);
canvas.addEventListener('pointerleave',()=>{$('.crosshair-v').style.display='none';$('.crosshair-h').style.display='none';cursorInChart=false;});
canvas.addEventListener('dblclick',onDoubleClick);
canvas.addEventListener('contextmenu',e=>e.preventDefault());
chartWrap.addEventListener('wheel',e=>{e.preventDefault();setZoom(zoom+(e.deltaY<0?.08:-.08));},{passive:false});
window.addEventListener('resize',sizeCanvas);

$('#indicator-button').addEventListener('click',buildIndicatorsPopup);
$('#menu-indicators').addEventListener('click',e=>{e.stopPropagation();buildIndicatorsPopup();$$('.menu-button,.menu-popup').forEach(x=>x.classList.remove('open'));});
$('#chart-type').addEventListener('click',e=>{e.stopPropagation();buildChartTypePopup(e.currentTarget);});

document.addEventListener('keydown',e=>{
  if(e.ctrlKey&&e.key.toLowerCase()==='s'){e.preventDefault();saveStateNow();toast('Workspace saved');}
  if(e.ctrlKey&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?doRedo():doUndo();}
  if(e.ctrlKey&&e.key.toLowerCase()==='y'){e.preventDefault();doRedo();}
  if(e.ctrlKey&&e.key.toLowerCase()==='d'){e.preventDefault();if(selectedId){const d=drawings.find(x=>x.id===selectedId);if(d){const c=JSON.parse(JSON.stringify(d));c.id=uid();c.a={x:c.a.x+15,y:c.a.y+15};c.b={x:c.b.x+15,y:c.b.y+15};if(c.points)c.points=c.points.map(p=>({x:p.x+15,y:p.y+15}));addDrawing(c);toast('Duplicated');}}}
  if(e.ctrlKey&&e.key.toLowerCase()==='c'&&selectedId){e.preventDefault();pasteBuffer=[JSON.parse(JSON.stringify(drawings.find(x=>x.id===selectedId)))];toast('Copied');}
  if(e.ctrlKey&&e.key.toLowerCase()==='v'&&pasteBuffer.length){e.preventDefault();pasteBuffer.forEach(d=>{const c=JSON.parse(JSON.stringify(d));c.id=uid();c.a={x:c.a.x+15,y:c.a.y+15};c.b={x:c.b.x+15,y:c.b.y+15};if(c.points)c.points=c.points.map(p=>({x:p.x+15,y:p.y+15}));addDrawing(c);});toast('Pasted');}
  if(e.key==='Escape'){if(['polygon','pitchfork','channel','fib-fan','fib-retrace','fib-extension'].includes(tool)&&tempPath){drawings=drawings.filter(x=>x!==tempPath);tempPath=null;drawingPoints=null;}setTool('pointer');selectedId=null;updateProperties();updateLayers();drawChart();}
  if((e.key==='Delete'||e.key==='Backspace')&&selectedId&&!e.target.matches('input,textarea')){e.preventDefault();deleteDrawing(selectedId);}
  if(e.key==='+'||e.key==='=')setZoom(zoom+.1);
  if(e.key==='-')setZoom(zoom-.1);
  if(e.key==='0'){zoom=1;panX=0;panY=0;setZoom(1);}
  const tools=[['v','pointer'],['c','crosshair'],['h','pan'],['z','zoom'],['p','pencil'],['b','brush'],['e','eraser'],['t','text'],['m','marker'],['l','trend'],['f','fib-retrace'],['r','rectangle'],['o','circle'],['a','arrow']];
  const hit=tools.find(x=>x[0]===e.key.toLowerCase());
  if(hit&&!e.ctrlKey&&!e.metaKey&&!e.target.matches('input,textarea'))setTool(hit[1]);
});

setInterval(saveStateNow,20000);
liveTimer=setInterval(tickPrices,1500);

if(document.body.classList.contains('dark')){$('#theme-toggle i')?.setAttribute('data-lucide','moon');icons();}
