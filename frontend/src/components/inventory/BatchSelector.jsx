import { useId, useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ExpiryBadge } from './ExpiryBadge';
import { format, parseISO, differenceInDays } from 'date-fns';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';

const EMPTY_ARRAY = [];

/**
 * Sort batches by FEFO (First Expiry First Out)
 */
function sortByFEFO(batches) {
  return batches.toSorted((a, b) => {
    const dateA = a.expiry_date ? parseISO(a.expiry_date) : new Date('9999-12-31');
    const dateB = b.expiry_date ? parseISO(b.expiry_date) : new Date('9999-12-31');
    return dateA - dateB;
  });
}

function createBatchMap(batches) {
  return new Map(batches.map((batch) => [batch.id, batch]));
}

function createAllocationMap(allocations) {
  return new Map(allocations.map((allocation) => [allocation.batch_id, allocation]));
}

/**
 * Calculate available quantity from selected batches
 */
function calculateSelectedQuantity(selectedBatches, batchById) {
  return selectedBatches.reduce((sum, batchId) => {
    const batch = batchById.get(batchId);
    return sum + (batch?.quantity || batch?.available_quantity || 0);
  }, 0);
}

/**
 * BatchOption - Single batch option in the selector
 */
function BatchOption({
  batch,
  isSelected,
  isRecommended,
  onSelect,
  referenceDate,
  showLocation = false,
}) {
  const expiryDate = batch.expiry_date;
  const daysUntilExpiry = expiryDate ? differenceInDays(parseISO(expiryDate), referenceDate) : null;
  const isExpired = daysUntilExpiry !== null && daysUntilExpiry < 0;
  const isUrgent = daysUntilExpiry !== null && daysUntilExpiry <= 7 && daysUntilExpiry >= 0;
  const quantity = batch.quantity || batch.available_quantity || 0;

  return (
    <button
      type="button"
      disabled={isExpired}
      aria-pressed={isSelected}
      className={cn(
        'flex w-full items-center gap-3 p-3 rounded-lg text-left transition-colors',
        isSelected ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50 border border-transparent',
        isExpired && 'opacity-50 cursor-not-allowed'
      )}
      onClick={() => !isExpired && onSelect(batch.id)}
    >
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-sm border border-border',
          isSelected && 'border-primary bg-primary text-primary-foreground'
        )}
        aria-hidden="true"
      >
        {isSelected ? <Check className="size-3" /> : null}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-sm font-medium">
            {batch.batch_number || 'No batch #'}
          </span>
          {isRecommended && !isExpired && (
            <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
              FEFO
            </Badge>
          )}
          {isExpired && (
            <Badge variant="destructive" className="text-[10px]">
              Expired
            </Badge>
          )}
          {isUrgent && (
            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/30">
              Expiring Soon
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {showLocation && batch.location_name && (
            <span>{batch.location_name}</span>
          )}
          {expiryDate && (
            <span className="font-mono">
              Exp: {format(parseISO(expiryDate), 'MMM d, yyyy')}
            </span>
          )}
        </div>
      </div>

      <div className="text-right shrink-0">
        <span className="font-mono text-sm font-semibold">
          {quantity}
        </span>
        <span className="text-xs text-muted-foreground ml-1">
          {batch.unit || 'units'}
        </span>
      </div>
    </button>
  );
}

/**
 * BatchSelector - Component for selecting batches following FEFO
 * @param {Object} props
 * @param {Array} props.batches - Available batches
 * @param {Array} props.selectedBatches - Array of selected batch IDs
 * @param {Function} props.onSelectionChange - Callback when selection changes
 * @param {number} [props.requiredQuantity] - Quantity needed (highlights if not met)
 * @param {boolean} [props.showLocation=false] - Show location in options
 * @param {boolean} [props.multiple=true] - Allow multiple selection
 * @param {boolean} [props.autoSelectFEFO=false] - Auto-select based on FEFO
 * @param {boolean} [props.isLoading] - Loading state
 * @param {string} [props.placeholder] - Placeholder text
 * @param {string} [props.className] - Additional CSS classes
 */
