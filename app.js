import { reverseChannels, trimSilence, peaks, encodeWav } from './audio.js';

// ponytail: tarature, da rivedere dopo l'uso reale
const MAX_SEC = 30;
const MIN_CLIP_SEC = 0.3;
const SPEED_MIN = 0.5;
const SPEED_MAX = 1.0;
// noiseSuppression a false se mangia le consonanti
const CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

const T = {
  it: {
    record: 'Registra', stop: 'Stop', original: 'Originale', reversed: 'Al contrario',
    speed: 'Velocità', download: 'Scarica', share: 'Condividi',
    lang: 'EN', langLabel: 'Switch to English',
    idle: 'Premi e di\' una frase',
    recording: 'Ti ascolto…',
    ready: 'Ascoltala al contrario e prova a imitarla',
    insecure: 'Serve HTTPS o localhost per usare il microfono',
    denied: 'Permesso microfono negato: abilitalo nelle impostazioni del sito',
    empty: 'Non ho sentito nulla, riprova',
    undecodable: 'Registrazione non leggibile, riprova',
  },
  en: {
    record: 'Record', stop: 'Stop', original: 'Original', reversed: 'Reversed',
    speed: 'Speed', download: 'Download', share: 'Share',
    lang: 'IT', langLabel: 'Passa all\'italiano',
    idle: 'Tap and say a sentence',
    recording: 'Listening…',
    ready: 'Play it backwards and try to copy it',
    insecure: 'HTTPS or localhost is required to use the microphone',
    denied: 'Microphone permission denied: enable it in the site settings',
    empty: "I didn't hear anything, try again",
    undecodable: 'Recording could not be read, try again',
  },
};

const $ = id => document.getElementById(id);
const ui = {
  rec: $('rec'), recLabel: $('rec-label'), timer: $('timer'), status: $('status'), lang: $('lang'),
  clip: $('clip'), wave: $('wave'), original: $('play-original'), reversed: $('play-reversed'),
  speed: $('speed'), speedOut: $('speed-out'), download: $('download'), share: $('share'),
};
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const css = getComputedStyle(document.documentElement);
const color = name => css.getPropertyValue(name).trim();

let lang;
try { lang = localStorage.lang; } catch {}
if (!T[lang]) lang = navigator.language?.startsWith('it') ? 'it' : 'en';
const t = k => T[lang][k];

let ctx, rec, clip, playing, timer, statusKey = 'idle';

// <audio> e non Web Audio: rallenta senza abbassare il tono (preservesPitch)
const player = new Audio();
player.preservesPitch = true;

const say = k => { statusKey = k; ui.status.textContent = k ? t(k) : ''; };
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtSpeed = v => new Intl.NumberFormat(lang).format(v) + '×';

function applyLang() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
  ui.recLabel.textContent = t(rec ? 'stop' : 'record');
  ui.speedOut.textContent = fmtSpeed(+ui.speed.value);
  say(statusKey);
}

// Avvia il microfono; stop() risolve con l'AudioBuffer decodificato e spegne il microfono
async function record() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: CONSTRAINTS });
  const mr = new MediaRecorder(stream), chunks = [];
  mr.ondataavailable = e => chunks.push(e.data);
  mr.start();
  return {
    stream,
    stop: () => new Promise(resolve => { mr.onstop = resolve; mr.stop(); })
      .finally(() => stream.getTracks().forEach(tr => tr.stop()))
      .then(() => new Blob(chunks, { type: mr.mimeType }).arrayBuffer())
      .then(data => ctx.decodeAudioData(data)),
  };
}

// Livello microfono sul pulsantone + timer, finché questa registrazione è attiva
function meter(r) {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const node = ctx.createMediaStreamSource(r.stream);
  node.connect(analyser);
  const buf = new Float32Array(analyser.fftSize), t0 = performance.now();
  const tick = () => {
    if (rec !== r) return node.disconnect(), ui.rec.style.setProperty('--level', 0);
    analyser.getFloatTimeDomainData(buf);
    const rms = Math.sqrt(buf.reduce((s, x) => s + x * x, 0) / buf.length);
    if (!reducedMotion) ui.rec.style.setProperty('--level', Math.min(1, rms * 5).toFixed(3));
    ui.timer.textContent = fmtTime((performance.now() - t0) / 1000);
    requestAnimationFrame(tick);
  };
  tick();
}

function setRecording(on) {
  ui.recLabel.textContent = t(on ? 'stop' : 'record');
  ui.rec.setAttribute('aria-pressed', on);
  ui.timer.classList.toggle('on', on);
  if (on) ui.timer.textContent = fmtTime(0);
}

