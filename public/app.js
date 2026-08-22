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

// ---------- BASIC UI ----------
const landing=$('landing'),gameShell=$('gameShell'),createBtn=$('createBtn'),joinBtn=$('joinBtn'),nameInput=$('nameInput'),roomInput=$('roomInput'),landingError=$('landingError');
const roomCodeEl=$('roomCode'),playerCount=$('playerCount'),playersList=$('playersList'),gameNav=$('gameNav'),activeGameLabel=$('activeGameLabel'),toastStack=$('toastStack');
function toast(msg){const d=document.createElement('div');d.className='toast';d.textContent=msg;toastStack.appendChild(d);setTimeout(()=>d.remove(),2800)}
function ackEmit(event,payload={}){return new Promise(resolve=>socket.emit(event,payload,res=>resolve(res||{ok:false,error:'No response'})))}
function displayGameName(g){return {snakes:'Snakes & Ladders',tictactoe:'Tic Tac Toe',wordsearch:'Word Search'}[g]||g}
function updateConn(ok){createBtn.disabled=!ok;joinBtn.disabled=!ok;$('connectionText').textContent=ok?'Game server connected':'Connecting…';document.querySelector('.connection')?.classList.toggle('online',ok)}
socket.on('connect',()=>updateConn(true));socket.on('disconnect',()=>{updateConn(false);toast('Connection lost. Reconnecting…')});socket.on('connect_error',()=>updateConn(false));
fetch('/config').then(r=>r.json()).then(d=>{appSettings={...appSettings,...(d.settings||{})};sfxOn=appSettings.soundDefaultOn!==false;renderAudioButtons()}).catch(()=>{});
fetch('/api/stickers').then(r=>r.json()).then(d=>{stickerList=d.stickers||[];renderStickers()}).catch(()=>{});
socket.on('game:settings',s=>{appSettings={...appSettings,...s};renderPlayers();renderAudioButtons()});socket.on('stickers:update',s=>{stickerList=s||[];renderStickers()});socket.on('room:notice',msg=>toast(msg));

createBtn.addEventListener('click',async()=>{const name=nameInput.value.trim().slice(0,20);if(!name)return landingError.textContent='Enter your name.';landingError.textContent='';const r=await ackEmit('room:create',{name});if(!r.ok)return landingError.textContent=r.error||'Could not create room.';enterRoom(r.room)});
joinBtn.addEventListener('click',async()=>{const name=nameInput.value.trim().slice(0,20),code=roomInput.value.trim().toUpperCase();if(!name)return landingError.textContent='Enter your name.';if(code.length<4)return landingError.textContent='Enter the room code.';landingError.textContent='';const r=await ackEmit('room:join',{name,code});if(!r.ok)return landingError.textContent=r.error||'Could not join room.';enterRoom(r.room)});
roomInput.addEventListener('input',()=>roomInput.value=roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6));nameInput.addEventListener('keydown',e=>{if(e.key==='Enter')createBtn.click()});roomInput.addEventListener('keydown',e=>{if(e.key==='Enter')joinBtn.click()});
$('copyCodeBtn').addEventListener('click',async()=>{if(!roomState)return;try{await navigator.clipboard.writeText(roomState.code);toast('Room code copied')}catch{toast(`Room: ${roomState.code}`)}});$('leaveBtn').addEventListener('click',()=>{socket.emit('room:leave');location.href='/'});
function enterRoom(room){roomState=room;landing.classList.add('hidden');gameShell.classList.remove('hidden');roomCodeEl.textContent=room.code;visualPositions.clear();room.players.forEach(p=>visualPositions.set(p.id,p.position||1));renderAll();sfx('join');history.replaceState({},'',room.path||'/snakes')}

