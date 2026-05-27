function MetricTile({ icon: Icon, label, value }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
        </div>
        <Icon className="size-5 text-muted-foreground" />
      </div>
    </div>
  );
}

export function AppointmentMetrics({
  activeWaitlistCount,
  remainingCapacity,
  sessionCount,
  sessionsIcon,
  capacityIcon,
  waitlistIcon,
}) {
  return (
    <section className="grid gap-3 md:grid-cols-3">
      <MetricTile icon={sessionsIcon} label="Today's sessions" value={sessionCount} />
      <MetricTile icon={capacityIcon} label="Open capacity" value={remainingCapacity} />
      <MetricTile icon={waitlistIcon} label="Active waitlist" value={activeWaitlistCount} />
    </section>
  );
}
