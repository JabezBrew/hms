import { moveKeys } from '../keys';
// Operational placement/task projections refresh after a confirmed result. The
// clinical draft controllers keep their own fresh-prepare and authority lifetime.
export async function invalidateMoveViews(client, scope, proof, command) {
  const [{ admissionCaseKeys }, { wardKeys }, { wardBoardKeys }] = await Promise.all([
    import('@/features/admissions/hooks/useAdmissionCaseQueries'),
    import('@/features/wards/hooks/useWardQueries'),
    import('@/features/ward-board/hooks'),
  ]);
  const wards = [...new Set([command.source.ward_id, command.destination.ward_id])];
  const keys = [moveKeys.admission(proof, scope.patientId, scope.caseId), admissionCaseKeys.detail(scope.caseId), admissionCaseKeys.lists(), wardKeys.lists(), wardKeys.beds(), wardKeys.admissions(), wardBoardKeys.all, ...wards.flatMap(id => [wardKeys.detail(id), wardKeys.wardBedMap(id), wardKeys.wardBedsRoot(id)])];
  await Promise.all(keys.map(queryKey => client.invalidateQueries({ queryKey }, { throwOnError: true })));
}
