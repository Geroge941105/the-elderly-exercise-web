import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { db, rosterCollection, ensureAnonymousAuth } from "./firebase-config.js";

const VAULT_SALT = "usr_elderly_exercise_secret_v1";
const LOCK_KEY = "usr_auth_cooldown_v1";
const PROFILE_STORAGE_KEY = "usr_secure_profile_v2";

/* =========================================
   稱號徽章定義與共用輔助工具
   ========================================= */
export const TITLE_BADGES = [
  { id: "newbie", label: "🌱 新手報到", cssClass: "badge-newbie", condText: "完成報到即可獲得", canvasBg: "#F1F5F9", canvasStroke: "#64748B", canvasText: "#334155", isUnlocked: () => true },
  { id: "starter", label: "★ 活力起步", cssClass: "badge-starter", condText: "連續運動達 1 天", canvasBg: "#DBEAFE", canvasStroke: "#1D4ED8", canvasText: "#1E3A8A", isUnlocked: (p) => (p.maxStreakDays || p.streakDays || 0) >= 1 },
  { id: "steady", label: "★★ 持之以恆", cssClass: "badge-steady", condText: "連續運動達 3 天", canvasBg: "#DCFCE7", canvasStroke: "#15803D", canvasText: "#14532D", isUnlocked: (p) => (p.maxStreakDays || p.streakDays || 0) >= 3 },
  { id: "master", label: "★★★ 健康達人", cssClass: "badge-master", condText: "連續運動達 7 天", canvasBg: "#FEF3C7", canvasStroke: "#D97706", canvasText: "#78350F", isUnlocked: (p) => (p.maxStreakDays || p.streakDays || 0) >= 7 },
  { id: "minutes30", label: "⏱️ 毅力之星", cssClass: "badge-minutes", condText: "累計運動達 30 分鐘", canvasBg: "#EDE9FE", canvasStroke: "#7C3AED", canvasText: "#4C1D95", isUnlocked: (p) => (p.totalMinutes || 0) >= 30 },
  { id: "kind5", label: "❤️ 熱心鄰居", cssClass: "badge-kind", condText: "幫鄰居加油達 5 次", canvasBg: "#FFE4E6", canvasStroke: "#E11D48", canvasText: "#881337", isUnlocked: (p) => (p.cheersGiven || 0) >= 5 }
];

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function vibrateTap(ms = 20) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
}

