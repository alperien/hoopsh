/**
 * server.ts — node:http JSON API + static UI server. OWNER: app task.
 * STATUS: STAGED stub; implements protocol.ts exactly (routes are frozen).
 * All I/O lives in this package (franchise is pure).
 */
export function startServer(opts: { port?: number }): Promise<{ port: number; close: () => void }> {
  throw new Error('app/server: not implemented (app task lands this)');
}
