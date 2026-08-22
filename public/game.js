const socket = io({ transports: ['websocket', 'polling'] });

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
const moveEvent = $('moveEvent');
const diceBtn = $('diceBtn');
const diceFace = $('diceFace');
const diceHint = $('diceHint');
const ruleHint = $('ruleHint');
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
const stickerPopupEmoji = $('stickerPopupEmoji');
const stickerSender = $('stickerSender');
const stickerTargetLabel = $('stickerTargetLabel');
const connectionDot = $('connectionDot');
const connectionText = $('connectionText');
const createBtn = $('createBtn');
const joinBtn = $('joinBtn');

const colors = ['#c5963e','#a83b45','#286652','#365c98','#80518e','#c36a35'];
const diceChars = ['⚀','⚁','⚂','⚃','⚄','⚅'];
const jumps = {4:14,9:31,20:38,28:84,40:59,51:67,63:81,71:91,17:7,54:34,62:19,64:60,87:24,93:73,95:75,99:78};
const snakePairs = Object.entries(jumps).filter(([a,b]) => Number(b) < Number(a)).map(([a,b]) => [Number(a),Number(b)]);
const ladderPairs = Object.entries(jumps).filter(([a,b]) => Number(b) > Number(a)).map(([a,b]) => [Number(a),Number(b)]);

let roomState = null;
let myName = '';
let localStream = null;
let micEnabled = false;
let speakerEnabled = true;
let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
let appConfig = { maxPlayers: 6, minPlayers: 2, stickerPopupMs: 2600, stickerCooldownMs: 1400, exactRollToWin: true, extraTurnOnSix: false };
let stickerList = [];
let stickerBusy = false;
const stickerQueue = [];
const peers = new Map();
const pendingIce = new Map();
let noticeTimer;
let winnerShownFor = null;
let pieceLayer = null;
const visualPositions = new Map();
let lastAnimatedRollAt = null;
let moveAnimationRunning = false;
let pendingRoomState = null;
let audioCtx = null;
let sfxBus = null;
let audioUnlocked = false;
let diceSpinTimer = null;

function showNotice(text) {
  if (!text) return;
  notice.textContent = text;
  notice.classList.remove('hidden');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.add('hidden'), 2400);
}

function setConnectionUi(online) {
  connectionDot.classList.toggle('online', online);
  connectionText.textContent = online ? 'Game server connected' : 'Connecting to game server…';
  createBtn.disabled = !online;
  joinBtn.disabled = !online;
  $('liveBadge')?.classList.toggle('offline', !online);
}
setConnectionUi(socket.connected);

async function loadConfig() {
  try {
    const r = await fetch('/config', { cache: 'no-store' });
    const cfg = await r.json();
    if (Array.isArray(cfg.iceServers) && cfg.iceServers.length) iceServers = cfg.iceServers;
    appConfig = { ...appConfig, ...cfg };
    $('landingFoot').textContent = `${appConfig.minPlayers}–${appConfig.maxPlayers} players · Voice chat · Stickers · No account needed`;
    updateRuleHint();
  } catch {}
}

async function loadStickers() {
  try {
    const r = await fetch('/api/stickers', { cache: 'no-store' });
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
    board.appendChild(cell);
  });
  board.appendChild(makePathsSvg());
  pieceLayer = document.createElement('div');
  pieceLayer.className = 'piece-layer';
  board.appendChild(pieceLayer);
}

function cellCenter(n) {
  const safe = Math.max(1, Math.min(100, Number(n) || 1));
  const rowFromBottom = Math.floor((safe - 1) / 10);
  const pos = (safe - 1) % 10;
  const col = rowFromBottom % 2 === 0 ? pos : 9 - pos;
  const rowFromTop = 9 - rowFromBottom;
  return { x: col * 10 + 5, y: rowFromTop * 10 + 5 };
}

