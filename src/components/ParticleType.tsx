import { useEffect, useRef } from "react";

/**
 * ParticleType — モノクロームの光学点群とネットワーク線で見せる見出し粒子。
 *
 * `build → operate → research` を白・灰・黒の濃淡と形状だけで組み替える。
 * 有彩色のアクセントは一切使わず、以下のコントラストで奥行きと動きを出す。
 *
 * - 輪郭を内側より密に散布（Poisson disk）し、細い等幅書体でも字形を鋭く保つ
 * - 通常時は奥行きに応じたモノクロ階調のドットとして浮遊させ、離陸・着地・
 *   カーソル・衝撃波で励起（energy）した粒子だけ純黒／純白＋極細クロスヘアへ
 *   一時的に立ち上げる
 * - 励起した粒子どうしが近接した瞬間だけ、極細のネットワーク線（エッジ）を
 *   一瞬だけ張って消す。移動の波・カーソルの航跡・衝撃波の輪にグラフ構造が浮かぶ
 * - 高速移動する粒子には極細のベクター軌跡線を引き、クリック時には同心円の
 *   モノクロ波紋リングを広げる
 * - 組み上がり直後に四隅のクロップマーク吸着と 1px スキャン線で定着を示す
 * - 動きを減らす設定では静止画を描いて止め、画面外・非表示タブでは rAF を止める
 * - 色は `--foreground` / `--background` トークンだけから読む
 */
type ParticleTypeProps = {
  /** 巡回する語。空配列なら何も描かない */
  words?: readonly string[];
  /** 表示される読み上げ用テキスト（canvas は aria-hidden） */
  label?: string;
  className?: string;
};

/** 字形上の 1 点。edge は輪郭上なら 1 */
export type GlyphPoint = { x: number; y: number; edge: 0 | 1 };

/** 二値化した字形。ink は塗られた画素の添字、edge はそれぞれが輪郭か */
export type GlyphMask = {
  w: number;
  h: number;
  ink: Int32Array;
  edge: Uint8Array;
};

/** 1 フレーム分のカメラ。三角関数はフレームごとに 1 回だけ計算して使い回す */
export type Camera = {
  cosY: number;
  sinY: number;
  cosP: number;
  sinP: number;
  focal: number;
};

/** 投影結果。毎粒子でオブジェクトを作らないよう、呼び出し側が使い回す */
export type Projected = { x: number; y: number; z: number; scale: number };

/** 励起した粒子どうしを結ぶ 1 本のネットワーク線 */
export type NetworkEdge = { a: number; b: number; strength: number };

