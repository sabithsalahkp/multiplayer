const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cookie = require('cookie');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { Server } = require('socket.io');
const store = require('./lib/store');
const razorpay = require('./lib/razorpay-service');
const {
  SESSION_COOKIE,
  normalizeEmail,
  validEmail,
  cleanDisplayName,
  hashToken,
  newSession,
  subscriptionInfo,
  publicUser,
  safeEqualHex
} = require('./lib/security');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  connectionStateRecovery: { maxDisconnectionDuration: 120_000, skipMiddlewares: false },
  pingInterval: 20_000,
  pingTimeout: 25_000
});
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const VERSION = '10.0.0';
const PLAN_AMOUNT = 4_900;
const PLAN_CURRENCY = 'INR';
const PLAN_DAYS = 30;
const RECONNECT_GRACE_MS = 120_000;
const isProduction = process.env.NODE_ENV === 'production';
const business = {
  name: String(process.env.PUBLIC_BUSINESS_NAME || 'Quartz Web Solutions').trim(),
  supportEmail: String(process.env.PUBLIC_SUPPORT_EMAIL || 'replace-before-live@example.com').trim(),
  supportPhone: String(process.env.PUBLIC_SUPPORT_PHONE || '+91 00000 00000').trim(),
  address: String(process.env.PUBLIC_BUSINESS_ADDRESS || 'Malappuram, Kerala, India').trim()
};

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
const disconnectTimers = new Map();
const WORD_TURN_MS = 60_000;

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
function lobbyRooms(){ return []; }
function broadcastLobby(){ /* Private room codes are never broadcast. */ }

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
  return { status:'playing', seed, size, grid:grid.flat(), words:words.map(w=>w.word), answers:words, found:[], turnIndex:0, winnerId:null, round:1, turnStartedAt:0, turnDeadline:0, lastTimeoutPlayerId:null };
}

function initRoom(c, host, ownerUserId){
  return {
    code:c, hostId:host.id, ownerUserId, activeGame:'snakes', players:[host],
    snakes:{status:'lobby',turnIndex:0,winnerId:null,lastRoll:null,lastMove:null,moveSeq:0,rolling:false,phase:'idle',turnReadyAt:0},
    ttt:{status:'ready',board:Array(9).fill(null),turnIndex:0,winnerId:null,round:1},
    wordsearch:makeWordSearch(), createdAt:Date.now()
  };
}
function pubWordSearch(w){
  return { status:w.status, seed:w.seed, size:w.size, grid:w.grid, words:w.words, found:w.found, turnIndex:w.turnIndex, winnerId:w.winnerId, round:w.round, turnStartedAt:w.turnStartedAt||0, turnDeadline:w.turnDeadline||0, turnDurationMs:WORD_TURN_MS, lastTimeoutPlayerId:w.lastTimeoutPlayerId||null };
}
function stopWordTurn(r){
  if(r?.wordTimer){ clearTimeout(r.wordTimer); r.wordTimer=null; }
  if(r?.wordsearch){ r.wordsearch.turnStartedAt=0; r.wordsearch.turnDeadline=0; }
}
function beginWordTurn(r){
  if(!r?.wordsearch) return;
  if(r.wordTimer){ clearTimeout(r.wordTimer); r.wordTimer=null; }
  const w=r.wordsearch;
  if(r.activeGame!=='wordsearch'||w.status==='won'||r.players.length<2){ w.turnStartedAt=0; w.turnDeadline=0; return; }
  w.turnIndex=((w.turnIndex%r.players.length)+r.players.length)%r.players.length;
  const player=r.players[w.turnIndex];
  if(!player){ w.turnStartedAt=0; w.turnDeadline=0; return; }
  w.turnStartedAt=Date.now(); w.turnDeadline=w.turnStartedAt+WORD_TURN_MS; w.lastTimeoutPlayerId=null;
  const expectedPlayerId=player.id, expectedDeadline=w.turnDeadline;
  r.wordTimer=setTimeout(()=>{
    const live=rooms.get(r.code);
    if(!live||live!==r||live.activeGame!=='wordsearch') return;
    const ww=live.wordsearch, current=live.players[ww.turnIndex];
    if(ww.status==='won'||ww.turnDeadline!==expectedDeadline||current?.id!==expectedPlayerId) return;
    ww.lastTimeoutPlayerId=expectedPlayerId;
    const timedOutName=current?.name||'Player';
    ww.turnIndex=(ww.turnIndex+1)%live.players.length;
    beginWordTurn(live);
    emitRoom(live);
    io.to(live.code).emit('wordsearch:timeout',{playerId:expectedPlayerId,name:timedOutName,nextPlayerId:live.players[ww.turnIndex]?.id||null});
  }, WORD_TURN_MS+80);
}