export function getLocalDateStr(offsetDays = 0, baseDate = new Date()) {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function getBadgeById(id) {
  return TITLE_BADGES.find((b) => b.id === id) || TITLE_BADGES[0];
}

export function getHighestAutoBadgeId(profile) {
  if ((profile.maxStreakDays || profile.streakDays || 0) >= 7) return "master";
  if ((profile.maxStreakDays || profile.streakDays || 0) >= 3) return "steady";
  if ((profile.maxStreakDays || profile.streakDays || 0) >= 1) return "starter";
  return "newbie";
}

export function getEquippedBadge(profile) {
  if (!profile) return TITLE_BADGES[0];
  const chosen = getBadgeById(profile.equippedBadgeId);
  if (chosen && chosen.isUnlocked(profile)) return chosen;
  return getBadgeById(getHighestAutoBadgeId(profile));
}

export function getCardTierTheme(days) {
  const n = Number(days) || 1;
  if (n >= 7) return { cssClass: "tier-master", label: "★★★ 健康達人", border: "#78350F", bg: "#FFFBEB", header: "#B45309", circleFill: "#FEF3C7", circleStroke: "#D97706", numColor: "#78350F" };
  if (n >= 3) return { cssClass: "tier-steady", label: "★★ 持之以恆", border: "#14532D", bg: "#F8FAFC", header: "#15803D", circleFill: "#DCFCE7", circleStroke: "#15803D", numColor: "#14532D" };
  return { cssClass: "tier-starter", label: "★ 活力起步", border: "#1E3A8A", bg: "#F8FAFC", header: "#1D4ED8", circleFill: "#DBEAFE", circleStroke: "#1D4ED8", numColor: "#1E3A8A" };
}

export function getActiveStreakDays(profile) {
  if (!profile || !profile.lastCheckinDate) return 0;
  const today = getLocalDateStr(0);
  const yesterday = getLocalDateStr(-1);
  if (profile.lastCheckinDate !== today && profile.lastCheckinDate !== yesterday) return 0;
  return Math.max(0, Number(profile.streakDays) || 0);
}

export function renderIdentityStripHtml({ name, publicTag, nickname, badgeLabel, badgeCssClass, isDemo = false }) {
  const safeName = escapeHtml(name || "長青運動員");
  const tagHtml = publicTag ? `<span class="id-pin">#${escapeHtml(publicTag)}</span>` : "";
  const nickHtml = nickname ? `<span class="nick-pill">${escapeHtml(nickname)}</span>` : "";
  const badgeHtml = badgeLabel ? `<span class="title-badge-pill ${escapeHtml(badgeCssClass || "badge-starter")}">${escapeHtml(badgeLabel)}</span>` : "";
  const demoHtml = isDemo ? `<span class="demo-tag">展示體驗</span>` : "";
  return `<span class="id-strip"><span class="id-name">${safeName}</span>${tagHtml}${nickHtml}${badgeHtml}${demoHtml}</span>`;
}

/* =========================================
   SHA-256 單向雜湊（含非 HTTPS 區網測試備援）
   ========================================= */
function sha256Fallback(ascii) {
  const rightRotate = (v, a) => (v >>> a) | (v << (32 - a));
  const maxWord = Math.pow(2, 32);
  let result = "";
  const words = [];
  const bitLen = ascii.length * 8;
  const hash = [];
  const k = [];
  let primeCounter = 0;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  ascii += "\x80";
  while ((ascii.length % 64) - 56) ascii += "\x00";
  for (let i = 0; i < ascii.length; i++) {
    const j = ascii.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (bitLen / maxWord) | 0;
  words[words.length] = bitLen;
  for (let j = 0; j < words.length;) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const a = hash[0], e = hash[4];
      const temp1 = hash[7] + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) + ((e & hash[5]) ^ (~e & hash[6])) + k[i] +
        (w[i] = i < 16 ? w[i] : (w[i - 16] + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) | 0);
      const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash.unshift((temp1 + temp2) | 0);
      hash[4] = (hash[4] + temp1) | 0;
      hash.pop();
    }
    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? "0" : "") + b.toString(16);
    }
  }
  return result;
}

async function computeVaultKey(name, secretPin4) {
  const plain = `${name}::${secretPin4}::${VAULT_SALT}`;
  if (window.crypto && window.crypto.subtle) {
    const buf = new TextEncoder().encode(plain);
    const hashBuf = await window.crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return sha256Fallback(unescape(encodeURIComponent(plain)));
}

/* =========================================
   防暴力試碼冷卻機制（連錯 3 次鎖 30 秒）
   ========================================= */
function readCooldownState() {
  try {
    return JSON.parse(localStorage.getItem(LOCK_KEY) || '{"fails":0,"until":0}');
  } catch (e) {
    return { fails: 0, until: 0 };
  }
}

function getCooldownRemainingSec() {
  const st = readCooldownState();
  return Math.max(0, Math.ceil((st.until - Date.now()) / 1000));
}

function recordFailedGuess() {
  const st = readCooldownState();
  st.fails = (st.fails || 0) + 1;
  if (st.fails >= 3) {
    st.until = Date.now() + 30000;
    st.fails = 0;
  }
  localStorage.setItem(LOCK_KEY, JSON.stringify(st));
  return st;
}

function clearFailedGuesses() {
  localStorage.removeItem(LOCK_KEY);
}

/* =========================================
   狀態與回呼管理
   ========================================= */
let currentProfile = null;
let pendingName = "";
let pendingNickname = "";
let pendingVaultKey = "";
let pendingRosterMatches = [];
let modalSelectedBadgeId = "newbie";

const callbacks = {
  onEnterApp: () => {},
  onProfileEdited: () => {},
  onBeforeLogout: () => {},
  onLocalReset: () => {}
};

export function registerAuthCallbacks(cbs) {
  Object.assign(callbacks, cbs);
}

export function getProfile() {
  return currentProfile;
}

export function saveProfileLocal() {
  if (!currentProfile) return;
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(currentProfile));
}

