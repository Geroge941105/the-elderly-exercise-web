import {
  registerAuthCallbacks,
  syncProfileToCloud,
  vibrateTap,
  togglePinVisibility,
  pickAuthNickname,
  syncAuthChipHighlight,
  submitAuthGate,
  claimExistingProfile,
  createDistinctProfile,
  openProfileModal,
  setEditNickname,
  saveProfileEdits,
  closeProfileModal,
  logoutToAuthGate,
  resetLocalDemoData,
  bootAuth
} from "./auth.js";

import {
  loadMusicPlaylist,
  updateAudioControlsUI,
  applySpeechRateUI,
  toggleSpeechRate,
  toggleVoice,
  toggleBgm,
  toggleVoiceMode,
  onVoiceSliderInput,
  onBgmSliderInput,
  stepVoiceVolume,
  stepBgmVolume,
  scheduleVoicePreview,
  nextTrack
} from "./audio.js";

import { drawAchievementBadge, shareBadge, downloadBadge } from "./badge-canvas.js";

import {
  loadExternalRoutines,
  registerWorkoutCallbacks,
  isWorkoutInProgress,
  isWorkoutPaused,
  startWorkout,
  repeatVoice,
  skipCurrentPhase,
  togglePause,
  pauseWorkout,
  requestStopWorkout,
  cancelStopWorkout,
  confirmStopWorkout,
  resetToHome
} from "./workout.js";

import {
  registerSocialCallbacks,
  subscribeSocialWallOnce,
  publishToWall,
  setWallFilter,
  renderSocialWall,
  readPostAloud,
  loadMorePosts,
  toggleReaction,
  flushOfflinePostQueue,
  resetSocialPublishFlag,
  clearLocalReactions
} from "./social.js";

/* =========================================
   字體大小無障礙切換與離線／PWA 狀態
   ========================================= */
let isLargeFont = localStorage.getItem("usr_large_font") === "true";

function applyFontUI() {
  document.documentElement.classList.toggle("large-font", isLargeFont);
  document.getElementById("btnFontToggle").textContent = isLargeFont ? "🔍 字體：特大" : "🔍 字體：標準";
}

function toggleFontSize() {
  vibrateTap();
  isLargeFont = !isLargeFont;
  localStorage.setItem("usr_large_font", String(isLargeFont));
  applyFontUI();
}

function updateOnlineStatus() {
  document.getElementById("offlineBanner").classList.toggle("hidden", navigator.onLine);
  if (navigator.onLine) {
    flushOfflinePostQueue();
    syncProfileToCloud();
  }
}

function switchTab(tabName) {
  vibrateTap();
  if (tabName === "social" && isWorkoutInProgress() && !isWorkoutPaused()) {
    pauseWorkout(true);
  }
  if (tabName === "exercise") {
    document.getElementById("socialPausedBanner").classList.add("hidden");
  }

  document.getElementById("tabExercise").classList.toggle("active", tabName === "exercise");
  document.getElementById("tabSocial").classList.toggle("active", tabName === "social");
  document.getElementById("sectionExercise").classList.toggle("active", tabName === "exercise");
  document.getElementById("sectionSocial").classList.toggle("active", tabName === "social");
  document.getElementById("mainContainer").classList.toggle("workout-wide", tabName === "exercise" && isWorkoutInProgress());
}

/* =========================================
   模組間事件串接（避免循環依賴）
   ========================================= */
registerAuthCallbacks({
  onEnterApp: () => {
    subscribeSocialWallOnce();
    flushOfflinePostQueue();
  },
  onProfileEdited: () => {
    if (!document.getElementById("viewComplete").classList.contains("hidden")) {
      drawAchievementBadge();
    }
  },
  onBeforeLogout: () => {
    if (isWorkoutInProgress()) confirmStopWorkout();
  },
  onLocalReset: () => {
    clearLocalReactions();
    renderSocialWall();
  }
});

registerWorkoutCallbacks({
  onWorkoutStart: () => {
    resetSocialPublishFlag();
  }
});

registerSocialCallbacks({
  onSwitchTab: switchTab
});

// 綁定全域函式供 HTML 按鈕呼叫
Object.assign(window, {
  togglePinVisibility,
  pickAuthNickname,
  syncAuthChipHighlight,
  submitAuthGate,
  claimExistingProfile,
  createDistinctProfile,
  openProfileModal,
  setEditNickname,
  saveProfileEdits,
  closeProfileModal,
  logoutToAuthGate,
  resetLocalDemoData,
  switchTab,
  toggleFontSize,
  toggleSpeechRate,
  toggleVoice,
  toggleBgm,
  toggleVoiceMode,
  onVoiceSliderInput,
  onBgmSliderInput,
  stepVoiceVolume,
  stepBgmVolume,
  scheduleVoicePreview,
  nextTrack,
  startWorkout,
  repeatVoice,
  skipCurrentPhase,
  togglePause,
  requestStopWorkout,
  cancelStopWorkout,
  confirmStopWorkout,
  resetToHome,
  publishToWall,
  shareBadge,
  downloadBadge,
  setWallFilter,
  readPostAloud,
  loadMorePosts,
  toggleReaction
});

/* =========================================
   初始化啟動
   ========================================= */
applyFontUI();
applySpeechRateUI();
updateAudioControlsUI();
loadMusicPlaylist();
loadExternalRoutines();

window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

bootAuth();