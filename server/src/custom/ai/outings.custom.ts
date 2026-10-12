// =============================================================================
// Outing planner (AI)
//
// OpenStreetMap supplies real places near the selected location. The model
// ranks those places for the date, weather and participant profiles, then adds
// location-free activity ideas.
//
// The prompt enforces two limits in every language: use only supplied places,
// and treat allergies and written limitations as hard constraints.
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

export interface OutingParticipantInput {
    name: string;
    role: string;
    ageYears: number | null;
    allergies: string[];
    medications: string[];
    notes: string | null;
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
    date: string;
    city: string | null;
    weather: OutingWeatherInput | null;
    participants: OutingParticipantInput[];
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

const buildOutingsSystemPrompt = (lang: PromptLanguage): string =>
    lang === 'fr'
        ? `Tu organises des sorties en famille à partir des lieux réels listés par OpenStreetMap, de la météo et des profils utiles des participants.
Réponds uniquement avec un objet JSON valide, sans texte avant ni après et sans markdown.

Règles :
- Les références pointent uniquement vers les lieux fournis. N'invente aucun lieu, adresse ou nom.
- Classe les lieux du meilleur au moins bon. Le premier choix est la recommandation principale.
- Adapte les activités à la météo, à la durée souhaitée et à l'âge des participants, s'il est disponible.
- Respecte les horaires fournis. Ne choisis pas un lieu indiqué comme fermé à l'heure proposée.
- Tiens compte des allergies, médicaments et notes utiles. Les allergies et limites écrites sont des contraintes de sécurité. Ne donne aucun conseil médical ni recommandation de traitement.
- La liste contient uniquement des restaurants avec le tag OpenStreetMap exact diet:halal=only. Ne suggère aucun restaurant non listé, y compris dans les idées sans lieu.
- Ajoute 1 à 3 idées d'activités sans lieu précis, utiles si la météo est mauvaise ou le budget serré.
- Tout en français, formulé court et concret.`
        : `You organise family outings using real places listed in OpenStreetMap, weather, and relevant participant profiles.
Return a valid JSON object only, with no text before or after it and no markdown.

Rules:
- References must point only to the supplied places. Never invent a place, address, or name.
- Rank places best first. The first pick is the main recommendation.
- Match activities to the weather, requested duration, and participants' ages when available.
- Respect supplied opening hours. Never choose a place listed as closed at the recommended time.
- Use relevant allergies, medications, and personal notes. Allergies and written limitations are hard safety constraints. Do not give medical advice or recommend starting, stopping, or changing treatment.
- The list includes only restaurants with the exact OpenStreetMap tag diet:halal=only. Do not suggest an unlisted restaurant, including in location-free ideas.
- Add 1 to 3 location-free activity ideas for bad weather or a tight budget.
- Write every field in ${LANGUAGE_NAME[lang]}.`;

const participantClause = (participant: OutingParticipantInput, fr: boolean): string => {
    const details = [
        participant.ageYears === null ? '' : `${participant.ageYears}${fr ? ' ans' : ' years old'}`,
        participant.allergies.length ? `allergies: ${participant.allergies.slice(0, 6).join(', ')}` : '',
        participant.medications.length ? `${fr ? 'traitements' : 'medications'}: ${participant.medications.slice(0, 6).join(', ')}` : '',
        participant.notes?.trim().slice(0, 160) ?? '',
    ].filter(Boolean);
    return `- ${participant.name} (${participant.role})${details.length ? ` — ${details.join('; ')}` : ''}`;
};

const placeLine = (place: NearbyPlace, index: number, fr: boolean): string => {
    const bits = [
        `${place.distanceKm.toFixed(1)} km`,
        place.openingHours ?? (fr ? 'horaires inconnus' : 'hours unknown'),
    ];
    if (place.fee) bits.push(`${fr ? 'tarif' : 'fee'}: ${place.fee}`);
    if (place.website) bits.push(place.website);
    const category = place.category === 'halal_restaurant'
        ? fr ? 'restaurant exclusivement halal' : 'halal-only restaurant'
        : place.category;
    return `${index + 1}. ${place.name} — ${category} (${bits.join(', ')})`;
};

export const buildOutingsUserPrompt = (input: OutingPlanningInput, lang: PromptLanguage): string => {
    const fr = lang === 'fr';
    const partyLabels = fr ? PARTY_FR : PARTY_EN;
    const durationLabels = fr ? DURATION_FR : DURATION_EN;
    const dayLabel = fr ? 'Jour' : 'Day';
    const whereLabel = fr ? 'Secteur' : 'Area';
    const weatherLabel = fr ? 'Météo prévue' : 'Expected weather';
    const noWeather = fr ? 'prévisions indisponibles' : 'forecast unavailable';
    const ask = fr
        ? `Propose au maximum ${Math.min(MAX_OUTING_PICKS, input.places.length)} lieux de la liste et des idées sans lieu précis.`
        : `Propose at most ${Math.min(MAX_OUTING_PICKS, input.places.length)} places from the list and location-free ideas.`;
    const lines = [
        `${dayLabel} : ${input.date}`,
        `${whereLabel} : ${input.city ?? (fr ? 'position du navigateur' : 'browser position')}`,
        `${fr ? 'Qui participe' : 'Who is coming'} : ${partyLabels[input.party]}`,
        `${fr ? 'Durée souhaitée' : 'Wanted duration'} : ${durationLabels[input.duration]}`,
    ];
    if (input.weather) {
        const w = input.weather;
        lines.push(`${weatherLabel} : ${w.label}, ${Math.round(w.tempMin)}–${Math.round(w.tempMax)}°C, ${fr ? 'pluie' : 'rain'} ${Math.round(w.precipitationProbability)}%`);
    } else {
        lines.push(`${weatherLabel} : ${noWeather}`);
    }
    lines.push('', fr ? 'Participants et profils utiles' : 'Participants and relevant profiles', ...(input.participants.length ? input.participants.map((p) => participantClause(p, fr)) : [fr ? '- aucun' : '- none']));
    lines.push('', ask, fr ? 'Lieux disponibles (OpenStreetMap) :' : 'Available places (OpenStreetMap):');
    if (!input.places.length) lines.push(fr ? 'Aucun lieu trouvé : ne propose aucun lieu ni restaurant dans les idées.' : 'No places found: do not name any venue or restaurant in the ideas.');
    input.places.forEach((place, index) => lines.push(placeLine(place, index, fr)));
    return lines.join('\n');
};


const cleanString = (value: unknown, max: number): string =>
    typeof value === 'string' ? value.trim().slice(0, max) : '';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const toInt = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;

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
