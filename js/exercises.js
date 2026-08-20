// 種目の定義と、レップを数える状態機械。
// どの種目も「伸びた状態 → 縮んだ状態 → 伸びた状態」で1回と数える。

import { LM, angleAt, pickSide, visibilityOf } from './pose.js';

/** 1レップに最低これだけかからないと数えない（ミリ秒）。勢いだけのごまかし対策。 */
export const MIN_REP_MS = 800;

/** 判定に使う関節がこの信頼度を下回るフレームは評価しない。 */
export const MIN_VISIBILITY = 0.5;

/** 開始前チェックはこれより厳しくする。 */
export const SETUP_VISIBILITY = 0.6;
export const SETUP_HOLD_MS = 1500;

export const EXERCISES = {
  situp: {
    id: 'situp',
    name: '腹筋',
    // 肩–腰–膝の角。寝ていると開き、起き上がると閉じる。
    joints: {
      left: [LM.L_SHOULDER, LM.L_HIP, LM.L_KNEE],
      right: [LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE],
    },
    contractedBelow: 95,
    extendedAbove: 130,
    setupHint: '横向きに寝た体の全体が入るように、床から少し離して斜め前に置く',
    guideTitle: '肩・腰・膝が同時に映る位置に',
    guideBody: 'カメラは体の斜め前、床から90〜180cm。真正面の床置きは数え落としが増えます。',
  },

  pushup: {
    id: 'pushup',
    name: '腕立て',
    // 肩–肘–手首の角。下ろすと閉じ、伸ばすと開く。
    joints: {
      left: [LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST],
      right: [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST],
    },
    contractedBelow: 100,
    extendedAbove: 150,
    // 胴体が直線であること。腰が落ちたレップは無効にする。
    form: {
      joints: {
        left: [LM.L_SHOULDER, LM.L_HIP, LM.L_KNEE],
        right: [LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE],
      },
      minAngle: 150,
      message: '腰が落ちています',
    },
    setupHint: '体の斜め前から、肩から足先まで入るように置く',
    guideTitle: '肩・肘・手首と、腰・膝が映る位置に',
    guideBody: 'カメラは体の斜め前。顔が下を向くので、頭が隠れても数えられるかをここで確かめます。',
  },

  squat: {
    id: 'squat',
    name: 'スクワット',
    // 腰–膝–足首の角。しゃがむと閉じ、立つと開く。
    joints: {
      left: [LM.L_HIP, LM.L_KNEE, LM.L_ANKLE],
      right: [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE],
    },
    contractedBelow: 100,
    extendedAbove: 160,
    setupHint: '全身が入るように、2〜3歩離して置く',
    guideTitle: '腰・膝・足首が映る位置に',
    guideBody: 'カメラは体の斜め前、腰の高さくらい。足元が切れると数えられません。',
  },
};

export const EXERCISE_LIST = Object.values(EXERCISES);

/**
 * そのフレームで使う角度と、判定に足る信頼度があるかを返す。
 * worldLandmarks があれば角度はそちらで計算する（画角の縦横比に左右されないため）。
 */
function readAngle(def, landmarks, worldLandmarks) {
  const chosen = pickSide(landmarks, def.joints.left, def.joints.right);
  const visible = chosen.indices.every((i) => visibilityOf(landmarks, i) >= MIN_VISIBILITY);
  const src = worldLandmarks?.length ? worldLandmarks : landmarks;
  const [a, b, c] = chosen.indices.map((i) => src[i]);
  return { angle: angleAt(a, b, c), visible, side: chosen.side, indices: chosen.indices };
}

function readForm(def, landmarks, worldLandmarks, side) {
  if (!def.form) return { ok: true, angle: null };
  const idx = def.form.joints[side];
  const visible = idx.every((i) => visibilityOf(landmarks, i) >= MIN_VISIBILITY);
  if (!visible) return { ok: true, angle: null }; // 見えないときは形を理由に落とさない
  const src = worldLandmarks?.length ? worldLandmarks : landmarks;
  const [a, b, c] = idx.map((i) => src[i]);
  const angle = angleAt(a, b, c);
  return { ok: angle == null || angle >= def.form.minAngle, angle };
}

