import { INTAKE, OUTPUT } from './model';
export function FluidMetadataDetails({ values }) {
  const metadata = values.metadata;
  return <div className="grid gap-1 text-sm">
    {values.intake_ml > 0 && <p className="text-xs text-muted-foreground">Intake: {INTAKE[metadata.intake_category] || 'Earlier category unavailable'}{metadata.intake_subcategory ? ` · ${metadata.intake_subcategory}` : ''}</p>}
    {values.output_ml > 0 && <p className="text-xs text-muted-foreground">Output: {OUTPUT[metadata.output_category] || 'Earlier category unavailable'}{metadata.output_subcategory ? ` · ${metadata.output_subcategory}` : ''}{metadata.output_colour ? ` · Colour: ${metadata.output_colour}` : ''}</p>}
    {metadata.notes && <p className="whitespace-pre-wrap">{metadata.notes}</p>}
  </div>;
}
