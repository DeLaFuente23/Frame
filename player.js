const $ = s => document.querySelector(s);
const game = $('#game');
let config, me, movies, round = 0, timerId = null, localState = {};

function decode(v) {
  v = v.replaceAll('-', '+').replaceAll('_', '/');
  while (v.length % 4) v += '=';
  return JSON.parse(decodeURIComponent(escape(atob(v))));
}

function parseCatalog(text) {
  return text.trim().split(/\r?\n\s*\r?\n/).map(block => {
    const [names, runtime, gallery, last] = block.split(/\r?\n/);
    const [en, es] = names.split(' | ');
    const m = runtime.match(/(\d+)h (\d+)m/);
    const n = last.match(/-(\d+)\.jpg/);
    return {
      en, es,
      minutes: +m[1] * 60 + +m[2],
      last: +n[1],
      prefix: last.slice(0, last.lastIndexOf('-') + 1),
      suffix: last.slice(last.lastIndexOf('.jpg'))
    };
  });
}

function hash(value) {
  let h = 2166136261;
  for (const c of value) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Fisher-Yates with a deterministic seed. A game gets shuffled once when the
// setup page generates its seed; every phone then rebuilds the same order.
function shuffle(items, key) {
  const a = [...items];
  let s = hash(key);
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function imgFor(movie, minute) {
  const n = Math.max(1, Math.min(movie.last, Math.round(minute * movie.last / movie.minutes)));
  return { url: `${movie.prefix}${n}${movie.suffix}`, number: n };
}

function words(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(w => w && !['the','a','an','el','la','los','las','de','y','and','of','in','movie','pelicula'].includes(w));
}

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

function grade(answer, movie) {
  const given = words(answer);
  let best = 0;
  for (const title of [movie.en, movie.es]) {
    const expected = words(title);
    const matches = expected.filter(x => given.some(y => x === y || (x.length > 3 && distance(x, y) <= 1))).length;
    best = Math.max(best, matches / Math.max(1, expected.length));
  }
  return best >= .5 ? 1 : best > 0 ? .5 : 0;
}

function setHeader(badge, title, intro) {
  $('#mode-badge').textContent = badge;
  $('#welcome').textContent = title;
  $('#intro').textContent = intro;
}

function shuffledCatalog() {
  return shuffle(movies, config.seed);
}

function localPools() {
  const ordered = shuffledCatalog();
  return [ordered.slice(0, 84), ordered.slice(84, 168)];
}

function worldMovie() {
  const ordered = shuffledCatalog();
  return ordered[round % ordered.length];
}

function fmtTime(minute) {
  return `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}`;
}

function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
}

function timeForm(movie, onDone, showTitle = false) {
  game.innerHTML = `
    <div class="choice-head"><div>
      <h2>${showTitle ? movie.en : 'Choose the moment'}</h2>
      <p class="muted">Set a whole-movie time from 0:00 to ${fmtTime(movie.minutes)}.</p>
    </div></div>
    <div class="time-grid">
      <div><label for="hours">Hours</label><input id="hours" type="number" min="0" max="3" value="0"></div>
      <div><label for="mins">Minutes</label><input id="mins" type="number" min="0" max="59" value="1"></div>
    </div>
    <p class="field-note">The selected time is converted to this movie's screenshot position locally.</p>
    <div class="actions"><button class="primary-btn" id="show-frame">Show frame</button><button class="secondary-btn" id="back">Back</button></div>`;

  $('#back').onclick = home;
  $('#show-frame').onclick = () => {
    const min = (+$('#hours').value || 0) * 60 + (+$('#mins').value || 0);
    if (min < 0 || min > movie.minutes) {
      alert('Choose a time within this movie.');
      return;
    }
    onDone(min);
  };
}

function localFrameScreen(movie, minute, holder, context) {
  stopTimer();
  const shot = imgFor(movie, minute);
  const setLabel = context ? `Set ${context.set}, Card ${context.card}` : '';

  if (holder) {
    game.innerHTML = `
      <div class="choice-head"><div>
        <h2>${movie.en}</h2>
        <p class="muted">${setLabel} · Agreed time: ${fmtTime(minute)}</p>
      </div><span class="player-badge">Answer holder</span></div>
      <img class="frame" src="${shot.url}" alt="Selected movie frame">
      <div class="result"><strong>${movie.en}</strong><br>${movie.es}<br>Frame ${shot.number} · ${fmtTime(minute)}</div>
      <p class="field-note">The guesser should see only the image. Ask for their answer verbally, then confirm the result here.</p>
      <div class="actions">
        <button class="primary-btn" id="correct">Correct — award point</button>
        <button class="secondary-btn" id="wrong">Incorrect</button>
        <button class="secondary-btn" id="back">Back</button>
      </div>
      <div id="result"></div>`;
    $('#back').onclick = home;
    $('#correct').onclick = () => finishLocalRound('Correct — 1 point. Start the next turn.');
    $('#wrong').onclick = () => finishLocalRound('Incorrect. Start the next turn.');
  } else {
    game.innerHTML = `
      <div class="choice-head"><div>
        <h2>Name this movie</h2>
        <p class="muted">${setLabel} · The selector has the answer. Enter your guess.</p>
      </div><span class="player-badge">Guesser</span></div>
      <img class="frame" src="${shot.url}" alt="Mystery movie frame">
      <div class="answer-row"><input id="answer" placeholder="Your movie answer" autocomplete="off"><button class="primary-btn" id="check">Submit guess</button></div>
      <p class="field-note">Your phone does not know whether the spoken answer is correct. The selector verifies it on their screen.</p>
      <div id="result"></div>
      <div class="round-nav"><button class="secondary-btn" id="back">Back to game</button></div>`;
    $('#back').onclick = home;
    $('#check').onclick = () => {
      const answer = $('#answer').value.trim();
      if (!answer) return;
      $('#result').innerHTML = `<div class="result">Answer submitted. Let the selector verify it.</div>`;
      $('#check').disabled = true;
    };
  }
}

function finishLocalRound(message) {
  const result = $('#result');
  if (result) result.innerHTML = `<div class="result">${message}</div>`;
}

function localHome() {
  const pools = localPools();
  const other = me === 0 ? 1 : 0;
  setHeader('Local Screening', `${config.players[me]}, ready to play?`, 'The selector chooses the movie and time. The guesser sees only the resulting frame.');
  game.innerHTML = `
    <div class="choice-head"><div><h2>Choose your role</h2><p class="muted">${config.players[other]} is the other player. Coordinate the set, card, and time together in person.</p></div></div>
    <div class="actions">
      <button class="primary-btn" id="select">Choose for ${config.players[other]}</button>
      <button class="secondary-btn" id="guess">I’m guessing</button>
    </div>`;
  $('#select').onclick = () => chooseLocal(other, pools[other]);
  $('#guess').onclick = () => guessLocal(other, pools[other]);
}

function chooseLocal(owner, pool) {
  let pack = 0;
  const draw = () => {
    const batch = pool.slice(pack * 7, pack * 7 + 7);
    game.innerHTML = `
      <div class="choice-head"><div><h2>Set ${pack + 1} of 12</h2><p class="muted">Choose one title for ${config.players[owner]}. Tell them the set and card number.</p></div><span class="player-badge">Selector</span></div>
      <div class="movie-list">${batch.map((m, i) => `<button class="movie-choice" data-i="${i}"><strong>${i + 1}. ${m.en}</strong><span>${m.es}</span></button>`).join('')}</div>
      <div class="round-nav"><button class="secondary-btn" id="prev">Previous set</button><button class="secondary-btn" id="next">Next set</button><button class="secondary-btn" id="back">Back</button></div>`;
    document.querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
      const card = +b.dataset.i + 1;
      timeForm(batch[card - 1], min => localFrameScreen(batch[card - 1], min, true, { set: pack + 1, card }), true);
    });
    $('#prev').onclick = () => { pack = (pack + 11) % 12; draw(); };
    $('#next').onclick = () => { pack = (pack + 1) % 12; draw(); };
    $('#back').onclick = home;
  };
  draw();
}

