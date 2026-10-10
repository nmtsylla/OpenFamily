import { matchesWords } from '../../lib/textSearch';

/**
 * "What can I cook from what I have": a recipe is cookable when EVERY one of its
 * ingredient lines is matched by at least one pantry item name.
 *
 * Matching reuses the shared accent- and plural-insensitive `matchesWords`
 * (client/src/lib/textSearch.ts), one direction per line: the ingredient line is
 * the text, the pantry item is the query — so an ingredient line "250 g de
 * tomates" is covered by the pantry item "tomate".
 */
export const recipeCoverage = (
    ingredients: string[],
    pantryNames: string[],
): { covered: number; total: number; cookable: boolean } => {
    const total = ingredients.length;
    const covered = ingredients.filter((line) =>
        pantryNames.some((name) => matchesWords(line, name)),
    ).length;
    return { covered, total, cookable: total > 0 && covered === total };
};
