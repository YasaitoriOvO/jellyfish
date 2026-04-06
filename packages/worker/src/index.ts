import type { Env, AgentDbRecord } from './types.ts';
import { runMentionLoop, runSpontaneousTweet, runTimelineEngagement, runMemoryRefresh, runNightlyEvolution } from './agent.ts';
import { getMe, getUserByUsername, getUserTweets } from './twitter.ts';
import { getLastMentionId, getCachedOwnUserId, getInteractionsMemory, getActivityLog } from './memory.ts';
import { fetchSourceTweets, distillSkillFromTweets, genSample, refineSkill } from './builder.ts';
import { listGeminiModels } from './gemini.ts';
import { getValidAccessToken } from './auth.ts';

async function getAllActiveAgents(env: Env): Promise<AgentDbRecord[]> {
  const { results } = await env.DB.prepare('SELECT * FROM agents WHERE status = "active"').all();
  if (!results) return [];
  return results.map(row => ({
    ...row,
    source_accounts: JSON.parse((row.source_accounts as string) || '[]'),
    vip_list: JSON.parse((row.vip_list as string) || '[]'),
    mem_whitelist: (row.mem_whitelist === 'all' ? 'all' : JSON.parse((row.mem_whitelist as string) || '[]'))
  })) as unknown as AgentDbRecord[];
}

async function runScheduled(cron: string | undefined, env: Env, ctx: ExecutionContext): Promise<void> {
  console.log(`[worker] Cron triggered globally: ${cron}`);

  const agents = await getAllActiveAgents(env);
    console.log(`[worker] Executing for ${agents.length} active agents.`);

    const now = new Date();
    const hours = now.getUTCHours();
    const mins = now.getUTCMinutes();

    const isHourly = mins === 0;
    const isSpontaneousTime = hours === 12 && mins === 30;
    const isMemoryTime = hours % 6 === 0 && mins === 0;
    const isNightlyEvo = hours === 3 && mins === 0;

    for (const agent of agents) {
      if (cron === '* * * * *' || !cron) {
        ctx.waitUntil((async () => {
          for (let i = 0; i < 4; i++) {
            const runStart = Date.now();
            await runMentionLoop(env, agent).catch(e => console.error(`[worker] mention loop error for ${agent.id}:`, e));
            const elapsed = Date.now() - runStart;
            const remaining = 15000 - elapsed;
            if (i < 3 && remaining > 0) {
              await new Promise(r => setTimeout(r, remaining));
            }
          }
        })());
      }
      
      if (isHourly || cron === '0 * * * *') {
        ctx.waitUntil(runTimelineEngagement(env, agent).catch(e => console.error(`[worker] timeline error for ${agent.id}:`, e)));
      }
      if (isSpontaneousTime || cron === '30 12 * * *') {
        ctx.waitUntil(runSpontaneousTweet(env, agent).catch(e => console.error(`[worker] spontaneous error for ${agent.id}:`, e)));
      }
      if (isMemoryTime || cron === '0 */6 * * *') {
        ctx.waitUntil(runMemoryRefresh(env, agent).catch(e => console.error(`[worker] memory refresh error for ${agent.id}:`, e)));
      }
      if (isNightlyEvo || cron === '0 3 * * *') {
        ctx.waitUntil(runNightlyEvolution(env, agent).catch(e => console.error(`[worker] nightly evolution error for ${agent.id}:`, e)));
      }
    }
  }

