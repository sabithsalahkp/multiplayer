const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;
const ROOM_CODE_LEN = 6;
const rooms = new Map();

const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const STICKERS_FILE = path.join(DATA_DIR, 'stickers.json');

const defaultSettings = {
  maxPlayers: 6,
  minPlayers: 2,
  exactRollToWin: true,
  extraTurnOnSix: false,
  stickerPopupMs: 2600,
  stickerCooldownMs: 1400
};

const defaultStickers = [
  {
    "id": "laugh",
    "name": "LOL",
    "emoji": "😂",
    "enabled": true,
    "order": 1
  },
  {
    "id": "rofl",
    "name": "ROFL",
    "emoji": "🤣",
    "enabled": true,
    "order": 2
  },
  {
    "id": "cry",
    "name": "Crying",
    "emoji": "😭",
    "enabled": true,
    "order": 3
  },
  {
    "id": "love",
    "name": "Love",
    "emoji": "❤️",
    "enabled": true,
    "order": 4
  },
  {
    "id": "fire",
    "name": "Fire",
    "emoji": "🔥",
    "enabled": true,
    "order": 5
  },
  {
    "id": "cool",
    "name": "Cool",
    "emoji": "😎",
    "enabled": true,
    "order": 6
  },
  {
    "id": "dead",
    "name": "I'm Dead",
    "emoji": "💀",
    "enabled": true,
    "order": 7
  },
  {
    "id": "clown",
    "name": "Clown",
    "emoji": "🤡",
    "enabled": true,
    "order": 8
  },
  {
    "id": "angry",
    "name": "Angry",
    "emoji": "😡",
    "enabled": true,
    "order": 9
  },
  {
    "id": "clap",
    "name": "Clap",
    "emoji": "👏",
    "enabled": true,
    "order": 10
  },
  {
    "id": "party",
    "name": "Party",
    "emoji": "🥳",
    "enabled": true,
    "order": 11
  },
  {
    "id": "wow",
    "name": "Wow",
    "emoji": "😱",
    "enabled": true,
    "order": 12
  }
];

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return structuredClone(fallback);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

let settings = { ...defaultSettings, ...readJson(SETTINGS_FILE, defaultSettings) };
let stickers = readJson(STICKERS_FILE, defaultStickers);

const jumps = {
  4: 14, 9: 31, 20: 38, 28: 84, 40: 59, 51: 67, 63: 81, 71: 91,
  17: 7, 54: 34, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 99: 78
};

function cleanName(value, max = 22) {
  return String(value || '').replace(/[<>]/g, '').trim().slice(0, max) || 'Player';
}
function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let tries = 0; tries < 50; tries++) {
    let code = '';
    const bytes = crypto.randomBytes(ROOM_CODE_LEN);
    for (let i = 0; i < ROOM_CODE_LEN; i++) code += alphabet[bytes[i] % alphabet.length];
    if (!rooms.has(code)) return code;
  }
  throw new Error('Unable to create room code');
}
function publicStickers() {
  return stickers
    .filter(s => s.enabled)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(({ id, name, url, emoji }) => ({ id, name, url, emoji }));
}
function publicSettings() {
  return {
    maxPlayers: settings.maxPlayers,
    minPlayers: settings.minPlayers,
    exactRollToWin: settings.exactRollToWin,
    extraTurnOnSix: settings.extraTurnOnSix,
    stickerPopupMs: settings.stickerPopupMs,
    stickerCooldownMs: settings.stickerCooldownMs
  };
}
function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    turnIndex: room.turnIndex,
    winnerId: room.winnerId,
    lastRoll: room.lastRoll,
    lastMove: room.lastMove,
    settings: publicSettings(),
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      position: p.position,
      colorIndex: p.colorIndex,
      connected: p.connected
    }))
  };
}
function emitRoom(room) { io.to(room.code).emit('room:state', publicRoom(room)); }
function getRoomForSocket(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}
function leaveCurrentRoom(socket) {
  const room = getRoomForSocket(socket);
  if (!room) return;
  const index = room.players.findIndex(p => p.id === socket.id);
  if (index === -1) return;

  const wasTurn = room.status === 'playing' && room.turnIndex === index;
  room.players.splice(index, 1);
  socket.leave(room.code);
  socket.data.roomCode = null;

  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }

  if (room.hostId === socket.id) room.hostId = room.players[0].id;
  if (room.status === 'playing') {
    if (index < room.turnIndex) room.turnIndex--;
    if (room.turnIndex >= room.players.length) room.turnIndex = 0;
    if (wasTurn && room.players.length > 0) room.turnIndex %= room.players.length;
    if (room.players.length < settings.minPlayers) room.status = 'lobby';
  }

  io.to(room.code).emit('rtc:peer-left', { peerId: socket.id });
  io.to(room.code).emit('room:notice', `${cleanName(socket.data.playerName)} left the room.`);
  emitRoom(room);
}
function safeNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}
function roomDashboard() {
  return [...rooms.values()].map(r => ({
    code: r.code,
    status: r.status,
    playerCount: r.players.length,
    players: r.players.map(p => p.name),
    createdAt: r.createdAt
  })).sort((a, b) => b.createdAt - a.createdAt);
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));
app.get('/admin', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/config', (_req, res) => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(',').map(s => s.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }
  res.json({ iceServers, ...publicSettings() });
});
app.get('/api/stickers', (_req, res) => res.json({ ok: true, stickers: publicStickers() }));

