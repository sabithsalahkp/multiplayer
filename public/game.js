const socket = io();

const $ = id => document.getElementById(id);
const landing = $('landing');
const gameView = $('gameView');
const nameInput = $('nameInput');
const roomInput = $('roomInput');
const landingError = $('landingError');
const roomCodeEl = $('roomCode');
const playersList = $('playersList');
const playerCount = $('playerCount');
const statusLabel = $('statusLabel');
const turnText = $('turnText');
const diceBtn = $('diceBtn');
const diceFace = $('diceFace');
const diceHint = $('diceHint');
const startBtn = $('startBtn');
const restartBtn = $('restartBtn');
const lastRollBadge = $('lastRollBadge');
const winnerModal = $('winnerModal');
const winnerText = $('winnerText');
const micBtn = $('micBtn');
const speakerBtn = $('speakerBtn');
const voiceStatus = $('voiceStatus');
const remoteAudio = $('remoteAudio');
const notice = $('notice');
const stickerTray = $('stickerTray');
const stickerTarget = $('stickerTarget');
const stickerPopup = $('stickerPopup');
const stickerPopupImage = $('stickerPopupImage');
const stickerSender = $('stickerSender');
const stickerTargetLabel = $('stickerTargetLabel');

const colors = ['#c99a3d','#9d2b33','#245b4c','#394d8f','#7d4b84','#c76f34'];
const diceChars = ['⚀','⚁','⚂','⚃','⚄','⚅'];
const jumps = {4:14,9:31,20:38,28:84,40:59,51:67,63:81,71:91,17:7,54:34,62:19,64:60,87:24,93:73,95:75,99:78};

let roomState = null;
let myName = '';
let localStream = null;
let micEnabled = false;
let speakerEnabled = true;
let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
let appConfig = { maxPlayers: 6, minPlayers: 2, stickerPopupMs: 2600, stickerCooldownMs: 1400 };
let stickerList = [];
let stickerBusy = false;
const stickerQueue = [];
const peers = new Map();
const pendingIce = new Map();
let noticeTimer;
let winnerShownFor = null;

function showNotice(text) {
  if (!text) return;
  notice.textContent = text;
  notice.classList.remove('hidden');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.add('hidden'), 2200);
}

async function loadConfig() {
  try {
    const r = await fetch('/config');
    const cfg = await r.json();
    if (Array.isArray(cfg.iceServers) && cfg.iceServers.length) iceServers = cfg.iceServers;
    appConfig = { ...appConfig, ...cfg };
    $('landingFoot').textContent = `${appConfig.minPlayers}–${appConfig.maxPlayers} players · Voice chat · Stickers · No account needed`;
  } catch {}
}

async function loadStickers() {
  try {
    const r = await fetch('/api/stickers');
    const data = await r.json();
    if (data.ok) {
      stickerList = data.stickers || [];
      renderStickerTray();
    }
  } catch {
    stickerTray.innerHTML = '<span class="tray-empty">Stickers unavailable</span>';
  }
}
loadConfig();
loadStickers();

function buildBoard() {
  const board = $('board');
  board.innerHTML = '';
  const numbers = [];
  for (let displayRow = 9; displayRow >= 0; displayRow--) {
    const base = displayRow * 10;
    const row = [];
    for (let i = 1; i <= 10; i++) row.push(base + i);
    if (displayRow % 2 === 1) row.reverse();
    numbers.push(...row);
  }
  numbers.forEach(num => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.cell = num;
    if (jumps[num]) cell.classList.add(jumps[num] > num ? 'jump-start-ladder' : 'jump-start-snake');
    const n = document.createElement('span');
    n.className = 'cell-number';
    n.textContent = num;
    cell.appendChild(n);
    if (jumps[num]) {
      const label = document.createElement('span');
      label.className = 'jump-label';
      label.textContent = jumps[num] > num ? `↑ ${jumps[num]}` : `↓ ${jumps[num]}`;
      cell.appendChild(label);
    }
    const tokens = document.createElement('div');
    tokens.className = 'tokens';
    cell.appendChild(tokens);
    board.appendChild(cell);
  });
  board.appendChild(makePathsSvg());
}

