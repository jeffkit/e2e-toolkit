/**
 * @module workspace
 * Git workspace 管理器
 *
 * 管理远程和本地 Git 仓库的 clone、fetch、checkout 操作。
 * 远程仓库被 clone 到 `~/.argusai/workspaces/<project>/` 目录下。
 */

import { execSync, type ExecSyncOptionsWithBufferEncoding } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { RepoConfig } from './types.js';

// ─── Constants ───────────────────────────────────────────────

const TOOLKIT_DIR = path.join(os.homedir(), '.argusai');
const WORKSPACES_DIR = path.join(TOOLKIT_DIR, 'workspaces');

// ─── Types ───────────────────────────────────────────────────

export interface RepoInfo {
  name: string;
  localPath: string;
  isRemote: boolean;
  url?: string;
  currentBranch?: string;
  branches: string[];
  lastCommit?: string;
  lastFetch?: string;
}

export interface WorkspaceInfo {
  projectName: string;
  workspacePath: string;
  repos: RepoInfo[];
}

export interface SyncResult {
  repo: string;
  success: boolean;
  action: 'cloned' | 'fetched' | 'checked_out' | 'up_to_date' | 'skipped';
  branch?: string;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────

function execGit(args: string, cwd: string, timeout = 60000): string {
  const opts: ExecSyncOptionsWithBufferEncoding = {
    cwd,
    timeout,
    encoding: 'utf-8' as any,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  };
  try {
    return (execSync(`git ${args}`, opts) as unknown as string).trim();
  } catch (err: any) {
    throw new Error(`git ${args} failed in ${cwd}: ${err.stderr?.toString().trim() || err.message}`);
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── Workspace Manager ──────────────────────────────────────

/**
 * 获取项目的 workspace 根目录
 */
export function getWorkspacePath(projectName: string): string {
  return path.join(WORKSPACES_DIR, projectName);
}

/**
 * 解析仓库的实际本地路径
 *
 * - 本地仓库 (path): 相对于 configDir 解析
 * - 远程仓库 (url): 位于 workspace 下的 repos/<name>
 */
export function resolveRepoLocalPath(
  repo: RepoConfig,
  projectName: string,
  configDir: string,
): string {
  if (repo.url) {
    // 远程仓库 → workspace 下的目录
    return path.join(getWorkspacePath(projectName), 'repos', repo.name);
  }
  if (repo.path) {
    // 本地仓库 → 相对于 configDir
    return path.resolve(configDir, repo.path);
  }
  throw new Error(`Repo "${repo.name}" must have either "url" or "path"`);
}

/**
 * 获取仓库信息（分支列表、当前分支等）
 */
export function getRepoInfo(
  repo: RepoConfig,
  projectName: string,
  configDir: string,
): RepoInfo {
  const localPath = resolveRepoLocalPath(repo, projectName, configDir);
  const isRemote = !!repo.url;

  const info: RepoInfo = {
    name: repo.name,
    localPath,
    isRemote,
    url: repo.url,
    branches: [],
  };

  if (!fs.existsSync(path.join(localPath, '.git'))) {
    // 仓库尚未 clone
    return info;
  }

  try {
    info.currentBranch = execGit('rev-parse --abbrev-ref HEAD', localPath);
  } catch { /* ignore */ }

  try {
    const raw = execGit('branch -a --no-color', localPath);
    info.branches = raw
      .split('\n')
      .map(b => b.replace(/^\*?\s+/, '').replace(/^remotes\/origin\//, ''))
      .filter(b => b && !b.includes('HEAD'))
      .filter((b, i, arr) => arr.indexOf(b) === i); // dedupe
  } catch { /* ignore */ }

  try {
    info.lastCommit = execGit('log -1 --format=%h', localPath);
  } catch { /* ignore */ }

  return info;
}

/**
 * 同步单个仓库（clone / fetch + checkout）
 */
export async function syncRepo(
  repo: RepoConfig,
  projectName: string,
  configDir: string,
  targetBranch?: string,
  onLog?: (msg: string) => void,
): Promise<SyncResult> {
  const log = onLog || (() => {});
  const localPath = resolveRepoLocalPath(repo, projectName, configDir);
  const isRemote = !!repo.url;
  const branch = targetBranch || repo.branch || 'main';

  // 本地仓库：只做 checkout（不 clone）
  if (!isRemote) {
    if (!fs.existsSync(path.join(localPath, '.git'))) {
      return { repo: repo.name, success: false, action: 'skipped', error: `Local path not found: ${localPath}` };
    }
    if (targetBranch) {
      try {
        log(`[${repo.name}] Checking out branch: ${targetBranch}`);
        execGit(`checkout ${targetBranch}`, localPath);
        execGit('pull --ff-only', localPath);
        return { repo: repo.name, success: true, action: 'checked_out', branch: targetBranch };
      } catch (err: any) {
        return { repo: repo.name, success: false, action: 'checked_out', branch: targetBranch, error: err.message };
      }
    }
    return { repo: repo.name, success: true, action: 'up_to_date' };
  }

  // 远程仓库：clone 或 fetch
  if (!repo.url) {
    return { repo: repo.name, success: false, action: 'skipped', error: 'No URL specified' };
  }

  ensureDir(path.dirname(localPath));

  if (!fs.existsSync(path.join(localPath, '.git'))) {
    // 首次 clone
    log(`[${repo.name}] Cloning ${repo.url} → ${localPath}`);
    try {
      execGit(`clone --branch ${branch} ${repo.url} ${localPath}`, path.dirname(localPath), 300000);
      log(`[${repo.name}] Clone complete`);
      return { repo: repo.name, success: true, action: 'cloned', branch };
    } catch (err: any) {
      return { repo: repo.name, success: false, action: 'cloned', error: err.message };
    }
  }

  // 已存在 → fetch + checkout
  try {
    log(`[${repo.name}] Fetching origin...`);
    execGit('fetch origin --prune', localPath, 120000);

    log(`[${repo.name}] Checking out branch: ${branch}`);
    try {
      execGit(`checkout ${branch}`, localPath);
    } catch {
      // 可能是远程分支，先创建本地跟踪
      execGit(`checkout -b ${branch} origin/${branch}`, localPath);
    }

    execGit('pull --ff-only', localPath);
    log(`[${repo.name}] Updated to ${branch}`);
    return { repo: repo.name, success: true, action: 'fetched', branch };
  } catch (err: any) {
    return { repo: repo.name, success: false, action: 'fetched', branch, error: err.message };
  }
}

/**
 * 同步项目的所有仓库
 */
export async function syncAllRepos(
  repos: RepoConfig[],
  projectName: string,
  configDir: string,
  branchSelections?: Record<string, string>,
  onLog?: (msg: string) => void,
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const repo of repos) {
    const branch = branchSelections?.[repo.name];
    const result = await syncRepo(repo, projectName, configDir, branch, onLog);
    results.push(result);
  }
  return results;
}

/**
 * 获取 workspace 信息（所有仓库的状态）
 */
export function getWorkspaceInfo(
  repos: RepoConfig[],
  projectName: string,
  configDir: string,
): WorkspaceInfo {
  return {
    projectName,
    workspacePath: getWorkspacePath(projectName),
    repos: repos.map(r => getRepoInfo(r, projectName, configDir)),
  };
}

/**
 * 计算有效的 Dockerfile 和 context 路径。
 *
 * 对于全远程仓库项目，Dockerfile 和 context 相对于 workspace 根目录。
 * 对于有本地仓库的项目，保持原有行为（相对于 configDir）。
 */
export function resolveBuildPaths(
  repos: RepoConfig[],
  projectName: string,
  configDir: string,
  dockerfile: string,
  context: string,
): { resolvedDockerfile: string; resolvedContext: string } {
  const hasRemoteRepos = repos.some(r => !!r.url);
  const allRemote = repos.length > 0 && repos.every(r => !!r.url);

  if (allRemote) {
    // 全部是远程仓库 → 在 workspace 根目录下解析
    const wsRoot = getWorkspacePath(projectName);
    const reposDir = path.join(wsRoot, 'repos');
    ensureDir(reposDir);
    return {
      resolvedDockerfile: path.resolve(reposDir, dockerfile),
      resolvedContext: path.resolve(reposDir, context),
    };
  }

  // 混合或全本地 → 保持原行为（相对于 configDir）
  return {
    resolvedDockerfile: path.resolve(configDir, dockerfile),
    resolvedContext: path.resolve(configDir, context),
  };
}
