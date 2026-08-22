const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')); }
  catch { return fallback; }
}
let settings = readJson('settings.json', {
  maxPlayers: 6, minPlayers: 2, exactRollToWin: true, extraTurnOnSix: false,
  stickerPopupMs: 3000, stickerCooldownMs: 900, soundDefaultOn: true
});
let stickers = readJson('stickers.json', []);
const rooms = new Map();

const GAME_PATHS = { snakes: '/snakes', tictactoe: '/tic-tac-toe', wordsearch: '/word-search' };
const jumps = {
  4:14, 9:31, 20:38, 28:84, 40:59, 51:67, 63:81, 71:91,
  17:7, 54:34, 62:19, 64:60, 87:24, 93:73, 95:75, 99:78
};

const WORD_BANK = [
  'LOVE','SMILE','DREAM','HEART','HAPPY','FUN','COFFEE','MUSIC','MOVIE','HELLO','LUCKY','SUNSET',
  'GAMER','SWEET','LAUGH','DANCE','PARTY','FRIEND','MAGIC','CUTE','CHILL','SPARK','HONEY','NIGHT',
  'PIZZA','TRAVEL','CLOUD','STARS','BEACH','PHONE','PHOTO','CRUSH','MANGO','RAIN','COOKIE','VIBE'
];

function clamp(v, a, b) { v = Number(v); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : a; }
function cleanName(v) { return String(v || 'Player').replace(/[<>]/g, '').trim().slice(0, 20) || 'Player'; }
function code() { const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; do { s=''; for(let i=0;i<6;i++) s+=chars[crypto.randomInt(chars.length)]; } while(rooms.has(s)); return s; }
function publicSettings(){ return { ...settings }; }
function publicStickers(){ return stickers.filter(s => s.enabled).sort((a,b)=>(a.order||0)-(b.order||0)); }
function roomOf(socket){ return rooms.get(socket.data.roomCode); }
function notice(r,msg){ io.to(r.code).emit('room:notice',msg); }
function emitRoom(r){ io.to(r.code).emit('room:state', pubRoom(r)); }

function seeded(seed){
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}
function shuffle(arr, rnd){
  const a=[...arr]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a;
}
function makeWordSearch(seed = crypto.randomInt(1, 2**30)){
  const size=10, rnd=seeded(seed), directions=[[0,1],[1,0],[1,1],[-1,1],[0,-1],[1,-1],[-1,0],[-1,-1]];
  const grid=Array.from({length:size},()=>Array(size).fill(''));
  const candidates=shuffle(WORD_BANK,rnd).filter(w=>w.length<=8);
  const words=[];
  for(const word of candidates){
    if(words.length>=8) break;
    let placed=false;
    for(let attempt=0;attempt<140&&!placed;attempt++){
      const [dr,dc]=directions[Math.floor(rnd()*directions.length)];
      const r0=Math.floor(rnd()*size), c0=Math.floor(rnd()*size);
      const r1=r0+dr*(word.length-1), c1=c0+dc*(word.length-1);
      if(r1<0||r1>=size||c1<0||c1>=size) continue;
      let ok=true;
      for(let i=0;i<word.length;i++){
        const ch=grid[r0+dr*i][c0+dc*i];
        if(ch && ch!==word[i]) { ok=false; break; }
      }
      if(!ok) continue;
      const path=[];
      for(let i=0;i<word.length;i++){ const rr=r0+dr*i,cc=c0+dc*i;grid[rr][cc]=word[i];path.push(rr*size+cc); }
      words.push({word,path}); placed=true;
    }
  }
  const letters='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for(let r=0;r<size;r++)for(let c=0;c<size;c++)if(!grid[r][c])grid[r][c]=letters[Math.floor(rnd()*letters.length)];
  return { status:'playing', seed, size, grid:grid.flat(), words:words.map(w=>w.word), answers:words, found:[], turnIndex:0, winnerId:null, round:1 };
}

