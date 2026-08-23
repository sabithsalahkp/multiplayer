const socket = io({ transports:['websocket','polling'] });
const $ = id => document.getElementById(id);
const colors=['#ff3bbd','#34d9ff','#62ef8e','#ffd15c','#9a70ff','#ff735d'];
const gameViews={snakes:$('snakesView'),tictactoe:$('tttView'),wordsearch:$('wordView')};
let roomState=null, stickerList=[], appSettings={minPlayers:2,maxPlayers:6,exactRollToWin:true,extraTurnOnSix:false,stickerPopupMs:3000,stickerCooldownMs:900,soundDefaultOn:true};
let lastSnakesMove=0, animatingMove=false, visualPositions=new Map(), pendingSnakeWinner=null, wordSelectionStart=null, lastWordTickSecond=null;

// ---------- AUDIO ----------
let audioCtx=null, master=null, sfxOn=true, speakerOn=true;
function ensureAudio(){
  if(!audioCtx){
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    audioCtx=new AC();master=audioCtx.createGain();master.gain.value=.82;
    const comp=audioCtx.createDynamicsCompressor();comp.threshold.value=-14;comp.knee.value=16;comp.ratio.value=6;comp.attack.value=.002;comp.release.value=.18;
    master.connect(comp);comp.connect(audioCtx.destination);
  }
  if(audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});
}
function tone(freq=440,dur=.12,type='sine',gain=.2,delay=0,endFreq=null){
  if(!sfxOn)return;ensureAudio();if(!audioCtx||!master)return;const t=audioCtx.currentTime+delay,o=audioCtx.createOscillator(),g=audioCtx.createGain();
  o.type=type;o.frequency.setValueAtTime(freq,t);if(endFreq)o.frequency.exponentialRampToValueAtTime(Math.max(30,endFreq),t+dur);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.001,gain),t+.006);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g);g.connect(master);o.start(t);o.stop(t+dur+.03);
}
function noise(dur=.1,gain=.18,delay=0,freq=1800){
  if(!sfxOn)return;ensureAudio();if(!audioCtx||!master)return;const len=Math.ceil(audioCtx.sampleRate*dur),buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate),d=buf.getChannelData(0);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*(1-i/len);const src=audioCtx.createBufferSource(),f=audioCtx.createBiquadFilter(),g=audioCtx.createGain();src.buffer=buf;f.type='bandpass';f.frequency.value=freq;f.Q.value=.7;g.gain.value=gain;src.connect(f);f.connect(g);g.connect(master);src.start(audioCtx.currentTime+delay);
}
function sfx(name){
  if(!sfxOn)return;
  if(name==='dice'){for(let i=0;i<11;i++){noise(.045,.25,i*.075,900+i*105);tone(95+i*13,.05,'square',.08,i*.075)}tone(150,.18,'triangle',.32,.82,92);noise(.09,.32,.82,620)}
  if(name==='jump'){tone(260,.10,'triangle',.26,0,590);tone(160,.07,'sine',.20,.105,80);noise(.05,.22,.11,700)}
  if(name==='ladder'){for(let i=0;i<8;i++){tone(250+i*48,.075,'triangle',.2,i*.085);noise(.035,.12,i*.085,1500)}}
  if(name==='snake'){tone(430,.85,'sawtooth',.17,0,70);noise(.72,.17,0,880);tone(780,.16,'square',.10,.08,360);tone(920,.14,'square',.08,.32,420)}
  if(name==='sticker'){tone(570,.08,'square',.27);tone(980,.12,'triangle',.30,.06,1300);noise(.09,.23,.03,2800)}
  if(name==='turn'){tone(510,.10,'sine',.22);tone(780,.13,'sine',.2,.09)}
  if(name==='join'){tone(330,.08,'triangle',.19);tone(520,.1,'triangle',.19,.07);tone(760,.13,'triangle',.18,.14)}
  if(name==='mark'){tone(320,.07,'square',.16);tone(610,.11,'triangle',.19,.05)}
  if(name==='word'){tone(420,.08,'triangle',.21);tone(660,.10,'triangle',.23,.07);tone(940,.16,'sine',.2,.15)}
  if(name==='wrong'){tone(180,.12,'sawtooth',.12,0,115)}
  if(name==='win'){[523,659,784,1047,1318].forEach((f,i)=>tone(f,.5,'triangle',.28,i*.11));noise(.42,.14,.34,3200);tone(1568,.85,'sine',.19,.5,1047)}
}
document.addEventListener('pointerdown',ensureAudio,{once:true});

