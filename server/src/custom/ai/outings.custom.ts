// =============================================================================
// Outing planner (AI)
//
// The hard half (which places exist around the family) is done by OpenStreetMap
// in lib/places.custom.ts. This file asks the model only for what it is actually
// good at: which of those places fits THIS day — the weather, who is coming, the
// ages and the constraints written on the children's cards — and what to do that
// needs no place at all.
//
// Two rules matter more than the rest, and they are stated in every language:
// the model may only reference places from the list it was given (no invented
// venues), and a child's allergy or limitation is a hard constraint.
//
// Language: French keeps the hand-tuned French prompt, the other five get the
// English prompt plus an explicit "write in X" directive — same pattern as the
// lunchbox and weather prompts (lib/promptLanguage.custom.ts).
// =============================================================================

import { aiComplete, type AiSettings } from '../../services/ai';
import { LANGUAGE_NAME, type PromptLanguage } from '../lib/promptLanguage.custom';
import type { NearbyPlace } from '../lib/places.custom';

export const OUTING_PARTIES = ['family', 'kids', 'parents'] as const;
export type OutingParty = (typeof OUTING_PARTIES)[number];

export const OUTING_DURATIONS = ['short', 'half_day', 'full_day'] as const;
export type OutingDuration = (typeof OUTING_DURATIONS)[number];

export interface OutingKidInput {
    name: string;
    ageYears: number;
    /** What the family wrote on the child's card, server-side only. */
    notes: string | null;
    allergies: string[];
}

export interface OutingWeatherInput {
    label: string;
    tempMin: number;
    tempMax: number;
    precipitationProbability: number;
}

export interface OutingPlanningInput {
    party: OutingParty;
    duration: OutingDuration;
    /** YYYY-MM-DD */
    date: string;
    city: string | null;
    weather: OutingWeatherInput | null;
    kids: OutingKidInput[];
    places: NearbyPlace[];
}

export interface OutingPick {
    /** 1-based index into `input.places`, validated. */
    ref: number;
    why: string;
    startTime: string | null;
    durationMinutes: number | null;
}

export interface OutingIdea {
    title: string;
    description: string;
    indoor: boolean;
}

export interface OutingPlan {
    /** Best first — the model's order is the ranking. */
    picks: OutingPick[];
    ideas: OutingIdea[];
}

export const MAX_OUTING_PICKS = 5;
export const MAX_OUTING_IDEAS = 3;

const OUTINGS_SCHEMA: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    required: ['picks', 'ideas'],
    properties: {
        picks: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['ref', 'why'],
                properties: {
                    ref: { type: 'integer' },
                    why: { type: 'string' },
                    startTime: { type: 'string' },
                    durationMinutes: { type: 'integer' },
                },
            },
        },
        ideas: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['title', 'description', 'indoor'],
                properties: {
                    title: { type: 'string' },
                    description: { type: 'string' },
                    indoor: { type: 'boolean' },
                },
            },
        },
    },
};

const PARTY_FR: Record<OutingParty, string> = {
    family: 'toute la famille (adultes et enfants)',
    kids: 'un ou deux adultes avec les enfants',
    parents: 'les parents seulement, sans les enfants',
};

const PARTY_EN: Record<OutingParty, string> = {
    family: 'the whole family (adults and children)',
    kids: 'one or two adults with the children',
    parents: 'the parents only, without the children',
};

const DURATION_FR: Record<OutingDuration, string> = {
    short: 'une heure ou deux',
    half_day: 'une demi-journée',
    full_day: 'toute la journée',
};

const DURATION_EN: Record<OutingDuration, string> = {
    short: 'an hour or two',
    half_day: 'half a day',
    full_day: 'the whole day',
};