function initRoom(c, host){
  return {
    code:c, hostId:host.id, activeGame:'snakes', players:[host],
    snakes:{status:'lobby',turnIndex:0,winnerId:null,lastRoll:null,lastMove:null,moveSeq:0,rolling:false,phase:'idle',turnReadyAt:0},
    ttt:{status:'ready',board:Array(9).fill(null),turnIndex:0,winnerId:null,round:1},
    wordsearch:makeWordSearch(), createdAt:Date.now()
  };
}
function pubWordSearch(w){
  return { status:w.status, seed:w.seed, size:w.size, grid:w.grid, words:w.words, found:w.found, turnIndex:w.turnIndex, winnerId:w.winnerId, round:w.round };
}
function pubRoom(r){
  return {
    code:r.code, hostId:r.hostId, activeGame:r.activeGame, path:GAME_PATHS[r.activeGame], settings:publicSettings(),
    players:r.players.map(p=>({id:p.id,name:p.name,colorIndex:p.colorIndex,position:p.position})),
    snakes:{...r.snakes}, ttt:{...r.ttt,board:[...r.ttt.board]}, wordsearch:pubWordSearch(r.wordsearch)
  };
}
function leaveRoom(socket){
  const r=roomOf(socket); if(!r) return;
  const idx=r.players.findIndex(p=>p.id===socket.id); if(idx<0) return;
  const [gone]=r.players.splice(idx,1); socket.leave(r.code); socket.data.roomCode=null;
  socket.to(r.code).emit('rtc:peer-left',{peerId:socket.id});
  if(!r.players.length){ rooms.delete(r.code); return; }
  if(r.hostId===socket.id) r.hostId=r.players[0].id;
  r.snakes.turnIndex=Math.min(r.snakes.turnIndex,Math.max(0,r.players.length-1));
  r.ttt.turnIndex=Math.min(r.ttt.turnIndex,1);
  r.wordsearch.turnIndex=Math.min(r.wordsearch.turnIndex,Math.max(0,r.players.length-1));
  notice(r,`${gone.name} left.`); emitRoom(r);
}
function tttWinner(b){ const lines=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]; return lines.find(([a,c,d])=>b[a]&&b[a]===b[c]&&b[a]===b[d])||null; }
function normalizeSelection(start,end,size){
  start=Math.round(Number(start)); end=Math.round(Number(end));
  if(start<0||end<0||start>=size*size||end>=size*size) return null;
  const r0=Math.floor(start/size),c0=start%size,r1=Math.floor(end/size),c1=end%size;
  const dr=Math.sign(r1-r0), dc=Math.sign(c1-c0);
  if(dr===0&&dc===0) return [start];
  const rr=Math.abs(r1-r0), cc=Math.abs(c1-c0);
  if(!(r0===r1||c0===c1||rr===cc)) return null;
  const len=Math.max(rr,cc)+1, path=[];
  for(let i=0;i<len;i++) path.push((r0+dr*i)*size+(c0+dc*i));
  return path;
}
function samePath(a,b){ return a.length===b.length&&a.every((v,i)=>v===b[i]); }

