#!/usr/bin/env node

/**
 * Smart publish script for ArgusAI monorepo.
 *
 * Detects which packages have changed since their last published version
 * (based on npm registry) and publishes only those packages in the
 * correct dependency order.
 *
 * Usage:
 *   node scripts/publish-changed.mjs              # publish changed packages
 *   node scripts/publish-changed.mjs --dry-run    # preview what would be published
 *   node scripts/publish-changed.mjs --force      # publish all packages regardless
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

const PACKAGES_ORDER = [
  'packages/core',
  'packages/mcp',
  'packages/cli',
  'packages/dashboard',
];

function readPkg(dir) {
  const pkgPath = join(ROOT, dir, 'package.json');
  if (!existsSync(pkgPath)) return null;
  return JSON.parse(readFileSync(pkgPath, 'utf-8'));
}

function exec(cmd, opts = {}) {
  const result = execSync(cmd, { encoding: 'utf-8', cwd: ROOT, ...opts });
  return result ? result.trim() : '';
}

function getPublishedVersion(name) {
  try {
    return exec(`npm view ${name} version 2>/dev/null`);
  } catch {
    return null;
  }
}

function getLastTagForPackage(name, version) {
  try {
    return exec(`git rev-parse ${name}@${version} 2>/dev/null`);
  } catch {
    return null;
  }
}

function hasChangedSinceTag(dir, tag) {
  if (!tag) return true;
  try {
    const diff = exec(`git diff --name-only ${tag} HEAD -- ${dir}`);
    return diff.length > 0;
  } catch {
    return true;
  }
}

function hasChangedSinceLastPublish(dir, name) {
  const publishedVersion = getPublishedVersion(name);
  if (!publishedVersion) return true;

  const tagCommit = getLastTagForPackage(name, publishedVersion);
  return hasChangedSinceTag(dir, tagCommit);
}

function hasLocalChanges(dir) {
  try {
    const diff = exec(`git diff --name-only HEAD~1 HEAD -- ${dir}`);
    return diff.length > 0;
  } catch {
    return true;
  }
}

function detectChanged() {
  const changed = [];

  for (const dir of PACKAGES_ORDER) {
    const pkg = readPkg(dir);
    if (!pkg || pkg.private) continue;

    const publishedVersion = getPublishedVersion(pkg.name);
    const localVersion = pkg.version;

    const reasons = [];

    if (!publishedVersion) {
      reasons.push('never published');
    } else if (publishedVersion !== localVersion) {
      reasons.push(`version bump: ${publishedVersion} → ${localVersion}`);
    } else if (hasLocalChanges(dir)) {
      reasons.push('files changed since last commit');
    }

    if (FORCE || reasons.length > 0) {
      changed.push({
        dir,
        name: pkg.name,
        version: localVersion,
        publishedVersion: publishedVersion ?? '(none)',
        reasons: FORCE ? ['--force'] : reasons,
      });
    }
  }

  return changed;
}

function buildPackage(dir) {
  console.log(`  📦 Building ${dir}...`);
  exec(`pnpm --filter ./${dir} build`, { stdio: 'inherit' });
}

function publishPackage(dir, name, version) {
  if (DRY_RUN) {
    console.log(`  🏷️  [DRY RUN] Would publish ${name}@${version}`);
    return;
  }

  console.log(`  🚀 Publishing ${name}@${version}...`);
  try {
    exec(`pnpm --filter ./${dir} publish --access public --no-git-checks`, {
      stdio: 'inherit',
    });
    console.log(`  ✅ ${name}@${version} published!`);

    try {
      exec(`git tag ${name}@${version}`);
      console.log(`  🏷️  Tagged ${name}@${version}`);
    } catch {
      console.log(`  ⚠️  Tag ${name}@${version} already exists`);
    }
  } catch (err) {
    console.error(`  ❌ Failed to publish ${name}: ${err.message}`);
    process.exit(1);
  }
}

async function main() {
  console.log('🔍 Detecting changed packages...\n');

  const changed = detectChanged();

  if (changed.length === 0) {
    console.log('✅ No packages need publishing.\n');
    console.log('Tip: Use --force to publish all packages regardless.');
    return;
  }

  console.log(`Found ${changed.length} package(s) to publish:\n`);
  for (const pkg of changed) {
    console.log(`  📋 ${pkg.name}`);
    console.log(`     Local: ${pkg.version} | Published: ${pkg.publishedVersion}`);
    console.log(`     Reason: ${pkg.reasons.join(', ')}`);
    console.log();
  }

  if (DRY_RUN) {
    console.log('--- DRY RUN MODE — no actual publishes ---\n');
  }

  console.log('Building changed packages...\n');
  for (const pkg of changed) {
    buildPackage(pkg.dir);
  }

  console.log('\nPublishing...\n');
  for (const pkg of changed) {
    publishPackage(pkg.dir, pkg.name, pkg.version);
  }

  if (!DRY_RUN) {
    console.log('\nPushing tags...');
    try {
      exec('git push --tags');
      console.log('✅ Tags pushed.\n');
    } catch {
      console.log('⚠️  Failed to push tags (push manually with: git push --tags)\n');
    }
  }

  console.log('🎉 Done!\n');
}

main();
