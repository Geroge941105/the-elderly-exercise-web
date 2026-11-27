import {
  addDoc,
  updateDoc,
  getDocs,
  doc,
  increment,
  query,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { db, postsCollection, ensureAnonymousAuth } from "./firebase-config.js";
import {
  getProfile,
  getEquippedBadge,
  getCardTierTheme,
  renderIdentityStripHtml,
  escapeHtml,
  vibrateTap,
  saveProfileLocal,
  syncProfileToCloud
} from "./auth.js";
import { initAudioContext, playRhythmTone, speakWithTTS, getAudioState } from "./audio.js";
import { getLatestBadgeMeta } from "./badge-canvas.js";

const WALL_PAGE_SIZE = 15;
let wallFilter = "all";
let realtimePosts = [];
let extraOlderPosts = [];
let loadedPostsMap = new Map();
let lastRealtimeDocSnap = null;
let lastLoadedDocSnap = null;
let hasMorePosts = false;
let wallSubscribed = false;
let badgePublished = false;

const pendingReactions = new Set();
let userReactedMap = JSON.parse(localStorage.getItem("usr_reacted_map") || "{}");

const callbacks = { onSwitchTab: () => {} };
export function registerSocialCallbacks(cbs) { Object.assign(callbacks, cbs); }

export function resetSocialPublishFlag() {
  badgePublished = false;
  const btn = document.getElementById("btnPublish");
  if (btn) {
    btn.disabled = false;
    btn.textContent = "📢 一鍵發布到雲端動態牆";
  }
}

export function clearLocalReactions() {
  userReactedMap = {};
}

function getOfflineQueue() {
  try {
    const list = JSON.parse(localStorage.getItem("usr_offline_post_queue") || "[]");
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function setQueueBanner(msg = "") {
  const el = document.getElementById("queueBanner");
  if (!msg) el.classList.add("hidden");
  else {
    el.textContent = msg;
    el.classList.remove("hidden");
  }
}

export async function flushOfflinePostQueue() {
  if (!navigator.onLine) return;
  const list = getOfflineQueue();
  if (list.length === 0) return;

  setQueueBanner(`☁️ 正在自動補發 ${list.length} 則離線運動紀錄...`);
  const remaining = [];
  try {
    const user = await ensureAnonymousAuth();
    for (const item of list) {
      try {
        await addDoc(postsCollection, { ...item, authorUid: user.uid, createdAt: serverTimestamp() });
      } catch (e) {
        remaining.push(item);
      }
    }
  } catch (e) {
    return;
  }

  localStorage.setItem("usr_offline_post_queue", JSON.stringify(remaining));
  if (remaining.length === 0) {
    setQueueBanner("✅ 離線運動紀錄已全部補發至雲端動態牆！");
    setTimeout(() => setQueueBanner(""), 4000);
  } else {
    setQueueBanner("");
  }
}

export async function publishToWall() {
  vibrateTap(30);
  if (badgePublished) {
    callbacks.onSwitchTab("social");
    return;
  }

  const profile = getProfile();
  const meta = getLatestBadgeMeta();
  const badge = getEquippedBadge(profile);

  const payload = {
    author: profile.name,
    publicTag: profile.publicTag,
    nickname: profile.nickname || "",
    badgeId: badge.id,
    badgeLabel: badge.label,
    badgeCssClass: badge.cssClass,
    accountId: profile.accountId,
    routineName: meta.routineName,
    streakDays: meta.streakDays,
    dateStr: meta.dateStr,
    isDemo: meta.isDemo,
    summary: `完成「${meta.routineName}」，達成連續運動 ${meta.streakDays} 天！`,
    reactions: { like: 0, clap: 0, heart: 0 }
  };

  if (!navigator.onLine) {
    const q = getOfflineQueue();
    q.push(payload);
    localStorage.setItem("usr_offline_post_queue", JSON.stringify(q));
    badgePublished = true;
    document.getElementById("btnPublish").textContent = "📦 已暫存，連網後自動發布";
    alert("目前處於離線狀態，已將成就卡安全暫存！恢復連網後會自動補發到動態牆。");
    return;
  }

  const btn = document.getElementById("btnPublish");
  btn.disabled = true;
  btn.textContent = "⏳ 正在上傳至雲端動態牆...";

  try {
    const user = await ensureAnonymousAuth();
    await addDoc(postsCollection, { ...payload, authorUid: user.uid, createdAt: serverTimestamp() });
    badgePublished = true;
    btn.textContent = "✅ 已發布至雲端動態牆";
    if (meta.isDemo && wallFilter === "official") setWallFilter("all");
    callbacks.onSwitchTab("social");
  } catch (err) {
    console.error("發布失敗：", err);
    const msg =
      err && err.code === "permission-denied"
        ? "雲端寫入權限不足，請確認已啟用匿名登入並發布新版 Firestore 規則。"
        : "發布至雲端失敗，請檢查網路連線後再試一次。";
    alert(msg);
    btn.disabled = false;
    btn.textContent = "📢 一鍵發布到雲端動態牆";
  }
}

function formatTimestamp(ts) {
  if (!ts || typeof ts.toDate !== "function") return "剛剛";
  const d = ts.toDate();
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function renderBadgeBlock(post) {
  if (typeof post.badgeImg === "string" && post.badgeImg.startsWith("data:image/")) {
    return `<img class="post-badge-img" src="${post.badgeImg}" alt="數位成就徽章" />`;
  }
  const days = Number.isFinite(Number(post.streakDays)) ? Number(post.streakDays) : 1;
  const tier = getCardTierTheme(days);
  const routine = escapeHtml(post.routineName || "每日健康運動");
  const dateStr = escapeHtml(post.dateStr || formatTimestamp(post.createdAt));

  return `
    <div class="css-badge-card ${tier.cssClass}">
      <div class="css-badge-top">數位社會處方｜健康運動成就卡</div>
      <div class="css-badge-body">
        <div class="css-badge-tier">${tier.label}</div>
        <div class="css-badge-circle">${days} 天</div>
        <div class="css-badge-title">連續運動 ${days} 天達成！</div>
        <div class="css-badge-meta">${routine} ｜ ${dateStr}</div>
      </div>
    </div>
  `;
}

export function setWallFilter(filterKey) {
  vibrateTap();
  wallFilter = filterKey;
  document.getElementById("filterAll").classList.toggle("active", filterKey === "all");
  document.getElementById("filterOfficial").classList.toggle("active", filterKey === "official");
  document.getElementById("filterMine").classList.toggle("active", filterKey === "mine");
  renderSocialWall();
}

export function renderSocialWall() {
  const container = document.getElementById("feedContainer");
  container.innerHTML = "";
  loadedPostsMap.clear();

  const seen = new Set();
  const combined = [];
  for (const item of [...realtimePosts, ...extraOlderPosts]) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      combined.push(item);
      loadedPostsMap.set(item.id, item.data);
    }
  }

  const profile = getProfile();
  const filtered = combined.filter(({ data }) => {
    if (wallFilter === "official") return !data.isDemo;
    if (wallFilter === "mine" && profile) {
      return data.accountId === profile.accountId || data.authorUid === profile.uid;
    }
    return true;
  });

  document.getElementById("loadMoreWrapper").classList.toggle("hidden", !hasMorePosts);

  if (filtered.length === 0) {
    const emptyText =
      wallFilter === "mine"
        ? "您目前還沒有發布過運動紀錄喔！完成一次運動就能一鍵發布！"
        : "目前這個分類還沒有動態喔！快去完成一次運動，搶先發布第一張成就卡吧！";
    container.innerHTML = `<div class="card empty-wall">${emptyText}</div>`;
    return;
  }

  filtered.forEach(({ id: postId, data: post }) => {
    const reactions = post.reactions || { like: 0, clap: 0, heart: 0 };
    const myReactions = userReactedMap[postId] || {};
    const fallbackTier = getCardTierTheme(post.streakDays || 1);

    const authorStrip = renderIdentityStripHtml({
      name: post.author || "長青運動員",
      publicTag: post.publicTag || post.pin4 || "",
      nickname: post.nickname || "",
      badgeLabel: post.badgeLabel || fallbackTier.label,
      badgeCssClass: post.badgeCssClass || (post.streakDays >= 7 ? "badge-master" : post.streakDays >= 3 ? "badge-steady" : "badge-starter"),
      isDemo: !!post.isDemo
    });

    const card = document.createElement("div");
    card.className = "post-card";
    card.innerHTML = `
      <div class="post-header">
        <div>${authorStrip}</div>
        <div class="post-header-right">
          <button class="read-aloud-btn" onclick="readPostAloud('${postId}')">🔊 唸給我聽</button>
          <span class="post-time">${formatTimestamp(post.createdAt)}</span>
        </div>
      </div>
      <p style="font-weight:700; margin-bottom:8px;">${escapeHtml(post.summary || "")}</p>
      ${renderBadgeBlock(post)}
      <div class="reaction-bar">
        <button class="react-btn ${myReactions.like ? "reacted" : ""}" onclick="toggleReaction('${postId}', 'like', this)">
          👍 真讚 (${Math.max(0, reactions.like || 0)})
        </button>
        <button class="react-btn ${myReactions.clap ? "reacted" : ""}" onclick="toggleReaction('${postId}', 'clap', this)">
          👏 好棒 (${Math.max(0, reactions.clap || 0)})
        </button>
        <button class="react-btn ${myReactions.heart ? "reacted" : ""}" onclick="toggleReaction('${postId}', 'heart', this)">
          ❤️ 加油 (${Math.max(0, reactions.heart || 0)})
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

export function readPostAloud(postId) {
  vibrateTap();
  const post = loadedPostsMap.get(postId);
  if (!post) return;
  const r = post.reactions || { like: 0, clap: 0, heart: 0 };
  const totalCheers = Math.max(0, r.like || 0) + Math.max(0, r.clap || 0) + Math.max(0, r.heart || 0);
  const nickPart = post.nickname ? `，綽號${post.nickname}` : "";
  const vol = Math.max(getAudioState().userVoiceVol, 0.85);
  speakWithTTS(`${post.author || "長青運動員"}${nickPart}，${post.summary || "完成了每日運動"}。目前收到 ${totalCheers} 個加油鼓勵！`, vol);
}

export async function subscribeSocialWallOnce() {
  if (wallSubscribed) return;
  wallSubscribed = true;

  try {
    await ensureAnonymousAuth();
  } catch (e) {
    wallSubscribed = false;
    return;
  }

  const latestQuery = query(postsCollection, orderBy("createdAt", "desc"), limit(WALL_PAGE_SIZE));
  onSnapshot(
    latestQuery,
    (snapshot) => {
      const statusEl = document.getElementById("cloudStatus");
      statusEl.className = "cloud-status";
      statusEl.textContent = `🟢 雲端即時連線中（最新 ${snapshot.size} 則動態同步中）`;

      realtimePosts = snapshot.docs.map((d) => ({ id: d.id, data: d.data() }));
      lastRealtimeDocSnap = snapshot.docs[snapshot.docs.length - 1] || null;
      if (extraOlderPosts.length === 0) {
        lastLoadedDocSnap = lastRealtimeDocSnap;
        hasMorePosts = snapshot.size === WALL_PAGE_SIZE;
      }
      renderSocialWall();
    },
    (error) => {
      console.error("Firestore 監聽錯誤：", error);
      const statusEl = document.getElementById("cloudStatus");
      statusEl.className = "cloud-status error";
      statusEl.textContent =
        error && error.code === "permission-denied"
          ? "🔴 雲端權限不足，請確認已啟用匿名登入並發布新版 Firestore 規則"
          : "🔴 雲端連線異常，請檢查網路狀態或 Firebase 設定";
    }
  );
}

export async function loadMorePosts() {
  vibrateTap();
  if (!lastLoadedDocSnap) return;
  const btn = document.getElementById("btnLoadMore");
  btn.disabled = true;
  btn.textContent = "⏳ 正在載入更多動態...";
  try {
    const nextQ = query(postsCollection, orderBy("createdAt", "desc"), startAfter(lastLoadedDocSnap), limit(WALL_PAGE_SIZE));
    const snap = await getDocs(nextQ);
    extraOlderPosts = [...extraOlderPosts, ...snap.docs.map((d) => ({ id: d.id, data: d.data() }))];
    lastLoadedDocSnap = snap.docs[snap.docs.length - 1] || lastLoadedDocSnap;
    hasMorePosts = snap.size === WALL_PAGE_SIZE;
    renderSocialWall();
  } catch (err) {
    alert("載入更多動態失敗，請稍後再試。");
  } finally {
    btn.disabled = false;
    btn.textContent = "⬇️ 載入更多歷史動態";
  }
}

export async function toggleReaction(postId, type, btnEl) {
  vibrateTap();
  const lockKey = `${postId}_${type}`;
  if (pendingReactions.has(lockKey)) return;

  pendingReactions.add(lockKey);
  if (btnEl) btnEl.disabled = true;

  if (!userReactedMap[postId]) userReactedMap[postId] = {};
  const already = !!userReactedMap[postId][type];
  const delta = already ? -1 : 1;

  userReactedMap[postId][type] = !already;
  localStorage.setItem("usr_reacted_map", JSON.stringify(userReactedMap));

  if (!already) {
    initAudioContext();
    playRhythmTone(true);
    const profile = getProfile();
    if (profile) {
      profile.cheersGiven = (profile.cheersGiven || 0) + 1;
      saveProfileLocal();
      syncProfileToCloud();
    }
  }

  const olderHit = extraOlderPosts.find((p) => p.id === postId);
  if (olderHit) {
    if (!olderHit.data.reactions) olderHit.data.reactions = { like: 0, clap: 0, heart: 0 };
    olderHit.data.reactions[type] = Math.max(0, (olderHit.data.reactions[type] || 0) + delta);
    renderSocialWall();
  }

  try {
    await updateDoc(doc(db, "posts", postId), { [`reactions.${type}`]: increment(delta) });
  } catch (err) {
    userReactedMap[postId][type] = already;
    localStorage.setItem("usr_reacted_map", JSON.stringify(userReactedMap));
    if (olderHit) {
      olderHit.data.reactions[type] = Math.max(0, (olderHit.data.reactions[type] || 0) - delta);
      renderSocialWall();
    }
  } finally {
    pendingReactions.delete(lockKey);
    if (btnEl) btnEl.disabled = false;
  }
}