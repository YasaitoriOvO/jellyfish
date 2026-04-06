/**
 * Module 1 — Distill
 * Collects API keys, runs OAuth 2.0 PKCE to obtain X credentials,
 * fetches source account tweets, and distills a persona.skill via Gemini.
 */
import * as p from '@clack/prompts';
import pc from 'picocolors';
import http from 'http';
import crypto from 'crypto';
import { exec } from 'child_process';
import { GoogleGenAI } from '@google/genai';

const X_API_BASE = 'https://api.twitter.com/2';
const REDIRECT_URI = 'http://localhost:3000/callback';
const OAUTH_PORT = 3000;

// ─── X API helpers ─────────────────────────────────────────────────────────────

async function xGet(path: string, accessToken: string): Promise<unknown> {
  const res = await fetch(`${X_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X API ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

async function getUserByUsername(
  username: string,
  accessToken: string,
): Promise<{ id: string; name: string; username: string } | null> {
  try {
    const json = await xGet(`/users/by/username/${username}`, accessToken) as
      { data?: { id: string; name: string; username: string } };
    return json.data ?? null;
  } catch {
    return null;
  }
}

async function getUserTweets(
  userId: string,
  accessToken: string,
  maxResults = 50,
): Promise<{ id: string; text: string }[]> {
  try {
    const params = new URLSearchParams({
      max_results: String(Math.min(maxResults, 100)),
      'tweet.fields': 'text,created_at',
      exclude: 'retweets,replies',
    });
    const json = await xGet(`/users/${userId}/tweets?${params}`, accessToken) as
      { data?: { id: string; text: string }[] };
    return json.data ?? [];
  } catch {
    return [];
  }
}

// ─── OAuth 2.0 PKCE flow ───────────────────────────────────────────────────────

interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
}

function openBrowser(url: string): void {
  const opener =
    process.platform === 'darwin' ? 'open' :
    process.platform === 'win32'  ? 'start' : 'xdg-open';
  exec(`${opener} "${url}"`);
}

async function runPKCEFlow(clientId: string, clientSecret: string): Promise<OAuthTokens> {
  // Generate PKCE challenge
  const codeVerifier  = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state         = crypto.randomBytes(16).toString('hex');

  // Build authorization URL
  const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', 'tweet.read tweet.write users.read offline.access');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  p.log.message('');
  p.log.message(pc.bold('🔗  正在浏览器中打开 X 授权页面……'));
  p.log.message(pc.dim('   如果浏览器未自动打开，请手动访问：'));
  p.log.message('   ' + pc.cyan(authUrl.toString()));
  p.log.message('');

  openBrowser(authUrl.toString());

  // Wait for OAuth callback on localhost:3000
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${OAUTH_PORT}`);

      if (url.pathname !== '/callback') {
        res.writeHead(404); res.end(); return;
      }

      const code          = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error         = url.searchParams.get('error');

      if (error) {
        res.writeHead(400); res.end('Authorization denied.');
        server.close();
        reject(new Error(`X OAuth denied: ${error} — ${url.searchParams.get('error_description') ?? ''}`));
        return;
      }

      if (returnedState !== state) {
        res.writeHead(400); res.end('State mismatch.');
        server.close();
        reject(new Error('OAuth state mismatch — possible CSRF'));
        return;
      }

      if (!code) {
        res.writeHead(400); res.end('No code in callback.');
        server.close();
        reject(new Error('No authorization code received'));
        return;
      }

      // Exchange code for tokens
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

      const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          code,
          grant_type:    'authorization_code',
          redirect_uri:  REDIRECT_URI,
          code_verifier: codeVerifier,
          client_id:     clientId,
        }).toString(),
      });

      const data = await tokenRes.json() as {
        access_token?: string;
        refresh_token?: string;
        error?: string;
        error_description?: string;
      };

      if (!tokenRes.ok || !data.access_token) {
        res.writeHead(500); res.end('Token exchange failed — check terminal.');
        server.close();
        reject(new Error(`Token exchange failed: ${JSON.stringify(data)}`));
        return;
      }

      // Send success page to browser
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>授权成功</title>
<style>body{font-family:system-ui,sans-serif;padding:48px;max-width:560px;margin:auto}
h2{color:#16a34a}</style></head>
<body>
  <h2>✅ 授权成功！</h2>
  <p>请回到终端继续操作。这个页面可以关闭了。</p>
</body></html>`);

      server.close();
      resolve({
        accessToken:  data.access_token,
        refreshToken: data.refresh_token ?? '',
      });
    });

    server.on('error', (err) => reject(err));

    server.listen(OAUTH_PORT, () => {
      p.log.message(pc.dim(`   📡  本地回调服务已启动：http://localhost:${OAUTH_PORT}/callback`));
      p.log.message(pc.dim('   ⏳  等待授权回调中……'));
    });
  });
}

