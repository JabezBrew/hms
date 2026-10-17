import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { responseLabels } from '../model';
const timestamp = value => value === null ? 'Not recorded' : new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC');
export function ResponseEvidence({ response, title = 'Recorded response' }) {
  if (!response) return <p className="text-sm text-muted-foreground">No response has been recorded for this referral.</p>;
  return <Card className="min-w-0"><CardHeader><CardTitle>{title} · version {response.version}</CardTitle><CardDescription className="break-words">{response.to_service} · {responseLabels[response.operation]} · {response.status}</CardDescription></CardHeader><CardContent className="flex min-w-0 flex-col gap-4 break-words">
    <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Recorded by</dt><dd>{response.recorded_by_display_name || 'Original author not recorded'}</dd></div><div><dt className="text-muted-foreground">{response.imported_legacy ? 'Observed at' : 'Recorded at'}</dt><dd className="font-mono text-xs">{timestamp(response.recorded_at)}</dd></div><div><dt className="text-muted-foreground">Recorded priority</dt><dd className="capitalize">{response.priority}</dd></div><div><dt className="text-muted-foreground">Original completion time</dt><dd className="font-mono text-xs">{timestamp(response.completed_at)}</dd></div></dl>
    {response.imported_legacy && <Alert><AlertDescription>This is imported response evidence. The observation time does not establish when the original clinical response was written, and an unknown original author remains unknown.</AlertDescription></Alert>}
    <div><h4 className="mb-1 text-sm font-medium">Specialist notes</h4><p className="whitespace-pre-wrap break-words text-sm">{response.specialist_notes === null ? 'Not recorded' : response.specialist_notes || 'No specialist notes entered'}</p></div>
    <div><h4 className="mb-1 text-sm font-medium">Recommendations</h4><p className="whitespace-pre-wrap break-words text-sm">{response.recommendations === null ? 'Not recorded' : response.recommendations || 'No recommendations entered'}</p></div>
    {response.amendment_reason !== null && <div><h4 className="mb-1 text-sm font-medium">Amendment reason</h4><p className="whitespace-pre-wrap break-words text-sm">{response.amendment_reason}</p></div>}
  </CardContent></Card>;
}
