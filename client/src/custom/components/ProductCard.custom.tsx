// A scanned product as a card: image, name, brand, category, quantity and its
// Nutri-Score when Open Food Facts has one. The actions belong to the caller,
// so the same card serves the scanner and any future surface.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Barcode } from 'lucide-react';
import { Card, CardContent } from '../../components/ui';
import { cn } from '../../lib/utils';
import { NUTRI_SCORE_CLASSES, type ScanProduct } from '../lib/product.custom';

interface ProductCardProps {
    product: ScanProduct;
    children?: React.ReactNode;
}

const ProductCard: React.FC<ProductCardProps> = ({ product, children }) => {
    const { t } = useTranslation('scan.custom');
    const grade = (product.nutriscore_grade || '').toLowerCase();

    return (
        <Card className="overflow-hidden">
            <CardContent className="flex gap-4 pt-5 md:pt-6">
                {product.image_url ? (
                    // Open Food Facts serves product images from its own CDN; a
                    // plain <img> keeps that out of our bundle and our storage.
                    <img
                        src={product.image_url}
                        alt=""
                        className="h-24 w-24 flex-shrink-0 rounded-card bg-surface-2 object-contain"
                    />
                ) : (
                    <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-card bg-surface-2 text-muted-foreground">
                        <Barcode className="h-8 w-8" />
                    </div>
                )}

                <div className="min-w-0 flex-1">
                    <p className="text-body font-semibold text-foreground">{product.name}</p>
                    {product.brand ? (
                        <p className="mt-0.5 text-caption text-muted-foreground">{product.brand}</p>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-micro">
                        {product.category ? (
                            <span className="rounded-pill bg-primary-soft px-2 py-0.5 text-primary">
                                {product.category}
                            </span>
                        ) : null}
                        {product.quantity ? (
                            <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-muted-foreground">
                                {product.quantity}
                            </span>
                        ) : null}
                        {NUTRI_SCORE_CLASSES[grade] ? (
                            <span
                                className={cn('rounded-pill px-2 py-0.5 font-semibold', NUTRI_SCORE_CLASSES[grade])}
                            >
                                {t('productCard.nutriscore')} {grade.toUpperCase()}
                            </span>
                        ) : null}
                        <span className="text-muted-foreground">{product.barcode}</span>
                    </div>
                </div>
            </CardContent>

            {children ? <div className="border-t border-border px-5 py-4 md:px-6">{children}</div> : null}
        </Card>
    );
};

export default ProductCard;
