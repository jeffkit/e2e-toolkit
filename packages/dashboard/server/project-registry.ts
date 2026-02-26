/**
 * 项目注册表管理器
 *
 * 在 ~/.argusai/projects.json 中存储已注册的 E2E 项目。
 * 支持多项目管理和切换。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export interface ProjectEntry {
  name: string;
  configPath: string;   // 绝对路径
  description?: string;
  addedAt: string;       // ISO timestamp
}

export interface ProjectRegistry {
  activeProject: string | null;
  projects: ProjectEntry[];
}

const REGISTRY_DIR = path.join(os.homedir(), '.argusai');
const REGISTRY_FILE = path.join(REGISTRY_DIR, 'projects.json');

function ensureDir() {
  if (!fs.existsSync(REGISTRY_DIR)) {
    fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  }
}

export function loadRegistry(): ProjectRegistry {
  ensureDir();
  if (!fs.existsSync(REGISTRY_FILE)) {
    return { activeProject: null, projects: [] };
  }
  try {
    const raw = fs.readFileSync(REGISTRY_FILE, 'utf-8');
    return JSON.parse(raw) as ProjectRegistry;
  } catch {
    return { activeProject: null, projects: [] };
  }
}

export function saveRegistry(registry: ProjectRegistry): void {
  ensureDir();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf-8');
}

export function addProject(entry: Omit<ProjectEntry, 'addedAt'>): ProjectRegistry {
  const registry = loadRegistry();
  // 去重：同名替换
  registry.projects = registry.projects.filter(p => p.name !== entry.name);
  registry.projects.push({
    ...entry,
    configPath: path.resolve(entry.configPath),
    addedAt: new Date().toISOString(),
  });
  // 如果没有活跃项目，自动设为第一个
  if (!registry.activeProject) {
    registry.activeProject = entry.name;
  }
  saveRegistry(registry);
  return registry;
}

export function removeProject(name: string): ProjectRegistry {
  const registry = loadRegistry();
  registry.projects = registry.projects.filter(p => p.name !== name);
  if (registry.activeProject === name) {
    registry.activeProject = registry.projects[0]?.name ?? null;
  }
  saveRegistry(registry);
  return registry;
}

export function setActiveProject(name: string): ProjectRegistry {
  const registry = loadRegistry();
  const project = registry.projects.find(p => p.name === name);
  if (!project) {
    throw new Error(`Project "${name}" not found in registry`);
  }
  registry.activeProject = name;
  saveRegistry(registry);
  return registry;
}

export function getActiveProject(): ProjectEntry | null {
  const registry = loadRegistry();
  if (!registry.activeProject) return null;
  return registry.projects.find(p => p.name === registry.activeProject) ?? null;
}
