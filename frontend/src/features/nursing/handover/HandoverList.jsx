import { Button } from '@/components/ui/button';

export function HandoverList({ admissionId, canWrite, locked, onStart, onListFilter, onHistoryScope, includeVoided, allHistory, list, onSelect }) {
  return <aside className="grid content-start gap-3">
    <div className="flex flex-wrap gap-2">
      {admissionId && canWrite && <Button type="button" size="sm" disabled={locked} onClick={() => onStart('record')}>Record handover</Button>}
      <Button type="button" size="sm" variant="outline" disabled={locked} onClick={onListFilter}>{includeVoided ? 'Hide voided reports' : 'Show voided reports'}</Button>
      {admissionId && <Button type="button" size="sm" variant="outline" disabled={locked} onClick={onHistoryScope}>{allHistory ? 'Selected admission history' : 'All patient handover history'}</Button>}
    </div>
    <p className="text-xs text-muted-foreground">{allHistory || !admissionId ? 'History across this patient’s authorized wards.' : 'Selected admission history.'} This is a bounded page, not a complete count.</p>
    <ul className="grid gap-2">{list.data?.rows.map((row) => <li key={row.id}>
      <Button type="button" variant="outline" disabled={locked} className="h-auto w-full justify-start whitespace-normal px-3 py-3 text-left" onClick={() => onSelect(row.id)}>
        <span>{row.shift_date} · {row.shift_type}<span className="block text-xs font-normal text-muted-foreground">{row.author_display_name} · {row.ward_name} · {row.status} · Revision {row.revision}{admissionId && row.admission_case_id !== admissionId ? ' · Earlier admission' : ''}</span></span>
      </Button>
    </li>)}</ul>
    {list.data?.rows.length === 0 && <p className="text-sm text-muted-foreground">No handovers in this page and scope.</p>}
    {list.controls}
  </aside>;
}
