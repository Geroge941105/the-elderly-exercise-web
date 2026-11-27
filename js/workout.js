import {
  getProfile,
  getActiveStreakDays,
  getHighestAutoBadgeId,
  saveProfileLocal,
  syncProfileToCloud,
  updateAllProfileUI,
  escapeHtml,
  vibrateTap,
  getLocalDateStr
} from "./auth.js";
import {
  initAudioContext,
  prewarmSpeech,
  speakText,
  stopAllVoicePlayback,
  playRhythmTone,
  playBgmCurrentTrack,
  pauseBgm,
  stopBgmPreview,
  updateAudioControlsUI,
  getAudioState,
  setWorkoutAudioState,
  setBgmDucking,
  startSpeechKeepAlive,
  stopSpeechKeepAlive
} from "./audio.js";
import { drawAchievementBadge, setLatestBadgeMeta } from "./badge-canvas.js";

const CHAIR_SEAT_SVG = `
  <rect x="46" y="132" width="108" height="14" rx="5" fill="#64748B"/>
  <line x1="56" y1="146" x2="56" y2="192" stroke="#475569" stroke-width="10" stroke-linecap="round"/>
  <line x1="144" y1="146" x2="144" y2="192" stroke="#475569" stroke-width="10" stroke-linecap="round"/>
`;
const CHAIR_SIDE_SVG = `
  <rect x="20" y="102" width="12" height="86" rx="4" fill="#94A3B8"/>
  <line x1="20" y1="138" x2="56" y2="138" stroke="#94A3B8" stroke-width="9" stroke-linecap="round"/>
  <line x1="52" y1="138" x2="52" y2="188" stroke="#94A3B8" stroke-width="8" stroke-linecap="round"/>
`;