// No admin password by request. /admin is intentionally open.
// Admin changes are live in memory. Permanent defaults come from data/*.json in GitHub.
app.get('/api/admin/dashboard', (_req, res) => {
  const roomList = roomDashboard();
  res.json({
    ok: true,
    settings: publicSettings(),
    stickers: stickers.slice().sort((a, b) => (a.order || 0) - (b.order || 0)),
    stats: {
      liveRooms: roomList.length,
      livePlayers: roomList.reduce((sum, r) => sum + r.playerCount, 0),
      enabledStickers: stickers.filter(s => s.enabled).length
    },
    rooms: roomList
  });
});
app.put('/api/admin/settings', (req, res) => {
  const body = req.body || {};
  settings = {
    maxPlayers: safeNumber(body.maxPlayers, 2, 6, settings.maxPlayers),
    minPlayers: safeNumber(body.minPlayers, 2, 6, settings.minPlayers),
    exactRollToWin: Boolean(body.exactRollToWin),
    extraTurnOnSix: Boolean(body.extraTurnOnSix),
    stickerPopupMs: safeNumber(body.stickerPopupMs, 900, 6000, settings.stickerPopupMs),
    stickerCooldownMs: safeNumber(body.stickerCooldownMs, 400, 6000, settings.stickerCooldownMs)
  };
  if (settings.minPlayers > settings.maxPlayers) settings.minPlayers = settings.maxPlayers;
  io.emit('game:settings', publicSettings());
  for (const room of rooms.values()) emitRoom(room);
  res.json({ ok: true, settings: publicSettings(), persistent: false });
});
app.patch('/api/admin/stickers/:id', (req, res) => {
  const sticker = stickers.find(s => s.id === req.params.id);
  if (!sticker) return res.status(404).json({ ok: false, error: 'Sticker not found.' });
  if (typeof req.body?.name === 'string') sticker.name = cleanName(req.body.name, 30);
  if (typeof req.body?.enabled === 'boolean') sticker.enabled = req.body.enabled;
  if (req.body?.order !== undefined) sticker.order = safeNumber(req.body.order, 0, 9999, sticker.order || 0);
  io.emit('stickers:updated', publicStickers());
  res.json({ ok: true, sticker, persistent: false });
});

