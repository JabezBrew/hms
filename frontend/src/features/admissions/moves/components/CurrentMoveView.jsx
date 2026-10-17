import { MoveButton as Button } from './MoveButton';
import { PlacementEvidence } from './PlacementEvidence';
import { MoveEditor } from './MoveEditor';
import { MoveHistory } from './MoveHistory';
import { ManualMoveReview } from './ManualMoveReview';
import { moveUnavailableCopy } from '../model';
export function CurrentMoveView(props) {
  const { query, ready, current, history, setHistory, scope, onDenied, access, open } = props;
  if (query.isError) return <p role="alert">Current placement could not be confirmed. Earlier cached content is hidden; refresh before continuing.</p>;
  if (!ready) return <p role="status">Confirming current admission placement…</p>;
  return <>
    <PlacementEvidence current={current} /><div className="flex flex-wrap gap-2"><Button type="button" variant={history ? 'outline' : 'secondary'} onClick={() => setHistory(false)}>Current placement</Button><Button type="button" variant={history ? 'secondary' : 'outline'} onClick={() => setHistory(true)}>Recorded moves</Button></div>
    {history ? <MoveHistory {...{ scope, onDenied }} proof={access.scope} enabled={open && ready} /> : <CurrentMoveActions {...props} />}
  </>;
}
function CurrentMoveActions({ scope, access, current, onDenied, open, ready, query, recovery, controller, selected, setSelected, reason, setReason, review, setReview }) {
  let action = <p className="text-sm text-muted-foreground">{!access.canWrite ? 'Current access is read-only. Recorded placement and move history remain available.' : moveUnavailableCopy[current.unavailable_reason]}</p>;
  if (current.can_move && access.canWrite) action = <MoveEditor {...{ scope, access, current, controller, onDenied, open }} refresh={() => query.refetch()} draft={{ selected, setSelected, reason, setReason, review, setReview }} />;
  if (recovery.entries.length || recovery.unavailable) action = <p className="text-sm text-muted-foreground">An earlier change needs review before a new move. Use its original workflow or the saved-placement review above when available.</p>;
  return <><ManualMoveReview {...{ scope, access, current, onDenied }} enabled={open && ready} onRefresh={() => query.refetch()} />{action}</>;
}
