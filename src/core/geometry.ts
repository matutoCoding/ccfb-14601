// 巢房几何与深度遮挡计算（单位：毫米）======================================
// 真实意蜂巢房尺寸：
//   工蜂房 对边距 5.38mm → 六边形外接圆半径 R=3.107
//   雄蜂房 对边距 6.40mm → R=3.70
//   巢房深度（单侧壁） h≈11mm
// 几何关系：视线与法线夹角 θ 时，过房底 p 点的光线在房口平面横向偏移
//   s = h·tanθ，落地点 r = p + s·t̂；r 落在房口六边形内即被房壁遮挡。
// ============================================================================

import { CellType } from './types';
import { Rng } from './rng';

export const MM = 1; // 场景单位即毫米

// —— 真实巢房尺寸 ——
export const WORKER_R = 3.107;          // 工蜂房外接圆半径
export const DRONE_R = 3.7;             // 雄蜂房
export const CELL_DEPTH = 11;           // 单侧巢房深度
export const MIDRIB_THICK = 0.6;        // 中隔厚度
export const WALL_THICKNESS = 0.18;     // 蜡壁厚度
export const EGG_HEIGHT = 1.6;          // 卵高（立在房底）

// —— 巢框内围（毫米），取大容量意蜂框尺寸 ——
export const FRAME_W = 456;
export const FRAME_H = 216;
export const FRAME_BORDER = 2;
export const CORNER_R = 6;

const SQRT3 = Math.sqrt(3);

export interface FrameLayout {
  count: number;
  types: Uint8Array;
  cx: Float32Array;
  cy: Float32Array;
  /** 轴向坐标 */
  q: Int16Array;
  r: Int16Array;
}

function insideRoundedFrame(x: number, y: number, margin: number): boolean {
  const hw = FRAME_W / 2 - margin;
  const hh = FRAME_H / 2 - margin;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax <= hw - CORNER_R || ay <= hh - CORNER_R) return ax <= hw && ay <= hh;
  const dx = ax - (hw - CORNER_R);
  const dy = ay - (hh - CORNER_R);
  return dx * dx + dy * dy <= CORNER_R * CORNER_R;
}

/** 生成一张脾的巢房布局（两面共用同一网格，真实工蜂房约 3400/面） */
export function buildFrameLayout(seed: number): FrameLayout {
  const rng = new Rng(seed);
  const R = WORKER_R;
  const spacingX = SQRT3 * R;
  const spacingY = 1.5 * R;
  const rMax = Math.floor((FRAME_H / 2 - FRAME_BORDER) / spacingY);

  const xs: number[] = [];
  const ys: number[] = [];
  const qs: number[] = [];
  const rs: number[] = [];

  for (let r = -rMax; r <= rMax; r++) {
    const y = spacingY * r;
    const qHalf = Math.floor((FRAME_W / 2 - FRAME_BORDER) / spacingX);
    for (let q = -qHalf; q <= qHalf; q++) {
      const x = spacingX * (q + r / 2);
      // 房心至少留一个内切圆半径，避免房壁穿出木框
      if (!insideRoundedFrame(x, y, R * 0.5)) continue;
      xs.push(x);
      ys.push(y);
      qs.push(q);
      rs.push(r);
    }
  }

  const count = xs.length;
  const types = new Uint8Array(count).fill(CellType.Worker);
  const cx = Float32Array.from(xs);
  const cy = Float32Array.from(ys);
  const qArr = Int16Array.from(qs);
  const rArr = Int16Array.from(rs);

  // 雄蜂房：脾下缘两角的雄蜂区（自然巢脾特征），实例整体放大 DRONE_R/WORKER_R
  for (let i = 0; i < count; i++) {
    const x = cx[i];
    const y = cy[i];
    const inDroneBand =
      y < -FRAME_H / 2 + 30 &&
      (Math.abs(x) > FRAME_W / 2 - 95 || rng.chance(0.25));
    if (inDroneBand) types[i] = CellType.Drone;
  }

  // 王台：长在脾边缘（缺邻居的边房），数量 6~10
  const keySet = new Set<string>();
  for (let i = 0; i < count; i++) keySet.add(`${qArr[i]},${rArr[i]}`);
  const edge: number[] = [];
  const dirs = [
    [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
  ];
  for (let i = 0; i < count; i++) {
    if (types[i] !== CellType.Worker) continue;
    let missing = 0;
    for (const [dq, dr] of dirs) {
      if (!keySet.has(`${qArr[i] + dq},${rArr[i] + dr}`)) missing++;
    }
    if (missing >= 2) edge.push(i);
  }
  const cupCount = Math.min(edge.length, 6 + rng.int(0, 4));
  for (let k = 0; k < cupCount; k++) {
    const idx = edge[Math.floor(rng.float() * edge.length)];
    types[idx] = CellType.QueenCup;
  }

  return { count, types, cx, cy, q: qArr, r: rArr };
}

// —— 六边形采样与点包含 ——

function hexCorners(R: number): { x: number; y: number }[] {
  // 尖顶六边形（边竖直）
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push({ x: R * Math.cos(a), y: R * Math.sin(a) });
  }
  return pts;
}

