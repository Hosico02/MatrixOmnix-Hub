// Vercel Function entry for the MatrixOmnix Hub backend.
// All /api/* and /admin/* paths are rewritten to this function (see vercel.json);
// Hono receives the original path and routes internally.
//
// Vercel's `api/` directory invokes the default export as a Node
// (req, res) handler, so we adapt Hono's fetch handler with
// getRequestListener rather than the Web-only hono/vercel adapter.
import { getRequestListener } from '@hono/node-server';
import { getApp } from '../src/hub/vercelApp.js';

export const config = { runtime: 'nodejs' };

export default getRequestListener(getApp().fetch);
