const $ = selector => document.querySelector(selector);
const game = $('#game');
let config, me, movies, round = 0, timerId = null;
let localState = null;
let worldState = null;

function decode(value) {
  value = String(value || '').replaceAll('-', '+').replaceAll('_', '/');
  while (value.length % 4) value += '=';
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
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


function localRole() {
  // starter is the player who guesses in round 1. Roles alternate every round.
  const starter = Number.isInteger(config.starter) ? config.starter : (hash(config.seed) % 2);
  const guesser = (starter + round) % 2;
  return {
    guesser,
    selector: guesser === 0 ? 1 : 0,
    amGuesser: me === guesser
  };
}

function localPools() {
  const ordered = orderedMovies();
  return [ordered.slice(0, 84), ordered.slice(84, 168)];
}

function localRoundNumber() {
  return round + 1;
}

function persistRound() {
  try {
    localStorage.setItem(`frame:${config.seed}:${config.mode}:${me}:round`, String(round));
  } catch {}
}

function loadRound() {
  try {
    const value = Number(localStorage.getItem(`frame:${config.seed}:${config.mode}:${me}:round`));
    if (Number.isInteger(value) && value >= 0) round = value;
  } catch {}
}

function localHome() {
  clearInterval(timerId);
  const { guesser, selector, amGuesser } = localRole();
  const pools = localPools();
  const guesserName = config.players[guesser];
  const selectorName = config.players[selector];

  setHeader(
    'Local Screening',
    `${config.players[me]} — Round ${localRoundNumber()}`,
    `${guesserName} is the guesser. ${selectorName} is the selector. Roles switch automatically after each round.`
  );

  game.innerHTML = `
    <div class="choice-head"><div>
      <h2>${amGuesser ? 'You are the guesser' : 'You are the selector'}</h2>
      <p class="muted">${amGuesser
        ? `Wait for ${selectorName} to call the set and card. Then choose a time on your phone.`
        : `Choose a movie from ${guesserName}'s hidden 84-movie pool. You will verify the chosen time and hold the answer.`
      }</p>
    </div><span class="player-badge">${amGuesser ? 'Guesser' : 'Selector'}</span></div>
    <div class="result"><strong>Round ${localRoundNumber()}</strong><br>${amGuesser
      ? `Your job: choose the time, view the frame, and guess the movie.`
      : `Your job: choose the movie and verify the time.`
    }</div>
    <div class="actions">
      <button class="primary-btn" id="begin-round" type="button">${amGuesser ? 'Enter set & card' : 'Choose a movie'}</button>
    </div>`;

  $('#begin-round').onclick = () => {
    if (amGuesser) guessLocal(selector, pools[me === 0 ? 0 : 1]);
    else chooseLocal(guesser, pools[guesser]);
  };
}

function chooseLocal(guesser, pool) {
  let setIndex = localState?.setIndex ?? 0;
  const draw = () => {
    const batch = pool.slice(setIndex * 7, setIndex * 7 + 7);
    game.innerHTML = `
      <div class="choice-head"><div>
        <h2>Set ${setIndex + 1} of 12</h2>
        <p class="muted">Choose one movie. Tell ${config.players[guesser]} the set and card number only.</p>
      </div><span class="player-badge">Selector</span></div>
      <div class="movie-list">${batch.map((movie, i) =>
        `<button class="movie-choice" data-i="${i}" type="button"><strong>${i + 1}. ${esc(movie.en)}</strong><span>${esc(movie.es)}</span></button>`
      ).join('')}</div>
      <div class="round-nav">
        <button class="secondary-btn" id="prev" type="button">Previous set</button>
        <button class="secondary-btn" id="next" type="button">Next set</button>
      </div>`;

    document.querySelectorAll('[data-i]').forEach(button => {
      button.onclick = () => {
        const movie = batch[+button.dataset.i];
        localState = { setIndex, cardIndex: +button.dataset.i, movie };
        selectorWaitingScreen(guesser, movie, () => chooseLocal(guesser, pool));
      };
    });

    $('#prev').onclick = () => { setIndex = (setIndex + 11) % 12; draw(); };
    $('#next').onclick = () => { setIndex = (setIndex + 1) % 12; draw(); };
  };
  draw();
}

function selectorWaitingScreen(guesser, movie, back) {
  game.innerHTML = `
    <div class="choice-head"><div>
      <h2>Card selected: ${localState.cardIndex + 1}</h2>
      <p class="muted">Tell ${config.players[guesser]}: Set ${localState.setIndex + 1}, Card ${localState.cardIndex + 1}. They will choose the time on their phone.</p>
    </div><span class="player-badge">Selector</span></div>
    <div class="result"><strong>${esc(movie.en)}</strong><br>${esc(movie.es)}</div>
    <div class="actions">
      <button class="primary-btn" id="verify-time" type="button">Enter the chosen time</button>
      <button class="secondary-btn" id="back" type="button">Back</button>
    </div>`;
  $('#verify-time').onclick = () => timeForm(movie, minute => localSelectorFrame(movie, minute, guesser), true, back);
  $('#back').onclick = back;
}

function localSelectorFrame(movie, minute, guesser) {
  const shot = imgFor(movie, minute);
  game.innerHTML = `
    <div class="choice-head"><div>
      <h2>Answer holder</h2>
      <p class="muted">Verify that ${config.players[guesser]} used the same time. This is the answer-holder's screen.</p>
    </div><span class="player-badge">Selector</span></div>
    <img class="frame" src="${shot.url}" alt="Movie frame">
    <div class="result"><strong>${esc(movie.en)}</strong><br>${esc(movie.es)}<br>Chosen time: ${formatTime(minute)} · Frame ${shot.number}</div>
    <div class="actions">
      <button class="primary-btn" id="next-round" type="button">Next round</button>
    </div>`;
  $('#next-round').onclick = nextLocalRound;
}

function guessLocal(selector, myPool) {
  game.innerHTML = `
    <div class="choice-head"><div>
      <h2>Enter the spoken selection</h2>
      <p class="muted">${config.players[selector]} should tell you the set and card number. Your phone does not reveal the title.</p>
    </div><span class="player-badge">Guesser</span></div>
    <div class="time-grid">
      <div><label for="set">Set (1–12)</label><input id="set" type="number" min="1" max="12" placeholder="1"></div>
      <div><label for="card">Card (1–7)</label><input id="card" type="number" min="1" max="7" placeholder="1"></div>
    </div>
    <div class="actions">
      <button class="primary-btn" id="continue" type="button">Choose time</button>
    </div>`;
  $('#continue').onclick = () => {
    const setNumber = +$('#set').value;
    const cardNumber = +$('#card').value;
    if (!Number.isInteger(setNumber) || !Number.isInteger(cardNumber) ||
        setNumber < 1 || setNumber > 12 || cardNumber < 1 || cardNumber > 7) {
      alert('Enter a set from 1–12 and a card from 1–7.');
      return;
    }
    const index = (setNumber - 1) * 7 + (cardNumber - 1);
    const movie = myPool[index];
    if (!movie) { alert('That set/card is not available.'); return; }
    guessTimeScreen(selector, movie, setNumber, cardNumber);
  };
}

function guessTimeScreen(selector, movie, setNumber, cardNumber) {
  // The guesser does not need to know the movie runtime. Use the longest
  // runtime in the catalog as the neutral input range and let the selector
  // validate the actual movie/time on the other phone.
  const maxMinutes = Math.max(...movies.map(item => item.minutes));
  const maxHours = Math.floor(maxMinutes / 60);
  const maxMins = maxMinutes % 60;

  game.innerHTML = `
    <div class="choice-head"><div>
      <h2>Choose the moment</h2>
      <p class="muted">Set ${setNumber}, Card ${cardNumber}. Choose any whole-movie time from 0:00 to ${maxHours}:${String(maxMins).padStart(2, '0')}, then tell the selector the exact time.</p>
    </div><span class="player-badge">Guesser</span></div>
    <div class="time-grid">
      <div><label for="hours">Hours</label><input id="hours" type="number" min="0" max="${maxHours}" value="0"></div>
      <div><label for="mins">Minutes</label><input id="mins" type="number" min="0" max="59" value="1"></div>
    </div>
    <div class="actions">
      <button class="primary-btn" id="show-frame" type="button">Show frame</button>
    </div>`;

  $('#show-frame').onclick = () => {
    const total = (+$('#hours').value || 0) * 60 + (+$('#mins').value || 0);
    if (total < 0 || total > maxMinutes) {
      alert('Choose a time within the available range.');
      return;
    }
    const shot = imgFor(movie, total);
    game.innerHTML = `
      <div class="choice-head"><div>
        <h2>Name this movie</h2>
        <p class="muted">Time: ${formatTime(total)} · Frame ${shot.number}. Tell ${config.players[selector]} the time, then enter your guess.</p>
      </div><span class="player-badge">Guesser</span></div>
      <img class="frame" src="${shot.url}" alt="Movie frame">
      <div class="answer-row">
        <input id="answer" placeholder="Your movie answer" autocomplete="off">
        <button class="primary-btn" id="check" type="button">Check guess</button>
        <button class="secondary-btn" id="dont-know" type="button">I don't know</button>
      </div>
      <div id="result"></div>
      <div class="round-nav"></div>`;

    $('#check').onclick = () => {
      const points = grade($('#answer').value, movie);
      showLocalGuessResult(points);
    };
    $('#dont-know').onclick = () => {
      showLocalGuessResult(0, true);
    };
  };
}

function showLocalGuessResult(points, dontKnow = false) {
  const result = $('#result');
  const message = dontKnow
    ? "I don't know — 0 points. The selector has the answer."
    : points === 1
      ? 'Correct — 1 point.'
      : points === 0.5
        ? 'Partial match — 0.5 point.'
        : 'No match — 0 points.';
  result.innerHTML = `<div class="result">${message}</div>`;
  $('#check').disabled = true;
  $('#dont-know').disabled = true;
  document.querySelector('.round-nav').innerHTML =
    '<button class="primary-btn" id="next-round" type="button">Next round</button>';
  $('#next-round').onclick = nextLocalRound;
}

function nextLocalRound() {
  round++;
  localState = null;
  persistRound();
  localHome();
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

  setHeader(
    'Worldwide Premiere',
    `${config.players[me]} — round ${round + 1}`,
    `${config.players[active]} is active. Everyone receives the same frame.`
  );

  game.innerHTML = `
    <div class="choice-head"><div>
      <h2>${activeMe ? 'Your 10-second turn' : 'Steal clock ready'}</h2>
      <p class="muted">${activeMe
        ? 'You have 10 seconds to answer. Other players may submit privately at any time.'
        : 'Submit your answer privately. If the active player misses, the group compares correct submission times.'
      }</p>
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
  $('#check').onclick = () => submitWorldAnswer(movie);
  $('#dont-know').onclick = () => submitWorldAnswer(movie, true);
  $('#reveal').onclick = () => revealWorld(movie, minute);
  $('#next').onclick = () => { round++; persistRound(); worldHome(); };
}