// ---------- ACCOUNT, PAYMENT AND PRIVATE ROOM ENTRY ----------
const landing=$('landing'),gameShell=$('gameShell'),createBtn=$('createBtn'),joinBtn=$('joinBtn'),landingError=$('landingError');
const guestNameInput=$('guestNameInput'),hostNameInput=$('hostNameInput'),roomCodeInput=$('roomCodeInput');
const playerCount=$('playerCount'),playersList=$('playersList'),gameNav=$('gameNav'),activeGameLabel=$('activeGameLabel'),toastStack=$('toastStack');
const RESUME_KEY='playverse_room_resume_v1',PENDING_ORDER_KEY='playverse_pending_order_v1';
let accountUser=null,authMode='login',resumeInFlight=false,publicConfig=null;
function toast(msg){const d=document.createElement('div');d.className='toast';d.textContent=msg;toastStack.appendChild(d);setTimeout(()=>d.remove(),3200)}
function ackEmit(event,payload={}){return new Promise(resolve=>socket.timeout(9000).emit(event,payload,(error,res)=>resolve(error?{ok:false,error:'Server did not respond. Try again.'}:res||{ok:false,error:'No response'})))}
function displayGameName(g){return {snakes:'Snakes & Ladders',tictactoe:'Tic Tac Toe',wordsearch:'Word Search'}[g]||g}
async function api(url,options={}){const response=await fetch(url,{...options,headers:{'content-type':'application/json',...(options.headers||{})},credentials:'same-origin'});let data={};try{data=await response.json()}catch{}if(!response.ok&&!data.error)data.error='Request failed.';return{response,data}}
function switchEntry(tab){
  const join=tab==='join';$('joinPanel').classList.toggle('hidden',!join);$('hostPanel').classList.toggle('hidden',join);$('joinTabBtn').classList.toggle('active',join);$('hostTabBtn').classList.toggle('active',!join);$('joinTabBtn').setAttribute('aria-selected',String(join));$('hostTabBtn').setAttribute('aria-selected',String(!join));landingError.textContent='';
}
$('joinTabBtn').addEventListener('click',()=>switchEntry('join'));$('hostTabBtn').addEventListener('click',()=>switchEntry('host'));
if(new URLSearchParams(location.search).get('mode')==='host')switchEntry('host');
function updateEntryButtons(){joinBtn.disabled=!socket.connected||guestNameInput.value.trim().length<1||roomCodeInput.value.length!==6;createBtn.disabled=!socket.connected||!accountUser?.subscription?.active||hostNameInput.value.trim().length<1}
function updateConn(ok){$('connectionText').textContent=ok?'Game server connected':'Connecting…';document.querySelector('.connection')?.classList.toggle('online',ok);$('reconnectBanner').classList.toggle('hidden',ok||!roomState);updateEntryButtons()}
function setAuthMode(mode){authMode=mode;const register=mode==='register';$('loginModeBtn').classList.toggle('active',!register);$('registerModeBtn').classList.toggle('active',register);$('displayNameRow').classList.toggle('hidden',!register);$('legalAcceptRow').classList.toggle('hidden',!register);$('authSubmitBtn').textContent=register?'Create Host Account':'Sign In';$('authPassword').autocomplete=register?'new-password':'current-password';$('authError').textContent=''}
$('loginModeBtn').addEventListener('click',()=>setAuthMode('login'));$('registerModeBtn').addEventListener('click',()=>setAuthMode('register'));
function formatDate(value){if(!value)return'';return new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',year:'numeric'}).format(new Date(value))}
function renderAccount(){
  $('authGate').classList.toggle('hidden',!!accountUser);$('hostAccount').classList.toggle('hidden',!accountUser);
  if(accountUser){
    $('accountEmail').textContent=accountUser.email;hostNameInput.value=hostNameInput.value||accountUser.displayName||'';
    const active=!!accountUser.subscription?.active,box=$('subscriptionStatus'),paymentReady=publicConfig?.paymentReady!==false;box.classList.toggle('active',active);$('planStatusText').textContent=active?'Host Pass active':'No active Host Pass';$('planExpiryText').textContent=active?`Valid until ${formatDate(accountUser.subscription.expiresAt)}`:'Subscribe to create a private room';$('subscribeBtn').disabled=!paymentReady;$('subscribeBtn').querySelector('span').textContent=!paymentReady?'Payment setup pending':active?'Extend Host Pass by 30 days':'Get 30-day Host Pass';$('subscribeBtn').querySelector('b').textContent=paymentReady?'Pay ₹49':'Unavailable';
  }
  updateEntryButtons();
}
async function loadMe(){try{const{data}=await api('/api/auth/me',{method:'GET',headers:{}});accountUser=data.user||null;renderAccount();return accountUser}catch{accountUser=null;renderAccount();return null}}
$('authForm').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('authSubmitBtn'),error=$('authError');button.disabled=true;error.textContent='';
  const payload={email:$('authEmail').value.trim(),password:$('authPassword').value};
  if(authMode==='register'){payload.displayName=$('authDisplayName').value.trim();payload.acceptLegal=$('legalAccept').checked;}
  try{const{data}=await api(`/api/auth/${authMode==='register'?'register':'login'}`,{method:'POST',body:JSON.stringify(payload)});if(!data.ok){error.textContent=data.error||'Could not continue.';return}accountUser=data.user;renderAccount();toast(authMode==='register'?'Account created.':'Signed in.');}
  catch{error.textContent='Could not connect. Try again.'}finally{button.disabled=false}
});
$('logoutBtn').addEventListener('click',async()=>{await api('/api/auth/logout',{method:'POST',body:'{}'});accountUser=null;renderAccount();setAuthMode('login');toast('Signed out.');});
function loadRazorpay(){if(window.Razorpay)return Promise.resolve();return new Promise((resolve,reject)=>{const existing=document.querySelector('script[data-razorpay]');if(existing){existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',reject,{once:true});return}const script=document.createElement('script');script.src='https://checkout.razorpay.com/v1/checkout.js';script.async=true;script.dataset.razorpay='true';script.onload=resolve;script.onerror=reject;document.head.appendChild(script)})}
async function pollPayment(orderId){
  for(let i=0;i<15;i++){await new Promise(r=>setTimeout(r,2000));const{data}=await api(`/api/payments/status?order_id=${encodeURIComponent(orderId)}`,{method:'GET',headers:{}});if(data.status==='paid'){sessionStorage.removeItem(PENDING_ORDER_KEY);accountUser=data.user;renderAccount();toast('Host Pass activated.');return true}}
  return false;
}
$('subscribeBtn').addEventListener('click',async()=>{
  const button=$('subscribeBtn');button.disabled=true;landingError.textContent='';
  try{
    const{data}=await api('/api/payments/order',{method:'POST',body:'{}'});if(!data.ok){landingError.textContent=data.error||'Could not start payment.';return}
    await loadRazorpay();sessionStorage.setItem(PENDING_ORDER_KEY,data.checkout.orderId);
    const checkout=new window.Razorpay({...data.checkout,modal:{ondismiss:()=>{button.disabled=false}},handler:async response=>{
      const result=await api('/api/payments/verify',{method:'POST',body:JSON.stringify(response)});if(result.data.user){accountUser=result.data.user;renderAccount();sessionStorage.removeItem(PENDING_ORDER_KEY);toast('Host Pass activated.');}else if(result.data.pending){toast(result.data.message);pollPayment(data.checkout.orderId);}else{landingError.textContent=result.data.error||'Payment verification is pending.'}button.disabled=false;
    }});
    checkout.on('payment.failed',event=>{landingError.textContent=event?.error?.description||'Payment failed. No pass was activated.';button.disabled=false});checkout.open();
  }catch{landingError.textContent='Could not open secure checkout. Try again.'}finally{if(!window.Razorpay)button.disabled=false}
});
function saveResume(code,resumeToken){localStorage.setItem(RESUME_KEY,JSON.stringify({code,resumeToken,savedAt:Date.now()}))}
function clearResume(){localStorage.removeItem(RESUME_KEY)}
function getResume(){try{const value=JSON.parse(localStorage.getItem(RESUME_KEY)||'null');return value?.code&&value?.resumeToken?value:null}catch{return null}}
async function tryResume(){
  if(resumeInFlight||roomState)return;const saved=getResume();if(!saved)return;resumeInFlight=true;
  const result=await ackEmit('room:resume',saved);resumeInFlight=false;
  if(result.ok)enterRoom(result.room,result.resumeToken,true);else clearResume();
}
joinBtn.addEventListener('click',async()=>{
  const name=guestNameInput.value.trim().slice(0,20),code=roomCodeInput.value.toUpperCase();if(!name)return guestNameInput.focus();if(code.length!==6)return roomCodeInput.focus();landingError.textContent='';joinBtn.disabled=true;
  const result=await ackEmit('room:join',{name,code});if(!result.ok){landingError.textContent=result.error||'Could not join room.';updateEntryButtons();return}enterRoom(result.room,result.resumeToken);
});
createBtn.addEventListener('click',async()=>{
  const name=hostNameInput.value.trim().slice(0,20);if(!name)return hostNameInput.focus();landingError.textContent='';createBtn.disabled=true;
  const result=await ackEmit('room:create',{name});if(!result.ok){landingError.textContent=result.error||'Could not create room.';if(result.code==='AUTH_REQUIRED'||result.code==='SUBSCRIPTION_REQUIRED')await loadMe();updateEntryButtons();return}enterRoom(result.room,result.resumeToken);
});
for(const input of [guestNameInput,hostNameInput])input.addEventListener('input',updateEntryButtons);roomCodeInput.addEventListener('input',()=>{roomCodeInput.value=roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);updateEntryButtons()});roomCodeInput.addEventListener('keydown',event=>{if(event.key==='Enter'&&!joinBtn.disabled)joinBtn.click()});
socket.on('connect',()=>{updateConn(true);tryResume()});socket.on('disconnect',()=>{updateConn(false);if(roomState)toast('Connection lost. Your place is saved while reconnecting.')});socket.on('connect_error',()=>updateConn(false));updateConn(socket.connected);
fetch('/config').then(r=>r.json()).then(d=>{appSettings={...appSettings,...(d.settings||{})};sfxOn=appSettings.soundDefaultOn!==false;renderAudioButtons()}).catch(()=>{});
fetch('/api/public-config').then(r=>r.json()).then(d=>{publicConfig=d;document.querySelectorAll('[data-business-name]').forEach(el=>el.textContent=d.business?.name||'Quartz Web Solutions');$('subscribeBtn').title=d.paymentReady?'':'Connect PostgreSQL and Razorpay server keys first.';renderAccount()}).catch(()=>{});
fetch('/api/stickers').then(r=>r.json()).then(d=>{stickerList=d.stickers||[];renderStickers()}).catch(()=>{});
socket.on('game:settings',s=>{appSettings={...appSettings,...s};renderPlayers();renderAudioButtons()});socket.on('stickers:update',s=>{stickerList=s||[];renderStickers()});socket.on('room:notice',msg=>toast(msg));
socket.on('room:closed',data=>{clearResume();roomState=null;toast(data?.message||'Room ended.');setTimeout(()=>{location.href='/'},900)});
$('leaveBtn').addEventListener('click',()=>{clearResume();socket.emit('room:leave');roomState=null;location.href='/'});
$('roomCodeBtn').addEventListener('click',async()=>{const code=roomState?.code;if(!code)return;try{await navigator.clipboard.writeText(code);toast('Room code copied.')}catch{const input=document.createElement('input');input.value=code;document.body.appendChild(input);input.select();document.execCommand('copy');input.remove();toast('Room code copied.')}});
function enterRoom(room,resumeToken,resumed=false){roomState=room;if(resumeToken)saveResume(room.code,resumeToken);$('roomCodeText').textContent=room.code;landing.classList.add('hidden');gameShell.classList.remove('hidden');$('reconnectBanner').classList.add('hidden');visualPositions.clear();room.players.forEach(p=>visualPositions.set(p.id,p.position||1));renderAll();if(!resumed)sfx('join');history.replaceState({},'',room.path||'/snakes')}
const pendingOrder=sessionStorage.getItem(PENDING_ORDER_KEY);loadMe().then(user=>{if(user&&pendingOrder)pollPayment(pendingOrder)});if(socket.connected)tryResume();

// ---------- INSTALLABLE PWA ----------
let deferredInstallPrompt=null;
const installButtons=[$('installLandingBtn'),$('installTopBtn')].filter(Boolean);
function showInstallButtons(show){installButtons.forEach(b=>b.classList.toggle('hidden',!show))}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;showInstallButtons(true)});
async function promptInstall(){
  if(!deferredInstallPrompt)return;
  deferredInstallPrompt.prompt();
  try{await deferredInstallPrompt.userChoice}catch{}
  deferredInstallPrompt=null;showInstallButtons(false);
}
installButtons.forEach(b=>b.addEventListener('click',promptInstall));
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;showInstallButtons(false);toast('PlayVerse installed')});
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js').catch(()=>{}))}

