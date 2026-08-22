const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false }, transports: ['websocket', 'polling'] });
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');

const defaults = {
  maxPlayers: 6, minPlayers: 2, exactRollToWin: true, extraTurnOnSix: false,
  stickerPopupMs: 3000, stickerCooldownMs: 900, soundDefaultOn: true
};
function readJson(file, fallback){ try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return structuredClone(fallback); } }
let settings = { ...defaults, ...readJson(path.join(DATA_DIR,'settings.json'), defaults) };
let stickers = readJson(path.join(DATA_DIR,'stickers.json'), []);
const rooms = new Map();
const GAME_PATHS = { snakes:'/snakes', tictactoe:'/tic-tac-toe', puzzle:'/arrow-puzzle', carrom:'/carrom' };
const jumps = {4:14,9:31,20:38,28:84,40:59,51:67,63:81,71:91,17:7,54:34,62:19,64:60,87:24,93:73,95:75,99:78};

function cleanName(v){ return String(v||'').replace(/[<>]/g,'').trim().slice(0,20) || 'Player'; }
function code(){ const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; for(let t=0;t<100;t++){ let s=''; const b=crypto.randomBytes(6); for(let i=0;i<6;i++) s+=a[b[i]%a.length]; if(!rooms.has(s)) return s; } throw new Error('room code'); }
function clamp(n,a,b){ n=Number(n); return Number.isFinite(n)?Math.max(a,Math.min(b,n)):a; }
function publicSettings(){ return {...settings}; }
function publicStickers(){ return stickers.filter(s=>s.enabled).sort((a,b)=>(a.order||0)-(b.order||0)).map(({id,name,url})=>({id,name,url})); }

function initCarrom(){
  const coins=[]; let id=0;
  coins.push({id:'q',kind:'queen',x:.5,y:.5,vx:0,vy:0,potted:false,r:.028});
  const ring1=6, ring2=12;
  for(let i=0;i<ring1;i++){ const a=(Math.PI*2*i/ring1); coins.push({id:'c'+(id++),kind:i%2?'white':'black',x:.5+Math.cos(a)*.074,y:.5+Math.sin(a)*.074,vx:0,vy:0,potted:false,r:.027}); }
  for(let i=0;i<ring2;i++){ const a=(Math.PI*2*i/ring2)+Math.PI/12; coins.push({id:'c'+(id++),kind:i%2?'black':'white',x:.5+Math.cos(a)*.145,y:.5+Math.sin(a)*.145,vx:0,vy:0,potted:false,r:.027}); }
  return { status:'ready', turnIndex:0, shotActive:false, shotSeq:0, scores:[0,0], colors:['black','white'], coins, striker:{x:.5,y:.82,vx:0,vy:0,r:.034,potted:false}, winnerId:null, pottedThisShot:[], foul:false };
}
function initRoom(c, host){
  return { code:c, hostId:host.id, createdAt:Date.now(), activeGame:'snakes', players:[host],
    snakes:{status:'lobby',turnIndex:0,winnerId:null,lastRoll:null,lastMove:null,moveSeq:0},
    ttt:{status:'ready',board:Array(9).fill(null),turnIndex:0,winnerId:null,round:1},
    puzzle:{}, carrom:initCarrom() };
}
function pubRoom(r){
  return { code:r.code,hostId:r.hostId,activeGame:r.activeGame,path:GAME_PATHS[r.activeGame],settings:publicSettings(),
    players:r.players.map((p,i)=>({id:p.id,name:p.name,colorIndex:p.colorIndex,position:p.position,puzzleLevel:p.puzzleLevel||1,connected:true,index:i})),
    snakes:r.snakes, ttt:r.ttt,
    puzzle:Object.fromEntries(r.players.map(p=>[p.id,{level:p.puzzleLevel||1,bestMs:p.puzzleBestMs||null}])),
    carrom:{...r.carrom,coins:r.carrom.coins.map(c=>({...c})),striker:{...r.carrom.striker}}
  };
}
function emitRoom(r){ io.to(r.code).emit('room:state', pubRoom(r)); }
function roomOf(s){ return s.data.roomCode ? rooms.get(s.data.roomCode) : null; }
function notice(r,msg){ io.to(r.code).emit('room:notice',msg); }
function leaveRoom(s){
  const r=roomOf(s); if(!r) return; const idx=r.players.findIndex(p=>p.id===s.id); if(idx<0)return;
  const name=r.players[idx].name; r.players.splice(idx,1); s.leave(r.code); s.data.roomCode=null;
  if(!r.players.length){ stopCarromTimer(r); rooms.delete(r.code); return; }
  if(r.hostId===s.id) r.hostId=r.players[0].id;
  r.snakes.turnIndex%=r.players.length; r.ttt.turnIndex%=Math.max(1,Math.min(2,r.players.length)); r.carrom.turnIndex%=Math.max(1,Math.min(2,r.players.length));
  io.to(r.code).emit('rtc:peer-left',{peerId:s.id}); notice(r,`${name} left.`); emitRoom(r);
}

