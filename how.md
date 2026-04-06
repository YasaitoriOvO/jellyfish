# 1. Run the wizard

pnpm wizard

# 2. In packages/worker/ — create KV namespace and get the ID

cd packages/worker
npx wrangler kv namespace create AGENT_STATE

# Paste the ID into wrangler.toml

# 3. Seed initial persona.skill

npx wrangler kv key put --binding=AGENT_STATE agent:skill "$(cat generated/persona.skill)"

# 4. Set secrets & deploy

npx wrangler secret put X_CLIENT_ID && \
npx wrangler secret put X_CLIENT_SECRET && \
npx wrangler secret put X_REFRESH_TOKEN && \
npx wrangler secret put GEMINI_API_KEY && \
npx wrangler secret put ADMIN_SECRET
npx wrangler deploy
