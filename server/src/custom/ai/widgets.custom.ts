// =============================================================================
// Dashboard widgets that spend AI tokens: the per-kid outfit and the screen-free
// activity ideas.
//
// Both are deliberately short, JSON-only prompts. The default model is an 8B and
// it tails off badly once the prompt or the expected output gets verbose, so we
// constrain it to short arrays of short strings and validate the result strictly:
// the model's JSON is never trusted, only its *shape* is.
//
// Results are cached in-process, keyed by the weather buckets and the kids' age
// buckets rather than by identity — two families in the same city with kids the
// same age share an entry, and a dashboard refresh costs zero tokens.
// =============================================================================

import { aiCompleteWithUsage, AiError, type AiSettings } from '../../services/ai/index';
import type { WeatherSummary } from '../weather/WeatherService.custom';
import logger from '../../lib/logger';

// ---------------------------------------------------------------------------
// Clothing
// ---------------------------------------------------------------------------

export interface ClothingKidInput {
    id: string;
    firstName: string;
    ageYears: number;
}

export interface ClothingSuggestion {
    kidId: string;
    top: string[];
    bottom: string[];
    footwear: string[];
    accessories: string[];
    advice: string;
}

/**
 * A school outfit and a holiday outfit are not the same brief: one has a dress
 * code and a playground, the other a garden, a park and mud.
 */
export type ClothingDayMode = 'school' | 'home';

const CLOTHING_SCHEMA: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    required: ['suggestions'],
    properties: {
        suggestions: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['kidId', 'top', 'bottom', 'footwear', 'accessories', 'advice'],
                properties: {
                    kidId: { type: 'string' },
                    top: { type: 'array', items: { type: 'string' } },
                    bottom: { type: 'array', items: { type: 'string' } },
                    footwear: { type: 'array', items: { type: 'string' } },
                    accessories: { type: 'array', items: { type: 'string' } },
                    advice: { type: 'string' },
                },
            },
        },
    },
};

// ---------------------------------------------------------------------------
// Language of the generated copy
//
// The interface is translated but the widget copy is written by the model, so it
// has to be told which language to write in. French keeps the hand-tuned French
// prompts; every other language gets the English ones plus an explicit
// directive, which is what a small model follows most reliably. An unknown or
// missing language is English.
// ---------------------------------------------------------------------------

export const WIDGET_LANGUAGES = ['en', 'fr', 'es', 'pt', 'ru', 'zh'] as const;
export type WidgetLanguage = (typeof WIDGET_LANGUAGES)[number];

const LANGUAGE_TABLE: Record<string, true> = Object.fromEntries(
    WIDGET_LANGUAGES.map((l) => [l, true]),
);

const LANGUAGE_NAME: Record<WidgetLanguage, string> = {
    en: 'English',
    fr: 'French',
    es: 'Spanish',
    pt: 'Portuguese',
    ru: 'Russian',
    zh: 'Simplified Chinese',
};

const isWidgetLanguage = (value: unknown): value is WidgetLanguage =>
    typeof value === 'string' && LANGUAGE_TABLE[value] === true;

/** Language of the widget copy: the reader's UI language, English by default. */
export const resolveWidgetLanguage = (raw: unknown): WidgetLanguage => {
    const code = typeof raw === 'string' ? raw.trim().toLowerCase().split('-')[0] : '';
    return isWidgetLanguage(code) ? code : 'en';
};

/**
 * Plain-word condition for the non-French prompts — the French `label` above is
 * not usable there, and the buckets alone cannot tell rain from snow. Mirrors the
 * client's icon mapping.
 */
const englishCondition = (code: number): string => {
    if (code === 0) return 'clear sky';
    if (code === 1 || code === 2) return 'partly cloudy';
    if (code === 3) return 'overcast';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 51 && code <= 57) return 'drizzle';
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'thunderstorm';
    return 'overcast';
};

const DAY_MODE_INTRO: Record<ClothingDayMode, string> = {
    school: "Tu suggères une tenue pour un enfant qui va à l'école, en fonction de la météo et de son âge.",
    home: 'Tu suggères une tenue pour un enfant qui passe la journée à la maison et dehors (vacances ou week-end) : il va jouer, bouger et se salir. Privilégie le confort et les vêtements qui ne craignent rien.',
};