function pubRoom(r){
  return {
    code:r.code, hostId:r.hostId, activeGame:r.activeGame, path:GAME_PATHS[r.activeGame], settings:publicSettings(),
    players:r.players.map(p=>({id:p.id,name:p.name,colorIndex:p.colorIndex,position:p.position,connected:p.connected!==false})),
    snakes:{...r.snakes}, ttt:{...r.ttt,board:[...r.ttt.board]}, wordsearch:pubWordSearch(r.wordsearch)
  };
}
function disconnectKey(roomCode, reconnectToken){ return `${roomCode}:${reconnectToken}`; }
function clearDisconnectTimer(roomCode, reconnectToken){
  const key=disconnectKey(roomCode,reconnectToken),timer=disconnectTimers.get(key);
  if(timer)clearTimeout(timer);disconnectTimers.delete(key);
}
function closeRoom(r,message='The host ended this room.'){
  if(!r||!rooms.has(r.code))return;
  stopWordTurn(r);
  for(const p of r.players)clearDisconnectTimer(r.code,p.reconnectToken);
  io.to(r.code).emit('room:closed',{message});
  rooms.delete(r.code);
}
function remapPlayerId(r,oldId,newId){
  if(oldId===newId)return;
  if(r.hostId===oldId)r.hostId=newId;
  if(r.snakes.winnerId===oldId)r.snakes.winnerId=newId;
  if(r.snakes.lastMove?.playerId===oldId)r.snakes.lastMove.playerId=newId;
  if(r.ttt.winnerId===oldId)r.ttt.winnerId=newId;
  if(r.wordsearch.winnerId===oldId)r.wordsearch.winnerId=newId;
  if(r.wordsearch.lastTimeoutPlayerId===oldId)r.wordsearch.lastTimeoutPlayerId=newId;
  for(const found of r.wordsearch.found)if(found.playerId===oldId)found.playerId=newId;
}
function removePlayer(r,idx,reason='left'){
  if(!r||idx<0||idx>=r.players.length)return;
  const affectedTttPlayer=idx<2,[gone]=r.players.splice(idx,1);
  clearDisconnectTimer(r.code,gone.reconnectToken);
  io.to(r.code).emit('rtc:peer-left',{peerId:gone.id});
  if(gone.id===r.hostId){closeRoom(r,reason==='timeout'?'The host did not reconnect in time.':'The host ended this room.');return;}
  if(!r.players.length){closeRoom(r,'Room ended.');return;}
  r.snakes.turnIndex=Math.min(r.snakes.turnIndex,Math.max(0,r.players.length-1));
  if(affectedTttPlayer){r.ttt={status:'ready',board:Array(9).fill(null),turnIndex:0,winnerId:null,round:(r.ttt.round||1)+1};}
  else r.ttt.turnIndex=Math.min(r.ttt.turnIndex,Math.min(1,Math.max(0,r.players.length-1)));
  r.wordsearch.turnIndex=Math.min(r.wordsearch.turnIndex,Math.max(0,r.players.length-1));
  if(r.snakes.status==='playing'&&r.players.length<settings.minPlayers){
    r.snakes.status='lobby';r.snakes.phase='idle';r.snakes.rolling=false;r.snakes.winnerId=null;r.snakes.lastMove=null;r.snakes.lastRoll=null;r.snakes.moveSeq++;r.snakes.turnReadyAt=0;r.snakes.turnIndex=0;
  }
  if(r.activeGame==='wordsearch')beginWordTurn(r);
  notice(r,`${gone.name} ${reason==='timeout'?'lost connection':'left'}.`);emitRoom(r);
}
function leaveRoom(socket){
  const r=roomOf(socket); if(!r) return;
  const idx=r.players.findIndex(p=>p.id===socket.id); if(idx<0) return;
  socket.leave(r.code);socket.data.roomCode=null;removePlayer(r,idx,'left');
}
function scheduleDisconnect(socket){
  if(socket.data.suppressDisconnect)return;
  const r=roomOf(socket);if(!r)return;
  const p=r.players.find(player=>player.id===socket.id);if(!p)return;
  p.connected=false;p.disconnectedAt=Date.now();
  io.to(r.code).emit('rtc:peer-left',{peerId:socket.id});emitRoom(r);
  clearDisconnectTimer(r.code,p.reconnectToken);
  const key=disconnectKey(r.code,p.reconnectToken);
  disconnectTimers.set(key,setTimeout(()=>{
    disconnectTimers.delete(key);
    const live=rooms.get(r.code);if(!live)return;
    const idx=live.players.findIndex(player=>player.reconnectToken===p.reconnectToken&&player.connected===false);
    if(idx>=0)removePlayer(live,idx,'timeout');
  },RECONNECT_GRACE_MS));
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

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      mediaSrc: ["'self'", 'blob:', 'https:'],
      connectSrc: ["'self'", 'https://api.razorpay.com', 'https://*.razorpay.com', 'wss:'],
      frameSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com', 'https://*.razorpay.com'],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"]
    }
  }
}));
app.use((_req,res,next)=>{res.setHeader('Permissions-Policy','microphone=(self), camera=(), geolocation=()');next();});

