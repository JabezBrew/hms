/**
 * Empty state placeholder with Chronicle styling
 */
export const EmptyState = ({ icon: Icon, title, description, action }) => (
  <div className="text-center py-12 text-muted-foreground">
    <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted/50 border border-border">
      <Icon className="size-5 text-muted-foreground" />
    </div>
    <p className="font-heading text-sm font-medium text-foreground">{title}</p>
    <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">{description}</p>
    {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
  </div>
);