function cellCenter(n) {
  const rowFromBottom = Math.floor((n - 1) / 10);
  const pos = (n - 1) % 10;
  const col = rowFromBottom % 2 === 0 ? pos : 9 - pos;
  const rowFromTop = 9 - rowFromBottom;
  return { x: col * 10 + 5, y: rowFromTop * 10 + 5 };
}

function makePathsSvg() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 100 100');
  svg.classList.add('path-svg');
  Object.entries(jumps).forEach(([fromStr,to]) => {
    const from = Number(fromStr), a = cellCenter(from), b = cellCenter(to);
    if (to < from) {
      const path = document.createElementNS(svg.namespaceURI,'path');
      const mx = (a.x+b.x)/2 + (a.y-b.y)*.035;
      const my = (a.y+b.y)/2 + (b.x-a.x)*.035;
      path.setAttribute('d',`M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`);
      path.classList.add('snake-line');
      svg.appendChild(path);
    } else {
      const dx = b.x-a.x, dy = b.y-a.y, len = Math.hypot(dx,dy) || 1;
      const ox = -dy/len*1.25, oy = dx/len*1.25;
      [[ox,oy],[-ox,-oy]].forEach(([x,y]) => {
        const line = document.createElementNS(svg.namespaceURI,'line');
        line.setAttribute('x1',a.x+x); line.setAttribute('y1',a.y+y);
        line.setAttribute('x2',b.x+x); line.setAttribute('y2',b.y+y);
        line.classList.add('ladder-line'); svg.appendChild(line);
      });
      for(let t=.12;t<.92;t+=.14){
        const cx=a.x+dx*t, cy=a.y+dy*t;
        const rung=document.createElementNS(svg.namespaceURI,'line');
        rung.setAttribute('x1',cx+ox);rung.setAttribute('y1',cy+oy);
        rung.setAttribute('x2',cx-ox);rung.setAttribute('y2',cy-oy);
        rung.classList.add('ladder-rung');svg.appendChild(rung);
      }
    }
  });
  return svg;
}
buildBoard();

function enterGame(room) {
  roomState = room;
  if (room.settings) appConfig = { ...appConfig, ...room.settings };
  landing.classList.add('hidden');
  gameView.classList.remove('hidden');
  renderRoom();
  renderStickerTray();
}

function renderStickerTargets() {
  if (!roomState) return;
  const previous = stickerTarget.value || 'all';
  stickerTarget.innerHTML = '<option value="all">Everyone</option>';
  roomState.players.forEach(p => {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.id === socket.id ? 'Myself' : p.name;
    stickerTarget.appendChild(option);
  });
  if ([...stickerTarget.options].some(o => o.value === previous)) stickerTarget.value = previous;
}

function renderStickerTray() {
  if (!stickerTray) return;
  stickerTray.innerHTML = '';
  if (!stickerList.length) {
    const empty = document.createElement('span');
    empty.className = 'tray-empty';
    empty.textContent = 'No stickers yet';
    stickerTray.appendChild(empty);
    return;
  }
  stickerList.forEach(sticker => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sticker-btn';
    btn.title = sticker.name;
    btn.setAttribute('aria-label', `Send ${sticker.name} sticker`);
    const img = document.createElement('img');
    img.src = sticker.url;
    img.alt = sticker.name;
    btn.appendChild(img);
    btn.addEventListener('click', () => sendSticker(sticker.id));
    stickerTray.appendChild(btn);
  });
}