const DAY_MODE_INTRO_EN: Record<ClothingDayMode, string> = {
    school: 'You suggest an outfit for a child who is going to school, based on the weather and their age.',
    home: 'You suggest an outfit for a child who spends the day at home and outside (holidays or weekend): they will play, move around and get dirty. Favour comfort and clothes that can take a beating.',
};

const CLOTHING_SCHEMA_HELP = `{
  "suggestions": [
    {
      "kidId": string,
      "top": string[],            // 1 to 3 items, e.g. "long-sleeved t-shirt"
      "bottom": string[],         // 1 to 2 items, e.g. "jeans"
      "footwear": string[],       // 1 item, e.g. "waterproof boots"
      "accessories": string[],    // 0 to 3 items, e.g. "beanie", "scarf", "gloves"
      "advice": string            // one short sentence (max 140 characters)
    }
  ]
}`;

const buildClothingSystemPrompt = (mode: ClothingDayMode, lang: WidgetLanguage): string => {
    if (lang === 'fr') {
        return `${DAY_MODE_INTRO[mode]}
Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après.
Schéma attendu :
{
  "suggestions": [
    {
      "kidId": string,
      "top": string[],            // 1 à 3 articles, ex. "T-shirt manches longues"
      "bottom": string[],         // 1 à 2 articles, ex. "Pantalon en jean"
      "footwear": string[],       // 1 article, ex. "Bottes imperméables"
      "accessories": string[],    // 0 à 3 articles, ex. "Bonnet", "Écharpe", "Gants"
      "advice": string            // une phrase brève (max 140 caractères)
    }
  ]
}
Règles :
- Adapte selon l'âge (vêtements plus chauds et plus simples pour les jeunes enfants).
- Tiens compte de la pluie, du vent et de la température minimale.
- Articles courts en français, sans marque, sans quantité, sans couleur.
- Une suggestion par enfant, dans l'ordre exact fourni.
- Le champ "kidId" doit reprendre la valeur fournie pour chaque enfant.`;
    }

    return `${DAY_MODE_INTRO_EN[mode]}
Answer ONLY with a valid JSON object, no text before or after.
Expected schema:
${CLOTHING_SCHEMA_HELP}
Rules:
- Adapt to the age (warmer and simpler clothes for the youngest).
- Take the rain, the wind and the minimum temperature into account.
- Short item names, no brand, no quantity, no colour.
- One suggestion per child, in the exact order provided.
- The "kidId" field must repeat the value provided for each child.
- Write every item and the advice in ${LANGUAGE_NAME[lang]}.`;
};

