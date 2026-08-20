// SNS に出すためのリザルト画像を canvas で描く。
// 画像素材は一切使わず、すべて図形と文字で組む（他アプリの素材を持ち込まないため）。

const FONT = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif';

const RATIOS = {
  '4:5': { w: 1080, h: 1350 },
  '1:1': { w: 1080, h: 1080 },
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 背景の同心円。単色べた塗りだと平板なので、奥行きだけ足す。 */
function drawBackdrop(ctx, w, h) {
  const bg = ctx.createLinearGradient(0, 0, w * 0.6, h);
  bg.addColorStop(0, '#161b28');
  bg.addColorStop(1, '#0a0c11');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#ff5a3c';
  const cx = w * 0.5;
  const cy = h * 0.44;
  for (let i = 0; i < 5; i += 1) {
    ctx.globalAlpha = 0.16 - i * 0.028;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.22 + i * w * 0.085, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{reps:number, exerciseName:string, seconds:number, streak:number, date:Date, ratio:string}} data
 */
export function drawResult(canvas, data) {
  const { w, h } = RATIOS[data.ratio] ?? RATIOS['4:5'];
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  drawBackdrop(ctx, w, h);
  ctx.textAlign = 'center';

  // ---- ワードマーク（自前の文字組み） ----
  ctx.fillStyle = '#ff5a3c';
  ctx.font = `800 ${Math.round(w * 0.028)}px ${FONT}`;
  ctx.letterSpacing = `${Math.round(w * 0.012)}px`;
  ctx.fillText('REPGATE', w / 2, h * 0.115);
  ctx.letterSpacing = '0px';

  ctx.fillStyle = '#98a1b8';
  ctx.font = `600 ${Math.round(w * 0.027)}px ${FONT}`;
  ctx.fillText('GATE CLEARED', w / 2, h * 0.163);

  // ---- 回数 ----
  const numY = h * 0.44;
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${Math.round(w * 0.34)}px ${FONT}`;
  const numText = String(data.reps);
  ctx.fillText(numText, w / 2, numY);

  const numWidth = ctx.measureText(numText).width;
  ctx.fillStyle = '#98a1b8';
  ctx.font = `700 ${Math.round(w * 0.062)}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('回', w / 2 + numWidth / 2 + w * 0.02, numY);
  ctx.textAlign = 'center';

  // ---- 種目 ----
  ctx.fillStyle = '#eef1f8';
  ctx.font = `700 ${Math.round(w * 0.058)}px ${FONT}`;
  ctx.fillText(data.exerciseName, w / 2, h * 0.535);

  // ---- 数字のカード3枚 ----
  const cardY = h * 0.60;
  const cardH = Math.round(h * 0.115);
  const gap = Math.round(w * 0.025);
  const pad = Math.round(w * 0.075);
  const cardW = Math.round((w - pad * 2 - gap * 2) / 3);

  const cards = [
    { k: 'かかった時間', v: formatDuration(data.seconds) },
    { k: '連続', v: `${data.streak}日` },
    { k: '1回あたり', v: data.reps ? `${(data.seconds / data.reps).toFixed(1)}秒` : '—' },
  ];

  cards.forEach((card, i) => {
    const x = pad + i * (cardW + gap);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    roundRect(ctx, x, cardY, cardW, cardH, Math.round(w * 0.022));
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#98a1b8';
    ctx.font = `600 ${Math.round(w * 0.026)}px ${FONT}`;
    ctx.fillText(card.k, x + cardW / 2, cardY + cardH * 0.36);

    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(w * 0.042)}px ${FONT}`;
    ctx.fillText(card.v, x + cardW / 2, cardY + cardH * 0.79);
  });

  // ---- 日付 ----
  ctx.fillStyle = '#788197';
  ctx.font = `600 ${Math.round(w * 0.028)}px ${FONT}`;
  ctx.fillText(formatDate(data.date), w / 2, h * 0.775);

  // ---- 下部の帯 ----
  ctx.fillStyle = '#98a1b8';
  ctx.font = `600 ${Math.round(w * 0.025)}px ${FONT}`;
  ctx.fillText('運動しないと開かないゲートを、自分の体で開けた記録', w / 2, h * 0.925);

  return canvas;
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}秒`;
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
}

function formatDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}  ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/**
 * 共有シートに画像を渡す。
 * Web の制約で SNS へ直接投稿はできないため、OS の共有シートに委ねる。
 * @returns {Promise<'shared'|'cancelled'|'unsupported'>}
 */
export async function shareCanvas(canvas, filename = 'repgate.png') {
  const blob = await canvasToBlob(canvas);
  if (!blob) return 'unsupported';
  const file = new File([blob], filename, { type: 'image/png' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      return 'unsupported';
    }
  }
  return 'unsupported';
}

export async function downloadCanvas(canvas, filename = 'repgate.png') {
  const blob = await canvasToBlob(canvas);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