socket.on('room:state',state=>{
  const old=roomState;roomState=state;if(!gameShell.classList.contains('hidden'))roomCodeEl.textContent=state.code;
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
  roomState.players.forEach(p=>{const row=document.createElement('div');row.className='player-row'+(p.id===turnId?' active':'');const pawn=document.createElement('span');pawn.className='mini-pawn';pawn.style.setProperty('--piece',colors[p.colorIndex%colors.length]);const meta=document.createElement('div');meta.className='player-meta';const b=document.createElement('b');b.textContent=p.name;const sm=document.createElement('small');sm.textContent=p.id===roomState.hostId?'Host':'Ready';meta.append(b,sm);row.append(pawn,meta);if(p.id===socket.id){const y=document.createElement('span');y.className='you-badge';y.textContent='YOU';row.append(y)}playersList.appendChild(row)})
}
function switchGameView(game,push){Object.entries(gameViews).forEach(([g,v])=>v.classList.toggle('hidden',g!==game));[...gameNav.querySelectorAll('button')].forEach(b=>b.classList.toggle('active',b.dataset.game===game));activeGameLabel.textContent=displayGameName(game);if(push&&roomState?.path&&location.pathname!==roomState.path)history.pushState({},'',roomState.path)}
gameNav.addEventListener('click',async e=>{const b=e.target.closest('button[data-game]');if(!b||!roomState)return;if(socket.id!==roomState.hostId)return toast('Only the host can switch games.');const r=await ackEmit('game:select',{game:b.dataset.game});if(!r.ok)toast(r.error||'Could not switch game')});

// ---------- STICKERS ----------
function renderStickers(){const tray=$('stickerTray');tray.innerHTML='';stickerList.forEach(st=>{const b=document.createElement('button');b.className='sticker-btn';b.type='button';b.title=st.name;const im=document.createElement('img');im.src=st.url;im.alt=st.name;im.loading='lazy';const label=document.createElement('small');label.textContent=st.name;b.append(im,label);b.addEventListener('click',async()=>{ensureAudio();const r=await ackEmit('sticker:send',{id:st.id});if(!r.ok&&r.error!=='Too fast.')toast(r.error||'Could not send')});tray.appendChild(b)})}
let stickerTimer=null;socket.on('sticker:pop',data=>{const pop=$('stickerPopup');clearTimeout(stickerTimer);pop.querySelector('img').src=data.url;pop.querySelector('b').textContent=data.name;pop.querySelector('small').textContent=`${data.from} reacted`;pop.classList.remove('hidden');sfx('sticker');stickerTimer=setTimeout(()=>pop.classList.add('hidden'),data.ms||3000)});

// ---------- SNAKES & LADDERS ----------
const jumps={4:14,9:31,20:38,28:84,40:59,51:67,63:81,71:91,17:7,54:34,62:19,64:60,87:24,93:73,95:75,99:78};
const boardCells=$('boardCells'),pathsLayer=$('pathsLayer'),piecesLayer=$('piecesLayer'),dice=$('dice'),rollBtn=$('rollBtn'),startSnakesBtn=$('startSnakesBtn'),turnText=$('turnText'),lastMoveText=$('lastMoveText'),snakesStatus=$('snakesStatus');
function cellCenter(n){const row=Math.floor((n-1)/10),offset=(n-1)%10,col=row%2===0?offset:9-offset;return{x:(col+.5)*100,y:(9-row+.5)*100}}
function buildBoard(){
  boardCells.innerHTML='';for(let visualRow=0;visualRow<10;visualRow++){const logicalRow=9-visualRow;for(let col=0;col<10;col++){const offset=logicalRow%2===0?col:9-col,n=logicalRow*10+offset+1,d=document.createElement('div');d.className='board-cell '+(((visualRow+col)%2)?'dark':'light');d.textContent=n;boardCells.appendChild(d)}}drawPaths();
}
function svgEl(name,attrs={}){const el=document.createElementNS('http://www.w3.org/2000/svg',name);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);return el}
function drawPaths(){
  pathsLayer.innerHTML='';
  const defs=svgEl('defs');
  const shadow=svgEl('filter',{id:'softShadow',x:'-30%',y:'-30%',width:'160%',height:'160%'});
  shadow.appendChild(svgEl('feDropShadow',{dx:'0',dy:'7',stdDeviation:'5','flood-color':'#1b1208','flood-opacity':'.34'}));
  defs.appendChild(shadow);pathsLayer.appendChild(defs);
  Object.entries(jumps).forEach(([a,b])=>{const from=Number(a),to=Number(b),A=cellCenter(from),B=cellCenter(to);A.x*=10;A.y*=10;B.x*=10;B.y*=10;if(to>from)drawLadder(A,B,from);else drawSnake(A,B,from)});
}
function drawLadder(A,B,seed){
  const dx=B.x-A.x,dy=B.y-A.y,len=Math.hypot(dx,dy),nx=-dy/len*18,ny=dx/len*18;
  const g=svgEl('g',{class:'ladder-group',filter:'url(#softShadow)'});
  g.append(svgEl('line',{x1:A.x+nx+3,y1:A.y+ny+5,x2:B.x+nx+3,y2:B.y+ny+5,class:'ladder-shadow'}),svgEl('line',{x1:A.x-nx+3,y1:A.y-ny+5,x2:B.x-nx+3,y2:B.y-ny+5,class:'ladder-shadow'}));
  g.append(svgEl('line',{x1:A.x+nx,y1:A.y+ny,x2:B.x+nx,y2:B.y+ny,class:'ladder-rail'}),svgEl('line',{x1:A.x-nx,y1:A.y-ny,x2:B.x-nx,y2:B.y-ny,class:'ladder-rail'}));
  g.append(svgEl('line',{x1:A.x+nx-3,y1:A.y+ny-2,x2:B.x+nx-3,y2:B.y+ny-2,class:'ladder-highlight'}),svgEl('line',{x1:A.x-nx-3,y1:A.y-ny-2,x2:B.x-nx-3,y2:B.y-ny-2,class:'ladder-highlight'}));
  const steps=Math.max(5,Math.floor(len/58));
  for(let i=1;i<steps;i++){const t=i/steps,x=A.x+dx*t,y=A.y+dy*t;g.append(svgEl('line',{x1:x+nx,y1:y+ny,x2:x-nx,y2:y-ny,class:'ladder-rung'}),svgEl('line',{x1:x+nx-1,y1:y+ny-2,x2:x-nx-1,y2:y-ny-2,class:'ladder-rung-hi'}))}
  pathsLayer.appendChild(g);
}
function drawSnake(A,B,seed){
  const dx=B.x-A.x,dy=B.y-A.y,len=Math.hypot(dx,dy),px=-dy/len,py=dx/len;
  const sway=70+(seed%4)*12;
  const mid={x:A.x+dx*.5,y:A.y+dy*.5};
  const c1={x:A.x+dx*.16+px*sway,y:A.y+dy*.16+py*sway};
  const c2={x:A.x+dx*.34-px*sway*.72,y:A.y+dy*.34-py*sway*.72};
  const c3={x:A.x+dx*.66+px*sway*.78,y:A.y+dy*.66+py*sway*.78};
  const c4={x:A.x+dx*.84-px*sway*.58,y:A.y+dy*.84-py*sway*.58};
  const d=`M ${A.x} ${A.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${mid.x} ${mid.y} C ${c3.x} ${c3.y}, ${c4.x} ${c4.y}, ${B.x} ${B.y}`;
  const palettes=[['#73d13d','#237d39','#103f2a'],['#ff785c','#c93c3c','#69222c'],['#916cff','#5536aa','#2b205f'],['#f6c84a','#b97921','#5d3816']];
  const pal=palettes[seed%palettes.length],id=`snakeGrad${seed}`;
  const defs=pathsLayer.querySelector('defs'),grad=svgEl('linearGradient',{id,x1:'0',y1:'0',x2:'1',y2:'1'});
  [['0%',pal[0]],['48%',pal[1]],['100%',pal[2]]].forEach(([o,c])=>grad.appendChild(svgEl('stop',{offset:o,'stop-color':c})));defs.appendChild(grad);
  const g=svgEl('g',{class:`snake-group snake-style-${seed%4}`,filter:'url(#softShadow)'});
  g.append(svgEl('path',{d,class:'snake-body-under'}),svgEl('path',{d,class:'snake-body',stroke:`url(#${id})`}),svgEl('path',{d,class:'snake-belly'}),svgEl('path',{d,class:'snake-scales'}));
  g.appendChild(svgEl('circle',{cx:B.x,cy:B.y,r:10,fill:pal[2],class:'snake-tail'}));
  const angle=Math.atan2(A.y-c1.y,A.x-c1.x)*180/Math.PI;
  const head=svgEl('g',{class:'snake-head-group',transform:`translate(${A.x} ${A.y}) rotate(${angle})`});
  head.append(svgEl('ellipse',{cx:0,cy:0,rx:38,ry:29,class:'snake-head',fill:pal[0]}),svgEl('ellipse',{cx:11,cy:0,rx:23,ry:20,class:'snake-snout',fill:pal[1]}));
  head.append(svgEl('circle',{cx:12,cy:-13,r:8,class:'snake-eye'}),svgEl('circle',{cx:12,cy:13,r:8,class:'snake-eye'}),svgEl('circle',{cx:16,cy:-13,r:3.5,class:'snake-pupil'}),svgEl('circle',{cx:16,cy:13,r:3.5,class:'snake-pupil'}));
  head.append(svgEl('circle',{cx:28,cy:-6,r:2.2,class:'snake-nostril'}),svgEl('circle',{cx:28,cy:6,r:2.2,class:'snake-nostril'}));
  head.append(svgEl('path',{d:'M 28 0 Q 38 0 47 0',class:'snake-tongue'}),svgEl('path',{d:'M 45 0 L 60 -8 M 45 0 L 60 8',class:'snake-tongue fork'}));
  g.appendChild(head);pathsLayer.appendChild(g);
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
socket.on('snakes:dice-roll',({roll,duration=1100})=>{ensureAudio();sfx('dice');dice.classList.remove('landed');dice.classList.add('rolling');setTimeout(()=>{setDiceFace(roll);dice.classList.remove('rolling');dice.classList.add('landed');setTimeout(()=>dice.classList.remove('landed'),340)},duration)});
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
  startSnakesBtn.classList.toggle('hidden',!(s.status==='lobby'&&roomState.hostId===socket.id));startSnakesBtn.disabled=roomState.players.length<(roomState.settings?.minPlayers||2);
  if(s.lastRoll&&phase!=='rolling')setDiceFace(s.lastRoll);
  const m=s.lastMove;if(m){const p=roomState.players.find(x=>x.id===m.playerId);lastMoveText.textContent=m.blocked?`${p?.name||'Player'} rolled ${m.roll} — exact roll needed.`:m.special?`${p?.name||'Player'} rolled ${m.roll} · ${m.special.type==='snake'?'snake slide':'ladder climb'}!`:`${p?.name||'Player'} rolled ${m.roll}.`}
}
startSnakesBtn.addEventListener('click',async()=>{ensureAudio();const r=await ackEmit('snakes:start');if(!r.ok)toast(r.error||'Could not start')});rollBtn.addEventListener('click',async()=>{ensureAudio();if(animatingMove)return;rollBtn.disabled=true;const r=await ackEmit('snakes:roll');if(!r.ok){toast(r.error||'Could not roll');renderSnakes()}});
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function animateSnakesMove(m,state){
  animatingMove=true;const p=state.players.find(x=>x.id===m.playerId),el=piecesLayer.querySelector(`[data-player="${CSS.escape(m.playerId)}"]`);if(!p){animatingMove=false;return}visualPositions.set(p.id,m.from);layoutPieces();
  if(m.blocked){sfx('wrong');await sleep(350)}else{
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
  wordTimerText.textContent=`00:${String(sec).padStart(2,'0')}`;wordTimerBar.style.width=pct+'%';wordTimerText.classList.toggle('urgent',sec<=10);wordTimerBar.classList.toggle('urgent',sec<=10);
  const current=roomState.players[w.turnIndex];
  if(current?.id===socket.id&&sec<=10&&sec>0&&sec!==lastWordTickSecond){lastWordTickSecond=sec;if(sfxOn){tone(sec<=5?820:610,.055,'square',sec<=5?.16:.09)}}
}
setInterval(updateWordTimer,250);
function renderWordSearch(){
  if(!roomState)return;const w=roomState.wordsearch;if(!w)return;wordStatus.textContent=w.status==='won'?'FINISHED':'LIVE';const current=roomState.players[w.turnIndex],meTurn=w.status!=='won'&&roomState.players.length>=2&&current?.id===socket.id;wordTurnText.textContent=roomState.players.length<2?'Waiting for 2 players':w.status==='won'?'Round finished':meTurn?'Your turn':`${current?.name||'Player'}'s turn`;if(wordSelectionStart===null)wordSelectionText.textContent=meTurn?'Tap the first letter of a word.':'Wait for your turn.';
  if(wordBoard.dataset.seed!==String(w.seed)){wordBoard.dataset.seed=String(w.seed);wordBoard.innerHTML='';wordSelectionStart=null;w.grid.forEach((ch,i)=>{const b=document.createElement('button');b.className='word-cell';b.type='button';b.dataset.index=i;b.textContent=ch;b.setAttribute('aria-label',`Letter ${ch}`);wordBoard.appendChild(b)})}
  [...wordBoard.children].forEach(c=>{c.classList.remove('found','mine','start','preview');c.style.background='';c.style.borderColor=''});
  w.found.forEach(f=>{const p=roomState.players.find(x=>x.id===f.playerId),color=colors[p?.colorIndex%colors.length||0];for(const idx of f.path){const c=wordBoard.children[idx];if(c){c.classList.add(f.playerId===socket.id?'mine':'found');c.style.borderColor=color;c.style.background=`color-mix(in srgb, ${color} 26%, #14213a)`}}});
  if(wordSelectionStart!==null)wordBoard.children[wordSelectionStart]?.classList.add('start');
  wordList.innerHTML='';w.words.forEach(word=>{const d=document.createElement('div'),f=w.found.find(x=>x.word===word);d.className='word-chip'+(f?' found':'');d.textContent=word;wordList.appendChild(d)});
  wordScores.innerHTML='';roomState.players.forEach(p=>{const score=w.found.filter(f=>f.playerId===p.id).length,row=document.createElement('div');row.className='score-row';row.innerHTML=`<i class="score-dot" style="--score:${colors[p.colorIndex%colors.length]}"></i><b></b><span>${score}</span>`;row.querySelector('b').textContent=p.name;wordScores.appendChild(row)});
  newWordsBtn.classList.toggle('hidden',roomState.hostId!==socket.id);updateWordTimer();
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
