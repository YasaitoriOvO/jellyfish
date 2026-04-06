import { createAiGateway } from 'ai-gateway-provider';
import { createUnified } from 'ai-gateway-provider/providers/unified';
import { generateText } from 'ai';

export interface GeminiContent {
  role: 'user' | 'model';
  parts: { text: string }[];
}

// 将 Gemini-style contents 转为 AI SDK messages 格式
function contentsToMessages(contents: GeminiContent[]): { role: 'user' | 'assistant'; content: string }[] {
  return contents.map(c => ({
    role: c.role === 'model' ? 'assistant' : 'user',
    content: c.parts.map(p => p.text).join(''),
  }));
}

// 构建 aigateway 实例（每次调用时根据 env 实时创建）
function buildGateway(accountId: string, gateway: string, apiKey: string) {
  return createAiGateway({ accountId, gateway, apiKey });
}

export async function fetchGemini(
  model: string,
  contents: GeminiContent[],
  systemInstruction?: string,
  config?: { maxOutputTokens?: number; temperature?: number },
  _legacyApiKey?: string,   // 保留签名兼容性，已废弃
  _legacyGatewayUrl?: string, // 保留签名兼容性，已废弃
  // 新增：从 env 传入的 Gateway 参数
  gatewayConfig?: { accountId: string; gateway: string; apiKey: string }
): Promise<string> {
  if (!gatewayConfig) {
    throw new Error('[gemini] gatewayConfig (accountId, gateway, apiKey) is required');
  }

  const aigateway = buildGateway(gatewayConfig.accountId, gatewayConfig.gateway, gatewayConfig.apiKey);
  const unified = createUnified();

  // 将 "gemini-2.5-pro-preview-03-25" 转换为 "google/gemini-2.5-pro-preview-03-25"
  const modelPath = model.startsWith('google/') ? model : `google/${model}`;

  const messages = contentsToMessages(contents);

  const { text } = await generateText({
    model: aigateway(unified(modelPath)),
    system: systemInstruction,
    messages,
    maxOutputTokens: config?.maxOutputTokens,
    temperature: config?.temperature,
  });

  if (!text) throw new Error('[gemini] Empty response from model');
  return text.trim();
}

// listGeminiModels 在 AI Gateway 方案下不需要枚举，返回固定推荐列表
export async function listGeminiModels(_apiKey?: string, _gatewayUrl?: string): Promise<string[]> {
  return [
    'gemini-2.5-pro-preview-03-25',
    'gemini-2.0-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ];
}