const buildClothingUserPrompt = (
    weather: WeatherSummary,
    kids: ClothingKidInput[],
    lang: WidgetLanguage,
): string => {
    const lines: string[] = [];
    lines.push(
        lang === 'fr'
            ? `Météo : min ${Math.round(weather.tempMin)}°C, max ${Math.round(weather.tempMax)}°C, ${weather.label}, précipitations ${weather.precipBucket}, vent ${weather.windyBucket}.`
            : `Weather: min ${Math.round(weather.tempMin)}°C, max ${Math.round(weather.tempMax)}°C, ${englishCondition(weather.weatherCode)}, precipitation ${weather.precipBucket}, wind ${weather.windyBucket}.`,
    );
    lines.push(lang === 'fr' ? 'Enfants :' : 'Children:');
    for (const kid of kids) {
        lines.push(
            lang === 'fr'
                ? `- id=${kid.id} prénom=${kid.firstName} age=${kid.ageYears} ans`
                : `- id=${kid.id} name=${kid.firstName} age=${kid.ageYears}`,
        );
    }
    return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

export const ACTIVITY_CATEGORIES = [
    'outdoor',
    'creative',
    'cooking',
    'learning',
    'sport',
    'chores',
    'social',
] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export const ACTIVITY_TIMES_OF_DAY = ['morning', 'afternoon', 'evening'] as const;
export type ActivityTimeOfDay = (typeof ACTIVITY_TIMES_OF_DAY)[number];

export interface ActivityKidInput {
    id: string;
    firstName: string;
    ageYears: number;
}

/**
 * An activity idea, from the model or from the offline bank. The two paths carry
 * the same fields so one component renders both:
 *   - model: `title`/`instructions` written in the reader's language, and
 *     `materials` as literal words;
 *   - bank: `id` is a stable slug and `materials` are material slugs — the client
 *     resolves all of it through i18n, so the offline ideas follow the reader's
 *     language too, with no copy of the bank per language on the server.
 */
export interface KidActivity {
    kidIds: string[];
    category: ActivityCategory;
    timeOfDay: ActivityTimeOfDay;
    durationMinutes: number;
    materials: string[];
    /** Present on bank ideas. */
    id?: string;
    /** Present on model ideas. */
    title?: string;
    instructions?: string;
}

/** Compact digest of what the app already knows about the target day. */
export interface FamilyDayContext {
    /** e.g. "Natation 14:00" — slots that are already taken. */
    busySlots: string[];
    /** e.g. "Dîner : gratin de courgettes" */
    meals: string[];
    /** Chores due that day that a kid could take on. */
    chores: string[];
}

const ACTIVITIES_SCHEMA: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    required: ['activities'],
    properties: {
        activities: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'kidIds', 'title', 'category', 'timeOfDay',
                    'durationMinutes', 'materials', 'instructions',
                ],
                properties: {
                    kidIds: { type: 'array', items: { type: 'string' } },
                    title: { type: 'string' },
                    category: { type: 'string', enum: [...ACTIVITY_CATEGORIES] },
                    timeOfDay: { type: 'string', enum: [...ACTIVITY_TIMES_OF_DAY] },
                    durationMinutes: { type: 'number' },
                    materials: { type: 'array', items: { type: 'string' } },
                    instructions: { type: 'string' },
                },
            },
        },
    },
};

const buildActivitiesSystemPrompt = (lang: WidgetLanguage): string => {
    if (lang !== 'fr') {
        return `You suggest activities to children who are at home (holidays or weekend).
Your goal: fill the day with NO SCREENS AT ALL (no TV, tablet, console, phone, YouTube).
Answer ONLY with a valid JSON object, no text before or after.
Expected schema:
{
  "activities": [
    {
      "kidIds": string[],         // the children concerned, ids provided
      "title": string,            // max 60 characters, concrete and appealing
      "category": string,         // outdoor | creative | cooking | learning | sport | chores | social
      "timeOfDay": string,        // morning | afternoon | evening
      "durationMinutes": number,  // between 15 and 180
      "materials": string[],      // 0 to 5 everyday objects
      "instructions": string      // 1 to 2 sentences, max 200 characters
    }
  ]
}
Rules:
- Suggest 3 to 5 activities and give the day a rhythm: active morning, calm and creative afternoon, physical activity late afternoon.
- No screen activity, ever.
- Adapt to the weather: if it rains, blows hard or is cold, stay indoors.
- Adapt to the age: shorter and more guided for the little ones, more independent and ambitious for the older ones.
- Use the family context provided (meals, chores) when it allows a concrete activity.
- Do not overlap the slots already taken.
- Everyday materials only, nothing to buy.
- The "kidIds" field must contain only the ids provided.
- Write every title, instruction and material in ${LANGUAGE_NAME[lang]}.`;
    }

    return `Tu proposes des activités à des enfants qui sont à la maison (vacances ou week-end).
Ton objectif : occuper la journée SANS AUCUN ÉCRAN (pas de télé, tablette, console, téléphone, YouTube).
Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après.
Schéma attendu :
{
  "activities": [
    {
      "kidIds": string[],         // les enfants concernés, ids fournis
      "title": string,            // max 60 caractères, concret et donnant envie
      "category": string,         // outdoor | creative | cooking | learning | sport | chores | social
      "timeOfDay": string,        // morning | afternoon | evening
      "durationMinutes": number,  // entre 15 et 180
      "materials": string[],      // 0 à 5 objets du quotidien
      "instructions": string      // 1 à 2 phrases, max 200 caractères
    }
  ]
}
Règles :
- Propose 3 à 5 activités et rythme la journée : matin actif, après-midi calme et créatif, fin d'après-midi dépense physique.
- Aucune activité sur écran, jamais.
- Adapte à la météo : s'il pleut, s'il vente fort ou s'il fait froid, reste à l'intérieur.
- Adapte à l'âge : plus court et plus guidé pour les petits, plus autonome et plus ambitieux pour les grands.
- Utilise le contexte familial fourni (repas, corvées) quand il permet une activité concrète.
- Ne chevauche pas les créneaux déjà occupés.
- Matériel du quotidien uniquement, rien à acheter.
- Le champ "kidIds" ne doit contenir que des ids fournis.`;
};

