const playersInput = document.querySelector('#players');
const playerList = document.querySelector('#player-list');
const linksList = document.querySelector('#links');
const statusEl = document.querySelector('#status');
let players = [];

const mode = () => document.querySelector('input[name="mode"]:checked').value;
const esc = value => { const e = document.createElement('div'); e.textContent = value; return e.innerHTML; };

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
  const name = playersInput.value.trim().replace(/\s+/g, ' ');
  if (!name || players.some(p => p.toLowerCase() === name.toLowerCase())) return;
  players.push(name);
  playersInput.value = '';
  render();
  playersInput.focus();
}

function setMode() {
  const local = mode() === 'local';
  document.querySelectorAll('.mode-card').forEach(card => card.classList.toggle('selected', card.querySelector('input').checked));
  document.querySelector('#mode-note').textContent = local
    ? 'Add exactly two players for a Local Screening.'
    : 'Add three or more players for a Worldwide Premiere.';
}

function encodeConfig(config) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(config))))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function makeSeed() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, n => n.toString(16).padStart(8, '0')).join('');
}

function cards(config) {
  linksList.innerHTML = '';
  const data = encodeConfig(config);
  const base = new URL('player.html', document.baseURI).href;

  players.forEach((name, i) => {
    const url = `${base}?g=${data}&p=${i}`;
    const li = document.createElement('li');
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(url)}`;
    li.className = 'player-card';
    li.innerHTML = `
      <span class="player-badge">Player ${i + 1}</span>
      <a href="${url}" target="_blank" rel="noopener">${esc(name)}</a>
      <p class="link-note">Scan this code on ${esc(name)}’s phone.</p>
      <div class="qr-frame"><img src="${qr}" alt="QR code for ${esc(name)}"></div>`;
    linksList.append(li);
  });
  document.querySelector('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function start() {
  const selectedMode = mode();
  const valid = selectedMode === 'local' ? players.length === 2 : players.length >= 3;
  if (!valid) {
    statusEl.textContent = selectedMode === 'local'
      ? 'Local Screening needs exactly two players.'
      : 'Worldwide Premiere needs at least three players.';
    return;
  }

  try {
    const response = await fetch(new URL('movies.txt', document.baseURI), { cache: 'no-store' });
    if (!response.ok) throw Error('catalog');

    // One fresh seed = one fresh shuffle for the entire game. Every player QR carries it,
    // so every phone reconstructs the exact same randomized movie order offline.
    const seed = makeSeed();
    const starter = selectedMode === 'local' ? (crypto.getRandomValues(new Uint32Array(1))[0] % 2) : 0;
    cards({ mode: selectedMode, players: [...players], seed, starter });
    statusEl.textContent = `New ${selectedMode === 'local' ? 'Local Screening' : 'Worldwide Premiere'} shuffled and ready.`;
  } catch {
    statusEl.textContent = 'The movie catalog could not be loaded. Serve this folder from a web server before starting.';
  }
}

document.querySelector('#add-player-btn').onclick = add;
playersInput.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); add(); } };
document.querySelectorAll('input[name="mode"]').forEach(input => input.onchange = setMode);
document.querySelector('#generate-btn').onclick = start;
document.querySelector('#clear-btn').onclick = () => {
  players = [];
  statusEl.textContent = '';
  render();
  linksList.innerHTML = '<li class="empty-state">Generate a game to create player cards.</li>';
};
setMode();
render();
