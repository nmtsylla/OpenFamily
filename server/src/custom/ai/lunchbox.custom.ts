// =============================================================================
// Lunchbox idea generator (AI)
//
// Given what is available at home and where the child will eat, the model
// proposes up to 3 ready-to-pack lunchboxes in strict JSON. The parent then
// picks one and the normal lunchbox form saves it — nothing here is persisted.
//
// Two rules matter more than the rest, and they are stated in every language:
// allergies are a hard constraint, and suggestions must come from the listed
// pantry (bread/butter/water/condiments excepted) so nobody needs a grocery run
// at 7am.
//
// Language: French keeps the hand-tuned French prompt, every other language gets
// the English prompt plus an explicit "write in X" directive (lib/promptLanguage.custom.ts).
// The model's JSON is never trusted, only its shape: see validateLunchboxIdeas.
// =============================================================================

import { aiComplete, type AiSettings } from '../../services/ai';
import { LANGUAGE_NAME, type PromptLanguage } from '../lib/promptLanguage.custom';
import { MAX_LUNCHBOX_ITEM_LENGTH } from '../lib/lunchbox.custom';

export const LUNCHBOX_LOCATIONS = ['school', 'daycare', 'outing', 'work', 'travel', 'other'] as const;
export type LunchboxLocation = (typeof LUNCHBOX_LOCATIONS)[number];

export interface LunchboxMemberInput {
    name: string;
    ageYears?: number;
    /** Hard constraint — the model must never use one of these. */
    allergies?: string[];
}

export interface LunchboxGenerationInput {
    availableMains?: string[];
    availableFruits?: string[];
    availableSnacks?: string[];
    availableDrinks?: string[];
    location: LunchboxLocation;
    member?: LunchboxMemberInput;
    count: number;
    notesContext?: string;
}

export interface LunchboxIdea {
    main: string;
    fruit: string;
    snack: string;
    drink?: string;
    reasoning: string;
    warnings: string[];
}


export const MAX_LUNCHBOX_IDEAS = 3;

const LUNCHBOX_SCHEMA: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    required: ['ideas'],
    properties: {
        ideas: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['main', 'fruit', 'snack', 'reasoning', 'warnings'],

                properties: {
                    main: { type: 'string' },
                    fruit: { type: 'string' },
                    snack: { type: 'string' },
                    drink: { type: 'string' },
                    reasoning: { type: 'string' },
                    warnings: { type: 'array', items: { type: 'string' } },
                },
            },
        },
    },
};

/**
 * Where the lunchbox is eaten changes what can be packed: a school bag spends
 * hours at room temperature, a workplace box can be reheated.
 */
const LOCATION_FR: Record<LunchboxLocation, string> = {
    school: "à l'école (pas de micro-ondes, mangé froid, pause courte)",
    daycare: 'à la crèche / garderie (petites portions, mangé froid)',
    outing: "lors d'une sortie / pique-nique (transportable, résistant)",
    work: 'au travail (peut être réchauffé)',
    travel: 'en voyage / trajet long (robuste, plusieurs heures hors frigo)',
    other: 'contexte non précisé',
};

const LOCATION_EN: Record<LunchboxLocation, string> = {
    school: 'at school (no microwave, eaten cold, short break)',
    daycare: 'at daycare / nursery (small portions, eaten cold)',
    outing: 'on an outing / picnic (transportable, sturdy)',
    work: 'at work (can be reheated)',
    travel: 'while travelling (sturdy, several hours out of the fridge)',
    other: 'context not specified',
};

const buildLunchboxSystemPrompt = (lang: PromptLanguage): string => {
    if (lang === 'fr') {
        return `Tu es un parent organisé qui prépare des boîtes à lunch équilibrées à partir de ce qui est disponible à la maison.
Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans markdown.

Schéma attendu :
{
  "ideas": [
    {
      "main": string,        // plat principal court — sandwich, wrap, restes…
      "fruit": string,       // un fruit ou légume (pomme, carottes bâtonnets…)
      "snack": string,       // une collation (compote, biscuit, fromage…)
      "drink"?: string,      // facultatif : boisson (eau, jus, lait…)


      "reasoning": string,   // une phrase, max 140 caractères — pourquoi cette combinaison
      "warnings": string[]   // 0 à 2 alertes pratiques ("réchauffer le matin", "garder au frais")
    }
  ]
}

Règles ABSOLUES :
- N'inclus JAMAIS un aliment listé dans les allergies (contrainte de sécurité, non négociable).
- Privilégie STRICTEMENT les aliments listés comme disponibles. Tu peux utiliser du pain, du beurre, de l'eau, du sel et des condiments de base sans les déclarer manquants, mais pas de plat, fruit, collation ou boisson hors liste.
- Si une catégorie de plat, fruit ou collation est vide, propose un choix de saison et signale-le dans "reasoning".
- La boisson est facultative : omets "drink" si aucune boisson adaptée n'est disponible.

- Adapte la portion et le format à l'âge de l'enfant (petits morceaux avant 4 ans, portions plus copieuses pour les ados).
- L'école et la crèche supposent du transportable, mangé froid, sans micro-ondes. Une sortie ou un trajet suppose du robuste, plusieurs heures hors frigo (à signaler dans "warnings" si une glacière est nécessaire). Le travail autorise le réchauffage.
- Évite la monotonie : des idées demandées doivent être des combinaisons distinctes.
- Tout en français, formulé court et concret.`;
    }

    return `You are an organised parent packing balanced lunchboxes from what is available at home.
Answer with a valid JSON object ONLY, no text before or after, no markdown.

Expected schema:
{
  "ideas": [
    {
      "main": string,        // short main dish — sandwich, wrap, leftovers…
      "fruit": string,       // a fruit or vegetable (apple, carrot sticks…)
      "snack": string,       // a snack (fruit puree, biscuit, cheese…)
      "drink"?: string,      // optional drink (water, juice, milk…)

      "reasoning": string,   // one sentence, max 140 characters — why this combination
      "warnings": string[]   // 0 to 2 practical warnings ("reheat in the morning", "keep chilled")
    }
  ]
}

ABSOLUTE RULES:
- NEVER include a food listed in the allergies (safety constraint, non-negotiable).
- Use the listed available foods STRICTLY. Bread, butter, water, salt and basic condiments need not be listed, but no main, fruit, snack or drink outside the list.
- A drink is optional: omit "drink" when no suitable drink is available.

- If the main, fruit, or snack list is empty, suggest a seasonal option and say so in "reasoning".
- Match portion and format to the child's age (small pieces under 4, larger portions for teenagers).
- School and daycare mean transportable, eaten cold, no microwave. An outing or a trip means sturdy, hours out of the fridge (flag a cool bag in "warnings" when needed). Work allows reheating.
- Avoid monotony: the requested ideas must be distinct combinations.
- Write every field in ${LANGUAGE_NAME[lang]}.`;
};