function renderRoom() {
  if (!roomState) return;
  if (roomState.settings) appConfig = { ...appConfig, ...roomState.settings };
  roomCodeEl.textContent = roomState.code;
  playerCount.textContent = `${roomState.players.length}/${appConfig.maxPlayers || 6}`;
  playersList.innerHTML = '';
  const current = roomState.players[roomState.turnIndex];
  roomState.players.forEach(p => {
    const row = document.createElement('div');
    row.className = 'player-row' + (roomState.status === 'playing' && current?.id === p.id ? ' active' : '');
    const dot = document.createElement('span'); dot.className='token-dot'; dot.style.background=colors[p.colorIndex%colors.length];
    const meta = document.createElement('div'); meta.className='player-meta';
    const strong = document.createElement('strong'); strong.textContent=p.name;
    const small = document.createElement('small');
    small.textContent = roomState.status === 'lobby' ? (p.id === roomState.hostId ? 'Host' : 'Ready') : `Square ${p.position}`;
    meta.append(strong,small); row.append(dot,meta);
    if (p.id === socket.id) { const tag=document.createElement('span');tag.className='you-tag';tag.textContent='YOU';row.appendChild(tag); }
    playersList.appendChild(row);
  });
  renderStickerTargets();

  document.querySelectorAll('.tokens').forEach(el => el.innerHTML='');
  roomState.players.forEach(p => {
    const holder = document.querySelector(`[data-cell="${p.position}"] .tokens`);
    if (!holder) return;
    const token = document.createElement('span'); token.className='board-token'; token.style.background=colors[p.colorIndex%colors.length]; token.title=p.name;
    holder.appendChild(token);
  });

  const meIsHost = roomState.hostId === socket.id;
  startBtn.classList.toggle('hidden', roomState.status !== 'lobby' || !meIsHost);
  startBtn.disabled = roomState.players.length < appConfig.minPlayers;
  restartBtn.classList.toggle('hidden', roomState.status !== 'finished' || !meIsHost);

  if (roomState.status === 'lobby') {
    statusLabel.textContent='Waiting room';
    turnText.textContent = roomState.players.length < appConfig.minPlayers ? `Invite ${Math.max(1, appConfig.minPlayers - roomState.players.length)} more player${appConfig.minPlayers - roomState.players.length === 1 ? '' : 's'}` : (meIsHost ? 'Everyone is ready' : 'Waiting for host to start');
    diceHint.textContent='Game not started'; diceBtn.disabled=true;
  } else if (roomState.status === 'playing') {
    const mine = current?.id === socket.id;
    statusLabel.textContent='Game in progress';
    turnText.textContent = mine ? 'Your turn' : `${current?.name || 'Player'} is rolling`;
    diceHint.textContent = mine ? 'Tap the dice' : `Waiting for ${current?.name || 'player'}`;
    diceBtn.disabled=!mine;
  } else {
    const winner=roomState.players.find(p=>p.id===roomState.winnerId);
    statusLabel.textContent='Game finished';
    turnText.textContent=`${winner?.name || 'Player'} wins the game`;
    diceHint.textContent='Game complete'; diceBtn.disabled=true;
    if (roomState.winnerId && winnerShownFor !== roomState.winnerId) {
      winnerShownFor=roomState.winnerId;
      winnerText.textContent = `${winner?.name || 'Player'} wins!`;
      winnerModal.classList.remove('hidden');
    }
  }

  if (roomState.lastRoll) {
    lastRollBadge.classList.remove('hidden');
    const who=roomState.players.find(p=>p.id===roomState.lastRoll.playerId);
    lastRollBadge.innerHTML=`${who?.id===socket.id?'You':who?.name || 'Player'} rolled <b>${roomState.lastRoll.value}</b>`;
    diceFace.textContent=diceChars[roomState.lastRoll.value-1];
  } else lastRollBadge.classList.add('hidden');
}

function requireName() {
  const name=nameInput.value.trim().slice(0,18);
  if (!name) { landingError.textContent='Enter your name first.'; nameInput.focus(); return null; }
  landingError.textContent=''; myName=name; return name;
}

