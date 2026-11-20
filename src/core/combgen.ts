// 巢脾生成：按蜂群场景确定性生成两面、每面约 3400 个可点巢房 ===============

import { buildFrameLayout, FrameLayout } from './geometry';
import { Rng, hashString } from './rng';
import {
  CellState,
  CellType,
  CombSideData,
  FrameProfile,
  QueenCupInfo,
} from './types';
import { summarizeProfile } from './simulation';

export type HiveScenario =
  | 'normal'
  | 'laying-worker'
  | 'queenless'
  | 'chalkbrood'
  | 'sacbrood';

export interface FrameSpec {
  kind: 'brood' | 'capped' | 'honey' | 'pollen' | 'empty';
  strength: number; // 0..1
}

function fillSide(
  frameId: string,
  side: 0 | 1,
  layout: FrameLayout,
  spec: FrameSpec,
  scenario: HiveScenario,
  rng: Rng,
): CombSideData {
  const n = layout.count;
  const states = new Uint8Array(n).fill(CellState.Empty);
  const ages = new Uint16Array(n).fill(0xffff);
  const eggs = new Uint8Array(n);

  const cx = layout.cx;
  const cy = layout.cy;
  const maxR = Math.hypot(FRAME_HW(), FRAME_HH());

  // 中心子区半径比例
  const broodRadius = 0.42 + spec.strength * 0.3;
  const honeyBand = 0.16; // 外圈蜜粉带宽

  for (let i = 0; i < n; i++) {
    const t = layout.types[i];
    if (t === CellType.QueenCup) continue; // 王台单独处理
    const nx = cx[i] / maxR;
    const ny = cy[i] / maxR;
    const rad = Math.hypot(nx * 1.15, ny * 1.9); // 椭圆子区，贴合真实产卵圈
    const r = rng.float();

    if (spec.kind === 'empty') {
      if (r < 0.04) states[i] = CellState.Pollen;
      continue;
    }
    if (spec.kind === 'honey') {
      if (rad < 0.55 && r < 0.3) {
        states[i] = CellState.Honey;
      } else if (r < 0.82) {
        states[i] = r < 0.55 ? CellState.CappedHoney : CellState.Honey;
      } else if (r < 0.9) {
        states[i] = CellState.Pollen;
      }
      continue;
    }
    if (spec.kind === 'pollen') {
      if (r < 0.55) states[i] = CellState.Pollen;
      else if (r < 0.8) states[i] = CellState.Honey;
      continue;
    }

    // 子脾 / 封盖脾
    if (rad > broodRadius + honeyBand) {
      if (r < 0.75) states[i] = r < 0.5 ? CellState.CappedHoney : CellState.Honey;
      else if (r < 0.9) states[i] = CellState.Pollen;
      continue;
    }
    if (rad > broodRadius) {
      // 过渡带：花粉/蜜
      if (r < 0.5) states[i] = CellState.Pollen;
      else if (r < 0.8) states[i] = CellState.Honey;
      else states[i] = CellState.Empty;
      continue;
    }

    // 子区内部
    const emptyRate =
      scenario === 'laying-worker' ? 0.12 : scenario === 'queenless' ? 0.45 : 0.06;
    if (r < emptyRate) {
      states[i] = CellState.Empty;
      continue;
    }

    if (spec.kind === 'capped' || (spec.kind === 'brood' && rad < broodRadius * 0.55)) {
      states[i] = CellState.CappedBrood;
      ages[i] = 9 + rng.int(0, 11);
    } else {
      // 卵→小幼虫→大幼虫 环状分布
      const ring = rad / broodRadius; // 0 中心 → 1 外缘
      const jitter = (rng.float() - 0.5) * 0.35;
      const z = ring + jitter;
      if (z < 0.33) {
        states[i] = CellState.CappedBrood;
        ages[i] = 9 + rng.int(0, 8);
      } else if (z < 0.6) {
        states[i] = CellState.LarvaL;
        ages[i] = 6 + rng.int(0, 2);
      } else if (z < 0.82) {
        states[i] = CellState.LarvaS;
        ages[i] = 3 + rng.int(0, 2);
      } else {
        states[i] = CellState.Egg;
        ages[i] = rng.int(0, 2);
      }
    }
  }

  // —— 场景化改造 ——
  if (scenario === 'laying-worker') {
    // 失王后工蜂产卵：卵乱、一房多卵、雄蜂房增多、插花
    for (let i = 0; i < n; i++) {
      if (states[i] === CellState.Egg) {
        eggs[i] = rng.chance(0.7) ? rng.int(2, 4) : 1;
      }
      if (states[i] === CellState.Empty && rng.chance(0.22)) {
        states[i] = CellState.Egg;
        ages[i] = rng.int(0, 2);
        eggs[i] = rng.int(1, 3);
      }
      // 东一粒西一粒的乱卵替换掉部分封盖子
      if (states[i] === CellState.CappedBrood && rng.chance(0.3)) {
        states[i] = rng.chance(0.5) ? CellState.Egg : CellState.Empty;
        ages[i] = states[i] === CellState.Egg ? rng.int(0, 2) : 0xffff;
        if (states[i] === CellState.Egg) eggs[i] = rng.int(1, 3);
      }
    }
  } else if (scenario === 'queenless') {
    for (let i = 0; i < n; i++) {
      if (states[i] === CellState.Egg) states[i] = CellState.Empty, ages[i] = 0xffff;
    }
  } else if (scenario === 'chalkbrood') {
    for (let i = 0; i < n; i++) {
      if (
        (states[i] === CellState.LarvaL || states[i] === CellState.CappedBrood) &&
        rng.chance(0.09)
      ) {
        states[i] = CellState.Chalkbrood;
      }
    }
  } else if (scenario === 'sacbrood') {
    for (let i = 0; i < n; i++) {
      if (states[i] === CellState.CappedBrood && rng.chance(0.07)) {
        states[i] = CellState.Sacbrood;
      }
    }
  }

  // 王台
  const cups: QueenCupInfo[] = [];
  for (let i = 0; i < n; i++) {
    if (layout.types[i] !== CellType.QueenCup) continue;
    if (rng.chance(0.6)) {
      const roll = rng.float();
      const stage =
        roll < 0.3 ? 'cup' : roll < 0.55 ? 'egg' : roll < 0.8 ? 'larva' : 'capped';
      states[i] =
        stage === 'capped'
          ? CellState.CappedBrood
          : stage === 'larva'
            ? CellState.LarvaL
            : stage === 'egg'
              ? CellState.Egg
              : CellState.Empty;
      ages[i] = stage === 'capped' ? 12 : stage === 'larva' ? 7 : stage === 'egg' ? 1 : 0xffff;
      cups.push({ cellIndex: i, stage });
    }
  }

  return {
    key: `${frameId}:${side === 0 ? 'A' : 'B'}`,
    frameId,
    side,
    count: n,
    types: layout.types.slice(),
    states,
    ages,
    eggs,
    cx: layout.cx.slice(),
    cy: layout.cy.slice(),
    cups,
    generatedAt: new Date().toISOString(),
  };
}