socket.on('room:state',state=>{
  const old=roomState;roomState=state;
  $('roomCodeText').textContent=state.code||'------';if(socket.connected)$('reconnectBanner').classList.add('hidden');
  for(const p of state.players)if(!visualPositions.has(p.id))visualPositions.set(p.id,p.position||1);
  for(const id of [...visualPositions.keys()])if(!state.players.some(p=>p.id===id))visualPositions.delete(id);
  if(old?.snakes?.status!=='playing'&&state.snakes.status==='playing'&&!state.snakes.lastMove){state.players.forEach(p=>visualPositions.set(p.id,p.position||1));}
  if(old&&old.activeGame!==state.activeGame){switchGameView(state.activeGame,true)}
  if(state.snakes?.lastMove?.id&&state.snakes.lastMove.id!==lastSnakesMove){lastSnakesMove=state.snakes.lastMove.id;animateSnakesMove(state.snakes.lastMove,state)}
  renderAll();
});
socket.on('game:selected',({game,path})=>{switchGameView(game,true);if(path&&location.pathname!==path)history.pushState({},'',path)});
function renderAll(){if(!roomState)return;renderPlayers();switchGameView(roomState.activeGame,false);renderSnakes();renderTTT();renderWordSearch()}
function renderPlayers(){
  if(!roomState)return;playerCount.textContent=`${roomState.players.length}/${roomState.settings?.maxPlayers||appSettings.maxPlayers}`;playersList.innerHTML='';
  const turnId=roomState.activeGame==='snakes'?roomState.players[roomState.snakes.turnIndex]?.id:roomState.activeGame==='tictactoe'?roomState.players[roomState.ttt.turnIndex]?.id:roomState.players[roomState.wordsearch.turnIndex]?.id;
  roomState.players.forEach(p=>{const row=document.createElement('div');row.className='player-row'+(p.id===turnId?' active':'')+(p.connected===false?' offline':'');const pawn=document.createElement('span');pawn.className='mini-pawn';pawn.style.setProperty('--piece',colors[p.colorIndex%colors.length]);const meta=document.createElement('div');meta.className='player-meta';const b=document.createElement('b');b.textContent=p.name;const sm=document.createElement('small');sm.textContent=p.connected===false?'Reconnecting…':p.id===roomState.hostId?'Host':'Ready';meta.append(b,sm);row.append(pawn,meta);if(p.id===socket.id){const y=document.createElement('span');y.className='you-badge';y.textContent='YOU';row.append(y)}playersList.appendChild(row)})
}
function switchGameView(game,push){Object.entries(gameViews).forEach(([g,v])=>v.classList.toggle('hidden',g!==game));[...gameNav.querySelectorAll('button')].forEach(b=>b.classList.toggle('active',b.dataset.game===game));activeGameLabel.textContent=displayGameName(game);if(push&&roomState?.path&&location.pathname!==roomState.path)history.pushState({},'',roomState.path)}
gameNav.addEventListener('click',async e=>{const b=e.target.closest('button[data-game]');if(!b||!roomState)return;if(socket.id!==roomState.hostId)return toast('Only the host can switch games.');const r=await ackEmit('game:select',{game:b.dataset.game});if(!r.ok)toast(r.error||'Could not switch game')});

