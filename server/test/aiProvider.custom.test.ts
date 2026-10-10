import assert from 'node:assert/strict';
import test from 'node:test';
import { chatCompletionUrl, sessionIdFor } from '../src/custom/ai/openai.custom';
import { DEFAULT_BASE_URLS } from '../src/services/ai';

// =============================================================================
// OpenAI-compatible provider: the two things a self-hoster cannot see from the
// UI — the URL the app ends up calling, and the session header some gateways
// require. Both were the difference between a working assistant and a 502.
// =============================================================================

test('chatCompletionUrl: accepts a host, a /v1 root, or a pasted full endpoint', () => {
    assert.equal(
        chatCompletionUrl('https://api.openai.com'),
        'https://api.openai.com/v1/chat/completions',
    );
    assert.equal(
        chatCompletionUrl('https://api.openai.com/v1'),
        'https://api.openai.com/v1/chat/completions',
    );
    assert.equal(
        chatCompletionUrl('https://api.openai.com/'),
        'https://api.openai.com/v1/chat/completions',
    );
    // The case that produced a doubled path (and a 502 to the user): the value
    // the provider's own docs show in their curl example.
    assert.equal(
        chatCompletionUrl('https://opencode.ai/zen/go/v1/chat/completions'),
        'https://opencode.ai/zen/go/v1/chat/completions',
    );
    assert.equal(
        chatCompletionUrl('  https://host/zen/go/v1/  '),
        'https://host/zen/go/v1/chat/completions',
    );
    assert.equal(
        chatCompletionUrl(null),
        `${DEFAULT_BASE_URLS.openai}/v1/chat/completions`,
    );
});

test('sessionIdFor: stable per key, opaque, and long enough to be a session id', () => {
    const first = sessionIdFor('sk-abcdef');
    assert.equal(first, sessionIdFor('sk-abcdef')); // stable across calls and restarts
    assert.notEqual(first, sessionIdFor('sk-other')); // one id per configured account
    assert.match(first, /^[0-9a-f]{32}$/);
    assert.equal(first.includes('abcdef'), false); // nothing of the key leaks
});
