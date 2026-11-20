// 路由与应用外壳 ============================================================

import { h, mount } from './dom';
import { renderMapPage } from './page-map';
import { renderHivePage } from './page-hive';
import { renderCombPage } from './page-comb';
import { renderAnalysisPage } from './page-analysis';
import { renderMigrationPage } from './page-migration';

const NAV = [
  { hash: '#/map', label: '蜂场地图', ico: '🗺️' },
  { hash: '#/hive', label: '蜂箱档案', ico: '📦' },
  { hash: '#/comb', label: '巢脾查看', ico: '🔷' },
  { hash: '#/analysis', label: '群势分析', ico: '📈' },
  { hash: '#/migration', label: '转场计划', ico: '🚚' },
];

export function startApp(): void {
  const app = document.querySelector<HTMLElement>('#app')!;
  const aside = h('aside', {},
    h('div', { class: 'brand' }, '巢脾检查台',
      h('small', {}, '三维复现 · 离线记录')),
    ...NAV.map((n) => {
      const item = h('div', {
        class: 'nav-item',
        dataset: { hash: n.hash },
        onclick: () => (location.hash = n.hash),
      }, h('span', { class: 'ico' }, n.ico), h('span', {}, n.label));
      return item;
    }),
    h('div', { class: 'side-foot' },
      h('div', {}, h('span', { class: 'offline-dot' }), 'IndexedDB 本地存储'),
      h('div', { style: 'margin-top:4px' }, '无网络也可完整使用')),
  );

  const main = h('main', {});
  app.append(aside, main);

  if (!location.hash) location.hash = '#/map';
  window.addEventListener('hashchange', route);
  route();

  async function route() {
    const hash = location.hash || '#/map';
    const parts = hash.split('/').filter(Boolean); // ['#','map'] 等
    const key = '#/' + (parts[1] ?? 'map');

    document.querySelectorAll<HTMLElement>('.nav-item').forEach((el) => {
      const navHash = el.dataset.hash!;
      el.classList.toggle('active', key === navHash || key.startsWith(navHash + '/') ||
        (navHash === '#/hive' && key === '#/hive'));
    });

    // 释放旧页面的 WebGL 资源
    const mainHolder = main as unknown as { _cleanup?: () => void };
    mainHolder._cleanup?.();
    delete mainHolder._cleanup;
    const page = h('div', { class: 'page' }) as HTMLElement & { _cleanup?: () => void };
    mount(main, page);

    try {
      switch (parts[1]) {
        case 'map':
          await renderMapPage(page, nav);
          break;
        case 'hive':
          if (parts[2]) await renderHivePage(page, parts[2], nav);
          else await renderMapPage(page, nav);
          break;
        case 'comb':
          await renderCombPage(page, parts[2], parts[3], nav);
          if (page._cleanup) mainHolder._cleanup = page._cleanup;
          break;
        case 'analysis':
          await renderAnalysisPage(page, parts[2] ?? null, nav);
          break;
        case 'migration':
          await renderMigrationPage(page, nav);
          break;
        default:
          await renderMapPage(page, nav);
      }
    } catch (err) {
      console.error(err);
      mount(page, h('div', { class: 'card' }, '页面加载失败：' + String(err)));
    }
  }
}

function nav(hash: string): void {
  location.hash = hash;
}
