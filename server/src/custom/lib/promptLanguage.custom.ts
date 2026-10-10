// Language of AI-generated copy.
//
// The interface is translated, the copy the model writes is not: every prompt
// builder has to be told which language to ask for. French keeps the hand-tuned
// French prompts; every other language gets the English prompt plus an explicit
// directive, which is what a small model follows most reliably. An unknown or
// missing code is English.
//
// Extracted from ai/widgets.custom.ts when the lunchbox and nutrition prompts
// needed the same table — the codes are the client's locale folders
// (client/src/i18n/locales/*), minus the folder names the model cannot write.

export const PROMPT_LANGUAGES = ['en', 'fr', 'es', 'pt', 'ru', 'zh'] as const;
export type PromptLanguage = (typeof PROMPT_LANGUAGES)[number];

const LANGUAGE_TABLE: Record<string, true> = Object.fromEntries(
    PROMPT_LANGUAGES.map((l) => [l, true]),
);

export const LANGUAGE_NAME: Record<PromptLanguage, string> = {
    en: 'English',
    fr: 'French',
    es: 'Spanish',
    pt: 'Portuguese',
    ru: 'Russian',
    zh: 'Simplified Chinese',
};

/** Language of generated copy: the reader's UI language, English by default. */
export const resolvePromptLanguage = (raw: unknown): PromptLanguage => {
    const code = typeof raw === 'string' ? raw.trim().toLowerCase().split('-')[0] : '';
    return typeof code === 'string' && LANGUAGE_TABLE[code] === true
        ? (code as PromptLanguage)
        : 'en';
};
