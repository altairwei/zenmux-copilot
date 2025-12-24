import * as vscode from "vscode";
import {
  CancellationToken,
  LanguageModelChatInformation,
  LanguageModelChatProvider,
  LanguageModelChatRequestMessage,
  ProvideLanguageModelChatResponseOptions,
  LanguageModelResponsePart2,
  Progress,
} from "vscode";

import { createRetryConfig, ensureApiKey, executeWithRetry, fetchModels } from "./utils";
import { AnthropicApi } from "./anthropic/anthropicApi";
import { AnthropicRequestBody } from "./anthropic/anthropicTypes";
import { VertexApi } from "./vertex/vertexApi";
import { VertexRequestBody } from "./vertex/vertexTypes";
import { prepareTokenCount } from "./provideToken";
import { updateContextStatusBar } from "./statusBar";
import { OpenaiApi } from "./openai/openaiApi";


const DEFAULT_CONTEXT_LENGTH = 128000;
const DEFAULT_MAX_TOKENS = 4096;

/**
 * VS Code Chat provider backed by ZenMux Inference Providers.
 */
export class ZenMuxChatModelProvider implements LanguageModelChatProvider {
  /** Track last request completion time for delay calculation. */
  private _lastRequestTime: number | null = null;

  /**
 * Create a provider using the given secret storage for the API key.
 * @param secrets VS Code secret storage.
 */
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly userAgent: string,
    private readonly statusBarItem: vscode.StatusBarItem,
    private readonly output: vscode.OutputChannel
  ) { }

  /**
   * Get the list of available language models contributed by this provider
   * @param options Options which specify the calling context of this function
   * @param token A cancellation token which signals if the user cancelled the request or not
   * @returns A promise that resolves to the list of available language models
   */
  async provideLanguageModelChatInformation(options: vscode.PrepareLanguageModelChatModelOptions, token: CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
    // Fallback: Fetch models from API
    const apiKey = await ensureApiKey(options.silent, this.secrets);
    if (!apiKey) {
      if (options.silent) {
        return [];
      } else {
        throw new Error("ZenMux API key not found");
      }
    }
    const { models } = await fetchModels(apiKey, this.userAgent, this.output);
    this.output.appendLine(`Fetched ${models.length} models from ZenMux API.`);
    return models.map(m => {
      const maxInput = Math.max(1, m.context_length - m.max_completion_tokens || DEFAULT_MAX_TOKENS);
      return {
        id: `${m.slug}`,
        name: m.name,
        tooltip: 'ZenMux Model ' + (m.name || ''),
        detail: 'ZenMux',
        family: m.suitable_api + '-' + m.supports_reasoning,
        version: m.publish_time || '1.0.0',
        maxInputTokens: maxInput,
        maxOutputTokens: m.max_completion_tokens || DEFAULT_MAX_TOKENS,
        capabilities: {
          toolCalling: m.supported_parameters?.includes('tools') || false,
          imageInput: m.input_modalities?.includes('image') || false,
        },
      } as LanguageModelChatInformation;
    });
  }

  private isSupportMessage(model: vscode.LanguageModelChatInformation): boolean {
    const family = model.family?.toLowerCase() || "";
    return family.includes('messages');
  }

  private isSupportGeneration(model: vscode.LanguageModelChatInformation): boolean {
    const family = model.family?.toLowerCase() || "";
    return family.includes('generate');
  }

  private isSupportChat(model: vscode.LanguageModelChatInformation): boolean {
    const family = model.family?.toLowerCase() || "";
    return family.includes('chat.completions');
  }

  private isSupportReasoning(model: vscode.LanguageModelChatInformation): boolean {
    return model.family?.endsWith('-1') || false;
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly LanguageModelChatRequestMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<vscode.LanguageModelResponsePart>,
    token: CancellationToken) {
    try { this.output.appendLine(`Starting provideLanguageModelChatResponse ${model.family}`); } catch { } // for debug breakpoint
    // Update Token Usage
    updateContextStatusBar(messages, model, this.statusBarItem);

    // Apply delay between consecutive requests
    const config = vscode.workspace.getConfiguration();
    const delayMs = config.get<number>("zenmux.delay", 0);

    if (delayMs > 0 && this._lastRequestTime !== null) {
      const elapsed = Date.now() - this._lastRequestTime;
      if (elapsed < delayMs) {
        const remainingDelay = delayMs - elapsed;
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            clearTimeout(timeout);
            resolve();
          }, remainingDelay);
        });
      }
    }

    const trackingProgress: Progress<LanguageModelResponsePart2> = {
      report: (part) => {
        try {
          // @ts-expect-error not error
          progress.report(part);
        } catch (e) {
          const msg = `[ZenMux Model Provider] Progress.report failed modelId=${model.id} error=${e instanceof Error ? e.message : String(e)}`;
          try { this.output.appendLine(msg); } catch { console.error(msg); }
        }
      },
    };

    try {
      const apiKey = await ensureApiKey(false, this.secrets);
      if (!apiKey) {
        throw new Error("ZenMux API key not found");
      }
      // get model config from user settings
      const config = vscode.workspace.getConfiguration();
      if (this.isSupportMessage(model)) {
        const BASE_URL = config.get<string>("zenmux.anthropic.baseUrl", "https://zenmux.ai/api/anthropic");
        // Anthropic API mode
        const anthropicApi = new AnthropicApi();
        const anthropicMessages = anthropicApi.convertMessages(messages, {
          includeReasoningInRequest: false,
        });

        // requestBody
        let requestBody: AnthropicRequestBody = {
          model: model.id,
          messages: anthropicMessages,
          stream: true,
          max_tokens: model.maxOutputTokens || DEFAULT_MAX_TOKENS,
        };
        requestBody = anthropicApi.prepareRequestBody(requestBody, {
          id: model.id,
          max_tokens: model.maxOutputTokens,
        } as any, options);

        // send Anthropic chat request with retry
        const response = await executeWithRetry(async () => {
          const res = await fetch(`${BASE_URL.replace(/\/+$/, "")}/v1/messages`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": this.userAgent,
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(requestBody),
          });

          if (!res.ok) {
            const errorText = await res.text();
            const msg = `[Anthropic Provider] Anthropic API error response status=${res.status} statusText=${res.statusText} body=${errorText}`;
            try { this.output.appendLine(msg); } catch { console.error(msg); }
            throw new Error(
              `Anthropic API error: [${res.status}] ${res.statusText}${errorText ? `\n${errorText}` : ""}`
            );
          }

          return res;
        }, createRetryConfig());

        if (!response.body) {
          throw new Error("No response body from Anthropic API");
        }
        await anthropicApi.processStreamingResponse(response.body, trackingProgress, token);
      } else {
        const BASE_URL = config.get<string>("zenmux.baseUrl", "https://zenmux.ai/api/v1");
        // OpenAI compatible API mode (default)
        const openaiApi = new OpenaiApi();
        const openaiMessages = openaiApi.convertMessages(messages, {
          includeReasoningInRequest: false,
        });

        // requestBody
        let requestBody: Record<string, unknown> = {
          model: model.id,
          messages: openaiMessages,
          stream: true,
          stream_options: { include_usage: true },
        };
        requestBody = openaiApi.prepareRequestBody(requestBody, {
          id: model.id,
          max_tokens: model.maxOutputTokens,
        } as any, options);
        // console.debug("[ZenMux Model Provider] RequestBody:", JSON.stringify(requestBody));

        // send chat request with retry
        const response = await executeWithRetry(async () => {
          const res = await fetch(`${BASE_URL.replace(/\/+$/, "")}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": this.userAgent,
              "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
          });

          if (!res.ok) {
            const errorText = await res.text();
            const msg = `[ZenMux Provider] ZenMux API error response status=${res.status} statusText=${res.statusText} body=${errorText}`;
            try { this.output.appendLine(msg); } catch { console.error(msg); }
            throw new Error(
              `[ZenMux Provider] ZenMux API error: [${res.status}] ${res.statusText}${errorText ? `\n${errorText}` : ""}`
            );
          }

          return res;
        }, createRetryConfig());

        if (!response.body) {
          const msg = "[ZenMux Provider] No response body from ZenMux API";
          try { this.output.appendLine(msg); } catch { console.error(msg); }
          throw new Error("No response body from ZenMux API");
        }
        await openaiApi.processStreamingResponse(response.body, trackingProgress, token);
      }
    } catch (err) {
      console.error("[ZenMux Model Provider] Chat request failed", {
        modelId: model.id,
        messageCount: messages.length,
        error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
      });
      throw err;
    } finally {
      // Update last request time after successful completion
      this._lastRequestTime = Date.now();
    }
  }

  /**
   * Returns the number of tokens for a given text using the model specific tokenizer logic
   * @param model The language model to use
   * @param text The text to count tokens for
   * @param token A cancellation token for the request
   * @returns A promise that resolves to the number of tokens
   */
  async provideTokenCount(
    model: LanguageModelChatInformation,
    text: string | LanguageModelChatRequestMessage,
    _token: CancellationToken
  ): Promise<number> {
    return prepareTokenCount(model, text, _token);
  }
}