// ─── Gemini distillation ───────────────────────────────────────────────────────

async function distillSkillFromTweets(
  tweetsByAccount: Map<string, string[]>,
  geminiApiKey: string,
  geminiModel: string,
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: geminiApiKey });

  const tweetBlocks = Array.from(tweetsByAccount.entries())
    .map(([user, tweets]) =>
      `### @${user}\n${tweets.map((t, i) => `${i + 1}. ${t}`).join('\n')}`,
    )
    .join('\n\n');

  const prompt = `You are a persona extraction engine. Analyze the following collection of tweets from one or more X (Twitter) accounts and synthesize their combined personality into a structured Markdown persona profile.

Output ONLY the Markdown document — no preamble, no explanation.

The document must contain the following sections:
- **Background**: Who this person is, their identity, social context, what they care about.
- **Core Traits**: Personality characteristics (3–6 bullet points).
- **Ideological Framework**: Their beliefs, values, social stances, things they defend or oppose.
- **Tone & Voice**: How they speak — vocabulary, sentence patterns, recurring phrases, emotional register, and any unique linguistic quirks (e.g. language code-switching, punctuation habits).
- **Constraints**: Behavioral rules for the AI (e.g. reply length limits, avoid hashtags, when to skip reply).

---

Here are the source tweets:

${tweetBlocks}

---

Generate the persona.skill Markdown document now:`;

  const response = await ai.models.generateContent({
    model: geminiModel.trim(),
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { maxOutputTokens: 4000, temperature: 0.4 },
  });

  const text = response.text?.trim();
  if (!text) throw new Error('Gemini returned empty response during distillation');
  return text;
}

// ─── Main export ───────────────────────────────────────────────────────────────

export interface DistillResult {
  draftSkill: string;
  sourceAccounts: string[];
  geminiApiKey: string;
  geminiModel: string;
  xClientId: string;
  xClientSecret: string;
  accessToken: string;
  refreshToken: string;
  agentName: string;
  agentHandle: string;
}

