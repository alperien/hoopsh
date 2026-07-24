// Zero-dependency dev runtime: registers module hooks so Node 24's native
// TypeScript type-stripping can run the monorepo directly from source.
// (When npm access is available, tsx/vitest work on the same code unchanged.)
import { register } from 'node:module';

register(new URL('./hooks.mjs', import.meta.url));
