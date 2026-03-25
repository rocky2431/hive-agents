// Shared helpers, interfaces, and constants for Enterprise Settings sub-components

export async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api${url}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Error');
    if (res.status === 204) return undefined as T;
    return res.json();
}

export interface LLMModel {
    id: string; provider: string; model: string; label: string;
    base_url?: string; api_key_masked?: string; max_tokens_per_day?: number; enabled: boolean; supports_vision?: boolean; max_output_tokens?: number; max_input_tokens?: number; created_at: string;
}

export interface LLMProviderSpec {
    provider: string;
    display_name: string;
    protocol: string;
    default_base_url?: string | null;
    supports_tool_choice: boolean;
    default_max_tokens: number;
}

export const FALLBACK_LLM_PROVIDERS: LLMProviderSpec[] = [
    { provider: 'anthropic', display_name: 'Anthropic', protocol: 'anthropic', default_base_url: 'https://api.anthropic.com', supports_tool_choice: false, default_max_tokens: 8192 },
    { provider: 'openai', display_name: 'OpenAI', protocol: 'openai_compatible', default_base_url: 'https://api.openai.com/v1', supports_tool_choice: true, default_max_tokens: 16384 },
    { provider: 'azure', display_name: 'Azure OpenAI', protocol: 'openai_compatible', default_base_url: '', supports_tool_choice: true, default_max_tokens: 16384 },
    { provider: 'deepseek', display_name: 'DeepSeek', protocol: 'openai_compatible', default_base_url: 'https://api.deepseek.com/v1', supports_tool_choice: true, default_max_tokens: 8192 },
    { provider: 'minimax', display_name: 'MiniMax', protocol: 'openai_compatible', default_base_url: 'https://api.minimaxi.com/v1', supports_tool_choice: true, default_max_tokens: 16384 },
    { provider: 'qwen', display_name: 'Qwen (DashScope)', protocol: 'openai_compatible', default_base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', supports_tool_choice: true, default_max_tokens: 8192 },
    { provider: 'zhipu', display_name: 'Zhipu', protocol: 'openai_compatible', default_base_url: 'https://open.bigmodel.cn/api/paas/v4', supports_tool_choice: true, default_max_tokens: 8192 },
    { provider: 'gemini', display_name: 'Gemini', protocol: 'gemini', default_base_url: 'https://generativelanguage.googleapis.com/v1beta', supports_tool_choice: true, default_max_tokens: 8192 },
    { provider: 'openrouter', display_name: 'OpenRouter', protocol: 'openai_compatible', default_base_url: 'https://openrouter.ai/api/v1', supports_tool_choice: true, default_max_tokens: 4096 },
    { provider: 'kimi', display_name: 'Kimi (Moonshot)', protocol: 'openai_compatible', default_base_url: 'https://api.moonshot.cn/v1', supports_tool_choice: true, default_max_tokens: 8192 },
    { provider: 'vllm', display_name: 'vLLM', protocol: 'openai_compatible', default_base_url: 'http://localhost:8000/v1', supports_tool_choice: true, default_max_tokens: 4096 },
    { provider: 'ollama', display_name: 'Ollama', protocol: 'openai_compatible', default_base_url: 'http://localhost:11434/v1', supports_tool_choice: true, default_max_tokens: 4096 },
    { provider: 'sglang', display_name: 'SGLang', protocol: 'openai_compatible', default_base_url: 'http://localhost:30000/v1', supports_tool_choice: true, default_max_tokens: 4096 },
    { provider: 'custom', display_name: 'Custom', protocol: 'openai_compatible', default_base_url: '', supports_tool_choice: true, default_max_tokens: 4096 },
];