type WordShape = {
  points: GlyphPoint[];
  /** 点同士のおおよその間隔。点の大きさをこれに比例させる */
  spacing: number;
  size: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type Particle = {
  /** 現在の基準位置（2D、カーソルの変位・揺らぎを足す前） */
  x: number;
  y: number;
  /** モーフの始点・終点と、曲線の制御点 */
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  bx: number;
  by: number;
  /** モーフ全体（0..1）の中でこの粒子が動き出す時刻 */
  delay: number;
  /** 0: 待機 1: 飛行中 2: 着地済み。離陸・着地の瞬間に一度だけ励起を入れる */
  state: 0 | 1 | 2;
  /** 輪郭らしさ。始点と終点の値を補間する */
  edge: number;
  se: number;
  te: number;
  /** 固有の奥行き。0 が奥（小さく淡い）、1 が手前 */
  z: number;
  seed: number;
  /** ほどける量: 平面内の散り（fx, fy）、奥行き方向の散り（kz）、水平ひねり（shear） */
  fx: number;
  fy: number;
  kz: number;
  shear: number;
  /** 始点の奥行き。イントロで奥から収束するときだけ使う */
  sz: number;
  /** 励起度（0..1）。高いほど純黒／純白に寄り、クロスヘアとネットワーク線が現れる */
  energy: number;
  /** 静止時にも極小の基準クロスとして残すアンカー点か */
  anchor: boolean;
  /** カーソル・衝撃波による画面上の変位とその速度（ばねで基準位置へ戻る） */
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  /** 前フレームの画面位置。ベクター軌跡線に使う */
  lx: number;
  ly: number;
  hasLast: boolean;
};

const TAU = Math.PI * 2;
/** 着地してから次の語へ行くまで。最初の SETTLE_MS は「定着」の間 */
const HOLD_MS = 3800;
const SETTLE_MS = 1200;
/** スキャン線が字面を上から下へ走る時間 */
const SCAN_MS = 560;
const MORPH_MS = 2200;
const INTRO_MS = 2400;
/** 粒子 1 つの飛行時間（モーフ全体に対する割合）。残りを走査の時差に使う */
const FLIGHT = 0.56;
const MAX_PARTICLES = 3800;
const MIN_PARTICLES = 880;
/** 輪郭上の点の間隔を内側の何倍にするか。小さいほど字形が締まる */
const EDGE_RATIO = 0.56;
/** モノクロの透明度段階数。粒子ごとに fillStyle を変えず段階ごとにまとめて塗る */
const LEVELS = 16;
/** 励起が減衰する速さ（1/秒）。波のように走ってスッと収まる */
const ENERGY_DECAY = 2.8;
/** 静止時に字面を横切る位相波の周期 */
const WAVE_MS = 4800;
/** 変位を戻すばね。わずかに張りを残してキレよく戻す */
const SPRING = 92;
const DAMPING = 8.4;
/** ベクター軌跡線の長さ（フレーム換算） */
const TRAIL_FRAMES = 2.0;
const SHOCK_MS = 1300;
const MAX_SHOCKS = 4;
/** ネットワーク線を引く励起ノードと線の上限（60fps を確実に保つ） */
const MAX_NET_NODES = 72;
const MAX_NET_EDGES = 108;

/** 語が枠の 88% に収まる文字サイズ（等幅の前進幅は約 0.6em） */
function fontFor(width: number, height: number, word: string): number {
  const byWidth = (width * 0.88) / (Math.max(word.length, 1) * 0.6);
  return Math.min(byWidth, height * 0.6, 210);
}

/**
 * 計算済み CSS 色文字列（`#hex` / `rgb(...)` / `rgba(...)` / `color(srgb ...)`）を
 * `"r, g, b"` 形式へ変換する。`light-dark(...)` のような未解決文字列や完全透明は null を返す。
 */
export function parseCssRgb(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.startsWith("#")) {
    const hex =
      v.length === 4
        ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
        : v.length >= 7
          ? v.slice(0, 7)
          : "";
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
    const int = Number.parseInt(hex.slice(1), 16);
    return `${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}`;
  }
  const rgbMatch = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
  if (rgbMatch) {
    if (rgbMatch[4] !== undefined) {
      const a = rgbMatch[4].endsWith("%") ? Number.parseFloat(rgbMatch[4]) / 100 : Number.parseFloat(rgbMatch[4]);
      if (a === 0) return null;
    }
    return `${Math.round(Number(rgbMatch[1]))}, ${Math.round(Number(rgbMatch[2]))}, ${Math.round(Number(rgbMatch[3]))}`;
  }
  const srgbMatch = v.match(/^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i);
  if (srgbMatch) {
    if (srgbMatch[4] !== undefined) {
      const a = srgbMatch[4].endsWith("%") ? Number.parseFloat(srgbMatch[4]) / 100 : Number.parseFloat(srgbMatch[4]);
      if (a === 0) return null;
    }
    return `${Math.round(Number(srgbMatch[1]) * 255)}, ${Math.round(Number(srgbMatch[2]) * 255)}, ${Math.round(Number(srgbMatch[3]) * 255)}`;
  }
  return null;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const smoothstep = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

function shuffleInPlace<T extends { [i: number]: number; length: number }>(a: T, random: () => number): T {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/**
 * 飛行の進み u（0..1）に対する「ほどけ」の強さ（0 → 山 → 0）。
 * 山を前寄り（u ≈ 0.36）に置き、素早くほどけて精密に吸い付く感触にする。
 */
export function morphEnvelope(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  return Math.sin(Math.PI * u ** 0.7) ** 1.35;
}

/** 励起度（0..1）を 0..3 の段階へ単調に丸める */
export function energyStep(energy: number): number {
  return energy < 0.14 ? 0 : energy < 0.4 ? 1 : energy < 0.7 ? 2 : 3;
}

export function makeCamera(yaw: number, pitch: number, focal: number): Camera {
  return { cosY: Math.cos(yaw), sinY: Math.sin(yaw), cosP: Math.cos(pitch), sinP: Math.sin(pitch), focal };
}

/**
 * 中心からの座標 (x, y, z) をカメラで回して透視投影する。z は正が手前。
 * 手前に寄りすぎた粒が画面を覆わないよう、奥行きを focal の 60% で頭打ちにする。
 */
export function projectPoint(x: number, y: number, z: number, cam: Camera, out: Projected): Projected {
  const x1 = x * cam.cosY + z * cam.sinY;
  const z1 = -x * cam.sinY + z * cam.cosY;
  const y2 = y * cam.cosP - z1 * cam.sinP;
  const z2 = y * cam.sinP + z1 * cam.cosP;
  const zc = Math.min(z2, cam.focal * 0.6);
  const scale = cam.focal / (cam.focal - zc);
  out.x = x1 * scale;
  out.y = y2 * scale;
  out.z = z2;
  out.scale = scale;
  return out;
}

/**
 * カーソル周囲の力場。粒子からカーソルへの差 (dx, dy) に対し、
 * 外向きの押し出し（push）と接線方向のわずかな旋回（swirl）を out に書き、
 * ガウス減衰した影響の強さ（0..1）を返す。
 */
export function fieldForce(
  dx: number,
  dy: number,
  reach: number,
  swirl: number,
  push: number,
  out: { x: number; y: number },
): number {
  const d2 = dx * dx + dy * dy;
  const f = Math.exp(-d2 / (reach * reach));
  const d = Math.sqrt(d2) + 1e-3;
  const nx = dx / d;
  const ny = dy / d;
  out.x = (nx * push - ny * swirl) * f;
  out.y = (ny * push + nx * swirl) * f;
  return f;
}

/**
 * 励起した粒子群から、距離 maxDist 以内にあるペアを最大 maxEdges 本まで拾う。
 * 1 ノードあたりの次数を 2 本に制限し、線が一点に団子状になるのを防ぐ。
 */
export function collectNetworkEdges(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  energies: ArrayLike<number>,
  nodeIndices: ArrayLike<number>,
  nodeCount: number,
  maxDist: number,
  maxEdges: number,
): NetworkEdge[] {
  const edges: NetworkEdge[] = [];
  if (nodeCount < 2 || maxDist <= 0 || maxEdges <= 0) return edges;
  const maxD2 = maxDist * maxDist;
  const minD2 = (maxDist * 0.16) ** 2;
  const deg = new Uint8Array(nodeCount);

  for (let i = 0; i < nodeCount && edges.length < maxEdges; i++) {
    if (deg[i] >= 2) continue;
    const ai = nodeIndices[i];
    const ax = xs[ai];
    const ay = ys[ai];
    const ea = energies[i];
    for (let j = i + 1; j < nodeCount && edges.length < maxEdges; j++) {
      if (deg[j] >= 2) continue;
      const bi = nodeIndices[j];
      const dx = xs[bi] - ax;
      const dy = ys[bi] - ay;
      const d2 = dx * dx + dy * dy;
      if (d2 < minD2 || d2 > maxD2) continue;
      const dist = Math.sqrt(d2);
      const strength = Math.min(ea, energies[j]) * (1 - dist / maxDist);
      if (strength <= 0.05) continue;
      edges.push({ a: ai, b: bi, strength });
      deg[i]++;
      deg[j]++;
      if (deg[i] >= 2) break;
    }
  }
  return edges;
}

/** アルファ画像を二値化し、塗り画素と輪郭画素（4 近傍に空きがある画素）を拾う */
export function maskFromAlpha(alpha: ArrayLike<number>, w: number, h: number, stride = 4): GlyphMask {
  const on = new Uint8Array(w * h);
  let count = 0;
  for (let i = 0; i < w * h; i++) {
    if (alpha[i * stride + (stride - 1)] >= 128) {
      on[i] = 1;
      count++;
    }
  }
  const ink = new Int32Array(count);
  const edge = new Uint8Array(count);
  let k = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!on[i]) continue;
      ink[k] = i;
      edge[k] =
        x === 0 || x === w - 1 || y === 0 || y === h - 1 || !on[i - 1] || !on[i + 1] || !on[i - w] || !on[i + w]
          ? 1
          : 0;
      k++;
    }
  }
  return { w, h, ink, edge };
}

/**
 * 字形にちょうど n 個の点を散布する。
 * 輪郭画素へ先に狭い間隔で打ち、残りを内側へ打つことで細い字も鋭く見せる。
 */