$('createBtn').addEventListener('click',()=>{
  const name=requireName(); if(!name)return;
  socket.emit('room:create',{name},async res=>{
    if(!res.ok){landingError.textContent=res.error;return;}
    if (res.stickers) { stickerList = res.stickers; renderStickerTray(); }
    enterGame(res.room); await enableVoice(false); connectToPeers(res.peers || []);
  });
});
$('joinBtn').addEventListener('click',()=>{
  const name=requireName(); if(!name)return;
  const code=roomInput.value.trim().toUpperCase();
  if(code.length!==6){landingError.textContent='Enter the 6-character room code.';return;}
  socket.emit('room:join',{code,name},async res=>{
    if(!res.ok){landingError.textContent=res.error;return;}
    if (res.stickers) { stickerList = res.stickers; renderStickerTray(); }
    enterGame(res.room); await enableVoice(false); connectToPeers(res.peers || []);
  });
});
roomInput.addEventListener('input',()=>roomInput.value=roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6));
$('copyCodeBtn').addEventListener('click',async()=>{
  try { await navigator.clipboard.writeText(roomState?.code || ''); showNotice('Room code copied.'); }
  catch { showNotice(`Room code: ${roomState?.code || ''}`); }
});
$('leaveBtn').addEventListener('click',()=>{
  socket.emit('room:leave');
  cleanupVoice();
  roomState=null;
  gameView.classList.add('hidden');
  landing.classList.remove('hidden');
});
startBtn.addEventListener('click',()=>socket.emit('game:start',{},res=>{if(!res.ok)showNotice(res.error)}));
restartBtn.addEventListener('click',()=>socket.emit('game:restart',{},res=>{if(!res.ok)showNotice(res.error)}));
diceBtn.addEventListener('click',()=>{
  if(diceBtn.disabled)return;
  diceBtn.disabled=true; diceBtn.classList.add('rolling');
  let ticks=0; const spin=setInterval(()=>{diceFace.textContent=diceChars[Math.floor(Math.random()*6)]; if(++ticks>7){clearInterval(spin);diceBtn.classList.remove('rolling');}},45);
  socket.emit('game:roll',{},res=>{ if(!res.ok)showNotice(res.error); });
});
$('winnerCloseBtn').addEventListener('click',()=>winnerModal.classList.add('hidden'));

function sendSticker(stickerId) {
  if (!roomState) return;
  socket.emit('sticker:send', { stickerId, targetId: stickerTarget.value || 'all' }, res => {
    if (!res?.ok) showNotice(res?.error || 'Could not send sticker.');
  });
}

function enqueueSticker(payload) {
  stickerQueue.push(payload);
  if (!stickerBusy) showNextSticker();
}
function showNextSticker() {
  const payload = stickerQueue.shift();
  if (!payload) { stickerBusy = false; return; }
  stickerBusy = true;
  const target = roomState?.players.find(p => p.id === payload.targetId);
  const isMine = payload.senderId === socket.id;
  stickerPopupImage.src = payload.sticker.url;
  stickerPopupImage.alt = payload.sticker.name || 'Sticker';
  stickerSender.textContent = isMine ? 'You sent a sticker' : `${payload.senderName} sent a sticker`;
  stickerTargetLabel.textContent = payload.targetId === 'all' ? 'To everyone' : (payload.targetId === socket.id ? 'To you' : target ? `To ${target.name}` : '');
  stickerPopup.classList.remove('hidden');
  stickerPopup.classList.remove('is-leaving');
  requestAnimationFrame(() => stickerPopup.classList.add('is-showing'));
  const duration = Math.max(900, Math.min(6000, Number(payload.popupMs || appConfig.stickerPopupMs || 2600)));
  setTimeout(() => {
    stickerPopup.classList.add('is-leaving');
    stickerPopup.classList.remove('is-showing');
    setTimeout(() => {
      stickerPopup.classList.add('hidden');
      stickerPopup.classList.remove('is-leaving');
      stickerBusy = false;
      showNextSticker();
    }, 280);
  }, duration);
}

socket.on('room:state',state=>{ if(roomState || state.players.some(p=>p.id===socket.id)){ roomState=state; renderRoom(); } });
socket.on('room:notice',showNotice);
socket.on('sticker:popup', enqueueSticker);
socket.on('stickers:updated', list => { stickerList = Array.isArray(list) ? list : []; renderStickerTray(); });
socket.on('game:settings', cfg => { appConfig = { ...appConfig, ...cfg }; if (roomState) renderRoom(); });
socket.on('disconnect',()=>{ if(roomState) showNotice('Connection lost. Reconnecting…'); });
socket.on('connect',()=>{ if(roomState && roomState.code) showNotice('Connected.'); });

async function enableVoice(forcePrompt=true) {
  if(localStream){ micEnabled=true; localStream.getAudioTracks().forEach(t=>t.enabled=true); updateVoiceUi(); return true; }
  if(!navigator.mediaDevices?.getUserMedia){ voiceStatus.textContent='Microphone unavailable'; return false; }
  if(!forcePrompt){ voiceStatus.textContent='Tap MIC to enable voice'; updateVoiceUi(); return false; }
  try {
    localStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    micEnabled=true; updateVoiceUi();
    for(const [id,pc] of peers){ localStream.getTracks().forEach(track=>pc.addTrack(track,localStream)); await renegotiate(id,pc); }
    return true;
  } catch { micEnabled=false; voiceStatus.textContent='Microphone permission blocked'; updateVoiceUi(); return false; }
}

