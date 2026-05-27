import X from 'lucide-react/dist/esm/icons/x.js';
import Droplets from 'lucide-react/dist/esm/icons/droplets.js';
import ArrowDownCircle from 'lucide-react/dist/esm/icons/circle-arrow-down.js';
import ArrowUpCircle from 'lucide-react/dist/esm/icons/circle-arrow-up.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import History from 'lucide-react/dist/esm/icons/history.js';
import format from 'date-fns/format';
import startOfDay from 'date-fns/startOfDay';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

const QUICK_AMOUNTS = [50, 100, 150, 200, 250, 500];

const CATEGORY_LABELS = {
  oral: 'Oral',
  iv: 'IV',
  enteral: 'Enteral',
  blood: 'Blood',
  urine: 'Urine',
  vomit: 'Vomit',
  stool: 'Stool',
  drain: 'Drain',
  ng_suction: 'N.G. Suction',
  other: 'Other',
};

const getCategoryLabel = (category) => CATEGORY_LABELS[category] || category;

function BalanceSummary({ intake, output, balance, label }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-muted/30 rounded-lg">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <ArrowDownCircle className="size-3.5 text-sky-500" />
          <span className="font-mono text-sm text-sky-600">{intake}ml</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ArrowUpCircle className="size-3.5 text-amber-500" />
          <span className="font-mono text-sm text-amber-600">{output}ml</span>
        </div>
        <div
          className={cn(
            'font-mono text-sm font-medium px-2 py-0.5 rounded',
            balance > 0 && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
            balance < 0 && 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
            balance === 0 && 'bg-muted text-muted-foreground',
          )}
        >
          {balance > 0 ? '+' : ''}{balance}ml
        </div>
      </div>
    </div>
  );
}

function FluidEntryRow({
  record,
  allowDelete = true,
  deletionAvailable,
  deletePending,
  onDelete,
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between p-3 rounded-lg border',
        record.entry_type === 'intake'
          ? 'bg-sky-50/50 border-sky-200 dark:bg-sky-900/10 dark:border-sky-800'
          : 'bg-amber-50/50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-800',
      )}
    >
      <div className="flex items-center gap-3">
        {record.entry_type === 'intake' ? (
          <ArrowDownCircle className="size-4 text-sky-500 flex-shrink-0" />
        ) : (
          <ArrowUpCircle className="size-4 text-amber-500 flex-shrink-0" />
        )}
        <div>
          <div className="font-mono text-sm">
            <span className={record.entry_type === 'intake' ? 'text-sky-700 dark:text-sky-400' : 'text-amber-700 dark:text-amber-400'}>
              {record.volume_ml}ml
            </span>
            <span className="text-muted-foreground ml-2">
              {getCategoryLabel(record.category)}
              {record.subcategory && ` - ${record.subcategory}`}
            </span>
            {record.entry_type === 'output' && record.colour && (
              <span className="text-muted-foreground ml-2 italic">
                ({record.colour})
              </span>
            )}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {format(new Date(record.recorded_at), 'h:mm a')}
            {record.notes && <span className="ml-2">• {record.notes}</span>}
          </div>
        </div>
      </div>
      {allowDelete && deletionAvailable && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Delete fluid balance entry"
          className="size-7 text-muted-foreground hover:text-destructive flex-shrink-0"
          onClick={() => onDelete(record.id)}
          disabled={deletePending}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

export function FluidBalanceHeader({ patientName, onClose }) {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-900/30">
          <Droplets className="size-5 text-sky-600 dark:text-sky-400" />
        </div>
        <div>
          <h2 className="font-display text-xl text-foreground">
            Fluid Balance
          </h2>
          <p className="font-mono text-xs text-muted-foreground mt-0.5">
            {patientName}
          </p>
        </div>
      </div>

      <Button
        variant="destructive"
        size="sm"
        onClick={onClose}
        className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
      >
        <X className="size-4 mr-1.5" />
        Close
      </Button>
    </header>
  );
}

