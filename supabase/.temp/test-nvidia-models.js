async function run() {
  const { createOpenAI } = await import('@ai-sdk/openai');
  const { generateText } = await import('ai');

  const SUPABASE_URL = "https://wumhkjwuomtncfhfuomc.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_Zab5Tth74vdm2gM4cqGCxw_8y6m8VHJ";

  const headers = {
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json'
  };

  console.log("1. Fetching available models...");
  const modelsRes = await fetch(`${SUPABASE_URL}/functions/v1/models`, { headers });
  const models = await modelsRes.json();
  console.log("Models list returned:", JSON.stringify(models, null, 2));

  const nvidia = createOpenAI({
    baseURL: `${SUPABASE_URL}/functions/v1/nvidia/v1`,
    apiKey: 'placeholder',
    fetch: (url, options) => {
      const fetchHeaders = new Headers(options?.headers || {});
      fetchHeaders.set('Authorization', `Bearer ${SUPABASE_ANON_KEY}`);
      fetchHeaders.set('apikey', SUPABASE_ANON_KEY);
      return fetch(url, { ...options, headers: fetchHeaders });
    }
  });

  const testModels = [
    { key: 'kimi', modelId: models.kimi.id },
    { key: 'minimax', modelId: models.minimax.id },
    { key: 'glm', modelId: models.glm.id }
  ];

  for (const item of testModels) {
    console.log(`\n2. Querying ${item.key} (${item.modelId})...`);
    // Extract base model ID by removing the "nvidia/" prefix
    const baseModelId = item.modelId.replace('nvidia/', '');
    try {
      const result = await generateText({
        model: nvidia.chat(baseModelId),
        prompt: 'Say the word "Success" and nothing else.'
      });
      console.log(`${item.key} Response status: OK`);
      console.log(`${item.key} Content:`, JSON.stringify(result.text.trim()));
    } catch (err) {
      console.error(`${item.key} Error:`, err);
    }
  }
}

run();
