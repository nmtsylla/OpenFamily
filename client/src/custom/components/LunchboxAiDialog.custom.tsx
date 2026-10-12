import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import {
    Sparkles,
    X as CloseIcon,
    Loader2,
    Apple,
    Cookie,
    GlassWater,
    UtensilsCrossed,
    Check,
    Package,
} from 'lucide-react';
import { api } from '../../lib/api';
import { foldText } from '../../lib/textSearch';
import { useAuth } from '../../contexts/AuthContext';
import { aiErrorKey } from '../../components/app/MagicInput';
import { Button, Dialog, Input, Select } from '../../components/ui';


type LunchboxLocation = 'school' | 'daycare' | 'outing' | 'work' | 'travel' | 'other';

export interface LunchboxIdea {
    main: string;
    fruit: string;
    snack: string;
    drink?: string;
    reasoning: string;
    warnings: string[];
}


interface FamilyMemberLite {
    id: string;
    name: string;
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    familyMember?: FamilyMemberLite | null;
    onIdeaApplied: (idea: LunchboxIdea) => void;
}

const LOCATION_VALUES: LunchboxLocation[] = ['school', 'daycare', 'outing', 'work', 'travel', 'other'];

const STORAGE_KEY = 'openfamily.lunchboxAi.prefs.v1';

interface RememberedPrefs {
    mains: string[];
    fruits: string[];
    snacks: string[];
    drinks: string[];
    location: LunchboxLocation;
}

const loadPrefs = (): RememberedPrefs => {
    const fallback: RememberedPrefs = { mains: [], fruits: [], snacks: [], drinks: [], location: 'school' };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw) as Partial<RememberedPrefs>;
        const strings = (value: unknown): string[] =>
            Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
        return {
            mains: strings(parsed.mains),
            fruits: strings(parsed.fruits),
            snacks: strings(parsed.snacks),
            drinks: strings(parsed.drinks),
            location:
                typeof parsed.location === 'string' &&
                LOCATION_VALUES.includes(parsed.location as LunchboxLocation)
                    ? (parsed.location as LunchboxLocation)
                    : 'school',
        };
    } catch {
        return fallback;
    }
};