// ---------- STICKERS ----------
function renderStickers(){const tray=$('stickerTray');tray.innerHTML='';stickerList.forEach(st=>{const b=document.createElement('button');b.className='sticker-btn';b.type='button';b.title=st.name;const im=document.createElement('img');im.src=st.url;im.alt=st.name;im.loading='lazy';const label=document.createElement('small');label.textContent=st.name;b.append(im,label);b.addEventListener('click',async()=>{ensureAudio();const r=await ackEmit('sticker:send',{id:st.id});if(!r.ok&&r.error!=='Too fast.')toast(r.error||'Could not send')});tray.appendChild(b)})}
let stickerTimer=null;socket.on('sticker:pop',data=>{const pop=$('stickerPopup');clearTimeout(stickerTimer);pop.querySelector('img').src=data.url;pop.querySelector('b').textContent=data.name;pop.querySelector('small').textContent=`${data.from} reacted`;pop.classList.remove('hidden');sfx('sticker');stickerTimer=setTimeout(()=>pop.classList.add('hidden'),data.ms||3000)});

// ---------- SNAKES & LADDERS ----------
const jumps={4:14,9:31,20:38,28:84,40:59,51:67,63:81,71:91,17:7,54:34,62:19,64:60,87:24,93:73,95:75,99:78};
const ladderPairs=Object.entries(jumps).filter(([a,b])=>Number(b)>Number(a)).map(([a,b])=>[Number(a),Number(b)]);
const snakePairs=Object.entries(jumps).filter(([a,b])=>Number(b)<Number(a)).map(([a,b])=>[Number(a),Number(b)]);
const boardCells=$('boardCells'),pathsLayer=$('pathsLayer'),piecesLayer=$('piecesLayer'),dice=$('dice'),rollBtn=$('rollBtn'),startSnakesBtn=$('startSnakesBtn'),turnText=$('turnText'),lastMoveText=$('lastMoveText'),snakesStatus=$('snakesStatus');
function cellCenter(n){const safe=Math.max(1,Math.min(100,Number(n)||1)),row=Math.floor((safe-1)/10),pos=(safe-1)%10,col=row%2===0?pos:9-pos;return{x:col*10+5,y:(9-row)*10+5}}
function svgEl(name,attrs={}){const el=document.createElementNS('http://www.w3.org/2000/svg',name);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,String(v));return el}
function curvedPath(a,b,bend=1){
  const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;
  const amp=Math.min(7.2,2.2+len*.055)*bend;
  const pts=[a];
  for(const t of [.16,.32,.48,.64,.80]){
    const wave=Math.sin(t*Math.PI*4.1)*amp*(1-t*.18);
    pts.push({x:a.x+dx*t+nx*wave,y:a.y+dy*t+ny*wave});
  }
  pts.push(b);
  let d=`M ${a.x} ${a.y}`;
  for(let i=1;i<pts.length-1;i++){
    const mid={x:(pts[i].x+pts[i+1].x)/2,y:(pts[i].y+pts[i+1].y)/2};
    d+=` Q ${pts[i].x} ${pts[i].y} ${mid.x} ${mid.y}`;
  }
  d+=` Q ${pts[pts.length-2].x} ${pts[pts.length-2].y} ${b.x} ${b.y}`;
  return{d,c1:pts[1],c2:pts[pts.length-2]};
}
function buildBoard(){
  if(!boardCells||!pathsLayer)return;
  boardCells.innerHTML='';
  for(let displayRow=9;displayRow>=0;displayRow--){
    const row=[];for(let i=1;i<=10;i++)row.push(displayRow*10+i);if(displayRow%2===1)row.reverse();
    row.forEach(n=>{const d=document.createElement('div');d.className='board-cell '+(((displayRow+n)%2)?'dark':'light');if(jumps[n])d.classList.add(jumps[n]>n?'ladder-start':'snake-start');d.dataset.cell=String(n);const sp=document.createElement('span');sp.textContent=n;d.appendChild(sp);boardCells.appendChild(d)});
  }
  drawPaths();
}
function drawPaths(){
  pathsLayer.innerHTML='';pathsLayer.setAttribute('viewBox','0 0 100 100');pathsLayer.setAttribute('preserveAspectRatio','none');
  const defs=svgEl('defs');
  const shadow=svgEl('filter',{id:'softShadow',x:'-30%',y:'-30%',width:'160%',height:'160%'});shadow.appendChild(svgEl('feDropShadow',{dx:'0',dy:'0.8',stdDeviation:'0.55','flood-color':'#1b1208','flood-opacity':'.36'}));defs.appendChild(shadow);
  const wood=svgEl('linearGradient',{id:'woodRail',x1:'0%',y1:'0%',x2:'100%',y2:'100%'});[['0%','#f0c17c'],['35%','#9c5b25'],['70%','#d08a3f'],['100%','#6f3d19']].forEach(([o,c])=>wood.appendChild(svgEl('stop',{offset:o,'stop-color':c})));defs.appendChild(wood);
  const palettes=[['#173f24','#61a844','#d8c85c'],['#4b1c40','#b64d78','#edc46f'],['#173f58','#42a0b9','#e0cf68'],['#64251a','#d76031','#e5cd69'],['#2a471d','#78b23e','#dac055'],['#3e225b','#9160b5','#dbc369']];
  snakePairs.forEach(([from,to],i)=>{const pal=palettes[i%palettes.length],g=svgEl('linearGradient',{id:`snakeGrad${i}`,x1:'0%',y1:'0%',x2:'100%',y2:'100%'});[['0%',pal[0]],['42%',pal[1]],['72%',pal[2]],['100%',pal[0]]].forEach(([o,c])=>g.appendChild(svgEl('stop',{offset:o,'stop-color':c})));defs.appendChild(g)});
  pathsLayer.appendChild(defs);
  ladderPairs.forEach(([from,to],i)=>drawLadder(cellCenter(from),cellCenter(to),i));
  snakePairs.forEach(([from,to],i)=>drawSnake(cellCenter(from),cellCenter(to),i));
}
function drawLadder(a,b,i){
  const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,ox=-dy/len*1.45,oy=dx/len*1.45,g=svgEl('g',{class:'ladder-group',filter:'url(#softShadow)'});
  [[ox,oy],[-ox,-oy]].forEach(([x,y])=>{g.appendChild(svgEl('line',{x1:a.x+x+.28,y1:a.y+y+.38,x2:b.x+x+.28,y2:b.y+y+.38,class:'ladder-shadow'}));const rail=svgEl('line',{x1:a.x+x,y1:a.y+y,x2:b.x+x,y2:b.y+y,class:'ladder-rail'});rail.style.stroke='url(#woodRail)';g.appendChild(rail);g.appendChild(svgEl('line',{x1:a.x+x-.2,y1:a.y+y-.16,x2:b.x+x-.2,y2:b.y+y-.16,class:'ladder-highlight'}))});
  let rung=0;for(let t=.08;t<.97;t+=.11){const cx=a.x+dx*t,cy=a.y+dy*t,r=svgEl('g',{class:'ladder-rung-group'});r.appendChild(svgEl('line',{x1:cx+ox,y1:cy+oy,x2:cx-ox,y2:cy-oy,class:'ladder-rung'}));r.appendChild(svgEl('line',{x1:cx+ox,y1:cy+oy-.14,x2:cx-ox,y2:cy-oy-.14,class:'ladder-rung-hi'}));g.appendChild(r);rung++}
  pathsLayer.appendChild(g);
}
function drawSnake(a,b,i){
  const bend=i%2===0?1:-1,curve=curvedPath(a,b,bend),g=svgEl('g',{class:'snake-group snake-v9',filter:'url(#softShadow)'}),width=2.9+(i%3)*.18;
  g.appendChild(svgEl('path',{d:curve.d,class:'snake-soft-shadow','stroke-width':width+.75}));
  const body=svgEl('path',{d:curve.d,class:'snake-body','stroke-width':width});body.style.stroke=`url(#snakeGrad${i})`;g.appendChild(body);
  g.appendChild(svgEl('path',{d:curve.d,class:'snake-highlight','stroke-width':.46}));
  g.appendChild(svgEl('path',{d:curve.d,class:'snake-scales','stroke-width':.22}));

  // The head faces away from the body, matching a classic board-game snake.
  const hx=a.x-curve.c1.x,hy=a.y-curve.c1.y,angle=Math.atan2(hy,hx)*180/Math.PI;
  const head=svgEl('g',{class:'snake-head-group',transform:`translate(${a.x} ${a.y}) rotate(${angle})`});
  head.appendChild(svgEl('ellipse',{cx:-.15,cy:0,rx:2.85,ry:1.95,class:'snake-head',fill:`url(#snakeGrad${i})`}));
  head.appendChild(svgEl('ellipse',{cx:1.1,cy:0,rx:1.65,ry:1.28,class:'snake-snout',fill:`url(#snakeGrad${i})`}));
  head.appendChild(svgEl('path',{d:'M -1.35 -1.0 Q .15 -1.75 1.65 -.92',class:'snake-head-shine'}));
  [[.95,-.72],[.95,.72]].forEach(([x,y])=>{head.appendChild(svgEl('circle',{cx:x,cy:y,r:.5,class:'snake-eye'}));head.appendChild(svgEl('circle',{cx:x+.2,cy:y,r:.2,class:'snake-pupil'}))});
  head.appendChild(svgEl('circle',{cx:2.05,cy:-.39,r:.12,class:'snake-nostril'}));
  head.appendChild(svgEl('circle',{cx:2.05,cy:.39,r:.12,class:'snake-nostril'}));
  head.appendChild(svgEl('path',{d:'M .65 1.12 Q 1.45 1.45 2.05 1.03',class:'snake-mouth'}));
  head.appendChild(svgEl('line',{x1:2.35,y1:0,x2:4.15,y2:0,class:'snake-tongue'}));
  head.appendChild(svgEl('line',{x1:3.72,y1:0,x2:4.55,y2:-.48,class:'snake-tongue'}));
  head.appendChild(svgEl('line',{x1:3.72,y1:0,x2:4.55,y2:.48,class:'snake-tongue'}));
  g.appendChild(head);

  const tx=b.x-curve.c2.x,ty=b.y-curve.c2.y,tang=Math.atan2(ty,tx)*180/Math.PI;
  const tail=svgEl('g',{transform:`translate(${b.x} ${b.y}) rotate(${tang})`});
  tail.appendChild(svgEl('path',{d:'M -1.45 -.82 Q .35 0 3.25 0 Q .35 0 -1.45 .82 Z',fill:`url(#snakeGrad${i})`,class:'snake-tail'}));
  g.appendChild(tail);pathsLayer.appendChild(g);
}
buildBoard();
function ensurePieces(){
  if(!roomState)return;for(const p of roomState.players){let el=piecesLayer.querySelector(`[data-player="${CSS.escape(p.id)}"]`);if(!el){el=document.createElement('div');el.className='piece';el.dataset.player=p.id;el.style.setProperty('--piece',colors[p.colorIndex%colors.length]);el.innerHTML='<i class="head"></i><i class="neck"></i><i class="body"></i><i class="base"></i>';piecesLayer.appendChild(el)}}for(const el of [...piecesLayer.children])if(!roomState.players.some(p=>p.id===el.dataset.player))el.remove();
}
function layoutPieces(){
  if(!roomState)return;ensurePieces();const groups=new Map();roomState.players.forEach(p=>{const pos=visualPositions.get(p.id)??p.position??1;if(!groups.has(pos))groups.set(pos,[]);groups.get(pos).push(p)});
  const offsets=[[0,0],[-2.0,-1.15],[2.0,-1.15],[-2.0,1.2],[2.0,1.2],[0,2.0]],currentId=roomState.players[roomState.snakes?.turnIndex]?.id;
  for(const[pos,players]of groups){const c=cellCenter(Number(pos));players.forEach((p,i)=>{const el=piecesLayer.querySelector(`[data-player="${CSS.escape(p.id)}"]`),o=offsets[i]||[0,0];if(el){el.style.left=(c.x+o[0])+'%';el.style.top=(c.y+o[1])+'%';el.style.zIndex=String(20+i);el.classList.toggle('current',roomState.activeGame==='snakes'&&roomState.snakes?.status==='playing'&&p.id===currentId)}})}
}
function setDiceFace(n){n=Math.max(1,Math.min(6,Number(n)||1));for(let i=1;i<=6;i++)dice.classList.remove(`show-${i}`);dice.classList.add(`show-${n}`);dice.setAttribute('aria-label',`Dice showing ${n}`)}
socket.on('snakes:dice-roll',({roll,duration=1350})=>{ensureAudio();sfx('dice');dice.classList.remove('landed');dice.classList.add('rolling');setTimeout(()=>{setDiceFace(roll);dice.classList.remove('rolling');dice.classList.add('landed');setTimeout(()=>dice.classList.remove('landed'),340)},duration)});
socket.on('snakes:turn-ready',({playerId})=>{if(playerId===socket.id){ensureAudio();sfx('turn')}});
function renderSnakes(){
  if(!roomState)return;layoutPieces();const s=roomState.snakes,phase=s.phase||(s.rolling?'rolling':'idle');
  const current=roomState.players[s.turnIndex],meTurn=s.status==='playing'&&phase==='idle'&&current?.id===socket.id;
  snakesStatus.textContent=s.status==='won'?'FINISHED':s.status==='playing'?(phase==='rolling'?'ROLLING':phase==='moving'?'MOVING':'LIVE'):'LOBBY';
  rollBtn.disabled=!meTurn||animatingMove;rollBtn.classList.toggle('ready',meTurn&&!animatingMove);
  const label=rollBtn.querySelector('span'),hint=rollBtn.querySelector('small');
  if(label)label.textContent=meTurn?'ROLL DICE':phase==='rolling'?'DICE ROLLING':phase==='moving'?'MOVE IN PROGRESS':'WAIT FOR TURN';
  if(hint)hint.textContent=meTurn?'Tap to roll your dice':phase==='moving'?'Next roll unlocks after the pawn stops':`${current?.name||'Player'} is playing`;
  turnText.textContent=s.status==='won'?'Round complete':s.status==='playing'?(phase==='rolling'?`${current?.name||'Player'} is rolling…`:phase==='moving'?`${current?.name||'Player'} is moving…`:meTurn?'Your turn — roll now':`${current?.name||'Player'}'s turn`):'Waiting to start';
  const hostCanStart=roomState.hostId===socket.id&&s.status!=='playing';startSnakesBtn.classList.toggle('hidden',!hostCanStart);startSnakesBtn.disabled=roomState.players.length<(roomState.settings?.minPlayers||2);startSnakesBtn.textContent=s.status==='won'?'PLAY AGAIN':'START GAME';
  if(s.lastRoll&&phase!=='rolling')setDiceFace(s.lastRoll);else if(!s.lastRoll&&!dice.classList.contains('rolling'))setDiceFace(1);
  const m=s.lastMove;if(m){const p=roomState.players.find(x=>x.id===m.playerId);lastMoveText.textContent=m.blocked?`${p?.name||'Player'} rolled ${m.roll} — exact roll needed.`:m.special?`${p?.name||'Player'} rolled ${m.roll} · ${m.special.type==='snake'?'snake slide':'ladder climb'}!`:`${p?.name||'Player'} rolled ${m.roll}.`}else lastMoveText.textContent=s.status==='playing'?'Game started. Roll when it is your turn.':'Host starts when everyone is ready.';
}
startSnakesBtn.addEventListener('click',async()=>{ensureAudio();const r=await ackEmit('snakes:start');if(!r.ok)toast(r.error||'Could not start')});rollBtn.addEventListener('click',async()=>{ensureAudio();if(animatingMove)return;rollBtn.disabled=true;const r=await ackEmit('snakes:roll');if(!r.ok){toast(r.error||'Could not roll');renderSnakes()}});
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function animateSnakesMove(m,state){
  animatingMove=true;const p=state.players.find(x=>x.id===m.playerId),el=piecesLayer.querySelector(`[data-player="${CSS.escape(m.playerId)}"]`);if(!p){animatingMove=false;return}visualPositions.set(p.id,m.from);layoutPieces();
  if(m.blocked){sfx('wrong');if(el){el.classList.remove('blocked');void el.offsetWidth;el.classList.add('blocked')}await sleep(520)}else{
    for(let pos=m.from+1;pos<=m.raw;pos++){visualPositions.set(p.id,pos);layoutPieces();if(el){el.classList.remove('jump');void el.offsetWidth;el.classList.add('jump')}sfx('jump');await sleep(300)}
    if(m.special){sfx(m.special.type);const from=cellCenter(m.special.from),to=cellCenter(m.special.to);if(el){const anim=el.animate([{left:from.x+'%',top:from.y+'%',transform:'translate(-50%,-82%) scale(1)'},{left:((from.x+to.x)/2)+'%',top:((from.y+to.y)/2-2)+'%',transform:'translate(-50%,-96%) scale(1.08)'},{left:to.x+'%',top:to.y+'%',transform:'translate(-50%,-82%) scale(1)'}],{duration:m.special.type==='ladder'?1050:1320,easing:m.special.type==='ladder'?'steps(7,end)':'cubic-bezier(.22,.7,.2,1)'});await anim.finished.catch(()=>{})}else await sleep(m.special.type==='ladder'?1050:1320);visualPositions.set(p.id,m.special.to);layoutPieces()}
  }
  visualPositions.set(p.id,m.to);layoutPieces();animatingMove=false;renderSnakes();if(pendingSnakeWinner&&pendingSnakeWinner.moveId===m.id){const d=pendingSnakeWinner;pendingSnakeWinner=null;await sleep(260);showWinner(state.players.find(x=>x.id===d.winnerId)?.name||'Player','Snakes & Ladders')}
}