function curvedPath(a, b, bend = 1) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const amount = Math.min(9, 2.8 + len * .08) * bend;
  const c1 = { x: a.x + dx * .29 + nx * amount, y: a.y + dy * .29 + ny * amount };
  const c2 = { x: a.x + dx * .68 - nx * amount * .72, y: a.y + dy * .68 - ny * amount * .72 };
  return { d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`, c1, c2 };
}

function makeSvgEl(name, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k, v));
  return el;
}

function makePathsSvg() {
  const svg = makeSvgEl('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none' });
  svg.classList.add('path-svg');
  const defs = makeSvgEl('defs');
  const snakePalette = [
    ['#12391f','#4f9c3d','#d4c35b'],['#3b1837','#a4406d','#e3bd69'],['#143d54','#3e91a9','#d7c963'],['#5b2418','#c45a2f','#e2c664'],['#1c3b1e','#69a738','#d0b74d'],['#331c50','#8751aa','#d8ba61'],['#123a30','#3f9474','#dcc45f'],['#521b22','#b83e46','#e0b84f']
  ];
  snakePairs.forEach(([from,to], i) => {
    const grad = makeSvgEl('linearGradient', { id: `snakeGrad${i}`, x1: '0%', y1: '0%', x2: '100%', y2: '100%' });
    const pal = snakePalette[i % snakePalette.length];
    grad.append(
      makeSvgEl('stop',{offset:'0%','stop-color':pal[0]}),
      makeSvgEl('stop',{offset:'42%','stop-color':pal[1]}),
      makeSvgEl('stop',{offset:'72%','stop-color':pal[2]}),
      makeSvgEl('stop',{offset:'100%','stop-color':pal[0]})
    );
    defs.appendChild(grad);
  });
  const wood = makeSvgEl('linearGradient', { id:'woodRail', x1:'0%',y1:'0%',x2:'100%',y2:'100%' });
  wood.append(makeSvgEl('stop',{offset:'0%','stop-color':'#f0c17c'}),makeSvgEl('stop',{offset:'35%','stop-color':'#9c5b25'}),makeSvgEl('stop',{offset:'70%','stop-color':'#d08a3f'}),makeSvgEl('stop',{offset:'100%','stop-color':'#6f3d19'}));
  defs.appendChild(wood);
  svg.appendChild(defs);

  ladderPairs.forEach(([from,to], ladderIndex) => {
    const a = cellCenter(from), b = cellCenter(to);
    const dx = b.x-a.x, dy = b.y-a.y, len = Math.hypot(dx,dy) || 1;
    const ox = -dy/len*1.42, oy = dx/len*1.42;
    const group = makeSvgEl('g',{class:'ladder-group',style:`animation-delay:${ladderIndex*.17}s`});
    [[ox,oy],[-ox,-oy]].forEach(([x,y]) => {
      group.appendChild(makeSvgEl('line',{x1:a.x+x+.32,y1:a.y+y+.42,x2:b.x+x+.32,y2:b.y+y+.42,class:'ladder-shadow'}));
      group.appendChild(makeSvgEl('line',{x1:a.x+x,y1:a.y+y,x2:b.x+x,y2:b.y+y,class:'ladder-rail',stroke:'url(#woodRail)'}));
      group.appendChild(makeSvgEl('line',{x1:a.x+x-.24,y1:a.y+y-.2,x2:b.x+x-.24,y2:b.y+y-.2,class:'ladder-highlight'}));
    });
    let rung = 0;
    for(let t=.07;t<.97;t+=.105){
      const cx=a.x+dx*t, cy=a.y+dy*t;
      const r=makeSvgEl('g',{class:'ladder-rung-group',style:`animation-delay:${(rung++)*.07}s`});
      r.appendChild(makeSvgEl('line',{x1:cx+ox,y1:cy+oy,x2:cx-ox,y2:cy-oy,class:'ladder-rung'}));
      r.appendChild(makeSvgEl('line',{x1:cx+ox,y1:cy+oy-.18,x2:cx-ox,y2:cy-oy-.18,class:'ladder-rung-hi'}));
      group.appendChild(r);
    }
    svg.appendChild(group);
  });

  snakePairs.forEach(([from,to], i) => {
    const a = cellCenter(from), b = cellCenter(to);
    const bend = i % 2 === 0 ? 1 : -1;
    const curve = curvedPath(a,b,bend);
    const group = makeSvgEl('g', { class: 'snake-group', style:`animation-delay:${i*.23}s` });
    const width = 2.65 + (i % 3) * .27;
    group.appendChild(makeSvgEl('path',{d:curve.d,class:'snake-shadow','stroke-width':width+1.15}));
    group.appendChild(makeSvgEl('path',{d:curve.d,class:'snake-body','stroke-width':width,stroke:`url(#snakeGrad${i})`}));
    group.appendChild(makeSvgEl('path',{d:curve.d,class:'snake-highlight','stroke-width':.58}));
    group.appendChild(makeSvgEl('path',{d:curve.d,class:'snake-scales','stroke-width':1.42}));

    // Head points away from the body so it never looks backward down its own snake.
    const hx = a.x - curve.c1.x, hy = a.y - curve.c1.y;
    const hang = Math.atan2(hy,hx) * 180 / Math.PI;
    const head = makeSvgEl('g',{class:'snake-head-group',transform:`translate(${a.x} ${a.y}) rotate(${hang})`});
    head.appendChild(makeSvgEl('ellipse',{cx:.05,cy:0,rx:2.9,ry:2.05,fill:`url(#snakeGrad${i})`,class:'snake-head'}));
    head.appendChild(makeSvgEl('path',{d:'M -1.7 -1.05 Q .1 -2.15 2.15 -.95',class:'snake-brow'}));
    head.appendChild(makeSvgEl('ellipse',{cx:1.02,cy:-.78,rx:.53,ry:.6,class:'snake-eye'}));
    head.appendChild(makeSvgEl('ellipse',{cx:1.02,cy:.78,rx:.53,ry:.6,class:'snake-eye'}));
    head.appendChild(makeSvgEl('circle',{cx:1.26,cy:-.78,r:.23,class:'snake-pupil'}));
    head.appendChild(makeSvgEl('circle',{cx:1.26,cy:.78,r:.23,class:'snake-pupil'}));
    head.appendChild(makeSvgEl('circle',{cx:2.15,cy:-.43,r:.13,class:'snake-nostril'}));
    head.appendChild(makeSvgEl('circle',{cx:2.15,cy:.43,r:.13,class:'snake-nostril'}));
    head.appendChild(makeSvgEl('path',{d:'M .55 1.35 Q 1.55 1.75 2.25 1.12',class:'snake-mouth'}));
    head.appendChild(makeSvgEl('line',{x1:2.55,y1:0,x2:4.55,y2:0,class:'snake-tongue'}));
    head.appendChild(makeSvgEl('line',{x1:4.05,y1:0,x2:4.95,y2:-.58,class:'snake-tongue'}));
    head.appendChild(makeSvgEl('line',{x1:4.05,y1:0,x2:4.95,y2:.58,class:'snake-tongue'}));
    group.appendChild(head);

    const tx = b.x-curve.c2.x, ty=b.y-curve.c2.y;
    const tang = Math.atan2(ty,tx)*180/Math.PI;
    const tail=makeSvgEl('g',{transform:`translate(${b.x} ${b.y}) rotate(${tang})`});
    tail.appendChild(makeSvgEl('path',{d:'M -1.8 -1.15 Q .1 0 3.6 0 Q .1 0 -1.8 1.15 Z',fill:`url(#snakeGrad${i})`,class:'snake-tail'}));
    group.appendChild(tail);
    svg.appendChild(group);
  });
  return svg;
}
buildBoard();