app.use(express.json({limit:'1mb'}));
app.use(express.static(PUBLIC_DIR));
app.get('/health',(_q,res)=>res.json({ok:true,version:'6.0.0'}));
app.get('/config',(_q,res)=>res.json({iceServers:[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}],settings:publicSettings()}));
app.get('/api/stickers',(_q,res)=>res.json({ok:true,stickers:publicStickers()}));
app.get('/admin',(_q,res)=>res.sendFile(path.join(PUBLIC_DIR,'admin.html')));
app.get(['/snakes','/tic-tac-toe','/word-search'],(_q,res)=>res.sendFile(path.join(PUBLIC_DIR,'index.html')));
app.get('/api/admin/dashboard',(_q,res)=>res.json({ok:true,settings:publicSettings(),stickers,rooms:[...rooms.values()].map(r=>({code:r.code,game:r.activeGame,players:r.players.map(p=>p.name)}))}));
app.put('/api/admin/settings',(req,res)=>{
  const b=req.body||{};
  settings={...settings,maxPlayers:Math.round(clamp(b.maxPlayers,2,6)),minPlayers:Math.round(clamp(b.minPlayers,2,6)),exactRollToWin:!!b.exactRollToWin,extraTurnOnSix:!!b.extraTurnOnSix,stickerPopupMs:Math.round(clamp(b.stickerPopupMs,1000,6000)),stickerCooldownMs:Math.round(clamp(b.stickerCooldownMs,300,5000)),soundDefaultOn:b.soundDefaultOn!==false};
  if(settings.minPlayers>settings.maxPlayers)settings.minPlayers=settings.maxPlayers;
  io.emit('game:settings',publicSettings()); res.json({ok:true,settings,persistent:false});
});
app.patch('/api/admin/stickers/:id',(req,res)=>{
  const s=stickers.find(x=>x.id===req.params.id); if(!s)return res.status(404).json({ok:false});
  if(typeof req.body.name==='string')s.name=cleanName(req.body.name); if(typeof req.body.enabled==='boolean')s.enabled=req.body.enabled;
  io.emit('stickers:update',publicStickers()); res.json({ok:true,sticker:s,persistent:false});
});

