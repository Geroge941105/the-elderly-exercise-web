import { getProfile, getEquippedBadge, getCardTierTheme, vibrateTap } from "./auth.js";

let latestBadgeDataUrl = "";
let latestBadgeMeta = { streakDays: 1, routineName: "", dateStr: "", isDemo: false, minutes: 0 };

export function getLatestBadgeMeta() {
  return latestBadgeMeta;
}

export function setLatestBadgeMeta(meta) {
  latestBadgeMeta = { ...meta };
}

function drawRoundedPill(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

export function drawAchievementBadge(meta = latestBadgeMeta) {
  const profile = getProfile();
  if (!profile) return;
  latestBadgeMeta = { ...meta };

  const { streakDays, routineName, dateStr } = latestBadgeMeta;
  const canvas = document.getElementById("badgeCanvas");
  const ctx = canvas.getContext("2d");
  const tier = getCardTierTheme(streakDays);
  const badge = getEquippedBadge(profile);

  ctx.fillStyle = tier.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = tier.border;
  ctx.lineWidth = 8;
  ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);

  ctx.fillStyle = tier.header;
  ctx.fillRect(16, 16, canvas.width - 32, 62);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 25px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("數位社會處方｜健康運動成就卡", canvas.width / 2, 56);

  // 僅顯示公開編號 #01，絕不顯示私密 4 碼
  ctx.fillStyle = "#0F172A";
  ctx.font = "900 24px sans-serif";
  ctx.fillText(`${profile.name} #${profile.publicTag}`, canvas.width / 2, 112);

  const pills = [];
  if (profile.nickname) {
    pills.push({ text: profile.nickname, bg: "#F1F5F9", stroke: "#475569", color: "#1E293B" });
  }
  pills.push({ text: badge.label, bg: badge.canvasBg, stroke: badge.canvasStroke, color: badge.canvasText });

  ctx.font = "bold 19px sans-serif";
  const widths = pills.map((p) => ctx.measureText(p.text).width + 26);
  const gap = 10;
  const totalW = widths.reduce((a, b) => a + b, 0) + gap * (pills.length - 1);
  let cursorX = (canvas.width - totalW) / 2;

  pills.forEach((p, idx) => {
    drawRoundedPill(ctx, cursorX, 126, widths[idx], 34, 8, p.bg, p.stroke);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, cursorX + widths[idx] / 2, 149);
    cursorX += widths[idx] + gap;
  });

  ctx.beginPath();
  ctx.arc(canvas.width / 2, 248, 68, 0, Math.PI * 2);
  ctx.fillStyle = tier.circleFill;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = tier.circleStroke;
  ctx.stroke();

  ctx.fillStyle = tier.numColor;
  ctx.font = "900 54px sans-serif";
  ctx.fillText(`${streakDays} 天`, canvas.width / 2, 267);

  ctx.fillStyle = "#0F172A";
  ctx.font = "bold 27px sans-serif";
  ctx.fillText(`連續運動 ${streakDays} 天達成！`, canvas.width / 2, 356);

  ctx.fillStyle = "#334155";
  ctx.font = "bold 19px sans-serif";
  ctx.fillText(`${routineName} ｜ ${dateStr}`, canvas.width / 2, 396);

  latestBadgeDataUrl = canvas.toDataURL("image/jpeg", 0.82);
  document.getElementById("badgePreviewImg").src = latestBadgeDataUrl;
}

export async function shareBadge() {
  vibrateTap();
  const profile = getProfile();
  const canvas = document.getElementById("badgeCanvas");
  const fileName = `健康成就徽章_${profile.name}_連續${latestBadgeMeta.streakDays}天.png`;

  if (navigator.share && canvas.toBlob) {
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob) {
        const file = new File([blob], fileName, { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: "數位社會處方｜健康運動成就卡",
            text: `我是${profile.name}，今天完成了「${latestBadgeMeta.routineName}」，連續運動 ${latestBadgeMeta.streakDays} 天！`,
            files: [file]
          });
          return;
        }
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }
  downloadBadge();
}

export function downloadBadge() {
  vibrateTap();
  const profile = getProfile();
  if (!latestBadgeDataUrl || !profile) return;
  const link = document.createElement("a");
  link.download = `健康成就徽章_${profile.name}_連續${latestBadgeMeta.streakDays}天.jpg`;
  link.href = latestBadgeDataUrl;
  link.click();
}