function updateRuleHint() {
  const bits = [];
  bits.push(appConfig.exactRollToWin ? 'Exact roll required for 100' : 'Overshoot lands on 100');
  if (appConfig.extraTurnOnSix) bits.push('6 = extra turn');
  ruleHint.textContent = bits.join(' · ');
}

function enterGame(room) {
  roomState = room;
  if (room.settings) appConfig = { ...appConfig, ...room.settings };
  updateRuleHint();
  landing.classList.add('hidden');
  gameView.classList.remove('hidden');
  initializeVisualPositions(room);
  renderRoomMeta();
  syncPieceElements(room);
  layoutPieces(true);
  renderStickerTray();
  playSfx('join');
}

function initializeVisualPositions(room) {
  visualPositions.clear();
  room.players.forEach(p => visualPositions.set(p.id, p.position));
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
    if (sticker.emoji) {
      const emoji = document.createElement('span');
      emoji.className = 'sticker-emoji';
      emoji.textContent = sticker.emoji;
      btn.appendChild(emoji);
    } else if (sticker.url) {
      const img = document.createElement('img');
      img.src = sticker.url;
      img.alt = sticker.name;
      btn.appendChild(img);
    }
    const label = document.createElement('small');
    label.textContent = sticker.name;
    btn.appendChild(label);
    btn.addEventListener('click', () => sendSticker(sticker.id));
    stickerTray.appendChild(btn);
  });
}

function playerPieceColor(p) {
  return colors[(p.colorIndex || 0) % colors.length];
}