/**
 * レップカウンター。
 *
 * 伸びきり（extendedAbove 超え）から動き出した時点を1レップの開始とし、
 * 縮みきり（contractedBelow 未満）を通過してから伸びきりに戻ったときに1回と数える。
 * 上下のしきい値を両方通過しないと数えないので、半端な可動域は加算されない。
 */
export class RepCounter {
  constructor(def) {
    this.def = def;
    this.count = 0;
    this.phase = 'init';       // init | extended | moving | contracted
    this.repStartedAt = 0;
    this.reachedContracted = false;
    this.formBroken = false;
    this.minAngleInRep = Infinity;
    this.maxAngleInRep = -Infinity;
    this.log = [];             // 検証用。1レップごとの所要時間と角度の振れ幅
  }

  /**
   * @returns {{angle:number|null, visible:boolean, progress:number,
   *            event:null|'counted'|'too_fast'|'form', message:string}}
   */
  update(landmarks, worldLandmarks, now) {
    const { angle, visible, side } = readAngle(this.def, landmarks, worldLandmarks);

    if (!visible || angle == null) {
      return { angle, visible: false, progress: this.progress(angle), event: null, message: '体が映っていません' };
    }

    const form = readForm(this.def, landmarks, worldLandmarks, side);
    if (!form.ok) this.formBroken = true;

    if (this.phase !== 'init' && this.phase !== 'extended') {
      this.minAngleInRep = Math.min(this.minAngleInRep, angle);
      this.maxAngleInRep = Math.max(this.maxAngleInRep, angle);
    }

    let event = null;
    let message = '';

    if (angle >= this.def.extendedAbove) {
      if (this.phase === 'moving' || this.phase === 'contracted') {
        // 伸びきりに戻ってきた＝1レップの終わり
        const duration = now - this.repStartedAt;
        if (!this.reachedContracted) {
          event = 'form';
          message = '可動域が足りません';
        } else if (this.formBroken) {
          event = 'form';
          message = this.def.form?.message ?? 'フォームが崩れています';
        } else if (duration < MIN_REP_MS) {
          event = 'too_fast';
          message = '速すぎます';
        } else {
          this.count += 1;
          event = 'counted';
          message = `${this.count}回`;
          this.log.push({
            n: this.count,
            ms: Math.round(duration),
            minAngle: Math.round(this.minAngleInRep),
            maxAngle: Math.round(this.maxAngleInRep),
          });
        }
      }
      this.phase = 'extended';
      this.reachedContracted = false;
      this.formBroken = false;
      this.minAngleInRep = Infinity;
      this.maxAngleInRep = -Infinity;
    } else {
      if (this.phase === 'extended' || this.phase === 'init') {
        // 伸びきりから動き出した＝1レップの開始
        this.repStartedAt = now;
        this.reachedContracted = false;
        this.formBroken = !form.ok;
        this.minAngleInRep = angle;
        this.maxAngleInRep = angle;
        this.phase = 'moving';
      }
      if (angle <= this.def.contractedBelow) {
        this.reachedContracted = true;
        this.phase = 'contracted';
      }
    }

    return { angle, visible: true, progress: this.progress(angle), event, message };
  }

  /** 伸びきり=0、縮みきり=1 の進み具合。メーター表示用。 */
  progress(angle) {
    if (angle == null) return 0;
    const { contractedBelow: lo, extendedAbove: hi } = this.def;
    return Math.min(1, Math.max(0, (hi - angle) / (hi - lo)));
  }
}

/**
 * 開始前チェック。必要な関節がすべて規定の信頼度で見えているかを、部位名つきで返す。
 */
export function checkSetup(def, landmarks) {
  const need = new Set([...def.joints.left, ...def.joints.right]);
  if (def.form) {
    for (const i of [...def.form.joints.left, ...def.form.joints.right]) need.add(i);
  }
  const chosen = pickSide(landmarks, def.joints.left, def.joints.right);
  const indices = def.form
    ? [...chosen.indices, ...def.form.joints[chosen.side]]
    : chosen.indices;

  const parts = [...new Set(indices)].map((i) => ({
    index: i,
    visibility: visibilityOf(landmarks, i),
  }));
  const ok = parts.every((p) => p.visibility >= SETUP_VISIBILITY);
  return { ok, parts, side: chosen.side, need: [...need] };
}
