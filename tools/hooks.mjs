// Module resolution hooks for the zero-dependency dev runtime:
//  1. '@hoopsh/<pkg>'      -> packages/<pkg>/src/index.ts
//  2. relative './x.js'      -> './x.ts' when the .ts source exists (TS convention)
//  3. 'vitest'               -> tools/shims/vitest.ts (node:test-backed shim)
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKGS = path.join(ROOT, 'packages');

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'vitest') {
    return {
      url: pathToFileURL(path.join(ROOT, 'tools', 'shims', 'vitest.ts')).href,
      shortCircuit: true
    };
  }

  const scoped = specifier.match(/^@hoopsh\/([\w-]+)$/);
  if (scoped) {
    const target = path.join(PKGS, scoped[1], 'src', 'index.ts');
    if (existsSync(target)) {
      return { url: pathToFileURL(target).href, shortCircuit: true };
    }
  }

  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    specifier.endsWith('.js') &&
    context.parentURL?.startsWith('file:')
  ) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const tsPath = path.resolve(parentDir, specifier.slice(0, -3) + '.ts');
    if (existsSync(tsPath)) {
      return { url: pathToFileURL(tsPath).href, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}
