const $ = id => document.getElementById(id);
let dashboardData = null;
let toastTimer;

function toast(text) {
  const el = $('adminToast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}
async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

$('refreshBtn').addEventListener('click', () => refreshDashboard());

async function refreshDashboard() {
  try {
    dashboardData = await api('/api/admin/dashboard');
    renderDashboard();
  } catch (err) {
    toast(err.message);
  }
}
function renderDashboard() {
  if (!dashboardData) return;
  const { stats, settings, stickers, rooms } = dashboardData;
  $('statRooms').textContent = stats.liveRooms;
  $('statPlayers').textContent = stats.livePlayers;
  $('statStickers').textContent = stats.enabledStickers;
  $('maxPlayers').value = settings.maxPlayers;
  $('minPlayers').value = settings.minPlayers;
  $('stickerPopupMs').value = settings.stickerPopupMs;
  $('stickerCooldownMs').value = settings.stickerCooldownMs;
  $('exactRollToWin').checked = settings.exactRollToWin;
  $('extraTurnOnSix').checked = settings.extraTurnOnSix;
  renderStickers(stickers || []);
  renderRooms(rooms || []);
}

$('settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const payload = {
      maxPlayers: Number($('maxPlayers').value),
      minPlayers: Number($('minPlayers').value),
      stickerPopupMs: Number($('stickerPopupMs').value),
      stickerCooldownMs: Number($('stickerCooldownMs').value),
      exactRollToWin: $('exactRollToWin').checked,
      extraTurnOnSix: $('extraTurnOnSix').checked
    };
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(payload) });
    toast('Live settings applied.');
    await refreshDashboard();
  } catch (err) { toast(err.message); }
});

function renderStickers(list) {
  const grid = $('stickerGrid');
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = '<div class="empty-state">No stickers are configured in data/stickers.json.</div>';
    return;
  }
  list.forEach(sticker => {
    const card = document.createElement('article');
    card.className = 'sticker-item';

    const thumb = document.createElement('div');
    thumb.className = 'sticker-thumb';
    if (sticker.emoji) {
      const emoji = document.createElement('div');
      emoji.className = 'emoji-preview';
      emoji.textContent = sticker.emoji;
      thumb.appendChild(emoji);
    } else {
      const img = document.createElement('img');
      img.src = sticker.url;
      img.alt = sticker.name;
      thumb.appendChild(img);
    }

    const meta = document.createElement('div');
    meta.className = 'sticker-meta';
    const name = document.createElement('input');
    name.type = 'text';
    name.value = sticker.name;
    name.maxLength = 30;
    meta.appendChild(name);

    const actions = document.createElement('div');
    actions.className = 'sticker-actions';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'mini-btn';
    save.textContent = 'SAVE NAME';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `mini-btn${sticker.enabled ? '' : ' off'}`;
    toggle.textContent = sticker.enabled ? 'ON' : 'OFF';

    save.addEventListener('click', async () => {
      try {
        await updateSticker(sticker.id, { name: name.value.trim() });
        toast('Live sticker name changed.');
        await refreshDashboard();
      } catch (err) { toast(err.message); }
    });
    toggle.addEventListener('click', async () => {
      try {
        await updateSticker(sticker.id, { enabled: !sticker.enabled });
        toast(sticker.enabled ? 'Sticker switched off.' : 'Sticker switched on.');
        await refreshDashboard();
      } catch (err) { toast(err.message); }
    });

    actions.append(save, toggle);
    card.append(thumb, meta, actions);
    grid.appendChild(card);
  });
}
async function updateSticker(id, patch) {
  return api(`/api/admin/stickers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
}

function renderRooms(rooms) {
  const wrap = $('roomsList');
  wrap.innerHTML = '';
  if (!rooms.length) {
    wrap.innerHTML = '<div class="empty-state">No active rooms right now.</div>';
    return;
  }
  rooms.forEach(room => {
    const row = document.createElement('div');
    row.className = 'room-row';
    const code = document.createElement('div');
    code.className = 'room-code';
    code.textContent = room.code;
    const status = document.createElement('div');
    status.className = 'room-status';
    status.textContent = room.status;
    const count = document.createElement('div');
    count.className = 'room-status';
    count.textContent = `${room.playerCount} player${room.playerCount === 1 ? '' : 's'}`;
    const names = document.createElement('div');
    names.className = 'room-players';
    names.textContent = room.players.join(', ');
    row.append(code, status, count, names);
    wrap.appendChild(row);
  });
}

refreshDashboard();
setInterval(refreshDashboard, 10000);