const buildKidsActivitiesUserPrompt = (
    weather: WeatherSummary,
    kids: ActivityKidInput[],
    context: FamilyDayContext,
    excludeTitles: string[],
    lang: WidgetLanguage,
): string => {
    const lines: string[] = [];
    const fr = lang === 'fr';

    lines.push(
        fr
            ? `Météo du jour : min ${Math.round(weather.tempMin)}°C, max ${Math.round(weather.tempMax)}°C, ${weather.label}, précipitations ${weather.precipBucket}, vent ${weather.windyBucket}.`
            : `Weather: min ${Math.round(weather.tempMin)}°C, max ${Math.round(weather.tempMax)}°C, ${englishCondition(weather.weatherCode)}, precipitation ${weather.precipBucket}, wind ${weather.windyBucket}.`,
    );

    lines.push(fr ? 'Enfants :' : 'Children:');
    for (const kid of kids) {
        lines.push(
            fr
                ? `- id=${kid.id} prénom=${kid.firstName} age=${kid.ageYears} ans`
                : `- id=${kid.id} name=${kid.firstName} age=${kid.ageYears}`,
        );
    }

    // Keep the context block tight — every line here is a line the 8B model has
    // to hold on to while producing strict JSON.
    if (context.busySlots.length > 0) {
        lines.push(`${fr ? 'Déjà prévu' : 'Already planned'}: ${context.busySlots.join(', ')}.`);
    }
    if (context.meals.length > 0) {
        lines.push(`${fr ? 'Repas prévus' : 'Meals planned'}: ${context.meals.join(', ')}.`);
    }
    if (context.chores.length > 0) {
        lines.push(`${fr ? 'Corvées du jour' : 'Chores due today'}: ${context.chores.join(', ')}.`);
    }
    if (excludeTitles.length > 0) {
        lines.push(`${fr ? 'À ne pas reproposer' : 'Do not suggest again'}: ${excludeTitles.join(', ')}.`);
    }

    return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Shared validation helpers — the model's output is data, not truth
// ---------------------------------------------------------------------------

const stringArray = (raw: unknown, max: number): string[] => {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const v of raw) {
        if (out.length >= max) break;
        if (typeof v !== 'string') continue;
        const trimmed = v.trim();
        if (trimmed) out.push(trimmed);
    }
    return out;
};

/**
 * Age brackets, coarse on purpose: they are the cache key, so 6- and 7-year-olds
 * must land in the same bucket for two similar households to share an entry.
 */
const ageBucket = (years: number): string => {
    if (years < 4) return '0-3';
    if (years < 7) return '4-6';
    if (years < 11) return '7-10';
    if (years < 15) return '11-14';
    return '15+';
};

// Static membership tables read as Record, not Set: they never change at runtime.
const ACTIVITY_CATEGORY_TABLE: Record<string, true> = Object.fromEntries(
    ACTIVITY_CATEGORIES.map((c) => [c, true]),
);
const ACTIVITY_TIME_TABLE: Record<string, true> = Object.fromEntries(
    ACTIVITY_TIMES_OF_DAY.map((t) => [t, true]),
);

const isActivityCategory = (v: unknown): v is ActivityCategory =>
    typeof v === 'string' && ACTIVITY_CATEGORY_TABLE[v] === true;
const isActivityTime = (v: unknown): v is ActivityTimeOfDay =>
    typeof v === 'string' && ACTIVITY_TIME_TABLE[v] === true;

