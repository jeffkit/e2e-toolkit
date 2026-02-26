/**
 * 全局可变应用状态
 *
 * 所有路由按请求读取此状态，切换项目时原地更新。
 */

import type { E2EConfig, ActivityEntry, Store, TaskQueue, Notifier, ResourceLimiter, HistoryStore } from 'argusai-core';
import { EventBus } from 'argusai-core';

export interface AppState {
  config: E2EConfig | null;
  configDir: string;
  configPath: string | null;
  eventBus: EventBus;
  /** Activity timeline entries (most recent first) */
  activities: ActivityEntry[];
  /** Platform services (optional, injected by unified server) */
  store?: Store;
  taskQueue?: TaskQueue;
  notifier?: Notifier;
  resourceLimiter?: ResourceLimiter;
  /** History store for test result persistence & trend analysis */
  historyStore?: HistoryStore;
}

/** 全局单例状态 */
let _state: AppState | null = null;

export function initAppState(state: AppState): AppState {
  _state = state;
  return _state;
}

export function getAppState(): AppState {
  if (!_state) throw new Error('AppState not initialized');
  return _state;
}

export function updateAppState(patch: Partial<AppState>): AppState {
  if (!_state) throw new Error('AppState not initialized');
  Object.assign(_state, patch);
  return _state;
}

export function addActivity(entry: ActivityEntry): void {
  const state = getAppState();
  state.activities.unshift(entry);
  if (state.activities.length > 200) state.activities.length = 200;
  state.eventBus.emit('activity', { event: entry.status === 'running' ? 'activity_start' : 'activity_update', data: entry });
}

export function updateActivity(id: string, patch: Partial<ActivityEntry>): void {
  const state = getAppState();
  const entry = state.activities.find(a => a.id === id);
  if (entry) {
    Object.assign(entry, patch);
    state.eventBus.emit('activity', { event: 'activity_update', data: entry });
  }
}