const buildLunchboxUserPrompt = (input: LunchboxGenerationInput, lang: PromptLanguage): string => {
    const fr = lang === 'fr';
    const L = {
        intro: (count: number) =>
            fr
                ? `Génère ${count} idée${count > 1 ? 's' : ''} de boîte à lunch.`
                : `Generate ${count} lunchbox idea${count > 1 ? 's' : ''}.`,
        location: fr ? 'Lieu de consommation' : 'Where it will be eaten',
        available: fr ? 'Disponible à la maison :' : 'Available at home:',
        none: fr ? '(aucun listé)' : '(none listed)',
        mains: fr ? 'Plats / restes' : 'Mains / leftovers',
        fruits: fr ? 'Fruits / légumes' : 'Fruits / vegetables',
        snacks: fr ? 'Collations' : 'Snacks',
        drinks: fr ? 'Boissons' : 'Drinks',
        who: fr ? 'Pour qui :' : 'For whom:',
        years: fr ? 'ans' : 'years old',
        allergies: fr ? 'ALLERGIES (interdites, absolument)' : 'ALLERGIES (absolutely forbidden)',
        context: fr ? 'Contexte du jour' : 'Context of the day',
    };
    const LOCATION = fr ? LOCATION_FR : LOCATION_EN;

    const bucket = (label: string, items?: string[]) =>
        `${label} : ${items && items.length > 0 ? items.join(', ') : L.none}`;

    const lines: string[] = [
        L.intro(input.count),
        `${L.location} : ${LOCATION[input.location] ?? input.location}.`,
        '',
        L.available,
        `- ${bucket(L.mains, input.availableMains)}`,
        `- ${bucket(L.fruits, input.availableFruits)}`,
        `- ${bucket(L.snacks, input.availableSnacks)}`,
        `- ${bucket(L.drinks, input.availableDrinks)}`,
    ];

    if (input.member) {
        const parts: string[] = [input.member.name];
        if (typeof input.member.ageYears === 'number') parts.push(`${input.member.ageYears} ${L.years}`);
        if (input.member.allergies && input.member.allergies.length > 0) {
            parts.push(`${L.allergies} : ${input.member.allergies.join(', ')}`);
        }
        lines.push('', L.who, `- ${parts.join(' — ')}`);
    }

    if (input.notesContext && input.notesContext.trim()) {
        lines.push('', `${L.context} : ${input.notesContext.trim()}`);
    }

    return lines.join('\n');
};

const cleanString = (value: unknown, max = MAX_LUNCHBOX_ITEM_LENGTH): string =>
    typeof value === 'string' ? value.trim().slice(0, max) : '';

export const validateLunchboxIdeas = (raw: unknown, count: number): LunchboxIdea[] => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('ideas' in raw)) return [];
    if (!Array.isArray(raw.ideas)) return [];

    const toIdea = (entry: unknown): LunchboxIdea | null => {
        if (!entry || typeof entry !== 'object') return null;
        const drink = 'drink' in entry ? cleanString(entry.drink) : '';
        return {
            main: 'main' in entry ? cleanString(entry.main) : '',
            fruit: 'fruit' in entry ? cleanString(entry.fruit) : '',
            snack: 'snack' in entry ? cleanString(entry.snack) : '',
            ...(drink ? { drink } : {}),
            reasoning: 'reasoning' in entry ? cleanString(entry.reasoning, 300) : '',
            warnings:
                'warnings' in entry && Array.isArray(entry.warnings)
                    ? entry.warnings
                          .map((warning: unknown) => cleanString(warning, 160))
                          .filter((warning) => warning.length > 0)
                          .slice(0, 2)
                    : [],
        };
    };

    return raw.ideas
        .slice(0, Math.max(1, Math.min(count, MAX_LUNCHBOX_IDEAS)))
        .map(toIdea)
        .filter((idea): idea is LunchboxIdea => idea !== null && idea.main.length > 0);
};

export const generateLunchboxIdeas = async (
    settings: AiSettings,
    input: LunchboxGenerationInput,
    lang: PromptLanguage,
): Promise<{ ideas: LunchboxIdea[]; model: string }> => {
    const raw = await aiComplete(settings, {
        system: buildLunchboxSystemPrompt(lang),
        user: buildLunchboxUserPrompt(input, lang),
        jsonSchema: LUNCHBOX_SCHEMA,
    });

    return { ideas: validateLunchboxIdeas(raw, input.count), model: settings.model };
};