export async function distillPersona(): Promise<DistillResult> {
  // ── Gemini API key ────────────────────────────────────────────────────────
  const geminiApiKey = await p.password({
    message: 'Enter your Gemini API Key:',
    validate: (v: string | undefined) =>
      v == null || v.trim().length === 0 ? 'Required' : undefined,
  }) as string;
  if (p.isCancel(geminiApiKey)) process.exit(0);

  const geminiModel = await p.text({
    message: 'Gemini 模型名称：',
    placeholder: 'gemini-2.5-pro',
    defaultValue: 'gemini-2.5-pro',
    validate: (v: string | undefined) =>
      v == null || v.trim().length === 0 ? 'Required' : undefined,
  }) as string;
  if (p.isCancel(geminiModel)) process.exit(0);

  // ── X App credentials ─────────────────────────────────────────────────────
  p.log.message('');
  p.log.message(pc.bold('🐦  X (Twitter) App 授权'));
  p.log.message(pc.dim('   需要你的 X App Client ID 和 Client Secret。'));
  p.log.message(pc.dim('   请前往 https://developer.twitter.com → 你的 App → "Keys and Tokens"'));

  const xClientId = await p.text({
    message: 'X App Client ID:',
    validate: (v: string | undefined) =>
      v == null || v.trim().length === 0 ? 'Required' : undefined,
  }) as string;
  if (p.isCancel(xClientId)) process.exit(0);

  const xClientSecret = await p.password({
    message: 'X App Client Secret:',
    validate: (v: string | undefined) =>
      v == null || v.trim().length === 0 ? 'Required' : undefined,
  }) as string;
  if (p.isCancel(xClientSecret)) process.exit(0);

  // ── Agent identity ────────────────────────────────────────────────────────
  p.log.message('');
  const agentName = await p.text({
    message: "Agent 的展示名称是什么？",
    placeholder: 'e.g. Rebma',
    validate: (v: string | undefined) =>
      v == null || v.trim().length === 0 ? 'Required' : undefined,
  }) as string;
  if (p.isCancel(agentName)) process.exit(0);

  const agentHandle = await p.text({
    message: 'Agent X 账号的 @handle（不含 @）：',
    placeholder: 'e.g. amber_digit',
    validate: (v: string | undefined) =>
      v == null || v.trim().length === 0 ? 'Required' : undefined,
  }) as string;
  if (p.isCancel(agentHandle)) process.exit(0);

  // ── Source accounts ───────────────────────────────────────────────────────
  const sourceInput = await p.text({
    message: '要蒸馏人格的源账号（逗号分隔，不含 @）：',
    placeholder: 'e.g. amber_medusozoa, amber_toffee',
    validate: (v: string | undefined) =>
      v == null || v.trim().length === 0 ? '请至少输入一个账号' : undefined,
  }) as string;
  if (p.isCancel(sourceInput)) process.exit(0);

  const sourceAccounts = (sourceInput as string)
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

  // ── OAuth 2.0 PKCE ────────────────────────────────────────────────────────
  p.log.message('');
  p.log.message(pc.bold('🔐  OAuth 2.0 授权（PKCE 流程）'));
  p.log.message(pc.dim('   即将用浏览器打开 X 授权页面，请用 Agent 的 X 账号登录并授权。'));
  p.log.message(pc.dim(`   确保你的 X App 在 Developer Portal 中添加了回调 URL：`));
  p.log.message(pc.dim(`   http://localhost:${OAUTH_PORT}/callback`));

  let oauthTokens: OAuthTokens;
  const oauthSpinner = p.spinner();
  oauthSpinner.start('Initiating OAuth 2.0 PKCE flow...');
  try {
    oauthTokens = await runPKCEFlow(xClientId as string, xClientSecret as string);
  } catch (err) {
    oauthSpinner.stop(pc.red('OAuth 授权失败'));
    p.log.error(String(err));
    process.exit(1);
  }
  oauthSpinner.stop(pc.green('✅  授权成功！Access token 和 Refresh token 已获取'));

  p.log.message('');
  p.log.message(pc.dim('   Refresh Token（已自动写入 .dev.vars）：'));
  p.log.message(pc.dim('   ' + oauthTokens.refreshToken.slice(0, 20) + '…'));

  // ── Fetch source tweets using the new access token ────────────────────────
  const spinner = p.spinner();
  spinner.start(`正在抓取 ${sourceAccounts.length} 个账号的推文...`);

  const tweetsByAccount = new Map<string, string[]>();
  const resolvedAccounts: string[] = [];

  for (const username of sourceAccounts) {
    const user = await getUserByUsername(username, oauthTokens.accessToken);
    if (!user) {
      p.log.warn(`找不到 @${username} — 跳过`);
      continue;
    }
    const tweets = await getUserTweets(user.id, oauthTokens.accessToken, 50);
    if (tweets.length === 0) {
      p.log.warn(`@${username} 没有可用的公开推文 — 跳过`);
      continue;
    }
    tweetsByAccount.set(username, tweets.map(t => t.text));
    resolvedAccounts.push(username);
    spinner.message(`已抓取 @${username} 的 ${tweets.length} 条推文`);
  }

  if (tweetsByAccount.size === 0) {
    spinner.stop('没有抓取到任何推文');
    p.log.error('请检查 X 账号用户名或 Access Token 权限。');
    process.exit(1);
  }

  const totalTweets = Array.from(tweetsByAccount.values()).flat().length;
  spinner.message(`正在用 Gemini 蒸馏来自 ${resolvedAccounts.length} 个账号的 ${totalTweets} 条推文...`);

  const draftSkill = await distillSkillFromTweets(tweetsByAccount, geminiApiKey as string, (geminiModel as string).trim());


  spinner.stop(`✓ 人格蒸馏完成，来源：${resolvedAccounts.map(u => '@' + u).join(', ')}`);

  p.log.message('');
  p.log.message(pc.bold(pc.cyan('── Draft Skill 预览（前 600 字符）───────────────────────────────')));
  p.log.message(pc.dim(draftSkill.slice(0, 600) + (draftSkill.length > 600 ? '\n...' : '')));
  p.log.message(pc.bold(pc.cyan('────────────────────────────────────────────────────────────────────')));

  return {
    draftSkill,
    sourceAccounts: resolvedAccounts,
    geminiApiKey: geminiApiKey as string,
    geminiModel: (geminiModel as string).trim(),
    xClientId: xClientId as string,
    xClientSecret: xClientSecret as string,
    accessToken: oauthTokens.accessToken,
    refreshToken: oauthTokens.refreshToken,
    agentName: agentName as string,
    agentHandle: agentHandle as string,
  };
}