export function FluidBalanceTabs({ allowEntry, activeTab, onTabChange }) {
  return (
    <div className="flex border-b border-border bg-card">
      {allowEntry && (
        <button
          type="button"
          onClick={() => onTabChange('entry')}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 px-4 py-3 font-mono text-sm transition-colors',
            'border-b-2',
            activeTab === 'entry'
              ? 'border-sky-500 text-sky-600 bg-sky-50/50 dark:bg-sky-900/10'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50',
          )}
        >
          <Plus className="size-4" />
          Record Entry
        </button>
      )}
      <button
        type="button"
        onClick={() => onTabChange('history')}
        className={cn(
          'flex items-center justify-center gap-2 px-4 py-3 font-mono text-sm transition-colors',
          'border-b-2',
          allowEntry ? 'flex-1' : 'w-full',
          activeTab === 'history'
            ? 'border-amber-500 text-amber-600 bg-amber-50/50 dark:bg-amber-900/10'
            : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50',
        )}
      >
        <History className="size-4" />
        History
      </button>
    </div>
  );
}

function RustV2DeletionNotice({ visible }) {
  if (!visible) {
    return null;
  }

  return (
    <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 font-mono text-xs text-amber-900 dark:text-amber-100">
      Fluid balance deletion is not available in Rust V2 mode yet.
    </div>
  );
}

function EntryTypeToggle({ value, onTypeChange }) {
  return (
    <div className="space-y-2">
      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Entry Type
      </Label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onTypeChange('intake')}
          className={cn(
            'flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-all',
            'font-mono text-sm',
            value === 'intake'
              ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400'
              : 'border-border hover:border-sky-300 text-muted-foreground',
          )}
        >
          <ArrowDownCircle className="size-4" />
          Intake (IN)
        </button>
        <button
          type="button"
          onClick={() => onTypeChange('output')}
          className={cn(
            'flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-all',
            'font-mono text-sm',
            value === 'output'
              ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
              : 'border-border hover:border-amber-300 text-muted-foreground',
          )}
        >
          <ArrowUpCircle className="size-4" />
          Output (OUT)
        </button>
      </div>
    </div>
  );
}

