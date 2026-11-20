// 极简全局状态（发布订阅）与 DOM 辅助 ========================================

type Listener = () => void;

class Emitter {
  private map = new Map<string, Set<Listener>>();
  on(key: string, fn: Listener): () => void {
    if (!this.map.has(key)) this.map.set(key, new Set());
    this.map.get(key)!.add(fn);
    return () => this.map.get(key)?.delete(fn);
  }
  emit(key: string): void {
    this.map.get(key)?.forEach((fn) => fn());
  }
}

export const bus = new Emitter();

export const EVENTS = {
  HivesChanged: 'hives-changed',
  CombEdited: 'comb-edited',
  Route: 'route',
};

type Child = Node | string | null | undefined | false;

/** h() 微型 hyperscript，避免引入框架 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = String(v);
    else if (k === 'dataset') Object.assign(el.dataset, v as object);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'value') {
      (el as HTMLInputElement).value = String(v);
    } else if (v === true) {
      el.setAttribute(k, '');
    } else if (v !== false && v != null) {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.innerHTML = '';
}

export function mount(el: HTMLElement, node: Node): void {
  clear(el);
  el.append(node);
}

export function fmtDate(iso: string): string {
  return iso;
}

export function el(sel: string): HTMLElement {
  const e = document.querySelector<HTMLElement>(sel);
  if (!e) throw new Error('missing ' + sel);
  return e;
}
