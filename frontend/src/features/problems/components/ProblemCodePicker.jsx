import { useEffect, useRef, useState } from 'react';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import Search from 'lucide-react/dist/esm/icons/search.js';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';

import { useSearchProblemCodes } from '../hooks';

/**
 * ProblemCodePicker
 *
 * Inline search-as-you-type picker for ProblemCode entries.
 * Quick-picks (Ghana common conditions) surface first when q is empty.
 * Free-text fallback exposed when no codes match.
 *
 * Props:
 *   onSelect(code | { freeText: string })  required
 *   autoFocus
 *   showFreeTextFallback (default: true)
 */
export default function ProblemCodePicker({
  onSelect,
  autoFocus = false,
  showFreeTextFallback = true,
  className,
}) {
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 250);
  const inputRef = useRef(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
  }, [autoFocus]);

  const trimmed = debouncedQ.trim();
  const { data, isLoading, isFetching } = useSearchProblemCodes(trimmed, {
    quickPicksOnly: trimmed.length === 0,
  });

  const codes = data || [];
  const showLoading = isLoading || (q !== debouncedQ && q.length > 0);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by ICD-10 code or condition name…"
          className="pl-9"
        />
        {(isFetching || showLoading) && (
          <LoadingSpinner className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        )}
      </div>

      <ScrollArea className="h-72 rounded-md border">
        {codes.length === 0 && !showLoading ? (
          <div className="p-4 text-sm text-muted-foreground space-y-3">
            <p>No matches.</p>
            {showFreeTextFallback && trimmed.length >= 3 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onSelect({ freeText: trimmed })}
              >
                Add as free text: "{trimmed}"
              </Button>
            )}
          </div>
        ) : (
          <ul className="divide-y">
            {codes.map((code) => (
              <li key={code.id}>
                <button
                  type="button"
                  onClick={() => onSelect(code)}
                  className="w-full flex items-start gap-3 p-3 text-left hover:bg-muted/60 focus:bg-muted focus:outline-none"
                >
                  <code className="font-mono text-xs text-muted-foreground tabular-nums shrink-0 mt-0.5 w-16">
                    {code.code}
                  </code>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{code.display}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        {code.code_system}
                      </span>
                      {code.is_quick_pick && (
                        <Badge variant="secondary" className="text-[10px] py-0 h-4">
                          Common
                        </Badge>
                      )}
                      {code.is_chronic_default && (
                        <Badge variant="outline" className="text-[10px] py-0 h-4">
                          Chronic
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
