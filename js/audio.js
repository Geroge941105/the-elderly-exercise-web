import { vibrateTap } from "./auth.js";

const GITHUB_MUSIC_API = "https://api.github.com/repos/Geroge941105/the-elderly-exercise-web/contents/music";
const bgmPlayer = document.getElementById("bgmPlayer");
const voiceFilePlayer = document.getElementById("voiceFilePlayer");

if (location.protocol.startsWith("http")) {
  bgmPlayer.crossOrigin = "anonymous";
  voiceFilePlayer.crossOrigin = "anonymous";
}

function clamp01(num) {
  return Number.isFinite(num) ? Math.min(1, Math.max(0, num)) : 0.5;
}

let voiceEnabled = localStorage.getItem("usr_voice_enabled") !== "false";
let bgmEnabled = localStorage.getItem("usr_bgm_enabled") !== "false";
let userVoiceVol = clamp01(parseFloat(localStorage.getItem("usr_voice_vol") ?? "0.9"));
let userBgmVol = clamp01(parseFloat(localStorage.getItem("usr_bgm_vol") ?? "0.35"));
let speechRate = localStorage.getItem("usr_speech_rate") === "slow" ? 0.76 : 0.92;
let voiceMode = localStorage.getItem("usr_voice_mode") === "taiwanese" ? "taiwanese" : "tts";

let workoutState = { active: false, paused: false };

let sharedAudioCtx = null;
let bgmMediaSource = null;
let bgmGainNode = null;
let voiceMediaSource = null;
let voiceGainNode = null;

let isDucking = false;
let duckSafetyTimer = null;
let bgmPreviewTimer = null;
let voicePreviewTimer = null;

// 防止 5 分鐘長時運動後半段語音被垃圾回收或吞音
let activeUtterances = [];
let speakDelayTimer = null;
let speechKeepAliveTimer = null;
let zhTwVoice = null;

let bgmPlaylist = [];
let currentTrackIdx = 0;
let bgmConsecutiveErrors = 0;
let bgmLoadedSourceSrc = "";

export function getAudioState() {
  return { voiceEnabled, bgmEnabled, userVoiceVol, userBgmVol, speechRate, voiceMode };
}

export function setWorkoutAudioState(state) {
  workoutState = { ...workoutState, ...state };
}

/* =========================================
   Web Audio API 雙軌 GainNode（支援 iOS 音量與淡入淡出）
   ========================================= */
export function initAudioContext() {
  try {
    if (!sharedAudioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx && sharedAudioCtx.state === "suspended") {
      sharedAudioCtx.resume().catch(() => {});
    }
    if (sharedAudioCtx && location.protocol.startsWith("http")) {
      if (!bgmMediaSource) {
        bgmMediaSource = sharedAudioCtx.createMediaElementSource(bgmPlayer);
        bgmGainNode = sharedAudioCtx.createGain();
        bgmGainNode.gain.setValueAtTime(bgmEnabled ? userBgmVol : 0, sharedAudioCtx.currentTime);
        bgmMediaSource.connect(bgmGainNode);
        bgmGainNode.connect(sharedAudioCtx.destination);
      }
      if (!voiceMediaSource) {
        voiceMediaSource = sharedAudioCtx.createMediaElementSource(voiceFilePlayer);
        voiceGainNode = sharedAudioCtx.createGain();
        voiceGainNode.gain.setValueAtTime(voiceEnabled ? userVoiceVol : 0, sharedAudioCtx.currentTime);
        voiceMediaSource.connect(voiceGainNode);
        voiceGainNode.connect(sharedAudioCtx.destination);
      }
    }
  } catch (e) {}
  return sharedAudioCtx;
}

function applyBgmGain(targetVol, rampSec = 0.25) {
  const safeVol = bgmEnabled ? clamp01(targetVol) : 0;
  if (bgmGainNode && sharedAudioCtx) {
    const now = sharedAudioCtx.currentTime;
    bgmGainNode.gain.cancelScheduledValues(now);
    bgmGainNode.gain.setValueAtTime(bgmGainNode.gain.value, now);
    bgmGainNode.gain.linearRampToValueAtTime(safeVol, now + rampSec);
  } else {
    try { bgmPlayer.volume = safeVol; } catch (e) {}
  }
}