function sessionTokenFromRequest(req) {
  try { return cookie.parse(req.headers.cookie || '')[SESSION_COOKIE] || ''; }
  catch { return ''; }
}
function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}
function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' });
}
function requireUser(req,res,next){
  if(!req.user)return res.status(401).json({ok:false,error:'Sign in to continue.'});next();
}
function requireSameOrigin(req,res,next){
  const origin=req.get('origin');
  if(!origin)return next();
  const expected=`${req.protocol}://${req.get('host')}`;
  if(origin!==expected)return res.status(403).json({ok:false,error:'Request origin was rejected.'});
  next();
}
function requireAdmin(req,res,next){
  const expected=String(process.env.ADMIN_TOKEN||'');
  if(!expected)return res.status(404).json({ok:false,error:'Admin is disabled.'});
  const auth=req.get('authorization')||'',supplied=req.get('x-admin-token')||(auth.startsWith('Bearer ')?auth.slice(7):'');
  if(!safeEqualHex(expected,supplied))return res.status(401).json({ok:false,error:'Admin authentication required.'});
  next();
}

app.post('/api/payments/webhook',express.raw({type:'application/json',limit:'256kb'}),async(req,res)=>{
  try{
    const signature=req.get('x-razorpay-signature')||'';
    if(!razorpay.verifyWebhookSignature(req.body,signature))return res.status(400).json({ok:false});
    const event=JSON.parse(req.body.toString('utf8'));
    const paymentEntity=event?.payload?.payment?.entity;
    const orderEntity=event?.payload?.order?.entity;
    const orderId=paymentEntity?.order_id||orderEntity?.id;
    if(!orderId)return res.json({ok:true,ignored:true});
    const local=await store.getPaymentByOrderId(orderId);
    if(!local)return res.json({ok:true,ignored:true});

    if(event.event==='payment.failed'){
      await store.markPaymentFailed(orderId);return res.json({ok:true});
    }
    if(!['payment.captured','order.paid'].includes(event.event))return res.json({ok:true,ignored:true});
    const amount=Number(paymentEntity?.amount??orderEntity?.amount_paid);
    const currency=String(paymentEntity?.currency||orderEntity?.currency||'');
    const paymentId=String(paymentEntity?.id||'');
    if(!paymentId||amount!==local.amount||currency!==local.currency)return res.status(400).json({ok:false});
    await store.activateSubscription({orderId,paymentId});
    res.json({ok:true});
  }catch(error){console.error('[webhook]',error);res.status(500).json({ok:false});}
});

