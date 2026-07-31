/**
 * main.ts - `npm run gm`: start the game server and print the URL.
 *
 *   npm run gm                       # port 4200
 *   npm run gm -- --port 5000
 *   npm run gm -- --load my-league   # boot straight into a save
 *   npm run gm -- --workers 2        # cap the game-sim worker pool
 */
import { startServer } from './server.js';

function flag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const port = flag('port') ? Number(flag('port')) : 4200;
const workers = flag('workers') ? Number(flag('workers')) : undefined;
const loadSave = flag('load');

startServer({ port, workers, loadSave })
  .then(({ port: boundPort }) => {
    console.log(`hoopsh gm is up: http://localhost:${boundPort}`);
    if (loadSave) console.log(`loaded save: ${loadSave}`);
    else console.log('no league loaded yet; the browser will walk you through a new one.');
  })
  .catch(err => {
    console.error('failed to start:', (err as Error).message);
    process.exit(1);
  });
