// Scan a barcode, get the product, put it on the shopping list.
//
// The page owns the whole flow: the scanner component only reports digits, the
// hooks only talk to /api/products, and the state machine here decides what the
// user sees (scanning → looking up → found / not found / failed).

import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Plus, ScanLine, Search, Tag } from 'lucide-react';
import { Button, Dialog, Input, useToast } from '../../components/ui';
import { useCategories } from '../../hooks/useCategories';
import BarcodeScanner from '../components/BarcodeScanner.custom';
import ProductCard from '../components/ProductCard.custom';
import { useProductScan, type ShoppingDraft } from '../hooks/useProductScan.custom';
import { usePromoWatchlist } from '../hooks/usePromoWatchlist.custom';
import { optionalNumber, isBarcode, type ScanProduct } from '../lib/product.custom';

type Status = 'idle' | 'loading' | 'found' | 'missing' | 'error' | 'noCamera' | 'invalid';

/**
 * "400 g e" → quantity "400", unit "g". Open Food Facts has no quantity/unit
 * columns, so the shopping form starts from what the label literally says.
 */
const parseQuantity = (quantity: string | null): { quantity: string; unit: string } => {
    const match = quantity?.match(/^\s*([\d.,]+)\s*(.*)$/);
    if (!match) return { quantity: '', unit: '' };
    return { quantity: match[1].replace(',', '.'), unit: (match[2].match(/[^\s,]+/) || [''])[0] };
};

/** The Open Food Facts category as a family category, when it is one. */
const pickCategory = (productCategory: string | null, options: string[]): string => {
    const wanted = (productCategory || '').toLowerCase();
    return (
        options.find((option) => option.toLowerCase() === wanted) ??
        options.find((option) => option === 'Alimentation') ??
        options[0] ??
        ''
    );
};

interface AddToListDialogProps {
    product: ScanProduct;
    categories: string[];
    onClose: () => void;
    onAdd: (draft: ShoppingDraft, watch: boolean, targetPrice: number | null) => Promise<void>;
}