const ChipListInput: React.FC<{
    label: string;
    icon: React.ReactNode;
    placeholder: string;
    values: string[];
    onChange: (next: string[]) => void;
}> = ({ label, icon, placeholder, values, onChange }) => {
    const { t } = useTranslation('lunchbox.custom');
    const [draft, setDraft] = useState('');

    const add = () => {
        const tokens = draft
            .split(',')
            .map((token) => token.trim())
            .filter(Boolean);
        if (tokens.length === 0) return;
        const next = [...values];
        for (const token of tokens) {
            if (!next.includes(token) && next.length < 30) next.push(token);
        }
        onChange(next);
        setDraft('');
    };

    return (
        <div>
            <label className="flex items-center gap-2 text-label font-medium text-foreground mb-1.5">
                <span className="text-primary">{icon}</span>
                {label}
            </label>
            <div className="flex gap-2">
                <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            add();
                        }
                    }}
                    placeholder={placeholder}
                />
                <Button type="button" variant="secondary" onClick={add}>
                    {t('ai.add')}
                </Button>
            </div>
            {values.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                    {values.map((value, idx) => (
                        <span
                            key={`${value}-${idx}`}
                            className="inline-flex items-center gap-1 rounded-pill bg-primary/10 px-2.5 py-0.5 text-label-sm text-primary"
                        >
                            {value}
                            <button
                                type="button"
                                onClick={() => onChange(values.filter((_, i) => i !== idx))}
                                aria-label={t('ai.remove', { name: value })}
                            >
                                <CloseIcon className="h-3 w-3" />
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
};

export const LunchboxAiDialog: React.FC<Props> = ({ open, onOpenChange, familyMember, onIdeaApplied }) => {
    const { t } = useTranslation(['lunchbox.custom', 'ai', 'pantry.custom']);
    const { isModuleEnabled } = useAuth();
    const [mains, setMains] = useState<string[]>([]);
    const [fruits, setFruits] = useState<string[]>([]);
    const [snacks, setSnacks] = useState<string[]>([]);
    const [drinks, setDrinks] = useState<string[]>([]);
    const [location, setLocation] = useState<LunchboxLocation>('school');
    const [context, setContext] = useState('');
    const [generating, setGenerating] = useState(false);
    const [loadingPantry, setLoadingPantry] = useState(false);
    const [error, setError] = useState('');
    const [ideas, setIdeas] = useState<LunchboxIdea[]>([]);
    const [appliedIdx, setAppliedIdx] = useState<number | null>(null);

    const loadFromPantry = async () => {
        setLoadingPantry(true);
        try {
            const response = await api.get<{
                success: boolean;
                data: { items: Array<{ name: string; lunchbox_bucket: string | null }> };
            }>('/api/pantry');
            const items = response.data?.items ?? [];
            const forBucket = (bucket: string) => {
                const seen = new Set<string>();
                const names: string[] = [];
                for (const item of items) {
                    if (item.lunchbox_bucket !== bucket) continue;
                    const key = foldText(item.name);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    names.push(item.name);
                }
                return names;
            };
            setMains(forBucket('main'));
            setFruits(forBucket('fruit'));
            setSnacks(forBucket('snack'));
            setDrinks(forBucket('drink'));
            setError('');
        } catch (err) {
            setError(err instanceof Error ? err.message : t('pantry.custom:errors.load'));
        } finally {
            setLoadingPantry(false);
        }
    };

    useEffect(() => {
        const prefs = loadPrefs();
        setMains(prefs.mains);
        setFruits(prefs.fruits);
        setSnacks(prefs.snacks);
        setDrinks(prefs.drinks);
        setLocation(prefs.location);
    }, []);

    const totalItems = mains.length + fruits.length + snacks.length + drinks.length;

    const generate = async () => {
        if (totalItems === 0) {
            setError(t('lunchbox.custom:ai.errors.minItem'));
            return;
        }
        setError('');
        setGenerating(true);
        setAppliedIdx(null);
        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({ mains, fruits, snacks, drinks, location }),
            );
        } catch {
            // localStorage unavailable (private mode) — the pantry just isn't remembered.
        }

        try {
            const response = await api.post<{ success: boolean; data: { ideas: LunchboxIdea[] } }>(
                '/api/lunchbox/ai/ideas',
                {
                    availableMains: mains,
                    availableFruits: fruits,
                    availableSnacks: snacks,
                    availableDrinks: drinks,
                    location,
                    count: 3,
                    familyMemberId: familyMember?.id,
                    context: context.trim() || undefined,
                    lang: String(i18n.language || 'en').split('-')[0],
                },
            );
            setIdeas(response.success ? response.data.ideas : []);
        } catch (err) {
            const key = aiErrorKey(err);
            setError(key ? t(`ai:errors.${key}`) : err instanceof Error ? err.message : t('lunchbox.custom:ai.errors.generate'));
        } finally {
            setGenerating(false);
        }
    };

    const hint = useMemo(() => {
        const parts: string[] = [];
        if (familyMember) parts.push(t('lunchbox.custom:ai.hintFor', { name: familyMember.name }));
        parts.push(t('lunchbox.custom:ai.hintItems', { count: totalItems }));
        return parts.join(' • ');
    }, [familyMember, totalItems, t]);

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={t('lunchbox.custom:ai.title')}
            description={t('lunchbox.custom:ai.description')}
            className="sm:max-w-3xl"
        >
            <div className="space-y-5">
                {isModuleEnabled('pantry') && (
                    <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" variant="secondary" onClick={() => void loadFromPantry()} disabled={loadingPantry}>
                            <Package className="mr-2 h-4 w-4" />
                            {t('pantry.custom:actions.loadFromPantry')}
                        </Button>
                        <span className="text-label-sm text-muted-foreground">
                            {t('pantry.custom:actions.loadFromPantryHint')}
                        </span>
                    </div>
                )}
                <ChipListInput
                    label={t('lunchbox.custom:ai.mains')}
                    icon={<UtensilsCrossed className="h-4 w-4" />}
                    placeholder={t('lunchbox.custom:ai.mainsPlaceholder')}
                    values={mains}
                    onChange={setMains}
                />
                <ChipListInput
                    label={t('lunchbox.custom:ai.fruits')}
                    icon={<Apple className="h-4 w-4" />}
                    placeholder={t('lunchbox.custom:ai.fruitsPlaceholder')}
                    values={fruits}
                    onChange={setFruits}
                />
                <ChipListInput
                    label={t('lunchbox.custom:ai.snacks')}
                    icon={<Cookie className="h-4 w-4" />}
                    placeholder={t('lunchbox.custom:ai.snacksPlaceholder')}
                    values={snacks}
                    onChange={setSnacks}
                />
                <ChipListInput
                    label={t('lunchbox.custom:ai.drinks')}
                    icon={<GlassWater className="h-4 w-4" />}
                    placeholder={t('lunchbox.custom:ai.drinksPlaceholder')}
                    values={drinks}
                    onChange={setDrinks}
                />

                <div>
                    <label className="block text-label font-medium text-foreground mb-1.5">
                        {t('lunchbox.custom:ai.location')}
                    </label>
                    <Select
                        value={location}
                        onValueChange={(value) => setLocation(value as LunchboxLocation)}
                        options={LOCATION_VALUES.map((value) => ({
                            value,
                            label: t(`lunchbox.custom:ai.locations.${value}`),
                        }))}
                    />
                </div>

                <div>
                    <label className="block text-label font-medium text-foreground mb-1.5">
                        {t('lunchbox.custom:ai.context')}
                    </label>
                    <Input
                        value={context}
                        onChange={(e) => setContext(e.target.value)}
                        placeholder={t('lunchbox.custom:ai.contextPlaceholder')}
                    />
                </div>

                {error && (
                    <div className="rounded-input border border-danger/30 bg-danger/10 px-4 py-3 text-caption text-danger">
                        {error}
                    </div>
                )}

                <div className="flex items-center justify-between gap-3">
                    <p className="text-micro text-muted-foreground">{hint}</p>
                    <Button type="button" onClick={generate} disabled={generating}>
                        {generating ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                                {t('lunchbox.custom:ai.generating')}
                            </>
                        ) : (
                            <>
                                <Sparkles className="h-4 w-4 mr-1.5" />
                                {t(ideas.length > 0 ? 'lunchbox.custom:ai.regenerate' : 'lunchbox.custom:ai.generate')}
                            </>
                        )}
                    </Button>
                </div>

                {ideas.length > 0 && (
                    <div className="space-y-3">
                        {ideas.map((idea, idx) => (
                            <div
                                key={idx}
                                className="rounded-card border border-border bg-surface p-3 space-y-2"
                            >
                                <ul className="space-y-1 text-caption">
                                    <li>
                                        <span className="font-medium">{t('lunchbox.custom:ai.mainLabel')}</span>{' '}
                                        {idea.main}
                                    </li>
                                    {idea.fruit && (
                                        <li>
                                            <span className="font-medium">{t('lunchbox.custom:ai.fruitLabel')}</span>{' '}
                                            {idea.fruit}
                                        </li>
                                    )}
                                    {idea.snack && (
                                        <li>
                                            <span className="font-medium">{t('lunchbox.custom:ai.snackLabel')}</span>{' '}
                                            {idea.snack}
                                        </li>
                                    )}
                                    {idea.drink && (
                                        <li>
                                            <span className="font-medium">{t('lunchbox.custom:ai.drinkLabel')}</span>{' '}
                                            {idea.drink}
                                        </li>
                                    )}
                                </ul>
                                {idea.reasoning && (
                                    <p className="text-micro text-muted-foreground italic">{idea.reasoning}</p>
                                )}
                                {idea.warnings.map((warning, wIdx) => (
                                    <p key={wIdx} className="text-micro text-warning">
                                        ⚠️ {warning}
                                    </p>
                                ))}
                                <div className="flex justify-end">
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => {
                                            onIdeaApplied(idea);
                                            setAppliedIdx(idx);
                                        }}
                                        disabled={appliedIdx === idx}
                                    >
                                        {appliedIdx === idx ? (
                                            <>
                                                <Check className="h-4 w-4 mr-1.5" />
                                                {t('lunchbox.custom:ai.applied')}
                                            </>
                                        ) : (
                                            t('lunchbox.custom:ai.useIdea')
                                        )}
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Dialog>
    );
};