export function BatchSelector({
  batches = EMPTY_ARRAY,
  selectedBatches = EMPTY_ARRAY,
  onSelectionChange,
  requiredQuantity,
  showLocation = false,
  multiple = true,
  autoSelectFEFO = false,
  isLoading,
  placeholder = 'Select batch...',
  className,
}) {
  const [open, setOpen] = useState(false);
  const listboxId = useId();

  // Sort batches by FEFO
  const sortedBatches = useMemo(() => sortByFEFO(batches), [batches]);
  const batchById = useMemo(() => createBatchMap(batches), [batches]);
  const selectedBatchSet = useMemo(() => new Set(selectedBatches), [selectedBatches]);
  const renderedAt = useMemo(() => new Date(), []);

  // Calculate selected quantity
  const selectedQuantity = useMemo(
    () => calculateSelectedQuantity(selectedBatches, batchById),
    [selectedBatches, batchById]
  );

  // Check if quantity requirement is met
  const quantityMet = !requiredQuantity || selectedQuantity >= requiredQuantity;
  const shortfall = requiredQuantity ? Math.max(0, requiredQuantity - selectedQuantity) : 0;

  // Handle batch selection
  const handleSelect = (batchId) => {
    if (!multiple) {
      onSelectionChange([batchId]);
      setOpen(false);
      return;
    }

    const isSelected = selectedBatchSet.has(batchId);
    if (isSelected) {
      onSelectionChange(selectedBatches.filter(id => id !== batchId));
    } else {
      onSelectionChange([...selectedBatches, batchId]);
    }
  };

  // Auto-select FEFO batches to meet quantity
  const handleAutoSelectFEFO = () => {
    if (!requiredQuantity || !sortedBatches.length) return;

    const selected = [];
    let remaining = requiredQuantity;

    for (const batch of sortedBatches) {
      const expiryDate = batch.expiry_date;
      const daysUntilExpiry = expiryDate ? differenceInDays(parseISO(expiryDate), new Date()) : null;
      const isExpired = daysUntilExpiry !== null && daysUntilExpiry < 0;

      if (isExpired) continue;

      const quantity = batch.quantity || batch.available_quantity || 0;
      if (quantity <= 0) continue;

      selected.push(batch.id);
      remaining -= quantity;

      if (remaining <= 0) break;
    }

    onSelectionChange(selected);
  };

  // Get display text for button
  const getDisplayText = () => {
    if (selectedBatches.length === 0) {
      return placeholder;
    }
    if (selectedBatches.length === 1) {
      const batch = batchById.get(selectedBatches[0]);
      return batch?.batch_number || 'Selected batch';
    }
    return `${selectedBatches.length} batches selected`;
  };

  if (isLoading) {
    return <Skeleton className={cn('h-10 w-full', className)} />;
  }

  if (!batches.length) {
    return (
      <div className={cn('flex items-center gap-2 p-3 bg-muted/50 rounded-lg text-muted-foreground', className)}>
        <Package className="size-4" />
        <span className="text-sm">No batches available</span>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-haspopup="listbox"
            className={cn(
              'w-full justify-between font-normal',
              selectedBatches.length === 0 && 'text-muted-foreground'
            )}
          >
            <span className="truncate">{getDisplayText()}</span>
            <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <div className="p-3 border-b border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Select Batches</span>
              {autoSelectFEFO && requiredQuantity && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleAutoSelectFEFO}
                  className="text-xs"
                >
                  Auto-select FEFO
                </Button>
              )}
            </div>
            {requiredQuantity && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Required:</span>
                <span className="font-mono font-medium">{requiredQuantity}</span>
                <span className="text-muted-foreground">|</span>
                <span className="text-muted-foreground">Selected:</span>
                <span className={cn(
                  'font-mono font-medium',
                  quantityMet ? 'text-emerald-500' : 'text-rose-500'
                )}>
                  {selectedQuantity}
                </span>
                {!quantityMet && (
                  <>
                    <span className="text-muted-foreground">|</span>
                    <span className="text-rose-500 font-mono">-{shortfall}</span>
                  </>
                )}
              </div>
            )}
          </div>
          <div id={listboxId} className="max-h-[300px] overflow-y-auto p-2 space-y-1">
            {sortedBatches.map((batch, index) => (
              <BatchOption
                key={batch.id}
                batch={batch}
                isSelected={selectedBatchSet.has(batch.id)}
                isRecommended={index === 0}
                onSelect={handleSelect}
                referenceDate={renderedAt}
                showLocation={showLocation}
              />
            ))}
          </div>
          {selectedBatches.length > 0 && (
            <div className="p-2 border-t border-border">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSelectionChange([])}
                className="w-full text-xs text-muted-foreground"
              >
                Clear selection
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Quantity warning */}
      {requiredQuantity && !quantityMet && selectedBatches.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-amber-500">
          <AlertTriangle className="size-3" />
          <span>Need {shortfall} more to meet required quantity</span>
        </div>
      )}
    </div>
  );
}