app.use(express.json({limit:'1mb'}));
app.use(async(req,res,next)=>{
  try{
    const token=sessionTokenFromRequest(req);req.sessionToken=token;req.sessionTokenHash=token?hashToken(token):'';
    req.user=token?await store.getUserBySession(req.sessionTokenHash):null;next();
  }catch(error){next(error);}
});
app.use('/api',requireSameOrigin);

const authLimiter=rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,message:{ok:false,error:'Too many attempts. Try again later.'}});
const paymentLimiter=rateLimit({windowMs:10*60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,message:{ok:false,error:'Too many payment attempts. Try again later.'}});

app.get('/api/auth/me',(req,res)=>res.json({ok:true,user:publicUser(req.user)}));
app.post('/api/auth/register',authLimiter,async(req,res)=>{
  try{
    const email=normalizeEmail(req.body?.email),password=String(req.body?.password||''),displayName=cleanDisplayName(req.body?.displayName);
    if(req.body?.acceptLegal!==true)return res.status(400).json({ok:false,error:'Accept the Terms and Privacy Policy.'});
    if(!validEmail(email))return res.status(400).json({ok:false,error:'Enter a valid email address.'});
    if(password.length<8||password.length>128)return res.status(400).json({ok:false,error:'Password must be 8–128 characters.'});
    if(displayName.length<2)return res.status(400).json({ok:false,error:'Enter your display name.'});
    const passwordHash=await bcrypt.hash(password,12),user=await store.createUser({email,passwordHash,displayName});
    const session=newSession();await store.createSession({tokenHash:session.tokenHash,userId:user.id,expiresAt:session.expiresAt});setSessionCookie(res,session.token);
    res.status(201).json({ok:true,user:publicUser(user)});
  }catch(error){
    if(error.code==='23505')return res.status(409).json({ok:false,error:'An account with this email already exists.'});
    console.error('[register]',error);res.status(500).json({ok:false,error:'Could not create the account.'});
  }
});
app.post('/api/auth/login',authLimiter,async(req,res)=>{
  try{
    const email=normalizeEmail(req.body?.email),password=String(req.body?.password||''),user=await store.getUserByEmail(email);
    if(!user||!(await bcrypt.compare(password,user.passwordHash)))return res.status(401).json({ok:false,error:'Email or password is incorrect.'});
    const session=newSession();await store.createSession({tokenHash:session.tokenHash,userId:user.id,expiresAt:session.expiresAt});setSessionCookie(res,session.token);
    res.json({ok:true,user:publicUser(user)});
  }catch(error){console.error('[login]',error);res.status(500).json({ok:false,error:'Could not sign in.'});}
});
app.post('/api/auth/logout',requireUser,async(req,res)=>{await store.deleteSession(req.sessionTokenHash);clearSessionCookie(res);res.json({ok:true});});
app.delete('/api/auth/account',authLimiter,requireUser,async(req,res)=>{
  const password=String(req.body?.password||'');
  if(!(await bcrypt.compare(password,req.user.passwordHash)))return res.status(401).json({ok:false,error:'Password is incorrect.'});
  for(const room of [...rooms.values()])if(room.ownerUserId===req.user.id)closeRoom(room,'The host account was deleted.');
  await store.deleteUser(req.user.id);clearSessionCookie(res);res.json({ok:true});
});

