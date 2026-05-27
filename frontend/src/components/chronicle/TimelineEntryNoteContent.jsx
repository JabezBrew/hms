import { lazy, Suspense } from 'react';

const ChronicleNoteBody = lazy(() => import('./ChronicleNoteBody'));

const PREVIEW_SECTION_ORDER = [
  'subjective', 'objective', 'assessment', 'plan',
  'chief_complaint', 'chiefComplaint', 'history', 'examination',
  'diagnosis', 'treatment', 'findings', 'recommendations',
];

const NoteBodyFallback = () => (
  <div className="space-y-3">
    <div className="h-4 w-24 rounded bg-muted/80" />
    <div className="h-4 w-full rounded bg-muted/70" />
    <div className="h-4 w-5/6 rounded bg-muted/60" />
    <div className="h-4 w-2/3 rounded bg-muted/50" />
  </div>
);

export const ExpandedNoteContent = ({ entry, noteBodyId }) => (
  <div className="space-y-4">
    {entry.title && (
      <h4 className="font-medium text-foreground">{entry.title}</h4>
    )}
    <div
      id={noteBodyId}
      className="rounded-xl border border-border/70 bg-background/80 p-4 shadow-sm"
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: '320px',
      }}
    >
      <Suspense fallback={<NoteBodyFallback />}>
        <ChronicleNoteBody
          content={entry.content}
          data={entry.data}
        />
      </Suspense>
    </div>
  </div>
);

export const NotePreview = ({ entry }) => {
  const { title, content, data } = entry;

  const getPreviewItems = () => {
    if (!data || typeof data !== 'object') return [];

    const items = [];
    const keys = Object.keys(data).sort((a, b) => {
      const indexA = PREVIEW_SECTION_ORDER.indexOf(a.toLowerCase());
      const indexB = PREVIEW_SECTION_ORDER.indexOf(b.toLowerCase());
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return 0;
    });

    for (const key of keys) {
      if (items.length >= 2) break;

      const value = data[key];
      if (!value) continue;

      let preview = null;
      if (typeof value === 'string') {
        preview = value.slice(0, 120);
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        const previewFields = [
          'chief_complaint',
          'chiefComplaint',
          'primary_diagnosis',
          'primaryDiagnosis',
          'summary',
          'description',
          'reason',
          'findings',
        ];
        for (const field of previewFields) {
          if (value[field] && typeof value[field] === 'string') {
            preview = value[field].slice(0, 120);
            break;
          }
        }
        if (!preview) {
          for (const fieldValue of Object.values(value)) {
            if (typeof fieldValue === 'string') {
              preview = fieldValue.slice(0, 120);
              break;
            }
          }
        }
      }

      if (preview) {
        const label = key
          .replace(/_/g, ' ')
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/\b\w/g, c => c.toUpperCase());
        items.push({ label, preview });
      }
    }

    return items;
  };

  const previewItems = getPreviewItems();

  return (
    <div className="space-y-2">
      {title && (
        <h4 className="font-medium text-foreground/90">{title}</h4>
      )}

      {previewItems.map((item) => (
        <div key={`${item.label}-${item.preview}`}>
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground/70">
            {item.label}:{' '}
          </span>
          <span className="text-sm text-muted-foreground">
            {item.preview}{item.preview.length >= 120 ? '...' : ''}
          </span>
        </div>
      ))}

      {previewItems.length === 0 && content && (
        <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
          {content}
        </p>
      )}

      {previewItems.length === 0 && !content && (
        <p className="text-sm text-muted-foreground/60 italic">
          Open details to review this entry.
        </p>
      )}
    </div>
  );
};
