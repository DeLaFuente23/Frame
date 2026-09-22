const playersInput = document.querySelector('#players');
const playerList = document.querySelector('#player-list');
const linksList = document.querySelector('#links');
const statusEl = document.querySelector('#status');
let players = [];

const mode = () => document.querySelector('input[name="mode"]:checked').value;
const esc = v => { const e = document.createElement('div'); e.textContent = v; return e.innerHTML; };

function render() {
  playerList.innerHTML = players.length ? '' : '<li class="name-empty">Your player list will appear here.</li>';
  players.forEach((name, i) => {
    const li = document.createElement('li');
    li.className = 'name-item';
    li.innerHTML = `<span class="name-tag">${esc(name)}</span><button class="remove-btn" type="button" aria-label="Remove ${esc(name)}">−</button>`;
    li.querySelector('button').onclick = () => { players.splice(i, 1); render(); };
    playerList.append(li);
  });
}

function add() {
  const n = playersInput.value.trim().replace(/\s+/g, ' ');
  if (!n || players.some(p => p.toLowerCase() === n.toLowerCase())) return;
  players.push(n);
  playersInput.value = '';
  render();
  playersInput.focus();
}

function setMode() {
  const local = mode() === 'local';
  document.querySelectorAll('.mode-card').forEach(c => c.classList.toggle('selected', c.querySelector('input').checked));
  document.querySelector('#mode-note').textContent = local
    ? 'Add exactly two players for a Local Screening.'
    : 'Add three or more players for a Worldwide Premiere.';
}

function b64(o) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(o))))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function cards(config) {
  linksList.innerHTML = '';
  const data = b64(config);
  const base = location.origin + location.pathname.replace(/index\.html$/, '');
  players.forEach((name, i) => {
    const url = `${base}player.html?g=${data}&p=${i}`;
    const li = document.createElement('li');
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(url)}`;
    li.className = 'player-card';
    li.innerHTML = `<span class="player-badge">Player ${i + 1}</span><a href="${url}" target="_blank" rel="noopener">${esc(name)}</a><p class="link-note">Scan this code on ${esc(name)}’s phone.</p><div class="qr-frame"><img src="${qr}" alt="QR code for ${esc(name)}"></div>`;
    linksList.append(li);
  });
  document.querySelector('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function start() {
  const m = mode();
  const ok = m === 'local' ? players.length === 2 : players.length >= 3;
  if (!ok) {
    statusEl.textContent = m === 'local' ? 'Local Screening needs exactly two players.' : 'Worldwide Premiere needs at least three players.';
    return;
  }

  try {
    const r = await fetch('movies.txt', { cache: 'no-store' });
    if (!r.ok) throw Error();

    // One new seed = one new shuffled game. The seed is carried by every QR code
    // so every phone reconstructs the exact same shuffled catalog locally.
    const seed = `${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(2)).join('')}`;
    cards({ mode: m, players: [...players], seed });
    statusEl.textContent = 'Game generated. Scan each player’s QR code to begin.';
  } catch {
    statusEl.textContent = 'The movie catalog could not be loaded. Serve this folder from a web server before starting.';
  }
}

document.querySelector('#add-player-btn').onclick = add;
playersInput.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
document.querySelectorAll('input[name="mode"]').forEach(i => i.onchange = setMode);
document.querySelector('#generate-btn').onclick = start;
document.querySelector('#clear-btn').onclick = () => {
  players = [];
  statusEl.textContent = '';
  render();
  linksList.innerHTML = '<li class="empty-state">Generate a game to create player cards.</li>';
};
setMode();
render();
