import type { Env } from './types.ts';
import { runScheduled } from './scheduled.ts';
import app from './api.ts';

export default {
  // ── Cron Triggers ─────────────────────────────────────────────────────────
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    return runScheduled(controller.cron, env, ctx);
  },

  // ── HTTP Handler (Hono) ───────────────────────────────────────────────────
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
