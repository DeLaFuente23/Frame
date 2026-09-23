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
  return config.players.map((_, playerIndex) =>
    ordered.filter((_, movieIndex) => movieIndex % config.players.length === playerIndex)
  );
}

function formatTime(totalMinutes) {
  const whole = Math.floor(totalMinutes);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/* Local Screening ------------------------------------------------------- */

function localStartingGuesser() {
  // Deterministic for the whole game: both phones calculate the same starter.
  return hash(`${config.seed}:local-start`) % 2;
}

function localGuesser() {
  return (localStartingGuesser() + round) % 2;
}

function localHome() {
  clearInterval(timerId);
  const pools = localPools();
  const guesser = localGuesser();
  const selector = guesser === 0 ? 1 : 0;
  const isGuesser = me === guesser;

  setHeader(
    'Local Screening',
    `${config.players[me]} — round ${round + 1}`,
    `${config.players[guesser]} is the guesser. Roles alternate automatically each round.`
  );

  game.innerHTML = `
    <div class="choice-head"><div>
      <h2>${isGuesser ? 'You are the guesser' : 'You are the selector'}</h2>
      <p class="muted">${isGuesser
        ? `Your phone will show only the frame. ${config.players[selector]} selects the movie from your hidden pool.`
        : `Choose a movie from ${config.players[guesser]}'s hidden 84-movie pool, then help them verify the chosen time.`}
      </p>
    </div><span class="player-badge">${isGuesser ? 'Guesser' : 'Selector'}</span></div>
    <div class="result">
      <strong>Round ${round + 1}</strong><br>
      ${esc(config.players[guesser])} guesses · ${esc(config.players[selector])} selects
    </div>
    <div class="actions">
      <button class="primary-btn" id="start-role" type="button">${isGuesser ? 'Start guessing' : 'Choose a movie'}</button>
    </div>`;

  $('#start-role').onclick = () => {
    if (isGuesser) guessLocal(selector, pools[me]);
    else chooseLocal(guesser, pools[guesser]);
  };
}

function chooseLocal(owner, pool) {
  let setIndex = localState?.round === round ? localState.setIndex : 0;

  const draw = () => {
    const batch = pool.slice(setIndex * 7, setIndex * 7 + 7);
    game.innerHTML = `
      <div class="choice-head"><div>
        <h2>Set ${setIndex + 1} of 12</h2>
        <p class="muted">Choose one movie and tell ${config.players[owner]} the set and card number.</p>
      </div><span class="player-badge">Selector</span></div>
      <div class="movie-list">${batch.map((movie, i) =>
        `<button class="movie-choice" data-i="${i}" type="button"><strong>${i + 1}. ${esc(movie.en)}</strong><span>${esc(movie.es)}</span></button>`
      ).join('')}</div>
      <div class="round-nav">
        <button class="secondary-btn" id="prev" type="button">Previous set</button>
        <button class="secondary-btn" id="next" type="button">Next set</button>
        <button class="secondary-btn" id="back" type="button">Back</button>
      </div>`;

    document.querySelectorAll('[data-i]').forEach(button => {
      button.onclick = () => {
        const movie = batch[+button.dataset.i];
        localState = { round, setIndex, cardIndex: +button.dataset.i, movie };
        selectorWaitingScreen(owner, movie, () => chooseLocal(owner, pool));
      };
    });

    $('#prev').onclick = () => { setIndex = (setIndex + 11) % 12; draw(); };
    $('#next').onclick = () => { setIndex = (setIndex + 1) % 12; draw(); };
    $('#back').onclick = localHome;
  };

  draw();
}

function selectorWaitingScreen(owner, movie, back) {
  game.innerHTML = `
    <div class="choice-head"><div>
      <h2>Card selected: ${localState.cardIndex + 1}</h2>
      <p class="muted">Tell ${config.players[owner]}: Set ${localState.setIndex + 1}, Card ${localState.cardIndex + 1}. They choose the movie time on their phone and tell you the time.</p>
    </div><span class="player-badge">Selector</span></div>
    <div class="result"><strong>${esc(movie.en)}</strong><br>${esc(movie.es)}</div>
    <div class="actions">
      <button class="primary-btn" id="verify-time" type="button">Enter the chosen time</button>
      <button class="secondary-btn" id="back" type="button">Back</button>
    </div>`;

  $('#verify-time').onclick = () =>
    timeForm(movie, minute => frameScreen(movie, minute, true, () => localRoundComplete()), true,
      () => selectorWaitingScreen(owner, movie, back));
  $('#back').onclick = back;
}

function guessLocal(owner, pool) {
  game.innerHTML = `
    <div class="choice-head"><div>
      <h2>Enter the spoken selection</h2>
      <p class="muted">${esc(config.players[owner])} should tell you the set and card number. Your phone will not reveal the movie title.</p>
    </div><span class="player-badge">Guesser</span></div>
    <div class="time-grid">
      <div><label for="set">Set (1–12)</label><input id="set" type="number" min="1" max="12" placeholder="1"></div>
      <div><label for="card">Card (1–7)</label><input id="card" type="number" min="1" max="7" placeholder="1"></div>
    </div>
    <div class="actions">
      <button class="primary-btn" id="continue" type="button">Choose time</button>
      <button class="secondary-btn" id="back" type="button">Back</button>
    </div>`;

  $('#back').onclick = localHome;
  $('#continue').onclick = () => {
    const setNumber = +$('#set').value;
    const cardNumber = +$('#card').value;
    if (!Number.isInteger(setNumber) || !Number.isInteger(cardNumber) || setNumber < 1 || setNumber > 12 || cardNumber < 1 || cardNumber > 7) {
      alert('Enter a set from 1–12 and a card from 1–7.');
      return;
    }
    const index = (setNumber - 1) * 7 + (cardNumber - 1);
    const movie = pool[index];
    if (!movie) {
      alert('That set/card is not available.');
      return;
    }
    guessTimeScreen(owner, movie, setNumber, cardNumber, () => guessLocal(owner, pool));
  };
}

function guessTimeScreen(owner, movie, setNumber, cardNumber, back) {
  const hours = Math.floor(movie.minutes / 60);
  const minutes = movie.minutes % 60;
  game.innerHTML = `
    <div class="choice-head"><div>
      <h2>Choose the movie moment</h2>
      <p class="muted">You selected Set ${setNumber}, Card ${cardNumber}. Choose a whole-movie time, then tell ${esc(config.players[owner])} the exact time so they can verify the frame.</p>
    </div><span class="player-badge">Guesser</span></div>
    <div class="time-grid">
      <div><label for="hours">Hours</label><input id="hours" type="number" min="0" max="${hours}" value="0"></div>
      <div><label for="mins">Minutes</label><input id="mins" type="number" min="0" max="59" value="1"></div>
    </div>
    <div class="actions">
      <button class="primary-btn" id="show-frame" type="button">Show frame</button>
      <button class="secondary-btn" id="back" type="button">Back</button>
    </div>`;

  $('#back').onclick = back;
  $('#show-frame').onclick = () => {
    const total = (+$('#hours').value || 0) * 60 + (+$('#mins').value || 0);
    if (total < 0 || total > movie.minutes) {
      alert('Choose a time within this movie.');
      return;
    }
    const shot = imgFor(movie, total);
    game.innerHTML = `
      <div class="choice-head"><div>
        <h2>Your frame</h2>
        <p class="muted">Chosen time: ${formatTime(total)} · Frame ${shot.number}. Tell ${esc(config.players[owner])} the time, then enter your guess below.</p>
      </div><span class="player-badge">Guesser</span></div>
      <img class="frame" src="${shot.url}" alt="Movie frame">
      <div class="answer-row">
        <input id="answer" placeholder="Your movie answer" autocomplete="off">
        <button class="primary-btn" id="check" type="button">Check guess</button>
        <button class="secondary-btn" id="dont-know" type="button">I don't know</button>
      </div>
      <div id="result"></div>
      <div class="round-nav"><button class="secondary-btn" id="back" type="button">Back to selection</button></div>`;

    $('#back').onclick = back;
    $('#check').onclick = () => finishLocalGuess(movie, false);
    $('#dont-know').onclick = () => finishLocalGuess(movie, true);
  };
}

function timeForm(movie, onDone, showTitle = false, back = localHome) {
  const hours = Math.floor(movie.minutes / 60);
  const minutes = movie.minutes % 60;
  game.innerHTML = `
    <div class="choice-head"><div>
      <h2>${showTitle ? esc(movie.en) : 'Choose the moment'}</h2>
      <p class="muted">Choose a whole-movie time from 0:00 to ${hours}:${String(minutes).padStart(2, '0')}.</p>
    </div></div>
    <div class="time-grid">
      <div><label for="hours">Hours</label><input id="hours" type="number" min="0" max="${hours}" value="0"></div>
      <div><label for="mins">Minutes</label><input id="mins" type="number" min="0" max="59" value="1"></div>
    </div>
    <div class="actions">
      <button class="primary-btn" id="show-frame" type="button">Show frame</button>
      <button class="secondary-btn" id="back" type="button">Back</button>
    </div>`;

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

function frameScreen(movie, minute, holder, back = localHome) {
  const shot = imgFor(movie, minute);
  game.innerHTML = `
    <div class="choice-head"><div>
      <h2>${holder ? esc(movie.en) : 'Name this movie'}</h2>
      <p class="muted">${holder
        ? `Agreed time: ${formatTime(minute)} · Frame ${shot.number}. Wait for the guesser to check the answer.`
        : 'Enter your answer, then let the selector verify it.'}</p>
    </div></div>
    <img class="frame" src="${shot.url}" alt="Movie frame">
    ${holder ? '' : `
      <div class="answer-row">
        <input id="answer" placeholder="Your movie answer" autocomplete="off">
        <button class="primary-btn" id="check" type="button">Check guess</button>
        <button class="secondary-btn" id="dont-know" type="button">I don't know</button>
      </div>
      <div id="result"></div>`}
    ${holder ? `<div id="result"></div>` : ''}
    <div class="round-nav">
      ${holder
        ? `<button class="primary-btn" id="next-round" type="button">Next round</button>`
        : `<button class="secondary-btn" id="back" type="button">Back to selection</button>`}
    </div>`;

  if (holder) {
    $('#next-round').onclick = localRoundComplete;
  } else {
    $('#back').onclick = back;
    $('#check').onclick = () => finishLocalGuess(movie, false);
    $('#dont-know').onclick = () => finishLocalGuess(movie, true);
  }
}

function finishLocalGuess(movie, dontKnow) {
  const points = dontKnow ? 0 : grade($('#answer').value, movie);
  const result = $('#result');
  result.innerHTML = `<div class="result">${
    dontKnow
      ? 'I don’t know — 0 points.'
      : points === 1
        ? 'Correct — 1 point.'
        : points === 0.5
          ? 'Partial match — 0.5 point.'
          : 'No match — 0 points.'
  }</div>`;

  $('#check').disabled = true;
  $('#dont-know').disabled = true;

  const nav = document.createElement('div');
  nav.className = 'round-nav';
  nav.innerHTML = `<button class="primary-btn" id="next-round" type="button">Next round</button>`;
  result.after(nav);
  $('#next-round').onclick = localRoundComplete;
}

function localRoundComplete() {
  round++;
  localState = null;
  localHome();
}

/* Worldwide Premiere --------------------------------------------------- */

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
  worldState = {
    active, movie, minute, shot,
    submitted: false, submittedAt: null, correct: false, clockStart: null, started: false
  };

  setHeader(
    'Worldwide Premiere',
    `${config.players[me]} — round ${round + 1}`,
    `${config.players[active]} is active. Everyone receives the same frame.`
  );

  game.innerHTML = `
    <div class="choice-head"><div>
      <h2>Ready for round ${round + 1}?</h2>
      <p class="muted">Everyone can scan their QR code and get ready here. No timer has started yet. When everyone is ready, agree on a count of 3 and tap Start round together.</p>
    </div><span class="player-badge">${esc(config.players[active])} active</span></div>
    <div class="result">
      <strong>Round ${round + 1}</strong><br>
      ${esc(config.players[active])} is the active player. Everyone else can steal if the active player misses.
    </div>
    <div class="actions">
      <button class="primary-btn" id="start-world" type="button">Start round</button>
    </div>`;

  $('#start-world').onclick = startWorldRound;
}

function startWorldRound() {
  const { active, movie, minute, shot } = worldState;
  const activeMe = active === me;
  worldState.started = true;

  game.innerHTML = `
    <div class="choice-head"><div>
      <h2>${activeMe ? 'Your 10-second turn' : 'Steal clock ready'}</h2>
      <p class="muted">${activeMe
        ? 'You have 10 seconds to answer. Other players may submit privately at any time.'
        : 'Submit your answer privately. If the active player misses, the group compares correct submission times.'}</p>
    </div><span class="player-badge">${esc(config.players[active])} active</span></div>
    <img class="frame" src="${shot.url}" alt="Mystery movie frame">
    <div id="timer" class="timer">${activeMe ? '10.0' : '0.0'}</div>
    <div class="answer-row">
      <input id="answer" placeholder="Your movie answer" autocomplete="off">
      <button class="primary-btn" id="check" type="button">Check guess</button>
      <button class="secondary-btn" id="dont-know" type="button">I don't know</button>
    </div>
    <div id="result"></div>
    <div class="round-nav">
      <button class="secondary-btn" id="reveal" type="button">Reveal answer</button>
      <button class="primary-btn" id="next" type="button">Next round</button>
    </div>`;

  startClock(activeMe);
  $('#check').onclick = () => submitWorldAnswer(movie, false);
  $('#dont-know').onclick = () => submitWorldAnswer(movie, true);
  $('#reveal').onclick = () => revealWorld(movie, minute);
  $('#next').onclick = () => { round++; worldHome(); };
}

function submitWorldAnswer(movie, dontKnow) {
  if (worldState.submitted) return;
  worldState.submitted = true;
  worldState.submittedAt = performance.now();
  worldState.correct = !dontKnow && grade($('#answer').value, movie) === 1;

  const elapsed = worldState.submittedAt - worldState.clockStart;
  $('#result').innerHTML = `<div class="result">${
    dontKnow
      ? 'I don’t know — no steal eligibility.'
      : `Answer locked at <strong>${(elapsed / 1000).toFixed(2)}s</strong> — ${worldState.correct ? 'correct if the steal phase is reached.' : 'not a match.'}`
  }</div>`;

  $('#check').disabled = true;
  $('#dont-know').disabled = true;
}

function revealWorld(movie, minute) {
  clearInterval(timerId);
  $('#result').innerHTML = `<div class="result"><strong>${esc(movie.en)}</strong><br>${esc(movie.es)}<br>Selected time: ${formatTime(minute)} · Frame ${imgFor(movie, minute).number}</div>`;
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
    setHeader(
      'Game link unavailable',
      'Could not open this game',
      'Use a QR code generated from the setup page while the site is being served.'
    );
    game.innerHTML = '<p class="empty-state">This game link is incomplete or the movie catalog could not be loaded.</p>';
  }
})();
