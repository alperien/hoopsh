/**
 * app.js — UI shell: hash router, state store, screen registry. OWNER:
 * ui-shell task (Build C). STATUS: STAGED skeleton from the contracts
 * wave; the SHELL CONTRACT below is frozen so screen tasks can build in
 * parallel against it.
 *
 * SHELL CONTRACT (frozen):
 *   registerScreen(name, { title, render })
 *     name    hash route segment ('office' -> #/office, params after /)
 *     title   string | (params) => string, for the header
 *     render  async (root, params) => void | cleanupFn
 *             root: the content element, emptied before each render.
 *   navigate(path)            programmatic navigation ('#/player/p0042')
 *   store.league              latest Summary payload (refreshed on advance)
 *   store.refresh()           re-pull summary; broadcasts 'summary' event
 *   on(event, fn)             'summary' | 'sim-progress' | 'inbox'
 *   api.*                     see api.js (mirror of app/src/protocol.ts)
 *   ui.table(spec)            the dense sortable table builder (ui.js)
 *   fmt.*                     money/pct/height/date formatters (format.js)
 *
 * Screens register themselves by importing this module and calling
 * registerScreen at module load; screens/index.js imports every screen
 * module (each screen file is owned by exactly one UI task).
 */
throw new Error('ui shell: not implemented (ui-shell task lands this)');
