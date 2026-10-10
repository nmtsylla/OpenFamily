// =============================================================================
// Weekly nutrition analysis (AI)
//
// Given a week of planned meals (date × meal type × recipe or custom name), the
// model returns a structured verdict: a 0-100 score, three buckets the UI can
// render as-is, and actionable recommendations.
//
// The score and the buckets are forced so the client never has to interpret free
// text, and every value is clamped here — a model that answers with twelve
// recommendations or empty strings must not reach the screen.
//
// The verdict is a locale-neutral code ('good', 'needs_improvement'…) that the
// client translates. It is DERIVED here from the score (the bands the prompt
// states), not read from the model's answer: two sources of truth for the same
// judgement disagree the moment a small model is careless with one of them.
// =============================================================================

import { aiComplete, AiError, type AiSettings } from '../../services/ai';
import { LANGUAGE_NAME, type PromptLanguage } from '../lib/promptLanguage.custom';

export const NUTRITION_VERDICTS = ['excellent', 'good', 'needs_improvement', 'unbalanced'] as const;
export type NutritionVerdict = (typeof NUTRITION_VERDICTS)[number];

export interface PlannedMealLine {
    /** ISO date (YYYY-MM-DD). */
    date: string;
    /** Meal type as stored ("Déjeuner", "Boîte à lunch"…). */
    mealType: string;
    /** Recipe name when linked, otherwise the user-typed custom meal. */
    label: string;
    /** Recipe category when linked ("Entrée", "Plat"…). */
    recipeCategory?: string | null;
}

export interface NutritionAnalysisInput {
    weekStartIso: string;
    weekEndIso: string;
    meals: PlannedMealLine[];
    /** Coarse hint so the model adapts its vocabulary (e.g. "family with 2 children"). */
    familySummary?: string;
}

export interface NutritionRecommendation {
    title: string;
    detail: string;
}

export interface NutritionAnalysis {
    score: number;
    verdict: NutritionVerdict;
    summary: string;
    strengths: string[];
    weaknesses: string[];
    missingFoodGroups: string[];
    recommendations: NutritionRecommendation[];
}

const NUTRITION_SCHEMA: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    required: ['score', 'summary', 'strengths', 'weaknesses', 'missingFoodGroups', 'recommendations'],
    properties: {
        score: { type: 'number' },
        summary: { type: 'string' },
        strengths: { type: 'array', items: { type: 'string' } },
        weaknesses: { type: 'array', items: { type: 'string' } },
        missingFoodGroups: { type: 'array', items: { type: 'string' } },
        recommendations: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['title', 'detail'],
                properties: { title: { type: 'string' }, detail: { type: 'string' } },
            },
        },
    },
};

/** Score bands: the prompt states them, and the verdict IS the band. */
const verdictFromScore = (score: number): NutritionVerdict => {
    if (score >= 80) return 'excellent';
    if (score >= 65) return 'good';
    if (score >= 45) return 'needs_improvement';
    return 'unbalanced';
};

const buildNutritionSystemPrompt = (lang: PromptLanguage): string => {
    if (lang === 'fr') {
        return `Tu es un nutritionniste familial bienveillant et pragmatique. On te donne le planning des repas d'une famille pour une semaine ; tu produis une analyse nutritionnelle synthétique.
Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans markdown.

Schéma attendu :
{
  "score": number,                 // 0-100, équilibre nutritionnel global de la semaine
  "summary": string,               // 2 à 3 phrases, ton encourageant et concret
  "strengths": string[],           // 2 à 4 points positifs (phrases courtes)
  "weaknesses": string[],          // 2 à 4 points à améliorer (phrases courtes)
  "missingFoodGroups": string[],   // groupes alimentaires sous-représentés ou absents (ex: "Légumes verts", "Poissons gras", "Produits laitiers", "Légumineuses")
  "recommendations": [             // 3 à 5 recommandations actionnables, par ordre de priorité
    { "title": string, "detail": string }   // titre = verbe d'action court ; détail = 1 phrase, max 160 caractères
  ]
}

Règles :
- Note les déséquilibres fréquents : excès de friture, manque de légumes, plats à base de riz ou de pâtes trop souvent répétés, manque de poisson ou de légumineuses, sucres ajoutés.
- Sois CONCRET et BIENVEILLANT. Évite les généralités creuses ("manger 5 fruits et légumes par jour") ; préfère "Remplacer un riz blanc par un plat de légumineuses mardi".
- Le score reflète variété, présence de légumes/légumineuses/poissons, équilibre des macros, modération sur la friture et le sucre.
  80-100 = "excellent" ; 65-79 = "good" ; 45-64 = "needs_improvement" ; 0-44 = "unbalanced".
- Si la semaine a peu de repas planifiés (moins de 10), dis-le dans le résumé et baisse la confiance du score, mais ne refuse pas.
- Toutes les autres chaînes sont en français.`;
    }

    return `You are a kind, pragmatic family nutritionist. You are given one week of a family's planned meals; you produce a short nutritional analysis.
Answer with a valid JSON object ONLY, no text before or after, no markdown.

Expected schema:
{
  "score": number,                 // 0-100, overall balance of the week
  "summary": string,               // 2 to 3 sentences, encouraging and concrete
  "strengths": string[],           // 2 to 4 positive points (short sentences)
  "weaknesses": string[],          // 2 to 4 points to improve (short sentences)
  "missingFoodGroups": string[],   // under-represented or absent food groups (e.g. "Green vegetables", "Oily fish", "Dairy", "Legumes")
  "recommendations": [             // 3 to 5 actionable recommendations, most important first
    { "title": string, "detail": string }   // title = short action verb ; detail = 1 sentence, max 160 characters
  ]
}

Rules:
- Look for the usual imbalances: too much fried food, too few vegetables, the same rice or pasta dish repeated, too little fish or legumes, added sugar.
- Be CONCRETE and KIND. No empty generalities ("eat five fruit and vegetables a day"); prefer "Swap the plain rice for a legume dish on Tuesday".
- The score reflects variety, vegetables/legumes/fish, macro balance and moderation of fried food and sugar.
  80-100 = "excellent" ; 65-79 = "good" ; 45-64 = "needs_improvement" ; 0-44 = "unbalanced".
- If the week holds few planned meals (under 10), say so in the summary and lower your confidence in the score, but do not refuse.
- Write every other string in ${LANGUAGE_NAME[lang]}.`;
};

