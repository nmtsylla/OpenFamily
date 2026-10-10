// AI settings shared by the custom routes that spend tokens.
//
// Upstream keeps its own copy of this logic inside routes/ai.ts (not exported),
// so a custom route cannot borrow it. Both the dashboard widgets and the
// lunchbox routes need the same three answers — is a model configured, is it
// enabled, and what is the decrypted key — hence this one copy.

import type { Response } from 'express';
import { query } from '../../db';
import { decryptCredentials } from '../../utils/crypto';
import logger from '../../lib/logger';
import { AiError, type AiProvider, type AiSettings } from '../../services/ai';

export interface AiSettingsRow {
    provider: AiProvider;
    base_url: string | null;
    encrypted_api_key: string | null;
    model: string;
    enabled: boolean;
}

/** The row as stored, or null when the family never configured a model. */
export const loadAiSettingsRow = async (userId: string): Promise<AiSettingsRow | null> => {
    const result = await query(
        'SELECT provider, base_url, encrypted_api_key, model, enabled FROM ai_settings WHERE user_id = $1',
        [userId],
    );
    return (result.rows[0] as AiSettingsRow | undefined) ?? null;
};

/** Decrypted settings, ready for aiComplete(). */
export const toAiSettings = (row: AiSettingsRow): AiSettings => {
    let api_key: string | null = null;
    if (row.encrypted_api_key) {
        try {
            api_key = decryptCredentials(row.encrypted_api_key).api_key ?? null;
        } catch {
            api_key = null;
        }
    }
    return { provider: row.provider, base_url: row.base_url, api_key, model: row.model };
};

/**
 * Enabled AI settings, or null when the family has no model configured — the
 * dashboard widgets degrade to their offline content instead of failing, so
 * they need `null` rather than the 4xx the /api/ai routes answer with.
 */
export const loadEnabledAiSettings = async (userId: string): Promise<AiSettings | null> => {
    const row = await loadAiSettingsRow(userId);
    if (!row || !row.model || !row.enabled) return null;
    return toAiSettings(row);
};

/** AiError → its machine-readable code; anything else → 500. */
export const handleAiError = (res: Response, error: unknown, context: string) => {
    if (error instanceof AiError) {
        // The code is machine-readable (the client maps it to a localized
        // message via `ai:errors.*`); `message` carries the provider detail.
        return res.status(502).json({ success: false, error: error.code, message: error.message });
    }
    logger.error(`ai.${context}_error`, {
        error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, error: 'Internal server error' });
};
