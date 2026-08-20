// MediaPipe Pose Landmarker のラッパーと角度計算。
// 推論はすべてブラウザ内（WASM）で動く。映像は端末外に出さない。

import {
  FilesetResolver,
  PoseLandmarker,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

/** BlazePose 33点のうち、この PoC で使う添字。 */
export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
};

/** 開始前チェックで「見えていない部位」を日本語で言うための名前。 */
export const LM_NAME = {
  [LM.L_SHOULDER]: '肩', [LM.R_SHOULDER]: '肩',
  [LM.L_ELBOW]: '肘', [LM.R_ELBOW]: '肘',
  [LM.L_WRIST]: '手首', [LM.R_WRIST]: '手首',
  [LM.L_HIP]: '腰', [LM.R_HIP]: '腰',
  [LM.L_KNEE]: '膝', [LM.R_KNEE]: '膝',
  [LM.L_ANKLE]: '足首', [LM.R_ANKLE]: '足首',
};

let landmarker = null;

/**
 * Landmarker を用意する。GPU が使えない端末では CPU に落とす。
 * 初回はモデル（約6MB）をダウンロードするので時間がかかる。
 */
export async function createLandmarker() {
  if (landmarker) return landmarker;
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const base = {
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };
  try {
    landmarker = await PoseLandmarker.createFromOptions(fileset, {
      ...base,
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    });
  } catch (err) {
    console.warn('GPU delegate が使えないので CPU に切り替えます', err);
    landmarker = await PoseLandmarker.createFromOptions(fileset, {
      ...base,
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
    });
  }
  return landmarker;
}

export function detect(video, timestampMs) {
  if (!landmarker) return null;
  return landmarker.detectForVideo(video, timestampMs);
}

/**
 * 3点 a-b-c のなす角（度）。b が頂点。
 * z があれば3次元で計算する。worldLandmarks を渡すと画角の縦横比に影響されない。
 */
export function angleAt(a, b, c) {
  if (!a || !b || !c) return null;
  const abx = a.x - b.x, aby = a.y - b.y, abz = (a.z ?? 0) - (b.z ?? 0);
  const cbx = c.x - b.x, cby = c.y - b.y, cbz = (c.z ?? 0) - (b.z ?? 0);
  const magAB = Math.hypot(abx, aby, abz);
  const magCB = Math.hypot(cbx, cby, cbz);
  if (magAB === 0 || magCB === 0) return null;
  const cos = (abx * cbx + aby * cby + abz * cbz) / (magAB * magCB);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

/** その添字の関節がどれくらい確からしく見えているか（0〜1）。 */
export function visibilityOf(landmarks, index) {
  const p = landmarks?.[index];
  if (!p) return 0;
  // visibility は環境によって undefined のことがある。その場合は「見えている」扱い。
  return typeof p.visibility === 'number' ? p.visibility : 1;
}

/**
 * 左右のうち、必要な関節がよく見えている側を選ぶ。
 * 横向きに寝る腹筋では片側しか映らないため、これが要る。
 */
export function pickSide(landmarks, leftIdx, rightIdx) {
  const score = (idx) => idx.reduce((s, i) => s + visibilityOf(landmarks, i), 0) / idx.length;
  const l = score(leftIdx);
  const r = score(rightIdx);
  return r > l ? { side: 'right', indices: rightIdx, score: r } : { side: 'left', indices: leftIdx, score: l };
}

/** 骨格を canvas に描く。ライブラリの描画ユーティリティは使わず自前で引く。 */
export function drawSkeleton(ctx, landmarks, w, h, color) {
  if (!landmarks) return;
  ctx.lineWidth = Math.max(2, w / 220);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  for (const [a, b] of PoseLandmarker.POSE_CONNECTIONS) {
    const p = landmarks[a];
    const q = landmarks[b];
    if (!p || !q) continue;
    if (visibilityOf(landmarks, a) < 0.4 || visibilityOf(landmarks, b) < 0.4) continue;
    ctx.beginPath();
    ctx.moveTo(p.x * w, p.y * h);
    ctx.lineTo(q.x * w, q.y * h);
    ctx.stroke();
  }

  const r = Math.max(3, w / 160);
  landmarks.forEach((p, i) => {
    if (visibilityOf(landmarks, i) < 0.4) return;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
    ctx.fill();
  });
}
