const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const PORT = process.env.PORT || 3000;
const MAX = 10, GOAL = 200, TAP_COOLDOWN = 35;
const players = new Map();
let phase = 'lobby', countdownAt = 0, results = [], gameId = 0, raceTimeout = null;
const animals = ['🐰','🐶','🐱','🦊','🐼','🐯','🐸','🐻','🐹','🐧'];
const index = fs.readFileSync(path.join(__dirname,'public','index.html'));
const server = http.createServer((req,res)=>{
  if(req.url === '/health'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('ok');}
  if(req.url === '/' || req.url === '/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(index);}
  res.writeHead(404);res.end('Not found');
});
const wss = new WebSocketServer({server});
const send=(ws,obj)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj));};
const snapshot=()=>({type:'state',phase, countdownAt, goal:GOAL, max:MAX, players:[...players.values()].map(p=>({id:p.id,name:p.name,animal:p.animal,ready:p.ready,progress:p.progress,place:p.place,active:p.active})),results});
const broadcast=()=>{const data=JSON.stringify(snapshot());for(const c of wss.clients)if(c.readyState===WebSocket.OPEN)c.send(data);};
const reset=()=>{clearTimeout(raceTimeout);phase='lobby';countdownAt=0;results=[];for(const p of players.values()){p.ready=false;p.progress=0;p.place=null;p.lastTap=0;p.active=false;}broadcast();};
const finish=()=>{if(phase!=='racing')return;phase='results';clearTimeout(raceTimeout);const ranked=[...players.values()].filter(p=>p.active).sort((a,b)=>(a.place??999)-(b.place??999)||b.progress-a.progress);results=ranked.map((p,i)=>({id:p.id,name:p.name,animal:p.animal,place:i+1,progress:p.progress}));broadcast();};
const startReady=()=>{
 if(phase!=='lobby')return;
 const ready=[...players.values()].filter(p=>p.ready);
 if(ready.length<2)return;
 for(const p of players.values()){p.active=p.ready;p.progress=0;p.place=null;}
 phase='countdown';countdownAt=Date.now()+3000;
 const current=++gameId;broadcast();
 setTimeout(()=>{if(phase==='countdown'&&gameId===current){phase='racing';broadcast();raceTimeout=setTimeout(finish,90000);}},3000);
};
wss.on('connection',ws=>{
 let id=null;
 send(ws,{type:'hello'});
 ws.on('message',raw=>{
  if(raw.length>2048)return;
  let m;try{m=JSON.parse(raw.toString());}catch{return;}
  if(m.type==='join'){
   if(id)return;
   if(players.size>=MAX){send(ws,{type:'error',message:'대기실이 가득 찼어요. 최대 10명입니다.'});return;}
   const name=String(m.name||'').trim().slice(0,12);
   if(!name){send(ws,{type:'error',message:'닉네임을 입력해 주세요.'});return;}
   const animal=animals.includes(m.animal)?m.animal:'🐰';
   id=crypto.randomUUID();players.set(id,{id,name,animal,ready:false,progress:0,place:null,lastTap:0,active:false,ws});send(ws,{type:'joined',id});broadcast();return;
  }
  if(!id||!players.has(id))return;
  const p=players.get(id);
  if(m.type==='ready'&&phase==='lobby'){p.ready=!!m.ready;broadcast();}
  if(m.type==='start'&&phase==='lobby'&&p.ready)startReady();
  if(m.type==='tap'&&phase==='racing'&&p.active&&!p.place){const now=Date.now();if(now-p.lastTap<TAP_COOLDOWN)return;p.lastTap=now;p.progress=Math.min(GOAL,p.progress+1);if(p.progress>=GOAL){p.place=[...players.values()].filter(x=>x.active&&x.place!==null).length+1;}broadcast();if([...players.values()].filter(x=>x.active).every(x=>x.place!==null))finish();}
  if(m.type==='again'&&phase==='results'&&p.active)reset();
 });
 ws.on('close',()=>{if(!id)return;players.delete(id);if(phase==='countdown'){if([...players.values()].filter(x=>x.active).length<2){gameId++;reset();}else broadcast();}else if(phase==='lobby'){broadcast();}else if(phase==='racing'){if(players.size===0)reset();else if([...players.values()].filter(x=>x.active).every(x=>x.place!==null))finish();else broadcast();}else if(phase==='results'){if(players.size===0)reset();else broadcast();}});
});
server.listen(PORT,()=>console.log(`Animal race listening on ${PORT}`));