// Forma d'onda a barre; durante l'ascolto la parte già suonata si colora
function drawWave() {
  if (!clip || ui.clip.hidden) return;
  const c = ui.wave, dpr = devicePixelRatio || 1;
  const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const bar = 4 * dpr, gap = 3 * dpr, n = Math.max(1, Math.floor((w + gap) / (bar + gap)));
  if (clip.bars?.length !== n) clip.bars = peaks(clip.samples, n);
  const rev = playing === 'reversed';
  const progress = playing ? (reducedMotion ? 1 : player.currentTime / clip.duration) : null;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = clip.bars[rev ? n - 1 - i : i];
    const bh = Math.max(bar, v * h);
    g.globalAlpha = progress === null || i / n < progress ? 1 : 0.25;
    g.fillStyle = progress === null ? color('--ink') : color(rev ? '--teal' : '--red');
    g.beginPath();
    g.roundRect(i * (bar + gap), (h - bh) / 2, bar, bh, bar / 2);
    g.fill();
  }
}

function render() {
  ui.original.setAttribute('aria-pressed', playing === 'original');
  ui.reversed.setAttribute('aria-pressed', playing === 'reversed');
  drawWave();
}

function stopPlayback() {
  playing = null;
  player.pause();
  render();
}

const setSpeed = v => { player.defaultPlaybackRate = player.playbackRate = v; }; // src nuovo azzera playbackRate

// Stesso pulsante: avvia o ferma; l'altro tipo di ascolto si interrompe
function play(kind) {
  const was = playing;
  stopPlayback();
  if (was === kind) return;
  playing = kind;
  player.src = clip.urls[kind];
  setSpeed(+ui.speed.value);
  player.play().catch(e => e.name !== 'AbortError' && stopPlayback()); // AbortError = cambio clip al volo
  const frame = () => {
    if (playing !== kind) return;
    drawWave();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  render();
}

// ponytail: solo il canale 0, il microfono è mono
function setClip(buf) {
  const samples = trimSilence(buf.getChannelData(0), buf.sampleRate);
  if (samples.length < MIN_CLIP_SEC * buf.sampleRate) return say('empty');
  const wav = data => new Blob([encodeWav(data, buf.sampleRate)], { type: 'audio/wav' });
  const original = wav(samples), reversed = wav(reverseChannels([samples])[0]);
  clip = {
    samples,
    duration: samples.length / buf.sampleRate,
    urls: { original: URL.createObjectURL(original), reversed: URL.createObjectURL(reversed) },
    file: new File([reversed], 'retrovoce.wav', { type: 'audio/wav' }),
  };
  ui.download.href = clip.urls.reversed;
  ui.share.hidden = !navigator.canShare?.({ files: [clip.file] });

  ui.clip.hidden = false;
  say('ready');
  drawWave();
}

async function start() {
  stopPlayback(); // altrimenti il microfono riprende la cassa
  if (clip) Object.values(clip.urls).forEach(u => URL.revokeObjectURL(u));
  clip = null;
  ui.clip.hidden = true;
  ctx ??= new AudioContext();
  ctx.resume();
  ui.rec.disabled = true;
  try {
    rec = await record();
    setRecording(true);
    say('recording');
    meter(rec);
    timer = setTimeout(finish, MAX_SEC * 1000);
  } catch {
    say('denied');
  } finally {
    ui.rec.disabled = false;
  }
}

async function finish() {
  const r = rec;
  rec = null;
  clearTimeout(timer);
  setRecording(false);
  say('');
  ui.rec.disabled = true;
  try {
    setClip(await r.stop());
  } catch {
    say('undecodable');
  } finally {
    ui.rec.disabled = false;
  }
}

ui.speed.min = SPEED_MIN;
ui.speed.max = SPEED_MAX;
ui.speed.value = SPEED_MAX;
applyLang();

if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
  ui.rec.disabled = true;
  say('insecure');
}

ui.rec.onclick = () => (rec ? finish() : start());
ui.original.onclick = () => play('original');
ui.reversed.onclick = () => play('reversed');
ui.speed.oninput = () => {
  ui.speedOut.textContent = fmtSpeed(+ui.speed.value);
  setSpeed(+ui.speed.value);
};
player.onended = stopPlayback;
ui.share.onclick = () => navigator.share({ files: [clip.file], title: 'Retrovoce' }).catch(() => {});
ui.lang.onclick = () => {
  lang = lang === 'it' ? 'en' : 'it';
  try { localStorage.lang = lang; } catch {}
  applyLang();
};
// barra spaziatrice = registra/stop, se il focus non è già su un controllo
document.addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.repeat || e.target.closest('button, input, a')) return;
  e.preventDefault();
  ui.rec.click();
});
// telefono bloccato o scheda nascosta: chiudi la registrazione pulita
document.addEventListener('visibilitychange', () => document.hidden && rec && finish());
addEventListener('resize', drawWave); // rotazione schermo

// installabile come app e usabile offline (vedi sw.js)
navigator.serviceWorker?.register('sw.js');