const buildOutingsSystemPrompt = (lang: PromptLanguage): string => {
    if (lang === 'fr') {
        return `Tu es un parent qui organise des sorties en famille. On te donne la liste des lieux réellement présents autour du domicile (source OpenStreetMap), la météo, qui participe et ce que la famille a noté sur chaque enfant.
Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans markdown.

Schéma attendu :
{
  "picks": [
    {
      "ref": number,           // le numéro du lieu dans la liste fournie
      "why": string,           // une phrase, max 140 caractères — pourquoi ce lieu, aujourd'hui, pour ces personnes
      "startTime": string,     // "HH:MM", heure de départ conseillée
      "durationMinutes": number // durée sur place, en minutes
    }
  ],
  "ideas": [
    {
      "title": string,         // une activité qui ne dépend d'aucun lieu précis
      "description": string,   // une ou deux phrases concrètes
      "indoor": boolean        // true si c'est à l'intérieur
    }
  ]
}

Règles ABSOLUES :
- "ref" DOIT être un numéro de la liste fournie. N'invente JAMAIS un lieu, une adresse ou un nom.
- Classe les lieux du meilleur au moins bon : le premier "picks" est ta recommandation principale.
- Adapte à la météo : pluie, vent fort ou froid → lieux couverts ; grand soleil et chaud → eau, ombre, parcs.
- Adapte à l'âge des enfants : un enfant de 3 ans et un adolescent ne font pas la même sortie. Des lieux de jeu conviennent aux jeunes enfants, pas à des parents seuls.
- Les allergies et les limitations notées sur la fiche d'un enfant sont des contraintes de sécurité, non négociables.
- Regarde les horaires d'ouverture fournis : ne propose pas un lieu fermé à l'heure conseillée.
- Ajoute 1 à 3 "ideas" d'activités sans lieu précis (à la maison, dans le quartier), utiles quand la météo est mauvaise ou le budget serré.
- Tout en français, formulé court et concret.`;
    }

    return `You are a parent organising family outings. You are given the list of places that really exist around the family's home (OpenStreetMap), the weather, who is coming, and what the family wrote on each child's card.
Answer with a valid JSON object ONLY, no text before or after, no markdown.

Expected schema:
{
  "picks": [
    {
      "ref": number,            // the number of the place in the provided list
      "why": string,            // one sentence, max 140 characters — why this place, today, for these people
      "startTime": string,      // "HH:MM", recommended departure time
      "durationMinutes": number // time spent there, in minutes
    }
  ],
  "ideas": [
    {
      "title": string,          // an activity that needs no specific place
      "description": string,    // one or two concrete sentences
      "indoor": boolean         // true when it happens indoors
    }
  ]
}

ABSOLUTE RULES:
- "ref" MUST be a number from the provided list. NEVER invent a place, an address or a name.
- Rank the places best first: the first "picks" entry is your main recommendation.
- Match the weather: rain, strong wind or cold → covered places; hot and sunny → water, shade, parks.
- Match the children's ages: a 3-year-old and a teenager do not do the same outing. Playgrounds suit young children, not parents on their own.
- The allergies and limitations written on a child's card are safety constraints, non-negotiable.
- Respect the opening hours given: never suggest a place that is closed at the time you propose.
- Add 1 to 3 "ideas" that need no specific place (at home, around the neighbourhood), useful when the weather is bad or money is tight.
- Write every field in ${LANGUAGE_NAME[lang]}.`;
};

const kidClause = (kid: OutingKidInput, fr: boolean): string => {
    const parts: string[] = [`${kid.name} (${kid.ageYears}${fr ? ' ans' : 'y'})`];
    const notes = kid.notes ? kid.notes.trim().slice(0, 160) : '';
    const allergies = kid.allergies.slice(0, 6).join(', ');
    const constraints = [notes, allergies ? `${fr ? 'allergies' : 'allergies'}: ${allergies}` : '']
        .filter(Boolean)
        .join(' — ');
    if (constraints) parts.push(`(${constraints})`);
    return `- ${parts.join(' ')}`;
};

