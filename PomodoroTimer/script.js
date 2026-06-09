/* =============================================
  CONSTANTS
  Fixed values that never change during the
  app's lifetime. The ring circumference is
  2 * π * 96 (the SVG circle's radius).
  JS uses this to calculate how much of the
  arc to show at any given second.
============================================= */
const CIRCUMFERENCE = 2 * Math.PI * 96; // ≈ 603

/* =============================================
  GRABBING ELEMENTS
  References to every HTML element we need
  to read or update. Stored once at the top
  so we don't search the page repeatedly.
============================================= */
const app           = document.getElementById('app');
const timerDigits   = document.getElementById('timer-digits');
const timerLabel    = document.getElementById('timer-label');
const ringProgress  = document.getElementById('ring-progress');
const startBtn      = document.getElementById('start-btn');
const resetBtn      = document.getElementById('reset-btn');
const skipBtn       = document.getElementById('skip-btn');
const clearBtn      = document.getElementById('clear-btn');
const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const applyBtn      = document.getElementById('apply-btn');
const setFocus      = document.getElementById('set-focus');
const setShort      = document.getElementById('set-short');
const setLong       = document.getElementById('set-long');
const modeTabs      = document.querySelectorAll('.mode-tab');
const dots          = document.querySelectorAll('.dot');

/* =============================================
  LOCALSTORAGE — LOAD SAVED SETTINGS
  On page load, we check if the user has
  previously saved settings. If so, we use
  those instead of the defaults.
  JSON.parse converts the stored string back
  into a JavaScript object.
============================================= */
function loadSettings() {
  const saved = localStorage.getItem('pomodoroSettings');
  return saved ? JSON.parse(saved) : {
    focus: 25,
    short: 5,
    long:  15
  };
}

function saveSettings(settings) {
  localStorage.setItem('pomodoroSettings', JSON.stringify(settings));
}

function loadSessionCount() {
  // We also save the date so sessions reset at midnight
  const saved = localStorage.getItem('pomodoroSessions');
  if (!saved) return 0;
  const { count, date } = JSON.parse(saved);
  const today = new Date().toDateString();
  return date === today ? count : 0; // reset if it's a new day
}

function saveSessionCount(count) {
  localStorage.setItem('pomodoroSessions', JSON.stringify({
    count,
    date: new Date().toDateString()
  }));
}

/* =============================================
  STATE
  All the values that describe what the app
  is doing right now. We keep them in one place
  so it's easy to see and change the full picture.
============================================= */
let settings     = loadSettings();
let sessionCount = loadSessionCount(); // total pomodoros today
let cycleCount   = 0;    // pomodoros in current cycle (resets after 4)
let mode         = 'focus';  // 'focus' | 'short' | 'long'
let totalSeconds = settings.focus * 60;
let remaining    = totalSeconds;
let isRunning    = false;
let ticker       = null;  // holds the setInterval reference

/* =============================================
  WEB AUDIO API — SOUND ALERT
  The Web Audio API lets us generate sound
  purely in JavaScript — no audio files needed.
  We create an "oscillator" (a sound wave
  generator) and play it for a short time.
  This plays a pleasant two-tone chime.
============================================= */
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    function tone(freq, startTime, duration, volume = 0.3) {
      const osc   = ctx.createOscillator();
      const gain  = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type      = 'sine';       // sine wave = smooth, pleasant tone
      osc.frequency.value = freq;

      // Fade out smoothly so it doesn't click/pop
      gain.gain.setValueAtTime(volume, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.start(startTime);
      osc.stop(startTime + duration);
    }

    const now = ctx.currentTime;
    tone(523, now,        0.25);  // C5
    tone(659, now + 0.15, 0.25);  // E5
    tone(784, now + 0.30, 0.4);   // G5
  } catch(e) {
    // Audio failed silently — not a critical feature
  }
}

/* =============================================
  DISPLAY UPDATE
  Converts remaining seconds into MM:SS format
  and updates the timer digits. Also updates
  the SVG ring arc by calculating what fraction
  of the circle should still be visible.
============================================= */
function updateDisplay() {
  const m = Math.floor(remaining / 60).toString().padStart(2, '0');
  const s = (remaining % 60).toString().padStart(2, '0');
  timerDigits.textContent = `${m}:${s}`;

  // Ring progress: what fraction of time is left?
  const fraction = remaining / totalSeconds;
  const offset   = CIRCUMFERENCE * (1 - fraction);
  ringProgress.style.strokeDashoffset = offset;

  // Update the browser tab title too
  document.title = `${m}:${s} — ${capitalize(mode)}`;
}

/* =============================================
  MODE SWITCH
  Changes between focus, short break, and
  long break. Updates the card's data-mode
  attribute (which CSS uses for accent colors),
  resets the timer, and updates labels.
============================================= */
function switchMode(newMode) {
  mode = newMode;
  app.dataset.mode = mode;

  // Set total duration based on mode
  if (mode === 'focus')  totalSeconds = settings.focus * 60;
  if (mode === 'short')  totalSeconds = settings.short * 60;
  if (mode === 'long')   totalSeconds = settings.long  * 60;

  remaining  = totalSeconds;
  isRunning  = false;
  clearInterval(ticker);
  startBtn.textContent = 'Start';

  // Update the label inside the ring
  const labels = { focus: 'Focus', short: 'Short Break', long: 'Long Break' };
  timerLabel.textContent = labels[mode];

  // Highlight the correct mode tab
  modeTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.target === mode);
  });

  updateDisplay();
}