function renderRoomMeta() {
  if (!roomState) return;
  if (roomState.settings) appConfig = { ...appConfig, ...roomState.settings };
  updateRuleHint();
  roomCodeEl.textContent = roomState.code;
  playerCount.textContent = `${roomState.players.length}/${appConfig.maxPlayers || 6}`;
  playersList.innerHTML = '';
  const current = roomState.players[roomState.turnIndex];
  roomState.players.forEach(p => {
    const row = document.createElement('div');
    const isTurn = roomState.status === 'playing' && current?.id === p.id;
    row.className = 'player-row' + (isTurn ? ' active' : '');
    if (isTurn) { const pip = document.createElement('span'); pip.className = 'turn-pip'; row.appendChild(pip); }
    const pawn = document.createElement('span');
    pawn.className='mini-pawn';
    pawn.style.setProperty('--piece', playerPieceColor(p));
    const meta = document.createElement('div'); meta.className='player-meta';
    const strong = document.createElement('strong'); strong.textContent=p.name;
    const small = document.createElement('small');
    small.textContent = roomState.status === 'lobby' ? (p.id === roomState.hostId ? 'Host · Ready' : 'Ready') : `Square ${p.position}`;
    meta.append(strong,small); row.append(pawn,meta);
    if (p.id === socket.id) { const tag=document.createElement('span');tag.className='you-tag';tag.textContent='YOU';row.appendChild(tag); }
    playersList.appendChild(row);
  });
  renderStickerTargets();
  syncPieceElements(roomState);

  const meIsHost = roomState.hostId === socket.id;
  startBtn.classList.toggle('hidden', roomState.status !== 'lobby' || !meIsHost);
  startBtn.disabled = roomState.players.length < appConfig.minPlayers;
  restartBtn.classList.toggle('hidden', roomState.status !== 'finished' || !meIsHost);

  if (roomState.status === 'lobby') {
    statusLabel.textContent='Waiting room';
    turnText.textContent = roomState.players.length < appConfig.minPlayers ? `Invite ${Math.max(1, appConfig.minPlayers - roomState.players.length)} more player${appConfig.minPlayers - roomState.players.length === 1 ? '' : 's'}` : (meIsHost ? 'Everyone is ready — start when you want' : 'Waiting for host to start');
    diceHint.textContent='Game not started'; diceBtn.disabled=true;
    moveEvent.textContent = roomState.players.length === 1 ? 'Share the room code with a friend' : `${roomState.players.length} players connected`;
  } else if (roomState.status === 'playing') {
    const mine = current?.id === socket.id;
    statusLabel.textContent='Game in progress';
    turnText.textContent = mine ? 'Your turn' : `${current?.name || 'Player'} is playing`;
    diceHint.textContent = mine ? 'Tap the dice to roll' : `Waiting for ${current?.name || 'player'}`;
    diceBtn.disabled=!mine || moveAnimationRunning;
    if (mine && roomState.lastRoll?.playerId !== socket.id) playSfx('turn');
  } else {
    const winner=roomState.players.find(p=>p.id===roomState.winnerId);
    if (moveAnimationRunning) {
      statusLabel.textContent='Final move';
      turnText.textContent=`${winner?.name || 'Player'} is reaching the finish…`;
      diceHint.textContent='Finishing animation'; diceBtn.disabled=true;
      moveEvent.textContent = 'Watch the final move';
    } else {
      statusLabel.textContent='Game finished';
      turnText.textContent=`${winner?.name || 'Player'} wins the game`;
      diceHint.textContent='Game complete'; diceBtn.disabled=true;
      moveEvent.textContent = 'Final square reached';
      if (roomState.winnerId && winnerShownFor !== roomState.winnerId) {
        winnerShownFor=roomState.winnerId;
        winnerText.textContent = `${winner?.name || 'Player'} wins!`;
        playSfx('win');
        setTimeout(() => winnerModal.classList.remove('hidden'), 120);
      }
    }
  }

  if (roomState.lastRoll) {
    clearInterval(diceSpinTimer);
    diceBtn.classList.remove('rolling');
    lastRollBadge.classList.remove('hidden');
    const who=roomState.players.find(p=>p.id===roomState.lastRoll.playerId);
    lastRollBadge.innerHTML=`${who?.id===socket.id?'You':who?.name || 'Player'} rolled <b>${roomState.lastRoll.value}</b>`;
    diceFace.textContent=diceChars[roomState.lastRoll.value-1];
    const move = roomState.lastMove;
    if (move && move.playerId === roomState.lastRoll.playerId) {
      const mover = roomState.players.find(p => p.id === move.playerId);
      if (move.jump === 'snake') moveEvent.textContent = `${mover?.name || 'Player'} hit a snake: ${move.rolledTo} → ${move.to}`;
      else if (move.jump === 'ladder') moveEvent.textContent = `${mover?.name || 'Player'} climbed: ${move.rolledTo} → ${move.to}`;
      else if (move.from === move.to) moveEvent.textContent = 'Exact roll needed — no movement';
      else moveEvent.textContent = `${mover?.name || 'Player'} moved to square ${move.to}`;
    }
  } else lastRollBadge.classList.add('hidden');
}