export function scatterGlyph(
  mask: GlyphMask,
  n: number,
  random: () => number = Math.random,
): { points: GlyphPoint[]; spacing: number } {
  const { w, ink, edge } = mask;
  if (ink.length === 0 || n <= 0) return { points: [], spacing: 1 };

  const order = shuffleInPlace(Int32Array.from({ length: ink.length }, (_, i) => i), random);
  const edgeOrder: number[] = [];
  const innerOrder: number[] = [];
  for (const i of order) (edge[i] ? edgeOrder : innerOrder).push(i);

  const dart = (r: number) => {
    const re = r * EDGE_RATIO;
    const cell = r;
    const gw = Math.ceil(mask.w / cell) + 1;
    const gh = Math.ceil(mask.h / cell) + 1;
    const grid: (number[] | undefined)[] = new Array(gw * gh);
    const xs: number[] = [];
    const ys: number[] = [];
    const es: (0 | 1)[] = [];
    const tryAdd = (idx: number, rad: number, e: 0 | 1) => {
      const p = ink[idx];
      const px = (p % w) + 0.5;
      const py = Math.floor(p / w) + 0.5;
      const cx = Math.floor(px / cell);
      const cy = Math.floor(py / cell);
      const r2 = rad * rad;
      for (let gy = Math.max(0, cy - 1); gy <= Math.min(gh - 1, cy + 1); gy++) {
        for (let gx = Math.max(0, cx - 1); gx <= Math.min(gw - 1, cx + 1); gx++) {
          const list = grid[gy * gw + gx];
          if (!list) continue;
          for (const j of list) {
            const dx = xs[j] - px;
            const dy = ys[j] - py;
            if (dx * dx + dy * dy < r2) return;
          }
        }
      }
      const g = cy * gw + cx;
      (grid[g] ??= []).push(xs.length);
      xs.push(px);
      ys.push(py);
      es.push(e);
    };
    for (const i of edgeOrder) tryAdd(i, re, 1);
    for (const i of innerOrder) tryAdd(i, r, 0);
    return { xs, ys, es };
  };

  let r = Math.max(1, Math.sqrt(ink.length / n) * 1.05);
  let best = dart(r);
  for (let iter = 0; iter < 6; iter++) {
    const m = best.xs.length;
    if (m >= n && m <= n * 1.05) break;
    r = Math.max(0.75, r * Math.sqrt(m / n));
    const next = dart(r);
    const score = (k: number) => (k >= n ? k - n : (n - k) * 4);
    if (score(next.xs.length) < score(m)) best = next;
  }

  const points: GlyphPoint[] = best.xs.map((x, i) => ({ x, y: best.ys[i], edge: best.es[i] }));
  if (points.length > n) {
    const inner = shuffleInPlace(
      points.map((p, i) => (p.edge ? -1 : i)).filter((i) => i >= 0),
      random,
    );
    const drop = new Set(inner.slice(0, points.length - n));
    const kept = points.filter((_, i) => !drop.has(i));
    kept.length = Math.min(kept.length, n);
    return { points: kept, spacing: r };
  }
  while (points.length < n) {
    const p = ink[Math.floor(random() * ink.length)];
    points.push({ x: (p % w) + random(), y: Math.floor(p / w) + random(), edge: 0 });
  }
  return { points, spacing: r };
}

/**
 * 2 つの点集合を、左右・上下の位置関係を保って 1 対 1 に対応付ける。
 * 縦の帯に分けて並べることで、組み替え時に中央で一点に潰れないようにする。
 */
export function pairByColumns(
  from: ArrayLike<{ x: number; y: number }>,
  fromSpan: [number, number],
  to: ArrayLike<{ x: number; y: number }>,
  toSpan: [number, number],
  random: () => number = Math.random,
): Int32Array {
  const n = Math.min(from.length, to.length);
  const columns = Math.max(1, Math.round(Math.sqrt(n / 10)));
  const order = (pts: ArrayLike<{ x: number; y: number }>, [lo, hi]: [number, number]) => {
    const span = hi - lo || 1;
    const keys = new Float64Array(n);
    for (let i = 0; i < n; i++) keys[i] = (pts[i].x - lo) / span + (random() - 0.5) * 0.03;
    const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => keys[a] - keys[b]);
    for (let c = 0; c < columns; c++) {
      const a = Math.floor((c * n) / columns);
      const b = Math.floor(((c + 1) * n) / columns);
      const band = idx.slice(a, b).sort((p, q) => pts[p].y - pts[q].y);
      for (let k = 0; k < band.length; k++) idx[a + k] = band[k];
    }
    return idx;
  };
  const a = order(from, fromSpan);
  const b = order(to, toSpan);
  const result = new Int32Array(n);
  for (let k = 0; k < n; k++) result[a[k]] = b[k];
  return result;
}