/* =============================================
  SESSION DOTS UPDATE
  Fills in the dots based on how far through
  the current 4-session cycle we are.
  After 4 sessions, cycle resets.
============================================= */
function updateDots() {
  dots.forEach((dot, i) => {
    dot.classList.toggle('filled', i < cycleCount);
  });
}

/* =============================================
  SESSION COMPLETE
  Called when the timer reaches zero.
  Plays a chime, records the session, decides
  what comes next (short or long break),
  and flashes the card.
============================================= */
function onSessionComplete() {
  playChime();
  clearInterval(ticker);
  isRunning = false;

  // Flash the card background
  app.classList.remove('flash');
  void app.offsetWidth; // force reflow so animation re-triggers
  app.classList.add('flash');
  setTimeout(() => app.classList.remove('flash'), 800);

  if (mode === 'focus') {
    // Completed a focus session
    cycleCount++;
    sessionCount++;
    saveSessionCount(sessionCount);

    // Pulse the newly filled dot
    const dotEl = dots[cycleCount - 1];
    if (dotEl) {
      dotEl.classList.add('filled');
      dotEl.classList.add('pulse');
      setTimeout(() => dotEl.classList.remove('pulse'), 500);
    }

    // After 4 sessions → long break; otherwise → short break
    if (cycleCount >= 4) {
      cycleCount = 0;
      updateDots();
      switchMode('long');
    } else {
      updateDots();
      switchMode('short');
    }
  } else {
    // Break finished → back to focus
    switchMode('focus');
  }

  startBtn.textContent = 'Start';
}

/* =============================================
  TICK
  Called every second by setInterval.
  Decrements remaining time and checks if
  the timer has reached zero.
============================================= */
function tick() {
  remaining--;
  updateDisplay();
  if (remaining <= 0) onSessionComplete();
}

/* =============================================
  CONTROLS — Start / Pause / Reset / Skip
============================================= */
startBtn.addEventListener('click', () => {
  if (isRunning) {
    // Pause
    clearInterval(ticker);
    isRunning = false;
    startBtn.textContent = 'Resume';
  } else {
    // Start or Resume
    isRunning = true;
    startBtn.textContent = 'Pause';
    ticker = setInterval(tick, 1000);
  }
});

resetBtn.addEventListener('click', () => {
  clearInterval(ticker);
  isRunning = false;
  remaining = totalSeconds;
  startBtn.textContent = 'Start';
  updateDisplay();
});

skipBtn.addEventListener('click', () => {
  clearInterval(ticker);
  isRunning = false;
  onSessionComplete();
});

/* =============================================
  MODE TABS
  Clicking a tab manually switches the mode.
============================================= */
modeTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    clearInterval(ticker);
    switchMode(tab.dataset.target);
  });
});

/* =============================================
  CLEAR SESSIONS
  Resets today's session count and cycle dots.
============================================= */
clearBtn.addEventListener('click', () => {
  sessionCount = 0;
  cycleCount   = 0;
  saveSessionCount(0);
  updateDots();
});

/* =============================================
  SETTINGS PANEL — Toggle open / close
============================================= */
settingsToggle.addEventListener('click', () => {
  const isOpen = settingsPanel.classList.toggle('open');
  settingsToggle.classList.toggle('open', isOpen);
  settingsPanel.setAttribute('aria-hidden', !isOpen);
});

/* =============================================
  APPLY SETTINGS
  Reads the input values, validates them,
  saves to localStorage, and resets the timer.
============================================= */
applyBtn.addEventListener('click', () => {
  const newSettings = {
    focus: Math.min(60, Math.max(1, parseInt(setFocus.value) || 25)),
    short: Math.min(30, Math.max(1, parseInt(setShort.value) || 5)),
    long:  Math.min(60, Math.max(1, parseInt(setLong.value)  || 15))
  };

  settings = newSettings;
  saveSettings(settings);

  // Close the panel and reset the timer with new duration
  settingsPanel.classList.remove('open');
  settingsToggle.classList.remove('open');
  switchMode(mode);
});

/* =============================================
  INIT — Run on page load
  Populates the settings inputs from saved
  values, restores session dots, and renders
  the initial timer display.
============================================= */
function init() {
  // Populate settings inputs
  setFocus.value = settings.focus;
  setShort.value = settings.short;
  setLong.value  = settings.long;

  // Restore session dots for current cycle
  // (cycleCount starts at 0 each page load — cycle progress isn't persisted)
  updateDots();

  // Set up the ring's dasharray and render initial state
  ringProgress.style.strokeDasharray = CIRCUMFERENCE;
  switchMode('focus');
}

/* =============================================
  HELPERS
============================================= */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Kick everything off
init();