const POSE_SVGS = {
  seatedArmsDown: `<svg viewBox="0 0 200 200" width="100%" height="100%">${CHAIR_SEAT_SVG}<circle cx="100" cy="44" r="21" fill="#1D4ED8"/><line x1="100" y1="65" x2="100" y2="128" stroke="#0F172A" stroke-width="14" stroke-linecap="round"/><line x1="100" y1="80" x2="66" y2="122" stroke="#1D4ED8" stroke-width="12" stroke-linecap="round"/><line x1="100" y1="80" x2="134" y2="122" stroke="#1D4ED8" stroke-width="12" stroke-linecap="round"/><polyline points="100,128 74,132 74,184" fill="none" stroke="#0F172A" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/><polyline points="100,128 126,132 126,184" fill="none" stroke="#0F172A" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  seatedArmsUp: `<svg viewBox="0 0 200 200" width="100%" height="100%">${CHAIR_SEAT_SVG}<path d="M38 66 L38 30 M30 40 L38 28 L46 40" fill="none" stroke="#15803D" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M162 66 L162 30 M154 40 L162 28 L170 40" fill="none" stroke="#15803D" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="100" cy="44" r="21" fill="#15803D"/><line x1="100" y1="65" x2="100" y2="128" stroke="#0F172A" stroke-width="14" stroke-linecap="round"/><line x1="100" y1="80" x2="58" y2="30" stroke="#15803D" stroke-width="12" stroke-linecap="round"/><line x1="100" y1="80" x2="142" y2="30" stroke="#15803D" stroke-width="12" stroke-linecap="round"/><polyline points="100,128 74,132 74,184" fill="none" stroke="#0F172A" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/><polyline points="100,128 126,132 126,184" fill="none" stroke="#0F172A" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  seatedArmsWide: `<svg viewBox="0 0 200 200" width="100%" height="100%">${CHAIR_SEAT_SVG}<path d="M52 60 L24 60 M32 52 L22 60 L32 68" fill="none" stroke="#B45309" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M148 60 L176 60 M168 52 L178 60 L168 68" fill="none" stroke="#B45309" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="100" cy="44" r="21" fill="#B45309"/><line x1="100" y1="65" x2="100" y2="128" stroke="#0F172A" stroke-width="14" stroke-linecap="round"/><line x1="100" y1="84" x2="36" y2="84" stroke="#B45309" stroke-width="12" stroke-linecap="round"/><line x1="100" y1="84" x2="164" y2="84" stroke="#B45309" stroke-width="12" stroke-linecap="round"/><polyline points="100,128 74,132 74,184" fill="none" stroke="#0F172A" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/><polyline points="100,128 126,132 126,184" fill="none" stroke="#0F172A" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  seatedKneeLift: `<svg viewBox="0 0 200 200" width="100%" height="100%">${CHAIR_SEAT_SVG}<path d="M166 158 L166 122 M158 132 L166 120 L174 132" fill="none" stroke="#15803D" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="100" cy="44" r="21" fill="#1D4ED8"/><line x1="100" y1="65" x2="100" y2="128" stroke="#0F172A" stroke-width="14" stroke-linecap="round"/><line x1="100" y1="82" x2="62" y2="132" stroke="#1D4ED8" stroke-width="11" stroke-linecap="round"/><line x1="100" y1="82" x2="138" y2="132" stroke="#1D4ED8" stroke-width="11" stroke-linecap="round"/><polyline points="100,128 74,132 74,184" fill="none" stroke="#0F172A" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/><polyline points="100,128 136,110 144,162" fill="none" stroke="#15803D" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  standArmsDown: `<svg viewBox="0 0 200 200" width="100%" height="100%">${CHAIR_SIDE_SVG}<circle cx="114" cy="40" r="21" fill="#1D4ED8"/><line x1="114" y1="61" x2="114" y2="132" stroke="#0F172A" stroke-width="14" stroke-linecap="round"/><line x1="114" y1="78" x2="78" y2="126" stroke="#1D4ED8" stroke-width="12" stroke-linecap="round"/><line x1="114" y1="78" x2="150" y2="126" stroke="#1D4ED8" stroke-width="12" stroke-linecap="round"/><line x1="114" y1="132" x2="92" y2="186" stroke="#0F172A" stroke-width="13" stroke-linecap="round"/><line x1="114" y1="132" x2="136" y2="186" stroke="#0F172A" stroke-width="13" stroke-linecap="round"/></svg>`,
  standArmsUp: `<svg viewBox="0 0 200 200" width="100%" height="100%">${CHAIR_SIDE_SVG}<path d="M54 64 L54 28 M46 38 L54 26 L62 38" fill="none" stroke="#15803D" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M174 64 L174 28 M166 38 L174 26 L182 38" fill="none" stroke="#15803D" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="114" cy="40" r="21" fill="#15803D"/><line x1="114" y1="61" x2="114" y2="132" stroke="#0F172A" stroke-width="14" stroke-linecap="round"/><line x1="114" y1="78" x2="72" y2="28" stroke="#15803D" stroke-width="12" stroke-linecap="round"/><line x1="114" y1="78" x2="156" y2="28" stroke="#15803D" stroke-width="12" stroke-linecap="round"/><line x1="114" y1="132" x2="92" y2="186" stroke="#0F172A" stroke-width="13" stroke-linecap="round"/><line x1="114" y1="132" x2="136" y2="186" stroke="#0F172A" stroke-width="13" stroke-linecap="round"/></svg>`,
  standArmsWide: `<svg viewBox="0 0 200 200" width="100%" height="100%">${CHAIR_SIDE_SVG}<path d="M70 58 L44 58 M52 50 L42 58 L52 66" fill="none" stroke="#B45309" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M156 58 L182 58 M174 50 L184 58 L174 66" fill="none" stroke="#B45309" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="114" cy="40" r="21" fill="#B45309"/><line x1="114" y1="61" x2="114" y2="132" stroke="#0F172A" stroke-width="14" stroke-linecap="round"/><line x1="114" y1="80" x2="54" y2="80" stroke="#B45309" stroke-width="12" stroke-linecap="round"/><line x1="114" y1="80" x2="174" y2="80" stroke="#B45309" stroke-width="12" stroke-linecap="round"/><line x1="114" y1="132" x2="92" y2="186" stroke="#0F172A" stroke-width="13" stroke-linecap="round"/><line x1="114" y1="132" x2="136" y2="186" stroke="#0F172A" stroke-width="13" stroke-linecap="round"/></svg>`,
  standKneeLift: `<svg viewBox="0 0 200 200" width="100%" height="100%">${CHAIR_SIDE_SVG}<path d="M174 156 L174 120 M166 130 L174 118 L182 130" fill="none" stroke="#15803D" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="114" cy="40" r="21" fill="#1D4ED8"/><line x1="114" y1="61" x2="114" y2="128" stroke="#0F172A" stroke-width="14" stroke-linecap="round"/><line x1="114" y1="78" x2="32" y2="104" stroke="#1D4ED8" stroke-width="11" stroke-linecap="round"/><line x1="114" y1="78" x2="152" y2="108" stroke="#1D4ED8" stroke-width="11" stroke-linecap="round"/><line x1="114" y1="128" x2="94" y2="186" stroke="#0F172A" stroke-width="13" stroke-linecap="round"/><polyline points="114,128 154,128 154,174" fill="none" stroke="#15803D" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  restRelax: `<svg viewBox="0 0 200 200" width="100%" height="100%"><circle cx="100" cy="100" r="76" fill="#DCFCE7" stroke="#15803D" stroke-width="6"/><text x="100" y="96" text-anchor="middle" font-size="34" font-weight="900" fill="#14532D">休息一下</text><text x="100" y="132" text-anchor="middle" font-size="22" font-weight="700" fill="#166534">慢慢深呼吸</text></svg>`
};

const DEFAULT_ROUTINES = {
  easy: {
    name: "簡單模式（5分鐘坐姿伸展）", minutes: 5, prepSec: 5, restSec: 10,
    steps: [
      { title: "第一組：坐姿雙手向上深呼吸", duration: 90, audioKey: "easy_1", instruction: "坐在穩固的椅子上，吸氣時雙手慢慢舉高，吐氣時放鬆放下。", frames: [{ label: "預備：坐姿雙手自然垂放", breath: "吸氣預備", svgKey: "seatedArmsDown" }, { label: "伸展：雙手向上舉高", breath: "慢慢吐氣", svgKey: "seatedArmsUp" }] },
      { title: "第二組：坐姿擴胸舒展運動", duration: 90, audioKey: "easy_2", instruction: "背部輕輕挺直，雙手向左右兩側打開，感受胸口自然展開。", frames: [{ label: "預備：雙手收回身側", breath: "吸氣預備", svgKey: "seatedArmsDown" }, { label: "擴胸：雙臂水平張開", breath: "慢慢吐氣", svgKey: "seatedArmsWide" }] },
      { title: "第三組：坐姿輪流抬膝", duration: 95, audioKey: "easy_3", instruction: "雙手輕扶椅面保持穩定，左右膝蓋輪流輕輕抬起再放下。", frames: [{ label: "預備：雙腳平放地面", breath: "吸氣預備", svgKey: "seatedArmsDown" }, { label: "抬腿：膝蓋輕輕抬高", breath: "慢慢吐氣", svgKey: "seatedKneeLift" }] }
    ]
  },
  medium: {
    name: "中等模式（10分鐘站立平衡）", minutes: 10, prepSec: 5, restSec: 10,
    steps: [
      { title: "第一組：站姿雙臂向上伸展", duration: 190, audioKey: "med_1", instruction: "雙腳與肩同寬站穩在椅背旁，吸氣雙手向上延伸活動肩關節。", frames: [{ label: "預備：站姿雙手垂放", breath: "吸氣預備", svgKey: "standArmsDown" }, { label: "伸展：雙手向上延伸", breath: "慢慢吐氣", svgKey: "standArmsUp" }] },
      { title: "第二組：站姿平舉擴胸平衡", duration: 190, audioKey: "med_2", instruction: "雙臂向兩側平舉展開，保持呼吸順暢與身體穩定。", frames: [{ label: "預備：放鬆肩頸", breath: "吸氣預備", svgKey: "standArmsDown" }, { label: "平舉：雙手向兩側展開", breath: "慢慢吐氣", svgKey: "standArmsWide" }] },
      { title: "第三組：扶椅原地高抬腿踏步", duration: 195, audioKey: "med_3", instruction: "單手扶穩椅背，跟著節拍慢慢原地抬膝踏步，注意安全。", frames: [{ label: "預備：雙腳站穩扶好椅背", breath: "吸氣預備", svgKey: "standArmsDown" }, { label: "踏步：膝蓋抬高踏步", breath: "慢慢吐氣", svgKey: "standKneeLift" }] }
    ]
  },
  demo: {
    name: "展示體驗模式（完整流程示範）", minutes: 0, prepSec: 3, restSec: 2,
    steps: [
      { title: "暖身：坐姿雙手向上伸展", duration: 4, audioKey: "demo_1", instruction: "坐在椅子上，吸氣時雙手慢慢舉高，肩膀放輕鬆。", frames: [{ label: "動作一：坐姿雙手垂放", breath: "吸氣預備", svgKey: "seatedArmsDown" }, { label: "動作二：雙手向上舉高", breath: "慢慢吐氣", svgKey: "seatedArmsUp" }] },
      { title: "核心：坐姿平舉擴胸", duration: 4, audioKey: "demo_2", instruction: "雙手向左右展開，保持平穩深呼吸。", frames: [{ label: "動作一：雙手收回", breath: "吸氣預備", svgKey: "seatedArmsDown" }, { label: "動作二：雙臂水平張開", breath: "慢慢吐氣", svgKey: "seatedArmsWide" }] },
      { title: "下肢：扶椅原地踏步抬膝", duration: 4, audioKey: "demo_3", instruction: "阿公阿嬤很棒喔，最後四秒鐘，扶著椅背跟著節拍踏步！", frames: [{ label: "動作一：扶椅雙腳站穩", breath: "吸氣預備", svgKey: "standArmsDown" }, { label: "動作二：膝蓋抬起踏步", breath: "慢慢吐氣", svgKey: "standKneeLift" }] }
    ]
  }
};

let ROUTINES = structuredClone(DEFAULT_ROUTINES);
let currentModeKey = null;
let currentRoutine = null;
let currentPhase = "idle";
let currentStepIdx = 0;

let phaseDurationMs = 0;
let phaseRemainingMs = 0;
let phaseEndTimestamp = 0;
let lastDisplayedSec = -1;
let totalRoutineSec = 0;
let completedPhaseSec = 0;
let lastBeatIdx = -1;
let tenSecWarned = false;
let tickInterval = null;

let isWorkoutActive = false;
let isPaused = false;
let wasPausedBeforeModal = false;
let wakeLockSentinel = null;

const callbacks = { onWorkoutStart: () => {} };
export function registerWorkoutCallbacks(cbs) { Object.assign(callbacks, cbs); }
export function isWorkoutInProgress() { return isWorkoutActive; }
export function isWorkoutPaused() { return isPaused; }

export async function loadExternalRoutines() {
  try {
    const res = await fetch(`./data/routines.json?t=${Date.now()}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.easy && data.medium) ROUTINES = { ...DEFAULT_ROUTINES, ...data };
    }
  } catch (e) {}
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    wakeLockSentinel = await navigator.wakeLock.request("screen");
    document.getElementById("wakeLockBadge").classList.remove("hidden");
    wakeLockSentinel.addEventListener("release", () => document.getElementById("wakeLockBadge").classList.add("hidden"));
  } catch (e) {}
}