function tttWinner(b){ const w=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]; for(const [a,c,d] of w) if(b[a]&&b[a]===b[c]&&b[a]===b[d]) return b[a]; return null; }

const carromTimers=new Map();
function stopCarromTimer(r){ const t=carromTimers.get(r.code); if(t){clearInterval(t);carromTimers.delete(r.code);} }
function resetStriker(c){ c.striker={x:.5,y:c.turnIndex===0?.82:.18,vx:0,vy:0,r:.034,potted:false}; }
function collide(a,b){
  const dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy),min=(a.r+b.r); if(!dist||dist>=min)return;
  const nx=dx/dist,ny=dy/dist, overlap=min-dist; a.x-=nx*overlap/2;a.y-=ny*overlap/2;b.x+=nx*overlap/2;b.y+=ny*overlap/2;
  const rvx=b.vx-a.vx,rvy=b.vy-a.vy, rel=rvx*nx+rvy*ny; if(rel>0)return; const j=-(1.86)*rel/2; const ix=j*nx,iy=j*ny; a.vx-=ix;a.vy-=iy;b.vx+=ix;b.vy+=iy;
}
function simCarrom(r){
  const c=r.carrom, dt=.034, friction=.986, pocketR=.055, pockets=[[.055,.055],[.945,.055],[.055,.945],[.945,.945]];
  const bodies=[c.striker,...c.coins.filter(x=>!x.potted)];
  for(const b of bodies){ if(b.potted) continue; b.x+=b.vx*dt; b.y+=b.vy*dt; b.vx*=friction; b.vy*=friction; if(Math.abs(b.vx)<.008)b.vx=0;if(Math.abs(b.vy)<.008)b.vy=0;
    for(const [px,py] of pockets){ if(Math.hypot(b.x-px,b.y-py)<pocketR){ b.potted=true;b.vx=b.vy=0; if(b===c.striker)c.foul=true; else c.pottedThisShot.push(b.kind); break; } }
    if(b.potted)continue; const lo=.055+b.r,hi=.945-b.r; if(b.x<lo){b.x=lo;b.vx=Math.abs(b.vx)*.88} if(b.x>hi){b.x=hi;b.vx=-Math.abs(b.vx)*.88} if(b.y<lo){b.y=lo;b.vy=Math.abs(b.vy)*.88} if(b.y>hi){b.y=hi;b.vy=-Math.abs(b.vy)*.88}
  }
  const active=[c.striker,...c.coins.filter(x=>!x.potted)].filter(x=>!x.potted); for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++)collide(active[i],active[j]);
  io.to(r.code).emit('carrom:frame',{coins:c.coins,striker:c.striker,turnIndex:c.turnIndex,shotSeq:c.shotSeq});
  const moving=active.some(b=>Math.hypot(b.vx,b.vy)>.012); if(!moving) finishCarromShot(r);
}
function finishCarromShot(r){
  stopCarromTimer(r); const c=r.carrom; c.shotActive=false; const own=c.colors[c.turnIndex]; let keep=false;
  for(const k of c.pottedThisShot){ if(k===own){c.scores[c.turnIndex]++;keep=true;} else if(k==='queen'){c.scores[c.turnIndex]+=2;keep=true;} else {c.scores[c.turnIndex]=Math.max(0,c.scores[c.turnIndex]-1);} }
  const remainingOwn=c.coins.some(x=>x.kind===own&&!x.potted); if(!remainingOwn){ c.winnerId=r.players[c.turnIndex]?.id||null; c.status='won'; }
  if(c.foul||!keep) c.turnIndex=(c.turnIndex+1)%Math.min(2,r.players.length);
  c.pottedThisShot=[]; c.foul=false; resetStriker(c); emitRoom(r); if(c.winnerId) io.to(r.code).emit('game:win',{game:'carrom',winnerId:c.winnerId});
}