const sanitizeSuggestion = (raw: unknown, fallbackKidId: string): ClothingSuggestion | null => {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const kidId = typeof r.kidId === 'string' && r.kidId.trim() ? r.kidId.trim() : fallbackKidId;
    return {
        kidId,
        top: stringArray(r.top, 3),
        bottom: stringArray(r.bottom, 3),
        footwear: stringArray(r.footwear, 2),
        accessories: stringArray(r.accessories, 4),
        advice: typeof r.advice === 'string' ? r.advice.trim().slice(0, 200) : '',
    };
};

// The AI path always ends up with text (the entry is dropped without a title),
// so the model branch of KidActivity stays fully populated.
const sanitizeKidActivity = (
    raw: unknown,
    validKidIds: Set<string>,
): (KidActivity & { title: string; instructions: string }) | null => {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;

    const title = typeof r.title === 'string' ? r.title.trim().slice(0, 80) : '';
    if (!title) return null;

    // Only keep ids we actually sent — the model sometimes invents one.
    const kidIds = stringArray(r.kidIds, 10).filter((id) => validKidIds.has(id));
    if (kidIds.length === 0) return null;

    const rawDuration = typeof r.durationMinutes === 'number' ? r.durationMinutes : 45;

    return {
        kidIds,
        title,
        category: isActivityCategory(r.category) ? r.category : 'creative',
        timeOfDay: isActivityTime(r.timeOfDay) ? r.timeOfDay : 'afternoon',
        durationMinutes: Math.max(15, Math.min(180, Math.round(rawDuration))),
        materials: stringArray(r.materials, 5),
        instructions: typeof r.instructions === 'string' ? r.instructions.trim().slice(0, 240) : '',
    };
};

const TIME_OF_DAY_ORDER: Record<ActivityTimeOfDay, number> = {
    morning: 0,
    afternoon: 1,
    evening: 2,
};

const MAX_ACTIVITIES = 5;

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

const CLOTHING_CACHE_TTL_MS = 30 * 60_000;
const ACTIVITY_CACHE_TTL_MS = 15 * 60_000;

/** Suggestion without its kidId, so one entry serves any kid with the same age. */
type ClothingTemplate = Omit<ClothingSuggestion, 'kidId'>;

interface ClothingCacheEntry {
    at: number;
    template: ClothingTemplate[];
}
const clothingCache = new Map<string, ClothingCacheEntry>();

interface ActivityCacheEntry {
    at: number;
    activities: KidActivity[];
}
const activityCache = new Map<string, ActivityCacheEntry>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ClothingResult {
    suggestions: ClothingSuggestion[];
    cached: boolean;
}

/**
 * One outfit per kid for the target day. `mode` says whether that day is a
 * school day or a day at home; it is part of the cache key so the two never mix.
 *
 * On a cache hit the stored template is remapped onto the current kid ids, so
 * the response always lines up with what the caller passed in.
 */
export const suggestClothingForKids = async (
    weather: WeatherSummary,
    kids: ClothingKidInput[],
    opts: { settings: AiSettings; mode: ClothingDayMode; lang: WidgetLanguage },
): Promise<ClothingResult> => {
    if (kids.length === 0) {
        return { suggestions: [], cached: false };
    }

    // The language is part of the key: the same weather and ages produce
    // different copy per language, and a cached French outfit must never be
    // served to an English reader.
    const key = [
        opts.mode,
        opts.lang,
        weather.tempMinBucket,
        weather.precipBucket,
        weather.windyBucket,
        kids.map((k) => ageBucket(k.ageYears)).join(','),
    ].join('|');

    const hit = clothingCache.get(key);
    if (hit && Date.now() - hit.at < CLOTHING_CACHE_TTL_MS && hit.template.length === kids.length) {
        logger.debug('ai.clothing.cache_hit', { key });
        return {
            suggestions: hit.template.map((tpl, i) => ({ ...tpl, kidId: kids[i].id })),
            cached: true,
        };
    }

    const { data, usage } = await aiCompleteWithUsage(opts.settings, {
        system: buildClothingSystemPrompt(opts.mode, opts.lang),
        user: buildClothingUserPrompt(weather, kids, opts.lang),
        jsonSchema: CLOTHING_SCHEMA,
    });
    logger.debug('ai.clothing.completed', { key, model: opts.settings.model, usage });

    const rawList = data.suggestions;
    if (!Array.isArray(rawList)) {
        throw new AiError('AI_INVALID_RESPONSE', 'Le modèle n’a pas renvoyé de tableau "suggestions"');
    }

    // Build a map by kidId for resilience: the model occasionally reorders.
    const byId = new Map<string, ClothingSuggestion>();
    for (let i = 0; i < rawList.length; i += 1) {
        const sanitized = sanitizeSuggestion(rawList[i], kids[i]?.id ?? '');
        if (sanitized) byId.set(sanitized.kidId, sanitized);
    }

    const suggestions: ClothingSuggestion[] = kids.map(
        (k) =>
            byId.get(k.id) ?? {
                kidId: k.id,
                top: [],
                bottom: [],
                footwear: [],
                accessories: [],
                advice: '',
            },
    );

    clothingCache.set(key, {
        at: Date.now(),
        template: suggestions.map(({ kidId: _kidId, ...rest }) => rest),
    });

    return { suggestions, cached: false };
};