const placeLine = (place: NearbyPlace, index: number, fr: boolean): string => {
    const bits = [
        `${place.distanceKm.toFixed(1)} km`,
        place.openingHours ?? (fr ? 'horaires inconnus' : 'hours unknown'),
    ];
    if (place.fee) bits.push(`${fr ? 'tarif' : 'fee'}: ${place.fee}`);
    if (place.website) bits.push(place.website);
    return `${index + 1}. ${place.name} — ${place.category} (${bits.join(', ')})`;
};

/** Exported for its test: the prompt is the whole contract with the model. */
export const buildOutingsUserPrompt = (input: OutingPlanningInput, lang: PromptLanguage): string => {
    const fr = lang === 'fr';
    const PARTY = fr ? PARTY_FR : PARTY_EN;
    const DURATION = fr ? DURATION_FR : DURATION_EN;
    const L = {
        day: fr ? 'Jour' : 'Day',
        where: fr ? 'Secteur' : 'Area',
        who: fr ? 'Qui participe' : 'Who is coming',
        howLong: fr ? 'Durée souhaitée' : 'Wanted duration',
        weather: fr ? 'Météo prévue' : 'Expected weather',
        noWeather: fr ? 'prévisions indisponibles' : 'forecast unavailable',
        children: fr ? 'Enfants' : 'Children',
        noChildren: fr ? '- aucun' : '- none',
        ask: (n: number) =>
            fr
                ? `Propose au maximum ${n} lieu${n > 1 ? 'x' : ''} de la liste, du meilleur au moins bon, et de 1 à 3 idées sans lieu précis.`
                : `Propose at most ${n} place${n > 1 ? 's' : ''} from the list, best first, and 1 to 3 ideas that need no specific place.`,
        places: fr ? 'Lieux disponibles (OpenStreetMap) :' : 'Available places (OpenStreetMap):',
        nothing: fr
            ? "Aucun lieu trouvé : ne renvoie aucun 'picks'. Donne seulement des idées."
            : "No place found: return no 'picks'. Give ideas only.",
    };

    const lines: string[] = [
        `${L.day} : ${input.date}`,
        `${L.where} : ${input.city ?? (fr ? 'position du navigateur' : 'browser position')}`,
        `${L.who} : ${PARTY[input.party]}`,
        `${L.howLong} : ${DURATION[input.duration]}`,
    ];

    if (input.weather) {
        const w = input.weather;
        lines.push(
            `${L.weather} : ${w.label}, ${Math.round(w.tempMin)}–${Math.round(w.tempMax)}°C, ${
                fr ? 'pluie' : 'rain'
            } ${Math.round(w.precipitationProbability)}%`,
        );
    } else {
        lines.push(`${L.weather} : ${L.noWeather}`);
    }

    lines.push('', L.children, ...(input.kids.length > 0 ? input.kids.map((k) => kidClause(k, fr)) : [L.noChildren]));

    lines.push('', L.ask(Math.min(MAX_OUTING_PICKS, input.places.length)));
    lines.push(input.places.length > 0 ? L.places : L.nothing);
    input.places.forEach((place, index) => lines.push(placeLine(place, index, fr)));

    return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Validation — the model's JSON is data, not truth
// ---------------------------------------------------------------------------

const cleanString = (value: unknown, max: number): string =>
    typeof value === 'string' ? value.trim().slice(0, max) : '';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const toInt = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;

/**
 * Keep only picks that reference a place that was actually offered (a `ref` of
 * 7 when 3 places were listed is an invention, dropped), at most one per place,
 * and cap the ideas. A `startTime` outside a clock day, or a duration outside 30
 * minutes–12 hours, becomes "not proposed" rather than a wrong plan.
 */
export const validateOutingPlan = (raw: unknown, placeCount: number): OutingPlan => {
    const empty: OutingPlan = { picks: [], ideas: [] };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
    const source = raw as { picks?: unknown; ideas?: unknown };

    const picks: OutingPick[] = [];
    const used = new Set<number>();
    if (Array.isArray(source.picks)) {
        for (const entry of source.picks) {
            if (picks.length >= MAX_OUTING_PICKS) break;
            if (!entry || typeof entry !== 'object') continue;
            const ref = toInt((entry as { ref?: unknown }).ref);
            if (ref === null || ref < 1 || ref > placeCount || used.has(ref)) continue;
            const why = cleanString((entry as { why?: unknown }).why, 200);
            if (!why) continue;
            const rawStart = cleanString((entry as { startTime?: unknown }).startTime, 5);
            const rawDuration = toInt((entry as { durationMinutes?: unknown }).durationMinutes);
            used.add(ref);
            picks.push({
                ref,
                why,
                startTime: TIME_PATTERN.test(rawStart) ? rawStart : null,
                durationMinutes:
                    rawDuration !== null && rawDuration >= 30 && rawDuration <= 720 ? rawDuration : null,
            });
        }
    }

    const ideas: OutingIdea[] = [];
    if (Array.isArray(source.ideas)) {
        for (const entry of source.ideas) {
            if (ideas.length >= MAX_OUTING_IDEAS) break;
            if (!entry || typeof entry !== 'object') continue;
            const title = cleanString((entry as { title?: unknown }).title, 120);
            if (!title) continue;
            const description = cleanString((entry as { description?: unknown }).description, 300);
            ideas.push({
                title,
                description,
                indoor: (entry as { indoor?: unknown }).indoor === true,
            });
        }
    }

    return { picks, ideas };
};

// ---------------------------------------------------------------------------
// The scheduled window of a picked place
// ---------------------------------------------------------------------------

/** What an outing gets when neither the model nor the family proposes a length. */
export const DEFAULT_WINDOW: Record<OutingDuration, { start: string; durationMinutes: number }> = {
    short: { start: '10:00', durationMinutes: 120 },
    half_day: { start: '10:00', durationMinutes: 240 },
    full_day: { start: '09:30', durationMinutes: 480 },
};

const timeToMinutes = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map((part) => Number.parseInt(part, 10));
    return h * 60 + m;
};