async function releaseWakeLock() {
  if (wakeLockSentinel) {
    try { await wakeLockSentinel.release(); } catch (e) {}
    wakeLockSentinel = null;
  }
  document.getElementById("wakeLockBadge").classList.add("hidden");
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && isWorkoutActive && !isPaused) requestWakeLock();
});

function renderFrameGraphic(frame) {
  if (frame.imgUrl) {
    return `<img src="${escapeHtml(frame.imgUrl)}" alt="${escapeHtml(frame.label || "運動示意圖")}" style="width:100%;height:100%;object-fit:contain;border-radius:10px;" />`;
  }
  return POSE_SVGS[frame.svgKey] || "";
}

function setBreathVisual(mode, text) {
  const pill = document.getElementById("breathPill");
  pill.classList.toggle("inhale", mode === "inhale");
  pill.classList.toggle("exhale", mode === "exhale");
  document.getElementById("breathText").textContent = text;
}

function renderExerciseFrame(step, frameIdx) {
  const frame = step.frames[frameIdx % step.frames.length];
  document.getElementById("poseFrameLabel").textContent = frame.label;
  document.getElementById("svgStage").innerHTML = renderFrameGraphic(frame);
  setBreathVisual(frameIdx % 2 === 0 ? "inhale" : "exhale", frame.breath || (frameIdx % 2 === 0 ? "吸氣預備" : "慢慢吐氣"));
}