function FRAME_HW() {
  return 428 / 2;
}
function FRAME_HH() {
  return 203 / 2;
}

const layoutCache = new Map<number, FrameLayout>();

export function getLayout(seed: number): FrameLayout {
  let l = layoutCache.get(seed);
  if (!l) {
    l = buildFrameLayout(seed);
    layoutCache.set(seed, l);
  }
  return l;
}

/** 生成一张脾两面数据 */
export function generateComb(frameId: string, seed: number, spec: FrameSpec, scenario: HiveScenario): {
  sides: CombSideData[];
  layout: FrameLayout;
  profile: FrameProfile;
} {
  const layout = getLayout(seed);
  const rngA = new Rng(hashString(frameId + ':A') ^ seed);
  const rngB = new Rng(hashString(frameId + ':B') ^ seed);
  const sideA = fillSide(frameId, 0, layout, spec, scenario, rngA);
  const sideB = fillSide(frameId, 1, layout, spec, scenario, rngB);
  const profile = summarizeProfile([sideA, sideB]);
  return { sides: [sideA, sideB], layout, profile };
}

/** 未打开过的脾，用规格估算档案（保证分析页有数，不必把全部巢房落库） */
export function estimateProfile(spec: FrameSpec, perSideCount: number): FrameProfile {
  const total = perSideCount * 2;
  const p: FrameProfile = {
    workerCells: Math.round(total * 0.92),
    droneCells: Math.round(total * 0.07),
    cupCells: total - Math.round(total * 0.92) - Math.round(total * 0.07),
    broodCells: 0, cappedCells: 0, honeyCells: 0, pollenCells: 0,
    emptyCells: 0, diseaseCells: 0, multiEggCells: 0, patchiness: 0.08,
  };
  const f = spec.strength;
  switch (spec.kind) {
    case 'brood':
      p.broodCells = Math.round(total * (0.55 + f * 0.25));
      p.cappedCells = Math.round(p.broodCells * 0.4);
      p.honeyCells = Math.round(total * 0.12);
      p.pollenCells = Math.round(total * 0.08);
      break;
    case 'capped':
      p.cappedCells = Math.round(total * (0.6 + f * 0.2));
      p.broodCells = p.cappedCells + Math.round(total * 0.12);
      p.honeyCells = Math.round(total * 0.12);
      break;
    case 'honey':
      p.honeyCells = Math.round(total * (0.68 + f * 0.18));
      p.pollenCells = Math.round(total * 0.06);
      break;
    case 'pollen':
      p.pollenCells = Math.round(total * 0.5);
      p.honeyCells = Math.round(total * 0.25);
      break;
    default:
      p.pollenCells = Math.round(total * 0.04);
  }
  // 守恒：各类房数不超过总数，空房 = 剩余部分（保证非负）
  const used = Math.min(total, p.broodCells + p.honeyCells + p.pollenCells);
  p.emptyCells = total - used;
  return p;
}
