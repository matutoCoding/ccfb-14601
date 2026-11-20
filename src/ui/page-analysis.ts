// 页面 4：群势分析 ===========================================================

import { Hive } from '../core/types';
import { estimateHoneyJin, repo, strengthOf } from '../core/repo';
import { clear, h } from './dom';
import { barChart, lineChart } from './charts';
import { scoreOf, strengthColor, strengthLabel, toast } from './widgets';

export async function renderAnalysisPage(
  root: HTMLElement,
  hiveId: string | null,
  nav: (hash: string) => void,
): Promise<void> {
  const hives = await repo.hives();
  const selected = hiveId ? hives.find((x) => x.id === hiveId) ?? hives[0] : hives[0];
  const history = await repo.history(selected.id);

  clear(root);
  const wrap = h('div', {});

  // 蜂箱选择器
  const selector = h('select', { style: 'width:220px' },
    ...hives.map((hv) =>
      h('option', { value: hv.id, ...(hv.id === selected.id ? { selected: true } : {}) },
        `${hv.code}（${strengthLabel(strengthOf(hv))} ${strengthOf(hv)}）`))) as HTMLSelectElement;
  selector.addEventListener('change', () => nav(`#/analysis/${selector.value}`));

  wrap.append(
    h('h2', { style: 'display:flex;align-items:center;gap:14px' }, '群势分析', selector),
  );

  if (!history) {
    wrap.append(h('div', { class: 'card' }, '暂无历史数据'));
    root.append(wrap);
    return;
  }

  // —— 顶部数字 ——
  const latest = history.months[history.months.length - 1];
  const yearAgo = history.months[0]; // 13 个月前，即去年同期
  const yoy = latest.strength - yearAgo.strength;
  const honeyJin = estimateHoneyJin(selected);

  wrap.append(
    h('div', { class: 'grid cols-4' },
      stat(strengthOf(selected), '当前群势分', strengthColor(strengthOf(selected))),
      stat(latest.broodFrames, '当前子脾(张)'),
      stat(latest.honeyFrames, '当前蜜脾(张)'),
      stat(honeyJin, '摇蜜估产(斤)', undefined,
        `同比 ${yoy >= 0 ? '+' : ''}${yoy} 分`),
    ),
  );

  // —— 曲线卡 ——
  const labels = history.months.map((m) => m.ym);
  const lineCard = h('div', { class: 'card canvas-card' },
    h('h3', {}, '子脾 / 蜜脾数量曲线（13 个月）'),
    h('canvas', { style: 'height:260px' }));
  const strengthCard = h('div', { class: 'card canvas-card' },
    h('h3', {}, '群势曲线与去年同期对比'),
    h('canvas', { style: 'height:260px' }));
  const honeyCard = h('div', { class: 'card canvas-card' },
    h('h3', {}, '逐月摇蜜估产（斤）'),
    h('canvas', { style: 'height:240px' }));

  wrap.append(
    h('div', { class: 'grid cols-2', style: 'margin-top:14px' }, lineCard, strengthCard),
    h('div', { class: 'grid cols-2', style: 'margin-top:14px' },
      honeyCard,
      buildFrameBreakdown(selected, nav)),
  );

  // —— 全场对比柱状 ——
  const allBar = h('div', { class: 'card canvas-card', style: 'margin-top:14px' },
    h('h3', {}, '全场群势对比（点击柱子进档案）'),
    h('canvas', { style: 'height:240px' }));
  wrap.append(allBar);

  root.append(wrap);

  requestAnimationFrame(() => {
    const c1 = lineCard.querySelector('canvas')!;
    lineChart(c1, labels, [
      { name: '子脾', color: '#e3c04d', values: history.months.map((m) => m.broodFrames), fillArea: true },
      { name: '蜜脾', color: '#d98e22', values: history.months.map((m) => m.honeyFrames) },
      { name: '粉脾', color: '#7fc26b', values: history.months.map((m) => m.pollenFrames), dashed: true },
    ]);

    const c2 = strengthCard.querySelector('canvas')!;
    // 去年同期：把序列左移 12 个月对齐
    const shifted = history.months.map((_, i) =>
      i + 12 < history.months.length ? history.months[i + 12].strength : null as unknown as number,
    ).filter((v) => v != null);
    const cur = history.months.slice(12 - shifted.length).map((m) => m.strength);
    lineChart(c2, labels.slice(labels.length - shifted.length), [
      { name: '今年群势', color: '#d9a45b', values: cur, fillArea: true },
      { name: '去年同期', color: '#5fb6d8', values: shifted, dashed: true },
    ]);

    const c3 = honeyCard.querySelector('canvas')!;
    barChart(c3, history.months.map((m) => ({
      label: m.ym.slice(5),
      value: m.estHoneyJin,
      color: '#d98e22',
    })));

    const c4 = allBar.querySelector('canvas')!;
    barChart(c4, hives.map((hv) => ({
      label: hv.code,
      value: scoreOf(hv),
      color: strengthColor(scoreOf(hv)),
    })));
    c4.style.cursor = 'pointer';
    c4.addEventListener('click', (e) => {
      const rect = c4.getBoundingClientRect();
      const idx = Math.floor(((e.clientX - rect.left - 40) / (rect.width - 50)) * hives.length);
      if (idx >= 0 && idx < hives.length) nav(`#/hive/${hives[idx].id}`);
    });
  });
}

function buildFrameBreakdown(hive: Hive, nav: (hash: string) => void) {
  const card = h('div', { class: 'card' },
    h('h3', {}, `本箱巢脾构成（${hive.frames.length} 张）`),
    h('div', { class: 'pill-list' },
      ...hive.frames.map((f) => {
        const p = f.profile;
        const total = Math.max(1, p.workerCells + p.droneCells + p.cupCells);
        const kind =
          p.broodCells / total > 0.3 ? (p.cappedCells > p.broodCells * 0.55 ? '封盖脾' : '子脾')
            : p.honeyCells / total > 0.4 ? '蜜脾'
              : p.pollenCells / total > 0.25 ? '粉脾' : '空脾';
        return h('div', { class: 'frame-chip', onclick: () => nav(`#/comb/${hive.id}/${f.id}`) },
          `#${f.index} ${kind}`);
      })),
    h('div', { style: 'margin-top:14px' },
      ...hive.frames.map((f) => {
        const p = f.profile;
        const total = Math.max(1, p.workerCells + p.droneCells + p.cupCells);
        const broodPct = Math.round((p.broodCells / total) * 100);
        const honeyPct = Math.round((p.honeyCells / total) * 100);
        return h('div', { style: 'margin-bottom:8px' },
          h('div', { class: 'small muted', style: 'display:flex;justify-content:space-between' },
            h('span', {}, `#${f.index}`),
            h('span', {}, `子 ${broodPct}% · 蜜 ${honeyPct}% · 病 ${p.diseaseCells} · 多卵 ${p.multiEggCells}`)),
          h('div', { class: 'progress' },
            h('div', { style: `width:${broodPct}%;background:linear-gradient(90deg,#a8712f,#e3c04d)` })));
      }),
    ),
  );
  return card;
}

function stat(num: number, label: string, color?: string, sub?: string) {
  return h('div', { class: 'card' },
    h('div', { class: 'stat-num', style: color ? `color:${color}` : '' }, String(num)),
    h('div', { class: 'stat-label' }, label),
    sub ? h('div', { class: 'small muted' }, sub) : null);
}

export { toast };