const AddToListDialog: React.FC<AddToListDialogProps> = ({ product, categories, onClose, onAdd }) => {
    const { t } = useTranslation('scan.custom');
    const parsed = parseQuantity(product.quantity);
    const [name, setName] = useState(product.name);
    const [category, setCategory] = useState(() => pickCategory(product.category, categories));
    const [quantity, setQuantity] = useState(parsed.quantity);
    const [unit, setUnit] = useState(parsed.unit || product.unit || '');
    const [price, setPrice] = useState('');
    const [watch, setWatch] = useState(true);
    const [targetPrice, setTargetPrice] = useState('');
    const [saving, setSaving] = useState(false);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!name.trim() || !category) return;
        setSaving(true);
        try {
            await onAdd(
                {
                    name: name.trim(),
                    category,
                    quantity: optionalNumber(quantity),
                    unit: unit.trim() || null,
                    price: optionalNumber(price),
                },
                watch,
                watch ? optionalNumber(targetPrice) : null
            );
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()} title={t('addToList.title')} description={product.name}>
            <form onSubmit={submit} className="space-y-4">
                <Input label={t('addToList.name')} value={name} onChange={(e) => setName(e.target.value)} required />

                <div>
                    <label className="mb-1.5 block text-caption font-medium text-foreground">
                        {t('addToList.category')}
                    </label>
                    <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="input-nexus py-0 text-caption"
                    >
                        {categories.map((option) => (
                            <option key={option} value={option}>
                                {option}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="grid grid-cols-3 gap-3">
                    <Input
                        label={t('addToList.quantity')}
                        type="number"
                        min="0"
                        step="0.01"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                    />
                    <Input
                        label={t('addToList.unit')}
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                    />
                    <Input
                        label={t('addToList.price')}
                        type="number"
                        min="0"
                        step="0.01"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                    />
                </div>

                <label className="flex cursor-pointer items-center gap-2">
                    <input
                        type="checkbox"
                        checked={watch}
                        onChange={(e) => setWatch(e.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <span className="text-caption text-foreground">{t('addToList.watch')}</span>
                </label>

                {watch ? (
                    <Input
                        label={t('addToList.targetPrice')}
                        type="number"
                        min="0"
                        step="0.01"
                        value={targetPrice}
                        onChange={(e) => setTargetPrice(e.target.value)}
                        placeholder={t('addToList.targetPricePlaceholder')}
                    />
                ) : null}

                <div className="flex justify-end gap-2 pt-1">
                    <Button type="button" variant="ghost" onClick={onClose}>
                        {t('addToList.cancel')}
                    </Button>
                    <Button type="submit" disabled={saving || !name.trim()}>
                        <Plus className="mr-1 h-4 w-4" />
                        {t('addToList.submit')}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
};

const ProductScanner: React.FC = () => {
    const { t } = useTranslation('scan.custom');
    const navigate = useNavigate();
    const { showToast } = useToast();
    const { categories } = useCategories();
    const { lookupBarcode, addToShoppingList } = useProductScan();
    const { addWatch } = usePromoWatchlist();

    const [paused, setPaused] = useState(false);
    const [status, setStatus] = useState<Status>('idle');
    const [product, setProduct] = useState<ScanProduct | null>(null);
    const [manual, setManual] = useState('');
    const [dialogOpen, setDialogOpen] = useState(false);
    // The reader decodes the same barcode on every frame it stays in view: the
    // lock makes one scan one lookup, until the user asks for another.
    const busy = useRef(false);

    const scan = useCallback(
        async (barcode: string) => {
            if (busy.current || !barcode) return;
            // The camera cannot decode a malformed barcode; the manual field can.
            // Say what is wrong instead of letting the route answer 400 and
            // reporting it as a failed connection — and do not take the scan lock,
            // so the next attempt is not swallowed by the busy guard.
            if (!isBarcode(barcode)) {
                setStatus('invalid');
                return;
            }
            busy.current = true;
            setPaused(true);
            setStatus('loading');
            try {
                const found = await lookupBarcode(barcode);
                setProduct(found);
                setStatus(found ? 'found' : 'missing');
            } catch (error) {
                console.error('Barcode lookup failed:', error);
                setStatus('error');
            }
        },
        [lookupBarcode]
    );

    const scanAnother = () => {
        busy.current = false;
        setProduct(null);
        setManual('');
        setStatus('idle');
        setPaused(false);
    };

    const addToList = async (draft: ShoppingDraft, watch: boolean, targetPrice: number | null) => {
        if (!product) return;
        try {
            await addToShoppingList(product.barcode, draft, { enablePromoWatch: watch, targetPrice });
            setDialogOpen(false);
            navigate('/shopping');
        } catch (error) {
            console.error('Failed to add the scanned product:', error);
            showToast({ title: t('errors.addFailed') });
        }
    };

    const watchOnly = async () => {
        if (!product) return;
        try {
            await addWatch(product.barcode);
            showToast({ title: t('scanner.watchAdded'), description: product.name });
        } catch (error) {
            console.error('Failed to watch the product:', error);
            showToast({ title: t('errors.addFailed') });
        }
    };

    // The four ways the flow can stall, each with its own words: an unknown
    // barcode, a malformed one, an unreachable Open Food Facts, and a camera that
    // never started.
    const failure =
        status === 'missing' || status === 'error' || status === 'noCamera' || status === 'invalid'
            ? {
                  missing: { title: t('scanner.notFound'), hint: t('scanner.notFoundHint') },
                  error: { title: t('errors.lookupFailed'), hint: t('scanner.errorHint') },
                  noCamera: { title: t('scanner.noCamera'), hint: t('scanner.noCameraHint') },
                  invalid: { title: t('scanner.invalid'), hint: t('scanner.invalidHint') },
              }[status]
            : null;

    return (
        <div className="mx-auto max-w-2xl space-y-5">
            <div className="flex items-center gap-3">
                <div className="rounded-card bg-primary-soft p-3 text-primary">
                    <ScanLine className="h-7 w-7" />
                </div>
                <div className="flex-1">
                    <h1 className="text-h1 text-foreground">{t('scanner.title')}</h1>
                    <p className="text-body text-muted-foreground">{t('scanner.subtitle')}</p>
                </div>
            </div>

            <BarcodeScanner
                paused={paused}
                onResult={(barcode) => void scan(barcode)}
                // No camera, or the browser refused it: that is not a lookup
                // failure, and the user has to be told which one it is.
                onError={() => setStatus((current) => (current === 'idle' ? 'noCamera' : current))}
            />

            {status === 'idle' ? (
                <div className="flex items-center justify-between gap-3">
                    <p className="text-caption text-muted-foreground">{t('scanner.hint')}</p>
                    <Button variant="secondary" size="sm" onClick={() => setPaused((previous) => !previous)}>
                        {paused ? t('scanner.start') : t('scanner.stop')}
                    </Button>
                </div>
            ) : null}

            {status === 'loading' ? (
                <p className="animate-pulse text-center text-body font-medium text-muted-foreground">
                    {t('scanner.lookingUp')}
                </p>
            ) : null}

            {status === 'found' && product ? (
                <ProductCard product={product}>
                    <div className="flex flex-wrap gap-2">
                        <Button onClick={() => setDialogOpen(true)}>
                            <Plus className="mr-1 h-4 w-4" />
                            {t('scanner.addToList')}
                        </Button>
                        <Button variant="secondary" onClick={() => void watchOnly()}>
                            <Tag className="mr-1 h-4 w-4" />
                            {t('scanner.watchOnly')}
                        </Button>
                        <Button variant="ghost" onClick={scanAnother}>
                            {t('scanner.scanAgain')}
                        </Button>
                    </div>
                </ProductCard>
            ) : null}

            {failure ? (
                <div className="space-y-3 rounded-card border border-border bg-card p-5">
                    <p className="text-body font-semibold text-foreground">{failure.title}</p>
                    <p className="text-caption text-muted-foreground">{failure.hint}</p>
                    <form
                        className="flex items-end gap-2"
                        onSubmit={(event) => {
                            event.preventDefault();
                            busy.current = false;
                            void scan(manual.trim());
                        }}
                    >
                        <Input
                            label={t('scanner.manualLabel')}
                            inputMode="numeric"
                            value={manual}
                            onChange={(e) => setManual(e.target.value)}
                            placeholder="3017620422003"
                        />
                        <Button type="submit" disabled={!manual.trim()}>
                            <Search className="mr-1 h-4 w-4" />
                            {t('scanner.lookup')}
                        </Button>
                    </form>
                    <Button variant="ghost" size="sm" onClick={scanAnother}>
                        {t('scanner.start')}
                    </Button>
                </div>
            ) : null}

            {dialogOpen && product ? (
                <AddToListDialog
                    product={product}
                    categories={categories.shopping}
                    onClose={() => setDialogOpen(false)}
                    onAdd={addToList}
                />
            ) : null}
        </div>
    );
};

export default ProductScanner;
