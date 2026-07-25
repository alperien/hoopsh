// Module resolution hooks for the zero-dependency dev runtime:
//  1. '@hoopsh/<pkg>'      -> packages/<pkg>/src/index.ts
//  2. relative './x.js'      -> './x.ts' when the .ts source exists (TS convention)
//  3. 'vitest'               -> tools/shims/vitest.ts (node:test-backed shim)
//
// The npm registry is unreachable here, so there's no node_modules to
// populate a '@hoopsh/*' workspace symlink or an installed 'vitest' package,
// and Node's native TypeScript type-stripping (register.mjs) only strips
// type syntax — it never rewrites specifiers. Every import in the codebase
// still says './state.js' (per the AGENTS.md §1.7 relative-import
// convention: write the eventual-JS extension even though the file on disk
// is .ts) or '@hoopsh/engine' (per the workspace package-naming convention),
// and without this file Node's default resolver would fail both: it has no
// '.js' file to find and no package named '@hoopsh/engine' anywhere. These
// three branches are the whole bridge; nothing else in the codebase needs to
// know the mapping exists.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKGS = path.join(ROOT, 'packages');

export async function resolve(specifier, context, nextResolve) {
  // Branch 1: the vitest shim. Checked before the '@hoopsh/*' branch (and
  // before falling through to Node's resolver, which would otherwise throw
  // MODULE_NOT_FOUND) because 'vitest' is a bare package name, not scoped —
  // it needs its own short-circuit rather than reusing the scoped-package
  // regex below. Every test file does `import { describe, it, expect } from
  // 'vitest'`; this line is the only thing standing between that import and
  // a hard crash with zero packages installed. See tools/shims/vitest.ts for
  // what the shim actually implements.
  if (specifier === 'vitest') {
    return {
      url: pathToFileURL(path.join(ROOT, 'tools', 'shims', 'vitest.ts')).href,
      shortCircuit: true
    };
  }

  // Branch 2: '@hoopsh/<pkg>' -> that package's public entry point
  // (packages/<pkg>/src/index.ts). This is the only mapping cross-package
  // imports need — every package exports its consumer-facing surface from
  // src/index.ts (see e.g. packages/narration/src/index.ts), so resolving
  // the scope name straight to that file is sufficient; nothing here needs
  // to understand subpath exports or package.json "exports" maps. Guarded
  // by existsSync so a typo'd or not-yet-created package name falls through
  // to nextResolve and produces Node's normal (comprehensible) not-found
  // error instead of a silent shortCircuit to a nonexistent file.
  const scoped = specifier.match(/^@hoopsh\/([\w-]+)$/);
  if (scoped) {
    const target = path.join(PKGS, scoped[1], 'src', 'index.ts');
    if (existsSync(target)) {
      return { url: pathToFileURL(target).href, shortCircuit: true };
    }
  }

  // Branch 3: relative './x.js' -> './x.ts', but ONLY when the sibling .ts
  // file actually exists on disk. Source files uniformly import with a
  // '.js' suffix (the TS convention for relative specifiers, so the same
  // source also works unmodified under a real bundler or ts-node/tsx once
  // npm access lands — see AGENTS.md §1.7); native type-stripping resolves
  // './x.js' literally, so without this rewrite every relative import in the
  // engine would 404. The existsSync guard matters here too: it lets a
  // GENUINE '.js' file (there are none today, but nothing prevents one
  // later) resolve normally via nextResolve instead of being redirected to a
  // '.ts' file that was never there, and it keeps this hook a no-op for
  // anything that isn't a relative specifier from a file:// parent module.
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

  // None of the three branches matched — defer to Node's normal resolution
  // (bare Node built-ins like 'node:fs', absolute/file URLs, anything not
  // covered above).
  return nextResolve(specifier, context);
}

// CONSTRAINT THIS IMPOSES ON THE CODEBASE: because resolution here is a type
// stripper, not a compiler, only ERASABLE TypeScript syntax may appear
// anywhere hooks.mjs's mapped modules get loaded — i.e. everywhere in this
// monorepo. No enums, no namespaces with runtime code, no constructor
// parameter properties, no `import x = require()`; type-only imports must be
// explicitly marked `import type` because stripping erases type annotations
// but does NOT perform import elision, so an unmarked type-only import
// becomes a real (and usually broken) runtime import. See AGENTS.md §1.7 for
// the full list — this file is the reason that rule exists, not just a
// place that happens to repeat it.
