// The names a product answers to, as one string in its pantry name:
// 'Rijst - AH Basmati - Basmati rijst'. That is the form `pantryAliasKeys`
// resolves, so the receipt merge, the products card and the pantry all read one
// convention. The forms edit the two halves apart so nobody has to type it.

export const ALIAS_SEPARATOR = ' - ';

export interface SplitProductName {
    /** The head: what the product shows as. */
    name: string;
    /** The other names, comma separated, ready for an input. */
    aliases: string;
}

export const splitAliases = (name: string): SplitProductName => {
    const parts = String(name ?? '').split(ALIAS_SEPARATOR).map((part) => part.trim()).filter(Boolean);
    return { name: parts[0] ?? '', aliases: parts.slice(1).join(', ') };
};

export const joinAliases = (name: string, aliases: string): string =>
    [name.trim(), ...aliases.split(',').map((part) => part.trim()).filter(Boolean)]
        .filter(Boolean)
        .join(ALIAS_SEPARATOR);