function applyVoiceFileGain(targetVol) {
  const safeVol = voiceEnabled ? clamp01(targetVol) : 0;
  if (voiceGainNode && sharedAudioCtx) {
    const now = sharedAudioCtx.currentTime;
    voiceGainNode.gain.cancelScheduledValues(now);
    voiceGainNode.gain.setValueAtTime(safeVol, now);
  } else {
    try { voiceFilePlayer.volume = safeVol; } catch (e) {}
  }
}

export function setBgmDucking(duck, safetyMs = 6000) {
  isDucking = duck;
  if (duckSafetyTimer) { clearTimeout(duckSafetyTimer); duckSafetyTimer = null; }
  applyBgmGain(duck ? userBgmVol * 0.28 : userBgmVol, 0.25);
  if (duck) {
    duckSafetyTimer = setTimeout(() => setBgmDucking(false), safetyMs);
  }
}

/* =========================================
   動態歌單載入與播放
   ========================================= */
function formatTitle(path) {
  const base = String(path).split("/").pop() || "背景音樂";
  return decodeURIComponent(base).replace(/\.[^/.]+$/, "");
}

function normalizeUrl(file) {
  const t = String(file).trim();
  if (/^https?:\/\//i.test(t)) return t;
  return encodeURI(t.startsWith("./") || t.startsWith("/") ? t : `./${t}`);
}

function normalizeList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string" && item.trim()) return { title: formatTitle(item), url: normalizeUrl(item) };
      if (item && typeof item === "object" && (item.file || item.url)) {
        const p = item.file || item.url;
        return { title: (item.title && String(item.title).trim()) || formatTitle(p), url: normalizeUrl(p) };
      }
      return null;
    })
    .filter(Boolean);
}

let playlistPromise = null;