function CategoryFields({
  formData,
  categoryOptions,
  subcategoryOptions,
  onCategoryChange,
  onSubcategoryChange,
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Category *
        </Label>
        <Select value={formData.category} onValueChange={onCategoryChange}>
          <SelectTrigger className="font-mono">
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent className="z-[200]">
            {categoryOptions.map((option) => (
              <SelectItem key={option.value} value={option.value} className="font-mono">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Subcategory
        </Label>
        <Select
          value={formData.subcategory}
          onValueChange={onSubcategoryChange}
          disabled={!formData.category || subcategoryOptions.length === 0}
        >
          <SelectTrigger className="font-mono">
            <SelectValue placeholder="Optional..." />
          </SelectTrigger>
          <SelectContent className="z-[200]">
            {subcategoryOptions.map((option) => (
              <SelectItem key={option.value} value={option.value} className="font-mono">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function AmountField({ value, onAmountChange }) {
  return (
    <div className="space-y-2">
      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Amount *
      </Label>
      <div className="relative">
        <Input
          type="number"
          placeholder="Enter amount"
          value={value}
          onChange={(event) => onAmountChange(event.target.value)}
          className="font-mono pr-12 text-lg"
          min="1"
          max="10000"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono">
          ml
        </span>
      </div>
      <div className="flex flex-wrap gap-2 mt-2">
        {QUICK_AMOUNTS.map((amount) => (
          <button
            key={amount}
            type="button"
            onClick={() => onAmountChange(amount.toString())}
            className={cn(
              'px-3 py-1.5 rounded font-mono text-xs transition-colors',
              value === amount.toString()
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80 text-muted-foreground',
            )}
          >
            {amount}ml
          </button>
        ))}
      </div>
    </div>
  );
}

function FluidEntryForm({
  formData,
  categoryOptions,
  subcategoryOptions,
  onTypeChange,
  onCategoryChange,
  onSubcategoryChange,
  onFieldChange,
}) {
  return (
    <div className="mt-6 space-y-5">
      <EntryTypeToggle value={formData.type} onTypeChange={onTypeChange} />
      <CategoryFields
        formData={formData}
        categoryOptions={categoryOptions}
        subcategoryOptions={subcategoryOptions}
        onCategoryChange={onCategoryChange}
        onSubcategoryChange={onSubcategoryChange}
      />
      <AmountField value={formData.amount} onAmountChange={(value) => onFieldChange('amount', value)} />

      {formData.type === 'output' && (
        <div className="space-y-2">
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Colour
          </Label>
          <Input
            type="text"
            placeholder="e.g., clear, dark amber, cloudy, bloody..."
            value={formData.colour}
            onChange={(event) => onFieldChange('colour', event.target.value)}
            className="font-mono text-sm"
          />
        </div>
      )}

      <div className="space-y-2">
        <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Notes
        </Label>
        <Textarea
          placeholder="Any additional observations..."
          value={formData.notes}
          onChange={(event) => onFieldChange('notes', event.target.value)}
          className="font-mono text-sm resize-none"
          rows={2}
        />
      </div>
    </div>
  );
}

function RecentFluidEntries({
  records,
  loading,
  deletionAvailable,
  deletePending,
  onDelete,
}) {
  if (records.length === 0) {
    return null;
  }

  return (
    <>
      <div className="my-6 border-t border-border" />
      <div>
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">
          Today's Entries
        </h3>
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {records.map((record) => (
              <FluidEntryRow
                key={record.id}
                record={record}
                allowDelete
                deletionAvailable={deletionAvailable}
                deletePending={deletePending}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function FluidEntryFooter({
  formData,
  isPending,
  onCancel,
  onSubmit,
}) {
  return (
    <footer className="px-6 py-4 border-t border-border bg-card">
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="font-mono text-xs"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={isPending || !formData.category || !formData.amount}
          className={cn(
            'font-mono text-xs',
            formData.type === 'intake'
              ? 'bg-sky-600 hover:bg-sky-700'
              : 'bg-amber-600 hover:bg-amber-700',
          )}
        >
          {isPending ? (
            <>
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              Recording…
            </>
          ) : (
            <>
              <Check className="size-3.5 mr-1.5" />
              Record {formData.type === 'intake' ? 'Intake' : 'Output'}
            </>
          )}
        </Button>
      </div>
    </footer>
  );
}

export function FluidEntryTab({
  formData,
  categoryOptions,
  subcategoryOptions,
  summary,
  records,
  loading,
  rustV2Mode,
  deletionAvailable,
  deletePending,
  createPending,
  onTypeChange,
  onCategoryChange,
  onSubcategoryChange,
  onFieldChange,
  onDelete,
  onCancel,
  onSubmit,
}) {
  return (
    <>
      <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
        <BalanceSummary
          intake={summary.intake}
          output={summary.output}
          balance={summary.balance}
          label="Today's Balance"
        />
        <RustV2DeletionNotice visible={rustV2Mode} />
        <FluidEntryForm
          formData={formData}
          categoryOptions={categoryOptions}
          subcategoryOptions={subcategoryOptions}
          onTypeChange={onTypeChange}
          onCategoryChange={onCategoryChange}
          onSubcategoryChange={onSubcategoryChange}
          onFieldChange={onFieldChange}
        />
        <RecentFluidEntries
          records={records}
          loading={loading}
          deletionAvailable={deletionAvailable}
          deletePending={deletePending}
          onDelete={onDelete}
        />
      </div>
      <FluidEntryFooter
        formData={formData}
        isPending={createPending}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </>
  );
}

function FluidHistoryDateNav({
  historyDate,
  calendarOpen,
  isHistoryToday,
  maxHistoryDate,
  onCalendarOpenChange,
  onDateSelect,
  onPreviousDay,
  onNextDay,
  onToday,
}) {
  return (
    <div className="px-6 py-3 bg-muted/50 border-b border-border">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onPreviousDay}
          >
            <ChevronLeft className="size-4" />
          </Button>

          <Popover open={calendarOpen} onOpenChange={onCalendarOpenChange}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="min-w-[180px] justify-start text-left font-mono text-sm"
              >
                <CalendarIcon className="mr-2 size-4" />
                {format(historyDate, 'EEE, MMM d, yyyy')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 z-[200]" align="start">
              <Calendar
                mode="single"
                selected={historyDate}
                onSelect={onDateSelect}
                disabled={(date) => startOfDay(date) > maxHistoryDate}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onNextDay}
            disabled={isHistoryToday}
          >
            <ChevronRight className="size-4" />
          </Button>

          {!isHistoryToday && (
            <Button
              variant="outline"
              size="sm"
              onClick={onToday}
              className="font-mono text-xs ml-2"
            >
              Today
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function FluidHistoryContent({
  historyDate,
  isHistoryToday,
  summary,
  records,
  loading,
  rustV2Mode,
  deletionAvailable,
  deletePending,
  onDelete,
}) {
  return (
    <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
      <BalanceSummary
        intake={summary.intake}
        output={summary.output}
        balance={summary.balance}
        label={isHistoryToday ? "Today's Balance" : `${format(historyDate, 'MMM d')} Balance`}
      />
      <RustV2DeletionNotice visible={rustV2Mode} />

      <div className="mt-6">
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">
          {isHistoryToday ? "Today's Entries" : `Entries for ${format(historyDate, 'MMMM d, yyyy')}`}
        </h3>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Droplets className="size-8 mx-auto mb-2 opacity-50" />
            <p className="font-mono text-sm">No entries recorded for this date</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="space-y-2 pr-4">
              {records.map((record) => (
                <FluidEntryRow
                  key={record.id}
                  record={record}
                  allowDelete={isHistoryToday}
                  deletionAvailable={deletionAvailable}
                  deletePending={deletePending}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

function FluidHistoryFooter({ count, onClose }) {
  return (
    <footer className="px-6 py-4 border-t border-border bg-card">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs text-muted-foreground">
          {count} {count === 1 ? 'entry' : 'entries'}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={onClose}
          className="font-mono text-xs"
        >
          Close
        </Button>
      </div>
    </footer>
  );
}

export function FluidHistoryTab({
  historyDate,
  calendarOpen,
  isHistoryToday,
  maxHistoryDate,
  summary,
  records,
  loading,
  rustV2Mode,
  deletionAvailable,
  deletePending,
  onCalendarOpenChange,
  onDateSelect,
  onPreviousDay,
  onNextDay,
  onToday,
  onDelete,
  onClose,
}) {
  return (
    <>
      <FluidHistoryDateNav
        historyDate={historyDate}
        calendarOpen={calendarOpen}
        isHistoryToday={isHistoryToday}
        maxHistoryDate={maxHistoryDate}
        onCalendarOpenChange={onCalendarOpenChange}
        onDateSelect={onDateSelect}
        onPreviousDay={onPreviousDay}
        onNextDay={onNextDay}
        onToday={onToday}
      />
      <FluidHistoryContent
        historyDate={historyDate}
        isHistoryToday={isHistoryToday}
        summary={summary}
        records={records}
        loading={loading}
        rustV2Mode={rustV2Mode}
        deletionAvailable={deletionAvailable}
        deletePending={deletePending}
        onDelete={onDelete}
      />
      <FluidHistoryFooter count={records.length} onClose={onClose} />
    </>
  );
}
