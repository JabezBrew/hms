import { MedicationContent } from './TimelineEntryMedicationContent';
import { ExpandedNoteContent, NotePreview } from './TimelineEntryNoteContent';
import { ReferralContent } from './TimelineEntryReferralContent';
import { LabResultContent, VitalsContent } from './TimelineEntryVitalsLabContent';

const ChartSummaryContent = ({ entry }) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between gap-3">
      <p className="font-medium text-foreground">
        {entry.data?.template_name || entry.title || 'Clinical Chart'}
      </p>
      {entry.data?.scope_type && (
        <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
          {entry.data.scope_type}
        </span>
      )}
    </div>
    {entry.content && (
      <p className="text-sm text-muted-foreground">{entry.content}</p>
    )}
    {entry.data?.notes && (
      <p className="text-xs text-muted-foreground">{entry.data.notes}</p>
    )}
  </div>
);

export const TimelineEntryContent = ({ entry, canInlineExpand, noteExpanded, noteBodyId }) => {
  switch (entry.type) {
    case 'vitals':
      return <VitalsContent vitals={entry.data} />;
    case 'lab_result':
      return <LabResultContent result={entry.data} />;
    case 'medication':
    case 'prescription':
      return <MedicationContent medication={entry.data} entry={entry} />;
    case 'referral':
      return <ReferralContent referral={entry.data} />;
    case 'chart':
      return <ChartSummaryContent entry={entry} />;
    default:
      if (canInlineExpand && noteExpanded) {
        return (
          <ExpandedNoteContent
            entry={entry}
            noteBodyId={noteBodyId}
          />
        );
      }

      return <NotePreview entry={entry} />;
  }
};

export {
  LabResultContent,
  MedicationContent,
  NotePreview,
  ReferralContent,
  VitalsContent,
};