function computeTotalSec(routine) {
  let total = routine.prepSec || 0;
  routine.steps.forEach((s, i) => {
    total += s.duration;
    if (i < routine.steps.length - 1) total += routine.restSec || 0;
  });
  return Math.max(1, total);
}

function updateTimerDisplay(secLeft) {
  const safe = Math.max(0, secLeft);
  const el = document.getElementById("timerText");
  el.textContent = `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  el.className = `timer-display ${isPaused ? "paused" : ""} ${currentPhase === "prep" ? "phase-prep" : ""} ${currentPhase === "rest" ? "phase-rest" : ""}`;

  const elapsedNow = completedPhaseSec + (phaseDurationMs - phaseRemainingMs) / 1000;
  document.getElementById("progressBar").style.width = `${Math.min(100, Math.round((elapsedNow / totalRoutineSec) * 100))}%`;
}

function updatePauseUI() {
  const btn = document.getElementById("btnPauseResume");
  const banner = document.getElementById("pausedBanner");
  if (isPaused) {
    btn.textContent = "▶ 繼續";
    btn.classList.remove("btn-warning");
    btn.classList.add("btn-success");
    banner.classList.remove("hidden");
  } else {
    btn.textContent = "⏸ 暫停";
    btn.classList.remove("btn-success");
    btn.classList.add("btn-warning");
    banner.classList.add("hidden");
  }
}

export function startWorkout(modeKey) {
  vibrateTap(30);
  initAudioContext();
  prewarmSpeech();
  stopBgmPreview();
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }

  currentModeKey = modeKey;
  currentRoutine = ROUTINES[modeKey];
  currentStepIdx = 0;
  completedPhaseSec = 0;
  totalRoutineSec = computeTotalSec(currentRoutine);
  isWorkoutActive = true;
  isPaused = false;
  setWorkoutAudioState({ active: true, paused: false });
  callbacks.onWorkoutStart();

  document.getElementById("workoutAudioDetails").open = window.innerWidth >= 768;
  updatePauseUI();
  document.getElementById("mainContainer").classList.add("workout-wide");
  document.getElementById("socialPausedBanner").classList.add("hidden");
  document.getElementById("viewSelect").classList.add("hidden");
  document.getElementById("viewComplete").classList.add("hidden");
  document.getElementById("viewActive").classList.remove("hidden");

  requestWakeLock();
  if (getAudioState().bgmEnabled) playBgmCurrentTrack(false);
  else updateAudioControlsUI();

  enterPrepPhase();
  tickInterval = setInterval(onTimerTick, 250);
  startSpeechKeepAlive();
}

function enterPrepPhase() {
  currentPhase = "prep";
  const prepSec = currentRoutine.prepSec || 5;
  phaseDurationMs = prepSec * 1000;
  phaseRemainingMs = phaseDurationMs;
  phaseEndTimestamp = Date.now() + phaseDurationMs;
  lastDisplayedSec = -1;
  lastBeatIdx = -1;

  const first = currentRoutine.steps[0];
  const badge = document.getElementById("stepCounter");
  badge.textContent = "⏳ 預備倒數";
  badge.className = "step-indicator phase-prep";
  document.getElementById("btnSkipPhase").textContent = "⏭ 立即開始";
  document.getElementById("exerciseTitle").textContent = `即將開始：${first.title}`;
  document.getElementById("poseFrameLabel").textContent = "請先坐穩或扶好椅背";
  document.getElementById("svgStage").innerHTML = renderFrameGraphic(first.frames[0]);
  document.getElementById("instructionText").textContent = "請調整好呼吸與姿勢，倒數結束後就跟著圖示一起動！";

  setBreathVisual("inhale", "深呼吸預備");
  updateTimerDisplay(prepSec);
  speakText(`準備開始${currentRoutine.name}，請先坐穩或扶好椅背。`);
}

function enterExercisePhase(idx) {
  currentPhase = "exercise";
  currentStepIdx = idx;
  const step = currentRoutine.steps[idx];

  phaseDurationMs = step.duration * 1000;
  phaseRemainingMs = phaseDurationMs;
  phaseEndTimestamp = Date.now() + phaseDurationMs;
  lastDisplayedSec = -1;
  lastBeatIdx = 0;
  tenSecWarned = false;

  const badge = document.getElementById("stepCounter");
  badge.textContent = `動作 ${idx + 1} / ${currentRoutine.steps.length}`;
  badge.className = "step-indicator";
  document.getElementById("btnSkipPhase").textContent = "⏭ 跳過此動作";
  document.getElementById("exerciseTitle").textContent = step.title;
  document.getElementById("instructionText").textContent = step.instruction;

  renderExerciseFrame(step, 0);
  updateTimerDisplay(step.duration);
  playRhythmTone(true);
  speakText(`${step.title}。${step.instruction}`, step.audioKey);
}

function enterRestPhase(nextIdx) {
  currentPhase = "rest";
  const restSec = currentRoutine.restSec || 10;
  const nextStep = currentRoutine.steps[nextIdx];

  phaseDurationMs = restSec * 1000;
  phaseRemainingMs = phaseDurationMs;
  phaseEndTimestamp = Date.now() + phaseDurationMs;
  lastDisplayedSec = -1;
  lastBeatIdx = -1;

  const badge = document.getElementById("stepCounter");
  badge.textContent = `☕ 組間喘息（下組：動作 ${nextIdx + 1}）`;
  badge.className = "step-indicator phase-rest";
  document.getElementById("btnSkipPhase").textContent = "▶ 跳過休息";
  document.getElementById("exerciseTitle").textContent = `下一個動作：${nextStep.title}`;
  document.getElementById("poseFrameLabel").textContent = "放鬆肩膀・慢慢深呼吸";
  document.getElementById("svgStage").innerHTML = POSE_SVGS.restRelax;
  document.getElementById("instructionText").textContent = `休息 ${restSec} 秒喘口氣，接下來要做「${nextStep.title}」。`;

  setBreathVisual("exhale", "放鬆休息");
  updateTimerDisplay(restSec);
  speakText(`做得很好！休息一下，下一個動作是${nextStep.title}`);
}

function advancePhase() {
  completedPhaseSec += phaseDurationMs / 1000;
  if (currentPhase === "prep") enterExercisePhase(0);
  else if (currentPhase === "exercise") {
    if (currentStepIdx + 1 < currentRoutine.steps.length) {
      if ((currentRoutine.restSec || 0) > 0) enterRestPhase(currentStepIdx + 1);
      else enterExercisePhase(currentStepIdx + 1);
    } else finishWorkout();
  } else if (currentPhase === "rest") enterExercisePhase(currentStepIdx + 1);
}

function onTimerTick() {
  if (isPaused || !isWorkoutActive) return;
  phaseRemainingMs = Math.max(0, phaseEndTimestamp - Date.now());
  const secLeft = Math.ceil(phaseRemainingMs / 1000);
  const elapsedPhaseMs = phaseDurationMs - phaseRemainingMs;

  if (secLeft !== lastDisplayedSec) {
    lastDisplayedSec = secLeft;
    updateTimerDisplay(secLeft);
    if (currentPhase === "prep" && secLeft > 0 && secLeft <= 3) playRhythmTone(true);
    if (currentPhase === "exercise" && secLeft === 10 && !tenSecWarned && phaseDurationMs > 12000) {
      tenSecWarned = true;
      speakText("阿公阿嬤很棒喔，剩下十秒鐘，加油！");
    }
  }

  if (currentPhase === "exercise") {
    const beatIdx = Math.floor(elapsedPhaseMs / 2000);
    if (beatIdx !== lastBeatIdx) {
      lastBeatIdx = beatIdx;
      const step = currentRoutine.steps[currentStepIdx];
      renderExerciseFrame(step, beatIdx % step.frames.length);
      playRhythmTone(beatIdx % 2 === 0);
    }
  }

  if (phaseRemainingMs <= 0) advancePhase();
}

export function skipCurrentPhase() {
  vibrateTap();
  if (!isWorkoutActive) return;
  if (isPaused) {
    isPaused = false;
    setWorkoutAudioState({ paused: false });
    updatePauseUI();
    if (getAudioState().bgmEnabled) playBgmCurrentTrack(false);
  }
  advancePhase();
}

export function repeatVoice() {
  vibrateTap();
  if (!currentRoutine || !isWorkoutActive) return;
  if (!getAudioState().voiceEnabled) {
    alert("目前「引導語音」已靜音，請先開啟語音喔！");
    return;
  }
  initAudioContext();
  if (currentPhase === "exercise") {
    const step = currentRoutine.steps[currentStepIdx];
    speakText(`${step.title}。${step.instruction}`, step.audioKey);
  } else if (currentPhase === "prep") {
    speakText("請先坐穩或扶好椅背，準備開始運動！");
  } else if (currentPhase === "rest") {
    speakText(`休息一下，下一個動作是：${currentRoutine.steps[currentStepIdx + 1].title}`);
  }
}

export function pauseWorkout(fromTabSwitch = false) {
  if (!isWorkoutActive || isPaused) return;
  isPaused = true;
  setWorkoutAudioState({ paused: true });
  phaseRemainingMs = Math.max(0, phaseEndTimestamp - Date.now());
  stopAllVoicePlayback();
  pauseBgm();
  releaseWakeLock();
  updatePauseUI();
  updateTimerDisplay(Math.ceil(phaseRemainingMs / 1000));
  if (fromTabSwitch) document.getElementById("socialPausedBanner").classList.remove("hidden");
}

export function resumeWorkout() {
  if (!isWorkoutActive || !isPaused) return;
  initAudioContext();
  isPaused = false;
  setWorkoutAudioState({ paused: false });
  phaseEndTimestamp = Date.now() + phaseRemainingMs;
  requestWakeLock();
  updatePauseUI();
  document.getElementById("socialPausedBanner").classList.add("hidden");
  if (getAudioState().bgmEnabled) playBgmCurrentTrack(false);
  speakText("繼續運動，加油！");
}

export function togglePause() {
  vibrateTap();
  if (!isWorkoutActive) return;
  if (isPaused) resumeWorkout();
  else pauseWorkout(false);
}

export function requestStopWorkout() {
  vibrateTap();
  if (!isWorkoutActive) return;
  wasPausedBeforeModal = isPaused;
  pauseWorkout(false);
  document.getElementById("confirmStopModal").classList.remove("hidden");
}

export function cancelStopWorkout() {
  vibrateTap();
  document.getElementById("confirmStopModal").classList.add("hidden");
  if (!wasPausedBeforeModal) resumeWorkout();
}

export function confirmStopWorkout() {
  vibrateTap(30);
  document.getElementById("confirmStopModal").classList.add("hidden");
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
  stopSpeechKeepAlive();
  isWorkoutActive = false;
  isPaused = false;
  currentPhase = "idle";
  setWorkoutAudioState({ active: false, paused: false });
  stopAllVoicePlayback();
  pauseBgm();
  releaseWakeLock();
  document.getElementById("socialPausedBanner").classList.add("hidden");
  resetToHome();
}

function finishWorkout() {
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
  stopSpeechKeepAlive();
  isWorkoutActive = false;
  isPaused = false;
  currentPhase = "idle";
  setWorkoutAudioState({ active: false, paused: false });
  setBgmDucking(false);
  pauseBgm();
  releaseWakeLock();
  document.getElementById("mainContainer").classList.remove("workout-wide");
  document.getElementById("socialPausedBanner").classList.add("hidden");

  const profile = getProfile();
  const todayStr = getLocalDateStr(0);
  const yesterdayStr = getLocalDateStr(-1);
  const todayDisplayStr = new Date().toLocaleDateString("zh-TW");
  const statusEl = document.getElementById("completeStatusText");

  let badgeStreakDays = Math.max(getActiveStreakDays(profile), 1);
  const earnedMinutes = currentRoutine.minutes || 0;
  const prevAutoId = getHighestAutoBadgeId(profile);

  if (currentModeKey === "demo") {
    statusEl.textContent = "展示體驗模式完成！此模式不會更動您的真實每日簽到天數與累計分鐘數。";
  } else {
    profile.totalMinutes = (profile.totalMinutes || 0) + earnedMinutes;
    profile.checkinDates = Array.from(new Set([...(profile.checkinDates || []), todayStr])).sort().slice(-60);

    if (profile.lastCheckinDate === todayStr) {
      badgeStreakDays = Math.max(profile.streakDays || 1, 1);
      statusEl.textContent = `今日已完成簽到！維持連續 ${badgeStreakDays} 天，累計運動增至 ${profile.totalMinutes} 分鐘！`;
    } else if (profile.lastCheckinDate === yesterdayStr) {
      badgeStreakDays = (profile.streakDays || 0) + 1;
      profile.streakDays = badgeStreakDays;
      profile.lastCheckinDate = todayStr;
      statusEl.textContent = `太棒了！連續運動已達 ${badgeStreakDays} 天，累計運動 ${profile.totalMinutes} 分鐘！`;
    } else {
      badgeStreakDays = 1;
      profile.streakDays = 1;
      profile.lastCheckinDate = todayStr;
      statusEl.textContent = `已記錄今日簽到並累計 ${profile.totalMinutes} 分鐘，開啟新的連續運動紀錄！`;
    }

    profile.maxStreakDays = Math.max(profile.maxStreakDays || 0, profile.streakDays || 0);
    const newAutoId = getHighestAutoBadgeId(profile);
    if (newAutoId !== prevAutoId) profile.equippedBadgeId = newAutoId;

    saveProfileLocal();
    syncProfileToCloud();
  }

  updateAllProfileUI();

  const meta = {
    streakDays: badgeStreakDays,
    routineName: currentRoutine.name,
    dateStr: todayDisplayStr,
    isDemo: currentModeKey === "demo",
    minutes: earnedMinutes
  };
  setLatestBadgeMeta(meta);

  document.getElementById("viewActive").classList.add("hidden");
  document.getElementById("viewComplete").classList.remove("hidden");

  speakText(`太棒了！${profile.name}恭喜完成今天的運動，您已經連續運動 ${badgeStreakDays} 天了！`);
  drawAchievementBadge(meta);
}

export function resetToHome() {
  document.getElementById("mainContainer").classList.remove("workout-wide");
  document.getElementById("viewSelect").classList.remove("hidden");
  document.getElementById("viewActive").classList.add("hidden");
  document.getElementById("viewComplete").classList.add("hidden");
  document.getElementById("progressBar").style.width = "0%";
  updateAudioControlsUI();
}