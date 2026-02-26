#!/usr/bin/env node
/**
 * CLI script to generate JSON Schema files from Zod schemas.
 * Run with: npx tsx packages/core/scripts/generate-schemas.ts
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSchemas } from '../src/schema-generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');
const outputDir = path.join(projectRoot, 'schemas');

async function main() {
  console.log(`Generating JSON schemas to ${outputDir}...`);
  const files = await generateSchemas(outputDir);
  for (const f of files) {
    console.log(`  ✓ ${path.relative(projectRoot, f)}`);
  }
  console.log(`Done. Generated ${files.length} schema files.`);
}

main().catch((err) => {
  console.error('Schema generation failed:', err);
  process.exit(1);
});
