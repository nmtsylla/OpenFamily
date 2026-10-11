// The PrijsProfeet credit line.
//
// Not decoration: crediting the data with a link is a term of the free plan this
// fork integrates (prijsprofeet.nl/api-voorwaarden), so every screen that shows a
// promotion renders this. One link per country present — the Belgian data is
// credited to .be, the Dutch to .nl — and nothing at all when no data is shown.

import React from 'react';
import { useTranslation } from 'react-i18next';

interface PrijsProfeetCreditProps {
    /** The countries whose data is on screen. */
    countries: readonly string[];
}

export const PrijsProfeetCredit: React.FC<PrijsProfeetCreditProps> = ({ countries }) => {
    const { t } = useTranslation('scan.custom');

    if (countries.length === 0) return null;

    return (
        <p className="mt-2 text-micro text-muted-foreground">
            {t('promoCredits.via')}{' '}
            {countries.map((country, index) => (
                <React.Fragment key={country}>
                    {index ? ' · ' : ''}
                    <a
                        href={`https://www.prijsprofeet.${country}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-foreground"
                    >
                        {countries.length > 1 ? `PrijsProfeet ${country.toUpperCase()}` : 'PrijsProfeet'}
                    </a>
                </React.Fragment>
            ))}
        </p>
    );
};
