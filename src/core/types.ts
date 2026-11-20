// 领域类型与常量 ============================================================

/** 巢房状态（单字节编码，写入 IndexedDB） */
export const CellState = {
  Empty: 0,        // 空房
  Egg: 1,          // 卵
  LarvaS: 2,       // 小幼虫（3-5 日）
  LarvaL: 3,       // 大幼虫（6-8 日）
  CappedBrood: 4,  // 封盖子（9-20 日）
  Honey: 5,        // 蜜
  Pollen: 6,       // 花粉
  CappedHoney: 7,  // 封盖蜜
  Chalkbrood: 8,   // 白垩病（白垩僵虫）
  Sacbrood: 9,     // 囊状幼虫病
} as const;
export type CellStateValue = (typeof CellState)[keyof typeof CellState];

export interface StateMeta {
  name: string;
  color: number;
  brood: boolean;
}

export const STATE_META: Record<number, StateMeta> = {
  [CellState.Empty]:       { name: '空房',     color: 0x4a3520, brood: false },
  [CellState.Egg]:         { name: '卵',       color: 0xfff6d8, brood: true },
  [CellState.LarvaS]:      { name: '小幼虫',   color: 0xf3e6c8, brood: true },
  [CellState.LarvaL]:      { name: '大幼虫',   color: 0xf0ddb0, brood: true },
  [CellState.CappedBrood]: { name: '封盖子',   color: 0xb98a4e, brood: true },
  [CellState.Honey]:       { name: '蜜',       color: 0xd98e22, brood: false },
  [CellState.Pollen]:      { name: '花粉',     color: 0xe6b93f, brood: false },
  [CellState.CappedHoney]: { name: '封盖蜜',   color: 0xe9e3d5, brood: false },
  [CellState.Chalkbrood]:  { name: '白垩病',   color: 0xeef0ee, brood: true },
  [CellState.Sacbrood]:    { name: '囊状病',   color: 0x7a5a3c, brood: true },
};

/** 花粉颜色盘（按粉源植物区分） */
export const POLLEN_COLORS = [0xe6c02d, 0xe08a2b, 0xb54a3a, 0x7a5aa0, 0xefe3b0, 0x6f8f3a];

/** 巢房类型 */
export const CellType = { Worker: 0, Drone: 1, QueenCup: 2 } as const;

export interface QueenCupInfo {
  cellIndex: number;
  stage: 'cup' | 'egg' | 'larva' | 'capped';
}

/** 单面巢脾的完整数据（TypedArray 直接结构化克隆入 IndexedDB） */
export interface CombSideData {
  key: string;            // `${frameId}:A|B`
  frameId: string;
  side: 0 | 1;            // A=0 正面, B=1 反面
  count: number;
  types: Uint8Array;      // CellType
  states: Uint8Array;     // CellState
  ages: Uint16Array;      // 发育日龄，0xFFFF = 不适用
  eggs: Uint8Array;       // 卵粒数（工蜂产卵时 >1）
  cx: Float32Array;       // 房心坐标 mm
  cy: Float32Array;
  cups: QueenCupInfo[];
  generatedAt: string;
}

export interface FrameProfile {
  workerCells: number;
  droneCells: number;
  cupCells: number;
  broodCells: number;
  cappedCells: number;
  honeyCells: number;
  pollenCells: number;
  emptyCells: number;
  diseaseCells: number;
  multiEggCells: number;
  /** 子区内部空房（插花）比例 0..1 */
  patchiness: number;
}

export interface FrameMeta {
  id: string;
  hiveId: string;
  index: number;
  seed: number;
  profile: FrameProfile;
}

export type HiveStatus = 'normal' | 'queenless' | 'laying-worker';

export interface Hive {
  id: string;
  yardId: string;
  code: string;
  posX: number;           // 场地内排位 0..1
  posY: number;
  queenGen: number;       // 蜂王代数
  queenBirth: string;     // 出房日期 ISO
  breed: string;          // 品种
  supers: number;         // 继箱层数
  status: HiveStatus;
  frameCount: number;
  frames: FrameMeta[];
  lastInspection: string; // ISO 日期
  notes: string;
}

export interface Yard {
  id: string;
  name: string;
  crop: string;           // 花期：油菜/洋槐/荆条
  bloomStart: string;     // ISO 日期
  bloomEnd: string;
  distanceKm: number;     // 距本场公里
  mapX: number;           // 地图虚拟坐标
  mapY: number;
}

export interface Inspection {
  id: string;
  hiveId: string;
  date: string;
  queenSeen: boolean;
  note: string;
  stats: Record<string, number>;
}

export interface MonthlySnapshot {
  ym: string;             // 2025-11
  broodFrames: number;
  honeyFrames: number;
  pollenFrames: number;
  estHoneyJin: number;
  strength: number;       // 群势分 0..100
}

export interface HiveHistory {
  hiveId: string;
  months: MonthlySnapshot[];
}

export const BROOD_AGE_MAX = 21; // 意蜂卵→出房 21 天

/** 日龄 -> 状态 */
export function ageToState(age: number): CellStateValue {
  if (age < 0) return CellState.Empty;
  if (age <= 2) return CellState.Egg;
  if (age <= 5) return CellState.LarvaS;
  if (age <= 8) return CellState.LarvaL;
  if (age <= 20) return CellState.CappedBrood;
  return CellState.Empty; // 21 天出房
}

/** 刷状态时给的默认日龄（取该阶段中点，便于时间轴推演） */
export function defaultAgeFor(state: CellStateValue): number {
  switch (state) {
    case CellState.Egg: return 0;
    case CellState.LarvaS: return 4;
    case CellState.LarvaL: return 7;
    case CellState.CappedBrood: return 14;
    default: return 0xffff;
  }
}
