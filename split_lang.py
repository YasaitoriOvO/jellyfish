import re

with open("packages/dashboard/src/pages/index.astro", "r", encoding="utf-8") as f:
    text = f.read()

replacements = {
    "🌟 欢迎 / Welcome": "<span class='lang-zh'>🌟 欢迎</span><span class='lang-en'>🌟 Welcome</span>",
    "请选择您要进行的操作 / Please select an operation": "<span class='lang-zh'>请选择您要进行的操作</span><span class='lang-en'>Please select an operation</span>",
    "🤖 创建并部署全功能 Agent<br><span style=\"font-size:0.8rem; opacity:0.8; font-weight:normal; margin-top:8px; display:inline-block;\">完整定型、配置概率并激活后台巡逻进程<br>Deploy active agent to background daemon</span>": "<span class='lang-zh block-lang'>🤖 创建并部署全功能 Agent<br><span style='font-size:0.8rem; opacity:0.8; font-weight:normal; margin-top:8px; display:block;'>完整定型、配置概率并激活后台巡逻进程</span></span><span class='lang-en block-lang'>🤖 Create & Deploy Agent<br><span style='font-size:0.8rem; opacity:0.8; font-weight:normal; margin-top:8px; display:block;'>Deploy active agent to background daemon</span></span>",
    "🔍 仅体验账号推文人格蒸馏<br><span style=\"font-size:0.8rem; opacity:0.8; font-weight:normal; margin-top:8px; display:inline-block;\">免部署精简体验，提取任何人格化 Prompt<br>Distill persona system prompt only without deploying</span>": "<span class='lang-zh block-lang'>🔍 仅体验账号推文人格蒸馏<br><span style='font-size:0.8rem; opacity:0.8; font-weight:normal; margin-top:8px; display:block;'>免部署精简体验，提取任何人格化 Prompt</span></span><span class='lang-en block-lang'>🔍 Distill Persona Only<br><span style='font-size:0.8rem; opacity:0.8; font-weight:normal; margin-top:8px; display:block;'>Distill persona system prompt only without deploying</span></span>",

    "<h2>🔐 X 账号授权 <span style='font-size:0.7em;color:var(--text-muted)'>/ X Auth</span></h2>": "<h2><span class='lang-zh'>🔐 X 账号授权</span><span class='lang-en'>🔐 X Account Auth</span></h2>",
    "授权 Agent 的 X 账号，获取 Refresh Token. / Authorize Agent's X account to get Refresh Token.": "<span class='lang-zh'>授权 Agent 的 X 账号，获取 Refresh Token。</span><span class='lang-en'>Authorize Agent's X account to get Refresh Token.</span>",
    "方式一：浏览器授权（推荐） / Browser Auth (Recommended)": "<span class='lang-zh'>方式一：浏览器授权（推荐）</span><span class='lang-en'>Method 1: Browser Auth (Recommended)</span>",
    "确保 X App 的回调 URL 包含 (callback URL includes): ": "<span class='lang-zh'>确保 X App 的回调 URL 包含：</span><span class='lang-en'>Ensure X App callback URL includes: </span>",
    "�� 打开授权页面 / Open Auth Page": "<span class='lang-zh'>🔗 打开授权页面</span><span class='lang-en'>🔗 Open Auth Page</span>",
    "等待授权回调中…… / Waiting for callback...": "<span class='lang-zh'>等待授权回调中……</span><span class='lang-en'>Waiting for callback...</span>",
    "✅ 授权成功！Refresh Token 已获取。 / Auth Successful! Refresh Token obtained.": "<span class='lang-zh'>✅ 授权成功！Refresh Token 已获取。</span><span class='lang-en'>✅ Auth Successful! Refresh Token obtained.</span>",
    "方式二：跳过 — 已有 Refresh Token / Skip — Already have Refresh Token": "<span class='lang-zh'>方式二：跳过 — 已有 Refresh Token</span><span class='lang-en'>Method 2: Skip — Already have Refresh Token</span>",
    "✓ 使用此 Token / Use this Token": "<span class='lang-zh'>✓ 使用此 Token</span><span class='lang-en'>✓ Use this Token</span>",
    "✅ 已使用手动输入的 Token。 / Manual Token applied.": "<span class='lang-zh'>✅ 已使用手动输入的 Token。</span><span class='lang-en'>✅ Manual Token applied.</span>",
    "← 返回 / Back": "<span class='lang-zh'>← 返回</span><span class='lang-en'>← Back</span>",
    "下一步 → / Next": "<span class='lang-zh'>下一步 →</span><span class='lang-en'>Next →</span>",
    
    "placeholder=\"粘贴已有的 refresh_token\"": "data-ph-zh=\"粘贴已有的 refresh_token\" data-ph-en=\"Paste existing refresh_token\" placeholder=\"粘贴已有的 refresh_token\"",

    "<h2>⚡ Gemini 配置 <span style='font-size:0.7em;color:var(--text-muted)'>/ Gemini Config</span></h2>": "<h2><span class='lang-zh'>⚡ Gemini 配置</span><span class='lang-en'>⚡ Gemini Config</span></h2>",
    "输入你的 Gemini API Key 和模型名称。 / Enter your Gemini API Key and Model Name.": "<span class='lang-zh'>输入你的 Gemini API Key 和模型名称。</span><span class='lang-en'>Enter your Gemini API Key and Model Name.</span>",
    "<label>模型名称 / Model Name</label>": "<label><span class='lang-zh'>模型名称</span><span class='lang-en'>Model Name</span></label>",
    "👉 请点右侧拉取列表 或 选择下方填入 / Click right to fetch or select below": "<span class='lang-zh'>👉 请点右侧拉取列表 或 选择下方填入</span><span class='lang-en'>👉 Click right to fetch or select below</span>",
    "✍️ 手动输入... / Manual input...": "<span class='lang-zh'>✍️ 手动输入...</span><span class='lang-en'>✍️ Manual input...</span>",
    "placeholder=\"填入具体的模型名... / Enter specific model name...\"": "data-ph-zh=\"填入具体的模型名...\" data-ph-en=\"Enter specific model name...\" placeholder=\"填入具体的模型名...\"",
    "点此拉取列表 / Fetch List": "<span class='lang-zh'>点此拉取列表</span><span class='lang-en'>Fetch List</span>",
    "填入 API Key 后点击按钮即可拉取该 Key 支持的所有可用模型。 / Enter API Key and click to fetch all available models.": "<span class='lang-zh'>填入 API Key 后点击按钮即可拉取该 Key 支持的所有可用模型。</span><span class='lang-en'>Enter API Key and click to fetch all available models.</span>",
    
    "<h2>🎭 Agent 身份</h2>": "<h2><span class='lang-zh'>🎭 Agent 身份</span><span class='lang-en'>🎭 Agent Identity</span></h2>",
    "核心身份信息已与您的授权 X 账号强绑定。 / Agent core identity is securely bound.": "<span class='lang-zh'>核心身份信息已与您的授权 X 账号强绑定。</span><span class='lang-en'>Agent core identity is securely bound.</span>",
    "<label>展示名称 / Display Name</label>": "<label><span class='lang-zh'>展示名称</span><span class='lang-en'>Display Name</span></label>",
    "授权账号昵称 / Auth Account Name: ": "<span class='lang-zh'>授权账号昵称: </span><span class='lang-en'>Auth Account Name: </span>",
    "（正在获取... / fetching...）": "<span class='lang-zh'>（正在获取...）</span><span class='lang-en'>(fetching...)</span>",
    "placeholder=\"自动从您的身份提供者中读取 / Auto read from identity provider\"": "data-ph-zh=\"自动从您的身份提供者中读取\" data-ph-en=\"Auto read from identity provider\" placeholder=\"自动从您的身份提供者中读取\"",
    "X @handle（不含 @ / without @）": "<span class='lang-zh'>X @handle（不含 @）</span><span class='lang-en'>X @handle (without @)</span>",
    "授权账号短柄 / Auth Account Handle: ": "<span class='lang-zh'>授权账号短柄: </span><span class='lang-en'>Auth Account Handle: </span>",
    "源账号（逗号分隔，不含 @ / comma separated, no @ / without @）": "<span class='lang-zh'>源账号（逗号分隔，不含 @）</span><span class='lang-en'>Source Accounts (comma separated, no @)</span>",
    "placeholder=\"例 / Example: amber_medusozoa, elonmusk\"": "data-ph-zh=\"例: amber_medusozoa, elonmusk\" data-ph-en=\"Example: amber_medusozoa, elonmusk\" placeholder=\"例: amber_medusozoa, elonmusk\"",
    "将抓取这些账号的推文用于人格蒸馏。 / Will fetch tweets from these accounts for persona distillation.": "<span class='lang-zh'>将抓取这些账号的推文用于人格蒸馏。</span><span class='lang-en'>Will fetch tweets from these accounts for persona distillation.</span>",
    "<h2>🎯 目标源账号 <span style=\"font-size:0.7em;color:var(--text-muted)\">/ Target Auth</span></h2>": "<h2><span class='lang-zh'>🎯 目标源账号</span><span class='lang-en'>🎯 Target Source Accounts</span></h2>",
    "在此输入需要拉取推文进行蒸馏分析的源账号。 / Enter the source accounts to pull and distill.": "<span class='lang-zh'>在此输入需要拉取推文进行蒸馏分析的源账号。</span><span class='lang-en'>Enter the source accounts to pull and distill.</span>",

    "<h2>🧪 人格蒸馏 <span style='font-size:0.7em;color:var(--text-muted)'>/ Distillation</span></h2>": "<h2><span class='lang-zh'>🧪 人格蒸馏</span><span class='lang-en'>🧪 Persona Distillation</span></h2>",
    "拉取推文，利用 LLM 配置生成 system prompt。 / Fetch tweets and generate system prompt.": "<span class='lang-zh'>拉取推文，利用 LLM 配置生成 system prompt。</span><span class='lang-en'>Fetch tweets and generate system prompt.</span>",
    "点击开始蒸馏后，后台将拉取最多一百条最近推文，并提取出此人的行文风格。 / Will extract writing style from recent tweets.": "<span class='lang-zh'>点击开始蒸馏后，后台将拉取最多一百条最近推文，并提取出此人的行文风格。</span><span class='lang-en'>Will fetch up to 100 recent tweets and extract writing style.</span>",
    "<label>配置生成语言 (Output Language)</label>": "<label><span class='lang-zh'>配置生成语言</span><span class='lang-en'>Output Language</span></label>",
    "💡 强烈建议生成 <b>中文</b> 提示词。同等人格配置下，高度凝练的中文能为您日常运行 Agent 省下极可观的 System Prompt Token 费率！ / Highly recommend generating Chinese prompt to save costs!": "<span class='lang-zh'>💡 强烈建议生成 <b>中文</b> 提示词。同等人格配置下，高度凝练的中文能为您日常运行 Agent 省下极可观的 System Prompt Token 费率！</span><span class='lang-en'>💡 Highly recommend choosing <b>Chinese</b>. Highly condensed Chinese persona strings will save you tremendous Tokens!</span>",
    "🚀 开始一键蒸馏 / Start Distillation": "<span class='lang-zh'>🚀 开始一键蒸馏</span><span class='lang-en'>🚀 Start Distillation</span>",
    "正在疯狂蒸馏中（约需 10-30 秒）…… / Distilling (takes 10-30s)...": "<span class='lang-zh'>正在疯狂蒸馏中（约需 10-30 秒）……</span><span class='lang-en'>Distilling (takes 10-30s)...</span>",
    "<label>人格配置输出 / System Prompt Output</label>": "<label><span class='lang-zh'>人格配置输出 (System Prompt)</span><span class='lang-en'>System Prompt Output</span></label>",
    "placeholder=\"蒸馏出的 persona_skill 会显示在这里，您可自由微调补充。可以跳过蒸馏，自己手写！ / Distilled persona_skill will show here, you can handwrite or edit it!\"": "data-ph-zh=\"蒸馏出的 persona_skill 会显示在这里，您可自由微调补充。可以跳过蒸馏，自己手写！\" data-ph-en=\"Distilled persona_skill will show here, you can handwrite or edit it!\" placeholder=\"蒸馏出的 persona_skill 会显示在这里，您可自由微调补充。可以跳过蒸馏，自己手写！\"",

    "<h2>🎯 样本调教 <span style='font-size:0.7em;color:var(--text-muted)'>/ Tuning</span></h2>": "<h2><span class='lang-zh'>🎯 样本调教</span><span class='lang-en'>🎯 Sample Tuning</span></h2>",
    "生成演练样本以调优 Agent 的发言。 / Generate practice samples to tune voice.": "<span class='lang-zh'>生成演练样本以调优 Agent 的发言。</span><span class='lang-en'>Generate practice samples to tune Agent's voice.</span>",
    "🎲 生成测试样本 / Generate Test Samples": "<span class='lang-zh'>🎲 生成测试样本</span><span class='lang-en'>🎲 Generate Test Samples</span>",
    "正在思考…… / Thinking...": "<span class='lang-zh'>正在思考……</span><span class='lang-en'>Thinking...</span>",
    "如果不满意，可修改上一页的系统提示词后重新生成。 / If unsatisfied, modify the system prompt and regenerate.": "<span class='lang-zh'>如果不满意，可修改上一页的系统提示词后重新生成。</span><span class='lang-en'>If unsatisfied, modify the system prompt and regenerate.</span>",

    "<h2>⚖️ 经济与参数 <span style='font-size:0.7em;color:var(--text-muted)'>/ Parameters</span></h2>": "<h2><span class='lang-zh'>⚖️ 经济与参数</span><span class='lang-en'>⚖️ Parameters & Economy</span></h2>",
    "调整互动概率与冷却时间。 / Adjust interaction probability and cooldown.": "<span class='lang-zh'>调整互动概率与冷却时间。</span><span class='lang-en'>Adjust interaction probability and cooldown.</span>",
    "回复概率（0~1） / Reply Probability (0~1)": "<span class='lang-zh'>回复概率（0~1）</span><span class='lang-en'>Reply Probability (0~1)</span>",
    "点赞概率（0~1） / Like Probability (0~1)": "<span class='lang-zh'>点赞概率（0~1）</span><span class='lang-en'>Like Probability (0~1)</span>",
    "回复冷却时间（小时） / Reply Cooldown (Hours)": "<span class='lang-zh'>回复冷却时间（小时）</span><span class='lang-en'>Reply Cooldown (Hours)</span>",
    "开启夜间自动演进 / Enable Nightly Evolution": "<span class='lang-zh'>开启夜间自动演进</span><span class='lang-en'>Enable Nightly Evolution</span>",
    "每晚 3:00 自动总结当天互动经验优化人格。 / Automatically summarize daily interactions to optimize persona.": "<span class='lang-zh'>每晚 3:00 自动总结当天互动经验优化人格。</span><span class='lang-en'>Automatically summarize daily interactions to optimize persona.</span>",

    "<h2>🧠 记忆控制 <span style='font-size:0.7em;color:var(--text-muted)'>/ Memory</span></h2>": "<h2><span class='lang-zh'>🧠 记忆控制</span><span class='lang-en'>🧠 Memory Control</span></h2>",
    "控制 Agent 会记忆并回应哪些人的互动。 / Control whose interactions the Agent remembers.": "<span class='lang-zh'>控制 Agent 会记忆并回应哪些人的互动。</span><span class='lang-en'>Control whose interactions the Agent remembers.</span>",
    "<label>白名单模式 / Whitelist Mode</label>": "<label><span class='lang-zh'>白名单模式</span><span class='lang-en'>Whitelist Mode</span></label>",
    "特定用户（仅白名单用户） / Specific Users (Whitelist only)": "<span class='lang-zh'>特定用户（仅白名单用户）</span><span class='lang-en'>Specific Users (Whitelist only)</span>",
    "所有人（任何人互动均可触发记忆） / Everyone (Any interaction triggers memory)": "<span class='lang-zh'>所有人（任何人互动均可触发记忆）</span><span class='lang-en'>Everyone (Any interaction triggers memory)</span>",
    "<label>白名单用户 / VIP List</label>": "<label><span class='lang-zh'>白名单用户</span><span class='lang-en'>VIP List</span></label>",

    "<h2>🚀 部署配置 <span style='font-size:0.7em;color:var(--text-muted)'>/ Deploy</span></h2>": "<h2><span class='lang-zh'>🚀 部署配置</span><span class='lang-en'>🚀 Deploy Config</span></h2>",
    "最后确认并保存您的 Agent 以激活生命流。 / Final confirmation to save your Agent and activate its life stream.": "<span class='lang-zh'>最后确认并保存您的 Agent 以激活生命流。</span><span class='lang-en'>Final confirmation to save your Agent and activate its life stream.</span>",
    "✨ 点燃灵魂火种 / Ignite Soul (Deploy Agent)": "<span class='lang-zh'>✨ 点燃灵魂火种</span><span class='lang-en'>✨ Ignite Soul (Deploy Agent)</span>",

    "['授权/Auth','Gemini','身份/Identity','蒸馏/Distill','调教/Tune','经济/Param','记忆/Memory','部署/Deploy']": "['<span class=\"lang-zh\">授权</span><span class=\"lang-en\">Auth</span>','Gemini','<span class=\"lang-zh\">身份</span><span class=\"lang-en\">Identity</span>','<span class=\"lang-zh\">蒸馏</span><span class=\"lang-en\">Distill</span>','<span class=\"lang-zh\">调教</span><span class=\"lang-en\">Tune</span>','<span class=\"lang-zh\">经济</span><span class=\"lang-en\">Economy</span>','<span class=\"lang-zh\">记忆</span><span class=\"lang-en\">Memory</span>','<span class=\"lang-zh\">部署</span><span class=\"lang-en\">Deploy</span>']",
    "['授权/Auth','Gemini','目标/Target','蒸馏/Distill','调教/Tune']": "['<span class=\"lang-zh\">授权</span><span class=\"lang-en\">Auth</span>','Gemini','<span class=\"lang-zh\">目标</span><span class=\"lang-en\">Target</span>','<span class=\"lang-zh\">蒸馏</span><span class=\"lang-en\">Distill</span>','<span class=\"lang-zh\">调教</span><span class=\"lang-en\">Tune</span>']",

    "<strong>授权账号 / Auth Account:</strong>": "<strong><span class='lang-zh'>授权账号</span><span class='lang-en'>Auth Account</span>:</strong>",
    "<strong>模型配置 / Model Config:</strong>": "<strong><span class='lang-zh'>模型配置</span><span class='lang-en'>Model Config</span>:</strong>",
    "<strong>源账号 / Source Accounts:</strong>": "<strong><span class='lang-zh'>源账号</span><span class='lang-en'>Source Accounts</span>:</strong>",
    "<strong>记忆模式 / Mode:</strong>": "<strong><span class='lang-zh'>记忆模式</span><span class='lang-en'>Memory Mode</span>:</strong>",
    "监听全网 / Listen to All": "<span class='lang-zh'>监听全网</span><span class='lang-en'>Listen to All</span>",
    "特定白名单 / Whitelist": "<span class='lang-zh'>特定白名单</span><span class='lang-en'>Whitelist</span>",
    "<strong>互动概率 / Interaction Pct:</strong>": "<strong><span class='lang-zh'>互动概率</span><span class='lang-en'>Interaction Pct</span>:</strong>",
    "点赞 / Like ": "<span class='lang-zh'>点赞</span><span class='lang-en'>Like</span> ",
    "回复 / Reply ": "<span class='lang-zh'>回复</span><span class='lang-en'>Reply</span> ",
    
    "🎉 <b>Agent 部署成功！ / Agent Deployed Successfully!</b><br><br>": "🎉 <b><span class='lang-zh'>Agent 部署成功！</span><span class='lang-en'>Agent Deployed Successfully!</span></b><br><br>",
    "您的 Agent 已储存于 SaaS 数据中心并开始自动巡逻。点击下方进入专属 Dashboard：<br>\n    Your Agent is stored in the SaaS datacenter and has started auto-patrol. Click below to enter your exclusive Dashboard:<br>": "<span class='lang-zh'>您的 Agent 已储存于 SaaS 数据中心并开始自动巡逻。点击下方进入专属 Dashboard：</span><span class='lang-en'>Your Agent is stored in the SaaS datacenter and has started auto-patrol. Click below to enter your exclusive Dashboard:</span><br>",
    "进入控制台 / Enter Dashboard</a>": "<span class='lang-zh'>进入控制台</span><span class='lang-en'>Enter Dashboard</span></a>",

    "✅ 蒸馏成功！ / Distillation Successful!": "<span class='lang-zh'>✅ 蒸馏成功！</span><span class='lang-en'>✅ Distillation Successful!</span>",
    "抓取了 / fetched": "<span class='lang-zh'>抓取了</span><span class='lang-en'>fetched</span>",
    "条推文 / tweets": "<span class='lang-zh'>条推文</span><span class='lang-en'>tweets</span>",
    "✏️ 自发推文 / Spontaneous Tweet": "<span class='lang-zh'>✏️ 自发推文</span><span class='lang-en'>✏️ Spontaneous Tweet</span>",
    "💬 互动回复 / Interactive Reply": "<span class='lang-zh'>💬 互动回复</span><span class='lang-en'>💬 Interactive Reply</span>",

    "el.textContent = msg;": "el.innerHTML = msg;",

    "showErr('err1','请先完成授权或填入 Refresh Token');": "showErr('err1', '<span class=\"lang-zh\">请先完成授权或填入 Refresh Token</span><span class=\"lang-en\">Please complete Auth or input Refresh Token</span>');",
    "showErr('err2','请输入模型名称');": "showErr('err2','<span class=\"lang-zh\">请输入模型名称</span><span class=\"lang-en\">Please enter a model name</span>');",
    "showErr('err2','请输入 Gemini API Key');": "showErr('err2','<span class=\"lang-zh\">请输入 Gemini API Key</span><span class=\"lang-en\">Please enter Gemini API Key</span>');",
    "showErr('err3','请输入至少一个源账号');": "showErr('err3','<span class=\"lang-zh\">请输入至少一个源账号</span><span class=\"lang-en\">Please enter at least one source account</span>');",
    "showErr('err4','请等待蒸馏完成或手动填入人格配置');": "showErr('err4','<span class=\"lang-zh\">请等待蒸馏完成或手动填入人格配置</span><span class=\"lang-en\">Wait for distillation or enter persona</span>');"
}

for k, v in replacements.items():
    text = text.replace(k, v)

# Add placeholder sync logic
script_ph = """
document.addEventListener('lang-changed', function() {
  const isEn = document.body.classList.contains('en-mode');
  document.querySelectorAll('input[data-ph-zh], textarea[data-ph-zh]').forEach(el => {
    el.placeholder = isEn ? el.getAttribute('data-ph-en') : el.getAttribute('data-ph-zh');
  });
});
// Trigger once on load
document.dispatchEvent(new Event('lang-changed'));
"""
text = text.replace("buildNav();", "buildNav();\n" + script_ph, 1)

with open("packages/dashboard/src/pages/index.astro", "w", encoding="utf-8") as f:
    f.write(text)