function pointInConvexPoly(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

/** 单位六边形内规则采样点（缓存） */
let sampleCache: { x: number; y: number }[] | null = null;
export function unitHexSamples(): { x: number; y: number }[] {
  if (sampleCache) return sampleCache;
  const pts: { x: number; y: number }[] = [];
  const step = 0.05;
  const poly = hexCorners(1);
  for (let y = -1; y <= 1; y += step) {
    for (let x = -1; x <= 1; x += step) {
      if (pointInConvexPoly(x, y, poly)) pts.push({ x, y });
    }
  }
  sampleCache = pts;
  return pts;
}

/**
 * 六边形深房的房底可见比例（精确几何法）。
 * @param R     房外接圆半径
 * @param depth 房深 h
 * @param tilt  视线与房底法线夹角（度），0=正对
 * @param az    倾斜方向相对六边形的方位角（度）
 */
export function hexVisibilityFraction(R: number, depth: number, tilt: number, az = 0): number {
  const theta = (tilt * Math.PI) / 180;
  if (theta < 1e-6) return 1;
  const tanT = Math.tan(theta);
  const azR = (az * Math.PI) / 180;
  const tx = Math.cos(azR);
  const ty = Math.sin(azR);
  const poly = hexCorners(R);
  const samples = unitHexSamples();
  let visible = 0;
  for (const s of samples) {
    const px = s.x * R;
    const py = s.y * R;
    // 过 p 的光线在房口平面的落地点：
    // 落在房口多边形内 → 从开口逃逸 → 可见；落出 → 先撞蜡壁 → 遮挡
    const rx = px + depth * tanT * tx;
    const ry = py + depth * tanT * ty;
    if (pointInConvexPoly(rx, ry, poly)) visible++;
  }
  return visible / samples.length;
}

/**
 * 圆形深房（等效对边径 d=2R）房底可见比例 —— 解析积分，用于与六边形采样交叉验证。
 * 沿倾斜方向 t̂ 建立一维坐标 x'（朝视线倾斜方向为正）：
 *   房口相对房底的偏移 b = h·tanθ
 *   房底点 x' 可见 ⇔ 光线落地点 x'+b 仍在圆内（半径 R）⇔ x' ≤ R-b
 *   可见域 x' ∈ [-R, R-b]，随 b 增大而缩小；b≥2R 时全遮挡。
 */
export function circleVisibilityFraction(R: number, depth: number, tilt: number): number {
  const theta = (tilt * Math.PI) / 180;
  if (theta < 1e-6) return 1;
  const b = depth * Math.tan(theta);
  if (b <= 0) return 1;
  if (b >= 2 * R) return 0; // 整个房底的光线落点都在房口之外
  const x0 = R - b; // 可见域上界
  // 圆域按 x' 积分：可见面积 = ∫[-R, x0] 2√(R²-x²) dx
  const antideriv = (x: number) => x * Math.sqrt(R * R - x * x) + R * R * Math.asin(x / R);
  const visibleArea = antideriv(x0) - antideriv(-R);
  return visibleArea / (Math.PI * R * R);
}

/**
 * 独立校验法：对每条光线做与六面蜡壁的显式线段求交（不经过投影足迹）。
 * 光线从房底 p（z=0）出发，方向 d=(sinθ·t̂, cosθ)；
 * 任一蜡壁（过原点的竖直平面，法向 n_i，距中心 a=R·cos30°）在光线到达
 * 房口平面（z=depth）之前被命中，且命中点落在该壁面线段内 → 遮挡。
 */
export function hexVisibilityFractionRay(R: number, depth: number, tilt: number, az = 0): number {
  const theta = (tilt * Math.PI) / 180;
  if (theta < 1e-6) return 1;
  const azR = (az * Math.PI) / 180;
  const dx = Math.sin(theta) * Math.cos(azR);
  const dy = Math.sin(theta) * Math.sin(azR);
  const dz = Math.cos(theta);
  const a = R * (SQRT3 / 2); // 边壁到中心距离（对边距之半）

  // 六面壁法向（尖顶六边形，壁面竖直）；edges[k] 与 normals[k] 一一对应
  const normals: { x: number; y: number }[] = [];
  for (let k = 0; k < 6; k++) {
    const ang = (Math.PI / 180) * (60 * k);
    normals.push({ x: Math.cos(ang), y: Math.sin(ang) });
  }
  const poly = hexCorners(R);
  const edges: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
  for (let k = 0; k < 6; k++) edges.push({ a: poly[k], b: poly[(k + 1) % 6] });
  const samples = unitHexSamples();
  let visible = 0;

  for (const s of samples) {
    const px = s.x * R;
    const py = s.y * R;
    let blocked = false;
    for (let k = 0; k < 6; k++) {
      const n = normals[k];
      // 壁面方程 n·q = a；光线 q(t)=p+t·d，求 t（t>0 才在光线前方）
      const denom = dx * n.x + dy * n.y;
      if (denom <= 1e-9) continue; // 光线背离该壁，永不会命中
      const t = (a - (px * n.x + py * n.y)) / denom;
      if (t <= 1e-9) continue; // 交点在房底平面或身后
      const zHit = t * dz;
      if (zHit >= depth) continue; // 到达交点前已从房口出去
      // 壁面是有限边段：命中点投影到边方向，参数 u∈[0,1] 才算打在蜡壁上
      const hx = px + t * dx;
      const hy = py + t * dy;
      const ea = edges[k].a;
      const eb = edges[k].b;
      const ex = eb.x - ea.x;
      const ey = eb.y - ea.y;
      const len2 = ex * ex + ey * ey;
      const u = ((hx - ea.x) * ex + (hy - ea.y) * ey) / len2;
      if (u >= -1e-6 && u <= 1 + 1e-6) {
        blocked = true;
        break;
      }
    }
    if (!blocked) visible++;
  }
  return visible / samples.length;
}

/**
 * 卵尖刚好被房壁挡住的临界倾角（最坏方位：朝房口边中点方向）。
 * 卵立在房底中心、高 e；房口边中点距中心 = R·cos30°（对边距之半）。
 * tanθ = (R·cos30°) / (h - e)
 */
export function eggOcclusionAngle(R: number, depth: number, eggHeight: number): number {
  const rimNear = R * (SQRT3 / 2);
  return (Math.atan(rimNear / (depth - eggHeight)) * 180) / Math.PI;
}

/** 一维检查点（用于 UI 展示推导）：房底中心点可见的临界角 atan(R/h) */
export function centerOcclusionAngle(R: number, depth: number): number {
  return (Math.atan(R / depth) * 180) / Math.PI;
}

/** 给定视线倾角，房口相对房底的横向位移（mm） */
export function rimShift(depth: number, tilt: number): number {
  return depth * Math.tan((tilt * Math.PI) / 180);
}

export function droneScale(): number {
  return DRONE_R / WORKER_R;
}