const buildNutritionUserPrompt = (input: NutritionAnalysisInput, lang: PromptLanguage): string => {
    const fr = lang === 'fr';
    const lines: string[] = [
        fr
            ? `Semaine du ${input.weekStartIso} au ${input.weekEndIso}.`
            : `Week from ${input.weekStartIso} to ${input.weekEndIso}.`,
    ];
    if (input.familySummary) {
        lines.push(fr ? `Famille : ${input.familySummary}.` : `Family: ${input.familySummary}.`);
    }
    lines.push('');

    if (input.meals.length === 0) {
        lines.push(fr ? 'Aucun repas planifié sur la semaine.' : 'No meal planned this week.');
        return lines.join('\n');
    }

    lines.push(
        fr
            ? `Repas planifiés (${input.meals.length} entrées) :`
            : `Planned meals (${input.meals.length} entries):`,
    );
    for (const meal of input.meals) {
        const parts = [`${meal.date} ${meal.mealType}: ${meal.label}`];
        if (meal.recipeCategory) parts.push(`(${meal.recipeCategory})`);
        lines.push(`- ${parts.join(' ')}`);
    }

    return lines.join('\n');
};

const cleanString = (value: unknown, max = 200): string =>
    typeof value === 'string' ? value.trim().slice(0, max) : '';

const cleanList = (value: unknown, max: number, maxLength = 200): string[] =>
    Array.isArray(value)
        ? value
              .map((entry) => cleanString(entry, maxLength))
              .filter((entry) => entry.length > 0)
              .slice(0, max)
        : [];

/** Clamp the model's answer into the shape the dialog renders, or null if unusable. */
export const validateNutritionAnalysis = (raw: unknown): NutritionAnalysis | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (!('score' in raw) || typeof raw.score !== 'number' || !Number.isFinite(raw.score)) return null;

    const score = Math.max(0, Math.min(100, Math.round(raw.score)));
    const summary = 'summary' in raw ? cleanString(raw.summary, 600) : '';
    if (!summary) return null;

    const recommendations =
        'recommendations' in raw && Array.isArray(raw.recommendations)
            ? raw.recommendations
                  .slice(0, 5)
                  .map((entry) => {
                      if (!entry || typeof entry !== 'object') return null;
                      const title = 'title' in entry ? cleanString(entry.title, 80) : '';
                      const detail = 'detail' in entry ? cleanString(entry.detail, 240) : '';
                      return title ? { title, detail } : null;
                  })
                  .filter((entry): entry is NutritionRecommendation => entry !== null)
            : [];

    return {
        score,
        // Derived, never taken from the model: a 1.5B model answers 75 with
        // "needs_improvement" often enough that two sources of truth here show
        // a green gauge next to an orange chip.
        verdict: verdictFromScore(score),
        summary,
        strengths: 'strengths' in raw ? cleanList(raw.strengths, 4) : [],
        weaknesses: 'weaknesses' in raw ? cleanList(raw.weaknesses, 4) : [],
        missingFoodGroups: 'missingFoodGroups' in raw ? cleanList(raw.missingFoodGroups, 6, 80) : [],
        recommendations,
    };
};

export const analyzeWeeklyMeals = async (
    settings: AiSettings,
    input: NutritionAnalysisInput,
    lang: PromptLanguage,
): Promise<{ analysis: NutritionAnalysis; model: string }> => {
    const raw = await aiComplete(settings, {
        system: buildNutritionSystemPrompt(lang),
        user: buildNutritionUserPrompt(input, lang),
        jsonSchema: NUTRITION_SCHEMA,
    });

    const analysis = validateNutritionAnalysis(raw);
    if (!analysis) {
        // The model answered JSON of the wrong shape — the same code the other AI
        // routes use for that, so the client's `ai:errors.*` mapping applies.
        throw new AiError('AI_INVALID_RESPONSE', 'Le modèle n’a pas renvoyé l’analyse attendue');
    }

    return { analysis, model: settings.model };
};