const minutesToTime = (minutes: number): string =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * The planned window for one picked place: the model's suggested start and
 * length when they fit inside a day, the family's requested duration otherwise.
 * Never a window that runs past midnight — `schedule_entries.end_time` is a clock
 * time, so 22:00 + 8 h would silently become a plan ending the same day.
 */
export const outingWindow = (
    pick: { startTime: string | null; durationMinutes: number | null },
    duration: OutingDuration,
): { startTime: string; endTime: string } => {
    const fallback = DEFAULT_WINDOW[duration];
    const startTime = pick.startTime ?? fallback.start;
    const minutes = pick.durationMinutes ?? fallback.durationMinutes;
    const start = timeToMinutes(startTime);
    // `schedule_entries.end_time` is a clock time with no date, so a window that
    // reaches 24:00 is not storable — upstream rejects "24:00" outright, and the
    // panel's "add to the planning" would 400 on that one outing.
    if (!Number.isFinite(start) || start + minutes > 24 * 60 - 1) {
        return {
            startTime: fallback.start,
            endTime: minutesToTime(timeToMinutes(fallback.start) + fallback.durationMinutes),
        };
    }
    return { startTime, endTime: minutesToTime(start + minutes) };
};

export const generateOutingPlan = async (
    settings: AiSettings,
    input: OutingPlanningInput,
    lang: PromptLanguage,
): Promise<{ plan: OutingPlan; model: string }> => {
    const raw = await aiComplete(settings, {
        system: buildOutingsSystemPrompt(lang),
        user: buildOutingsUserPrompt(input, lang),
        jsonSchema: OUTINGS_SCHEMA,
    });

    return { plan: validateOutingPlan(raw, input.places.length), model: settings.model };
};
