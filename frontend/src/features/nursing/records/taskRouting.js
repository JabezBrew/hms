// Origin is immutable evidence; only the explicit service ward routes current work.
export function taskRoutingKnown(task) {
  return typeof task?.service_ward_id === 'string' && task.service_ward_id.length > 0
    && Number.isSafeInteger(task.route_version) && task.route_version >= 0;
}
