(() => {
  'use strict';
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const TILE = 32, COLS = 22, ROWS = 16, W = TILE * COLS, H = TILE * ROWS;
  const map = Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) =>
    x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? '#' : '.'));
  const wall = (x, y) => { map[y][x] = '#'; };
  // Interior partitions make six connected rooms around the central passage.
  for (let x = 1; x <= 20; x++) wall(x, 7);
  for (const x of [4, 10, 17]) map[7][x] = '.';
  for (let y = 1; y <= 6; y++) { wall(7, y); wall(14, y); }
  for (const y of [4]) { map[y][7] = '.'; map[y][14] = '.'; }
  for (let y = 8; y <= 14; y++) { wall(7, y); wall(14, y); }
  for (const y of [11]) { map[y][7] = '.'; map[y][14] = '.'; }
  const exit = { x: 2, y: 1 };
  const itemSpots = { key: { x: 4, y: 3 }, cutters: { x: 18, y: 3 }, note: { x: 10, y: 12 } };
  const closetSpots = [{ x: 2, y: 10 }, { x: 11, y: 4 }, { x: 19, y: 10 }];
  const patrol = [{ x: 11, y: 5 }, { x: 13, y: 5 }, { x: 13, y: 11 }, { x: 18, y: 11 }, { x: 18, y: 3 }, { x: 16, y: 3 }, { x: 16, y: 11 }, { x: 10, y: 11 }, { x: 4, y: 11 }, { x: 4, y: 3 }, { x: 11, y: 5 }];
  const held = new Set();
  const ui = {
    overlay: document.getElementById('overlay'), title: document.getElementById('overlayTitle'),
    copy: document.getElementById('overlayCopy'), kicker: document.getElementById('overlayKicker'),
    start: document.getElementById('startBtn'), toast: document.getElementById('toast'),
    meter: document.getElementById('meterFill'), meterState: document.getElementById('meterState'),
    foot: document.getElementById('footMessage'), status: document.getElementById('statusText'),
    statusBox: document.querySelector('.alert-status'), step: document.getElementById('stepCount'),
    codeClue: document.getElementById('codeClue'), clueValue: document.getElementById('clueValue'),
    keypad: document.getElementById('keypad'), code: document.getElementById('codeDisplay'),
    objectives: document.getElementById('objectives'), sound: document.getElementById('soundBtn')
  };
  const state = {
    running: false, finished: false, caught: false, player: { x: 3, y: 12 }, guard: { x: 11, y: 5, dir: { x: 1, y: 0 } },
    items: { key: false, cutters: false, note: false }, code: '', hiding: false, suspicion: 0,
    lastMove: 0, lastGuard: 0, guardTarget: null, routeIndex: 0, routePath: [], chaseUntil: 0,
    noise: null, lastNoise: 0, facing: { x: 1, y: 0 }, keypadInput: '', toastTimer: 0,
    soundOn: true, audio: null, particles: [], startTime: 0, lastFrame: 0
  };
  let dpr = 1;
  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  function passable(x, y) { return x >= 0 && y >= 0 && x < COLS && y < ROWS && map[y][x] !== '#'; }
  function pointKey(p) { return `${p.x},${p.y}`; }
  function pathfind(start, goal) {
    if (!goal || (start.x === goal.x && start.y === goal.y)) return [];
    const queue = [start], came = new Map([[pointKey(start), null]]), dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
    let found = false;
    while (queue.length) {
      const p = queue.shift();
      if (p.x === goal.x && p.y === goal.y) { found = true; break; }
      for (const d of dirs) { const n = { x: p.x + d.x, y: p.y + d.y }, k = pointKey(n); if (passable(n.x, n.y) && !came.has(k)) { came.set(k, p); queue.push(n); } }
    }
    if (!found) return [];
    const result = []; let at = goal;
    while (at && !(at.x === start.x && at.y === start.y)) { result.unshift(at); at = came.get(pointKey(at)); }
    return result;
  }
  function tone(freq = 440, duration = .08, type = 'sine', volume = .035) {
    if (!state.soundOn) return;
    try {
      state.audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (state.audio.state === 'suspended') state.audio.resume();
      const o = state.audio.createOscillator(), g = state.audio.createGain(), now = state.audio.currentTime;
      o.type = type; o.frequency.setValueAtTime(freq, now); g.gain.setValueAtTime(volume, now); g.gain.exponentialRampToValueAtTime(.001, now + duration);
      o.connect(g); g.connect(state.audio.destination); o.start(now); o.stop(now + duration);
    } catch (_) { /* Audio is an optional flourish. */ }
  }
  function showToast(message, duration = 1900) {
    ui.toast.textContent = message; ui.toast.classList.add('show'); clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => ui.toast.classList.remove('show'), duration);
  }
  function setObjective(name) { const row = ui.objectives.querySelector(`[data-objective="${name}"]`); if (row) row.classList.add('done'); }
  function objectiveCount() { return Object.values(state.items).filter(Boolean).length; }
  function updateHUD() {
    ui.step.textContent = `${objectiveCount()} / 3`;
    ui.meter.style.width = `${Math.max(0, Math.min(100, state.suspicion))}%`;
    const danger = state.suspicion > 8;
    ui.meterState.textContent = danger ? 'SEEN' : 'CLEAR'; ui.meterState.classList.toggle('danger', danger);
    ui.status.textContent = state.hiding ? 'HIDDEN' : danger ? 'ALERT' : state.guardTarget ? 'SEARCHING' : 'QUIET';
    ui.statusBox.classList.toggle('alerted', danger || !!state.guardTarget);
    ui.foot.textContent = state.hiding ? 'Hold still. Let him pass.' : danger ? 'He can see you—break line of sight!' : state.guardTarget ? 'He heard something. Stay out of sight.' : 'Stay out of the light.';
  }
  function collect() {
    for (const [name, pos] of Object.entries(itemSpots)) {
      if (!state.items[name] && state.player.x === pos.x && state.player.y === pos.y) {
        state.items[name] = true; setObjective(name); tone(name === 'note' ? 660 : 520, .15, 'triangle', .05);
        if (name === 'key') showToast('FOUND: The cabin key. One lock down.');
        if (name === 'cutters') showToast('FOUND: Bolt cutters. The chain won’t hold you.');
        if (name === 'note') { state.code = '2412'; ui.codeClue.hidden = false; ui.clueValue.textContent = '2 4 1 2'; showToast('FOUND: A note with the shed code — 2412.'); }
      }
    }
  }
  function movePlayer(dx, dy, now, sprint) {
    if (!state.running || state.hiding || ui.keypad.hidden === false) return;
    const nx = state.player.x + dx, ny = state.player.y + dy;
    if (!passable(nx, ny)) { tone(100, .035, 'sine', .009); return; }
    state.player.x = nx; state.player.y = ny; state.facing = { x: dx, y: dy };
    state.lastMove = now; collect();
    if (sprint) { state.noise = { x: nx, y: ny }; state.lastNoise = now; tone(115, .035, 'triangle', .008); }
    else tone(170, .025, 'sine', .006);
    if (state.guardTarget && state.suspicion < 12) state.chaseUntil = now + 1900;
  }
  function moveGuard(now) {
    let target;
    if (state.guardTarget && now < state.chaseUntil) target = state.guardTarget;
    else if (state.noise && now - state.lastNoise < 1050 && Math.abs(state.guard.x - state.noise.x) + Math.abs(state.guard.y - state.noise.y) < 8) target = state.noise;
    else {
      state.guardTarget = null; state.noise = null;
      const waypoint = patrol[state.routeIndex % patrol.length];
      if (state.guard.x === waypoint.x && state.guard.y === waypoint.y) state.routeIndex++;
      target = patrol[state.routeIndex % patrol.length];
    }
    let route = pathfind(state.guard, target);
    if (!route.length && target && !(target.x === state.guard.x && target.y === state.guard.y)) route = pathfind(state.guard, patrol[state.routeIndex % patrol.length]);
    if (route.length) {
      const next = route[0]; state.guard.dir = { x: next.x - state.guard.x, y: next.y - state.guard.y }; state.guard.x = next.x; state.guard.y = next.y;
    }
  }
  function seesPlayer() {
    if (state.hiding) return false;
    const dx = state.player.x - state.guard.x, dy = state.player.y - state.guard.y, dist = Math.hypot(dx, dy);
    if (dist > 6.1) return false;
    const dot = dist < 1.6 ? 1 : (dx * state.guard.dir.x + dy * state.guard.dir.y) / dist;
    if (dot < .42) return false;
    const steps = Math.ceil(dist * 5);
    for (let i = 1; i < steps; i++) { const x = Math.floor(state.guard.x + dx * i / steps), y = Math.floor(state.guard.y + dy * i / steps); if (!passable(x, y)) return false; }
    return true;
  }
  function interact() {
    if (!state.running || ui.keypad.hidden === false) return;
    if (state.hiding) { state.hiding = false; showToast('You slip out of the closet.'); tone(330, .07); updateHUD(); return; }
    const closet = closetSpots.find(p => Math.abs(p.x - state.player.x) + Math.abs(p.y - state.player.y) <= 1);
    if (closet) { state.hiding = true; state.guardTarget = null; state.suspicion = Math.max(0, state.suspicion - 15); showToast('Hidden. Wait for the footsteps to fade.'); tone(480, .1, 'triangle'); updateHUD(); return; }
    if (Math.abs(exit.x - state.player.x) + Math.abs(exit.y - state.player.y) <= 1) {
      if (!state.items.key || !state.items.cutters || !state.items.note) { const missing = !state.items.key ? 'key' : !state.items.cutters ? 'bolt cutters' : 'shed code'; showToast(`The door is still secured. You need the ${missing}.`); tone(120, .1); return; }
      state.keypadInput = ''; ui.code.textContent = '_ _ _ _'; ui.keypad.hidden = false; tone(550, .1, 'triangle'); return;
    }
    showToast('Nothing to use here. Look for a closet or the front door.', 1500);
  }
  function renderKeypad() { ui.code.textContent = state.keypadInput.padEnd(4, '_').split('').join(' '); }
  function addKeypadDigit(digit) { if (state.keypadInput.length < 4) { state.keypadInput += digit; renderKeypad(); } }
  function keypadEdit(action) { state.keypadInput = action === 'clear' ? '' : state.keypadInput.slice(0, -1); renderKeypad(); }
  function submitCode() {
    if (state.keypadInput === state.code) { ui.keypad.hidden = true; winGame(); }
    else { state.keypadInput = ''; renderKeypad(); showToast('That code didn’t work. Check the note.', 1400); tone(150, .2, 'square', .025); }
  }
  function openOverlay(kind) {
    ui.overlay.classList.remove('hidden'); state.running = false;
    if (kind === 'caught') { ui.kicker.textContent = 'OH NO · CAUGHT'; ui.title.innerHTML = 'Not this<br>Christmas.'; ui.copy.textContent = 'The kidnapper caught you before you could get out. Take a breath, learn his route, and try again.'; ui.start.innerHTML = 'TRY AGAIN <span>↻</span>'; }
    else if (kind === 'win') { ui.kicker.textContent = 'CHRISTMAS MIRACLE · 11:58 PM'; ui.title.innerHTML = 'Home for<br>the holidays.'; ui.copy.textContent = 'The lock clicks open. Cold winter air, distant bells, and the best Christmas treat of all: being safe. You made it out.'; ui.start.innerHTML = 'PLAY AGAIN <span>↻</span>'; }
  }
  function startGame() {
    state.running = true; state.finished = false; state.caught = false; state.player = { x: 3, y: 12 }; state.guard = { x: 11, y: 5, dir: { x: 1, y: 0 } };
    state.items = { key: false, cutters: false, note: false }; state.code = ''; state.hiding = false; state.suspicion = 0;
    state.lastMove = 0; state.lastGuard = performance.now(); state.guardTarget = null; state.routeIndex = 0; state.routePath = []; state.chaseUntil = 0; state.noise = null;
    state.facing = { x: 1, y: 0 }; state.startTime = performance.now(); held.clear(); ui.keypad.hidden = true;
    ui.objectives.querySelectorAll('li').forEach(li => li.classList.remove('done')); ui.codeClue.hidden = true; ui.clueValue.textContent = '— — — —';
    ui.overlay.classList.add('hidden'); ui.kicker.textContent = 'CHRISTMAS EVE · 11:47 PM'; ui.title.innerHTML = 'A little<br>holiday detour.'; ui.copy.textContent = 'You followed the smell of warm gingerbread. The door clicked shut behind you. Find the key, cut the chain, and get out before he comes back.'; ui.start.innerHTML = 'START SNEAKING <span>→</span>';
    updateHUD(); tone(520, .12, 'triangle', .03);
  }
  function winGame() { if (state.finished) return; state.finished = true; state.caught = false; tone(660, .15, 'sine', .04); setTimeout(() => tone(880, .28, 'sine', .035), 130); openOverlay('win'); }
  function catchPlayer() { if (state.finished) return; state.finished = true; state.caught = true; ui.keypad.hidden = true; tone(95, .4, 'sawtooth', .035); openOverlay('caught'); }

  function rounded(x, y, w, h, r, fill, stroke) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); } }
  function drawFloor(x, y) {
    const seed = (x * 19 + y * 31 + x * y * 7) % 4;
    ctx.fillStyle = ['#344641', '#374944', '#354742', '#394a45'][seed]; ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    ctx.strokeStyle = '#ffffff08'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x * TILE + 4, y * TILE + 10 + seed * 3); ctx.lineTo(x * TILE + 12, y * TILE + 10 + seed * 3); ctx.stroke();
    if ((x * 13 + y * 5) % 17 === 0) { ctx.fillStyle = '#bcaa7c20'; ctx.fillRect(x * TILE + 20, y * TILE + 22, 3, 1); }
  }
  function drawWall(x, y) {
    const px = x * TILE, py = y * TILE;
    ctx.fillStyle = '#192725'; ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = '#4c4b3b'; ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 3);
    ctx.fillStyle = '#635b43'; ctx.fillRect(px + 1, py + 1, TILE - 2, 4);
    ctx.fillStyle = '#393d30'; ctx.fillRect(px + 2, py + 7, TILE - 4, 1);
    ctx.fillStyle = '#312f28'; ctx.fillRect(px + 3, py + 12, 1, 18); ctx.fillRect(px + 19, py + 12, 1, 18);
  }
  function drawRug(x, y, w, h, color) {
    ctx.fillStyle = '#222f2b'; ctx.fillRect(x * TILE + 4, y * TILE + 4, w * TILE - 8, h * TILE - 8);
    ctx.fillStyle = color; ctx.globalAlpha = .63; ctx.fillRect(x * TILE + 7, y * TILE + 7, w * TILE - 14, h * TILE - 14); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#dfc78d66'; ctx.lineWidth = 1; ctx.strokeRect(x * TILE + 10, y * TILE + 10, w * TILE - 20, h * TILE - 20);
  }
  function drawFurniture(x, y, type, color = '#765947') {
    const px = x * TILE, py = y * TILE;
    if (type === 'table') { rounded(px + 3, py + 5, 26, 21, 3, '#222c29'); rounded(px + 3, py + 3, 26, 19, 3, color, '#a4815b'); ctx.fillStyle = '#cbb68b'; ctx.fillRect(px + 8, py + 8, 3, 3); ctx.fillRect(px + 21, py + 8, 3, 3); }
    if (type === 'shelf') { ctx.fillStyle = '#2c332d'; ctx.fillRect(px + 4, py + 2, 24, 28); ctx.fillStyle = color; ctx.fillRect(px + 5, py + 4, 22, 3); ctx.fillRect(px + 5, py + 14, 22, 3); ctx.fillRect(px + 5, py + 24, 22, 3); ctx.fillStyle = '#bf7260'; ctx.fillRect(px + 8, py + 7, 4, 7); ctx.fillStyle = '#d1b16e'; ctx.fillRect(px + 15, py + 7, 4, 7); ctx.fillStyle = '#809a78'; ctx.fillRect(px + 21, py + 7, 3, 7); }
    if (type === 'bed') { rounded(px + 2, py + 2, 28, 28, 3, '#333731'); ctx.fillStyle = '#8d544b'; ctx.fillRect(px + 4, py + 11, 24, 16); ctx.fillStyle = '#d8d0b6'; ctx.fillRect(px + 6, py + 5, 9, 7); ctx.fillRect(px + 17, py + 5, 9, 7); ctx.fillStyle = '#aa7362'; ctx.fillRect(px + 5, py + 14, 22, 11); }
    if (type === 'crate') { ctx.fillStyle = '#453c2c'; ctx.fillRect(px + 4, py + 5, 24, 22); ctx.strokeStyle = '#9b7952'; ctx.strokeRect(px + 6, py + 7, 20, 18); ctx.beginPath(); ctx.moveTo(px + 7, py + 8); ctx.lineTo(px + 25, py + 24); ctx.moveTo(px + 25, py + 8); ctx.lineTo(px + 7, py + 24); ctx.stroke(); }
  }
  function drawRoomDetails() {
    drawRug(2, 2, 4, 3, '#765a42'); drawRug(15, 2, 4, 3, '#557058'); drawRug(2, 9, 4, 4, '#715447'); drawRug(8, 9, 5, 4, '#605c46');
    drawFurniture(2, 2, 'shelf', '#805a42'); drawFurniture(5, 5, 'table', '#76553e');
    drawFurniture(16, 5, 'table', '#775840'); drawFurniture(19, 2, 'shelf', '#655740');
    drawFurniture(2, 13, 'crate', '#775640'); drawFurniture(5, 9, 'shelf', '#725138');
    drawFurniture(8, 13, 'table', '#74523d'); drawFurniture(12, 9, 'bed', '#74534c');
    drawFurniture(15, 9, 'crate', '#775640'); drawFurniture(19, 13, 'shelf', '#6b5540');
    // Cozy Christmas lights along the middle passage.
    const bulbs = ['#d77b59', '#e4be6c', '#7fa38a', '#bf7d73', '#d2ad63'];
    for (let i = 0; i < 10; i++) { const x = 1 + i * 2; ctx.fillStyle = '#d6c59444'; ctx.fillRect(x * TILE + 7, 8 * TILE + 3, 19, 1); ctx.beginPath(); ctx.arc(x * TILE + 13, 8 * TILE + 5, 2, 0, Math.PI * 2); ctx.fillStyle = bulbs[i % bulbs.length]; ctx.fill(); }
    // Small room plaques.
    const labels = [['STUDY', 2, 1], ['KITCHEN', 15, 1], ['STORAGE', 2, 8], ['BEDROOM', 8, 8], ['WORKSHOP', 15, 8]];
    ctx.font = '6px "DM Mono", monospace'; ctx.textAlign = 'left';
    for (const [text, x, y] of labels) { ctx.fillStyle = '#e3d4b14f'; ctx.fillText(text, x * TILE + 3, y * TILE + 12); }
  }
  function drawClosets() {
    for (const p of closetSpots) {
      const px = p.x * TILE, py = p.y * TILE;
      ctx.fillStyle = '#42382e'; ctx.fillRect(px + 4, py + 2, 24, 28); ctx.fillStyle = '#846443'; ctx.fillRect(px + 6, py + 4, 20, 24);
      ctx.fillStyle = '#a47a4e'; ctx.fillRect(px + 7, py + 5, 9, 22); ctx.fillStyle = '#745538'; ctx.fillRect(px + 17, py + 5, 8, 22);
      ctx.fillStyle = '#d7bd83'; ctx.fillRect(px + 13, py + 15, 2, 2); ctx.fillRect(px + 20, py + 15, 2, 2);
      ctx.fillStyle = '#e5d6b3'; ctx.font = '7px "DM Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText('E', px + 16, py + 31);
    }
  }
  function drawExit() {
    const px = exit.x * TILE, py = exit.y * TILE;
    ctx.fillStyle = '#203b32'; ctx.fillRect(px + 5, py + 2, 22, 29); ctx.fillStyle = '#806341'; ctx.fillRect(px + 8, py + 4, 16, 25);
    ctx.strokeStyle = '#d1b277'; ctx.lineWidth = 1; ctx.strokeRect(px + 10, py + 6, 12, 20);
    ctx.fillStyle = '#e2c36e'; ctx.beginPath(); ctx.arc(px + 20, py + 17, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ddc17b'; ctx.font = '6px "DM Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText('EXIT', px + 16, py + 31);
  }
  function drawItems() {
    for (const [name, p] of Object.entries(itemSpots)) {
      if (state.items[name]) continue;
      const x = p.x * TILE + 16, y = p.y * TILE + 16 + Math.sin(performance.now() / 230 + p.x) * 2;
      ctx.save(); ctx.shadowColor = '#f2d282'; ctx.shadowBlur = 12;
      if (name === 'key') { ctx.strokeStyle = '#e4c16e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x - 3, y - 2, 5, 0, Math.PI * 2); ctx.moveTo(x + 2, y + 1); ctx.lineTo(x + 9, y + 8); ctx.lineTo(x + 7, y + 10); ctx.moveTo(x + 5, y + 6); ctx.lineTo(x + 8, y + 3); ctx.stroke(); }
      if (name === 'cutters') { ctx.strokeStyle = '#d5aaa0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 5, y + 7); ctx.lineTo(x + 3, y - 1); ctx.lineTo(x + 6, y - 7); ctx.arc(x + 7, y - 7, 3, .2, 5.8); ctx.moveTo(x + 3, y - 1); ctx.lineTo(x + 7, y + 6); ctx.arc(x + 8, y + 7, 3, 3, 8); ctx.stroke(); }
      if (name === 'note') { ctx.fillStyle = '#e6d9b4'; ctx.fillRect(x - 7, y - 8, 14, 16); ctx.strokeStyle = '#9b8c68'; ctx.lineWidth = 1; ctx.strokeRect(x - 7, y - 8, 14, 16); ctx.fillStyle = '#8d7455'; ctx.fillRect(x - 4, y - 4, 8, 1); ctx.fillRect(x - 4, y, 7, 1); ctx.fillRect(x - 4, y + 4, 5, 1); }
      ctx.restore();
    }
  }
  function drawPlayer() {
    const x = state.player.x * TILE + TILE / 2, y = state.player.y * TILE + TILE / 2;
    if (state.hiding) { ctx.fillStyle = '#222620'; ctx.beginPath(); ctx.ellipse(x, y + 3, 9, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#bb6555'; ctx.fillRect(x - 5, y - 2, 10, 3); return; }
    ctx.fillStyle = '#17262288'; ctx.beginPath(); ctx.ellipse(x, y + 10, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#304e46'; ctx.beginPath(); ctx.ellipse(x, y + 4, 8, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d9b39a'; ctx.beginPath(); ctx.arc(x, y - 3, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b74e42'; ctx.beginPath(); ctx.arc(x, y - 5, 6, Math.PI, Math.PI * 2); ctx.lineTo(x + 6, y - 3); ctx.lineTo(x - 6, y - 3); ctx.fill();
    ctx.fillStyle = '#f0d7ae'; ctx.beginPath(); ctx.arc(x + 5, y - 5, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#28302b'; ctx.beginPath(); ctx.arc(x + state.facing.x * 2, y - 2 + state.facing.y, 1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d1b16e'; ctx.beginPath(); ctx.arc(x, y + 5, 1.5, 0, Math.PI * 2); ctx.fill();
  }
  function drawGuard() {
    const g = state.guard, x = g.x * TILE + 16, y = g.y * TILE + 16;
    ctx.save();
    // Wedge follows his facing and stops at walls.
    const angle = Math.atan2(g.dir.y, g.dir.x), half = .68, range = TILE * 6;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, range, angle - half, angle + half); ctx.closePath();
    ctx.fillStyle = state.guardTarget ? '#ed805026' : '#f1d89b1b'; ctx.fill();
    ctx.fillStyle = '#151d1a'; ctx.beginPath(); ctx.ellipse(x, y + 8, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a3731'; ctx.beginPath(); ctx.ellipse(x, y + 1, 8, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c6a889'; ctx.beginPath(); ctx.arc(x, y - 6, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#343b35'; ctx.beginPath(); ctx.arc(x, y - 8, 7, Math.PI, Math.PI * 2); ctx.fill(); ctx.fillRect(x - 7, y - 9, 14, 3);
    ctx.fillStyle = '#ead9bc'; ctx.fillRect(x + g.dir.x * 4 - 1, y - 6 + g.dir.y * 3, 2, 1);
    // warm flashlight beam source
    ctx.fillStyle = '#f5d992'; ctx.beginPath(); ctx.arc(x + g.dir.x * 8, y + g.dir.y * 8 - 1, 2, 0, Math.PI * 2); ctx.fill();
    if (state.guardTarget) { ctx.fillStyle = '#eb7959'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('!', x, y - 17); }
    ctx.restore();
  }
  function drawScene() {
    ctx.clearRect(0, 0, W, H);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (map[y][x] !== '#') drawFloor(x, y);
    drawRoomDetails(); drawClosets(); drawExit(); drawItems(); drawGuard(); drawPlayer();
    // Candle-lit halo around the player; the rest of the cabin stays wintry and dim.
    const px = state.player.x * TILE + 16, py = state.player.y * TILE + 16;
    const glow = ctx.createRadialGradient(px, py, 18, px, py, 220);
    glow.addColorStop(0, '#ddc68b09'); glow.addColorStop(1, '#09171566'); ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (map[y][x] === '#') drawWall(x, y);
    // Keep major characters legible above the room's edge vignette.
    drawGuard(); drawPlayer();
    if (state.noise && performance.now() - state.lastNoise < 650) {
      const n = state.noise, t = ((performance.now() - state.lastNoise) % 650) / 650;
      ctx.strokeStyle = `rgba(233,196,122,${.6 * (1 - t)})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(n.x * TILE + 16, n.y * TILE + 16, 7 + t * 20, 0, Math.PI * 2); ctx.stroke();
    }
    if (state.hiding) { ctx.fillStyle = '#101a1bb0'; ctx.fillRect(state.player.x * TILE - 4, state.player.y * TILE - 3, 40, 39); ctx.fillStyle = '#f3e7cb'; ctx.font = '8px "DM Mono",monospace'; ctx.textAlign = 'center'; ctx.fillText('HIDDEN', state.player.x * TILE + 16, state.player.y * TILE - 7); }
  }
  function tick(now) {
    if (state.running) {
      const directions = [
        ['ArrowUp', 'KeyW', 0, -1], ['ArrowDown', 'KeyS', 0, 1], ['ArrowLeft', 'KeyA', -1, 0], ['ArrowRight', 'KeyD', 1, 0]
      ];
      const move = directions.find(([a, b]) => held.has(a) || held.has(b));
      const sprint = held.has('ShiftLeft') || held.has('ShiftRight');
      if (move && now - state.lastMove > (sprint ? 105 : 165)) movePlayer(move[2], move[3], now, sprint);
      if (now - state.lastGuard > (state.guardTarget ? 340 : 570)) { moveGuard(now); state.lastGuard = now; }
      const visible = seesPlayer();
      if (visible) {
        state.suspicion = Math.min(100, state.suspicion + (state.guardTarget ? .72 : 1.25));
        state.guardTarget = { ...state.player }; state.chaseUntil = now + 2100;
      } else {
        state.suspicion = Math.max(0, state.suspicion - (state.hiding ? .9 : .28));
        if (state.guardTarget && now > state.chaseUntil) state.guardTarget = null;
      }
      if (state.suspicion >= 100 || (state.guardTarget && Math.abs(state.guard.x - state.player.x) + Math.abs(state.guard.y - state.player.y) <= 1 && !state.hiding)) catchPlayer();
      updateHUD();
    }
    drawScene(); requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  ui.start.addEventListener('click', startGame);
  ui.keypad.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button) return;
    if (button.dataset.digit !== undefined) addKeypadDigit(button.dataset.digit);
    else if (button.dataset.keyAction) keypadEdit(button.dataset.keyAction);
  });
  document.getElementById('codeConfirm').addEventListener('click', submitCode);
  ui.sound.addEventListener('click', () => { state.soundOn = !state.soundOn; ui.sound.innerHTML = state.soundOn ? '♫ <span>Sound on</span>' : '♪ <span>Sound off</span>'; if (state.soundOn) tone(520, .08); });
  document.addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (ui.keypad.hidden === false) {
      if (/^Digit\d$/.test(e.code) && state.keypadInput.length < 4) addKeypadDigit(e.code.slice(-1));
      else if (e.code === 'Backspace') keypadEdit('backspace');
      else if (e.code === 'Enter') submitCode();
      else if (e.code === 'Escape') ui.keypad.hidden = true;
      return;
    }
    if (e.code === 'KeyE' && !e.repeat) { interact(); return; }
    held.add(e.code);
  });
  document.addEventListener('keyup', e => held.delete(e.code));
  window.addEventListener('blur', () => held.clear());
  document.querySelectorAll('.dpad button').forEach(btn => {
    const dirs = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
    const code = dirs[btn.dataset.dir];
    btn.addEventListener('pointerdown', e => { e.preventDefault(); btn.setPointerCapture(e.pointerId); held.add(code); });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(name, () => held.delete(code));
  });
  document.getElementById('interactBtn').addEventListener('pointerdown', e => { e.preventDefault(); interact(); });
  const sprintButton = document.getElementById('sprintBtn');
  sprintButton.addEventListener('pointerdown', e => { e.preventDefault(); held.add('ShiftLeft'); });
  for (const name of ['pointerup', 'pointercancel', 'pointerleave']) sprintButton.addEventListener(name, () => held.delete('ShiftLeft'));
})();