export function loadMusicPlaylist() {
  if (playlistPromise) return playlistPromise;
  playlistPromise = (async () => {
    try {
      const res = await fetch(`./music/playlist.json?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        const parsed = normalizeList(Array.isArray(data) ? data : data.tracks);
        if (parsed.length > 0) {
          bgmPlaylist = parsed;
          updateAudioControlsUI();
          return;
        }
      }
    } catch (e) {}

    try {
      const res = await fetch(GITHUB_MUSIC_API);
      if (res.ok) {
        const files = await res.json();
        if (Array.isArray(files)) {
          const rx = /\.(mp3|wav|ogg|m4a)$/i;
          bgmPlaylist = files
            .filter((f) => f.type === "file" && rx.test(f.name))
            .map((f) => ({ title: formatTitle(f.name), url: `./music/${encodeURIComponent(f.name)}` }));
        }
      }
    } catch (e) {}
    updateAudioControlsUI();
  })();
  return playlistPromise;
}

function getVolLevelText(pct) {
  if (pct <= 0) return "0% 靜音";
  if (pct <= 35) return `${pct}% 小聲`;
  if (pct <= 75) return `${pct}% 適中`;
  return `${pct}% 大聲`;
}

function paintSlider(slider, pct, color) {
  slider.value = pct;
  slider.style.background = `linear-gradient(to right, ${color} 0%, ${color} ${pct}%, #CBD5E1 ${pct}%, #CBD5E1 100%)`;
}

export function updateAudioControlsUI() {
  const vPct = voiceEnabled ? Math.round(userVoiceVol * 100) : 0;
  const bPct = bgmEnabled ? Math.round(userBgmVol * 100) : 0;

  document.querySelectorAll("[data-voice-toggle]").forEach((btn) => {
    btn.textContent = voiceEnabled ? "🔊 引導語音：開啟" : "🔇 引導語音：靜音";
    btn.classList.toggle("on", voiceEnabled);
    btn.classList.toggle("off", !voiceEnabled);
  });
  document.querySelectorAll("[data-bgm-toggle]").forEach((btn) => {
    btn.textContent = bgmEnabled ? "🎵 背景音樂：開啟" : "🔇 背景音樂：靜音";
    btn.classList.toggle("bgm-on", bgmEnabled);
    btn.classList.toggle("off", !bgmEnabled);
  });

  document.querySelectorAll("[data-voice-slider]").forEach((s) => paintSlider(s, vPct, "#1D4ED8"));
  document.querySelectorAll("[data-voice-label]").forEach((el) => (el.textContent = getVolLevelText(vPct)));
  document.querySelectorAll("[data-bgm-slider]").forEach((s) => paintSlider(s, bPct, "#15803D"));
  document.querySelectorAll("[data-bgm-label]").forEach((el) => (el.textContent = getVolLevelText(bPct)));

  document.querySelectorAll("[data-voice-mode]").forEach((btn) => {
    btn.textContent = voiceMode === "taiwanese" ? "🗣️ 語音：台語音檔(備援國語)" : "🗣️ 語音：國語合成";
  });

  const hasTracks = bgmPlaylist.length > 0;
  const cur = hasTracks ? bgmPlaylist[currentTrackIdx] : null;
  let statusMsg = "🎵 尚未偵測到音樂檔（請將 MP3 放入 music/）";
  if (hasTracks && !bgmEnabled) statusMsg = `🔇 背景音樂已靜音（歌單共 ${bgmPlaylist.length} 首）`;
  else if (hasTracks && workoutState.active && !workoutState.paused) statusMsg = `🎶 播放中 (${currentTrackIdx + 1}/${bgmPlaylist.length})：${cur.title}`;
  else if (hasTracks) statusMsg = `🎵 待播 (${currentTrackIdx + 1}/${bgmPlaylist.length})：${cur.title}`;

  document.querySelectorAll("[data-bgm-status]").forEach((el) => (el.textContent = statusMsg));
  document.querySelectorAll("[data-bgm-next]").forEach((btn) => (btn.disabled = bgmPlaylist.length <= 1));
}

export function stopBgmPreview() {
  if (bgmPreviewTimer) { clearTimeout(bgmPreviewTimer); bgmPreviewTimer = null; }
}

function triggerBgmShortPreview() {
  if (workoutState.active || !bgmEnabled || bgmPlaylist.length === 0) return;
  stopBgmPreview();
  playBgmCurrentTrack(false);
  bgmPreviewTimer = setTimeout(() => {
    if (!workoutState.active) {
      applyBgmGain(0, 0.35);
      setTimeout(() => { if (!workoutState.active) bgmPlayer.pause(); }, 360);
    }
  }, 2000);
}

export function onVoiceSliderInput(val) {
  const pct = parseInt(val, 10);
  if (pct <= 0) {
    voiceEnabled = false;
    userVoiceVol = 0;
    stopAllVoicePlayback();
  } else {
    voiceEnabled = true;
    userVoiceVol = clamp01(pct / 100);
    applyVoiceFileGain(userVoiceVol);
  }
  localStorage.setItem("usr_voice_enabled", String(voiceEnabled));
  localStorage.setItem("usr_voice_vol", String(userVoiceVol));
  updateAudioControlsUI();
}

export function scheduleVoicePreview() {
  if (voicePreviewTimer) clearTimeout(voicePreviewTimer);
  voicePreviewTimer = setTimeout(() => {
    if (!voiceEnabled || userVoiceVol <= 0) return;
    initAudioContext();
    if (workoutState.active) playRhythmTone(true);
    else speakText(`目前的語音音量為${getVolLevelText(Math.round(userVoiceVol * 100))}`);
  }, 350);
}

export function stepVoiceVolume(deltaPct) {
  vibrateTap();
  const base = voiceEnabled ? Math.round(userVoiceVol * 100) : 0;
  onVoiceSliderInput(Math.min(100, Math.max(0, base + deltaPct)));
  scheduleVoicePreview();
}

export function onBgmSliderInput(val, allowHomePreview = false) {
  const pct = parseInt(val, 10);
  initAudioContext();
  if (pct <= 0) {
    bgmEnabled = false;
    userBgmVol = 0;
    pauseBgm();
  } else {
    bgmEnabled = true;
    userBgmVol = clamp01(pct / 100);
    applyBgmGain(isDucking ? userBgmVol * 0.28 : userBgmVol, 0.1);
    if (workoutState.active && !workoutState.paused && bgmPlayer.paused) {
      playBgmCurrentTrack(false);
    } else if (allowHomePreview && !workoutState.active) {
      triggerBgmShortPreview();
    }
  }
  localStorage.setItem("usr_bgm_enabled", String(bgmEnabled));
  localStorage.setItem("usr_bgm_vol", String(userBgmVol));
  updateAudioControlsUI();
}

export function stepBgmVolume(deltaPct) {
  vibrateTap();
  const base = bgmEnabled ? Math.round(userBgmVol * 100) : 0;
  onBgmSliderInput(Math.min(100, Math.max(0, base + deltaPct)), !workoutState.active);
}

export function toggleVoice() {
  vibrateTap();
  voiceEnabled = !voiceEnabled;
  if (voiceEnabled && userVoiceVol === 0) {
    userVoiceVol = 0.8;
    localStorage.setItem("usr_voice_vol", "0.8");
  }
  localStorage.setItem("usr_voice_enabled", String(voiceEnabled));
  if (voiceEnabled) initAudioContext();
  else stopAllVoicePlayback();
  updateAudioControlsUI();
}

export function toggleBgm() {
  vibrateTap();
  bgmEnabled = !bgmEnabled;
  if (bgmEnabled && userBgmVol === 0) {
    userBgmVol = 0.35;
    localStorage.setItem("usr_bgm_vol", "0.35");
  }
  localStorage.setItem("usr_bgm_enabled", String(bgmEnabled));
  if (bgmEnabled) {
    initAudioContext();
    applyBgmGain(isDucking ? userBgmVol * 0.28 : userBgmVol, 0.2);
    if (workoutState.active && !workoutState.paused) playBgmCurrentTrack(false);
  } else {
    pauseBgm();
  }
  updateAudioControlsUI();
}

export function toggleVoiceMode() {
  vibrateTap();
  voiceMode = voiceMode === "tts" ? "taiwanese" : "tts";
  localStorage.setItem("usr_voice_mode", voiceMode);
  updateAudioControlsUI();
  speakText(voiceMode === "taiwanese" ? "已切換台語音檔模式，若未放音檔會自動使用國語引導" : "已切換為國語合成語音");
}

export function applySpeechRateUI() {
  const btn = document.getElementById("btnRateToggle");
  if (btn) btn.textContent = speechRate < 0.85 ? "🗣️ 語速：慢速" : "🗣️ 語速：標準";
}

export function toggleSpeechRate() {
  vibrateTap();
  speechRate = speechRate < 0.85 ? 0.92 : 0.76;
  localStorage.setItem("usr_speech_rate", speechRate < 0.85 ? "slow" : "normal");
  applySpeechRateUI();
  speakText(speechRate < 0.85 ? "已切換為慢速語音" : "已切換為標準語音");
}

export async function playBgmCurrentTrack(forceReload = false) {
  if (!bgmEnabled) return;
  initAudioContext();
  await loadMusicPlaylist();
  if (bgmPlaylist.length === 0) { updateAudioControlsUI(); return; }

  const track = bgmPlaylist[currentTrackIdx];
  if (forceReload || bgmLoadedSourceSrc !== track.url) {
    bgmPlayer.src = track.url;
    bgmLoadedSourceSrc = track.url;
  }
  applyBgmGain(isDucking ? userBgmVol * 0.28 : userBgmVol, 0.3);
  try {
    await bgmPlayer.play();
    bgmConsecutiveErrors = 0;
  } catch (e) {}
  updateAudioControlsUI();
}

export function pauseBgm() {
  stopBgmPreview();
  applyBgmGain(0, 0.15);
  if (!bgmPlayer.paused) bgmPlayer.pause();
  updateAudioControlsUI();
}

export function nextTrack() {
  vibrateTap();
  if (bgmPlaylist.length === 0) return;
  currentTrackIdx = (currentTrackIdx + 1) % bgmPlaylist.length;
  bgmConsecutiveErrors = 0;
  if (workoutState.active && !workoutState.paused && bgmEnabled) {
    playBgmCurrentTrack(true);
  } else {
    bgmLoadedSourceSrc = "";
    updateAudioControlsUI();
    if (!workoutState.active && bgmEnabled) triggerBgmShortPreview();
  }
}

bgmPlayer.addEventListener("ended", () => {
  if (!bgmEnabled || !workoutState.active || workoutState.paused || bgmPlaylist.length === 0) return;
  if (bgmPlaylist.length === 1) {
    bgmPlayer.currentTime = 0;
    bgmPlayer.play().catch(() => {});
  } else {
    currentTrackIdx = (currentTrackIdx + 1) % bgmPlaylist.length;
    playBgmCurrentTrack(true);
  }
});

bgmPlayer.addEventListener("error", () => {
  if (bgmPlaylist.length === 0 || !workoutState.active || !bgmEnabled) return;
  bgmConsecutiveErrors++;
  if (bgmConsecutiveErrors < bgmPlaylist.length) {
    currentTrackIdx = (currentTrackIdx + 1) % bgmPlaylist.length;
    playBgmCurrentTrack(true);
  }
});

/* =========================================
   防失聲 Web Speech API 與節拍提示音
   ========================================= */
function loadZhTwVoice() {
  if (!("speechSynthesis" in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return;
  zhTwVoice =
    voices.find((v) => v.lang === "zh-TW") ||
    voices.find((v) => v.lang.toLowerCase().includes("zh-tw")) ||
    voices.find((v) => v.lang.toLowerCase().startsWith("zh")) ||
    null;
}
if ("speechSynthesis" in window) {
  loadZhTwVoice();
  window.speechSynthesis.onvoiceschanged = loadZhTwVoice;
}

export function startSpeechKeepAlive() {
  stopSpeechKeepAlive();
  speechKeepAliveTimer = setInterval(() => {
    if (!workoutState.active || workoutState.paused || !voiceEnabled) return;
    if ("speechSynthesis" in window && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  }, 15000);
}

export function stopSpeechKeepAlive() {
  if (speechKeepAliveTimer) { clearInterval(speechKeepAliveTimer); speechKeepAliveTimer = null; }
}

export function stopAllVoicePlayback() {
  if (speakDelayTimer) { clearTimeout(speakDelayTimer); speakDelayTimer = null; }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  activeUtterances = [];
  voiceFilePlayer.pause();
  setBgmDucking(false);
}

export function prewarmSpeech() {
  if (!voiceEnabled || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const silent = new SpeechSynthesisUtterance("");
    silent.volume = 0;
    window.speechSynthesis.speak(silent);
  } catch (e) {}
}

export function speakText(text, audioKey = null) {
  if (!voiceEnabled || userVoiceVol <= 0) return;

  if (voiceMode === "taiwanese" && audioKey) {
    initAudioContext();
    stopAllVoicePlayback();
    voiceFilePlayer.src = `./voice/${encodeURIComponent(audioKey)}.mp3`;
    applyVoiceFileGain(userVoiceVol);
    const release = () => setBgmDucking(false);
    voiceFilePlayer.onplay = () => { if (bgmEnabled) setBgmDucking(true, 12000); };
    voiceFilePlayer.onended = release;
    voiceFilePlayer.onpause = release;
    voiceFilePlayer.onabort = release;
    voiceFilePlayer.onerror = () => { release(); speakWithTTS(text); };
    voiceFilePlayer.play().catch(() => { release(); speakWithTTS(text); });
    return;
  }

  speakWithTTS(text);
}

export function speakWithTTS(text, forceVol = null) {
  const vol = forceVol !== null ? forceVol : userVoiceVol;
  if (vol <= 0 || !("speechSynthesis" in window)) return;
  if (forceVol === null && !voiceEnabled) return;

  try {
    if (speakDelayTimer) clearTimeout(speakDelayTimer);
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    window.speechSynthesis.cancel();

    speakDelayTimer = setTimeout(() => {
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "zh-TW";
        if (!zhTwVoice) loadZhTwVoice();
        if (zhTwVoice) u.voice = zhTwVoice;
        u.rate = speechRate;
        u.pitch = 1.05;
        u.volume = clamp01(vol);

        const cleanup = () => {
          activeUtterances = activeUtterances.filter((x) => x !== u);
          setBgmDucking(false);
        };
        u.onstart = () => {
          if (bgmEnabled) setBgmDucking(true, Math.max(4000, text.length * 480));
        };
        u.onend = cleanup;
        u.onerror = cleanup;

        activeUtterances.push(u);
        window.speechSynthesis.speak(u);
      } catch (e) {
        setBgmDucking(false);
      }
    }, 100);
  } catch (e) {
    setBgmDucking(false);
  }
}

export function playRhythmTone(isAccent = true) {
  if (!voiceEnabled || userVoiceVol <= 0) return;
  const ctx = initAudioContext();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(isAccent ? 560 : 420, ctx.currentTime);
    const peak = (isAccent ? 0.055 : 0.032) * userVoiceVol;
    gain.gain.setValueAtTime(Math.max(0.001, peak), ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.14);
  } catch (e) {}
}