function syncPieceElements(state) {
  if (!pieceLayer) return;
  const ids = new Set(state.players.map(p => p.id));
  pieceLayer.querySelectorAll('.board-piece').forEach(el => { if (!ids.has(el.dataset.playerId)) el.remove(); });
  state.players.forEach(p => {
    let el = pieceLayer.querySelector(`[data-player-id="${CSS.escape(p.id)}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'board-piece';
      el.dataset.playerId = p.id;
      el.innerHTML = '<span class="character-shadow"></span><span class="pawn-foot foot-left"></span><span class="pawn-foot foot-right"></span><span class="pawn-arm arm-left"></span><span class="pawn-arm arm-right"></span><span class="pawn-body"></span><span class="pawn-head"><i class="face-eye eye-left"></i><i class="face-eye eye-right"></i><i class="face-smile"></i></span><b class="pawn-initial"></b><span class="piece-name"></span>';
      pieceLayer.appendChild(el);
    }
    el.style.setProperty('--piece', playerPieceColor(p));
    el.querySelector('.pawn-initial').textContent = (p.name || '?').trim().charAt(0).toUpperCase();
    el.querySelector('.piece-name').textContent = p.id === socket.id ? `${p.name} · YOU` : p.name;
    el.classList.toggle('current', state.status === 'playing' && state.players[state.turnIndex]?.id === p.id && !moveAnimationRunning);
    if (!visualPositions.has(p.id)) visualPositions.set(p.id, p.position);
  });
}

function offsetsForCount(count) {
  if (count <= 1) return [[0,0]];
  if (count === 2) return [[-2.25,.15],[2.25,.15]];
  if (count === 3) return [[0,-1.65],[-2.5,1.25],[2.5,1.25]];
  if (count === 4) return [[-2.25,-1.25],[2.25,-1.25],[-2.25,1.6],[2.25,1.6]];
  if (count === 5) return [[0,-1.9],[-2.7,-.2],[2.7,-.2],[-1.7,1.8],[1.7,1.8]];
  return [[-2.65,-1.6],[0,-1.95],[2.65,-1.6],[-2.65,1.55],[0,1.9],[2.65,1.55]];
}

function layoutPieces(immediate = false) {
  if (!roomState || !pieceLayer) return;
  const groups = new Map();
  roomState.players.forEach(p => {
    const pos = visualPositions.get(p.id) ?? p.position;
    if (!groups.has(pos)) groups.set(pos, []);
    groups.get(pos).push(p);
  });
  for (const [pos, players] of groups) {
    const center = cellCenter(pos);
    const offsets = offsetsForCount(players.length);
    players.forEach((p,i) => {
      const el = pieceLayer.querySelector(`[data-player-id="${CSS.escape(p.id)}"]`);
      if (!el) return;
      if (immediate) el.style.transition = 'none';
      el.style.left = `${center.x + offsets[i][0]}%`;
      el.style.top = `${center.y + offsets[i][1]}%`;
      if (immediate) requestAnimationFrame(() => { el.style.transition = ''; });
    });
  }
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function bezierPoint(t, p0, p1, p2, p3) {
  const u = 1-t;
  return {
    x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
    y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y
  };
}

async function animateJump(playerId, from, to, type) {
  const el = pieceLayer?.querySelector(`[data-player-id="${CSS.escape(playerId)}"]`);
  if (!el) return;
  const start = cellCenter(from), end = cellCenter(to);
  const occupiedAtDestination = roomState.players.filter(p => p.id !== playerId && (visualPositions.get(p.id) ?? p.position) === to);
  const destinationOffset = offsetsForCount(occupiedAtDestination.length + 1)[occupiedAtDestination.length] || [0,0];
  el.classList.add(type === 'snake' ? 'jump-snake' : 'jump-ladder');
  if (type === 'snake') {
    playSfx('snake');
    const pairIndex = snakePairs.findIndex(([a,b]) => a === from && b === to);
    const curve = curvedPath(start,end,pairIndex % 2 === 0 ? 1 : -1);
    el.style.transition = 'none';
    for (let i=1;i<=34;i++) {
      const p = bezierPoint(i/34,start,curve.c1,curve.c2,end);
      el.style.left = `${p.x}%`; el.style.top = `${p.y}%`;
      if (i % 7 === 0) playSfx('slideTick');
      await wait(30);
    }
  } else {
    playSfx('ladder');
    el.style.transition = 'none';
    const steps = 12;
    for (let i=1;i<=steps;i++) {
      const t=i/steps;
      const wobble=(i%2?1:-1)*.42;
      el.style.left = `${start.x + (end.x-start.x)*t + wobble}%`;
      el.style.top = `${start.y + (end.y-start.y)*t}%`;
      el.classList.add('step-hop');
      playSfx('ladderStep', i);
      await wait(92);
      el.classList.remove('step-hop');
    }
    el.style.left = `${end.x + destinationOffset[0]}%`;
    el.style.top = `${end.y + destinationOffset[1]}%`;
  }
  visualPositions.set(playerId,to);
  el.classList.remove('jump-snake','jump-ladder','step-hop');
  el.style.transition = '';
  layoutPieces(false);
  el.classList.add('arrive');
  playSfx('land');
  await wait(430);
  el.classList.remove('arrive');
}

async function animateMove(state) {
  const move = state.lastMove;
  if (!move) return;
  moveAnimationRunning = true;
  roomState = state;
  renderRoomMeta();
  syncPieceElements(state);
  const player = state.players.find(p => p.id === move.playerId);
  const el = pieceLayer?.querySelector(`[data-player-id="${CSS.escape(move.playerId)}"]`);
  if (!player || !el) { moveAnimationRunning = false; return; }

  playSfx('diceLand');
  visualPositions.set(move.playerId, move.from);
  layoutPieces(true);
  await wait(180);

  if (move.rolledTo > move.from) {
    for (let square = move.from + 1; square <= move.rolledTo; square++) {
      el.classList.add('step-hop');
      visualPositions.set(move.playerId, square);
      layoutPieces(false);
      playSfx('jump');
      await wait(170);
      el.classList.remove('step-hop');
      await wait(25);
    }
  } else if (move.rolledTo === move.from) {
    playSfx('blocked');
    el.classList.add('blocked-bump');
    await wait(560);
    el.classList.remove('blocked-bump');
  }

  if (move.jump === 'snake' || move.jump === 'ladder') {
    await wait(180);
    await animateJump(move.playerId, move.rolledTo, move.to, move.jump);
  } else {
    visualPositions.set(move.playerId, move.to);
    layoutPieces(false);
    el.classList.add('arrive');
    playSfx('land');
    await wait(460);
    el.classList.remove('arrive');
  }

  if (state.status === 'finished' && state.winnerId === move.playerId) {
    el.classList.add('victory-jump');
    playSfx('victoryBuild');
    await wait(1050);
    el.classList.remove('victory-jump');
  }

  moveAnimationRunning = false;
  roomState = state;
  renderRoomMeta();
  syncPieceElements(state);
  layoutPieces(false);

  if (pendingRoomState && pendingRoomState !== state) {
    const next = pendingRoomState; pendingRoomState = null;
    processRoomState(next);
  }
}

function processRoomState(state) {
  if (!(roomState || state.players.some(p => p.id === socket.id))) return;
  if (moveAnimationRunning) { pendingRoomState = state; return; }
  const rollAt = state.lastRoll?.at || null;
  const shouldAnimate = roomState && state.lastMove && rollAt && rollAt !== lastAnimatedRollAt;
  roomState = state;
  if (!shouldAnimate) {
    state.players.forEach(p => visualPositions.set(p.id,p.position));
    renderRoomMeta();
    syncPieceElements(state);
    layoutPieces(false);
    return;
  }
  lastAnimatedRollAt = rollAt;
  animateMove(state);
}

function requireName() {
  const name=nameInput.value.trim().slice(0,18);
  if (!name) { landingError.textContent='Enter your name first.'; nameInput.focus(); return null; }
  landingError.textContent=''; myName=name; return name;
}

function emitWithTimeout(event, payload, timeout = 7000) {
  return new Promise(resolve => {
    if (!socket.connected) return resolve({ok:false,error:'Game server is still connecting. Try again in a moment.'});
    let done = false;
    const timer = setTimeout(() => { if (!done) { done=true; resolve({ok:false,error:'Server did not respond. Check your Render service and try again.'}); } }, timeout);
    socket.emit(event,payload,res => { if (done) return; done=true; clearTimeout(timer); resolve(res || {ok:false,error:'No response from server.'}); });
  });
}

createBtn.addEventListener('click', async () => {
  const name=requireName(); if(!name)return;
  createBtn.disabled = true; createBtn.textContent = 'Creating…';
  const res = await emitWithTimeout('room:create',{name});
  createBtn.textContent = 'Create Room'; createBtn.disabled = !socket.connected;
  if(!res.ok){landingError.textContent=res.error;return;}
  if (res.stickers) { stickerList = res.stickers; renderStickerTray(); }
  enterGame(res.room); await enableVoice(false); connectToPeers(res.peers || []);
});
joinBtn.addEventListener('click', async () => {
  const name=requireName(); if(!name)return;
  const code=roomInput.value.trim().toUpperCase();
  if(code.length!==6){landingError.textContent='Enter the 6-character room code.';return;}
  joinBtn.disabled = true; joinBtn.textContent = 'Joining…';
  const res = await emitWithTimeout('room:join',{code,name});
  joinBtn.textContent = 'Join'; joinBtn.disabled = !socket.connected;
  if(!res.ok){landingError.textContent=res.error;return;}
  if (res.stickers) { stickerList = res.stickers; renderStickerTray(); }
  enterGame(res.room); await enableVoice(false); connectToPeers(res.peers || []);
});
roomInput.addEventListener('input',()=>roomInput.value=roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6));
$('copyCodeBtn').addEventListener('click',async()=>{
  try { await navigator.clipboard.writeText(roomState?.code || ''); showNotice('Room code copied.'); }
  catch { showNotice(`Room code: ${roomState?.code || ''}`); }
});
$('leaveBtn').addEventListener('click',()=>{
  socket.emit('room:leave');
  cleanupVoice();
  roomState=null; pendingRoomState=null; moveAnimationRunning=false; visualPositions.clear(); lastAnimatedRollAt=null;
  pieceLayer?.querySelectorAll('.board-piece').forEach(el=>el.remove());
  gameView.classList.add('hidden'); landing.classList.remove('hidden');
});
function startDiceSpinVisual() {
  clearInterval(diceSpinTimer);
  diceBtn.classList.add('rolling');
  let ticks = 0;
  diceSpinTimer = setInterval(() => {
    diceFace.textContent = diceChars[Math.floor(Math.random()*6)];
    if (++ticks > 12) {
      clearInterval(diceSpinTimer);
      diceBtn.classList.remove('rolling');
    }
  }, 46);
}

startBtn.addEventListener('click',async()=>{
  const res=await emitWithTimeout('game:start',{});
  if(!res.ok)showNotice(res.error);
});
restartBtn.addEventListener('click',async()=>{
  const res=await emitWithTimeout('game:restart',{});
  if(!res.ok)showNotice(res.error);
  else { winnerShownFor=null; winnerModal.classList.add('hidden'); }
});
diceBtn.addEventListener('click',async()=>{
  if(diceBtn.disabled)return;
  ensureAudio();
  diceBtn.disabled=true;
  const res=await emitWithTimeout('game:roll',{});
  if(!res.ok){showNotice(res.error);clearInterval(diceSpinTimer);diceBtn.classList.remove('rolling');renderRoomMeta();}
});
$('winnerCloseBtn').addEventListener('click',()=>winnerModal.classList.add('hidden'));

function sendSticker(stickerId) {
  if (!roomState) return;
  ensureAudio();
  socket.emit('sticker:send', { stickerId, targetId: stickerTarget.value || 'all' }, res => {
    if (!res?.ok) showNotice(res?.error || 'Could not send sticker.');
  });
}

function enqueueSticker(payload) { stickerQueue.push(payload); if (!stickerBusy) showNextSticker(); }
function showNextSticker() {
  const payload = stickerQueue.shift();
  if (!payload) { stickerBusy = false; return; }
  stickerBusy = true;
  playSfx('sticker');
  const target = roomState?.players.find(p => p.id === payload.targetId);
  const isMine = payload.senderId === socket.id;
  if (payload.sticker.emoji) {
    stickerPopupImage.classList.add('hidden');
    stickerPopupEmoji.classList.remove('hidden');
    stickerPopupEmoji.textContent = payload.sticker.emoji;
  } else {
    stickerPopupEmoji.classList.add('hidden');
    stickerPopupImage.classList.remove('hidden');
    stickerPopupImage.src = payload.sticker.url;
    stickerPopupImage.alt = payload.sticker.name || 'Sticker';
  }
  stickerSender.textContent = isMine ? 'You sent a sticker' : `${payload.senderName} sent a sticker`;
  stickerTargetLabel.textContent = payload.targetId === 'all' ? 'To everyone' : (payload.targetId === socket.id ? 'To you' : target ? `To ${target.name}` : '');
  stickerPopup.classList.remove('hidden','is-leaving');
  requestAnimationFrame(() => stickerPopup.classList.add('is-showing'));
  const duration = Math.max(900, Math.min(6000, Number(payload.popupMs || appConfig.stickerPopupMs || 2600)));
  setTimeout(() => {
    stickerPopup.classList.add('is-leaving'); stickerPopup.classList.remove('is-showing');
    setTimeout(() => { stickerPopup.classList.add('hidden'); stickerPopup.classList.remove('is-leaving'); stickerBusy=false; showNextSticker(); }, 300);
  }, duration);
}

function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      audioCtx = new Ctx();
      const compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 18;
      compressor.ratio.value = 7;
      compressor.attack.value = .003;
      compressor.release.value = .22;
      const master = audioCtx.createGain();
      master.gain.value = .92;
      compressor.connect(master);
      master.connect(audioCtx.destination);
      sfxBus = compressor;
    }
  }
  if (audioCtx?.state === 'suspended') audioCtx.resume().catch(()=>{});
  audioUnlocked = !!audioCtx;
  return audioCtx;
}
function tone(freq, duration, type='sine', gain=.10, delay=0, endFreq=null, pan=0) {
  if (!speakerEnabled) return;
  const ctx=ensureAudio(); if(!ctx || !sfxBus)return;
  const osc=ctx.createOscillator(), g=ctx.createGain();
  const start=ctx.currentTime+delay;
  osc.type=type; osc.frequency.setValueAtTime(Math.max(20,freq),start);
  if(endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20,endFreq),start+duration);
  g.gain.setValueAtTime(.0001,start); g.gain.exponentialRampToValueAtTime(gain,start+.008); g.gain.exponentialRampToValueAtTime(.0001,start+duration);
  osc.connect(g);
  if (ctx.createStereoPanner) {
    const p=ctx.createStereoPanner(); p.pan.value=Math.max(-1,Math.min(1,pan)); g.connect(p); p.connect(sfxBus);
  } else g.connect(sfxBus);
  osc.start(start); osc.stop(start+duration+.04);
}
function noise(duration=.18,gain=.09,delay=0,filterFreq=1200,filterType='bandpass') {
  if(!speakerEnabled)return;
  const ctx=ensureAudio();if(!ctx || !sfxBus)return;
  const len=Math.max(1,Math.floor(ctx.sampleRate*duration));const buf=ctx.createBuffer(1,len,ctx.sampleRate);const data=buf.getChannelData(0);
  for(let i=0;i<len;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/len,.6);
  const src=ctx.createBufferSource();src.buffer=buf;const filter=ctx.createBiquadFilter();filter.type=filterType;filter.frequency.value=filterFreq;filter.Q.value=.85;const g=ctx.createGain();
  const start=ctx.currentTime+delay; g.gain.setValueAtTime(.0001,start);g.gain.exponentialRampToValueAtTime(gain,start+.006);g.gain.exponentialRampToValueAtTime(.0001,start+duration);
  src.connect(filter);filter.connect(g);g.connect(sfxBus);src.start(start);
}
function clickClack(delay=0, strength=1) {
  noise(.045,.12*strength,delay,1550,'highpass');
  tone(145,.045,'square',.07*strength,delay,95);
}
function playSfx(kind, detail=0) {
  if(!speakerEnabled)return;
  switch(kind){
    case 'diceRoll':
      [0,.075,.14,.205,.27,.34,.405,.47,.535].forEach((d,i)=>clickClack(d,.7+(i%3)*.13));
      tone(92,.62,'triangle',.05,0,62); break;
    case 'diceLand': clickClack(0,1.25); tone(185,.13,'triangle',.13,.015,105); break;
    case 'jump': tone(260,.075,'triangle',.105,0,430); tone(520,.06,'sine',.055,.035,640); break;
    case 'land': noise(.07,.075,0,700,'lowpass'); tone(150,.09,'triangle',.085,0,92); break;
    case 'ladder':
      noise(.18,.065,0,1850,'highpass');
      [0,1,2,3,4,5].forEach(i=>{tone(370*Math.pow(1.15,i),.15,'triangle',.09,i*.12);clickClack(i*.12,.58);}); break;
    case 'ladderStep': clickClack(0,.52); tone(410+Number(detail||0)*22,.075,'sine',.055,0); break;
    case 'snake':
      noise(1.15,.115,0,2500,'highpass'); tone(310,1.08,'sawtooth',.065,0,72); tone(145,.82,'triangle',.08,.15,58); break;
    case 'slideTick': noise(.045,.05,0,1100,'bandpass'); break;
    case 'blocked': tone(155,.20,'square',.115); tone(104,.30,'square',.09,.14); noise(.12,.06,.02,480,'lowpass'); break;
    case 'turn': tone(610,.13,'sine',.11); tone(860,.18,'sine',.10,.10); break;
    case 'sticker':
      tone(220,.11,'sine',.15,0,640); tone(860,.11,'triangle',.11,.075,1180); tone(1280,.16,'sine',.08,.14); noise(.09,.07,.055,2900,'highpass'); break;
    case 'join': tone(390,.11,'sine',.08); tone(610,.16,'sine',.09,.09); break;
    case 'start': [250,375,500,750].forEach((f,i)=>tone(f,.22,'triangle',.095,i*.11)); noise(.16,.06,.24,2100,'highpass'); break;
    case 'victoryBuild': [392,523,659,784].forEach((f,i)=>tone(f,.25,'triangle',.10,i*.15)); break;
    case 'win':
      [523,659,784,1047,1319].forEach((f,i)=>tone(f,.55,'triangle',.14,i*.13));
      [0,.12,.24,.36,.48].forEach(d=>noise(.20,.075,d,3400,'highpass')); break;
  }
}

// Sound is ON by default. The first tap unlocks browser audio; after that effects play automatically.
document.addEventListener('pointerdown', () => ensureAudio(), { once:true, capture:true });

socket.on('game:roll:start', () => { ensureAudio(); playSfx('diceRoll'); startDiceSpinVisual(); });
socket.on('game:fx', ({ kind } = {}) => { if (kind) { ensureAudio(); playSfx(kind); } });
socket.on('room:state', processRoomState);
socket.on('room:notice', text => { showNotice(text); if (/joined/i.test(text)) playSfx('join'); });
socket.on('sticker:popup', enqueueSticker);
socket.on('stickers:updated', list => { stickerList = Array.isArray(list) ? list : []; renderStickerTray(); });
socket.on('game:settings', cfg => { appConfig = { ...appConfig, ...cfg }; updateRuleHint(); if (roomState) renderRoomMeta(); });
socket.on('disconnect',()=>{ setConnectionUi(false); if(roomState) showNotice('Connection lost. Reconnecting…'); });
socket.on('connect',()=>{ setConnectionUi(true); landingError.textContent=''; if(roomState && roomState.code) showNotice('Connected.'); });
socket.on('connect_error',()=>{ setConnectionUi(false); landingError.textContent='Cannot reach the game server yet. Wait for Render to finish starting.'; });

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
  ensureAudio();
  if(!localStream){ await enableVoice(true); return; }
  micEnabled=!micEnabled; localStream.getAudioTracks().forEach(t=>t.enabled=micEnabled); updateVoiceUi();
});
speakerBtn.addEventListener('click',()=>{
  speakerEnabled=!speakerEnabled;
  remoteAudio.querySelectorAll('audio').forEach(a=>a.muted=!speakerEnabled);
  updateVoiceUi();
  if(speakerEnabled) playSfx('turn');
});
function updateVoiceUi(){
  micBtn.classList.toggle('off',!micEnabled);
  speakerBtn.classList.toggle('off',!speakerEnabled);
  const onLabel=speakerBtn.querySelector('.speaker-on'); const offLabel=speakerBtn.querySelector('.speaker-off');
  if(onLabel) onLabel.textContent='SOUND ON'; if(offLabel) offLabel.textContent='SOUND OFF';
  if(localStream) voiceStatus.textContent=micEnabled?'Microphone on':'Microphone muted';
  else voiceStatus.textContent='Tap MIC to enable voice';
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
    const pc=createPeer(from); await pc.setRemoteDescription(sdp);
    const queued=pendingIce.get(from)||[]; for(const c of queued) await pc.addIceCandidate(c).catch(()=>{}); pendingIce.delete(from);
    const answer=await pc.createAnswer(); await pc.setLocalDescription(answer); socket.emit('rtc:answer',{target:from,sdp:pc.localDescription});
  }catch{}
});
socket.on('rtc:answer',async({from,sdp})=>{try{const pc=createPeer(from);await pc.setRemoteDescription(sdp);const queued=pendingIce.get(from)||[];for(const c of queued)await pc.addIceCandidate(c).catch(()=>{});pendingIce.delete(from);}catch{}});
socket.on('rtc:ice',async({from,candidate})=>{const pc=createPeer(from);if(pc.remoteDescription)await pc.addIceCandidate(candidate).catch(()=>{});else{const q=pendingIce.get(from)||[];q.push(candidate);pendingIce.set(from,q);}});
socket.on('rtc:peer-left',({peerId})=>removePeer(peerId));
function removePeer(id){const pc=peers.get(id);if(pc)pc.close();peers.delete(id);document.getElementById(`audio-${id}`)?.remove();pendingIce.delete(id);}
function cleanupVoice(){for(const id of [...peers.keys()])removePeer(id);localStream?.getTracks().forEach(t=>t.stop());localStream=null;micEnabled=false;updateVoiceUi();}

window.addEventListener('resize',()=>layoutPieces(true));
window.addEventListener('beforeunload',()=>cleanupVoice());
