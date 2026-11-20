// 仓储层：巢脾按需生成/落库、群势与摇蜜估算 ================================

import {
  CombSideData,
  FrameMeta,
  Hive,
  HiveHistory,
  Inspection,
  Yard,
} from './types';
import { idbGet, idbGetAll, idbGetAllByIndex, idbPut, STORES } from './db';
import { estimateProfile, FrameSpec, generateComb, HiveScenario } from './combgen';
import { scenarioOf } from './seed';
import { getLayout } from './combgen';
import { buildFrameLayout } from './geometry';
import { summarizeProfile } from './simulation';

export const repo = {
  yards: () => idbGetAll<Yard>(STORES.yards),
  hives: () => idbGetAll<Hive>(STORES.hives),
  hive: (id: string) => idbGet<Hive>(STORES.hives, id),
  frames: async (hiveId: string) => {
    const all = await idbGetAllByIndex<FrameMeta>(STORES.frames, 'hiveId', hiveId);
    return all.sort((a, b) => a.index - b.index);
  },
  history: (hiveId: string) => idbGet<HiveHistory>(STORES.history, hiveId),
  inspections: (hiveId: string) =>
    idbGetAllByIndex<Inspection>(STORES.inspections, 'hiveId', hiveId),

  async putHive(h: Hive): Promise<void> {
    await idbPut(STORES.hives, h);
  },
  async putFrame(f: FrameMeta): Promise<void> {
    await idbPut(STORES.frames, f);
  },
  async putInspection(i: Inspection): Promise<void> {
    await idbPut(STORES.inspections, i);
  },

  /** 取一张脾两面：已落库直接读，否则按蜂群场景即时生成并落库 */
  async getComb(hive: Hive, frame: FrameMeta): Promise<{
    sides: CombSideData[];
    layout: ReturnType<typeof buildFrameLayout>;
  }> {
    const keyA = `${frame.id}:A`;
    const keyB = `${frame.id}:B`;
    const [a, b] = await Promise.all([
      idbGet<CombSideData>(STORES.combs, keyA),
      idbGet<CombSideData>(STORES.combs, keyB),
    ]);
    if (a && b) return { sides: [a, b], layout: getLayout(frame.seed) };

    const spec = specOfFrame(hive, frame);
    const scenario = scenarioOf(hive);
    const { sides, layout, profile } = generateComb(frame.id, frame.seed, spec, scenario);
    await Promise.all([
      idbPut(STORES.combs, sides[0]),
      idbPut(STORES.combs, sides[1]),
    ]);
    const updated: FrameMeta = { ...frame, profile };
    await idbPut(STORES.frames, updated);
    return { sides, layout };
  },

  async saveSide(side: CombSideData, frame: FrameMeta, other: CombSideData): Promise<FrameMeta> {
    await idbPut(STORES.combs, side);
    const profile = summarizeProfile([side, other]);
    const updated: FrameMeta = { ...frame, profile };
    await idbPut(STORES.frames, updated);
    return updated;
  },
};

/** 由档案反推脾类型规格（用于首次生成） */
function specOfFrame(hive: Hive, frame: FrameMeta): FrameSpec {
  const p = frame.profile;
  const total = Math.max(1, p.workerCells + p.droneCells + p.cupCells);
  const broodR = p.broodCells / total;
  const honeyR = p.honeyCells / total;
  const pollenR = p.pollenCells / total;
  let kind: FrameSpec['kind'] = 'empty';
  // 子脾优先判定，避免高占比花粉误判；粉脾要求花粉为最大储粮项
  if (broodR > 0.3) kind = p.cappedCells > p.broodCells * 0.55 ? 'capped' : 'brood';
  else if (pollenR > 0.25 && pollenR >= honeyR) kind = 'pollen';
  else if (honeyR > 0.4) kind = 'honey';
  return { kind, strength: strengthOf(hive) / 100 };
}

/** 群势分 0..100：子脾量 + 封盖量 + 总脾数 + 健康修正 */
export function strengthOf(hive: Hive): number {
  let broodFrames = 0;
  let cappedFrames = 0;
  for (const f of hive.frames) {
    if (f.profile.broodCells > 1200) broodFrames++;
    if (f.profile.cappedCells > 1500) cappedFrames++;
  }
  const base = Math.min(100, (broodFrames / Math.max(6, hive.frameCount)) * 78 + hive.frameCount * 2.2);
  let score = base;
  if (hive.status === 'laying-worker') score *= 0.45;
  if (hive.status === 'queenless') score *= 0.6;
  const disease = hive.frames.reduce((s, f) => s + f.profile.diseaseCells, 0);
  if (disease > 0) score *= Math.max(0.7, 1 - disease / 4000);
  return Math.round(Math.max(8, Math.min(100, score)));
}

/** 摇蜜估算（斤）：每蜜房约 0.34g，继箱加 15%，留饲料后取七成 */
export function estimateHoneyJin(hive: Hive): number {
  let honeyCells = 0;
  for (const f of hive.frames) honeyCells += f.profile.honeyCells;
  const grams = honeyCells * 0.34;
  const superFactor = 1 + hive.supers * 0.15;
  return Math.round((grams / 500) * superFactor * 0.7 * 10) / 10;
}

export function daysSince(iso: string, now = new Date()): number {
  const d = Date.parse(iso + 'T00:00:00');
  return Math.floor((now.getTime() - d) / 86400000);
}

export type { HiveScenario };
