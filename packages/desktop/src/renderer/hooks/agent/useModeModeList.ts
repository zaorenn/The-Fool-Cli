import { ipcBridge } from '@/common';
import type { ModelListTier } from '@/common/types/provider/localModels';
import useSWR from 'swr';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const isLoopbackUrl = (baseUrl?: string): boolean => {
  if (!baseUrl) return false;
  try {
    return LOOPBACK_HOSTS.has(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
};

/**
 * LM Studio's OpenAI-compatible `/v1/models` — which is what the backend fetch
 * calls — reports only the models it currently has loaded. Merge in the
 * main-process discovery result so the dropdown offers every installed model,
 * and report the tier so an incomplete list can be labelled as such.
 */
const mergeLocallyInstalledModels = async (
  baseUrl: string | undefined,
  models: { label: string; value: string }[]
): Promise<{ models: { label: string; value: string }[]; tier?: ModelListTier }> => {
  if (!isLoopbackUrl(baseUrl)) return { models };

  try {
    const discovered = await ipcBridge.localModels.listLmStudioModels.invoke();
    if (discovered.models.length === 0) return { models, tier: discovered.tier };

    const known = new Set(models.map((model) => model.value));
    const added = discovered.models.filter((id) => !known.has(id)).map((id) => ({ label: id, value: id }));

    return { models: [...models, ...added], tier: discovered.tier };
  } catch {
    return { models };
  }
};

// Gemini 模型排序函数：Pro 优先，版本号降序
const sortGeminiModels = (models: { label: string; value: string }[]) => {
  return models.toSorted((a, b) => {
    const aPro = a.value.toLowerCase().includes('pro');
    const bPro = b.value.toLowerCase().includes('pro');

    // Pro 模型排在前面
    if (aPro && !bPro) return -1;
    if (!aPro && bPro) return 1;

    // 提取版本号进行比较
    const extractVersion = (name: string) => {
      const match = name.match(/(\d+\.?\d*)/);
      return match ? parseFloat(match[1]) : 0;
    };

    const aVersion = extractVersion(a.value);
    const bVersion = extractVersion(b.value);

    // 版本号大的排在前面
    if (aVersion !== bVersion) {
      return bVersion - aVersion;
    }

    // 版本号相同时按字母顺序排序
    return a.value.localeCompare(b.value);
  });
};

const useModeModeList = (
  platform: string,
  base_url?: string,
  api_key?: string,
  try_fix?: boolean,
  bedrock_config?: {
    auth_method: 'accessKey' | 'profile';
    region: string;
    access_key_id?: string;
    secret_access_key?: string;
    profile?: string;
  }
) => {
  return useSWR(
    [platform + '/models', { platform, base_url, api_key, try_fix, bedrock_config }],
    async ([_url, { platform, base_url, api_key, try_fix, bedrock_config }]): Promise<{
      models: { label: string; value: string }[];
      fix_base_url?: string;
      /** Present only for local hosts; labels an incomplete list in the UI. */
      tier?: ModelListTier;
    }> => {
      // Only call the backend when we have credentials it can actually use:
      // - bedrock: bedrock_config carries the credentials (api_key not required)
      // - everything else: api_key is mandatory per backend validator
      const hasUsableCredentials = platform === 'bedrock' ? !!bedrock_config : !!api_key;
      if (hasUsableCredentials) {
        const res = await ipcBridge.mode.fetchModelList.invoke({
          base_url,
          api_key: api_key ?? '',
          try_fix,
          platform,
          bedrock_config,
        });
        let modelList = res.models.map((v) => {
          // Handle both string and object formats (Bedrock returns objects with id and name)
          if (typeof v === 'string') {
            return { label: v, value: v };
          } else {
            return { label: v.name, value: v.id };
          }
        });

        // 如果是 Gemini 平台，优化排序
        if (platform?.includes('gemini')) {
          modelList = sortGeminiModels(modelList);
        }

        const merged = await mergeLocallyInstalledModels(base_url, modelList);

        // 如果返回了修复的 base_url，将其添加到结果中
        if (res.fixed_base_url) {
          return {
            models: merged.models,
            fix_base_url: res.fixed_base_url,
            tier: merged.tier,
          };
        }

        return { models: merged.models, tier: merged.tier };
      }

      // 既没有 API key 也没有 base_url 也没有 bedrock_config 时，返回空列表
      return { models: [] };
    }
  );
};

export default useModeModeList;
