// OpenAI-compatible gateway helpers, ported from the fork's
// server/src/services/ai/openai.ts. They live here because upstream's
// openaiComplete has no extension point for them; the upstream provider
// imports and calls them from a FORK-START: ai block.
//
// `chatCompletionUrl` and `sessionIdFor` are the two things a self-hoster
// cannot see from the UI — the URL the app ends up calling, and the session
// header some gateways (OpenCode Go) require. Both were the difference between
// a working assistant and a 502.

import { createHmac } from 'node:crypto';
import { DEFAULT_BASE_URLS, type AiCompletionRequest } from '../../services/ai';

/**
 * Endpoint for an OpenAI-compatible base URL. Accepts what people actually
 * paste: the bare host ("https://api.openai.com"), a versioned root
 * ("https://host/v1"), or the full documented endpoint
 * ("https://host/v1/chat/completions"). The last one used to be appended to
 * again, and the doubling came back as a 404 the user only saw as a 502.
 */
export const chatCompletionUrl = (rawBaseUrl: string | null): string => {
    const root = (rawBaseUrl || DEFAULT_BASE_URLS.openai!)
        .trim()
        .replace(/\/+$/, '')
        .replace(/\/(?:v1\/)?chat\/completions$/, '')
        .replace(/\/v1$/, '');
    return `${root}/v1/chat/completions`;
};

/**
 * Stable, opaque session id for gateways that route per conversation — OpenCode
 * Go rejects a request without `x-opencode-session` with a 400 ("cannot be
 * routed efficiently"), which surfaces in the UI as a 502. Derived from the API
 * key: stable across restarts, one id per configured account (so prompt caching
 * works), and revealing nothing to anyone — it is an HMAC. Every other
 * OpenAI-compatible provider ignores an unknown header.
 */
export const sessionIdFor = (apiKey: string | null): string =>
    createHmac('sha256', apiKey ?? 'anonymous')
        .update('openfamily-ai-session')
        .digest('hex')
        .slice(0, 32);

/**
 * Plain string when there is nothing to attach (every OpenAI-compatible server
 * accepts that), otherwise the multi-part form: images as data URLs, PDFs as
 * inline files. Compatible servers that support neither simply ignore them.
 */
export function messageContent(request: AiCompletionRequest): unknown {
    const attachments = request.attachments ?? [];
    if (attachments.length === 0) return request.user;

    return [
        { type: 'text', text: request.user },
        ...attachments.map((file) =>
            file.mediaType === 'application/pdf'
                ? {
                      type: 'file',
                      file: {
                          filename: file.name || 'document.pdf',
                          file_data: `data:${file.mediaType};base64,${file.data}`,
                      },
                  }
                : {
                      type: 'image_url',
                      image_url: { url: `data:${file.mediaType};base64,${file.data}` },
                  }
        ),
    ];
}