export interface ActivitiesResult {
    activities: KidActivity[];
    cached: boolean;
}

/**
 * Screen-free ideas for a day the kids spend at home.
 *
 * Cached per (day × weather × age buckets × exclusions). The date is in the key
 * on purpose: unlike an outfit, a list of activities that never changes is worse
 * than useless — the family stops looking. The short TTL only absorbs dashboard
 * re-renders within one sitting.
 *
 * Throws AiError for every failure; the route decides what to fall back to.
 */
export const suggestActivitiesForKids = async (
    weather: WeatherSummary,
    kids: ActivityKidInput[],
    context: FamilyDayContext,
    opts: { settings: AiSettings; dateKey: string; exclude?: string[]; lang: WidgetLanguage },
): Promise<ActivitiesResult> => {
    if (kids.length === 0) {
        return { activities: [], cached: false };
    }

    const exclude = opts.exclude ?? [];
    // Language in the key for the same reason as the clothing cache below.
    const key = [
        opts.lang,
        opts.dateKey,
        weather.tempMinBucket,
        weather.precipBucket,
        weather.windyBucket,
        kids.map((k) => ageBucket(k.ageYears)).join(','),
        // Sorted so "regenerate" twice with the same exclusions still hits.
        [...exclude].sort().join('~'),
    ].join('|');

    const hit = activityCache.get(key);
    if (hit && Date.now() - hit.at < ACTIVITY_CACHE_TTL_MS) {
        logger.debug('ai.activities.cache_hit', { key });
        return { activities: hit.activities, cached: true };
    }

    const { data, usage } = await aiCompleteWithUsage(opts.settings, {
        system: buildActivitiesSystemPrompt(opts.lang),
        user: buildKidsActivitiesUserPrompt(weather, kids, context, exclude, opts.lang),
        jsonSchema: ACTIVITIES_SCHEMA,
    });
    logger.debug('ai.activities.completed', { key, model: opts.settings.model, usage });

    const rawList = data.activities;
    if (!Array.isArray(rawList)) {
        throw new AiError('AI_INVALID_RESPONSE', 'Le modèle n’a pas renvoyé de tableau "activities"');
    }

    const validKidIds = new Set(kids.map((k) => k.id));
    const activities: KidActivity[] = [];
    const seenTitles = new Set<string>();
    for (const raw of rawList) {
        if (activities.length >= MAX_ACTIVITIES) break;
        const sanitized = sanitizeKidActivity(raw, validKidIds);
        if (!sanitized) continue;
        const dedupeKey = sanitized.title.toLowerCase();
        if (seenTitles.has(dedupeKey)) continue;
        seenTitles.add(dedupeKey);
        activities.push(sanitized);
    }

    if (activities.length === 0) {
        throw new AiError('AI_INVALID_RESPONSE', 'Le modèle n’a proposé aucune activité utilisable');
    }

    activities.sort((a, b) => TIME_OF_DAY_ORDER[a.timeOfDay] - TIME_OF_DAY_ORDER[b.timeOfDay]);

    activityCache.set(key, { at: Date.now(), activities });

    return { activities, cached: false };
};
