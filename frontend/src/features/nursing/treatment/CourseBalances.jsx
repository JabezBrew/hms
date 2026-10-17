import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function CourseBalances({ counts }) {
  const values = [
    ['Generated scheduled doses', counts.generated_scheduled_doses], ['Requested as-needed doses', counts.requested_prn_doses],
    ['Supplied doses', counts.supplied_doses], ['Given doses', counts.given_doses], ['Awaiting supply', counts.awaiting_supply_doses], ['Supplied, outcome pending', counts.supplied_pending_doses],
    ['Missed', counts.missed_doses], ['Refused', counts.refused_doses], ['Held', counts.held_doses],
  ];
  const physical = counts.issued_stock_quantity !== null && counts.issued_stock_unit ? `${counts.issued_stock_quantity} ${counts.issued_stock_unit}` : 'Not recorded as a complete stock total';
  return <Card><CardHeader><CardTitle className="text-base">Whole-course dose records</CardTitle><CardDescription>Totals for the entire admission course, independent of the history page below.</CardDescription></CardHeader><CardContent className="grid gap-4">
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">{values.map(([title, amount]) => <div key={title} className="min-w-0"><dt className="text-xs text-muted-foreground">{title}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{amount}</dd></div>)}</dl>
    <dl className="grid gap-3 border-t pt-4 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Recorded physical stock issued</dt><dd className="font-medium">{physical}</dd></div><div><dt className="text-muted-foreground">Days of supply</dt><dd className="font-medium">Not estimated</dd></div></dl>
    {counts.issued_stock_unrecorded_doses > 0 && <p className="text-sm text-muted-foreground">{counts.issued_stock_unrecorded_doses} supplied doses have incomplete physical-stock evidence.</p>}
    {counts.stock_total_unavailable_reason === 'mixed_units' && <p className="text-sm text-muted-foreground">Earlier stock units differ. A combined physical quantity is unavailable.</p>}
    {counts.stock_total_unavailable_reason === 'quantity_overflow' && <p className="text-sm text-muted-foreground">The complete physical quantity exceeds the supported range.</p>}
    <p className="text-xs text-muted-foreground">{counts.explicit_non_given_doses} explicit non-Given outcomes · {counts.unrecorded_held_doses} held records without an explicit outcome. Supplied doses with a non-Given outcome remain issue evidence; these totals do not establish bedside stock or a stock return.</p>
  </CardContent></Card>;
}