// ---------- TIC TAC TOE ----------
const tttBoard=$('tttBoard'),tttStatus=$('tttStatus'),tttTurnText=$('tttTurnText'),tttRestartBtn=$('tttRestartBtn'),xName=$('xName'),oName=$('oName');
function buildTTT(){tttBoard.innerHTML='';for(let i=0;i<9;i++){const b=document.createElement('button');b.className='ttt-cell';b.dataset.cell=i;b.type='button';b.setAttribute('aria-label',`Square ${i+1}`);tttBoard.appendChild(b)}}buildTTT();
function renderTTT(){if(!roomState)return;const t=roomState.ttt,active=roomState.players.slice(0,2);xName.textContent=active[0]?.name||'Player 1';oName.textContent=active[1]?.name||'Player 2';tttStatus.textContent=t.status.toUpperCase();[...tttBoard.children].forEach((c,i)=>{const v=t.board[i]||'';if(c.textContent!==v){c.textContent=v;c.className='ttt-cell'+(v?' '+v.toLowerCase()+' pop':'')}c.classList.toggle('win',Array.isArray(t.winLine)&&t.winLine.includes(i))});if(active.length<2)tttTurnText.textContent='Waiting for 2 players.';else if(t.status==='won'){const w=roomState.players.find(p=>p.id===t.winnerId);tttTurnText.textContent=`${w?.name||'Player'} wins the round!`}else if(t.status==='draw')tttTurnText.textContent='Draw. Start another round.';else tttTurnText.textContent=`${active[t.turnIndex]?.id===socket.id?'Your':active[t.turnIndex]?.name+"'s"} turn · ${t.turnIndex===0?'X':'O'}`;tttRestartBtn.classList.toggle('hidden',!(roomState.hostId===socket.id&&['won','draw'].includes(t.status)))}
tttBoard.addEventListener('click',async e=>{const c=e.target.closest('.ttt-cell');if(!c||!roomState)return;ensureAudio();const r=await ackEmit('ttt:move',{cell:Number(c.dataset.cell)});if(r.ok)sfx('mark');else toast(r.error||'Invalid move')});tttRestartBtn.addEventListener('click',async()=>{const r=await ackEmit('ttt:restart');if(!r.ok)toast(r.error||'Could not restart')});