function guessLocal(owner, pool) {
  game.innerHTML = `
    <div class="choice-head"><div><h2>Find the spoken card</h2><p class="muted">Enter the set and card number the selector gave you.</p></div><span class="player-badge">Guesser</span></div>
    <div class="time-grid"><div><label for="set">Set (1–12)</label><input id="set" type="number" min="1" max="12" placeholder="1"></div><div><label for="card">Card (1–7)</label><input id="card" type="number" min="1" max="7" placeholder="1"></div></div>
    <div class="actions"><button class="primary-btn" id="continue">Choose time</button><button class="secondary-btn" id="back">Back</button></div>`;
  $('#back').onclick = home;
  $('#continue').onclick = () => {
    const set = +$('#set').value;
    const card = +$('#card').value;
    const index = ((set - 1) * 7) + (card - 1);
    const movie = pool[index];
    if (!movie) { alert('That set/card is not available.'); return; }
    timeForm(movie, min => localFrameScreen(movie, min, false, { set, card }));
  };
}

function worldHome() {
  stopTimer();
  const playerCount = config.players.length;
  const active = round % playerCount;
  const movie = worldMovie();
  const minute = 1 + (hash(`${config.seed}:${round}:minute`) % Math.max(1, movie.minutes - 1));
  const activeMe = active === me;
  const shot = imgFor(movie, minute);

  setHeader('Worldwide Premiere', `${config.players[me]} — round ${round + 1}`, `${config.players[active]} is active. Everyone receives the same frame.`);
  localState = { submitted: false, answer: '', elapsed: null, activeMe, movie, minute };

  game.innerHTML = `
    <div class="choice-head"><div><h2>${activeMe ? 'Your 10-second turn' : 'Watch and answer privately'}</h2><p class="muted">${activeMe ? 'You have 10 seconds. Other players are timing their private answers.' : 'Submit a private answer whenever you have one. If the active player misses, compare elapsed times during the steal phase.'}</p></div><span class="player-badge">${config.players[active]}</span></div>
    <img class="frame" src="${shot.url}" alt="Mystery movie frame">
    <div id="timer" class="timer">${activeMe ? '10.0' : '0.0'}</div>
    <div class="answer-row"><input id="answer" placeholder="Your movie answer" autocomplete="off"><button class="primary-btn" id="check">${activeMe ? 'Submit answer' : 'Submit private answer'}</button></div>
    <div id="result"></div>
    <div class="round-nav">
      <button class="secondary-btn" id="steal">Enter steal phase</button>
      <button class="secondary-btn" id="reveal">Reveal answer</button>
      <button class="secondary-btn" id="previous">Previous round</button>
      <button class="primary-btn" id="next">Next round</button>
    </div>`;

  startWorldClock(activeMe);
  $('#check').onclick = submitWorldAnswer;
  $('#steal').onclick = () => enterStealPhase(movie);
  $('#reveal').onclick = () => revealWorld(movie, minute, shot.number);
  $('#previous').onclick = () => { round = Math.max(0, round - 1); worldHome(); };
  $('#next').onclick = () => { round++; worldHome(); };
}

