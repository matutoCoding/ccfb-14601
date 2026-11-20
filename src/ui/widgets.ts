// 共享配色与小部件 ==========================================================

import { Hive } from '../core/types';
import { daysSince, strengthOf } from '../core/repo';
import { h } from './dom';

export function strengthColor(score: number): string {
  if (score >= 75) return '#7fc26b';
  if (score >= 55) return '#c9b458';
  if (score >= 35) return '#e0944d';
  return '#e0664d';
}

export function strengthLabel(score: number): string {
  if (score >= 75) return '强群';
  if (score >= 55) return '中等';
  if (score >= 35) return '弱群';
  return '极弱';
}

export function statusTag(hive: Hive) {
  if (hive.status === 'laying-worker') return h('span', { class: 'tag red' }, '工蜂产卵');
  if (hive.status === 'queenless') return h('span', { class: 'tag yellow' }, '失王');
  return h('span', { class: 'tag green' }, '正常');
}

export function staleDays(hive: Hive): number {
  return daysSince(hive.lastInspection);
}

export function toast(msg: string): void {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2400);
}

export function scoreOf(hive: Hive): number {
  return strengthOf(hive);
}
