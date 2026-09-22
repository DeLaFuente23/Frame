const $ = selector => document.querySelector(selector);
const game = $('#game');
let config, me, movies, round = 0, timerId = null;
let localState = null;
let worldState = null;

function decode(value) {
  value = value.replaceAll('-', '+').replaceAll('_', '/');
  while (value.length % 4) value += '=';
  return JSON.parse(decodeURIComponent(escape(atob(value))));
}

function parseCatalog(text) {
  return text.trim().split(/\r?\n\s*\r?\n/).map(block => {
    const [names, runtime, gallery, last] = block.split(/\r?\n/);
    const [en, es] = names.split(' | ');
    const match = runtime.match(/(\d+)h (\d+)m/);
    const number = last.match(/-(\d+)\.jpg/);
    return {
      en, es,
      minutes: +match[1] * 60 + +match[2],
      last: +number[1],
      prefix: last.slice(0, last.lastIndexOf('-') + 1),
      suffix: last.slice(last.lastIndexOf('.jpg'))
    };
  });
}

function hash(value) {
  let h = 2166136261;
  for (const char of value) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffle(items, key) {
  const result = [...items];
  let state = hash(key);
  for (let i = result.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function imgFor(movie, totalMinutes) {
  const screenshotsPerMinute = movie.last / movie.minutes;
  const screenshotNumber = Math.max(1, Math.min(movie.last, Math.round(totalMinutes * screenshotsPerMinute)));
  return {
    url: `${movie.prefix}${screenshotNumber}${movie.suffix}`,
    number: screenshotNumber
  };
}

function words(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(word => word && !['the','a','an','el','la','los','las','de','y','and','of','in','movie','pelicula'].includes(word));
}

function distance(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return matrix[a.length][b.length];
}

function grade(answer, movie) {
  const given = words(answer);
  let best = 0;
  for (const title of [movie.en, movie.es]) {
    const expected = words(title);
    const matches = expected.filter(word => given.some(other => word === other || (word.length > 3 && distance(word, other) <= 1))).length;
    best = Math.max(best, matches / Math.max(1, expected.length));
  }
  return best >= 0.5 ? 1 : best > 0 ? 0.5 : 0;
}

function setHeader(badge, title, intro) {
  $('#mode-badge').textContent = badge;
  $('#welcome').textContent = title;
  $('#intro').textContent = intro;
}

function orderedMovies() {
  return shuffle(movies, config.seed);
}

function localPools() {
  const ordered = orderedMovies();
  return [ordered.slice(0, 84), ordered.slice(84, 168)];
}

function worldPools() {
  const ordered = orderedMovies();
  return config.players.map((_, playerIndex) => ordered.filter((_, movieIndex) => movieIndex % config.players.length === playerIndex));
}

function formatTime(totalMinutes) {
  const whole = Math.floor(totalMinutes);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function timeForm(movie, onDone, showTitle = false, back = home) {
  const hours = Math.floor(movie.minutes / 60);
  const minutes = movie.minutes % 60;
  game.innerHTML = `
    <div class="choice-head"><div>
      <h2>${showTitle ? movie.en : 'Choose the moment'}</h2>
      <p class="muted">Choose a whole-movie time from 0:00 to ${hours}:${String(minutes).padStart(2, '0')}.</p>
    </div></div>
    <div class="time-grid">
      <div><label for="hours">Hours</label><input id="hours" type="number" min="0" max="${hours}" value="0"></div>
      <div><label for="mins">Minutes</label><input id="mins" type="number" min="0" max="59" value="1"></div>
    </div>
    <div class="actions"><button class="primary-btn" id="show-frame" type="button">Show frame</button><button class="secondary-btn" id="back" type="button">Back</button></div>`;
  $('#back').onclick = back;
  $('#show-frame').onclick = () => {
    const total = (+$('#hours').value || 0) * 60 + (+$('#mins').value || 0);
    if (total < 0 || total > movie.minutes) {
      alert('Choose a time within this movie.');
      return;
    }
    onDone(total);
  };
}

function frameScreen(movie, minute, holder, back = home) {
  const shot = imgFor(movie, minute);
  game.innerHTML = `
    <div class="choice-head"><div>
      <h2>${holder ? movie.en : 'Name this movie'}</h2>
      <p class="muted">${holder ? `Agreed time: ${formatTime(minute)} · Frame ${shot.number}` : 'Enter your answer, then let the other player verify it.'}</p>
    </div></div>
    <img class="frame" src="${shot.url}" alt="Movie frame">
    <div class="answer-row"><input id="answer" placeholder="Your movie answer" ${holder ? 'disabled' : ''}><button class="primary-btn" id="check" type="button" ${holder ? 'disabled' : ''}>Check answer</button></div>
    <div id="result"></div>
    <div class="round-nav"><button class="secondary-btn" id="back" type="button">Back to game</button></div>`;
  $('#back').onclick = back;
  if (!holder) {
    $('#check').onclick = () => {
      const points = grade($('#answer').value, movie);
      $('#result').innerHTML = `<div class="result">${points === 1 ? 'Correct — 1 point.' : points === 0.5 ? 'Partial match — 0.5 point.' : 'No match — 0 points.'}</div>`;
    };
  }
}

function localHome() {
  const pools = localPools();
  const other = me === 0 ? 1 : 0;
  setHeader('Local Screening', `${config.players[me]}, ready to play?`, `You are Player ${me + 1}. The selector controls the movie and time; the guesser only sees the resulting frame.`);
  game.innerHTML = `
    <div class="choice-head"><div><h2>Choose your role</h2><p class="muted">The selector chooses from the other player's hidden 84-movie pool. The guesser uses the spoken set and card number.</p></div></div>
    <div class="actions">
      <button class="primary-btn" id="select" type="button">I’m the selector</button>
      <button class="secondary-btn" id="guess" type="button">I’m the guesser</button>
    </div>`;
  $('#select').onclick = () => chooseLocal(other, pools[other]);
  $('#guess').onclick = () => guessLocal(other, pools[other]);
}

function chooseLocal(owner, pool) {
  let setIndex = localState?.setIndex ?? 0;
  const draw = () => {
    const batch = pool.slice(setIndex * 7, setIndex * 7 + 7);
    game.innerHTML = `
      <div class="choice-head"><div><h2>Set ${setIndex + 1} of 12</h2><p class="muted">Choose one movie and tell ${config.players[owner]} the card number.</p></div><span class="player-badge">Selector</span></div>
      <div class="movie-list">${batch.map((movie, i) => `<button class="movie-choice" data-i="${i}" type="button"><strong>${i + 1}. ${movie.en}</strong><span>${movie.es}</span></button>`).join('')}</div>
      <div class="round-nav"><button class="secondary-btn" id="prev" type="button">Previous set</button><button class="secondary-btn" id="next" type="button">Next set</button><button class="secondary-btn" id="back" type="button">Back</button></div>`;
    document.querySelectorAll('[data-i]').forEach(button => {
      button.onclick = () => {
        const movie = batch[+button.dataset.i];
        localState = { setIndex, cardIndex: +button.dataset.i, movie };
        selectorWaitingScreen(owner, movie, () => chooseLocal(owner, pool));
      };
    });
    $('#prev').onclick = () => { setIndex = (setIndex + 11) % 12; draw(); };
    $('#next').onclick = () => { setIndex = (setIndex + 1) % 12; draw(); };
    $('#back').onclick = home;
  };
  draw();
}

function selectorWaitingScreen(owner, movie, back) {
  game.innerHTML = `
    <div class="choice-head"><div><h2>Card selected: ${localState.cardIndex + 1}</h2><p class="muted">Tell ${config.players[owner]} the set and card number. They choose the movie time on their phone and tell you the time.</p></div><span class="player-badge">Selector</span></div>
    <div class="result"><strong>${movie.en}</strong><br>${movie.es}</div>
    <div class="actions"><button class="primary-btn" id="verify-time" type="button">Enter the chosen time</button><button class="secondary-btn" id="back" type="button">Back</button></div>`;
  $('#verify-time').onclick = () => timeForm(movie, minute => frameScreen(movie, minute, true, back), true, () => selectorWaitingScreen(owner, movie, back));
  $('#back').onclick = back;
}

function guessLocal(owner, pool) {
  game.innerHTML = `
    <div class="choice-head"><div><h2>Enter the spoken selection</h2><p class="muted">${config.players[owner]} should tell you the set and card number. Your phone will not reveal the title.</p></div><span class="player-badge">Guesser</span></div>
    <div class="time-grid"><div><label for="set">Set (1–12)</label><input id="set" type="number" min="1" max="12" placeholder="1"></div><div><label for="card">Card (1–7)</label><input id="card" type="number" min="1" max="7" placeholder="1"></div></div>
    <div class="actions"><button class="primary-btn" id="continue" type="button">Choose time</button><button class="secondary-btn" id="back" type="button">Back</button></div>`;
  $('#back').onclick = home;
  $('#continue').onclick = () => {
    const setNumber = +$('#set').value;
    const cardNumber = +$('#card').value;
    if (!Number.isInteger(setNumber) || !Number.isInteger(cardNumber) || setNumber < 1 || setNumber > 12 || cardNumber < 1 || cardNumber > 7) {
      alert('Enter a set from 1–12 and a card from 1–7.');
      return;
    }
    const index = (setNumber - 1) * 7 + (cardNumber - 1);
    const movie = pool[index];
    if (!movie) { alert('That set/card is not available.'); return; }
    guessTimeScreen(owner, movie, setNumber, cardNumber, () => guessLocal(owner, pool));
  };
}

function guessTimeScreen(owner, movie, setNumber, cardNumber, back) {
  const hours = Math.floor(movie.minutes / 60);
  const minutes = movie.minutes % 60;
  game.innerHTML = `
    <div class="choice-head"><div><h2>Choose the movie moment</h2><p class="muted">You selected Set ${setNumber}, Card ${cardNumber}. Choose a whole-movie time, then tell ${config.players[owner]} the exact time so they can verify the frame on their phone.</p></div><span class="player-badge">Guesser</span></div>
    <div class="time-grid"><div><label for="hours">Hours</label><input id="hours" type="number" min="0" max="${hours}" value="0"></div><div><label for="mins">Minutes</label><input id="mins" type="number" min="0" max="59" value="1"></div></div>
    <div class="actions"><button class="primary-btn" id="show-frame" type="button">Show frame</button><button class="secondary-btn" id="back" type="button">Back</button></div>`;
  $('#back').onclick = back;
  $('#show-frame').onclick = () => {
    const total = (+$('#hours').value || 0) * 60 + (+$('#mins').value || 0);
    if (total < 0 || total > movie.minutes) { alert('Choose a time within this movie.'); return; }
    const shot = imgFor(movie, total);
    game.innerHTML = `
      <div class="choice-head"><div><h2>Your frame</h2><p class="muted">Chosen time: ${formatTime(total)} · Frame ${shot.number}. Tell ${config.players[owner]} the time, then enter your guess below.</p></div><span class="player-badge">Guesser</span></div>
      <img class="frame" src="${shot.url}" alt="Movie frame">
      <div class="answer-row"><input id="answer" placeholder="Your movie answer"><button class="primary-btn" id="check" type="button">Check answer</button></div>
      <div id="result"></div><div class="round-nav"><button class="secondary-btn" id="back" type="button">Back to selection</button></div>`;
    $('#back').onclick = back;
    $('#check').onclick = () => {
      const points = grade($('#answer').value, movie);
      $('#result').innerHTML = `<div class="result">${points === 1 ? 'Correct — 1 point.' : points === 0.5 ? 'Partial match — 0.5 point.' : 'No match — 0 points.'}</div>`;
    };
  };
}

function worldMovie() {
  const pools = worldPools();
  const active = round % config.players.length;
  const cycle = Math.floor(round / config.players.length);
  const pool = pools[active];
  const movie = pool[cycle % pool.length];
  const minute = 1 + (hash(`${config.seed}:${round}:minute`) % Math.max(1, movie.minutes - 1));
  return { active, cycle, pool, movie, minute };
}

function worldHome() {
  clearInterval(timerId);
  const { active, movie, minute } = worldMovie();
  const activeMe = active === me;
  const shot = imgFor(movie, minute);
  worldState = { active, movie, minute, shot, submitted: false, submittedAt: null, correct: false };

  setHeader('Worldwide Premiere', `${config.players[me]} — round ${round + 1}`, `${config.players[active]} is active. Everyone receives the same frame. Answer privately on your own phone.`);
  game.innerHTML = `
    <div class="choice-head"><div><h2>${activeMe ? 'Your 10-second turn' : 'Steal clock ready'}</h2><p class="muted">${activeMe ? 'You have 10 seconds to answer. Other players may submit privately at any time.' : 'Submit your answer privately. If the active player misses, the group compares correct submission times.'}</p></div><span class="player-badge">${esc(config.players[active])} active</span></div>
    <img class="frame" src="${shot.url}" alt="Mystery movie frame">
    <div id="timer" class="timer">${activeMe ? '10.0' : '0.0'}</div>
    <div class="answer-row"><input id="answer" placeholder="Your movie answer" autocomplete="off"><button class="primary-btn" id="check" type="button">Lock answer</button></div>
    <div id="result"></div>
    <div class="round-nav"><button class="secondary-btn" id="reveal" type="button">Reveal answer</button><button class="secondary-btn" id="previous" type="button">Previous round</button><button class="primary-btn" id="next" type="button">Next round</button></div>`;

  startClock(activeMe);
  $('#check').onclick = () => submitWorldAnswer(movie);
  $('#reveal').onclick = () => revealWorld(movie, minute);
  $('#previous').onclick = () => { round = Math.max(0, round - 1); worldHome(); };
  $('#next').onclick = () => { round++; worldHome(); };
}

function submitWorldAnswer(movie) {
  if (worldState.submitted) return;
  worldState.submitted = true;
  worldState.submittedAt = performance.now();
  worldState.correct = grade($('#answer').value, movie) === 1;
  const timer = $('#timer');
  const elapsed = worldState.submittedAt - worldState.clockStart;
  $('#result').innerHTML = `<div class="result">Answer locked at <strong>${(elapsed / 1000).toFixed(2)}s</strong> — ${worldState.correct ? 'correct if the steal phase is reached.' : 'not a match.'}</div>`;
  $('#check').disabled = true;
}

function revealWorld(movie, minute) {
  clearInterval(timerId);
  $('#result').innerHTML = `<div class="result"><strong>${movie.en}</strong><br>${movie.es}<br>Selected time: ${formatTime(minute)} · Frame ${imgFor(movie, minute).number}</div>`;
}

function startClock(active) {
  clearInterval(timerId);
  worldState.clockStart = performance.now();
  timerId = setInterval(() => {
    const elapsed = (performance.now() - worldState.clockStart) / 1000;
    const element = $('#timer');
    if (!element) return;
    if (active) {
      const left = Math.max(0, 10 - elapsed);
      element.textContent = left.toFixed(1);
      element.classList.toggle('warn', left < 3);
      if (left <= 0) {
        clearInterval(timerId);
        element.textContent = '0.0';
      }
    } else {
      element.textContent = elapsed.toFixed(1);
    }
  }, 60);
}

function esc(value) {
  const e = document.createElement('div');
  e.textContent = value;
  return e.innerHTML;
}

function home() {
  clearInterval(timerId);
  config.mode === 'local' ? localHome() : worldHome();
}

(async () => {
  try {
    const params = new URLSearchParams(location.search);
    config = decode(params.get('g') || '');
    me = +params.get('p');
    if (!config.players?.[me] || !config.seed) throw Error('link');

    const response = await fetch('movies.txt', { cache: 'no-store' });
    if (!response.ok) throw Error('catalog');
    movies = parseCatalog(await response.text());
    if (movies.length !== 168) throw Error('catalog-count');
    home();
  } catch {
    setHeader('Game link unavailable', 'Could not open this game', 'Use a QR code generated from the setup page while the site is being served.');
    game.innerHTML = '<p class="empty-state">This game link is incomplete or the movie catalog could not be loaded.</p>';
  }
})();