// ---------- WORD SEARCH ----------
const wordBoard=$('wordBoard'),wordList=$('wordList'),wordScores=$('wordScores'),wordTurnText=$('wordTurnText'),wordSelectionText=$('wordSelectionText'),wordStatus=$('wordStatus'),newWordsBtn=$('newWordsBtn'),wordTimerText=$('wordTimerText'),wordTimerBar=$('wordTimerBar');
function clientLine(start,end,size){start=Number(start);end=Number(end);const r0=Math.floor(start/size),c0=start%size,r1=Math.floor(end/size),c1=end%size,dr=Math.sign(r1-r0),dc=Math.sign(c1-c0),rr=Math.abs(r1-r0),cc=Math.abs(c1-c0);if(start===end)return[start];if(!(r0===r1||c0===c1||rr===cc))return null;const path=[];for(let i=0;i<Math.max(rr,cc)+1;i++)path.push((r0+dr*i)*size+(c0+dc*i));return path}
function updateWordTimer(){
  if(!roomState?.wordsearch||!wordTimerText||!wordTimerBar)return;
  const w=roomState.wordsearch,total=Math.max(1000,w.turnDurationMs||60000);
  if(roomState.activeGame!=='wordsearch'||roomState.players.length<2||w.status==='won'||!w.turnDeadline){wordTimerText.textContent='01:00';wordTimerBar.style.width='100%';wordTimerText.classList.remove('urgent');lastWordTickSecond=null;return;}
  const left=Math.max(0,w.turnDeadline-Date.now()),sec=Math.ceil(left/1000),pct=Math.max(0,Math.min(100,left/total*100));
  const mins=Math.floor(sec/60),secs=sec%60;wordTimerText.textContent=`${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;wordTimerBar.style.width=pct+'%';wordTimerText.classList.toggle('urgent',sec<=10);wordTimerBar.classList.toggle('urgent',sec<=10);
  const current=roomState.players[w.turnIndex];
  if(current?.id===socket.id&&sec<=10&&sec>0&&sec!==lastWordTickSecond){lastWordTickSecond=sec;if(sfxOn){tone(sec<=5?820:610,.055,'square',sec<=5?.16:.09)}}
}
setInterval(updateWordTimer,250);
function renderWordSearch(){
  if(!roomState)return;const w=roomState.wordsearch;if(!w)return;wordStatus.textContent=w.status==='won'?'FINISHED':'LIVE';const current=roomState.players[w.turnIndex],meTurn=w.status!=='won'&&roomState.players.length>=2&&current?.id===socket.id;if(!meTurn&&wordSelectionStart!==null)wordSelectionStart=null;wordTurnText.textContent=roomState.players.length<2?'Waiting for 2 players':w.status==='won'?'Round finished':meTurn?'Your turn':`${current?.name||'Player'}'s turn`;if(wordSelectionStart===null)wordSelectionText.textContent=meTurn?'Tap the first letter of a word.':'Wait for your turn.';
  if(wordBoard.dataset.seed!==String(w.seed)){wordBoard.dataset.seed=String(w.seed);wordBoard.innerHTML='';wordSelectionStart=null;w.grid.forEach((ch,i)=>{const b=document.createElement('button');b.className='word-cell';b.type='button';b.dataset.index=i;b.textContent=ch;b.setAttribute('aria-label',`Letter ${ch}`);wordBoard.appendChild(b)})}
  [...wordBoard.children].forEach(c=>{c.classList.remove('found','mine','start','preview');c.style.background='';c.style.borderColor=''});
  w.found.forEach(f=>{const p=roomState.players.find(x=>x.id===f.playerId),color=colors[p?.colorIndex%colors.length||0];for(const idx of f.path){const c=wordBoard.children[idx];if(c){c.classList.add(f.playerId===socket.id?'mine':'found');c.style.borderColor=color;c.style.background=`color-mix(in srgb, ${color} 26%, #14213a)`}}});
  if(wordSelectionStart!==null)wordBoard.children[wordSelectionStart]?.classList.add('start');
  wordList.innerHTML='';w.words.forEach(word=>{const d=document.createElement('div'),f=w.found.find(x=>x.word===word);d.className='word-chip'+(f?' found':'');d.textContent=word;wordList.appendChild(d)});
  wordScores.innerHTML='';roomState.players.forEach(p=>{const score=w.found.filter(f=>f.playerId===p.id).length,row=document.createElement('div');row.className='score-row';row.innerHTML=`<i class="score-dot" style="--score:${colors[p.colorIndex%colors.length]}"></i><b></b><span>${score}</span>`;row.querySelector('b').textContent=p.name;wordScores.appendChild(row)});
  newWordsBtn.classList.toggle('hidden',!(roomState.hostId===socket.id&&(w.status==='won'||roomState.players.length<2)));updateWordTimer();
}
wordBoard.addEventListener('click',async e=>{const c=e.target.closest('.word-cell');if(!c||!roomState)return;const w=roomState.wordsearch,current=roomState.players[w.turnIndex];if(roomState.players.length<2)return toast('Need 2 players.');if(w.status==='won')return toast('Round finished.');if(current?.id!==socket.id)return toast('Wait for your turn.');const idx=Number(c.dataset.index);ensureAudio();if(wordSelectionStart===null){wordSelectionStart=idx;wordSelectionText.textContent='Now tap the last letter.';renderWordSearch();return}const start=wordSelectionStart,line=clientLine(start,idx,w.size);if(!line){wordSelectionStart=idx;wordSelectionText.textContent='Straight lines only. New first letter selected.';sfx('wrong');renderWordSearch();return}for(const i of line)wordBoard.children[i]?.classList.add('preview');const r=await ackEmit('wordsearch:select',{start,end:idx});wordSelectionStart=null;if(!r.ok){sfx('wrong');wordSelectionText.textContent=r.error||'Not a word.';toast(r.error||'Not a word.');renderWordSearch()}else{sfx('word');wordSelectionText.textContent=`Found ${r.word}!`;confettiBurst(18)}});
newWordsBtn.addEventListener('click',async()=>{const r=await ackEmit('wordsearch:new');if(!r.ok)toast(r.error||'Could not make a new board');else{wordSelectionStart=null;sfx('join')}});socket.on('wordsearch:found',d=>{lastWordTickSecond=null;if(d.playerId!==socket.id){sfx('word');toast(`${roomState?.players.find(p=>p.id===d.playerId)?.name||'Player'} found ${d.word}`)}});socket.on('wordsearch:timeout',d=>{wordSelectionStart=null;lastWordTickSecond=null;sfx('wrong');toast(`${d.name||'Player'} ran out of time — turn passed.`);renderWordSearch()});