export function ParticleType({ words = [], label, className = "" }: ParticleTypeProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas || words.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const off = document.createElement("canvas");
    const offCtx = off.getContext("2d", { willReadFrequently: true });
    if (!offCtx) return;

    let width = 0;
    let height = 0;
    let inkRgb = "10, 10, 10";
    let dark = false;
    /** モノクロの透明度段階ごとの fillStyle */
    let styles: string[] = [];

    let shapes: WordShape[] = [];
    let particles: Particle[] = [];
    let index = 0;
    let fromIndex = 0;
    let frame = 0;
    let visible = true;
    let ready = false;
    let morphing = false;
    let morphMs = MORPH_MS;
    let sweepDir = 1;
    let phaseStart = 0;
    let clock = 0;
    let introDone = false;

    let idleAmt = 0;
    let waveGain = 0;
    let camYaw = 0;
    let camPitch = 0;
    let bracketOpen = 1;
    let bracketVel = 0;

    // 描画バッファ。毎フレームの配列確保を避ける
    let px = new Float32Array(0);
    let py = new Float32Array(0);
    let pr = new Float32Array(0);
    let ptx = new Float32Array(0);
    let pty = new Float32Array(0);
    let pCross = new Uint8Array(0);
    let bucketOf = new Uint8Array(0);
    let drawOrder = new Int32Array(0);
    const bucketCount = new Int32Array(LEVELS + 1);
    const HIDDEN = 255;

    // ネットワーク線を張る励起ノードの一時バッファ
    const netNodes = new Int32Array(MAX_NET_NODES);
    const netEnergies = new Float32Array(MAX_NET_NODES);

    // 背景の奥行きダスト（純粋なモノクロ）
    let dustCount = 0;
    let dX = new Float32Array(0);
    let dY = new Float32Array(0);
    let dZ = new Float32Array(0);
    let dSeed = new Float32Array(0);
    let dPlus = new Uint8Array(0);

    const pointer = { x: 0, y: 0, inside: false };
    const cursor = { x: 0, y: 0, vx: 0, vy: 0, presence: 0, live: false };
    const shocks: { x: number; y: number; t: number }[] = [];

    const P: Projected = { x: 0, y: 0, z: 0, scale: 1 };
    const V = { x: 0, y: 0 };

    const readTheme = () => {
      // カスタムプロパティ（--foreground / --background）は light-dark() 未評価のまま返るため、
      // ブラウザが解決済みの計算済み color / backgroundColor から RGB を読む。
      const isDarkClass =
        document.documentElement.classList.contains("dark") ||
        document.querySelector('meta[name="color-scheme"]')?.getAttribute("content") === "dark";
      const fgFallback = isDarkClass ? "242, 242, 242" : "10, 10, 10";
      const bgFallback = isDarkClass ? "10, 10, 10" : "255, 255, 255";

      inkRgb =
        parseCssRgb(getComputedStyle(wrap).color) ??
        parseCssRgb(getComputedStyle(document.body).color) ??
        fgFallback;
      const bgRgb = parseCssRgb(getComputedStyle(document.body).backgroundColor) ?? bgFallback;
      const bg = bgRgb.split(",").map(Number);
      dark = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255 < 0.5;
      styles = [];
      for (let l = 0; l < LEVELS; l++) {
        styles.push(`rgba(${inkRgb}, ${((l + 1) / LEVELS).toFixed(3)})`);
      }
    };

    const rasterize = (word: string, font: string, size: number): GlyphMask => {
      off.width = Math.max(1, Math.round(width));
      off.height = Math.max(1, Math.round(height));
      offCtx.clearRect(0, 0, off.width, off.height);
      offCtx.fillStyle = "#000";
      offCtx.textAlign = "center";
      offCtx.textBaseline = "middle";
      offCtx.font = `500 ${size}px ${font}`;
      offCtx.fillText(word, off.width / 2, off.height / 2);
      const data = offCtx.getImageData(0, 0, off.width, off.height).data;
      return maskFromAlpha(data, off.width, off.height);
    };

    const shapeWord = (word: string, font: string, n: number): WordShape => {
      const size = Math.round(fontFor(width, height, word));
      const mask = rasterize(word, font, size);
      const { points, spacing } = scatterGlyph(mask, n);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of points) {
        p.x += (Math.random() - 0.5) * 0.45;
        p.y += (Math.random() - 0.5) * 0.45;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      return { points, spacing, size, minX, maxX, minY, maxY };
    };

    /** ほどけ方: 層状に広がる水平スウィープと薄い奥行き */
    const setUnravel = (p: Particle, size: number, scale: number) => {
      const band = Math.sin(p.sy * 0.032 + p.seed * 2.2);
      p.fx = sweepDir * size * (0.14 + 0.28 * Math.abs(band)) * scale;
      p.fy = (Math.cos(p.sx * 0.02 + p.seed * TAU) * 0.22 + (p.seed - 0.5) * 0.16) * size * scale;
      p.kz = (p.z - 0.45) * size * 2.1 * scale + (Math.random() - 0.5) * size * 0.65;
      p.shear = sweepDir * (0.28 + 0.42 * p.seed) * scale;
    };

    const assignTargets = (from: WordShape, to: WordShape) => {
      const pairs = pairByColumns(particles, [from.minX, from.maxX], to.points, [to.minX, to.maxX]);
      const span = to.maxX - to.minX || 1;
      const slack = 1 - FLIGHT;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const t = to.points[pairs[i]];
        p.sx = p.x;
        p.sy = p.y;
        p.se = p.edge;
        p.tx = t.x;
        p.ty = t.y;
        p.te = t.edge;
        p.sz = 0;
        p.state = 0;
        const dx = p.tx - p.sx;
        const dy = p.ty - p.sy;
        const dist = Math.hypot(dx, dy) || 1;
        const bend = (p.seed - 0.5) * 0.55 * dist;
        p.bx = (p.sx + p.tx) / 2 - (dy / dist) * bend;
        p.by = (p.sy + p.ty) / 2 + (dx / dist) * bend;
        setUnravel(p, to.size, 1);
        const normX = clamp01((t.x - to.minX) / span);
        const ordered = sweepDir > 0 ? normX : 1 - normX;
        p.delay = slack * (0.78 * ordered + 0.22 * Math.random());
      }
    };

    /** 初回のみ、奥行きのある薄い点群シートから文字へ収束させる */
    const launchIntro = () => {
      const to = shapes[index];
      const span = to.maxX - to.minX || 1;
      const slack = 1 - FLIGHT;
      const cx = width / 2;
      const cy = height / 2;
      for (const p of particles) {
        const spreadX = (Math.random() * 2 - 1) * width * 0.46;
        const spreadY = (Math.random() * 2 - 1) * height * 0.38;
        p.sx = cx + spreadX;
        p.sy = cy + spreadY;
        p.sz = (Math.random() * 2 - 1) * Math.max(width, height) * 0.48;
        p.bx = (p.sx + p.tx) / 2;
        p.by = (p.sy + p.ty) / 2;
        p.x = p.sx;
        p.y = p.sy;
        p.se = 0;
        p.state = 0;
        setUnravel(p, to.size, 1.1);
        p.delay = slack * (0.62 * clamp01((p.tx - to.minX) / span) + 0.38 * Math.random());
      }
      morphing = true;
      morphMs = INTRO_MS;
      fromIndex = index;
      phaseStart = clock;
      bracketOpen = 1;
    };

    const build = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      readTheme();

      const font = getComputedStyle(document.body).getPropertyValue("--font-mono").trim() || "ui-monospace";
      let total = 0;
      for (const word of words) {
        const size = Math.round(fontFor(width, height, word));
        const area = rasterize(word, font, size).ink.length;
        const gap = Math.max(2.3, size / 58);
        total += area / (gap * gap);
      }
      const n = Math.round(Math.min(MAX_PARTICLES, Math.max(MIN_PARTICLES, total / words.length)));
      shapes = words.map((word) => shapeWord(word, font, n));

      const current = shapes[index];
      particles = current.points.map((t) => {
        const z = Math.random() ** 1.45;
        const anchor = t.edge === 1 && Math.random() < 0.022;
        return {
          x: t.x,
          y: t.y,
          sx: t.x,
          sy: t.y,
          tx: t.x,
          ty: t.y,
          bx: t.x,
          by: t.y,
          delay: 0,
          state: 2,
          edge: t.edge,
          se: t.edge,
          te: t.edge,
          z: anchor ? 0.72 + 0.28 * z : z,
          seed: Math.random(),
          fx: 0,
          fy: 0,
          kz: 0,
          shear: 0,
          sz: 0,
          energy: 0,
          anchor,
          ox: 0,
          oy: 0,
          vx: 0,
          vy: 0,
          lx: 0,
          ly: 0,
          hasLast: false,
        };
      });
      fromIndex = index;
      morphing = false;
      morphMs = MORPH_MS;
      phaseStart = clock;

      dustCount = Math.round(Math.min(260, Math.max(90, (width * height) / 1900)));
      dX = new Float32Array(dustCount);
      dY = new Float32Array(dustCount);
      dZ = new Float32Array(dustCount);
      dSeed = new Float32Array(dustCount);
      dPlus = new Uint8Array(dustCount);
      for (let i = 0; i < dustCount; i++) {
        dX[i] = (Math.random() * 2 - 1) * width * 0.68;
        dY[i] = (Math.random() * 2 - 1) * height * 0.56;
        dZ[i] = Math.random();
        dSeed[i] = Math.random();
        dPlus[i] = Math.random() < 0.08 ? 1 : 0;
      }

      const total2 = n + dustCount;
      px = new Float32Array(total2);
      py = new Float32Array(total2);
      pr = new Float32Array(total2);
      ptx = new Float32Array(total2);
      pty = new Float32Array(total2);
      pCross = new Uint8Array(total2);
      bucketOf = new Uint8Array(total2);
      drawOrder = new Int32Array(total2);
    };

    const updateCursor = (dt: number) => {
      const s = dt / 1000;
      if (pointer.inside) {
        if (!cursor.live) {
          cursor.x = pointer.x;
          cursor.y = pointer.y;
          cursor.vx = 0;
          cursor.vy = 0;
          cursor.live = true;
        }
        const follow = 1 - Math.exp(-s * 22);
        const nx = cursor.x + (pointer.x - cursor.x) * follow;
        const ny = cursor.y + (pointer.y - cursor.y) * follow;
        const k = 1 - Math.exp(-s * 10);
        cursor.vx += ((nx - cursor.x) / Math.max(s, 0.001) - cursor.vx) * k;
        cursor.vy += ((ny - cursor.y) / Math.max(s, 0.001) - cursor.vy) * k;
        const speed = Math.hypot(cursor.vx, cursor.vy);
        if (speed > 2400) {
          cursor.vx *= 2400 / speed;
          cursor.vy *= 2400 / speed;
        }
        cursor.x = nx;
        cursor.y = ny;
        cursor.presence += (1 - cursor.presence) * (1 - Math.exp(-s * 6));
      } else {
        cursor.presence *= Math.exp(-s * 4.5);
        cursor.vx *= Math.exp(-s * 6);
        cursor.vy *= Math.exp(-s * 6);
        if (cursor.presence < 0.002) {
          cursor.presence = 0;
          cursor.live = false;
        }
      }
    };

    /** クリック衝撃波のモノクロ同心円リング */
    const drawShockRings = () => {
      if (shocks.length === 0) return;
      ctx.lineWidth = 1;
      for (let k = 0; k < shocks.length; k++) {
        const sh = shocks[k];
        const age = clock - sh.t;
        const p = clamp01(age / SHOCK_MS);
        const fadeOut = (1 - p) * (1 - p);
        const r1 = age * 0.72;
        if (r1 > 2 && fadeOut > 0.02) {
          ctx.beginPath();
          ctx.arc(sh.x, sh.y, r1, 0, TAU);
          ctx.strokeStyle = `rgba(${inkRgb}, ${(fadeOut * (dark ? 0.34 : 0.24)).toFixed(3)})`;
          ctx.stroke();
        }
        const r2 = r1 * 0.68;
        if (r2 > 2 && fadeOut > 0.04) {
          ctx.beginPath();
          ctx.arc(sh.x, sh.y, r2, 0, TAU);
          ctx.strokeStyle = `rgba(${inkRgb}, ${(fadeOut * (dark ? 0.16 : 0.12)).toFixed(3)})`;
          ctx.stroke();
        }
      }
    };

    /** ミニマル計測器 HUD: クロップマーク・1px スキャン線・モノクロ進捗線 */
    const drawHud = (
      cam: Camera,
      box: { minX: number; maxX: number; minY: number; maxY: number },
      fontSize: number,
      breathe: number,
      flash: number,
      scan: number,
      hold: number,
      animate: boolean,
    ) => {
      const cx = width / 2;
      const cy = height / 2;
      const pad = fontSize * (0.14 + 0.34 * bracketOpen);
      const x0 = (box.minX - cx - pad) * breathe;
      const x1 = (box.maxX - cx + pad) * breathe;
      const y0 = (box.minY - cy - pad) * breathe;
      const y1 = (box.maxY - cy + pad) * breathe;
      const corners = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ].map(([x, y]) => {
        projectPoint(x, y, 0, cam, P);
        return [cx + P.x, cy + P.y];
      });
      const arm = Math.min(fontSize * 0.16, 22);
      const along = (a: number[], b: number[]) => {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const k = Math.min(1, arm / len);
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      };

      ctx.lineWidth = 1;
      ctx.lineCap = "square";
      const baseAlpha = (dark ? 0.3 : 0.24) * (1 - 0.55 * clamp01(bracketOpen)) + flash * 0.45;
      ctx.beginPath();
      for (let c = 0; c < 4; c++) {
        const here = corners[c];
        const prev = corners[(c + 3) % 4];
        const next = corners[(c + 1) % 4];
        const a = along(here, prev);
        const b = along(here, next);
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(here[0], here[1]);
        ctx.lineTo(b[0], b[1]);
      }
      ctx.strokeStyle = `rgba(${inkRgb}, ${Math.min(0.85, baseAlpha).toFixed(3)})`;
      ctx.stroke();

      if (!animate) return;

      // 定着の 1px 走査線（左右に極小ティック付き）
      if (scan > 0 && scan < 1) {
        const sy = (box.minY - cy + (box.maxY - box.minY) * easeOutCubic(scan)) * breathe;
        projectPoint(x0, sy, 0, cam, P);
        const ax = cx + P.x;
        const ay = cy + P.y;
        projectPoint(x1, sy, 0, cam, P);
        const bx = cx + P.x;
        const by = cy + P.y;
        const alpha = (1 - scan) * (dark ? 0.65 : 0.5);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.moveTo(ax, ay - 3);
        ctx.lineTo(ax, ay + 3);
        ctx.moveTo(bx, by - 3);
        ctx.lineTo(bx, by + 3);
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(${inkRgb}, ${alpha.toFixed(3)})`;
        ctx.stroke();
      }

      // 下辺の進捗線と極小の語インデックス
      if (hold > 0) {
        const bl = corners[3];
        const br = corners[2];
        const gap = 8;
        const tx0 = bl[0];
        const ty0 = bl[1] + gap;
        const tx1 = br[0];
        const ty1 = br[1] + gap;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tx0, ty0);
        ctx.lineTo(tx1, ty1);
        ctx.strokeStyle = `rgba(${inkRgb}, ${dark ? 0.14 : 0.1})`;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(tx0, ty0);
        ctx.lineTo(tx0 + (tx1 - tx0) * hold, ty0 + (ty1 - ty0) * hold);
        ctx.strokeStyle = `rgba(${inkRgb}, ${dark ? 0.62 : 0.5})`;
        ctx.stroke();

        const labelText = `${String(index + 1).padStart(2, "0")}/${String(words.length).padStart(2, "0")}`;
        ctx.font = '500 10px "Geist Mono", ui-monospace, Menlo, monospace';
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        ctx.fillStyle = `rgba(${inkRgb}, ${dark ? 0.45 : 0.38})`;
        ctx.fillText(labelText, tx1, ty1 + 5);
      }
    };

    const render = (dt: number, animate: boolean) => {
      if (particles.length === 0) return;
      const s = dt / 1000;
      if (animate) {
        clock += dt;
        if (!morphing && clock - phaseStart > HOLD_MS) {
          fromIndex = index;
          index = (index + 1) % words.length;
          sweepDir = -sweepDir;
          assignTargets(shapes[fromIndex], shapes[index]);
          morphing = true;
          morphMs = MORPH_MS;
          phaseStart = clock;
        }
        updateCursor(dt);
        for (let k = shocks.length - 1; k >= 0; k--) {
          if (clock - shocks[k].t > SHOCK_MS) shocks.splice(k, 1);
        }
      }

      const progress = morphing ? clamp01((clock - phaseStart) / morphMs) : 1;
      const from = shapes[fromIndex];
      const to = shapes[index];
      const mix = easeInOutCubic(progress);
      const lerp = (a: number, b: number) => a + (b - a) * mix;
      const spacing = lerp(from.spacing, to.spacing);
      const fontSize = lerp(from.size, to.size);
      const dotBase = spacing * 0.29;
      const cx = width / 2;
      const cy = height / 2;
      const t = clock;
      const morphPulse = morphing ? Math.sin(Math.PI * progress) : 0;

      const lockAge = morphing ? -1 : clock - phaseStart;
      const flash = animate && lockAge >= 0 ? Math.exp(-lockAge / 260) : 0;
      const scan = animate && lockAge >= 0 && lockAge < SCAN_MS ? lockAge / SCAN_MS : 0;
      const scanY = from.minY + (from.maxY - from.minY) * easeOutCubic(scan);
      const scanW = Math.max(4, (to.maxY - to.minY) * 0.065);
      const hold = animate && lockAge >= 0 ? clamp01(lockAge / HOLD_MS) : 0;

      if (animate) {
        const idleTarget = morphing ? 0.16 : smoothstep((lockAge - 240) / (SETTLE_MS - 240));
        idleAmt += (idleTarget - idleAmt) * (1 - Math.exp(-s * 5));
        waveGain += ((morphing ? 0 : idleTarget) - waveGain) * (1 - Math.exp(-s * 3));

        const cnx = Math.max(-1.4, Math.min(1.4, (cursor.x / width - 0.5) * 2));
        const cny = Math.max(-1.4, Math.min(1.4, (cursor.y / height - 0.5) * 2));
        const yawTarget =
          Math.sin(t * 0.00019) * 0.11 - cnx * 0.26 * cursor.presence + morphPulse * 0.18 * sweepDir;
        const pitchTarget = Math.sin(t * 0.00015 + 1.2) * 0.06 + cny * 0.18 * cursor.presence;
        const ck = 1 - Math.exp(-s * 2.8);
        camYaw += (yawTarget - camYaw) * ck;
        camPitch += (pitchTarget - camPitch) * ck;

        const target = morphing ? Math.min(1, morphPulse * 1.5) : 0;
        bracketVel += ((target - bracketOpen) * 280 - bracketVel * 18) * s;
        bracketOpen += bracketVel * s;
      }

      const yaw = animate ? camYaw : 0;
      const pitch = animate ? camPitch : 0;
      const focal = Math.max(width, height) * 1.65;
      const cam = makeCamera(yaw, pitch, focal);
      const breathe = animate ? 1 + 0.009 * Math.sin((t / 5400) * TAU) * idleAmt : 1;
      const depthSpread = fontSize * 0.24;

      const waveT = (t % WAVE_MS) / WAVE_MS;
      const bandW = fontSize * 0.48;
      const bandX = -bandW * 2 + (waveT / 0.65) * (width + bandW * 4);
      const bandOn = animate && waveT < 0.65 ? waveGain : 0;

      const reach = fontSize * 0.64;
      const cut2 = reach * reach * 6;
      const presence = animate ? cursor.presence : 0;
      const cursorSpeed = Math.min(1, Math.hypot(cursor.vx, cursor.vy) / 1400);
      const swirlGain = SPRING * reach * (0.16 + 0.34 * cursorSpeed);
      const pushGain = SPRING * reach * (0.14 + 0.44 * cursorSpeed);
      const cool = animate ? Math.exp(-s * ENERGY_DECAY) : 1;
      const frameScale = 16.7 / Math.max(dt, 1);
      const maxTrail = fontSize * 0.24;
      const shockW = fontSize * 0.18;

      // 普段は階調内に収め、励起時だけ 1.0 の純黒／純白まで伸ばす（ダーク時は視認性のため下限を上げる）
      const alphaFloor = dark ? 0.36 : 0.22;
      const alphaRange = dark ? 0.56 : 0.56;
      const fade = 24;
      bucketCount.fill(0);
      let netCount = 0;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        let bump = 0;
        let e = 1;

        if (morphing && animate) {
          const u = clamp01((progress - p.delay) / FLIGHT);
          if (u > 0 && p.state === 0) {
            p.state = 1;
            if (p.energy < 0.35) p.energy = 0.35;
          }
          e = easeInOutCubic(u);
          const w = 1 - e;
          p.x = w * w * p.sx + 2 * w * e * p.bx + e * e * p.tx;
          p.y = w * w * p.sy + 2 * w * e * p.by + e * e * p.ty;
          p.edge = p.se + (p.te - p.se) * e;
          bump = morphEnvelope(u);
          if (u >= 1 && p.state === 1) {
            p.state = 2;
            p.energy = 1;
            const ax = p.tx - p.bx;
            const ay = p.ty - p.by;
            const al = Math.hypot(ax, ay) || 1;
            p.vx += (ax / al) * fontSize * 0.26;
            p.vy += (ay / al) * fontSize * 0.26;
          }
        } else if (!animate) {
          p.x = p.tx;
          p.y = p.ty;
          p.edge = p.te;
        }

        let wx = p.x - cx;
        let wy = p.y - cy;
        let wz = (p.z - 0.5) * depthSpread;

        if (animate) {
          if (bump > 0) {
            wx += p.fx * bump;
            wy += p.fy * bump;
            wz += p.kz * bump;
          }
          if (p.sz !== 0 && morphing) wz += p.sz * (1 - e);
          if (idleAmt > 0.001) {
            const sp = 0.3 + 0.7 * p.z;
            const amp = spacing * 0.34 * sp * idleAmt;
            wx += Math.sin(t * 0.0005 * (0.6 + p.z) + p.seed * 40) * amp;
            wy += Math.cos(t * 0.00043 * (0.6 + p.z) + p.seed * 27) * amp;
            wz += Math.sin((p.x - cx) * 0.014 - t * 0.0016) * fontSize * 0.075 * idleAmt;
          }
          wx *= breathe;
          wy *= breathe;
          if (bump > 0) {
            const a = p.shear * bump;
            const c = Math.cos(a);
            const sn = Math.sin(a);
            const nx = wx * c - wz * sn;
            wz = wx * sn + wz * c;
            wx = nx;
          }
        }

        projectPoint(wx, wy, wz, cam, P);
        let x = cx + P.x;
        let y = cy + P.y;
        const scale = P.scale;

        if (animate) {
          let ax = -SPRING * p.ox - DAMPING * p.vx;
          let ay = -SPRING * p.oy - DAMPING * p.vy;
          const depthGain = 0.45 + 0.85 * p.z;
          let active = false;
          if (presence > 0) {
            const dx = x + p.ox - cursor.x;
            const dy = y + p.oy - cursor.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < cut2) {
              const f = fieldForce(dx, dy, reach, swirlGain, pushGain, V) * presence * depthGain;
              ax += V.x * presence * depthGain;
              ay += V.y * presence * depthGain;
              ax += cursor.vx * f * SPRING * 0.022;
              ay += cursor.vy * f * SPRING * 0.022;
              const h = f * (0.35 + 0.85 * cursorSpeed);
              if (h > p.energy) p.energy = h;
              active = true;
            }
          }
          for (let k = 0; k < shocks.length; k++) {
            const sh = shocks[k];
            const age = t - sh.t;
            const ring = age * 0.72;
            const dx = x - sh.x;
            const dy = y - sh.y;
            const d = Math.sqrt(dx * dx + dy * dy) + 1e-3;
            const off = (d - ring) / shockW;
            if (off > -3 && off < 3) {
              const g = Math.exp(-off * off) * (1 - age / SHOCK_MS);
              ax += (dx / d) * g * SPRING * fontSize * 0.28 * depthGain;
              ay += (dy / d) * g * SPRING * fontSize * 0.28 * depthGain;
              if (g > p.energy) p.energy = g;
              active = true;
            }
          }
          if (active || p.ox * p.ox + p.oy * p.oy > 0.0004 || p.vx * p.vx + p.vy * p.vy > 0.01) {
            p.vx += ax * s;
            p.vy += ay * s;
            p.ox += p.vx * s;
            p.oy += p.vy * s;
          } else {
            p.ox = p.oy = p.vx = p.vy = 0;
          }
          x += p.ox;
          y += p.oy;
        }

        const depthN = clamp01(0.5 + P.z / (fontSize * 1.15));
        const eStep = energyStep(p.energy);
        let alpha =
          alphaFloor + alphaRange * (0.55 * p.z ** 0.9 + 0.45 * depthN) + 0.1 * p.edge + p.energy * 0.34;
        let radius = dotBase * scale * (0.64 + 0.52 * p.z) * (1 + 0.08 * p.edge + p.energy * 0.22);

        if (animate) {
          if (bandOn > 0) {
            const band = (x + (y - height / 2) * 0.4 - bandX) / bandW;
            if (band > -3 && band < 3) {
              const g = Math.exp(-band * band) * bandOn;
              alpha += g * 0.26;
              radius *= 1 + g * (0.14 + 0.28 * p.z);
              y -= g * (0.5 + 1.3 * p.z);
            }
          }
          alpha += flash * 0.18;
          if (scan > 0) {
            const g = Math.exp(-(((p.y - scanY) / scanW) ** 2)) * (1 - scan);
            alpha += g * 0.38;
            radius *= 1 + g * 0.4;
          }
          alpha *= 1 - bump * 0.18;
          p.energy *= cool;
        }
        if (radius > dotBase * 2.8) radius = dotBase * 2.8;

        const edgeDist = Math.min(x, width - x, y, height - y);
        if (edgeDist < fade) alpha *= clamp01(edgeDist / fade);
        if (alpha <= 0.02) {
          bucketOf[i] = HIDDEN;
          p.hasLast = false;
          continue;
        }

        let tx = 0;
        let ty = 0;
        if (animate && p.hasLast) {
          tx = (x - p.lx) * TRAIL_FRAMES * frameScale;
          ty = (y - p.ly) * TRAIL_FRAMES * frameScale;
          const len2 = tx * tx + ty * ty;
          if (len2 < 4) {
            tx = ty = 0;
          } else if (len2 > maxTrail * maxTrail) {
            const k = maxTrail / Math.sqrt(len2);
            tx *= k;
            ty *= k;
          }
        }
        p.lx = x;
        p.ly = y;
        p.hasLast = animate;

        const level = Math.max(0, Math.min(LEVELS - 1, Math.round(clamp01(alpha) * LEVELS) - 1));
        px[i] = x;
        py[i] = y;
        pr[i] = radius;
        ptx[i] = tx;
        pty[i] = ty;
        pCross[i] = eStep >= 3 || (p.anchor && !morphing) ? 1 : 0;
        bucketOf[i] = level;
        bucketCount[level + 1]++;

        // 励起した手前の粒子からネットワーク線用のノードを均等にサンプリング
        if (animate && p.energy > 0.26 && netCount < MAX_NET_NODES && (i & 3) === 0) {
          netNodes[netCount] = i;
          netEnergies[netCount] = p.energy;
          netCount++;
        }
      }

      // 背景の奥行きダスト（完全モノクロ）
      const n = particles.length;
      const gust = 1 + 3.2 * morphPulse;
      const zSpan = focal * 0.9;
      for (let j = 0; j < dustCount; j++) {
        const i = n + j;
        const z = dZ[j];
        if (animate) {
          dX[j] += (5 + 22 * z) * gust * s;
          dY[j] += Math.sin(t * 0.00038 + dSeed[j] * 30) * (2.5 + 5 * z) * s;
          if (dX[j] > width * 0.68) dX[j] -= width * 1.36;
        }
        projectPoint(dX[j], dY[j], (z - 0.58) * zSpan, cam, P);
        let x = cx + P.x;
        let y = cy + P.y;
        if (presence > 0) {
          const dx = x - cursor.x;
          const dy = y - cursor.y;
          fieldForce(dx, dy, reach * 1.25, 0.7, 0.3, V);
          const k = reach * 0.24 * presence * (0.4 + z);
          x += V.x * k;
          y += V.y * k;
        }
        const edgeDist = Math.min(x, width - x, y, height - y);
        const depthN = clamp01(0.5 + P.z / (focal * 0.6));
        let alpha = (dark ? 0.09 : 0.07) + 0.22 * depthN;
        if (animate) alpha *= 0.7 + 0.3 * Math.sin(t * 0.0019 + dSeed[j] * 50);
        if (edgeDist < fade) alpha *= clamp01(edgeDist / fade);
        if (alpha <= 0.02) {
          bucketOf[i] = HIDDEN;
          continue;
        }
        const radius = Math.min(2.1, Math.max(0.35, 0.55 * P.scale * P.scale));
        const level = Math.max(0, Math.min(LEVELS - 1, Math.round(clamp01(alpha) * LEVELS) - 1));
        px[i] = x;
        py[i] = y;
        pr[i] = radius;
        ptx[i] = 0;
        pty[i] = 0;
        pCross[i] = dPlus[j];
        bucketOf[i] = level;
        bucketCount[level + 1]++;
      }

      const totalCount = n + dustCount;
      for (let b = 1; b < bucketCount.length; b++) bucketCount[b] += bucketCount[b - 1];
      const cursorPos = bucketCount.slice();
      for (let i = 0; i < totalCount; i++) {
        const b = bucketOf[i];
        if (b !== HIDDEN) drawOrder[cursorPos[b]++] = i;
      }

      ctx.clearRect(0, 0, width, height);

      // 1. 励起した粒子どうしの極細ネットワーク線（エッジ）
      if (animate && netCount >= 2) {
        const edges = collectNetworkEdges(
          px,
          py,
          netEnergies,
          netNodes,
          netCount,
          fontSize * 0.26,
          MAX_NET_EDGES,
        );
        if (edges.length > 0) {
          ctx.lineWidth = 0.75;
          for (let k = 0; k < edges.length; k++) {
            const edge = edges[k];
            const alpha = edge.strength * (dark ? 0.5 : 0.32);
            ctx.beginPath();
            ctx.moveTo(px[edge.a], py[edge.a]);
            ctx.lineTo(px[edge.b], py[edge.b]);
            ctx.strokeStyle = `rgba(${inkRgb}, ${alpha.toFixed(3)})`;
            ctx.stroke();
          }
        }
      }

      // 2. クリック衝撃波の同心円リング
      if (animate) drawShockRings();

      // 3. 高速移動中の極細ベクター軌跡線
      if (animate) {
        ctx.lineWidth = 0.9;
        ctx.strokeStyle = `rgba(${inkRgb}, ${dark ? 0.4 : 0.24})`;
        ctx.beginPath();
        let hasTrails = false;
        for (let i = 0; i < n; i++) {
          if (bucketOf[i] === HIDDEN) continue;
          const tx = ptx[i];
          const ty = pty[i];
          if (tx === 0 && ty === 0) continue;
          ctx.moveTo(px[i], py[i]);
          ctx.lineTo(px[i] - tx, py[i] - ty);
          hasTrails = true;
        }
        if (hasTrails) ctx.stroke();
      }

      // 4. 粒子本体（モノクロ 16 段階のバッチ描画）＋ 高励起・基準点の極細クロスヘア
      ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
      for (let b = 0; b < LEVELS; b++) {
        const startAt = bucketCount[b];
        const endAt = bucketCount[b + 1];
        if (startAt === endAt) continue;
        ctx.fillStyle = styles[b];
        ctx.beginPath();
        for (let k = startAt; k < endAt; k++) {
          const i = drawOrder[k];
          const r = pr[i];
          const x = px[i];
          const y = py[i];
          if (pCross[i] === 1) {
            const arm = Math.max(1.8, r * 1.9);
            const thick = Math.max(0.75, r * 0.55);
            ctx.rect(x - arm, y - thick * 0.5, arm * 2, thick);
            ctx.rect(x - thick * 0.5, y - arm, thick, arm * 2);
          } else {
            ctx.moveTo(x + r, y);
            ctx.arc(x, y, r, 0, TAU);
          }
        }
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      // 5. ミニマル計測器 HUD
      const box = {
        minX: lerp(from.minX, to.minX),
        maxX: lerp(from.maxX, to.maxX),
        minY: lerp(from.minY, to.minY),
        maxY: lerp(from.maxY, to.maxY),
      };
      if (!animate) bracketOpen = 0;
      drawHud(cam, box, fontSize, breathe, flash, scan, hold, animate);

      if (animate && morphing && progress >= 1) {
        morphing = false;
        fromIndex = index;
        phaseStart = clock;
        introDone = true;
        for (const q of particles) {
          q.sz = 0;
          q.state = 2;
        }
      }
    };

    let last = 0;
    const loop = (now: number) => {
      const dt = last ? Math.min(48, now - last) : 16;
      last = now;
      render(dt, true);
      frame = window.requestAnimationFrame(loop);
    };

    const start = () => {
      if (frame !== 0 || !ready || reduceQuery.matches || !visible || document.hidden) return;
      last = 0;
      for (const p of particles) p.hasLast = false;
      frame = window.requestAnimationFrame(loop);
    };

    const stop = () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      frame = 0;
    };

    const drawStill = () => {
      for (const p of particles) {
        p.ox = p.oy = p.vx = p.vy = 0;
        p.energy = 0;
        p.sz = 0;
        p.state = 2;
        p.hasLast = false;
      }
      shocks.length = 0;
      morphing = false;
      fromIndex = index;
      render(0, false);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      const margin = Math.min(rect.width, rect.height) * 0.15;
      pointer.inside =
        pointer.x > -margin &&
        pointer.y > -margin &&
        pointer.x < rect.width + margin &&
        pointer.y < rect.height + margin;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (frame === 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
      if (shocks.length >= MAX_SHOCKS) shocks.shift();
      shocks.push({ x, y, t: clock });
    };
    const onPointerLeave = () => {
      pointer.inside = false;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    const onMotionPreference = () => {
      stop();
      if (reduceQuery.matches) drawStill();
      else start();
    };

    const rebuild = () => {
      build();
      if (reduceQuery.matches) drawStill();
    };

    let resizeTimer = 0;
    let lastSize = "";
    const resizeObserver = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect();
      const size = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
      if (!ready || size === lastSize) return;
      lastSize = size;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(rebuild, 120);
    });
    resizeObserver.observe(wrap);

    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        if (visible) start();
        else stop();
      },
      { threshold: 0 },
    );
    visibilityObserver.observe(canvas);

    const themeObserver = new MutationObserver(() => {
      readTheme();
      if (reduceQuery.matches) {
        drawStill();
      } else if (frame !== 0) {
        render(0, false);
      }
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    let disposed = false;
    const font = getComputedStyle(document.body).getPropertyValue("--font-mono").trim() || "ui-monospace";
    const fonts = document.fonts;
    const fontsReady = fonts
      ? Promise.all([fonts.load(`500 64px ${font}`).catch(() => undefined), fonts.ready])
      : Promise.resolve();
    void fontsReady.then(() => {
      if (disposed) return;
      ready = true;
      const rect = wrap.getBoundingClientRect();
      lastSize = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
      build();
      if (reduceQuery.matches) {
        drawStill();
      } else {
        if (!introDone) launchIntro();
        start();
      }
    });

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeave, { passive: true });
    window.addEventListener("blur", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibility);
    reduceQuery.addEventListener("change", onMotionPreference);

    return () => {
      disposed = true;
      stop();
      window.clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      themeObserver.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("blur", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      reduceQuery.removeEventListener("change", onMotionPreference);
    };
  }, [words]);

  if (words.length === 0) return null;

  return (
    <div ref={wrapRef} className={`particle-stage relative aspect-[16/9] w-full ${className}`.trim()}>
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />
      <span className="sr-only">{label ?? words.join(" / ")}</span>
    </div>
  );
}