micBtn.addEventListener('click',async()=>{
  if(!localStream){ await enableVoice(true); return; }
  micEnabled=!micEnabled; localStream.getAudioTracks().forEach(t=>t.enabled=micEnabled); updateVoiceUi();
});
speakerBtn.addEventListener('click',()=>{ speakerEnabled=!speakerEnabled; remoteAudio.querySelectorAll('audio').forEach(a=>a.muted=!speakerEnabled); updateVoiceUi(); });
function updateVoiceUi(){
  micBtn.classList.toggle('off',!micEnabled);
  speakerBtn.classList.toggle('off',!speakerEnabled);
  if(localStream) voiceStatus.textContent=micEnabled?'Microphone on':'Microphone muted';
}

function createPeer(peerId) {
  if(peers.has(peerId)) return peers.get(peerId);
  const pc=new RTCPeerConnection({iceServers});
  peers.set(peerId,pc);
  if(localStream) localStream.getTracks().forEach(track=>pc.addTrack(track,localStream));
  pc.onicecandidate=e=>{if(e.candidate)socket.emit('rtc:ice',{target:peerId,candidate:e.candidate});};
  pc.ontrack=e=>{
    let audio=document.getElementById(`audio-${peerId}`);
    if(!audio){audio=document.createElement('audio');audio.id=`audio-${peerId}`;audio.autoplay=true;audio.playsInline=true;remoteAudio.appendChild(audio);}
    audio.srcObject=e.streams[0]; audio.muted=!speakerEnabled; audio.play().catch(()=>{});
  };
  pc.onconnectionstatechange=()=>{ if(['failed','closed'].includes(pc.connectionState)) removePeer(peerId); };
  return pc;
}

async function renegotiate(peerId,pc){
  if(pc.signalingState!=='stable')return;
  const offer=await pc.createOffer(); await pc.setLocalDescription(offer); socket.emit('rtc:offer',{target:peerId,sdp:pc.localDescription});
}
async function connectToPeers(ids){
  for(const peerId of ids){
    try{const pc=createPeer(peerId);const offer=await pc.createOffer();await pc.setLocalDescription(offer);socket.emit('rtc:offer',{target:peerId,sdp:pc.localDescription});}catch{}
  }
}

socket.on('rtc:offer',async({from,sdp})=>{
  try{
    const pc=createPeer(from);
    await pc.setRemoteDescription(sdp);
    const queued=pendingIce.get(from)||[]; for(const c of queued) await pc.addIceCandidate(c).catch(()=>{}); pendingIce.delete(from);
    const answer=await pc.createAnswer(); await pc.setLocalDescription(answer); socket.emit('rtc:answer',{target:from,sdp:pc.localDescription});
  }catch{}
});
socket.on('rtc:answer',async({from,sdp})=>{try{const pc=createPeer(from);await pc.setRemoteDescription(sdp);const queued=pendingIce.get(from)||[];for(const c of queued)await pc.addIceCandidate(c).catch(()=>{});pendingIce.delete(from);}catch{}});
socket.on('rtc:ice',async({from,candidate})=>{
  const pc=createPeer(from);
  if(pc.remoteDescription) await pc.addIceCandidate(candidate).catch(()=>{});
  else { const q=pendingIce.get(from)||[];q.push(candidate);pendingIce.set(from,q); }
});
socket.on('rtc:peer-left',({peerId})=>removePeer(peerId));
function removePeer(id){const pc=peers.get(id);if(pc)pc.close();peers.delete(id);document.getElementById(`audio-${id}`)?.remove();pendingIce.delete(id);}
function cleanupVoice(){for(const id of [...peers.keys()])removePeer(id);localStream?.getTracks().forEach(t=>t.stop());localStream=null;micEnabled=false;updateVoiceUi();}

window.addEventListener('beforeunload',()=>cleanupVoice());