app.use(express.json({limit:'1mb'})); app.use(express.static(PUBLIC_DIR));
app.get('/health',(_q,res)=>res.json({ok:true,version:'4.0.0'}));
app.get('/config',(_q,res)=>{ const iceServers=[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}]; res.json({iceServers,settings:publicSettings()}); });
app.get('/api/stickers',(_q,res)=>res.json({ok:true,stickers:publicStickers()}));
app.get('/admin',(_q,res)=>res.sendFile(path.join(PUBLIC_DIR,'admin.html')));
app.get(['/snakes','/tic-tac-toe','/arrow-puzzle','/carrom'],(_q,res)=>res.sendFile(path.join(PUBLIC_DIR,'index.html')));
app.get('/api/admin/dashboard',(_q,res)=>res.json({ok:true,settings:publicSettings(),stickers,rooms:[...rooms.values()].map(r=>({code:r.code,game:r.activeGame,players:r.players.map(p=>p.name)}))}));
app.put('/api/admin/settings',(req,res)=>{ const b=req.body||{}; settings={...settings,maxPlayers:Math.round(clamp(b.maxPlayers,2,6)),minPlayers:Math.round(clamp(b.minPlayers,2,6)),exactRollToWin:!!b.exactRollToWin,extraTurnOnSix:!!b.extraTurnOnSix,stickerPopupMs:Math.round(clamp(b.stickerPopupMs,1000,6000)),stickerCooldownMs:Math.round(clamp(b.stickerCooldownMs,300,5000)),soundDefaultOn:b.soundDefaultOn!==false}; if(settings.minPlayers>settings.maxPlayers)settings.minPlayers=settings.maxPlayers; io.emit('game:settings',publicSettings()); res.json({ok:true,settings,persistent:false}); });
app.patch('/api/admin/stickers/:id',(req,res)=>{ const s=stickers.find(x=>x.id===req.params.id); if(!s)return res.status(404).json({ok:false}); if(typeof req.body.name==='string')s.name=cleanName(req.body.name); if(typeof req.body.enabled==='boolean')s.enabled=req.body.enabled; io.emit('stickers:update',publicStickers()); res.json({ok:true,sticker:s,persistent:false}); });