// ---------- WIN FX ----------
socket.on('game:win',d=>{if(d.game==='snakes'){pendingSnakeWinner=d;if(!animatingMove&&roomState?.snakes?.lastMove?.id===d.moveId){pendingSnakeWinner=null;setTimeout(()=>showWinner(roomState.players.find(x=>x.id===d.winnerId)?.name||'Player','Snakes & Ladders'),500)}return}setTimeout(()=>{if(d.draw)showWinner('DRAW','Word Search');else showWinner(roomState?.players.find(x=>x.id===d.winnerId)?.name||'Player',displayGameName(d.game))},500)});
function showWinner(name,game){$('winnerName').textContent=name;$('winnerGame').textContent=game;$('winnerModal').classList.remove('hidden');sfx('win');confettiBurst(90)}$('winnerCloseBtn').addEventListener('click',()=>$('winnerModal').classList.add('hidden'));
function confettiBurst(count){const layer=$('confettiLayer'),cols=['#ff3cbd','#6c5cff','#2ddcff','#ffd65c','#5cff92'];for(let i=0;i<count;i++){const d=document.createElement('i');d.className='confetti';d.style.left=Math.random()*100+'%';d.style.background=cols[i%cols.length];d.style.animationDuration=(1.6+Math.random()*2.2)+'s';d.style.animationDelay=(Math.random()*.35)+'s';layer.appendChild(d);setTimeout(()=>d.remove(),4500)}}

