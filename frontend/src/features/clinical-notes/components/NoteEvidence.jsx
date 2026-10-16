import ChronicleNoteBody from '@/components/chronicle/ChronicleNoteBody';
import { Badge } from '@/components/ui/badge';

export function NoteEvidence({ note, title = 'Recorded note', proposed = false }) {
  let data = null; try { data = JSON.parse(note.body); } catch { /* Free text uses content. */ }
  return <section aria-label={title} className="flex min-w-0 flex-col gap-4 rounded-xl border p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-medium">{note.title || title}</h3><p className="text-sm text-muted-foreground">{proposed ? 'Reviewed local request' : note.author_display_name || (note.author_user_id ? 'Author name unavailable' : 'Original author not recorded')}{!proposed && note.created_at && ` · ${new Date(note.created_at).toLocaleString()}`}</p></div><Badge variant="secondary">{proposed ? 'Proposed version' : 'Version'} {note.version}</Badge></div>
    {note.template_revision && <p className="text-sm text-muted-foreground">Original template: {note.template_revision.title} · revision {note.template_revision.version}. Later template changes do not rewrite this note.</p>}
    <ChronicleNoteBody content={data === null ? note.body : undefined} data={data} />
  </section>;
}
