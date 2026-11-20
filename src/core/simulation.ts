// 发育时间轴推演与健康分析 ==================================================

import {
  CellState,
  CellStateValue,
  CombSideData,
  ageToState,
  BROOD_AGE_MAX,
  FrameProfile,
} from './types';

/** 某巢房推演到 offsetDay 天后的状态与日龄 */
export function projectCell(
  state: CellStateValue,
  age: number,
  offsetDay: number,
): { state: CellStateValue; age: number } {
  if (
    state === CellState.Egg ||
    state === CellState.LarvaS ||
    state === CellState.LarvaL ||
    state === CellState.CappedBrood
  ) {
    const a = age + offsetDay;
    if (a >= BROOD_AGE_MAX) return { state: CellState.Empty, age: 0xffff };
    return { state: ageToState(a), age: a };
  }
  return { state, age };
}

export interface DayProjection {
  day: number;
  date: string;
  eggs: number;
  larva: number;
  capped: number;
  emerging: number;   // 当日出房数
  brood: number;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 单面巢脾未来 horizon 天逐日推演 */
export function projectSide(side: CombSideData, fromDate: string, horizon: number): DayProjection[] {
  const out: DayProjection[] = [];
  for (let day = 0; day <= horizon; day++) {
    const p: DayProjection = {
      day, date: addDays(fromDate, day),
      eggs: 0, larva: 0, capped: 0, emerging: 0, brood: 0,
    };
    for (let i = 0; i < side.count; i++) {
      const s = side.states[i];
      if (
        s !== CellState.Egg &&
        s !== CellState.LarvaS &&
        s !== CellState.LarvaL &&
        s !== CellState.CappedBrood
      ) continue;
      const before = side.ages[i] + (day - 1);
      const a = side.ages[i] + day;
      if (a >= BROOD_AGE_MAX) {
        if (day === 0 || before < BROOD_AGE_MAX) p.emerging++;
        continue;
      }
      const st = ageToState(a);
      p.brood++;
      if (st === CellState.Egg) p.eggs++;
      else if (st === CellState.CappedBrood) p.capped++;
      else p.larva++;
    }
    out.push(p);
  }
  return out;
}

/** 建议加脾时机：子脾数量与封盖高峰 */
export function combAdvice(projections: DayProjection[][]): string[] {
  const advice: string[] = [];
  if (!projections.length) return advice;
  const horizon = projections[0].length;
  for (let d = 3; d < horizon; d++) {
    let capped = 0;
    let emerging = 0;
    for (const p of projections) {
      capped += p[d].capped;
      emerging += p[d].emerging;
    }
    if (capped >= 7000) {
      advice.push(`${projections[0][d].date} 前后封盖子成片（约 ${capped} 房），新蜂即将大量出房，建议提前加巢础扩巢。`);
      break;
    }
    if (emerging >= 1500) {
      advice.push(`${projections[0][d].date} 预计单日出房 ${emerging} 只以上，群势快速上升，注意加脾、防闷热。`);
      break;
    }
  }
  return advice;
}

// —— 封盖子成片性 / 插花子分析 ——

const HEX_DIRS = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

/**
 * 计算子区内部插花比例。
 * 先用子脾房扩张出"子区掩膜"（含其邻居，覆盖产卵圈应到的范围），
 * 再只在掩膜内部统计：落在掩膜内、但实际为空/储蜜/储粉的房即为插花洞。
 * 外圈蜜环、框缘缺邻居均不进掩膜，不会被误判。
 */
export function computePatchiness(side: CombSideData, q: Int16Array, r: Int16Array): number {
  const index = new Map<string, number>();
  for (let i = 0; i < side.count; i++) index.set(`${q[i]},${r[i]}`, i);

  const isBroodState = (s: number) =>
    s === CellState.Egg ||
    s === CellState.LarvaS ||
    s === CellState.LarvaL ||
    s === CellState.CappedBrood ||
    s === CellState.Chalkbrood ||
    s === CellState.Sacbrood;

  // 子区掩膜：所有子脾房 + 它们的直接邻居
  const mask = new Uint8Array(side.count);
  for (let i = 0; i < side.count; i++) {
    if (!isBroodState(side.states[i])) continue;
    mask[i] = 1;
    for (const [dq, dr] of HEX_DIRS) {
      const j = index.get(`${q[i] + dq},${r[i] + dr}`);
      if (j !== undefined) mask[j] = 1;
    }
  }

  let maskTotal = 0;
  let holes = 0;
  for (let i = 0; i < side.count; i++) {
    if (!mask[i]) continue;
    maskTotal++;
    const ns = side.states[i];
    if (
      ns === CellState.Empty ||
      ns === CellState.Honey ||
      ns === CellState.Pollen ||
      ns === CellState.CappedHoney
    ) {
      holes++;
    }
  }
  if (!maskTotal) return 0;
  return holes / maskTotal;
}

/** 封盖子连通片统计（BFS），返回片数与最大片房数 */
export function cappedBroodPatches(
  side: CombSideData,
  q: Int16Array,
  r: Int16Array,
): { patches: number; largest: number; total: number } {
  const index = new Map<string, number>();
  for (let i = 0; i < side.count; i++) index.set(`${q[i]},${r[i]}`, i);
  const seen = new Uint8Array(side.count);
  let patches = 0;
  let largest = 0;
  let total = 0;
  for (let i = 0; i < side.count; i++) {
    if (seen[i] || side.states[i] !== CellState.CappedBrood) continue;
    patches++;
    let size = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      size++;
      total++;
      for (const [dq, dr] of HEX_DIRS) {
        const j = index.get(`${q[k] + dq},${r[k] + dr}`);
        if (j === undefined || seen[j]) continue;
        if (side.states[j] === CellState.CappedBrood) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    largest = Math.max(largest, size);
  }
  return { patches, largest, total };
}

export interface HealthVerdict {
  level: 'ok' | 'warn' | 'bad';
  messages: string[];
  patchiness: number;
  chalkbrood: number;
  sacbrood: number;
  multiEgg: number;
}

/** 综合健康评判（可传入单面或多面汇总） */
export function evaluateHealth(
  sides: { side: CombSideData; q: Int16Array; r: Int16Array }[],
  status: string,
): HealthVerdict {
  const messages: string[] = [];
  let patchSum = 0;
  let chalk = 0;
  let sac = 0;
  let multi = 0;
  for (const { side, q, r } of sides) {
    patchSum += computePatchiness(side, q, r);
    for (let i = 0; i < side.count; i++) {
      if (side.states[i] === CellState.Chalkbrood) chalk++;
      if (side.states[i] === CellState.Sacbrood) sac++;
      if (side.eggs[i] > 1) multi++;
    }
  }
  const patchiness = sides.length ? patchSum / sides.length : 0;

  if (multi > 0 || status === 'laying-worker') {
    messages.push(`发现 ${multi} 个一房多卵的巢房，工蜂产卵特征明显——该群大概率已失王，需立即介入成熟王台或并群。`);
  }
  if (patchiness > 0.28) {
    messages.push(`子区插花比例 ${(patchiness * 100).toFixed(1)}%（阈值 28%），产卵不成片，蜂王可能老化或带病。`);
  } else if (patchiness > 0.18) {
    messages.push(`子区插花比例 ${(patchiness * 100).toFixed(1)}%，略偏高，下次复查重点看王。`);
  }
  if (chalk > 0) messages.push(`白垩病房 ${chalk} 个：白垩僵虫，注意通风排湿、换箱消毒，补饲强群。`);
  if (sac > 0) messages.push(`囊状幼虫病房 ${sac} 个：封盖穿孔、虫体囊状，属病毒病，立即隔离换王断子。`);

  let level: HealthVerdict['level'] = 'ok';
  if (messages.length) level = chalk + sac > 0 || multi > 0 ? 'bad' : 'warn';
  if (!messages.length) messages.push('封盖子成片、卵虫整齐，未发现异常。');
  return { level, messages, patchiness, chalkbrood: chalk, sacbrood: sac, multiEgg: multi };
}

/** 汇总一张脾两面的档案统计 */
export function summarizeProfile(sides: CombSideData[]): FrameProfile {
  const p: FrameProfile = {
    workerCells: 0, droneCells: 0, cupCells: 0,
    broodCells: 0, cappedCells: 0, honeyCells: 0,
    pollenCells: 0, emptyCells: 0, diseaseCells: 0,
    multiEggCells: 0, patchiness: 0,
  };
  for (const s of sides) {
    for (let i = 0; i < s.count; i++) {
      const t = s.types[i];
      if (t === 1) p.droneCells++;
      else if (t === 2) p.cupCells++;
      else p.workerCells++;
      switch (s.states[i]) {
        case CellState.Empty: p.emptyCells++; break;
        case CellState.CappedBrood: p.cappedCells++; p.broodCells++; break;
        case CellState.Egg:
        case CellState.LarvaS:
        case CellState.LarvaL: p.broodCells++; break;
        case CellState.Honey: p.honeyCells++; break;
        case CellState.Pollen: p.pollenCells++; break;
        case CellState.CappedHoney: p.honeyCells++; break;
        case CellState.Chalkbrood:
        case CellState.Sacbrood: p.diseaseCells++; p.broodCells++; break;
      }
      if (s.eggs[i] > 1) p.multiEggCells++;
    }
  }
  return p;
}
