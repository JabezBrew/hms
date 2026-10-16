import { templateSchema, templateSections } from '../model';
function starterText(item) {
  if (typeof item.default_text === 'string') return item.default_text || 'No starter text';
  if (typeof item.defaultText === 'string') return item.defaultText || 'No starter text';
  if (item.default_text !== undefined || item.defaultText !== undefined) return 'Original starter content is retained in its recorded format. It is not automatically copied into a new text draft.';
  return 'No starter text';
}
export function TemplateEvidence({ template }) {
  const sections = templateSections(template);
  if (templateSchema(template.body_template).kind === 'invalid') return <section aria-label="Historical template evidence" className="flex min-w-0 flex-col gap-3 rounded-xl border p-4"><h3 className="break-words font-medium">{template.title} · revision {template.version}</h3><p className="text-sm text-muted-foreground">This historical structure is not available for new notes. Its original raw evidence is retained unchanged.</p><pre className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{template.body_template}</pre></section>;
  return <section className="flex flex-col gap-4 rounded-xl border p-4"><h3 className="font-medium">{template.title} · revision {template.version}</h3><p className="text-sm text-muted-foreground">{template.is_active ? 'Available for new notes' : 'Inactive for new notes'} · {template.owner_display_name || (template.owner_user_id ? 'Owner name unavailable' : 'Historical owner not recorded')}</p>{sections.length ? sections.map((item) => <div key={item.id} className="flex flex-col gap-2"><h4 className="break-words font-medium">{item.label}{item.required ? ' · required' : ''}</h4><p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{starterText(item)}</p></div>) : <p className="whitespace-pre-wrap break-words text-sm">{template.body_template}</p>}</section>;
}
