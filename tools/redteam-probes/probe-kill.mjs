// Usage (from repo root): node --disable-warning=ExperimentalWarning --import ./tools/register.mjs tools/redteam-probes/probe-kill.mjs
// Probe 2: failure policy. (a) worker that fails (bogus task reaches the
// worker only when workers>1); (b) a SIGKILLed worker mid-run.
import { runGames } from '../../packages/harness/src/parallel.ts';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// (a) bogus task with workers=2: parent doesn't pre-validate, workers throw
try {
  const r = await runGames({ task: 'bogus', games: 4, seedBase: 'rk', workers: 2 });
  console.log('(a) NO ERROR — got', Array.isArray(r) ? r.length : typeof r, 'results <-- BAD');
  process.exitCode = 1; // exit-code discipline (b7-F6)
} catch (e) {
  console.log('(a) loud error:', e.message.split('\n')[0]);
}

// (b) kill one worker mid-run. pgrep is scoped to THIS checkout's absolute
// run-worker.ts path — a bare 'run-worker.ts' pattern matches any checkout's
// batch/sweep run machine-wide and SIGKILLs someone else's work (b7-F9).
const workerPath = fileURLToPath(new URL('../../packages/harness/src/run-worker.ts', import.meta.url));
const p = runGames({ task: 'flow', games: 12, seedBase: 'rk2', workers: 2 });
setTimeout(() => {
  try {
    const out = execSync(`pgrep -f ${JSON.stringify(workerPath)} | head -1`).toString().trim();
    if (out) { process.kill(Number(out), 'SIGKILL'); console.log('(b) killed worker pid', out); }
    else console.log('(b) no worker found to kill (run finished too fast?)');
  } catch (err) { console.log('(b) kill failed:', err.message); }
}, 2500);
try {
  const rows = await p;
  console.log('(b) run RESOLVED with', rows.length, 'rows — check whether kill landed above');
} catch (e) {
  console.log('(b) run REJECTED loudly:', e.message.split('\n').slice(0, 3).join(' | '));
}