function submitWorldAnswer(movie, dontKnow = false) {
  if (worldState.submitted) return;
  worldState.submitted = true;
  worldState.submittedAt = performance.now();
  worldState.correct = !dontKnow && grade($('#answer').value, movie) === 1;
  const elapsed = worldState.submittedAt - worldState.clockStart;
  clearInterval(timerId);
  const message = dontKnow
    ? `I don't know — locked at <strong>${(elapsed / 1000).toFixed(2)}s</strong>.`
    : `Answer locked at <strong>${(elapsed / 1000).toFixed(2)}s</strong> — ${worldState.correct ? 'correct if the steal phase is reached.' : 'not a match.'}`;
  $('#result').innerHTML = `<div class="result">${message}</div>`;
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
        $('#result').innerHTML = '<div class="result">Time is up. The steal phase can begin.</div>';
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

    const response = await fetch(new URL('movies.txt', document.baseURI), { cache: 'no-store' });
    if (!response.ok) throw Error('catalog');
    movies = parseCatalog(await response.text());
    if (movies.length !== 168) throw Error(`catalog-count:${movies.length}`);
    loadRound();
    home();
  } catch (error) {
    console.error('Frame failed to load:', error);
    const reason = error?.message || String(error);
    setHeader('Game link unavailable', 'Could not open this game', 'Check that this QR was generated from the current Frame setup page and that the site is being served.');
    game.innerHTML = `<p class="empty-state">This game link could not be loaded.<br><span class="small">${esc(reason)}</span></p>`;
  }
})();
