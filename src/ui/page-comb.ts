// 页面 3：巢脾三维查看（深度遮挡验证 + 刷子批量标记 + 21 天时间轴） =========

import { CombSideData, FrameMeta, Hive, CellState, STATE_META, CellType } from '../core/types';
import { repo } from '../core/repo';
import { h } from './dom';
import { CombScene, occlusionReadout, ViewInfo } from '../three/CombScene';
import {
  CELL_DEPTH,
  DRONE_R,
  WORKER_R,
} from '../core/geometry';
import { projectSide, combAdvice, evaluateHealth } from '../core/simulation';
import { toast } from './widgets';

const BRUSH_STATES = [
  CellState.Empty, CellState.Egg, CellState.LarvaS, CellState.LarvaL,
  CellState.CappedBrood, CellState.Honey, CellState.Pollen,
  CellState.CappedHoney, CellState.Chalkbrood, CellState.Sacbrood,
];

export async function renderCombPage(
  root: HTMLElement,
  hiveId: string,
  frameId: string,
  nav: (hash: string) => void,
): Promise<void> {
  const [hiveMaybe, frame] = await Promise.all([repo.hive(hiveId), repo.frames(hiveId)]);
  const f = frame.find((x) => x.id === frameId);
  if (!hiveMaybe || !f) return;
  const hive = hiveMaybe;
  const { sides, layout } = await repo.getComb(hive, f);

  root.innerHTML = '';
  const viewport = h('div', { class: 'viewport' });
  const panel = h('div', { class: 'side-panel scroll' });
  const wrap = h('div', {},
    h('div', { class: 'breadcrumb' },
      h('b', { onclick: () => nav('#/map') }, '蜂场地图'), ' / ',
      h('b', { onclick: () => nav(`#/hive/${hiveId}`) }, hive.code), ' / 巢脾 #', String(f.index)),
    h('div', { class: 'comb-layout' }, viewport, panel));
  root.append(wrap);

  const scene = new CombScene(viewport);
  let sideIdx = 0;
  let side: CombSideData = sides[0];
  scene.setComb(side, layout);

  // —— HUD ——
  const hud = h('div', { class: 'hud' });
  viewport.append(hud);
  const hudRows: Record<string, HTMLElement> = {};
  const row = (id: string, k: string) => {
    const v = h('span', { class: 'v' }, '—');
    hudRows[id] = v;
    const line = h('div', { class: 'row' }, h('span', { class: 'k' }, k), v);
    hud.append(line);
  };
  row('tilt', '视线倾角 θ');
  row('shift', '房口横向位移 h·tanθ');
  row('hex', '六边形房底可见(足迹法)');
  row('ray', '六边形房底可见(射线法)');
  row('circle', '等效圆管解析值');
  row('drone', '雄蜂房可见(足迹法)');
  row('egg', '卵尖遮挡临界角');
  row('fps', 'FPS / drawCalls');

  let viewInfo: ViewInfo = { tilt: 0, az: 0, sunAz: 0, sunEl: 0 };
  scene.onView = (v) => {
    viewInfo = v;
    const r = occlusionReadout(v);
    setHud('tilt', `${r.tilt.toFixed(1)}°（方位 ${r.az.toFixed(0)}°）`);
    setHud('shift', `${r.shift.toFixed(2)} mm（房深 ${CELL_DEPTH}mm）`);
    setHud('hex', pct(r.workerHex), r.workerHex > 0.95 ? 'ok' : r.workerHex > 0.4 ? 'warn' : 'bad');
    setHud('ray', pct(r.workerRay), Math.abs(r.workerHex - r.workerRay) < 0.02 ? 'ok' : 'bad');
    setHud('circle', pct(r.workerCircle));
    setHud('drone', pct(r.droneHex));
    setHud('egg', `${r.eggAngle.toFixed(1)}°（卵高 1.6mm，房口边中点）`);
  };
  scene.onFps = (fps, calls) => setHud('fps', `${fps} / ${calls} calls`, fps >= 50 ? 'ok' : 'warn');

  function setHud(id: string, text: string, cls?: string) {
    const el = hudRows[id];
    if (!el) return;
    el.textContent = text;
    el.className = 'v ' + (cls ?? '');
  }
  function pct(x: number): string {
    return (x * 100).toFixed(1) + '%';
  }

  // —— 右栏：视角/光照/刷子/时间轴/信息/自检 ——
  const sideBtn = h('button', { class: 'primary' }, '翻面：当前 A 面（正面）');
  sideBtn.addEventListener('click', () => {
    scene.flushSave();
    sideIdx = 1 - sideIdx;
    side = sides[sideIdx];
    scene.setComb(side, layout);
    sideBtn.textContent = `翻面：当前 ${sideIdx === 0 ? 'A 面（正面）' : 'B 面（反面）'}`;
    refreshHealth();
  });

  // 视角快捷
  const viewBtns = [0, 15, 30, 45, 60].map((deg) =>
    h('button', { onclick: () => scene.setViewTilt(deg) }, `${deg}°`));

  // 太阳
  const azInput = h('input', { type: 'range', min: '-180', max: '180', value: '-35' }) as HTMLInputElement;
  const elInput = h('input', { type: 'range', min: '8', max: '88', value: '55' }) as HTMLInputElement;
  const sunLabel = h('div', { class: 'small muted' }, '也可直接拖动场景中的金色光球');
  const syncSun = () => {
    scene.setSun(Number(azInput.value), Number(elInput.value));
  };
  azInput.addEventListener('input', syncSun);
  elInput.addEventListener('input', syncSun);
  const shadowInput = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  shadowInput.addEventListener('change', () => scene.setShadowEnabled(shadowInput.checked));

  // 刷子
  let activeBrush: number | null = null;
  const brushBtns = BRUSH_STATES.map((st) => {
    const meta = STATE_META[st];
    const btn = h('button', {
      class: 'brush-btn',
      onclick: () => {
        activeBrush = activeBrush === st ? null : st;
        scene.setBrush(activeBrush as never);
        brushBtns.forEach((b) => b.classList.remove('active'));
        if (activeBrush != null) btn.classList.add('active');
      },
    },
      h('span', { class: 'sw', style: `background:#${meta.color.toString(16).padStart(6, '0')}` }),
      h('span', {}, meta.name));
    return btn;
  });

  // 时间轴
  const dayInput = h('input', { type: 'range', min: '0', max: '21', value: '0' }) as HTMLInputElement;
  const dayLabel = h('b', {}, '第 0 天（今天）');
  const dayStats = h('div', { class: 'small muted' }, '');
  dayInput.addEventListener('input', () => {
    const d = Number(dayInput.value);
    scene.setTimelineOffset(d);
    dayLabel.textContent = d === 0 ? '第 0 天（今天）' : `第 ${d} 天`;
    updateDayStats(d);
  });

  function updateDayStats(d: number) {
    const proj = projectSide(side, '2026-11-21', d);
    const p = proj[d];
    dayStats.textContent = `卵 ${p.eggs}｜幼虫 ${p.larva}｜封盖 ${p.capped}｜当日出房 ${p.emerging}（${p.date}）`;
  }
  updateDayStats(0);

  // 选中房信息
  const cellInfo = h('div', { class: 'card', style: 'padding:10px' }, h('span', { class: 'muted small' }, '点击任意巢房查看详情'));
  scene.onSelect = (idx) => {
    const info = scene.getCellInfo(idx);
    if (!info) return;
    const meta = STATE_META[info.state];
    const typeName = info.type === CellType.Drone ? '雄蜂房' : info.type === CellType.QueenCup ? '王台' : '工蜂房';
    cellInfo.innerHTML = '';
    const nodes: (HTMLElement | Text)[] = [
      h('div', { style: 'font-weight:700;color:var(--gold)' }, `巢房 #${idx + 1}（${typeName}）`),
      h('div', { class: 'kv', style: 'margin-top:6px' },
        h('span', { class: 'k' }, '坐标'), h('span', {}, `${info.x.toFixed(1)}, ${info.y.toFixed(1)} mm`),
        h('span', { class: 'k' }, '状态'), h('span', {}, meta.name),
        h('span', { class: 'k' }, '日龄'), h('span', {}, info.age === 0xffff ? '—' : `${info.age} 天`),
        h('span', { class: 'k' }, '卵粒数'), h('span', { class: info.eggs > 1 ? 'bad' : '' }, String(info.eggs)),
      ),
    ];
    if (info.eggs > 1) nodes.push(h('div', { class: 'small bad', style: 'margin-top:6px' }, '⚠ 一房多卵：工蜂产卵典型特征'));
    cellInfo.append(...nodes);
  };

  // 几何自检
  const verifyBox = h('div', { class: 'verify-box' }, h('span', { class: 'muted' }, '点击运行遮挡几何自检…'));
  const verifyBtn = h('button', {
    onclick: () => {
      const r = scene.runSelfCheck();
      verifyBox.innerHTML = '';
      verifyBox.append(
        h('div', { class: r.pass ? 'ok' : 'bad', style: 'font-weight:700' },
          `${r.pass ? '✓ 自检通过' : '✗ 自检失败'}｜${r.samples} 组角度采样`),
        h('div', { class: 'muted' },
          `足迹法 vs 射线法 最大偏差 ${(r.maxHexRayDiff * 100).toFixed(2)}%`),
        h('div', { class: 'muted', style: 'margin-bottom:6px' },
          `六边形 vs 圆管解析 最大偏差 ${(r.maxHexCircleDiff * 100).toFixed(2)}%（形状差，预期内）`),
        ...r.rows.filter((x) => x.az === 0).map((x) =>
          h('div', { class: 'row' },
            h('span', {}, `θ=${String(x.tilt).padStart(2, ' ')}°`),
            h('span', { class: 'ok' }, `六${(x.hex * 100).toFixed(0)}%`),
            h('span', {}, `射${(x.ray * 100).toFixed(0)}%`),
            h('span', { class: 'muted' }, `圆${(x.circle * 100).toFixed(0)}%`))),
      );
    },
  }, '运行遮挡几何自检');

  // 健康评判
  const healthBox = h('div', { class: 'card', style: 'padding:10px' });
  function refreshHealth() {
    const verdict = evaluateHealth([{ side, q: layout.q, r: layout.r }], hive.status);
    healthBox.innerHTML = '';
    healthBox.append(
      h('div', { style: `font-weight:700;color:var(--${verdict.level === 'ok' ? 'green' : verdict.level === 'warn' ? 'yellow' : 'red'})` },
        verdict.level === 'ok' ? '本面健康状况良好' : '本面存在异常'),
      h('div', { class: 'small muted', style: 'margin:4px 0' },
        `插花比例 ${(verdict.patchiness * 100).toFixed(1)}%｜白垩 ${verdict.chalkbrood}｜囊状 ${verdict.sacbrood}｜多卵房 ${verdict.multiEgg}`),
      ...verdict.messages.map((m) => h('div', { class: 'small', style: 'margin-top:4px' }, '• ' + m)),
    );
  }
  refreshHealth();

  // 加脾建议
  const advice = combAdvice([projectSide(side, '2026-11-21', 21)]);

  // 保存
  scene.onEdit = async () => {
    const other = sides[1 - sideIdx];
    const updatedFrame = await repo.saveSide(side, f, other);
    const idx = hive.frames.findIndex((x) => x.id === f.id);
    hive.frames[idx] = updatedFrame;
    await repo.putHive(hive);
    refreshHealth();
    toast('巢房修改已存入 IndexedDB（离线可用）');
  };
  window.addEventListener('beforeunload', () => scene.flushSave());

  // 上一张/下一张
  const framePos = hive.frames.findIndex((x) => x.id === frameId);
  const navBar = h('div', { class: 'row-actions' },
    h('button', {
      disabled: framePos === 0,
      onclick: () => nav(`#/comb/${hiveId}/${hive.frames[framePos - 1].id}`),
    }, '← 上一张'),
    h('button', {
      disabled: framePos === hive.frames.length - 1,
      onclick: () => nav(`#/comb/${hiveId}/${hive.frames[framePos + 1].id}`),
    }, '下一张 →'),
    h('button', { class: 'ghost', onclick: () => nav(`#/hive/${hiveId}`) }, '返回档案'),
  );

  panel.append(
    h('div', { class: 'card' },
      h('h3', {}, `巢脾 #${f.index}（单面 ${side.count} 房，整脾约 ${side.count * 2} 房）`),
      sideBtn,
      h('div', { class: 'small muted', style: 'margin-top:8px' },
        `工蜂房对边径 5.38mm / 雄蜂房 6.40mm / 房深 ${CELL_DEPTH}mm（工蜂 R=${WORKER_R}，雄蜂 R=${DRONE_R}）`),
      navBar,
    ),

    h('div', { class: 'card' },
      h('h3', {}, '视角（与现场斜对太阳看脾一致）'),
      h('div', { class: 'row-actions' }, ...viewBtns),
      h('div', { class: 'small muted', style: 'margin-top:6px' }, '0° 正对房底；斜到临界角以上，房底卵被蜡壁几何遮挡'),
    ),

    h('div', { class: 'card' },
      h('h3', {}, '光照方向（可拖动光球）'),
      h('label', { class: 'field' }, `方位角 ${azInput.value}°`, azInput),
      h('label', { class: 'field' }, `高度角 ${elInput.value}°`, elInput),
      h('label', { style: 'display:flex;gap:8px;align-items:center;margin-top:6px' }, shadowInput, '实时阴影'),
      sunLabel,
    ),

    h('div', { class: 'card' },
      h('h3', {}, '检查刷子（按住拖过脾面批量标记）'),
      h('div', { class: 'brush-grid' }, ...brushBtns),
      h('button', { class: 'ghost', style: 'margin-top:8px', onclick: () => { activeBrush = null; scene.setBrush(null); brushBtns.forEach((b) => b.classList.remove('active')); } }, '取消刷子（恢复点选）'),
    ),

    h('div', { class: 'card' },
      h('h3', {}, '21 天发育时间轴（卵→出房）'),
      h('div', { class: 'timeline-bar' }, dayLabel),
      dayInput,
      dayStats,
      h('div', { class: 'small muted', style: 'margin-top:6px' }, '推演状态仅用于查看，回到第 0 天即可继续刷涂'),
      ...advice.map((m) => h('div', { class: 'small', style: 'color:var(--yellow);margin-top:6px' }, '📅 ' + m)),
    ),

    cellInfo,
    healthBox,

    h('div', { class: 'card' },
      h('h3', {}, '深度遮挡几何验证'),
      verifyBtn,
      verifyBox,
    ),
  );

  // 页面切走时释放 WebGL
  const cleanup = () => {
    scene.flushSave();
    scene.dispose();
    window.removeEventListener('beforeunload', cleanup);
  };
  (root as unknown as { _cleanup?: () => void })._cleanup = cleanup;
}
