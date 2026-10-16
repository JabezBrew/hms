import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { NETWORK_MODES } from './model';

export function NetworkPolicyFields({ draft, onChange, disabled }) {
  const id = useId();
  return <fieldset disabled={disabled} className="grid min-w-0 gap-6">
    <legend className="sr-only">Facility network policy</legend>
    <div className="grid gap-2"><Label htmlFor={`${id}-cidrs`}>Approved onsite networks</Label><Textarea id={`${id}-cidrs`} value={draft.networks} rows={5} maxLength={3000} spellCheck={false} autoCapitalize="none" autoCorrect="off" className="font-mono text-sm" placeholder="One CIDR network per line" onChange={(event) => onChange({ ...draft, networks: event.target.value })} /><p className="text-xs text-muted-foreground">Use 1–64 IPv4 or IPv6 CIDR networks. The server checks and normalizes every entry. This connection must remain within an approved network.</p></div>
    <div className="grid gap-3"><Label id={`${id}-mode`}>Access outside approved networks</Label><RadioGroup aria-labelledby={`${id}-mode`} value={draft.mode} disabled={disabled} onValueChange={(mode) => onChange({ ...draft, mode })}>{NETWORK_MODES.map((option) => <div key={option.value} className="flex items-start gap-3 rounded-xl border p-4"><RadioGroupItem id={`${id}-${option.value}`} value={option.value} className="mt-0.5" /><Label htmlFor={`${id}-${option.value}`} className="grid flex-1 gap-1.5 leading-relaxed">{option.label}<span className="font-normal text-muted-foreground">{option.description}</span></Label></div>)}</RadioGroup></div>
    <div className="grid gap-2"><Label htmlFor={`${id}-reason`}>Reason for this policy version</Label><Textarea id={`${id}-reason`} value={draft.reason} maxLength={1000} rows={3} onChange={(event) => onChange({ ...draft, reason: event.target.value })} /><p className="text-xs text-muted-foreground">Describe the approved operational change. Do not include patient information.</p></div>
  </fieldset>;
}
