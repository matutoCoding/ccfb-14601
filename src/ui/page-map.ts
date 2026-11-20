// 页面 1：蜂场地图 ===========================================================

import { Hive, Yard } from '../core/types';
import { repo } from '../core/repo';
import { clear, h, mount } from './dom';
import { scoreOf, staleDays, statusTag, strengthColor, strengthLabel } from './widgets';

const STALE_LIMIT = 7; // 超过 7 天没查标红

export async function renderMapPage(root: HTMLElement, nav: (hash: string) => void): Promise<void> {
  const [yards, hives] = await Promise.all([repo.yards(), repo.hives()]);
  clear(root);

  const mapArea = h('div', { class: 'map-canvas' });
  const side = h('div', { class: 'card scroll', style: 'overflow:auto' });

  root.append(
    h('div', {},
      h('h2', {}, '蜂场地图 · 按场地排位'),
      h('div', { class: 'map-wrap' }, mapArea, side),
    ),
  );

  // —— 地图：场地框 + 蜂箱块 ——
  for (const yard of yards) {
    const yardHives = hives.filter((x) => x.yardId === yard.id);
    const block = h('div', {
      class: 'yard-block',
      style: `left:${yard.mapX * 100}%;top:${yard.mapY * 100}%;width:30%;height:34%;transform:translate(-50%,-50%)`,
    }, h('div', { class: 'yard-label' }, `${yard.name}（${yard.crop} · ${yardHives.length}箱 · ${yard.distanceKm}km）`));

    yardHives.forEach((hv) => {
      const score = scoreOf(hv);
      const stale = staleDays(hv) > STALE_LIMIT;
      const dot = h('div', {
        class: 'hive-dot' + (stale ? ' stale' : ''),
        style: `left:${hv.posX * 100}%;top:${hv.posY * 100}%;background:${strengthColor(score)}`,
        title: `${hv.code} 群势${score} 距上次检查${staleDays(hv)}天`,
        onclick: () => nav(`#/hive/${hv.id}`),
      }, hv.code);
      block.append(dot);
    });
    mapArea.append(block);
  }

  // —— 侧栏：图例与汇总 ——
  const total = hives.length;
  const strong = hives.filter((x) => scoreOf(x) >= 75).length;
  const weak = hives.filter((x) => scoreOf(x) < 55).length;
  const stale = hives.filter((x) => staleDays(x) > STALE_LIMIT).length;

  side.append(
    h('h3', {}, '图例'),
    legend('强群 (≥75)', strengthColor(90)),
    legend('中等 (55-74)', strengthColor(65)),
    legend('弱群 (35-54)', strengthColor(45)),
    legend('极弱 (<35)', strengthColor(20)),
    h('div', { class: 'legend-row' },
      h('span', { class: 'legend-swatch', style: 'box-shadow:0 0 0 3px rgba(224,102,77,.55);background:#888' }),
      h('span', {}, `超过 ${STALE_LIMIT} 天未检查`)),

    h('h3', {}, '全场汇总'),
    h('div', { class: 'grid cols-2' },
      stat(String(total), '蜂箱总数'),
      stat(String(strong), '强群'),
      stat(String(weak), '弱群/极弱'),
      stat(String(stale), '待复查')),

    h('h3', {}, '场地花期'),
    ...yards.map((y: Yard) =>
      h('div', { class: 'card', style: 'padding:10px;margin-bottom:8px' },
        h('div', { style: 'font-weight:700;color:var(--gold)' }, y.name),
        h('div', { class: 'muted small' }, `${y.crop}花期 ${y.bloomStart} ~ ${y.bloomEnd}`),
        h('div', { class: 'muted small' }, `距本场 ${y.distanceKm} km`),
      ),
    ),

    h('h3', {}, '重点关注'),
    ...hives
      .filter((x) => x.status !== 'normal' || staleDays(x) > STALE_LIMIT)
      .map((hv) =>
        h('div', {
          class: 'card',
          style: 'padding:10px;margin-bottom:8px;cursor:pointer',
          onclick: () => nav(`#/hive/${hv.id}`),
        },
          h('div', { style: 'display:flex;justify-content:space-between;align-items:center' },
            h('b', {}, hv.code), statusTag(hv)),
          h('div', { class: 'muted small' },
            `群势 ${scoreOf(hv)}（${strengthLabel(scoreOf(hv))}） · ${staleDays(hv)} 天未查`),
          hv.notes ? h('div', { class: 'small', style: 'color:var(--yellow);margin-top:4px' }, hv.notes) : null,
        ),
      ),
  );
}

function legend(label: string, color: string) {
  return h('div', { class: 'legend-row' },
    h('span', { class: 'legend-swatch', style: `background:${color}` }),
    h('span', {}, label));
}

function stat(num: string, label: string) {
  return h('div', { class: 'card', style: 'padding:10px;text-align:center' },
    h('div', { class: 'stat-num' }, num),
    h('div', { class: 'stat-label' }, label));
}