io.on('connection', socket => {
  socket.on('room:create', ({ name }, ack = () => {}) => {
    try {
      leaveCurrentRoom(socket);
      const code = makeCode();
      const player = { id: socket.id, name: cleanName(name), position: 1, colorIndex: 0, connected: true };
      const room = {
        code,
        hostId: socket.id,
        status: 'lobby',
        turnIndex: 0,
        winnerId: null,
        lastRoll: null,
        lastMove: null,
        rollBusy: false,
        createdAt: Date.now(),
        players: [player]
      };
      rooms.set(code, room);
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.playerName = player.name;
      ack({ ok: true, code, room: publicRoom(room), peers: [], stickers: publicStickers() });
      emitRoom(room);
    } catch {
      ack({ ok: false, error: 'Could not create room.' });
    }
  });

  socket.on('room:join', ({ code, name }, ack = () => {}) => {
    code = String(code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: 'Room not found.' });
    if (room.status !== 'lobby') return ack({ ok: false, error: 'This game has already started.' });
    if (room.players.length >= settings.maxPlayers) return ack({ ok: false, error: 'Room is full.' });

    leaveCurrentRoom(socket);
    const peers = room.players.map(p => p.id);
    const player = {
      id: socket.id,
      name: cleanName(name),
      position: 1,
      colorIndex: room.players.length % 6,
      connected: true
    };
    room.players.push(player);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerName = player.name;
    ack({ ok: true, code, room: publicRoom(room), peers, stickers: publicStickers() });
    socket.to(code).emit('room:notice', `${player.name} joined the room.`);
    emitRoom(room);
  });

  socket.on('game:start', (_, ack = () => {}) => {
    const room = getRoomForSocket(socket);
    if (!room) return ack({ ok: false, error: 'Room not found.' });
    if (room.hostId !== socket.id) return ack({ ok: false, error: 'Only the room host can start.' });
    if (room.players.length < settings.minPlayers) return ack({ ok: false, error: `At least ${settings.minPlayers} players are required.` });
    room.status = 'playing';
    room.winnerId = null;
    room.turnIndex = 0;
    room.lastRoll = null;
    room.lastMove = null;
    room.rollBusy = false;
    room.players.forEach(p => p.position = 1);
    io.to(room.code).emit('game:fx', { kind: 'start' });
    emitRoom(room);
    ack({ ok: true });
  });

  socket.on('game:roll', async (_, ack = () => {}) => {
    const room = getRoomForSocket(socket);
    if (!room || room.status !== 'playing') return ack({ ok: false, error: 'Game is not active.' });
    const player = room.players[room.turnIndex];
    if (!player || player.id !== socket.id) return ack({ ok: false, error: 'Wait for your turn.' });
    if (room.rollBusy) return ack({ ok: false, error: 'Dice is already rolling.' });

    room.rollBusy = true;
    const roll = crypto.randomInt(1, 7);
    const playerId = player.id;
    io.to(room.code).emit('game:roll:start', { playerId, at: Date.now() });

    // Give every client time to see/hear the physical dice roll before the move begins.
    await new Promise(resolve => setTimeout(resolve, 620));
    if (!rooms.has(room.code) || room.status !== 'playing' || !room.players.includes(player)) {
      room.rollBusy = false;
      return ack({ ok: false, error: 'Roll cancelled.' });
    }

    const from = player.position;
    let landed = from + roll;
    if (landed > 100 && settings.exactRollToWin) landed = from;
    else if (landed > 100) landed = 100;
    const jumpedFrom = landed;
    if (jumps[landed]) landed = jumps[landed];
    player.position = landed;
    room.lastRoll = { playerId: player.id, value: roll, at: Date.now() };
    room.lastMove = {
      playerId: player.id,
      from,
      rolledTo: jumpedFrom,
      to: landed,
      jump: jumps[jumpedFrom] ? (landed > jumpedFrom ? 'ladder' : 'snake') : null
    };

    if (landed === 100) {
      room.status = 'finished';
      room.winnerId = player.id;
    } else if (!(settings.extraTurnOnSix && roll === 6)) {
      room.turnIndex = (room.turnIndex + 1) % room.players.length;
    }

    room.rollBusy = false;
    emitRoom(room);
    ack({ ok: true, roll });
  });

  socket.on('game:restart', (_, ack = () => {}) => {
    const room = getRoomForSocket(socket);
    if (!room) return ack({ ok: false, error: 'Room not found.' });
    if (room.hostId !== socket.id) return ack({ ok: false, error: 'Only the room host can restart.' });
    room.status = 'lobby';
    room.turnIndex = 0;
    room.winnerId = null;
    room.lastRoll = null;
    room.lastMove = null;
    room.rollBusy = false;
    room.players.forEach(p => p.position = 1);
    io.to(room.code).emit('game:fx', { kind: 'start' });
    emitRoom(room);
    ack({ ok: true });
  });

  socket.on('sticker:send', ({ stickerId, targetId = 'all' }, ack = () => {}) => {
    const room = getRoomForSocket(socket);
    if (!room) return ack({ ok: false, error: 'Room not found.' });
    const sticker = publicStickers().find(s => s.id === stickerId);
    if (!sticker) return ack({ ok: false, error: 'Sticker unavailable.' });
    const now = Date.now();
    const lastAt = Number(socket.data.lastStickerAt || 0);
    if (now - lastAt < settings.stickerCooldownMs) return ack({ ok: false, error: 'Wait a moment before sending another sticker.' });
    socket.data.lastStickerAt = now;

    const sender = room.players.find(p => p.id === socket.id);
    if (!sender) return ack({ ok: false, error: 'Player not found.' });
    const payload = { senderId: socket.id, senderName: sender.name, targetId, sticker, at: now, popupMs: settings.stickerPopupMs };

    if (targetId === 'all') {
      io.to(room.code).emit('sticker:popup', payload);
    } else {
      const target = room.players.find(p => p.id === targetId);
      if (!target) return ack({ ok: false, error: 'Target player is no longer in the room.' });
      socket.emit('sticker:popup', payload);
      if (targetId !== socket.id) io.to(targetId).emit('sticker:popup', payload);
    }
    ack({ ok: true });
  });

  socket.on('rtc:offer', ({ target, sdp }) => {
    const room = getRoomForSocket(socket);
    if (!room || !room.players.some(p => p.id === target)) return;
    io.to(target).emit('rtc:offer', { from: socket.id, sdp });
  });
  socket.on('rtc:answer', ({ target, sdp }) => {
    const room = getRoomForSocket(socket);
    if (!room || !room.players.some(p => p.id === target)) return;
    io.to(target).emit('rtc:answer', { from: socket.id, sdp });
  });
  socket.on('rtc:ice', ({ target, candidate }) => {
    const room = getRoomForSocket(socket);
    if (!room || !room.players.some(p => p.id === target)) return;
    io.to(target).emit('rtc:ice', { from: socket.id, candidate });
  });

  socket.on('room:leave', () => leaveCurrentRoom(socket));
  socket.on('disconnect', () => leaveCurrentRoom(socket));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Snakes & Ladders Live running on port ${PORT}`);
  console.log(`Game: /   Admin: /admin (no password)`);
});
