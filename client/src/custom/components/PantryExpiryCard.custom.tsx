import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Package, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useWebSocketUpdates } from '../../hooks/useWebSocketUpdates';
import { Card, CardContent } from '../../components/ui';
import { daysUntil } from '../lib/pantryDates.custom';

// Dashboard widget: what the pantry says to use up in the next two weeks.
//
// Same shape as the fork's other dashboard cards: it returns null when its
// module is off, so the dashboard's widget list needs no extra visibility
// branch. Read only — the /pantry page is where anything is changed.

const EXPIRY_DAYS = 14;
const MAX_ROWS = 5;

interface PantryExpiryItem {
    id: string;
    name: string;
    expires_on: string | null;
}

const PantryExpiryCard: React.FC = () => {
    const { t } = useTranslation('pantry.custom');
    const { isModuleEnabled } = useAuth();
    const navigate = useNavigate();
    const enabled = isModuleEnabled('pantry');

    const [items, setItems] = useState<PantryExpiryItem[]>([]);
    const [loaded, setLoaded] = useState(false);

    const load = useCallback(() => {
        if (!enabled) return;
        api.get<{ success: boolean; data: { items: PantryExpiryItem[] } }>(
            `/api/pantry?filter=expiring&days=${EXPIRY_DAYS}`,
        )
            .then((response) => {
                if (response.success) setItems((response.data?.items ?? []).slice(0, MAX_ROWS));
            })
            .catch(() => undefined)
            .finally(() => setLoaded(true));
    }, [enabled]);

    useEffect(() => {
        load();
    }, [load]);

    useWebSocketUpdates('shopping', load);

    if (!enabled) return null;

    return (
        <Card>
            <CardContent className="pt-5">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="flex items-center gap-2 text-h2 font-semibold">
                        <Package className="h-5 w-5 text-primary" />
                        {t('dashboard.title')}
                    </h2>
                    <button
                        type="button"
                        onClick={() => navigate('/pantry')}
                        className="flex items-center gap-1 text-caption text-primary"
                    >
                        {t('dashboard.viewAll')}
                        <ChevronRight className="h-4 w-4" />
                    </button>
                </div>

                {loaded && items.length === 0 ? (
                    <p className="py-6 text-center text-caption text-muted-foreground">{t('dashboard.empty')}</p>
                ) : (
                    <ul className="mt-3 space-y-2">
                        {items.map((item) => {
                            const days = item.expires_on ? daysUntil(item.expires_on) : 0;
                            return (
                                <li key={item.id} className="flex items-center justify-between gap-2 text-caption">
                                    <span className="min-w-0 truncate">{item.name}</span>
                                    <span className={days < 0 ? 'text-destructive' : 'text-muted-foreground'}>
                                        {days < 0
                                            ? t('list.expired')
                                            : days === 0
                                              ? t('list.expiresToday')
                                              : t('list.expiresIn', { days })}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
};

export default PantryExpiryCard;
