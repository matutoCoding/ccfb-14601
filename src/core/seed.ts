// 测试蜂场数据生成（3 场地 26 箱，含失王工蜂产卵 / 病害 / 王台场景） ========

import {
  Hive,
  HiveHistory,
  Inspection,
  MonthlySnapshot,
  Yard,
  FrameMeta,
} from './types';
import { Rng, hashString } from './rng';
import { FrameSpec, HiveScenario, estimateProfile, getLayout } from './combgen';
import {
  idbBulkPut,
  idbClear,
  idbGetKV,
  idbSetKV,
  STORES,
} from './db';
import { buildFrameLayout } from './geometry';

export const SEED_FLAG_KEY = 'seeded-v4';

const TODAY = '2026-11-21';

interface HiveSeed {
  code: string;
  yard: number;
  scenario: HiveScenario;
  breed: string;
  queenGen: number;
  queenBirth: string;
  supers: number;
  frames: number;
  strength: number; // 0..1
  daysSinceInspection: number;
}

const YARDS: Omit<Yard, 'id'>[] = [
  {
    name: '本场·油菜场',
    crop: '油菜',
    bloomStart: '2026-03-05',
    bloomEnd: '2026-04-15',
    distanceKm: 0,
    mapX: 0.5,
    mapY: 0.55,
  },
  {
    name: '北山·洋槐场',
    crop: '洋槐',
    bloomStart: '2027-04-25',
    bloomEnd: '2027-05-20',
    distanceKm: 38,
    mapX: 0.22,
    mapY: 0.2,
  },
  {
    name: '西沟·荆条场',
    crop: '荆条',
    bloomStart: '2027-06-10',
    bloomEnd: '2027-07-25',
    distanceKm: 64,
    mapX: 0.82,
    mapY: 0.3,
  },
];

const BREEDS = ['原意', '松丹1号', '卡尼鄂拉', '东北黑', '美意'];

const HIVES: HiveSeed[] = [
  // 本场 12 箱（含两个特殊案例）
  { code: 'A01', yard: 0, scenario: 'normal', breed: '松丹1号', queenGen: 3, queenBirth: '2026-08-10', supers: 1, frames: 10, strength: 0.92, daysSinceInspection: 2 },
  { code: 'A02', yard: 0, scenario: 'normal', breed: '原意', queenGen: 2, queenBirth: '2026-07-22', supers: 1, frames: 10, strength: 0.85, daysSinceInspection: 5 },
  { code: 'A03', yard: 0, scenario: 'chalkbrood', breed: '卡尼鄂拉', queenGen: 4, queenBirth: '2026-05-18', supers: 0, frames: 9, strength: 0.6, daysSinceInspection: 3 },
  { code: 'A04', yard: 0, scenario: 'normal', breed: '美意', queenGen: 1, queenBirth: '2026-09-01', supers: 1, frames: 10, strength: 0.78, daysSinceInspection: 7 },
  { code: 'A05', yard: 0, scenario: 'laying-worker', breed: '原意', queenGen: 5, queenBirth: '2025-09-30', supers: 0, frames: 8, strength: 0.34, daysSinceInspection: 9 },
  { code: 'A06', yard: 0, scenario: 'normal', breed: '东北黑', queenGen: 2, queenBirth: '2026-06-15', supers: 1, frames: 10, strength: 0.88, daysSinceInspection: 1 },
  { code: 'A07', yard: 0, scenario: 'queenless', breed: '松丹1号', queenGen: 6, queenBirth: '2025-06-10', supers: 0, frames: 8, strength: 0.4, daysSinceInspection: 12 },
  { code: 'A08', yard: 0, scenario: 'normal', breed: '原意', queenGen: 3, queenBirth: '2026-08-25', supers: 1, frames: 9, strength: 0.74, daysSinceInspection: 4 },
  { code: 'A09', yard: 0, scenario: 'sacbrood', breed: '卡尼鄂拉', queenGen: 4, queenBirth: '2026-04-28', supers: 0, frames: 9, strength: 0.55, daysSinceInspection: 6 },
  { code: 'A10', yard: 0, scenario: 'normal', breed: '美意', queenGen: 2, queenBirth: '2026-07-30', supers: 1, frames: 10, strength: 0.81, daysSinceInspection: 2 },
  { code: 'A11', yard: 0, scenario: 'normal', breed: '原意', queenGen: 1, queenBirth: '2026-09-12', supers: 0, frames: 8, strength: 0.66, daysSinceInspection: 8 },
  { code: 'A12', yard: 0, scenario: 'normal', breed: '松丹1号', queenGen: 3, queenBirth: '2026-08-02', supers: 1, frames: 10, strength: 0.9, daysSinceInspection: 3 },
  // 北山 8 箱
  { code: 'B01', yard: 1, scenario: 'normal', breed: '东北黑', queenGen: 2, queenBirth: '2026-07-05', supers: 1, frames: 10, strength: 0.83, daysSinceInspection: 10 },
  { code: 'B02', yard: 1, scenario: 'normal', breed: '原意', queenGen: 3, queenBirth: '2026-08-18', supers: 1, frames: 10, strength: 0.79, daysSinceInspection: 11 },
  { code: 'B03', yard: 1, scenario: 'normal', breed: '卡尼鄂拉', queenGen: 1, queenBirth: '2026-09-20', supers: 0, frames: 9, strength: 0.7, daysSinceInspection: 9 },
  { code: 'B04', yard: 1, scenario: 'normal', breed: '美意', queenGen: 2, queenBirth: '2026-07-12', supers: 1, frames: 10, strength: 0.86, daysSinceInspection: 13 },
  { code: 'B05', yard: 1, scenario: 'normal', breed: '松丹1号', queenGen: 4, queenBirth: '2026-06-01', supers: 0, frames: 9, strength: 0.62, daysSinceInspection: 14 },
  { code: 'B06', yard: 1, scenario: 'normal', breed: '原意', queenGen: 2, queenBirth: '2026-08-08', supers: 1, frames: 10, strength: 0.77, daysSinceInspection: 10 },
  { code: 'B07', yard: 1, scenario: 'normal', breed: '东北黑', queenGen: 3, queenBirth: '2026-07-25', supers: 1, frames: 9, strength: 0.72, daysSinceInspection: 12 },
  { code: 'B08', yard: 1, scenario: 'normal', breed: '原意', queenGen: 1, queenBirth: '2026-09-28', supers: 0, frames: 8, strength: 0.58, daysSinceInspection: 15 },
  // 西沟 6 箱
  { code: 'C01', yard: 2, scenario: 'normal', breed: '美意', queenGen: 2, queenBirth: '2026-08-14', supers: 1, frames: 10, strength: 0.84, daysSinceInspection: 18 },
  { code: 'C02', yard: 2, scenario: 'normal', breed: '松丹1号', queenGen: 3, queenBirth: '2026-07-19', supers: 1, frames: 10, strength: 0.76, daysSinceInspection: 20 },
  { code: 'C03', yard: 2, scenario: 'normal', breed: '原意', queenGen: 2, queenBirth: '2026-08-30', supers: 0, frames: 9, strength: 0.68, daysSinceInspection: 17 },
  { code: 'C04', yard: 2, scenario: 'normal', breed: '卡尼鄂拉', queenGen: 4, queenBirth: '2026-05-22', supers: 0, frames: 9, strength: 0.61, daysSinceInspection: 22 },
  { code: 'C05', yard: 2, scenario: 'normal', breed: '东北黑', queenGen: 1, queenBirth: '2026-09-08', supers: 1, frames: 10, strength: 0.8, daysSinceInspection: 19 },
  { code: 'C06', yard: 2, scenario: 'normal', breed: '原意', queenGen: 3, queenBirth: '2026-07-02', supers: 1, frames: 9, strength: 0.73, daysSinceInspection: 21 },
];

