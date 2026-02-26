/**
 * 全局可变应用状态
 *
 * 所有路由按请求读取此状态，切换项目时原地更新。
 */

import type { E2EConfig } from '@preflight/core';
import { EventBus } from '@preflight/core';

export interface AppState {
  config: E2EConfig | null;
  configDir: string;
  configPath: string | null;
  eventBus: EventBus;
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