app.post('/api/payments/order',paymentLimiter,requireUser,async(req,res)=>{
  try{
    if(!store.isPersistent())return res.status(503).json({ok:false,error:'Payments stay disabled until a persistent database is connected.'});
    if(!razorpay.isConfigured())return res.status(503).json({ok:false,error:'Razorpay keys and webhook secret are not configured yet.'});
    const receipt=`pv_${Date.now().toString(36)}_${req.user.id.replace(/-/g,'').slice(0,8)}`;
    const order=await razorpay.createOrder({amount:PLAN_AMOUNT,currency:PLAN_CURRENCY,receipt,userId:req.user.id});
    await store.createPendingPayment({orderId:order.id,userId:req.user.id,amount:PLAN_AMOUNT,currency:PLAN_CURRENCY,receipt});
    res.status(201).json({ok:true,checkout:{key:razorpay.keyId,orderId:order.id,amount:PLAN_AMOUNT,currency:PLAN_CURRENCY,name:'PlayVerse',description:'30-day Host Pass',prefill:{email:req.user.email},theme:{color:'#7957ff'}}});
  }catch(error){console.error('[payment-order]',error);res.status(502).json({ok:false,error:'Could not start the payment. No money was charged.'});}
});
app.post('/api/payments/verify',paymentLimiter,requireUser,async(req,res)=>{
  try{
    const orderId=String(req.body?.razorpay_order_id||''),paymentId=String(req.body?.razorpay_payment_id||''),signature=String(req.body?.razorpay_signature||'');
    if(!/^order_[A-Za-z0-9]+$/.test(orderId)||!/^pay_[A-Za-z0-9]+$/.test(paymentId)||!/^[a-f0-9]{64}$/i.test(signature))return res.status(400).json({ok:false,error:'Invalid payment response.'});
    const local=await store.getPaymentByOrderId(orderId);
    if(!local||local.userId!==req.user.id)return res.status(404).json({ok:false,error:'Payment order was not found.'});
    if(!razorpay.verifyCheckoutSignature({orderId:local.orderId,paymentId,signature}))return res.status(400).json({ok:false,error:'Payment verification failed.'});
    const payment=await razorpay.fetchPayment(paymentId);
    if(payment.order_id!==local.orderId||Number(payment.amount)!==local.amount||payment.currency!==local.currency)return res.status(400).json({ok:false,error:'Payment details did not match the order.'});
    if(payment.status!=='captured')return res.status(202).json({ok:true,pending:true,message:'Payment received and awaiting capture. Access will activate automatically.'});
    const result=await store.activateSubscription({orderId:local.orderId,paymentId});
    res.json({ok:true,user:publicUser(result.user),alreadyActivated:result.alreadyActivated});
  }catch(error){console.error('[payment-verify]',error);res.status(502).json({ok:false,error:'Payment is being checked. Access will activate automatically after confirmation.'});}
});
app.get('/api/payments/status',requireUser,async(req,res)=>{
  const orderId=String(req.query.order_id||''),payment=await store.getPaymentByOrderId(orderId);
  if(!payment||payment.userId!==req.user.id)return res.status(404).json({ok:false,error:'Order not found.'});
  const user=await store.getUserById(req.user.id);res.json({ok:true,status:payment.status,user:publicUser(user)});
});

app.use(express.static(PUBLIC_DIR,{maxAge:isProduction?'1h':0,etag:true}));
app.get('/health',(_q,res)=>res.json({ok:true,version:VERSION,database:store.isPersistent()?'persistent':'temporary',payments:store.isPersistent()&&razorpay.isConfigured()?'ready':'setup-required'}));
app.get('/config',(_q,res)=>res.json({iceServers:[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}],settings:publicSettings(),reconnectGraceMs:RECONNECT_GRACE_MS}));
app.get('/api/public-config',(_q,res)=>res.json({ok:true,business,plan:{amount:PLAN_AMOUNT,currency:PLAN_CURRENCY,days:PLAN_DAYS,formatted:'₹49'},paymentReady:store.isPersistent()&&razorpay.isConfigured()}));
app.get('/api/stickers',(_q,res)=>res.json({ok:true,stickers:publicStickers()}));
app.get('/api/rooms',(_q,res)=>res.json({ok:true,rooms:[]}));
app.get('/admin',(_q,res)=>res.sendFile(path.join(PUBLIC_DIR,'admin.html')));
app.get(['/snakes','/tic-tac-toe','/word-search'],(_q,res)=>res.sendFile(path.join(PUBLIC_DIR,'index.html')));
for(const [route,file] of Object.entries({'/terms':'terms.html','/privacy':'privacy.html','/refund-policy':'refund-policy.html','/contact':'contact.html','/shipping-policy':'shipping-policy.html','/pricing':'pricing.html','/data-safety':'data-safety.html','/delete-account':'delete-account.html'}))app.get(route,(_q,res)=>res.sendFile(path.join(PUBLIC_DIR,file)));