function isoDaysAgo(days: number): string {
  const d = new Date(TAY());
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function TAY(): number {
  return Date.parse(TAY_STR());
}
function TAY_STR(): string {
  return TODAY + 'T00:00:00';
}

function frameSpecs(s: HiveSeed): FrameSpec[] {
  const f = s.strength;
  const specs: FrameSpec[] = [];
  const total = s.frames;
  const broodN = Math.max(2, Math.round(total * (0.35 + f * 0.35)));
  const honeyN = Math.max(1, Math.round(total * 0.22));
  const pollenN = total > 9 ? 1 : 0;
  let used = 0;
  for (let i = 0; i < total; i++) {
    // 两端蜜粉、中间子脾的真实排列
    const edgeDist = Math.min(i, total - 1 - i);
    if (edgeDist === 0) specs.push({ kind: 'honey', strength: f });
    else if (edgeDist === 1 && i < used + honeyN) specs.push({ kind: 'pollen', strength: f });
    else if (used < broodN) {
      specs.push({ kind: used === 0 ? 'capped' : 'brood', strength: f });
      used++;
    } else if (specs.filter((x) => x.kind === 'honey').length < honeyN + 1) {
      specs.push({ kind: 'honey', strength: f });
    } else {
      specs.push({ kind: 'empty', strength: f });
    }
  }
  return specs;
}

/** 季节群势曲线：春繁起、初夏顶峰、秋末回落、越冬最低 */
function seasonalFactor(ym: string): number {
  const month = Number(ym.slice(5, 7));
  const points: Record<number, number> = {
    1: 0.45, 2: 0.5, 3: 0.62, 4: 0.8, 5: 0.95, 6: 1.0,
    7: 0.98, 8: 0.9, 9: 0.82, 10: 0.7, 11: 0.58, 12: 0.48,
  };
  return points[month] ?? 0.6;
}

function buildHistory(hiveId: string, base: number, rng: Rng): HiveHistory {
  const months: MonthlySnapshot[] = [];
  const end = new Date(TAY());
  end.setMonth(end.getMonth() - 1); // 到上个月
  for (let k = 12; k >= 0; k--) {
    const d = new Date(end.getFullYear(), end.getMonth() - k, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const sf = seasonalFactor(ym);
    const jitter = 0.9 + rng.float() * 0.2;
    const strength = Math.min(1, base * sf * jitter);
    const broodFrames = Math.max(0, Math.round(base * sf * 8 * jitter));
    const honeyFrames = Math.max(0, Math.round(strength * 3 * (0.7 + rng.float() * 0.6)));
    const pollenFrames = rng.chance(0.7) ? 1 : 0;
    const estHoneyJin = Math.round(honeyFrames * (4.5 + rng.float() * 1.5) * 1.6);
    months.push({ ym, broodFrames, honeyFrames, pollenFrames, estHoneyJin, strength: Math.round(strength * 100) });
  }
  return { hiveId, months };
}

export async function seedIfEmpty(force = false): Promise<void> {
  const flag = await idbGetKV<boolean>(SEED_FLAG_KEY);
  if (flag && !force) return;

  // 布局几何变更后，旧巢房 TypedArray 尺寸失效，清掉按新网格惰性重建
  await idbClear(STORES.combs);

  const yards: Yard[] = YARDS.map((y, i) => ({ ...y, id: `Y${i + 1}` }));
  const hives: Hive[] = [];
  const frames: FrameMeta[] = [];
  const histories: HiveHistory[] = [];
  const inspections: Inspection[] = [];

  for (const hs of HIVES) {
    const yard = yards[hs.yard];
    const idxInYard = HIVES.filter((h) => h.yard === hs.yard).indexOf(hs);
    const cols = 4;
    const hiveId = `H-${hs.code}`;
    const specs = frameSpecs(hs);
    const frameMetas: FrameMeta[] = [];

    specs.forEach((spec, fi) => {
      const frameId = `${hiveId}-F${fi + 1}`;
      const seed = hashString(frameId);
      const layout = buildFrameLayout(seed);
      const profile = estimateProfile(spec, layout.count);
      const meta: FrameMeta = { id: frameId, hiveId, index: fi + 1, seed, profile };
      frameMetas.push(meta);
      frames.push(meta);
    });

    const status =
      hs.scenario === 'laying-worker'
        ? ('laying-worker' as const)
        : hs.scenario === 'queenless'
          ? ('queenless' as const)
          : ('normal' as const);

    const hive: Hive = {
      id: hiveId,
      yardId: yard.id,
      code: hs.code,
      posX: 0.08 + (idxInYard % cols) * 0.28 + (Math.floor(idxInYard / cols) % 2) * 0.05,
      posY: 0.12 + Math.floor(idxInYard / cols) * 0.3,
      queenGen: hs.queenGen,
      queenBirth: hs.queenBirth,
      breed: hs.breed,
      supers: hs.supers,
      status,
      frameCount: hs.frames,
      frames: frameMetas,
      lastInspection: isoDaysAgo(hs.daysSinceInspection),
      notes:
        hs.scenario === 'laying-worker'
          ? '巡查发现一房多卵、卵圈散乱，疑似失王后工蜂产卵，待处理。'
          : hs.scenario === 'queenless'
            ? '未见蜂王，巢内无卵，急造王台待观察。'
            : hs.scenario === 'chalkbrood'
              ? '部分幼虫白垩化，已加强通风。'
              : hs.scenario === 'sacbrood'
                ? '少量封盖穿孔，疑囊状幼虫病，隔离观察。'
                : '',
    };
    hives.push(hive);
    histories.push(buildHistory(hiveId, hs.strength, new Rng(hashString(hiveId))));

    // 近几次检查记录
    const inspDates = [hs.daysSinceInspection, hs.daysSinceInspection + 14, hs.daysSinceInspection + 28];
    inspDates.forEach((dAgo, k) => {
      if (dAgo > 60) return;
      inspections.push({
        id: `${hiveId}-I${k + 1}`,
        hiveId,
        date: isoDaysAgo(dAgo),
        queenSeen: status === 'normal' && k === 0,
        note:
          hs.scenario === 'laying-worker' && k === 0
            ? '一房多卵确认，工蜂产卵。'
            : k === 0
              ? '常规巡查，卵虫蛹正常。'
              : '例行检查。',
        stats: {
          broodFrames: frameMetas.filter((f) => f.profile.broodCells > 1000).length,
          honeyFrames: frameMetas.filter((f) => f.profile.honeyCells > 1500).length,
        },
      });
    });
  }

  await idbBulkPut(STORES.yards, yards);
  await idbBulkPut(STORES.hives, hives);
  await idbBulkPut(STORES.frames, frames);
  await idbBulkPut(STORES.history, histories);
  await idbBulkPut(STORES.inspections, inspections);
  await idbSetKV(SEED_FLAG_KEY, true);
}

export function frameSpecFor(hiveStrength: number, kind: FrameSpec['kind']): FrameSpec {
  return { kind, strength: hiveStrength };
}

export function scenarioOf(hive: Hive): HiveScenario {
  if (hive.status === 'laying-worker') return 'laying-worker';
  if (hive.status === 'queenless') return 'queenless';
  if (hive.notes.includes('白垩')) return 'chalkbrood';
  if (hive.notes.includes('囊状')) return 'sacbrood';
  return 'normal';
}

export { TODAY };
