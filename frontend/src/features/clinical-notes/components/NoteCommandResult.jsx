import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { NoteEvidence } from './NoteEvidence';

export function NoteCommandResult({ controller, onCurrent }) {
  if (controller.saved) return <div className="flex flex-col gap-4"><Alert><AlertDescription>Note saved. This is the original saved receipt; later amendments may change the current record.</AlertDescription></Alert><NoteEvidence note={controller.saved.note} title="Original saved result" />{controller.refreshFailed && <Alert variant="destructive"><AlertDescription>The save is confirmed, but the current timeline could not refresh. Refresh before another change.</AlertDescription></Alert>}{onCurrent && <Button type="button" variant="outline" onClick={onCurrent}>Review current note</Button>}</div>;
  return <div className="flex flex-col gap-4"><Alert variant="destructive"><AlertDescription>{controller.error}</AlertDescription></Alert><NoteEvidence proposed note={{ ...controller.frozen.source, ...controller.frozen.payload, title: controller.frozen.payload.title || controller.frozen.source?.title, version: controller.frozen.payload.expected_version || 1 }} title="Unchanged reviewed note" /></div>;
}
export function NoteCommandActions({ controller, canWrite }) { return <><Button type="button" variant="outline" disabled={controller.busy} onClick={() => controller.run(null, true)}>Check original saved result</Button><Button type="button" disabled={controller.busy || !canWrite} onClick={() => controller.run()}>Retry exact note change</Button></>; }