app.get('/api/admin/dashboard',requireAdmin,(_q,res)=>res.json({ok:true,settings:publicSettings(),stickers,rooms:[...rooms.values()].map(r=>({code:r.code,game:r.activeGame,ownerUserId:r.ownerUserId,players:r.players.map(p=>({name:p.name,connected:p.connected!==false}))}))}));
app.put('/api/admin/settings',requireAdmin,(req,res)=>{
  const b=req.body||{};
  settings={...settings,maxPlayers:Math.round(clamp(b.maxPlayers,2,6)),minPlayers:Math.round(clamp(b.minPlayers,2,6)),exactRollToWin:!!b.exactRollToWin,extraTurnOnSix:!!b.extraTurnOnSix,stickerPopupMs:Math.round(clamp(b.stickerPopupMs,1000,6000)),stickerCooldownMs:Math.round(clamp(b.stickerCooldownMs,300,5000)),soundDefaultOn:b.soundDefaultOn!==false};
  if(settings.minPlayers>settings.maxPlayers)settings.minPlayers=settings.maxPlayers;
  io.emit('game:settings',publicSettings()); broadcastLobby(); res.json({ok:true,settings,persistent:false});
});
app.patch('/api/admin/stickers/:id',requireAdmin,(req,res)=>{
  const s=stickers.find(x=>x.id===req.params.id); if(!s)return res.status(404).json({ok:false});
  if(typeof req.body.name==='string')s.name=cleanName(req.body.name); if(typeof req.body.enabled==='boolean')s.enabled=req.body.enabled;
  io.emit('stickers:update',publicStickers()); res.json({ok:true,sticker:s,persistent:false});
});

io.use(async(socket,next)=>{
  try{
    const token=cookie.parse(socket.request.headers.cookie||'')[SESSION_COOKIE]||'';
    socket.data.user=token?await store.getUserBySession(hashToken(token)):null;next();
  }catch(error){next(error);}
});