export async function syncProfileToCloud() {
  if (!currentProfile || !navigator.onLine) return;
  try {
    const user = await ensureAnonymousAuth();
    currentProfile.uid = user.uid;
    const badge = getEquippedBadge(currentProfile);

    // 1. 私人完整檔案（僅本人 uid 可讀寫）
    await setDoc(doc(db, "profiles", user.uid), {
      uid: user.uid,
      accountId: currentProfile.accountId,
      vaultKey: currentProfile.vaultKey,
      name: currentProfile.name,
      publicTag: currentProfile.publicTag,
      nickname: currentProfile.nickname || "",
      equippedBadgeId: currentProfile.equippedBadgeId || "newbie",
      streakDays: currentProfile.streakDays || 0,
      maxStreakDays: currentProfile.maxStreakDays || 0,
      lastCheckinDate: currentProfile.lastCheckinDate || "",
      totalMinutes: currentProfile.totalMinutes || 0,
      checkinDates: (currentProfile.checkinDates || []).slice(-60),
      cheersGiven: currentProfile.cheersGiven || 0,
      updatedAt: serverTimestamp()
    }, { merge: true });

    // 2. 公開名冊（完全不含密碼與雜湊）
    await setDoc(doc(db, "public_roster", user.uid), {
      uid: user.uid,
      accountId: currentProfile.accountId,
      name: currentProfile.name,
      publicTag: currentProfile.publicTag,
      nickname: currentProfile.nickname || "",
      badgeLabel: badge.label,
      badgeCssClass: badge.cssClass,
      totalMinutes: currentProfile.totalMinutes || 0,
      updatedAt: serverTimestamp()
    }, { merge: true });

    // 3. 換手機私密保險箱（不可 list 掃描）
    if (currentProfile.vaultKey) {
      await setDoc(doc(db, "recovery_vault", currentProfile.vaultKey), {
        ownerUid: user.uid,
        accountId: currentProfile.accountId,
        name: currentProfile.name,
        publicTag: currentProfile.publicTag,
        nickname: currentProfile.nickname || "",
        equippedBadgeId: currentProfile.equippedBadgeId || "newbie",
        streakDays: currentProfile.streakDays || 0,
        maxStreakDays: currentProfile.maxStreakDays || 0,
        lastCheckinDate: currentProfile.lastCheckinDate || "",
        totalMinutes: currentProfile.totalMinutes || 0,
        checkinDates: (currentProfile.checkinDates || []).slice(-60),
        cheersGiven: currentProfile.cheersGiven || 0,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
  } catch (err) {
    console.warn("雲端檔案同步失敗（請確認已啟用匿名登入與 Firestore 規則）：", err);
  }
}

/* =========================================
   報到登入 UI 與防冒用驗證流程
   ========================================= */
function sanitizeName(str) {
  return String(str).trim().replace(/[\/\.\#\$\[\]\s]/g, "");
}

function showAuthError(msg) {
  const box = document.getElementById("authErrorBox");
  if (!msg) {
    box.classList.add("hidden");
    box.textContent = "";
  } else {
    box.textContent = msg;
    box.classList.remove("hidden");
  }
}

export function togglePinVisibility() {
  vibrateTap();
  const input = document.getElementById("authPinInput");
  const btn = document.getElementById("btnTogglePinVis");
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  btn.textContent = showing ? "👁️ 顯示" : "🙈 隱藏";
}

export function pickAuthNickname(nick) {
  vibrateTap();
  document.getElementById("authNicknameInput").value = nick;
  syncAuthChipHighlight();
}

export function syncAuthChipHighlight() {
  const val = document.getElementById("authNicknameInput").value.trim();
  document.querySelectorAll("#authPresetRow .preset-chip").forEach((btn) => {
    btn.classList.toggle("selected", val !== "" && btn.textContent.includes(val));
  });
}

function allocateNextPublicTag(existingMatches) {
  const used = new Set(existingMatches.map((m) => parseInt(m.publicTag, 10)).filter(Number.isFinite));
  let num = 1;
  while (used.has(num)) num++;
  return String(num).padStart(2, "0");
}

function deduplicateRosterByAccount(docs) {
  const map = new Map();
  docs.forEach((d) => {
    const key = d.accountId || d.uid;
    if (!map.has(key)) map.set(key, d);
  });
  return Array.from(map.values());
}

export async function submitAuthGate() {
  vibrateTap(25);
  showAuthError("");
  document.getElementById("collisionPanel").classList.add("hidden");

  const waitSec = getCooldownRemainingSec();
  if (waitSec > 0) {
    showAuthError(`密碼嘗試次數過多，為保護鄰居資料請稍候 ${waitSec} 秒再試。`);
    return;
  }

  const name = sanitizeName(document.getElementById("authNameInput").value).slice(0, 10);
  const nickname = document.getElementById("authNicknameInput").value.trim().slice(0, 8);
  const pin4 = document.getElementById("authPinInput").value.trim().replace(/\D/g, "");

  if (name.length < 1) {
    showAuthError("請先輸入您的名稱（至少 1 個字）才能進入喔！");
    return;
  }
  if (pin4.length !== 4) {
    showAuthError("請設定剛好 4 個數字的「私密通關密碼」，保護您的運動紀錄不被他人冒用。");
    return;
  }

  const btn = document.getElementById("btnAuthSubmit");
  btn.disabled = true;
  btn.textContent = "⏳ 正在安全核對身分...";

  pendingName = name;
  pendingNickname = nickname;
  pendingVaultKey = await computeVaultKey(name, pin4);
  pendingRosterMatches = [];

  try {
    if (!navigator.onLine) {
      await finishNewRegistration(name, nickname, pendingVaultKey, "01", "offline_local");
      return;
    }

    const user = await ensureAnonymousAuth();

    // 步驟 1：憑 SHA-256 精準檢查是否為既有使用者（換手機／重登找回紀錄）
    const vaultSnap = await getDoc(doc(db, "recovery_vault", pendingVaultKey));
    if (vaultSnap.exists()) {
      clearFailedGuesses();
      const recovered = vaultSnap.data();
      if (nickname && !recovered.nickname) recovered.nickname = nickname;
      enterAppWithProfile({ ...recovered, uid: user.uid, vaultKey: pendingVaultKey });
      await syncProfileToCloud();
      return;
    }

    // 步驟 2：檢查公開名冊是否有同名鄰居
    const rosterSnap = await getDocs(query(rosterCollection, where("name", "==", name)));
    if (rosterSnap.empty) {
      clearFailedGuesses();
      await finishNewRegistration(name, nickname, pendingVaultKey, "01", user.uid);
    } else {
      // 有同名但密碼不符：展開二選一分流面板，不洩漏任何私密資訊
      pendingRosterMatches = deduplicateRosterByAccount(rosterSnap.docs.map((d) => d.data()));
      const listEl = document.getElementById("collisionList");
      listEl.innerHTML = pendingRosterMatches
        .slice(0, 5)
        .map((p) => `<div class="collision-item">${renderIdentityStripHtml({
          name: p.name,
          publicTag: p.publicTag,
          nickname: p.nickname,
          badgeLabel: p.badgeLabel,
          badgeCssClass: p.badgeCssClass
        })}（累計 ${p.totalMinutes || 0} 分鐘）</div>`)
        .join("");

      document.getElementById("collisionPinInput").value = "";
      document.getElementById("collisionPanel").classList.remove("hidden");
    }
  } catch (err) {
    console.error("報到失敗：", err);
    if (err && err.code === "auth/operation-not-allowed") {
      showAuthError("Firebase 尚未啟用「匿名登入（Anonymous）」，請先到 Firebase Console → Authentication 開啟。");
    } else {
      showAuthError("安全連線失敗，請確認網路狀態，並確認已啟用 Firebase 匿名登入與新版 Firestore 規則。");
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "✅ 報到並進入運動平台";
  }
}

export async function claimExistingProfile() {
  vibrateTap();
  showAuthError("");

  const waitSec = getCooldownRemainingSec();
  if (waitSec > 0) {
    showAuthError(`密碼錯誤次數過多，請稍候 ${waitSec} 秒後再重新驗證。`);
    return;
  }

  const retryPin = document.getElementById("collisionPinInput").value.trim().replace(/\D/g, "");
  if (retryPin.length !== 4) {
    showAuthError("請輸入 4 個數字的私密通關密碼進行驗證。");
    return;
  }

  const btn = document.getElementById("btnClaimExisting");
  btn.disabled = true;
  btn.textContent = "⏳ 驗證中...";

  try {
    const user = await ensureAnonymousAuth();
    const key = await computeVaultKey(pendingName, retryPin);
    const snap = await getDoc(doc(db, "recovery_vault", key));

    if (snap.exists()) {
      clearFailedGuesses();
      enterAppWithProfile({ ...snap.data(), uid: user.uid, vaultKey: key });
      await syncProfileToCloud();
    } else {
      const st = recordFailedGuess();
      if (st.until > Date.now()) {
        showAuthError("連續驗證失敗 3 次，為保護他人帳號安全，已暫時鎖定 30 秒。若您是新鄰居，請點下方「選項 B」。");
      } else {
        showAuthError(`私密 4 碼密碼不正確（剩餘 ${3 - st.fails} 次機會）。若您是第一次使用，請按下方「選項 B」建立新資料！`);
      }
    }
  } catch (err) {
    showAuthError("驗證過程發生連線錯誤，請稍後再試。");
  } finally {
    btn.disabled = false;
    btn.textContent = "🔑 驗證找回";
  }
}

export async function createDistinctProfile() {
  vibrateTap(25);
  showAuthError("");
  const btn = document.getElementById("btnCreateDistinct");
  btn.disabled = true;
  btn.textContent = "⏳ 建立新資料中...";

  try {
    const user = await ensureAnonymousAuth();
    // 雙重確認此密碼組合未被搶先建立，絕不覆蓋他人資料
    const checkSnap = await getDoc(doc(db, "recovery_vault", pendingVaultKey));
    if (checkSnap.exists()) {
      showAuthError("這組 4 碼密碼已被同名鄰居使用，請回到上方改設另一組 4 個數字！");
      return;
    }

    const nextTag = allocateNextPublicTag(pendingRosterMatches);
    clearFailedGuesses();
    await finishNewRegistration(pendingName, pendingNickname, pendingVaultKey, nextTag, user.uid);
    alert(`歡迎加入！系統已配發公開區分編號「#${nextTag}」供鄰居辨識同名，您的私密 4 碼通關密碼已安全加密。`);
  } catch (err) {
    showAuthError("建立新資料失敗，請檢查網路連線後再試。");
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ 選項 B：我是另一位同名鄰居（使用剛輸入的密碼建立全新資料）";
  }
}

async function finishNewRegistration(name, nickname, vaultKey, publicTag, uid) {
  const accountId = "acc_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const profile = {
    uid,
    accountId,
    vaultKey,
    name,
    publicTag,
    nickname: nickname || "",
    equippedBadgeId: "newbie",
    streakDays: 0,
    maxStreakDays: 0,
    lastCheckinDate: "",
    totalMinutes: 0,
    checkinDates: [],
    cheersGiven: 0
  };
  enterAppWithProfile(profile);
  await syncProfileToCloud();
}

function enterAppWithProfile(profile) {
  currentProfile = {
    uid: profile.uid || "",
    accountId: profile.accountId || profile.uid || "acc_local",
    vaultKey: profile.vaultKey || "",
    name: profile.name,
    publicTag: String(profile.publicTag || "01"),
    nickname: profile.nickname || "",
    equippedBadgeId: profile.equippedBadgeId || getHighestAutoBadgeId(profile),
    streakDays: Number(profile.streakDays) || 0,
    maxStreakDays: Math.max(Number(profile.maxStreakDays) || 0, Number(profile.streakDays) || 0),
    lastCheckinDate: profile.lastCheckinDate || "",
    totalMinutes: Number(profile.totalMinutes) || 0,
    checkinDates: Array.isArray(profile.checkinDates) ? profile.checkinDates : [],
    cheersGiven: Number(profile.cheersGiven) || 0
  };

  saveProfileLocal();
  document.getElementById("authGate").classList.add("hidden");
  document.getElementById("appShell").classList.remove("hidden");
  updateAllProfileUI();
  callbacks.onEnterApp();
}

/* =========================================
   頁首身分列、本週日曆與個人檔案彈窗
   ========================================= */
export function updateAllProfileUI() {
  if (!currentProfile) return;
  const badge = getEquippedBadge(currentProfile);
  const activeStreak = getActiveStreakDays(currentProfile);

  const idHtml = renderIdentityStripHtml({
    name: currentProfile.name,
    publicTag: currentProfile.publicTag,
    nickname: currentProfile.nickname,
    badgeLabel: badge.label,
    badgeCssClass: badge.cssClass
  });

  document.getElementById("headerUserBar").innerHTML = idHtml;
  document.getElementById("completeIdentityStrip").innerHTML = idHtml;
  document.getElementById("headerStreak").textContent = `🔥 連續運動：${activeStreak} 天`;
  document.getElementById("headerMinutes").textContent = `⏱️ 累計運動：${currentProfile.totalMinutes || 0} 分鐘`;
  renderWeeklyCalendar(currentProfile.checkinDates || []);
}

function renderWeeklyCalendar(checkinDates) {
  const grid = document.getElementById("weekGrid");
  const today = new Date();
  const todayStr = getLocalDateStr(0, today);
  const diffToMonday = today.getDay() === 0 ? -6 : 1 - today.getDay();
  const labels = ["一", "二", "三", "四", "五", "六", "日"];
  const dateSet = new Set(checkinDates);

  let completedThisWeek = 0;
  grid.innerHTML = "";
  for (let i = 0; i < 7; i++) {
    const dStr = getLocalDateStr(diffToMonday + i, today);
    const isDone = dateSet.has(dStr);
    const isToday = dStr === todayStr;
    if (isDone) completedThisWeek++;

    const cell = document.createElement("div");
    cell.className = `week-day ${isDone ? "done" : ""} ${isToday ? "today" : ""}`;
    cell.innerHTML = `<span>週${labels[i]}</span><div class="week-dot">${isDone ? "✓" : "·"}</div>`;
    grid.appendChild(cell);
  }
  document.getElementById("weeklyCountText").textContent = `本週已完成 ${completedThisWeek} 天`;
}

export function openProfileModal() {
  vibrateTap();
  if (!currentProfile) return;
  modalSelectedBadgeId = getEquippedBadge(currentProfile).id;
  document.getElementById("editNicknameInput").value = currentProfile.nickname || "";
  renderProfileModalContent();
  document.getElementById("profileModal").classList.remove("hidden");
}

export function setEditNickname(val) {
  vibrateTap();
  document.getElementById("editNicknameInput").value = val;
  renderProfileModalPreview();
}

function renderProfileModalPreview() {
  if (!currentProfile) return;
  const nick = document.getElementById("editNicknameInput").value.trim().slice(0, 8);
  const badge = getBadgeById(modalSelectedBadgeId);
  document.getElementById("modalProfilePreview").innerHTML = renderIdentityStripHtml({
    name: currentProfile.name,
    publicTag: currentProfile.publicTag,
    nickname: nick,
    badgeLabel: badge.label,
    badgeCssClass: badge.cssClass
  });
}

function renderProfileModalContent() {
  renderProfileModalPreview();
  const grid = document.getElementById("badgePickerGrid");
  grid.innerHTML = "";
  TITLE_BADGES.forEach((b) => {
    const unlocked = b.isUnlocked(currentProfile);
    const equipped = modalSelectedBadgeId === b.id;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `badge-pick-btn ${equipped ? "equipped" : ""} ${unlocked ? "" : "locked"}`;
    btn.disabled = !unlocked;
    btn.onclick = () => {
      vibrateTap();
      modalSelectedBadgeId = b.id;
      renderProfileModalContent();
    };
    btn.innerHTML = `
      <span class="title-badge-pill ${b.cssClass}">${b.label}</span>
      <span class="badge-pick-cond">${unlocked ? (equipped ? "✅ 配戴中" : "點選配戴") : "🔒 " + b.condText}</span>
    `;
    grid.appendChild(btn);
  });
}

document.getElementById("editNicknameInput").addEventListener("input", renderProfileModalPreview);

export async function saveProfileEdits() {
  vibrateTap();
  if (!currentProfile) return;
  currentProfile.nickname = document.getElementById("editNicknameInput").value.trim().slice(0, 8);
  currentProfile.equippedBadgeId = modalSelectedBadgeId;
  saveProfileLocal();
  updateAllProfileUI();
  callbacks.onProfileEdited();
  closeProfileModal();
  await syncProfileToCloud();
}

export function closeProfileModal() {
  document.getElementById("profileModal").classList.add("hidden");
}

export function logoutToAuthGate() {
  vibrateTap();
  callbacks.onBeforeLogout();
  closeProfileModal();
  localStorage.removeItem(PROFILE_STORAGE_KEY);
  currentProfile = null;
  document.getElementById("appShell").classList.add("hidden");
  document.getElementById("collisionPanel").classList.add("hidden");
  document.getElementById("authNameInput").value = "";
  document.getElementById("authNicknameInput").value = "";
  document.getElementById("authPinInput").value = "";
  syncAuthChipHighlight();
  showAuthError("");
  document.getElementById("authGate").classList.remove("hidden");
}

export function resetLocalDemoData() {
  const ok = window.confirm("確定要清除這台裝置上的登入快取、按讚紀錄與暫存佇列，並回到報到登入頁嗎？");
  if (!ok) return;
  [PROFILE_STORAGE_KEY, LOCK_KEY, "usr_reacted_map", "usr_offline_post_queue", "usr_current_profile"].forEach((k) =>
    localStorage.removeItem(k)
  );
  callbacks.onLocalReset();
  logoutToAuthGate();
}

export async function bootAuth() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "null");
    if (saved && saved.name && saved.publicTag) {
      if (navigator.onLine) {
        const user = await ensureAnonymousAuth().catch(() => null);
        if (user) saved.uid = user.uid;
      }
      enterAppWithProfile(saved);

      // 背景從私人檔案同步最新進度
      if (navigator.onLine && currentProfile.uid) {
        const snap = await getDoc(doc(db, "profiles", currentProfile.uid)).catch(() => null);
        if (snap && snap.exists()) {
          const cloud = snap.data();
          currentProfile.totalMinutes = Math.max(currentProfile.totalMinutes, Number(cloud.totalMinutes) || 0);
          currentProfile.maxStreakDays = Math.max(currentProfile.maxStreakDays, Number(cloud.maxStreakDays) || 0);
          currentProfile.cheersGiven = Math.max(currentProfile.cheersGiven, Number(cloud.cheersGiven) || 0);
          currentProfile.checkinDates = Array.from(new Set([...(currentProfile.checkinDates || []), ...(cloud.checkinDates || [])])).sort().slice(-60);
          if ((cloud.lastCheckinDate || "") > (currentProfile.lastCheckinDate || "")) {
            currentProfile.lastCheckinDate = cloud.lastCheckinDate;
            currentProfile.streakDays = Number(cloud.streakDays) || currentProfile.streakDays;
          }
          saveProfileLocal();
          updateAllProfileUI();
        }
      }
      return;
    }
  } catch (e) {}

  document.getElementById("authGate").classList.remove("hidden");
  if (navigator.onLine) ensureAnonymousAuth().catch(() => {});
}