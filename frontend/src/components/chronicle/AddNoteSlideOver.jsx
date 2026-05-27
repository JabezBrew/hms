import { cn } from "@/lib/utils";

import { AddNoteWorkflowPanel } from "./AddNoteSlideOverSections";
import { useAddNoteSlideOverController } from "./useAddNoteSlideOverController";

function buildContentKey({ open, patientId, editNoteId, initialTemplate }) {
  if (!open) {
    return 'closed';
  }

  return [
    'open',
    patientId || 'unknown-patient',
    editNoteId || 'new-note',
    initialTemplate?.id || 'manual-template',
  ].join(':');
}

/**
 * AddNoteSlideOver - Split-screen panel for creating/editing clinical notes.
 * PatientChroniclePage owns placement; this component keeps note creation in the chronicle surface.
 */
const AddNoteSlideOver = ({
  open,
  onClose,
  patient,
  encounter = null,
  onNoteCreated,
  initialTemplate = null,
  initialData = null,
  editNoteId = null,
}) => {
  const patientId = patient?.local_data?.id || patient?.id;
  const contentKey = buildContentKey({ open, patientId, editNoteId, initialTemplate });

  return (
    <div
      className={cn(
        "fixed inset-y-0 right-0 z-[100] w-full lg:w-1/2 bg-background border-l border-border",
        "transform transition-transform duration-300 ease-in-out",
        "flex flex-col shadow-2xl",
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      <AddNoteSlideOverContent
        key={contentKey}
        open={open}
        onClose={onClose}
        patient={patient}
        patientId={patientId}
        encounter={encounter}
        onNoteCreated={onNoteCreated}
        initialTemplate={initialTemplate}
        initialData={initialData}
        editNoteId={editNoteId}
      />
    </div>
  );
};

function AddNoteSlideOverContent(props) {
  const panelProps = useAddNoteSlideOverController(props);

  return <AddNoteWorkflowPanel {...panelProps} />;
}

export default AddNoteSlideOver;
export { AddNoteSlideOver };