export default {
  // ── Cron Triggers ────────────────────────────────────────────────────────────
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    return runScheduled(controller.cron, env, ctx);
  },

  // ── HTTP Handler ──────────────────────────────────────────────────────────────
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const pathname = url.pathname.replace(/\/$/, '') || '/';

    // Fallback Ping Endpoint (if Cloudflare account hit max 5 crons limit)
    if (pathname === '/api/cron') {
      ctx.waitUntil(runScheduled('* * * * *', env, ctx));
      return new Response('Cron executed via HTTP trigger', { status: 200 });
    }

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        }
      });
    }

    const corsHeaders = { "Access-Control-Allow-Origin": "*" };
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

    // ── Wizard API Endpoints ───────────────────────────────────────────────────

    // Replaced /api/auth-check — dashboard now uses Twitter OAuth to verify ownership
    if (pathname === '/api/agent/verify-owner' && method === 'POST') {
      const body = await request.json() as any;
      const { accessToken, agentId } = body;
      if (!accessToken || !agentId) return json({ ok: false, error: 'Missing params' }, 400);
      // Fetch the authed user from Twitter
      const meRes = await fetch('https://api.twitter.com/2/users/me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const meData = await meRes.json() as any;
      if (!meRes.ok) return json({ ok: false, error: meData.detail ?? 'Twitter API error' }, 401);
      const username: string = meData.data?.username ?? '';
      // Fetch the agent from DB and compare handle
      const { results } = await env.DB.prepare('SELECT agent_handle FROM agents WHERE id = ?').bind(agentId).all();
      if (!results || results.length === 0) return json({ ok: false, error: 'Agent not found' }, 404);
      const agentHandle = (results[0] as any).agent_handle as string;
      const ok = username.toLowerCase() === agentHandle.toLowerCase();
      return json({ ok, username, agentHandle });
    }

    if (pathname === '/api/agent/verify-secret' && method === 'POST') {
      const body = await request.json() as any;
      const { agentId, secret } = body;
      if (!agentId || !secret) return json({ ok: false, error: 'Missing params' }, 400);
      const { results } = await env.DB.prepare('SELECT agent_secret FROM agents WHERE id = ?').bind(agentId).all();
      if (!results || results.length === 0) return json({ ok: false, error: 'Agent not found' }, 404);
      const dbSecret = (results[0] as any).agent_secret as string;
      const ok = (dbSecret && dbSecret === secret);
      return json({ ok });
    }

    if (pathname === '/api/oauth/start' && method === 'POST') {
      const sessionId = crypto.randomUUID();
      const codeVerifier = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''); // 64 chars
      
      const encoder = new TextEncoder();
      const data = encoder.encode(codeVerifier);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const codeChallenge = btoa(String.fromCharCode.apply(null, hashArray)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      
      const state = crypto.randomUUID().replace(/-/g, '');

      let reqBody: any = {};
      try { reqBody = await request.clone().json(); } catch(e) {}

      // env.LOCAL_ORIGIN is set in .dev.vars only — Wrangler dev rewrites request.url/Origin/Referer
      // to match the configured custom domain (jellyfishai.org), so we must use an env var or
      // the payload-supplied origin as the only tamper-proof escape hatches.
      const reqOrigin = env.LOCAL_ORIGIN || reqBody.currentOrigin || url.origin;

      const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', env.X_CLIENT_ID);
      const redirectUri = reqOrigin + '/callback';
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', 'tweet.read tweet.write users.read offline.access');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');

      const sessionData = { state, codeVerifier, redirectUri, status: 'pending' };
      await env.AGENT_STATE.put('oauth:' + sessionId, JSON.stringify(sessionData), { expirationTtl: 600 });
      await env.AGENT_STATE.put('oauth_state:' + state, sessionId, { expirationTtl: 600 });
      
      return json({ sessionId, authUrl: authUrl.toString() });
    }

    if (pathname === '/api/oauth/result' && method === 'GET') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) return json({ error: 'No sessionId' }, 400);
      const sessionRaw = await env.AGENT_STATE.get('oauth:' + sessionId);
      if (!sessionRaw) return json({ error: 'Session not found/expired' }, 404);
      const session = JSON.parse(sessionRaw);
      return json(session);
    }

    // OAuth Callback endpoint (Browser redirected here from X)
    if (pathname === '/callback' && method === 'GET') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      const renderAuthUI = (titleZh: string, titleEn: string, subZh: string, subEn: string, isError: boolean = false) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Auth</title><style>body{font-family:'Inter',system-ui,-apple-system;background:#09090b;color:#fafafa;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;overflow:hidden;position:relative}.blob{position:absolute;border-radius:50%;filter:blur(80px);z-index:-1;opacity:0.5}.b1{width:300px;height:300px;background:radial-gradient(circle,#c1939b 0%,transparent 70%);top:-50px;left:-50px}.b2{width:400px;height:400px;background:radial-gradient(circle,#ebb5b2 0%,transparent 70%);bottom:-100px;right:-100px}.c{background:rgba(24,24,27,0.6);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.08);border-radius:24px;padding:48px 32px;text-align:center;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);z-index:10;max-width:400px}h2{color:${isError ? '#ef4444' : '#c1939b'};margin-top:0;font-size:1.5rem}p{color:#a1a1aa;line-height:1.6}.close{font-size:13px;color:#71717a;margin-top:24px}.lang-en{display:none!important}.lang-zh{display:inline}body.en-mode .lang-zh{display:none!important}body.en-mode .lang-en{display:inline!important}</style></head><body><div class="blob b1"></div><div class="blob b2"></div><div class="c"><h2>${isError ? '❌' : '✅'} <span class="lang-zh">${titleZh}</span><span class="lang-en">${titleEn}</span></h2><p><span class="lang-zh">${subZh}</span><span class="lang-en">${subEn}</span></p><p class="close"><span class="lang-zh">这个页面可以安全退出了</span><span class="lang-en">You can safely close this page now.</span></p></div><script>if(localStorage.getItem('agentSettingsLang')==='en') document.body.classList.add('en-mode');</script></body></html>`;

      if (!state) return new Response(renderAuthUI('参数错误', 'Parameter Error', '缺少 state 参数。', 'Missing state parameter.', true), { status: 400, headers: {'Content-Type':'text/html; charset=utf-8'} });
      const sessionId = await env.AGENT_STATE.get('oauth_state:' + state);
      if (!sessionId) return new Response(renderAuthUI('授权过期', 'Auth Expired', 'Session 已失效，请回向导页重试。', 'Session expired, please retry from wizard.', true), { status: 400, headers: {'Content-Type':'text/html; charset=utf-8'} });
      
      const sessionRaw = await env.AGENT_STATE.get('oauth:' + sessionId);
      if (!sessionRaw) return new Response(renderAuthUI('授权过期', 'Auth Expired', 'Session 已失效，请回向导页重试。', 'Session expired, please retry from wizard.', true), { status: 400, headers: {'Content-Type':'text/html; charset=utf-8'} });
      const session = JSON.parse(sessionRaw);

      if (error) {
        session.status = 'error'; session.error = error;
        await env.AGENT_STATE.put('oauth:' + sessionId, JSON.stringify(session), { expirationTtl: 600 });
        return new Response(renderAuthUI('授权被拒', 'Auth Denied', '你已拒绝授权，请关闭此页。', 'You have denied authorization, you can close this page.', true), { headers: {'Content-Type':'text/html; charset=utf-8'} });
      }

      const creds = btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`);
      const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${creds}` },
        body: new URLSearchParams({
          code: code || '', grant_type: 'authorization_code', redirect_uri: session.redirectUri || url.origin + '/callback',
          code_verifier: session.codeVerifier, client_id: env.X_CLIENT_ID,
        }).toString(),
      });
      const data = await tokenRes.json() as any;
      if (!tokenRes.ok || !data.access_token) {
        session.status = 'error'; session.error = JSON.stringify(data);
        await env.AGENT_STATE.put('oauth:' + sessionId, JSON.stringify(session), { expirationTtl: 600 });
        return new Response(renderAuthUI('获取令牌失败', 'Token Error', '与 X API 交换凭据失败，请重试。', 'Failed to exchange token with X API.', true), { status: 500, headers: {'Content-Type':'text/html; charset=utf-8'} });
      }

      session.status = 'done';
      session.accessToken = data.access_token;
      session.refreshToken = data.refresh_token;

      // If this is a reauth for an existing agent, persist new tokens to DB immediately
      if (session.agentId && data.refresh_token) {
        await env.DB.prepare(
          'UPDATE agents SET refresh_token=?, access_token=null, token_expires_at=0 WHERE id=?'
        ).bind(data.refresh_token, session.agentId).run();
        console.log(`[oauth] Reauth tokens updated in DB for agent ${session.agentId}`);
      }

      await env.AGENT_STATE.put('oauth:' + sessionId, JSON.stringify(session), { expirationTtl: 600 });

      const successSub = session.agentId
        ? '授权已更新，新的 Refresh Token 现已生效。请关闭此页。'
        : '你的 X 账号已成功关联。请回到原部署向导页。';
      const successSubEn = session.agentId
        ? 'Authorization updated. New Refresh Token is now active. You can close this page.'
        : 'Your X account is successfully linked. Please return to the wizard.';
      return new Response(renderAuthUI('授权成功', 'Auth Successful', successSub, successSubEn), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // ── Reauth for existing agent ─────────────────────────────────────────────
    if (pathname === '/api/agent/reauth-start' && method === 'POST') {
      try {
        let reqBody: any = {};
        try { reqBody = await request.clone().json(); } catch(e) {}
        const reauthAgentId = url.searchParams.get('id') || reqBody.agentId;
        if (!reauthAgentId) return json({ error: 'Missing agentId' }, 400);

        const { results } = await env.DB.prepare('SELECT id FROM agents WHERE id = ?').bind(reauthAgentId).all();
        if (!results || results.length === 0) return json({ error: 'Agent not found' }, 404);

        const sessionId = crypto.randomUUID();
        const codeVerifier = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
        const encoder = new TextEncoder();
        const cvData = encoder.encode(codeVerifier);
        const hashBuffer = await crypto.subtle.digest('SHA-256', cvData);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const codeChallenge = btoa(String.fromCharCode.apply(null, hashArray)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const state = crypto.randomUUID().replace(/-/g, '');

        const reqOrigin = env.LOCAL_ORIGIN || reqBody.currentOrigin || url.origin;
        const redirectUri = reqOrigin + '/callback';

        const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', env.X_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', 'tweet.read tweet.write users.read offline.access');
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');

        const sessionData = { state, codeVerifier, redirectUri, agentId: reauthAgentId, status: 'pending' };
        await env.AGENT_STATE.put('oauth:' + sessionId, JSON.stringify(sessionData), { expirationTtl: 600 });
        await env.AGENT_STATE.put('oauth_state:' + state, sessionId, { expirationTtl: 600 });

        return json({ sessionId, authUrl: authUrl.toString() });
      } catch (err) { return json({ error: String(err) }, 500); }
    }

    if (pathname === '/api/oauth/refresh' && method === 'POST') {
      try {
        const reqJson = await request.json() as any;
        const refreshToken = reqJson.refreshToken;
        const creds = btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`);
        const resTok = await fetch('https://api.twitter.com/2/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${creds}` },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken || '', client_id: env.X_CLIENT_ID }).toString(),
        });
        const data = await resTok.json() as { access_token?: string; error?: string };
        if (!resTok.ok || !data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
        return json({ accessToken: data.access_token });
      } catch (err) { return json({ error: String(err) }, 400); }
    }

    if (pathname === '/api/me' && method === 'POST') {
      try {
        const reqJson = await request.json() as any;
        const res = await fetch('https://api.twitter.com/2/users/me', {
          headers: { Authorization: `Bearer ${reqJson.accessToken}` }
        });
        const data = await res.json() as any;
        if (!res.ok) throw new Error(data.detail || 'Failed to fetch user');
        return json(data.data);
      } catch (err) { return json({ error: String(err) }, 400); }
    }

    if (pathname === '/api/distill' && method === 'POST') {
      try {
        const reqJson = await request.json() as any;
        const { sourceAccounts, accessToken, promptLang } = reqJson;
        const geminiModel = env.GEMINI_MODEL || 'gemini-2.5-pro-preview-03-25';
        const gatewayConfig = { accountId: env.CF_ACCOUNT_ID, gateway: env.CF_GATEWAY_NAME, apiKey: env.CF_AIG_TOKEN };
        
        const tweetsByAccount = await fetchSourceTweets(sourceAccounts, accessToken);
        const accountCount = Object.keys(tweetsByAccount).length;
        if (accountCount === 0) return json({ error: 'No tweets fetched. Check accounts/token.' }, 400);
        
        const skill = await distillSkillFromTweets(tweetsByAccount, geminiModel, promptLang || 'zh', gatewayConfig);
        const fetched: Record<string, number> = {};
        for (const [k, v] of Object.entries(tweetsByAccount)) fetched[k] = v.length;
        return json({ skill, fetched });
      } catch (err) { return json({ error: String(err) }, 500); }
    }

    if (pathname === '/api/tune/sample' && method === 'POST') {
      try {
        const reqJson = await request.json() as any;
        const { skill } = reqJson;
        const geminiModel = env.GEMINI_MODEL || 'gemini-2.5-pro-preview-03-25';
        const gatewayConfig = { accountId: env.CF_ACCOUNT_ID, gateway: env.CF_GATEWAY_NAME, apiKey: env.CF_AIG_TOKEN };
        return json(await genSample(skill, geminiModel, gatewayConfig));
      } catch (err) { return json({ error: String(err) }, 500); }
    }

    if (pathname === '/api/tune/refine' && method === 'POST') {
      try {
        const reqJson = await request.json() as any;
        const { skill, feedback } = reqJson;
        const geminiModel = env.GEMINI_MODEL || 'gemini-2.5-pro-preview-03-25';
        const gatewayConfig = { accountId: env.CF_ACCOUNT_ID, gateway: env.CF_GATEWAY_NAME, apiKey: env.CF_AIG_TOKEN };
        return json({ skill: await refineSkill(skill, feedback, geminiModel, gatewayConfig) });
      } catch (err) { return json({ error: String(err) }, 500); }
    }

    if (pathname === '/api/models' && method === 'GET') {
      try {
        const models = await listGeminiModels();
        const filtered = models.filter(m => m.includes('gemini'));
        resSortModelsList(filtered);
        return json({ models: filtered });
      } catch (err) { return json({ error: String(err) }, 400); }
    }

    if (pathname === '/api/agent/create' && method === 'POST') {
      try {
        const reqJson = await request.json() as any;
        const config = reqJson.config;
        const skill = reqJson.skill;
        const refreshToken = reqJson.refreshToken;
        const geminiApiKey = env.GEMINI_API_KEY || reqJson.geminiApiKey || '';
        const dashboardSecret = reqJson.dashboardSecret || '';

        const vipList = config.vipList ?? [];
        const memWhitelist = config.memoryWhitelist ?? [];
        const handle = (config.agentHandle ?? '').trim().toLowerCase();

        // ── Upsert: if agent with same handle already exists, overwrite it ──
        let agentId = '';
        let isUpdate = false;

        if (handle) {
          const existing = await env.DB.prepare(
            'SELECT id FROM agents WHERE LOWER(agent_handle) = ? LIMIT 1'
          ).bind(handle).first<{ id: string }>();

          if (existing) {
            agentId = existing.id;
            isUpdate = true;
            await env.DB.prepare(`
              UPDATE agents SET
                agent_name = ?, agent_handle = ?,
                agent_secret = COALESCE(NULLIF(?, ''), agent_secret),
                source_accounts = ?, gemini_model = ?, gemini_api_key = ?,
                refresh_token = ?, access_token = null, token_expires_at = 0,
                skill_text = ?, reply_pct = ?, like_pct = ?,
                cooldown_days = ?, auto_evo = ?, vip_list = ?, mem_whitelist = ?,
                status = 'active'
              WHERE id = ?
            `).bind(
              config.agentName ?? '',
              config.agentHandle ?? '',
              dashboardSecret,              // NULLIF turns '' → NULL → COALESCE keeps existing
              JSON.stringify(config.sourceAccounts ?? []),
              config.geminiModel ?? 'gemini-2.5-pro',
              geminiApiKey,
              refreshToken ?? '',
              skill ?? '',
              config.defaultReplyProbability ?? 0.2,
              config.defaultLikeProbability ?? 0.8,
              config.spontaneousCooldownDays ?? 3,
              config.enableNightlyEvolution ? 1 : 0,
              JSON.stringify(vipList),
              memWhitelist === 'all' ? 'all' : JSON.stringify(memWhitelist),
              agentId,
            ).run();
          }
        }

        if (!isUpdate) {
          agentId = crypto.randomUUID();
          await env.DB.prepare(`
            INSERT INTO agents (
              id, owner_id, agent_name, agent_handle, agent_secret, source_accounts, gemini_model, gemini_api_key, 
              refresh_token, access_token, token_expires_at, skill_text, reply_pct, like_pct, 
              cooldown_days, auto_evo, vip_list, mem_whitelist, created_at, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, null, 0, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
          `).bind(
            agentId, 'public',
            config.agentName ?? '',
            config.agentHandle ?? '',
            dashboardSecret,
            JSON.stringify(config.sourceAccounts ?? []),
            config.geminiModel ?? 'gemini-2.5-pro',
            geminiApiKey,
            refreshToken ?? '',
            skill ?? '',
            config.defaultReplyProbability ?? 0.2,
            config.defaultLikeProbability ?? 0.8,
            config.spontaneousCooldownDays ?? 3,
            config.enableNightlyEvolution ? 1 : 0,
            JSON.stringify(vipList),
            memWhitelist === 'all' ? 'all' : JSON.stringify(memWhitelist),
            Date.now()
          ).run();
        }

        return json({ success: true, agentId, updated: isUpdate, redirect: `/dashboard?id=${agentId}` });
      } catch (err) { return json({ error: String(err) }, 500); }
    }

    // ── Find agent by Twitter handle (public, no auth required) ─────────────
    if (pathname === '/api/agent/find-by-handle' && method === 'GET') {
      const handle = (url.searchParams.get('handle') ?? '').replace(/^@/, '').trim().toLowerCase();
      if (!handle) return json({ error: 'handle required' }, 400);
      const { results } = await env.DB.prepare(
        'SELECT id, agent_name, agent_handle FROM agents WHERE LOWER(agent_handle)=? LIMIT 1'
      ).bind(handle).all();
      if (!results || results.length === 0) return json({ error: 'not_found' }, 404);
      const row = results[0] as any;
      return json({ agentId: row.id, name: row.agent_name, handle: row.agent_handle });
    }

    // ── Ko-Fi Webhook (POST /api/kofi-webhook) ────────────────────────────────
    // Ko-Fi sends form-encoded: data=<URL-encoded JSON>
    if (pathname === '/api/kofi-webhook' && method === 'POST') {
      try {
        const formText = await request.text();
        const params = new URLSearchParams(formText);
        const raw = params.get('data');
        if (!raw) return new Response('Missing data', { status: 400 });
        const data = JSON.parse(raw) as any;

        // Verify Ko-Fi token
        const expectedToken = env.KO_FI_VERIFICATION_TOKEN;
        if (expectedToken && data.verification_token !== expectedToken) {
          console.warn('[kofi] Invalid verification token');
          return new Response('Unauthorized', { status: 401 });
        }

        // Only process successful payments (not refunds/subscriptions cancellations)
        if (data.type !== 'Donation' && data.type !== 'Shop Order' && data.type !== 'Subscription') {
          return new Response('OK', { status: 200 });
        }

        // Generate license key: JLYF-XXXX-XXXX-XXXX
        const seg = () => Math.random().toString(36).slice(2, 6).toUpperCase();
        const licenseKey = `JLYF-${seg()}-${seg()}-${seg()}`;
        const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

        const licenseRecord = {
          key: licenseKey,
          email: data.email || '',
          kofi_name: data.from_name || '',
          amount: data.amount || '',
          expires_at: expiresAt,
          created_at: Date.now(),
          type: data.type,
        };

        // Store in KV: key → license record (TTL = 31 days)
        await env.AGENT_STATE.put(
          `license:${licenseKey}`,
          JSON.stringify(licenseRecord),
          { expirationTtl: 31 * 24 * 60 * 60 }
        );

        console.log(`[kofi] License generated for ${data.email}: ${licenseKey} (expires ${new Date(expiresAt).toISOString()})`);
        // Ko-Fi requires a 200 response otherwise it will retry
        return new Response('OK', { status: 200 });
      } catch (err) {
        console.error('[kofi] Webhook error:', err);
        return new Response('OK', { status: 200 }); // Always 200 to Ko-Fi
      }
    }

    // ── License Activation (POST /api/agent/activate-license) ─────────────────
    if (pathname === '/api/agent/activate-license' && method === 'POST') {
      try {
        const { agentId, key } = await request.json() as any;
        if (!agentId || !key) return json({ ok: false, error: 'Missing params' }, 400);

        const raw = await env.AGENT_STATE.get(`license:${key.trim().toUpperCase()}`);
        if (!raw) return json({ ok: false, error: '授权码无效或已过期 / Invalid or expired license key' }, 404);

        const license = JSON.parse(raw) as { expires_at: number; email: string };
        if (license.expires_at < Date.now()) {
          return json({ ok: false, error: '授权码已过期 / License key expired' }, 403);
        }

        // Write pro_expires_at to the agent record
        await env.DB.prepare('UPDATE agents SET pro_expires_at = ? WHERE id = ?')
          .bind(license.expires_at, agentId).run();

        console.log(`[license] Activated ${key} for agent ${agentId}, expires ${new Date(license.expires_at).toISOString()}`);
        return json({ ok: true, expires_at: license.expires_at });
      } catch (err) {
        return json({ ok: false, error: String(err) }, 500);
      }
    }

    // ── Admin Dashboard UI ────────────────────────────────────────────────────
    if (pathname === '/dashboard' && method === 'GET') {
      const agentId = url.searchParams.get('id');
      if (!agentId) return new Response('Missing agent ID', { status: 400 });

      // fetch agent metadata
      const { results } = await env.DB.prepare('SELECT * FROM agents WHERE id = ?').bind(agentId).all();
      if (!results || results.length === 0) return new Response('Agent not found', { status: 404 });

      const agent = results[0] as unknown as AgentDbRecord;
      const vipList = typeof agent.vip_list === 'string' ? JSON.parse(agent.vip_list) : agent.vip_list;

      // Safely resolve mem_whitelist
      const rawWl = (agent as any).mem_whitelist;
      const isMemWhitelistAll = rawWl === 'all';
      const memWhitelistArr: string[] = isMemWhitelistAll ? [] :
        Array.isArray(rawWl) ? rawWl :
        (() => { try { const p = JSON.parse(rawWl || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } })();

      const proExpiresAt: number = (agent as any).pro_expires_at || 0;
      const isProActive = proExpiresAt > Date.now();

      // Pro status HTML snippet
      const proStatusHtml = isProActive
        ? `<span style="color:#86efac">✅ Pro 已激活，有效至 <b>${new Date(proExpiresAt).toLocaleDateString('zh-CN')}</b></span>`
        : `<span style="color:var(--text-muted)">🔒 <span class="lang-zh">未激活 &middot; <a href="https://ko-fi.com/HomeCollider" target="_blank" style="color:#a78bfa">Ko-Fi 购买授权</a></span><span class="lang-en">Not activated &middot; <a href="https://ko-fi.com/HomeCollider" target="_blank" style="color:#a78bfa">Buy on Ko-Fi</a></span></span>`;

      // Helper: HTML-escape for safe textarea/attribute injection
      const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

      // Read the Astro-built dashboard HTML template from static assets
      const assetResp = await env.ASSETS.fetch(new Request(`${url.origin}/dashboard/index.html`));
      if (!assetResp.ok) return new Response('Dashboard template not found', { status: 500 });
      let html = await assetResp.text();

      // Inject server-side values into placeholder tokens
      html = html
        .replaceAll('__AGENT_ID__', agentId)
        .replaceAll('__AGENT_NAME__', esc(String(agent.agent_name ?? '')))
        .replaceAll('__REPLY_PCT__', String(agent.reply_pct ?? 0.5))
        .replaceAll('__LIKE_PCT__', String(agent.like_pct ?? 0.5))
        .replaceAll('__SKILL_TEXT__', esc(String(agent.skill_text ?? '')))
        .replaceAll('__PRO_EXPIRES_AT__', String(proExpiresAt))
        .replaceAll('__PRO_STATUS_HTML__', proStatusHtml)
        .replaceAll('__VIP_LIST_JSON__', JSON.stringify(vipList))
        .replaceAll('__WL_ALL_CHECKED__', isMemWhitelistAll ? 'checked' : '')
        .replaceAll('__WL_SPECIFIC_CHECKED__', !isMemWhitelistAll ? 'checked' : '')
        .replaceAll('__WL_ACCOUNTS_DISPLAY__', !isMemWhitelistAll ? '' : 'display:none')
        .replaceAll('__WL_ACCOUNTS__', memWhitelistArr.join(', '));

      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }


    // ── KV-only read endpoints (no DB agent lookup required) ─────────────────
    if (pathname === '/api/agent/activity' || pathname === '/api/agent/memory') {
      const agentId = url.searchParams.get('id');
      if (!agentId) return json({ error: 'Missing agent ID' }, 400);
      if (pathname === '/api/agent/activity') return json(await getActivityLog(env, agentId));
      return json(await getInteractionsMemory(env, agentId));
    }

    // ── Individual Agent Admin Actions ─────────────────────────────────────────
    if (pathname.startsWith('/api/agent/')) {
      const agentId = url.searchParams.get('id');
      if (!agentId) return json({ error: 'Missing agent ID' }, 400);

      const agentRaw = await env.DB.prepare('SELECT * FROM agents WHERE id = ?').bind(agentId).all();
      if (!agentRaw.results || agentRaw.results.length === 0) return json({ error: 'Agent not found' }, 404);
      const row = agentRaw.results[0] as Record<string, unknown>;
      const agent: AgentDbRecord = {
        ...row,
        source_accounts: JSON.parse((row.source_accounts as string) || '[]'),
        vip_list: JSON.parse((row.vip_list as string) || '[]'),
        mem_whitelist: (row.mem_whitelist === 'all' ? 'all' : JSON.parse((row.mem_whitelist as string) || '[]'))
      } as unknown as AgentDbRecord;

      if (pathname === '/api/agent/status') {
        const lastMentionId = await getLastMentionId(env, agentId);
        return json({ agentName: agent.agent_name, lastMentionId, autoEvo: agent.auto_evo });
      }
      if (pathname === '/api/agent/refresh-memory') {
        try { return json({ ok: true, ...(await runMemoryRefresh(env, agent)) }); } catch (err) { return json({ ok: false, error: String(err) }, 500); }
      }
      if (pathname === '/api/agent/evolve') {
        try { return json({ ok: true, ...(await runNightlyEvolution(env, agent)) }); } catch (err) { return json({ ok: false, error: String(err) }, 500); }
      }
      if (pathname === '/api/agent/trigger') {
        try { return json({ ok: true, ...(await runMentionLoop(env, agent)) }); } catch (err) { return json({ ok: false, error: String(err) }, 500); }
      }
      if (pathname === '/api/agent/trigger-timeline') {
        try { return json({ ok: true, ...(await runTimelineEngagement(env, agent)) }); } catch (err) { return json({ ok: false, error: String(err) }, 500); }
      }
      if (pathname === '/api/agent/spontaneous') {
        const force = url.searchParams.get('force') === 'true';
        try { return json({ ok: true, ...(await runSpontaneousTweet(env, agent, force)) }); } catch (err) { return json({ ok: false, error: String(err) }, 500); }
      }
      if (pathname === '/api/agent/update-config' && method === 'POST') {
        try {
          const body = await request.json() as any;
          const replyPct = parseFloat(body.reply_pct);
          const likePct  = parseFloat(body.like_pct);
          const cooldown = parseFloat(body.cooldown_days);
          if ([replyPct, likePct, cooldown].some(v => isNaN(v))) return json({ error: 'Invalid values' }, 400);
          await env.DB.prepare('UPDATE agents SET reply_pct=?, like_pct=?, cooldown_days=? WHERE id=?')
            .bind(replyPct, likePct, cooldown, agentId).run();
          return json({ ok: true });
        } catch (err) { return json({ ok: false, error: String(err) }, 500); }
      }
      if (pathname === '/api/agent/update-skill' && method === 'POST') {
        try {
          const body = await request.json() as any;
          const skill = (body.skill ?? '').trim();
          if (!skill) return json({ error: 'Skill text is empty' }, 400);
          await env.DB.prepare('UPDATE agents SET skill_text=? WHERE id=?').bind(skill, agentId).run();
          return json({ ok: true });
        } catch (err) { return json({ ok: false, error: String(err) }, 500); }
      }
      if (pathname === '/api/agent/update-secret' && method === 'POST') {
        try {
          const body = await request.json() as any;
          const secret = (body.secret ?? '').trim();
          if (!secret) return json({ error: 'Secret is empty' }, 400);
          await env.DB.prepare('UPDATE agents SET agent_secret=? WHERE id=?').bind(secret, agentId).run();
          return json({ ok: true });
        } catch (err) { return json({ ok: false, error: String(err) }, 500); }
      }
      if (pathname === '/api/agent/twitter-identity') {
        try {
          const accessToken = await getValidAccessToken(env, agent);
          const meRes = await fetch('https://api.twitter.com/2/users/me', {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          if (!meRes.ok) throw new Error(`Twitter API ${meRes.status}: ${await meRes.text()}`);
          const meData = await meRes.json() as any;
          const twitterName: string = meData.data?.name ?? '';
          const twitterHandle: string = meData.data?.username ?? '';
          if (twitterName || twitterHandle) {
            await env.DB.prepare('UPDATE agents SET agent_name=?, agent_handle=? WHERE id=?')
              .bind(twitterName, twitterHandle, agentId).run();
          }
          return json({ name: twitterName, username: twitterHandle });
        } catch (err) { return json({ error: String(err) }, 500); }
      }
      if (pathname === '/api/agent/update-whitelist' && method === 'POST') {
        try {
          const body = await request.json() as any;
          const wl = body.whitelist;
          if (wl !== 'all' && !Array.isArray(wl)) return json({ error: 'whitelist must be "all" or an array' }, 400);
          const stored = wl === 'all' ? 'all' : JSON.stringify((wl as string[]).map((h: string) => h.replace(/^@/, '').trim()).filter(Boolean));
          await env.DB.prepare('UPDATE agents SET mem_whitelist=? WHERE id=?').bind(stored, agentId).run();
          return json({ ok: true });
        } catch (err) { return json({ ok: false, error: String(err) }, 500); }
      }
      if (pathname === '/api/agent/update-vip' && method === 'POST') {
        try {
          const body = await request.json() as any;
          if (!Array.isArray(body.vip_list)) return json({ error: 'vip_list must be an array' }, 400);
          await env.DB.prepare('UPDATE agents SET vip_list=? WHERE id=?').bind(JSON.stringify(body.vip_list), agentId).run();
          return json({ ok: true });
        } catch (err) { return json({ ok: false, error: String(err) }, 500); }
      }
      return json({ error: 'Unknown agent action' }, 404);
    }

    // Undefined route
    return json({ error: 'Not found' }, 404);
  },
} satisfies ExportedHandler<Env>;

function resSortModelsList(models: string[]) {
  models.sort((a, b) => {
    // Put 2.5 > 2.0 > 1.5; pro > flash > nano
    const rank = (s: string) =>
      (s.includes('2.5') ? 300 : s.includes('2.0') ? 200 : s.includes('1.5') ? 100 : 0) +
      (s.includes('pro') ? 30 : s.includes('flash') ? 20 : s.includes('nano') ? 10 : 0);
    return rank(b) - rank(a);
  });
}
