// =============================================================================
// Family-profile projections for AI prompts.
//
// `loadFamilyKids` supplies activity prompts. Outing prompts use
// `loadOutingParticipants` excludes contact details and filters children from
// parent-only prompts. Routes return display fields to clients; allergies,
// medications and notes go only to model prompts.
// =============================================================================

import { query } from '../../db';
import { parseStringArray } from '../../lib/normalize';

export interface FamilyKid {
    id: string;
    name: string;
    color: string;
    birth_date: string | null;
    ageYears: number;
    notes: string | null;
    allergies: string[];
}

export const ageYearsFromBirthDate = (birthDate: unknown, fallback: number | null): number | null => {
    if (!(birthDate instanceof Date) && typeof birthDate !== 'string') return fallback;
    const d = birthDate instanceof Date ? birthDate : new Date(`${birthDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return fallback;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const before =
        now.getMonth() < d.getMonth() ||
        (now.getMonth() === d.getMonth() && now.getDate() < d.getDate());
    if (before) age -= 1;
    return Math.max(0, Math.min(120, age));
};

const pickNotes = (notes: unknown, medicalNotes: unknown): string | null => {
    for (const value of [notes, medicalNotes]) {
        if (typeof value === 'string' && value.trim()) return value;
    }
    return null;
};

/** The family's children — the only members an outfit, an idea or an outing is tailored to. */
export const loadFamilyKids = async (userId: string): Promise<FamilyKid[]> => {
    const result = await query(
        `SELECT id, name, birth_date, color, notes, medical_notes, allergies
         FROM family_members
         WHERE user_id = $1 AND role = 'Enfant'
         ORDER BY birth_date NULLS LAST, name ASC`,
        [userId],
    );
    return (result.rows as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.id),
        name: String(r.name),
        color: String(r.color),
        birth_date: r.birth_date === null || r.birth_date === undefined ? null : String(r.birth_date),
        ageYears: ageYearsFromBirthDate(r.birth_date, 8) ?? 8,
        notes: pickNotes(r.notes, r.medical_notes),
        allergies: parseStringArray(r.allergies),
    }));
};

export interface OutingParticipant {
    name: string;
    role: string;
    ageYears: number | null;
    allergies: string[];
    medications: string[];
    notes: string | null;
}

export const projectOutingParticipants = (
    rows: Array<Record<string, unknown>>,
    party: 'family' | 'kids' | 'parents',
): OutingParticipant[] => rows
    .filter((row) => party !== 'parents' || row.role !== 'Enfant')
    .map((row) => {
        const ageYears = ageYearsFromBirthDate(row.birth_date, null);
        return {
            name: String(row.name),
            role: typeof row.role === 'string' && row.role ? row.role : 'Autre',
            ageYears,
            allergies: parseStringArray(row.allergies),
            medications: parseStringArray(row.medications ?? row.vaccines),
            notes: pickNotes(row.notes, row.medical_notes),
        };
    });


export const loadOutingParticipants = async (userId: string, party: 'family' | 'kids' | 'parents'): Promise<OutingParticipant[]> => {
    const result = await query(
        `SELECT name, role, birth_date, allergies, medications, vaccines, notes, medical_notes
         FROM family_members
         WHERE user_id = $1 AND ($2 <> 'parents' OR role <> 'Enfant')
         ORDER BY birth_date NULLS LAST, name ASC`,
        [userId, party],
    );
    return projectOutingParticipants(result.rows as Array<Record<string, unknown>>, party);
};
