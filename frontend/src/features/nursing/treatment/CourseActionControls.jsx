import { Button } from '@/components/ui/button';

export function CourseActionControls({ controller, kind, review, confirmed, permitted, stale, onPrepare, onEdit, onDiscard }) {
  if (controller.unknown) return <div className="flex flex-wrap gap-3"><Button type="button" variant="outline" disabled={controller.busy} onClick={() => controller.run(null, true)}>Check original saved result</Button><Button type="button" disabled={controller.busy || !permitted} onClick={() => controller.run()}>Retry exact course change</Button></div>;
  const content = review ? <><Button type="button" variant="outline" disabled={controller.busy || stale || !permitted} onClick={onEdit}>Edit review</Button><Button type="button" disabled={!confirmed || controller.busy || !permitted || stale} onClick={() => controller.run(review)}>{controller.busy ? 'Saving course change…' : kind === 'stop' ? 'Confirm admission-course stop' : 'Create reviewed schedule window'}</Button></> : <Button type="button" disabled={!permitted || stale} onClick={onPrepare}>Review course change</Button>;
  return <div className="flex flex-wrap gap-3">{content}<Button type="button" variant="ghost" disabled={controller.busy} onClick={onDiscard}>Discard course change</Button></div>;
}