io.on('connection',socket=>{
  socket.emit('game:settings',publicSettings()); socket.emit('stickers:update',publicStickers());

  socket.on('room:create',(payload={},ack=()=>{})=>{
    try{
      leaveRoom(socket); const c=code(); const p={id:socket.id,name:cleanName(payload.name),colorIndex:0,position:1}; const r=initRoom(c,p);
      rooms.set(c,r); socket.join(c); socket.data.roomCode=c; socket.data.playerName=p.name; ack({ok:true,room:pubRoom(r)}); emitRoom(r);
    }catch(e){ console.error(e); ack({ok:false,error:'Could not create room.'}); }
  });
  socket.on('room:join',(payload={},ack=()=>{})=>{
    const c=String(payload.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6),r=rooms.get(c);
    if(!r)return ack({ok:false,error:'Room not found.'}); if(r.players.length>=settings.maxPlayers)return ack({ok:false,error:'Room is full.'});
    leaveRoom(socket); const p={id:socket.id,name:cleanName(payload.name),colorIndex:r.players.length%6,position:1}; r.players.push(p);
    socket.join(c);socket.data.roomCode=c;socket.data.playerName=p.name;
    socket.emit('rtc:peers',{peers:r.players.filter(x=>x.id!==socket.id).map(x=>x.id)}); socket.to(c).emit('rtc:peer-joined',{peerId:socket.id});
    notice(r,`${p.name} joined.`); ack({ok:true,room:pubRoom(r)}); emitRoom(r);
  });
  socket.on('room:leave',()=>leaveRoom(socket));

  socket.on('game:select',(payload={},ack=()=>{})=>{
    const r=roomOf(socket); if(!r)return ack({ok:false,error:'No room.'}); const game=String(payload.game||'');
    if(!GAME_PATHS[game])return ack({ok:false,error:'Unknown game.'}); if(r.hostId!==socket.id)return ack({ok:false,error:'Only host can switch games.'});
    r.activeGame=game; emitRoom(r); io.to(r.code).emit('game:selected',{game,path:GAME_PATHS[game]}); ack({ok:true});
  });

  socket.on('snakes:start',(_,ack=()=>{})=>{
    const r=roomOf(socket); if(!r)return ack({ok:false}); if(r.hostId!==socket.id)return ack({ok:false,error:'Host only.'});
    if(r.players.length<settings.minPlayers)return ack({ok:false,error:`Need ${settings.minPlayers} players.`});
    r.players.forEach(p=>p.position=1); r.snakes={status:'playing',turnIndex:0,winnerId:null,lastRoll:null,lastMove:null,moveSeq:r.snakes.moveSeq+1,rolling:false,phase:'idle',turnReadyAt:Date.now()}; emitRoom(r); ack({ok:true});
  });
  socket.on('snakes:roll',(_,ack=()=>{})=>{
    const r=roomOf(socket);
    if(!r||r.snakes.status!=='playing') return ack({ok:false,error:'Game not running.'});
    if((r.snakes.phase||'idle')!=='idle') return ack({ok:false,error:'Wait for the current move to finish.'});
    const idx=r.players.findIndex(p=>p.id===socket.id);
    if(idx!==r.snakes.turnIndex) return ack({ok:false,error:'Not your turn.'});

    const roll=crypto.randomInt(1,7), p=r.players[idx], from=p.position;
    r.snakes.rolling=true; r.snakes.phase='rolling'; r.snakes.turnReadyAt=0;
    emitRoom(r);
    io.to(r.code).emit('snakes:dice-roll',{playerId:p.id,roll,duration:1100});
    ack({ok:true,roll});

    setTimeout(()=>{
      const live=rooms.get(r.code);
      if(!live||live!==r||!r.players.find(x=>x.id===p.id)) return;
      let raw=from+roll,blocked=false;
      if(raw>100){ if(settings.exactRollToWin){raw=from;blocked=true}else raw=100; }
      let to=raw,special=null;
      if(!blocked&&jumps[to]){const dest=jumps[to];special={type:dest>to?'ladder':'snake',from:to,to:dest};to=dest;}

      const steps=blocked?0:Math.max(0,raw-from);
      const specialMs=special?(special.type==='ladder'?1050:1320):0;
      const animationMs=blocked?520:(steps*300+specialMs+260);
      p.position=to;
      r.snakes.lastRoll=roll; r.snakes.moveSeq++; r.snakes.rolling=false; r.snakes.phase='moving';
      r.snakes.turnReadyAt=Date.now()+animationMs;
      r.snakes.lastMove={id:r.snakes.moveSeq,playerId:p.id,roll,from,to,raw,special,blocked,animationMs};
      emitRoom(r);

      const moveId=r.snakes.moveSeq;
      setTimeout(()=>{
        const still=rooms.get(r.code);
        if(!still||still!==r||r.snakes.lastMove?.id!==moveId) return;
        if(to===100){
          r.snakes.status='won'; r.snakes.winnerId=p.id; r.snakes.phase='finished'; r.snakes.turnReadyAt=0;
          emitRoom(r);
          io.to(r.code).emit('game:win',{game:'snakes',winnerId:p.id,moveId});
          return;
        }
        if(!(settings.extraTurnOnSix&&roll===6)) r.snakes.turnIndex=(r.snakes.turnIndex+1)%r.players.length;
        r.snakes.phase='idle'; r.snakes.turnReadyAt=Date.now();
        emitRoom(r);
        io.to(r.code).emit('snakes:turn-ready',{playerId:r.players[r.snakes.turnIndex]?.id||null});
      },animationMs);
    },1120);
  });

  socket.on('ttt:move',(payload={},ack=()=>{})=>{
    const r=roomOf(socket);if(!r)return ack({ok:false});if(r.players.length<2)return ack({ok:false,error:'Need 2 players.'});if(['won','draw'].includes(r.ttt.status))return ack({ok:false,error:'Round finished.'});
    const active=r.players.slice(0,2),idx=active.findIndex(p=>p.id===socket.id);if(idx<0)return ack({ok:false,error:'Spectating.'});if(idx!==r.ttt.turnIndex)return ack({ok:false,error:'Not your turn.'});
    const cell=Math.round(Number(payload.cell));if(cell<0||cell>8||r.ttt.board[cell])return ack({ok:false,error:'Invalid square.'});r.ttt.status='playing';r.ttt.board[cell]=idx===0?'X':'O';
    const line=tttWinner(r.ttt.board);if(line){r.ttt.status='won';r.ttt.winnerId=socket.id;r.ttt.winLine=line;}else if(r.ttt.board.every(Boolean)){r.ttt.status='draw';}else r.ttt.turnIndex=1-r.ttt.turnIndex;
    emitRoom(r);ack({ok:true});if(line)io.to(r.code).emit('game:win',{game:'tictactoe',winnerId:socket.id});
  });
  socket.on('ttt:restart',(_,ack=()=>{})=>{
    const r=roomOf(socket);if(!r)return ack({ok:false});if(r.hostId!==socket.id)return ack({ok:false,error:'Host only.'});r.ttt={status:'ready',board:Array(9).fill(null),turnIndex:0,winnerId:null,round:(r.ttt.round||1)+1};emitRoom(r);ack({ok:true});
  });

  socket.on('wordsearch:new',(_,ack=()=>{})=>{
    const r=roomOf(socket);if(!r)return ack({ok:false});if(r.hostId!==socket.id)return ack({ok:false,error:'Host only.'});
    const next=makeWordSearch();next.round=(r.wordsearch?.round||0)+1;r.wordsearch=next;emitRoom(r);ack({ok:true});
  });
  socket.on('wordsearch:select',(payload={},ack=()=>{})=>{
    const r=roomOf(socket);if(!r)return ack({ok:false});if(r.players.length<2)return ack({ok:false,error:'Need 2 players.'});const w=r.wordsearch;if(w.status==='won')return ack({ok:false,error:'Round finished.'});
    const idx=r.players.findIndex(p=>p.id===socket.id);if(idx<0)return ack({ok:false});if(idx!==w.turnIndex)return ack({ok:false,error:'Not your turn.'});
    const pathSel=normalizeSelection(payload.start,payload.end,w.size);if(!pathSel)return ack({ok:false,error:'Pick a straight line.'});
    const answer=w.answers.find(a=>samePath(pathSel,a.path)||samePath([...pathSel].reverse(),a.path));
    if(!answer)return ack({ok:false,error:'That is not one of the words.'});if(w.found.some(f=>f.word===answer.word))return ack({ok:false,error:'Already found.'});
    w.found.push({word:answer.word,playerId:socket.id,path:answer.path});
    const scoreCount=id=>w.found.filter(f=>f.playerId===id).length;
    if(w.found.length===w.words.length){
      w.status='won';let best=-1,winner=null;for(const p of r.players){const s=scoreCount(p.id);if(s>best){best=s;winner=p.id}else if(s===best)winner=null;}w.winnerId=winner;
    } else { w.turnIndex=(w.turnIndex+1)%r.players.length; }
    emitRoom(r);io.to(r.code).emit('wordsearch:found',{word:answer.word,playerId:socket.id});ack({ok:true,word:answer.word});
    if(w.status==='won')io.to(r.code).emit('game:win',{game:'wordsearch',winnerId:w.winnerId,draw:!w.winnerId});
  });

  socket.on('sticker:send',(payload={},ack=()=>{})=>{
    const r=roomOf(socket);if(!r)return ack({ok:false});const now=Date.now(),last=socket.data.lastSticker||0;if(now-last<settings.stickerCooldownMs)return ack({ok:false,error:'Too fast.'});
    const st=stickers.find(s=>s.id===payload.id&&s.enabled);if(!st)return ack({ok:false,error:'Sticker unavailable.'});socket.data.lastSticker=now;io.to(r.code).emit('sticker:pop',{id:st.id,name:st.name,url:st.url,from:socket.data.playerName||'Player',ms:settings.stickerPopupMs});ack({ok:true});
  });

  socket.on('rtc:signal',(payload={})=>{const r=roomOf(socket);if(!r)return;const target=io.sockets.sockets.get(payload.to);if(target&&target.data.roomCode===r.code)target.emit('rtc:signal',{from:socket.id,data:payload.data});});
  socket.on('disconnect',()=>leaveRoom(socket));
});

server.listen(PORT,()=>console.log(`PlayVerse v5 running on ${PORT}`));
