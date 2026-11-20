// 页面 2：蜂箱档案 ===========================================================

import { FrameMeta, Hive, Inspection } from '../core/types';
import { repo, strengthOf, estimateHoneyJin, daysSince } from '../core/repo';
import { clear, h, mount } from './dom';
import { scoreOf, staleDays, statusTag, strengthColor, strengthLabel, toast } from './widgets';
import { bus, EVENTS } from './dom';

export async function renderHivePage(root: HTMLElement, hiveId: string, nav: (hash: string) => void): Promise<void> {
  const hive = await repo.hive(hiveId);
  if (!hive) {
    mount(root, h('div', { class: 'card' }, '蜂箱不存在'));
    return;
  }
  const [inspections, yard] = await Promise.all([
    repo.inspections(hiveId),
    repo.yards().then((ys) => ys.find((y) => y.id === hive.yardId)),
  ]);
  inspections.sort((a, b) => (a.date < b.date ? 1 : -1));
  const score = strengthOf(hive);

  clear(root);
  const wrap = h('div', {});
  wrap.append(
    h('div', { class: 'breadcrumb' },
      h('b', { onclick: () => nav('#/map') }, '蜂场地图'), ' / ', hive.code),
    h('h2', { style: 'display:flex;align-items:center;gap:12px' },
      `${hive.code} 蜂箱档案`, statusTag(hive),
      h('span', { class: 'tag blue' }, yard?.name ?? '')),
  );

  // —— 蜂王与群势 ——
  const queenAgeDays = daysSince(hive.queenBirth);
  wrap.append(
    h('div', { class: 'grid cols-4' },
      statCard(score, '群势分', strengthColor(score), strengthLabel(score)),
      statCard(hive.queenGen, '蜂王代数', undefined, `第 ${hive.queenGen} 代王`),
      statCard(Math.round(queenAgeDays / 30.4), '王龄(月)', undefined, `出房 ${hive.queenBirth}`),
      statCard(estimateHoneyJin(hive), '估产(斤)', undefined, `${hive.supers} 层继箱`),
    ),

    h('div', { class: 'grid cols-2', style: 'margin-top:14px' },
      h('div', { class: 'card' },
        h('h3', {}, '蜂王与箱体'),
        h('div', { class: 'kv' },
          h('span', { class: 'k' }, '品种'), h('span', {}, hive.breed),
          h('span', { class: 'k' }, '出房日期'), h('span', {}, hive.queenBirth),
          h('span', { class: 'k' }, '继箱层数'), h('span', {}, `${hive.supers} 层`),
          h('span', { class: 'k' }, '巢脾数量'), h('span', {}, `${hive.frameCount} 张`),
          h('span', { class: 'k' }, '上次检查'), h('span', {}, `${hive.lastInspection}（${staleDays(hive)} 天前）`),
          h('span', { class: 'k' }, '备注'), h('span', {}, hive.notes || '—'),
        ),
        h('div', { style: 'margin-top:12px;display:flex;gap:8px' },
          h('button', { onclick: () => openEdit(hive, () => renderHivePage(root, hiveId, nav)) }, '编辑档案'),
          h('button', { class: 'ghost', onclick: () => nav(`#/analysis/${hiveId}`) }, '群势分析 →'),
        ),
      ),
      h('div', { class: 'card' },
        h('h3', {}, '巢脾概览'),
        h('div', { class: 'pill-list' },
          ...hive.frames.map((f) =>
            h('div', {
              class: 'frame-chip',
              title: frameTitle(f),
              onclick: () => nav(`#/comb/${hiveId}/${f.id}`),
            }, `#${f.index} ${frameKind(f)}`),
          )),
        h('div', { class: 'muted small', style: 'margin-top:10px' },
          '点击任意巢脾进入三维查看；每张脾两面各约 3400 个巢房，均可逐一点选/刷涂。'),
        h('div', { style: 'margin-top:10px' },
          h('button', { class: 'primary', onclick: () => nav(`#/comb/${hiveId}/${hive.frames[0].id}`) }, '打开第一张脾 →')),
      ),
    ),
  );

  // —— 检查记录 ——
  wrap.append(
    h('div', { class: 'card', style: 'margin-top:14px' },
      h('h3', { style: 'display:flex;justify-content:space-between;align-items:center' },
        '检查记录',
        h('button', { onclick: () => openAddInspection(hive, () => renderHivePage(root, hiveId, nav)) }, '+ 新增检查')),
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, '日期'), h('th', {}, '见王'), h('th', {}, '子脾'), h('th', {}, '蜜脾'), h('th', {}, '备注'))),
        h('tbody', {},
          ...inspections.map((r) =>
            h('tr', {},
              h('td', {}, r.date),
              h('td', {}, r.queenSeen ? h('span', { class: 'tag green' }, '是') : h('span', { class: 'tag yellow' }, '否')),
              h('td', {}, String(r.stats.broodFrames ?? '—')),
              h('td', {}, String(r.stats.honeyFrames ?? '—')),
              h('td', { class: 'small' }, r.note),
            )),
        ),
      ),
    ),
  );

  mount(root, wrap);
}