io.on('connection',socket=>{
  socket.emit('game:settings',publicSettings());socket.emit('stickers:update',publicStickers());

  socket.on('room:create',async(payload={},ack=()=>{})=>{
    try{
      const user=socket.data.user?await store.getUserById(socket.data.user.id):null;
      if(!user)return ack({ok:false,error:'Sign in as a host first.',code:'AUTH_REQUIRED'});
      if(!subscriptionInfo(user).active)return ack({ok:false,error:'An active ₹49 Host Pass is required.',code:'SUBSCRIPTION_REQUIRED'});
      leaveRoom(socket);
      for(const existing of [...rooms.values()])if(existing.ownerUserId===user.id)closeRoom(existing,'The host created a new room.');
      const c=code(),reconnectToken=crypto.randomBytes(24).toString('base64url');
      const p={id:socket.id,reconnectToken,connected:true,name:cleanName(payload.name||user.displayName),colorIndex:0,position:1};
      const r=initRoom(c,p,user.id);rooms.set(c,r);socket.join(c);socket.data.roomCode=c;socket.data.playerName=p.name;socket.data.reconnectToken=reconnectToken;
      ack({ok:true,room:pubRoom(r),resumeToken:reconnectToken});emitRoom(r);
    }catch(e){console.error('[room-create]',e);ack({ok:false,error:'Could not create room.'});}
  });
  socket.on('room:join',(payload={},ack=()=>{})=>{
    const c=String(payload.roomId||payload.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6),r=rooms.get(c);
    if(!r)return ack({ok:false,error:'Room not found.'}); if(r.players.length>=settings.maxPlayers)return ack({ok:false,error:'Room is full.'});
    leaveRoom(socket);const reconnectToken=crypto.randomBytes(24).toString('base64url');
    const p={id:socket.id,reconnectToken,connected:true,name:cleanName(payload.name),colorIndex:r.players.length%6,position:1};r.players.push(p);
    socket.join(c);socket.data.roomCode=c;socket.data.playerName=p.name;socket.data.reconnectToken=reconnectToken;
    socket.emit('rtc:peers',{peers:r.players.filter(x=>x.id!==socket.id&&x.connected!==false).map(x=>x.id)});socket.to(c).emit('rtc:peer-joined',{peerId:socket.id});
    if(r.activeGame==='wordsearch'&&r.players.length>=2&&!r.wordsearch.turnDeadline) beginWordTurn(r);
    notice(r,`${p.name} joined.`);ack({ok:true,room:pubRoom(r),resumeToken:reconnectToken});emitRoom(r);
  });
  socket.on('room:resume',(payload={},ack=()=>{})=>{
    const c=String(payload.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6),token=String(payload.resumeToken||'').slice(0,80),r=rooms.get(c);
    if(!r||!token)return ack({ok:false,error:'Room session expired.'});
    const p=r.players.find(player=>player.reconnectToken===token);if(!p)return ack({ok:false,error:'Room session expired.'});
    clearDisconnectTimer(c,token);const oldId=p.id,oldSocket=io.sockets.sockets.get(oldId);
    if(oldSocket&&oldSocket.id!==socket.id){oldSocket.data.suppressDisconnect=true;oldSocket.disconnect(true);}
    remapPlayerId(r,oldId,socket.id);p.id=socket.id;p.connected=true;p.disconnectedAt=null;
    socket.join(c);socket.data.roomCode=c;socket.data.playerName=p.name;socket.data.reconnectToken=token;
    socket.emit('rtc:peers',{peers:r.players.filter(x=>x.id!==socket.id&&x.connected!==false).map(x=>x.id)});socket.to(c).emit('rtc:peer-joined',{peerId:socket.id});
    notice(r,`${p.name} reconnected.`);ack({ok:true,room:pubRoom(r),resumeToken:token});emitRoom(r);
  });
  socket.on('room:leave',()=>leaveRoom(socket));

  socket.on('game:select',(payload={},ack=()=>{})=>{
    const r=roomOf(socket); if(!r)return ack({ok:false,error:'No room.'}); const game=String(payload.game||'');
    if(!GAME_PATHS[game])return ack({ok:false,error:'Unknown game.'}); if(r.hostId!==socket.id)return ack({ok:false,error:'Only host can switch games.'});
    if(r.activeGame==='wordsearch'&&game!=='wordsearch') stopWordTurn(r);
    r.activeGame=game;
    if(game==='wordsearch') beginWordTurn(r);
    emitRoom(r); broadcastLobby(); io.to(r.code).emit('game:selected',{game,path:GAME_PATHS[game]}); ack({ok:true});
  });

  socket.on('snakes:start',(_,ack=()=>{})=>{
    const r=roomOf(socket); if(!r)return ack({ok:false}); if(r.hostId!==socket.id)return ack({ok:false,error:'Host only.'});
    if(r.players.length<settings.minPlayers)return ack({ok:false,error:`Need ${settings.minPlayers} players.`});
    r.players.forEach(p=>p.position=1); r.snakes={status:'playing',turnIndex:0,winnerId:null,lastRoll:null,lastMove:null,moveSeq:r.snakes.moveSeq+1,rolling:false,phase:'idle',turnReadyAt:Date.now()}; emitRoom(r); broadcastLobby(); ack({ok:true});
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
    io.to(r.code).emit('snakes:dice-roll',{playerId:p.id,roll,duration:1350});
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
        const liveIdx=r.players.findIndex(x=>x.id===p.id);
        if(liveIdx<0){
          r.snakes.phase='idle'; r.snakes.rolling=false; r.snakes.turnReadyAt=Date.now();
          r.snakes.turnIndex=Math.min(r.snakes.turnIndex,Math.max(0,r.players.length-1));
          emitRoom(r);
          io.to(r.code).emit('snakes:turn-ready',{playerId:r.players[r.snakes.turnIndex]?.id||null});
          return;
        }
        if(to===100){
          r.snakes.status='won'; r.snakes.winnerId=p.id; r.snakes.phase='finished'; r.snakes.turnReadyAt=0;
          emitRoom(r); broadcastLobby();
          io.to(r.code).emit('game:win',{game:'snakes',winnerId:p.id,moveId});
          return;
        }
        if(!(settings.extraTurnOnSix&&roll===6)) r.snakes.turnIndex=(liveIdx+1)%r.players.length;
        else r.snakes.turnIndex=liveIdx;
        r.snakes.phase='idle'; r.snakes.turnReadyAt=Date.now();
        emitRoom(r);
        io.to(r.code).emit('snakes:turn-ready',{playerId:r.players[r.snakes.turnIndex]?.id||null});
      },animationMs);
    },1370);
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
    const next=makeWordSearch();next.round=(r.wordsearch?.round||0)+1;r.wordsearch=next;if(r.activeGame==='wordsearch')beginWordTurn(r);emitRoom(r);ack({ok:true});
  });
  socket.on('wordsearch:select',(payload={},ack=()=>{})=>{
    const r=roomOf(socket);if(!r)return ack({ok:false});if(r.activeGame!=='wordsearch')return ack({ok:false,error:'Word Search is not the active game.'});if(r.players.length<2)return ack({ok:false,error:'Need 2 players.'});const w=r.wordsearch;if(w.status==='won')return ack({ok:false,error:'Round finished.'});if(w.turnDeadline&&Date.now()>w.turnDeadline)return ack({ok:false,error:'Time is up — turn is passing.'});
    const idx=r.players.findIndex(p=>p.id===socket.id);if(idx<0)return ack({ok:false});if(idx!==w.turnIndex)return ack({ok:false,error:'Not your turn.'});
    const pathSel=normalizeSelection(payload.start,payload.end,w.size);if(!pathSel)return ack({ok:false,error:'Pick a straight line.'});
    const answer=w.answers.find(a=>samePath(pathSel,a.path)||samePath([...pathSel].reverse(),a.path));
    if(!answer)return ack({ok:false,error:'That is not one of the words.'});if(w.found.some(f=>f.word===answer.word))return ack({ok:false,error:'Already found.'});
    w.found.push({word:answer.word,playerId:socket.id,path:answer.path});
    const scoreCount=id=>w.found.filter(f=>f.playerId===id).length;
    if(w.found.length===w.words.length){
      w.status='won';let best=-1,winner=null;for(const p of r.players){const s=scoreCount(p.id);if(s>best){best=s;winner=p.id}else if(s===best)winner=null;}w.winnerId=winner;
    } else { w.turnIndex=(w.turnIndex+1)%r.players.length; beginWordTurn(r); }
    if(w.status==='won') stopWordTurn(r);
    emitRoom(r);io.to(r.code).emit('wordsearch:found',{word:answer.word,playerId:socket.id});ack({ok:true,word:answer.word});
    if(w.status==='won')io.to(r.code).emit('game:win',{game:'wordsearch',winnerId:w.winnerId,draw:!w.winnerId});
  });

  socket.on('sticker:send',(payload={},ack=()=>{})=>{
    const r=roomOf(socket);if(!r)return ack({ok:false});const now=Date.now(),last=socket.data.lastSticker||0;if(now-last<settings.stickerCooldownMs)return ack({ok:false,error:'Too fast.'});
    const st=stickers.find(s=>s.id===payload.id&&s.enabled);if(!st)return ack({ok:false,error:'Sticker unavailable.'});socket.data.lastSticker=now;io.to(r.code).emit('sticker:pop',{id:st.id,name:st.name,url:st.url,from:socket.data.playerName||'Player',ms:settings.stickerPopupMs});ack({ok:true});
  });

  socket.on('rtc:signal',(payload={})=>{const r=roomOf(socket);if(!r)return;const target=io.sockets.sockets.get(payload.to);if(target&&target.data.roomCode===r.code)target.emit('rtc:signal',{from:socket.id,data:payload.data});});
  socket.on('disconnect',()=>scheduleDisconnect(socket));
});

app.use((error,_req,res,_next)=>{
  console.error('[request]',error);
  if(res.headersSent)return;
  res.status(500).json({ok:false,error:'Something went wrong. Please try again.'});
});

async function start(){
  await store.init();
  return new Promise(resolve=>server.listen(PORT,()=>{console.log(`PlayVerse v${VERSION} running on ${PORT}`);resolve(server);}));
}

async function shutdown(){
  for(const room of [...rooms.values()])closeRoom(room,'Server is restarting. Reconnect shortly.');
  io.disconnectSockets(true);
  await new Promise(resolve=>server.close(resolve));
  await store.close();
}

if(require.main===module){
  start().catch(error=>{console.error('[startup]',error);process.exitCode=1;});
  process.once('SIGTERM',()=>shutdown().finally(()=>process.exit(0)));
  process.once('SIGINT',()=>shutdown().finally(()=>process.exit(0)));
}

module.exports={app,server,start,shutdown,rooms};