function startWorldClock(active) {
  stopTimer();
  const start = performance.now();
  timerId = setInterval(() => {
    const elapsed = (performance.now() - start) / 1000;
    const el = $('#timer');
    if (!el) return;
    if (active) {
      const left = Math.max(0, 10 - elapsed);
      el.textContent = left.toFixed(1);
      el.classList.toggle('warn', left < 3);
      if (left <= 0) stopTimer();
    } else {
      el.textContent = elapsed.toFixed(1);
    }
  }, 60);
}

function submitWorldAnswer() {
  const answer = $('#answer').value.trim();
  if (!answer || localState.submitted) return;
  localState.submitted = true;
  localState.answer = answer;
  localState.elapsed = Number($('#timer').textContent);
  const isCorrect = grade(answer, localState.movie) === 1;
  $('#check').disabled = true;
  $('#result').innerHTML = `<div class="result">Answer locked at <strong>${localState.elapsed.toFixed(1)}s</strong>. ${isCorrect ? 'It matches the movie.' : 'It does not match the movie.'} ${localState.activeMe ? 'If incorrect or timed out, the group may begin the steal phase.' : 'If the active player misses, show this result to the group.'}</div>`;
}

function enterStealPhase(movie) {
  const current = $('#result');
  const elapsed = localState.elapsed ?? Number($('#timer')?.textContent || 0);
  if (localState.activeMe) {
    current.innerHTML = `<div class="result">Steal phase announced. Other players should reveal their already-submitted correct answers and elapsed times.</div>`;
  } else {
    current.innerHTML = `<div class="result"><strong>Steal phase.</strong> Your recorded time is ${elapsed.toFixed(1)}s. Reveal your answer only if it was already submitted and correct.</div>`;
  }
}

function revealWorld(movie, minute, shotNumber) {
  $('#result').innerHTML = `<div class="result"><strong>${movie.en}</strong><br>${movie.es}<br>Selected time: ${fmtTime(minute)} · Frame ${shotNumber}</div>`;
}

function home() {
  stopTimer();
  config.mode === 'local' ? localHome() : worldHome();
}

(async () => {
  try {
    const params = new URLSearchParams(location.search);
    config = decode(params.get('g') || '');
    me = +params.get('p');
    if (!config.players?.[me] || !config.seed) throw Error();
    const r = await fetch('movies.txt', { cache: 'no-store' });
    if (!r.ok) throw Error();
    movies = parseCatalog(await r.text());
    if (movies.length !== 168) throw Error();
    home();
  } catch {
    setHeader('Game link unavailable', 'Could not open this game', 'Use a QR code generated from the setup page while the site is being served.');
    game.innerHTML = '<p class="empty-state">This game link is incomplete or the movie catalog could not be loaded.</p>';
  }
})();