/**
 * SimpleBatchSelector - Single batch selection dropdown
 */
export function SimpleBatchSelector({
  batches = EMPTY_ARRAY,
  selectedBatch,
  onSelect,
  showLocation = false,
  isLoading,
  placeholder = 'Select batch...',
  className,
}) {
  return (
    <BatchSelector
      batches={batches}
      selectedBatches={selectedBatch ? [selectedBatch] : []}
      onSelectionChange={(ids) => onSelect(ids[0] || null)}
      showLocation={showLocation}
      multiple={false}
      isLoading={isLoading}
      placeholder={placeholder}
      className={className}
    />
  );
}

/**
 * BatchQuantityInput - Batch selector with quantity input per batch
 */
export function BatchQuantityInput({
  batches = EMPTY_ARRAY,
  allocations = EMPTY_ARRAY, // [{ batch_id, quantity }]
  onAllocationsChange,
  maxQuantity,
  showLocation = false,
  isLoading,
  className,
}) {
  const sortedBatches = useMemo(() => sortByFEFO(batches), [batches]);
  const batchById = useMemo(() => createBatchMap(batches), [batches]);
  const allocationByBatchId = useMemo(() => createAllocationMap(allocations), [allocations]);
  const renderedAt = useMemo(() => new Date(), []);

  const totalAllocated = useMemo(
    () => allocations.reduce((sum, a) => sum + (a.quantity || 0), 0),
    [allocations]
  );

  const handleQuantityChange = (batchId, quantity) => {
    const batch = batchById.get(batchId);
    const maxBatchQty = batch?.quantity || batch?.available_quantity || 0;
    const clampedQty = Math.max(0, Math.min(quantity, maxBatchQty));

    const existing = allocationByBatchId.get(batchId);
    if (existing) {
      if (clampedQty === 0) {
        onAllocationsChange(allocations.filter(a => a.batch_id !== batchId));
      } else {
        onAllocationsChange(
          allocations.map(a => a.batch_id === batchId ? { ...a, quantity: clampedQty } : a)
        );
      }
    } else if (clampedQty > 0) {
      onAllocationsChange([...allocations, { batch_id: batchId, quantity: clampedQty }]);
    }
  };

  if (isLoading) {
    return (
      <div className={cn('space-y-2', className)}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!batches.length) {
    return (
      <div className={cn('flex items-center gap-2 p-3 bg-muted/50 rounded-lg text-muted-foreground', className)}>
        <Package className="size-4" />
        <span className="text-sm">No batches available</span>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {maxQuantity && (
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
          <span>Allocate from batches (FEFO order)</span>
          <span className={cn(
            'font-mono',
            totalAllocated > maxQuantity ? 'text-rose-500' : 'text-emerald-500'
          )}>
            {totalAllocated} / {maxQuantity}
          </span>
        </div>
      )}

      {sortedBatches.map((batch, index) => {
        const allocation = allocationByBatchId.get(batch.id);
        const quantity = allocation?.quantity || 0;
        const maxBatchQty = batch.quantity || batch.available_quantity || 0;
        const expiryDate = batch.expiry_date;
        const daysUntilExpiry = expiryDate ? differenceInDays(parseISO(expiryDate), renderedAt) : null;
        const isExpired = daysUntilExpiry !== null && daysUntilExpiry < 0;

        return (
          <div
            key={batch.id}
            className={cn(
              'flex items-center gap-3 p-3 rounded-lg border',
              quantity > 0 ? 'border-primary/30 bg-primary/5' : 'border-border',
              isExpired && 'opacity-50'
            )}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-sm">
                  {batch.batch_number || 'No batch #'}
                </span>
                {index === 0 && !isExpired && (
                  <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
                    FEFO
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {showLocation && batch.location_name && (
                  <span>{batch.location_name}</span>
                )}
                {expiryDate && (
                  <ExpiryBadge expiryDate={expiryDate} size="sm" />
                )}
                <span className="font-mono">Avail: {maxBatchQty}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={maxBatchQty}
                value={quantity}
                onChange={(e) => handleQuantityChange(batch.id, parseInt(e.target.value) || 0)}
                disabled={isExpired}
                className="w-20 text-center font-mono"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleQuantityChange(batch.id, maxBatchQty)}
                disabled={isExpired || quantity === maxBatchQty}
                className="text-xs"
              >
                Max
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
