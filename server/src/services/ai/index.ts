// Local-first AI assistant — provider abstraction.
//
// A single entry point, aiComplete(), takes a system prompt, a user prompt and
// a JSON schema, dispatches to the configured provider (Ollama / OpenAI-compatible /
// Anthropic / Google Gemini) and returns a PARSED JSON object. The model output is never trusted:
// callers must still structurally validate the result.

import { ollamaComplete } from './ollama';
import { openaiComplete } from './openai';
import { anthropicComplete } from './anthropic';
import { geminiComplete } from './gemini';

export type AiProvider = 'ollama' | 'openai' | 'anthropic' | 'gemini';

export interface AiSettings {
    provider: AiProvider;
    /** Base URL (ollama / openai-compatible only — ignored for anthropic and gemini). */
    base_url: string | null;
    /** Decrypted API key (openai / anthropic / gemini — never needed for ollama). */
    api_key: string | null;
    model: string;
}

// FORK-START: ai
/**
 * A file sent along with the completion (receipt photo, invoice PDF…). Base64
 * WITHOUT the `data:` prefix; the caller validates the size and the media type
 * before building the request, each provider maps it to its own wire format.
 */
export interface AiAttachment {
    /** e.g. image/jpeg, image/png, image/webp, application/pdf. */
    mediaType: string;
    /** Base64-encoded bytes. */
    data: string;
    /** Original file name, used by providers that label the document. */
    name?: string;
}
// FORK-END: ai

export interface AiCompletionRequest {
    system: string;
    user: string;
    /** JSON schema of the expected response object (additionalProperties:false everywhere). */
    jsonSchema: Record<string, unknown>;
    // FORK-START: ai
    /** Documents to analyse (vision/document models only). Empty = text-only call. */
    attachments?: AiAttachment[];
    // FORK-END: ai
}

export type AiErrorCode =
    | 'AI_UNREACHABLE'
    | 'AI_UNAUTHORIZED'
    | 'AI_MODEL_NOT_FOUND'
    | 'AI_INVALID_RESPONSE'
    // FORK-START: ai
    | 'AI_UNSUPPORTED_MEDIA'
    // FORK-END: ai
    | 'AI_PROVIDER_ERROR';

export class AiError extends Error {
    constructor(public code: AiErrorCode, message: string) {
        super(message);
        this.name = 'AiError';
    }
}

/** All providers share the same hard timeout. */
export const AI_TIMEOUT_MS = 60_000;

export const DEFAULT_BASE_URLS: Record<AiProvider, string | null> = {
    ollama: 'http://localhost:11434',
    openai: 'https://api.openai.com',
    anthropic: null,
    gemini: null,
};

/**
 * fetch() with the shared 60s AbortController timeout AND SSRF-safe redirect
 * handling: redirects are followed manually and re-validated on every hop
 * (safeFetch), so a user-set base_url cannot 302 the server to a blocked /
 * internal / cloud-metadata address that bypassed the initial guard. The base
 * URL itself is still validated by each provider before calling aiFetch.
 * Network-level failures are mapped to AI_UNREACHABLE with a readable message.
 *
 * Imported lazily to avoid a circular import (safeFetch imports AI_TIMEOUT_MS
 * from this module).
 */
export async function aiFetch(url: string, init: RequestInit): Promise<Response> {
    const { safeFetch } = await import('../../lib/safeFetch');
    try {
        // LAN/private targets stay legitimate here (local Ollama, LM Studio…);
        // the guard always blocks metadata endpoints regardless.
        return await safeFetch(url, { ...init, timeoutMs: AI_TIMEOUT_MS });
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new AiError('AI_UNREACHABLE', `Le fournisseur IA n'a pas répondu en ${AI_TIMEOUT_MS / 1000}s`);
        }
        throw new AiError('AI_UNREACHABLE', error instanceof Error ? error.message : 'Fournisseur IA injoignable');
    }
}

/**
 * Defensive JSON extraction: strips markdown code fences, then parses the
 * substring between the first '{' and the last '}'. Models occasionally wrap
 * their JSON in prose even when asked not to.
 */
export function extractJson(text: string): Record<string, unknown> {
    const withoutFences = text.replace(/```(?:json)?/gi, '');
    const start = withoutFences.indexOf('{');
    const end = withoutFences.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
        throw new AiError('AI_INVALID_RESPONSE', 'La réponse du modèle ne contient pas de JSON');
    }
    try {
        const parsed = JSON.parse(withoutFences.slice(start, end + 1));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('not an object');
        }
        return parsed as Record<string, unknown>;
    } catch {
        throw new AiError('AI_INVALID_RESPONSE', 'La réponse du modèle est un JSON invalide');
    }
}

export interface TokenUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}

export interface AiCompletionWithUsageResult {
    data: Record<string, unknown>;
    usage: TokenUsage | null;
}

/** Single entry point: run a JSON completion through the configured provider. */
export async function aiComplete(
    settings: AiSettings,
    request: AiCompletionRequest
): Promise<Record<string, unknown>> {
    const { data } = await aiCompleteWithUsage(settings, request);
    return data;
}

// FORK-START: ai-no-deliberation
/**
 * Every call here wants a JSON object, not an essay. A reasoning model left to
 * itself spends most of its completion tokens deliberating before it writes the
 * first character of one. Measured against the fork's gateway with
 * deepseek-v4.1-flash and the same prompt either way, four concurrent runs gave
 * 1974 reasoning tokens of 2813 in English and 5078 of 5971 in French, about
 * 61 s of wall time each; with this line the same prompts gave 0 of 760 and 384
 * of 1305, in 12 to 18 s. Prefill is untouched (533 prompt tokens, 256 of them
 * cached), the JSON stays valid, and the system prompt stays byte-stable so the
 * gateway's prompt cache keeps hitting.
 */
const NO_DELIBERATION =
    '\n- Answer immediately, in one pass: write the JSON directly, without deliberating or planning first.';
// FORK-END: ai-no-deliberation

/** Variant of aiComplete that also returns token usage metrics alongside the data object. */
export async function aiCompleteWithUsage(
    settings: AiSettings,
    request: AiCompletionRequest
): Promise<AiCompletionWithUsageResult> {
    // FORK-START: ai-no-deliberation
    const instruction = { ...request, system: `${request.system}${NO_DELIBERATION}` };
    // FORK-END: ai-no-deliberation
    switch (settings.provider) {
        case 'ollama':
            return ollamaComplete(settings, instruction);
        case 'openai':
            return openaiComplete(settings, instruction);
        case 'anthropic':
            return anthropicComplete(settings, instruction);
        case 'gemini':
            return geminiComplete(settings, instruction);
        default:
            throw new AiError('AI_PROVIDER_ERROR', `Fournisseur IA inconnu: ${settings.provider}`);
    }
}
