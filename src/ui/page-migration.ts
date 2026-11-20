// 页面 5：转场计划 ===========================================================

import { Yard } from '../core/types';
import { repo, strengthOf } from '../core/repo';
import { clear, h } from './dom';
import { scoreOf, strengthColor, strengthLabel } from './widgets';

interface PlanInput {
  yardId: string;
  topPct: number;     // 只挑群势前百分之多少
  capacity: number;   // 每车装多少箱
  speed: number;      // 夜间山路时速 km/h
  loadMin: number;    // 每箱装车耗时（分钟）
  departHour: number; // 出发钟点
}

export async function renderMigrationPage(root: HTMLElement, nav: (hash: string) => void): Promise<void> {
  const [yards, hives] = await Promise.all([repo.yards(), repo.hives()]);
  const targetYards = yards.filter((y) => y.distanceKm > 0);

  clear(root);
  const input: PlanInput = {
    yardId: targetYards[0]?.id ?? yards[0].id,
    topPct: 70,
    capacity: 8,
    speed: 45,
    loadMin: 6,
    departHour: 20,
  };

  const resultBox = h('div', {});
  const wrap = h('div', {}, h('h2', {}, '转场计划 · 按花期排程抢蜜源'));

  // —— 花期时间轴 ——
  wrap.append(
    h('div', { class: 'card' },
      h('h3', {}, '本年度花期排程'),
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, '场地'), h('th', {}, '蜜源'), h('th', {}, '始花'), h('th', {}, '末花'),
          h('th', {}, '距离'), h('th', {}, '现置箱数'))),
        h('tbody', {},
          ...yards.map((y) => {
            const n = hives.filter((x) => x.yardId === y.id).length;
            return h('tr', {},
              h('td', {}, y.name),
              h('td', {}, y.crop),
              h('td', {}, y.bloomStart),
              h('td', {}, y.bloomEnd),
              h('td', {}, `${y.distanceKm} km`),
              h('td', {}, String(n)));
          }),
        ),
      ),
      h('div', { class: 'small muted', style: 'margin-top:8px' },
        '原则：油菜末花前转洋槐（4 月中旬），洋槐结束转荆条（6 月上旬）；强群先走抢首花期。'),
    ),
  );

  // —— 计划参数 ——
  const yardSel = h('select', {},
    ...targetYards.map((y) => h('option', { value: y.id }, `${y.name}（${y.crop} ${y.distanceKm}km）`))) as HTMLSelectElement;
  const topInput = h('input', { type: 'range', min: '30', max: '100', step: '5', value: String(input.topPct) }) as HTMLInputElement;
  const capInput = h('input', { type: 'number', min: '1', max: '30', value: String(input.capacity) }) as HTMLInputElement;
  const speedInput = h('input', { type: 'number', min: '20', max: '80', value: String(input.speed) }) as HTMLInputElement;
  const loadInput = h('input', { type: 'number', min: '2', max: '20', value: String(input.loadMin) }) as HTMLInputElement;
  const departInput = h('input', { type: 'number', min: '18', max: '23', value: String(input.departHour) }) as HTMLInputElement;

  const paramCard = h('div', { class: 'card' },
    h('h3', {}, '转场参数'),
    h('div', { class: 'grid cols-3' },
      h('label', { class: 'field' }, '目标场地', yardSel),
      h('label', { class: 'field' }, `挑选群势前 ${input.topPct}%`, topInput),
      h('label', { class: 'field' }, '每车装载(箱)', capInput),
      h('label', { class: 'field' }, '夜间均速(km/h)', speedInput),
      h('label', { class: 'field' }, '每箱装车(分钟)', loadInput),
      h('label', { class: 'field' }, '出发钟点(时)', departInput),
    ),
    h('div', { style: 'margin-top:12px' },
      h('button', {
        class: 'primary',
        onclick: () => {
          input.yardId = yardSel.value;
          input.topPct = Number(topInput.value);
          input.capacity = Number(capInput.value);
          input.speed = Number(speedInput.value);
          input.loadMin = Number(loadInput.value);
          input.departHour = Number(departInput.value);
          renderResult();
        },
      }, '生成转场计划')),
  );
  wrap.append(paramCard, resultBox);
  root.append(wrap);

  function renderResult() {
    const yard = yards.find((y) => y.id === input.yardId)!;
    const ranked = [...hives].sort((a, b) => scoreOf(b) - scoreOf(a));
    const take = Math.max(1, Math.round((ranked.length * input.topPct) / 100));
    const chosen = ranked.slice(0, take);

    const trucks = Math.ceil(chosen.length / input.capacity);
    const driveHours = yard.distanceKm / input.speed;
    const loadHours = (chosen.length * input.loadMin) / 60;
    const totalHours = loadHours + driveHours;

    const depart = input.departHour;
    const arriveClock = (depart + totalHours) % 24;
    const fmtClock = (x: number) => {
      const hh = Math.floor(x);
      const mm = Math.round((x - hh) * 60);
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    };
    const arriveNextDay = depart + totalHours >= 24;

    clear(resultBox);
    resultBox.append(
      h('div', { class: 'grid cols-4', style: 'margin-top:14px' },
        stat(String(chosen.length), '入选蜂箱'),
        stat(String(trucks), '需要车辆'),
        stat(driveHours.toFixed(1), '单程小时'),
        stat(fmtClock(arriveClock), (arriveNextDay ? '次日凌晨 ' : '当晚 ') + '到场'),
      ),

      h('div', { class: 'card', style: 'margin-top:14px' },
        h('h3', {}, `运输测算 → ${yard.name}`),
        h('div', { class: 'kv' },
          h('span', { class: 'k' }, '路程'), h('span', {}, `${yard.distanceKm} km`),
          h('span', { class: 'k' }, '装车总工时'), h('span', {}, `${loadHours.toFixed(1)} 小时（${chosen.length} 箱 × ${input.loadMin} 分钟）`),
          h('span', { class: 'k' }, '行车时间'), h('span', {}, `${driveHours.toFixed(1)} 小时（均速 ${input.speed} km/h）`),
          h('span', { class: 'k' }, '出发/到场'), h('span', {}, `${fmtClock(depart)} 出发 → ${fmtClock(arriveClock)} ${arriveNextDay ? '次日' : '当晚'}到场`),
          h('span', { class: 'k' }, '车辆编组'), h('span', {},
            Array.from({ length: trucks }, (_, i) => {
              const start = i * input.capacity;
              const n = Math.min(input.capacity, chosen.length - start);
              return `第${i + 1}车 ${n}箱`;
            }).join('；')),
        ),
        h('div', { class: 'small muted', style: 'margin-top:8px' },
          '提示：夜间关巢门、纱盖通风，到场后立即卸车开门、静放再亮灯；花期始花前 2~3 天到场最佳。'),
      ),

      h('div', { class: 'card', style: 'margin-top:14px' },
        h('h3', {}, `按群势优先的装箱顺序（共 ${chosen.length} 箱，阈值分 ${scoreOf(chosen[chosen.length - 1])}）`),
        h('table', {},
          h('thead', {}, h('tr', {},
            h('th', {}, '顺序'), h('th', {}, '车号'), h('th', {}, '蜂箱'), h('th', {}, '当前场地'),
            h('th', {}, '群势'), h('th', {}, '等级'), h('th', {}, '状态'), h('th', {}, ''))),
          h('tbody', {},
            ...chosen.map((hv, i) => {
              const truckNo = Math.floor(i / input.capacity) + 1;
              const from = yards.find((y) => y.id === hv.yardId);
              return h('tr', {},
                h('td', {}, String(i + 1)),
                h('td', {}, `第${truckNo}车`),
                h('td', {}, hv.code),
                h('td', { class: 'small muted' }, from?.name ?? ''),
                h('td', {},
                  h('span', { style: `color:${strengthColor(scoreOf(hv))};font-weight:700` }, String(scoreOf(hv)))),
                h('td', {}, strengthLabel(scoreOf(hv))),
                h('td', {}, hv.status === 'normal' ? '—' : h('span', { class: hv.status === 'laying-worker' ? 'tag red' : 'tag yellow' },
                  hv.status === 'laying-worker' ? '工蜂产卵' : '失王')),
                h('td', {}, h('button', { class: 'ghost', onclick: () => nav(`#/hive/${hv.id}`) }, '档案')),
              );
            }),
          ),
        ),
        h('div', { class: 'small muted', style: 'margin-top:8px' },
          `群势不足的 ${hives.length - chosen.length} 箱留原场复壮，不占运力；失王/工蜂产卵群建议先并群处理，不随大流转场。`),
      ),
    );
  }

  renderResult();
}

function stat(num: string, label: string, sub?: string) {
  return h('div', { class: 'card' },
    h('div', { class: 'stat-num' }, num),
    h('div', { class: 'stat-label' }, label),
    sub ? h('div', { class: 'small muted' }, sub) : null);
}