// ---------- VOICE CHAT ----------
const peers=new Map(),remoteAudios=new Map();let localStream=null,micOn=false,iceServers=[{urls:'stun:stun.l.google.com:19302'}];
fetch('/config').then(r=>r.json()).then(d=>{iceServers=d.iceServers||iceServers}).catch(()=>{});
function renderAudioButtons(){$('micBtn').classList.toggle('on',micOn);$('micBtn').querySelector('b').textContent=micOn?'MIC ON':'MIC OFF';$('speakerBtn').classList.toggle('on',speakerOn);$('speakerBtn').querySelector('b').textContent=speakerOn?'SPEAKER ON':'SPEAKER OFF';$('soundBtn').classList.toggle('on',sfxOn);$('soundBtn').querySelector('b').textContent=sfxOn?'SFX ON':'SFX OFF'}
async function getPeer(id){
  if(peers.has(id))return peers.get(id);const pc=new RTCPeerConnection({iceServers});peers.set(id,pc);if(localStream)localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));pc.onicecandidate=e=>{if(e.candidate)socket.emit('rtc:signal',{to:id,data:{candidate:e.candidate}})};pc.ontrack=e=>{let a=remoteAudios.get(id);if(!a){a=document.createElement('audio');a.autoplay=true;a.playsInline=true;a.muted=!speakerOn;document.body.appendChild(a);remoteAudios.set(id,a)}a.srcObject=e.streams[0]};pc.onconnectionstatechange=()=>{if(['failed','closed','disconnected'].includes(pc.connectionState)){/* allow reconnect */}};return pc;
}
async function offerPeer(id){const pc=await getPeer(id);try{const offer=await pc.createOffer();await pc.setLocalDescription(offer);socket.emit('rtc:signal',{to:id,data:{description:pc.localDescription}})}catch{}}
socket.on('rtc:peers',async({peers:ids})=>{for(const id of ids)await offerPeer(id)});socket.on('rtc:peer-joined',async({peerId})=>{await getPeer(peerId);if(localStream)await offerPeer(peerId)});socket.on('rtc:peer-left',({peerId})=>{peers.get(peerId)?.close();peers.delete(peerId);remoteAudios.get(peerId)?.remove();remoteAudios.delete(peerId)});socket.on('rtc:signal',async({from,data})=>{const pc=await getPeer(from);try{if(data.description){await pc.setRemoteDescription(data.description);if(data.description.type==='offer'){const ans=await pc.createAnswer();await pc.setLocalDescription(ans);socket.emit('rtc:signal',{to:from,data:{description:pc.localDescription}})}}else if(data.candidate)await pc.addIceCandidate(data.candidate)}catch{}});
$('micBtn').addEventListener('click',async()=>{ensureAudio();if(!micOn){try{localStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});micOn=true;for(const[id,pc]of peers){localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));await offerPeer(id)}}catch{return toast('Microphone permission was not allowed.')}}else{localStream?.getTracks().forEach(t=>t.stop());localStream=null;micOn=false;for(const pc of peers.values())for(const s of pc.getSenders())if(s.track?.kind==='audio')pc.removeTrack(s)}renderAudioButtons()});
$('speakerBtn').addEventListener('click',()=>{speakerOn=!speakerOn;remoteAudios.forEach(a=>a.muted=!speakerOn);renderAudioButtons()});$('soundBtn').addEventListener('click',()=>{ensureAudio();sfxOn=!sfxOn;renderAudioButtons();if(sfxOn)sfx('turn')});

window.addEventListener('popstate',()=>{if(!roomState)return;const g=location.pathname.includes('tic-tac')?'tictactoe':location.pathname.includes('word-search')?'wordsearch':'snakes';if(roomState.hostId===socket.id&&g!==roomState.activeGame)ackEmit('game:select',{game:g})});window.addEventListener('resize',layoutPieces);renderAudioButtons();