function frameKind(f: FrameMeta): string {
  const p = f.profile;
  const total = Math.max(1, p.workerCells + p.droneCells + p.cupCells);
  if (p.broodCells / total > 0.3) return p.cappedCells > p.broodCells * 0.55 ? '封盖脾' : '子脾';
  if (p.honeyCells / total > 0.4) return '蜜脾';
  if (p.pollenCells / total > 0.25) return '粉脾';
  return '空脾';
}

function frameTitle(f: FrameMeta): string {
  const p = f.profile;
  return `工蜂房${p.workerCells} 雄蜂房${p.droneCells} 王台${p.cupCells}｜子${p.broodCells} 蜜${p.honeyCells} 粉${p.pollenCells} 病${p.diseaseCells} 多卵${p.multiEggCells}`;
}

function statCard(num: number, label: string, color?: string, sub?: string) {
  return h('div', { class: 'card' },
    h('div', { class: 'stat-num', style: color ? `color:${color}` : '' }, String(num)),
    h('div', { class: 'stat-label' }, label),
    sub ? h('div', { class: 'small muted' }, sub) : null);
}

function openEdit(hive: Hive, refresh: () => void) {
  const genInput = h('input', { type: 'number', value: String(hive.queenGen) }) as HTMLInputElement;
  const birthInput = h('input', { type: 'date', value: hive.queenBirth }) as HTMLInputElement;
  const breedInput = h('select', {},
    ...['原意', '松丹1号', '卡尼鄂拉', '东北黑', '美意'].map((b) =>
      h('option', { value: b, ...(b === hive.breed ? { selected: true } : {}) }, b))) as HTMLSelectElement;
  const supersInput = h('input', { type: 'number', min: '0', max: '3', value: String(hive.supers) }) as HTMLInputElement;
  const notesInput = h('textarea', { rows: 3, style: 'width:100%' }, hive.notes) as HTMLTextAreaElement;

  const mask = h('div', { class: 'modal-mask' },
    h('div', { class: 'modal' },
      h('h3', {}, `编辑 ${hive.code}`),
      h('div', { class: 'grid cols-2' },
        h('label', { class: 'field' }, '蜂王代数', genInput),
        h('label', { class: 'field' }, '出房日期', birthInput),
        h('label', { class: 'field' }, '品种', breedInput),
        h('label', { class: 'field' }, '继箱层数', supersInput),
      ),
      h('label', { class: 'field', style: 'margin-top:10px' }, '备注', notesInput),
      h('div', { style: 'margin-top:16px;display:flex;gap:10px;justify-content:flex-end' },
        h('button', { class: 'ghost', onclick: () => mask.remove() }, '取消'),
        h('button', {
          class: 'primary',
          onclick: async () => {
            hive.queenGen = Number(genInput.value);
            hive.queenBirth = birthInput.value;
            hive.breed = breedInput.value;
            hive.supers = Number(supersInput.value);
            hive.notes = notesInput.value;
            await repo.putHive(hive);
            bus.emit(EVENTS.HivesChanged);
            mask.remove();
            refresh();
            toast('档案已保存');
          },
        }, '保存')),
    ));
  document.body.append(mask);
}

function openAddInspection(hive: Hive, refresh: () => void) {
  const today = new Date().toISOString().slice(0, 10);
  const dateInput = h('input', { type: 'date', value: today }) as HTMLInputElement;
  const queenInput = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const noteInput = h('textarea', { rows: 3, style: 'width:100%' }) as HTMLTextAreaElement;
  const mask = h('div', { class: 'modal-mask' },
    h('div', { class: 'modal' },
      h('h3', {}, `新增检查 · ${hive.code}`),
      h('label', { class: 'field' }, '检查日期', dateInput),
      h('label', { style: 'display:flex;gap:8px;align-items:center;margin:10px 0' },
        queenInput, '本次见到蜂王'),
      h('label', { class: 'field' }, '情况备注', noteInput),
      h('div', { style: 'margin-top:16px;display:flex;gap:10px;justify-content:flex-end' },
        h('button', { class: 'ghost', onclick: () => mask.remove() }, '取消'),
        h('button', {
          class: 'primary',
          onclick: async () => {
            const rec: Inspection = {
              id: `${hive.id}-I${Date.now()}`,
              hiveId: hive.id,
              date: dateInput.value,
              queenSeen: queenInput.checked,
              note: noteInput.value || '常规检查。',
              stats: {
                broodFrames: hive.frames.filter((f) => f.profile.broodCells > 1000).length,
                honeyFrames: hive.frames.filter((f) => f.profile.honeyCells > 1500).length,
              },
            };
            await repo.putInspection(rec);
            hive.lastInspection = dateInput.value;
            await repo.putHive(hive);
            bus.emit(EVENTS.HivesChanged);
            mask.remove();
            refresh();
            toast('检查记录已保存');
          },
        }, '保存')),
    ));
  document.body.append(mask);
}