io.on('connection',socket=>{
  socket.emit('game:settings',publicSettings()); socket.emit('stickers:update',publicStickers());
  socket.on('room:create',(payload={},ack=()=>{})=>{ try{ leaveRoom(socket); const name=cleanName(payload.name); const c=code(); const p={id:socket.id,name,colorIndex:0,position:1,puzzleLevel:1,puzzleBestMs:null}; const r=initRoom(c,p); rooms.set(c,r); socket.join(c);socket.data.roomCode=c;socket.data.playerName=name;ack({ok:true,room:pubRoom(r)});emitRoom(r); }catch(e){ack({ok:false,error:'Could not create room.'});} });
  socket.on('room:join',(payload={},ack=()=>{})=>{ const c=String(payload.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6); const r=rooms.get(c); if(!r)return ack({ok:false,error:'Room not found.'}); if(r.players.length>=settings.maxPlayers)return ack({ok:false,error:'Room is full.'}); leaveRoom(socket); const p={id:socket.id,name:cleanName(payload.name),colorIndex:r.players.length%6,position:1,puzzleLevel:1,puzzleBestMs:null}; r.players.push(p); socket.join(c);socket.data.roomCode=c;socket.data.playerName=p.name; const peers=r.players.filter(x=>x.id!==socket.id).map(x=>x.id); socket.emit('rtc:peers',{peers}); socket.to(c).emit('rtc:peer-joined',{peerId:socket.id}); notice(r,`${p.name} joined.`); ack({ok:true,room:pubRoom(r)}); emitRoom(r); });
  socket.on('room:leave',()=>leaveRoom(socket));
  socket.on('game:select',(payload={},ack=()=>{})=>{ const r=roomOf(socket); if(!r)return ack({ok:false,error:'No room.'}); const game=String(payload.game||''); if(!GAME_PATHS[game])return ack({ok:false,error:'Unknown game.'}); if(r.hostId!==socket.id)return ack({ok:false,error:'Only host can switch games.'}); r.activeGame=game; if(game==='tictactoe'&&r.ttt.status==='won')r.ttt={status:'ready',board:Array(9).fill(null),turnIndex:0,winnerId:null,round:r.ttt.round+1}; if(game==='carrom'&&r.carrom.status==='won')r.carrom=initCarrom(); emitRoom(r);io.to(r.code).emit('game:selected',{game,path:GAME_PATHS[game]});ack({ok:true}); });

  socket.on('snakes:start',(_,ack=()=>{})=>{ const r=roomOf(socket); if(!r)return ack({ok:false}); if(r.hostId!==socket.id)return ack({ok:false,error:'Host only.'}); if(r.players.length<settings.minPlayers)return ack({ok:false,error:`Need ${settings.minPlayers} players.`}); r.players.forEach(p=>p.position=1); r.snakes={status:'playing',turnIndex:0,winnerId:null,lastRoll:null,lastMove:null,moveSeq:r.snakes.moveSeq+1}; emitRoom(r);ack({ok:true}); });
  socket.on('snakes:roll',(_,ack=()=>{})=>{ const r=roomOf(socket); if(!r||r.snakes.status!=='playing')return ack({ok:false,error:'Game not running.'}); const idx=r.players.findIndex(p=>p.id===socket.id); if(idx!==r.snakes.turnIndex)return ack({ok:false,error:'Not your turn.'}); const p=r.players[idx], roll=crypto.randomInt(1,7), from=p.position; let raw=from+roll, blocked=false; if(raw>100){ if(settings.exactRollToWin){raw=from;blocked=true}else raw=100; } let to=raw,special=null; if(!blocked&&jumps[to]){ const dest=jumps[to]; special={type:dest>to?'ladder':'snake',from:to,to:dest};to=dest; } p.position=to; r.snakes.lastRoll=roll;r.snakes.moveSeq++;r.snakes.lastMove={id:r.snakes.moveSeq,playerId:p.id,roll,from,to,raw,special,blocked}; if(to===100){r.snakes.status='won';r.snakes.winnerId=p.id;} else if(!(settings.extraTurnOnSix&&roll===6))r.snakes.turnIndex=(r.snakes.turnIndex+1)%r.players.length; emitRoom(r); ack({ok:true,roll}); if(to===100)io.to(r.code).emit('game:win',{game:'snakes',winnerId:p.id,moveId:r.snakes.moveSeq}); });

  socket.on('ttt:move',(payload={},ack=()=>{})=>{ const r=roomOf(socket); if(!r)return ack({ok:false}); if(r.players.length<2)return ack({ok:false,error:'Need 2 players.'}); if(r.ttt.status==='won')return ack({ok:false,error:'Round finished.'}); const active=r.players.slice(0,2); const idx=active.findIndex(p=>p.id===socket.id); if(idx<0)return ack({ok:false,error:'Spectating.'}); if(idx!==r.ttt.turnIndex)return ack({ok:false,error:'Not your turn.'}); const cell=Math.round(Number(payload.cell)); if(cell<0||cell>8||r.ttt.board[cell])return ack({ok:false,error:'Invalid square.'}); r.ttt.status='playing'; r.ttt.board[cell]=idx===0?'X':'O'; const w=tttWinner(r.ttt.board); if(w){r.ttt.status='won';r.ttt.winnerId=socket.id;} else if(r.ttt.board.every(Boolean)){r.ttt.status='draw';} else r.ttt.turnIndex=1-r.ttt.turnIndex; emitRoom(r);ack({ok:true}); if(w)io.to(r.code).emit('game:win',{game:'tictactoe',winnerId:socket.id}); });
  socket.on('ttt:restart',(_,ack=()=>{})=>{ const r=roomOf(socket); if(!r)return ack({ok:false}); if(r.hostId!==socket.id)return ack({ok:false,error:'Host only.'}); r.ttt={status:'ready',board:Array(9).fill(null),turnIndex:0,winnerId:null,round:(r.ttt.round||1)+1}; emitRoom(r);ack({ok:true}); });

  socket.on('puzzle:solved',(payload={},ack=()=>{})=>{ const r=roomOf(socket); if(!r)return ack({ok:false}); const p=r.players.find(x=>x.id===socket.id); if(!p)return ack({ok:false}); const level=Math.round(clamp(payload.level,1,12)),ms=Math.round(clamp(payload.ms,300,3600000)); if(level!==p.puzzleLevel)return ack({ok:false,error:'Solve levels in order.'}); p.puzzleBestMs=p.puzzleBestMs?Math.min(p.puzzleBestMs,ms):ms; p.puzzleLevel=Math.min(12,p.puzzleLevel+1); emitRoom(r); io.to(r.code).emit('puzzle:celebrate',{playerId:p.id,name:p.name,level,ms}); ack({ok:true,nextLevel:p.puzzleLevel}); });
  socket.on('puzzle:reset',(_,ack=()=>{})=>{ const r=roomOf(socket);if(!r)return ack({ok:false});const p=r.players.find(x=>x.id===socket.id);if(p){p.puzzleLevel=1;p.puzzleBestMs=null;emitRoom(r);}ack({ok:true}); });

  socket.on('carrom:shoot',(payload={},ack=()=>{})=>{ const r=roomOf(socket); if(!r)return ack({ok:false}); if(r.players.length<2)return ack({ok:false,error:'Need 2 players.'}); const c=r.carrom; if(c.status==='won'||c.shotActive)return ack({ok:false,error:'Wait for the board.'}); const active=r.players.slice(0,2); if(active[c.turnIndex]?.id!==socket.id)return ack({ok:false,error:'Not your turn.'}); const power=clamp(payload.power,0.18,1), angle=clamp(payload.angle,-Math.PI,Math.PI), x=clamp(payload.x,.22,.78); c.striker={x,y:c.turnIndex===0?.82:.18,vx:Math.cos(angle)*power*1.72,vy:Math.sin(angle)*power*1.72,r:.034,potted:false}; c.status='playing';c.shotActive=true;c.shotSeq++;c.pottedThisShot=[];c.foul=false;emitRoom(r);stopCarromTimer(r);carromTimers.set(r.code,setInterval(()=>simCarrom(r),34));ack({ok:true}); });
  socket.on('carrom:restart',(_,ack=()=>{})=>{ const r=roomOf(socket);if(!r)return ack({ok:false});if(r.hostId!==socket.id)return ack({ok:false,error:'Host only.'});stopCarromTimer(r);r.carrom=initCarrom();emitRoom(r);ack({ok:true}); });

  socket.on('sticker:send',(payload={},ack=()=>{})=>{ const r=roomOf(socket);if(!r)return ack({ok:false}); const now=Date.now(),last=socket.data.lastSticker||0;if(now-last<settings.stickerCooldownMs)return ack({ok:false,error:'Too fast.'}); const st=stickers.find(s=>s.id===payload.id&&s.enabled);if(!st)return ack({ok:false,error:'Sticker unavailable.'});socket.data.lastSticker=now;io.to(r.code).emit('sticker:pop',{id:st.id,name:st.name,url:st.url,from:socket.data.playerName||'Player',ms:settings.stickerPopupMs});ack({ok:true}); });

  socket.on('rtc:signal',(payload={})=>{ const r=roomOf(socket);if(!r)return;const target=io.sockets.sockets.get(payload.to);if(target&&target.data.roomCode===r.code)target.emit('rtc:signal',{from:socket.id,data:payload.data}); });
  socket.on('disconnect',()=>leaveRoom(socket));
});

server.listen(PORT,()=>console.log(`PlayVerse running on ${PORT}`));
