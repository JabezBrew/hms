import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useDebounce } from '@/hooks/use-debounce';
import { useCreatePayerServiceCode, useServices } from '@/features/billing/hooks';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BillingPagination } from './BillingPagination';

const dateField = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Choose a valid date.');
const schema = z.object({
  service: z.string().min(1, 'Choose a billable service.'),
  external_code: z.string().trim().min(1, 'Enter an NHIS code.').refine((value) => [...value].length <= 160, 'Use 160 characters or fewer.'),
  effective_from: dateField,
  effective_until: z.union([z.literal(''), dateField]),
}).refine((value) => !value.effective_until || value.effective_until > value.effective_from, {
  path: ['effective_until'], message: 'The end date must be after the start date.',
});

function MappingServicePicker({ form, disabled }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const debouncedSearch = useDebounce(search, 250);
  const servicesQuery = useServices({ page, page_size: 20, is_active: true, ...(debouncedSearch ? { search: debouncedSearch } : {}) });
  const services = servicesQuery.data?.results || [];

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label htmlFor="nhis-mapping-service-search">Find billable service</Label>
        <Input id="nhis-mapping-service-search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search by service name or code" disabled={disabled} />
      </div>
      <FormField control={form.control} name="service" render={({ field }) => (
        <FormItem>
          <FormLabel>Billable service</FormLabel>
          <Select value={field.value} onValueChange={(value) => {
            field.onChange(value);
            setSelected(services.find((service) => service.id === value));
          }} disabled={disabled || servicesQuery.isFetching}>
            <FormControl><SelectTrigger><SelectValue placeholder={servicesQuery.isLoading ? 'Loading services…' : 'Choose a service'}>
              {selected ? `${selected.code} · ${selected.name}` : undefined}
            </SelectValue></SelectTrigger></FormControl>
            <SelectContent><SelectGroup>
              {services.map((service) => <SelectItem key={service.id} value={service.id}>{service.code} · {service.name}</SelectItem>)}
            </SelectGroup></SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )} />
      {servicesQuery.error ? <Alert variant="destructive">
        <AlertDescription>Services could not be loaded. <Button type="button" variant="outline" size="sm" onClick={() => servicesQuery.refetch()}>Retry</Button></AlertDescription>
      </Alert> : !servicesQuery.isLoading && services.length === 0 ? <p className="text-sm text-muted-foreground">No matching services. Try another search.</p> : null}
      <BillingPagination data={servicesQuery.data} itemLabel="services" onPageChange={setPage} page={page} pageSize={20} />
    </div>
  );
}

export function NhisMappingCreateDialog({ payerId, payerName, onClose }) {
  const create = useCreatePayerServiceCode();
  const submittingRef = useRef(false);
  const form = useForm({ resolver: zodResolver(schema), defaultValues: {
    service: '', external_code: '', effective_from: new Date().toISOString().slice(0, 10), effective_until: '',
  } });
  const saved = create.data;
  const unconfirmed = create.error?.code === 'nhis_mapping_unconfirmed';
  const close = () => { if (!create.isPending) onClose(); };
  const submit = async (values) => {
    if (submittingRef.current || saved || unconfirmed) return;
    submittingRef.current = true;
    try {
      await create.mutateAsync({ payer: payerId, ...values, effective_until: values.effective_until || null });
    } catch {
      // Show the mutation's safe error inline; a lost response must not retry.
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New NHIS mapping</DialogTitle>
          <DialogDescription>Add a dated service code mapping for {payerName || 'the selected payer'}. Existing mappings remain unchanged. Payer-specific mappings are saved for review and are not yet applied automatically to new claims.</DialogDescription>
        </DialogHeader>
        {saved ? <>
          <Alert role="status"><AlertTitle>Mapping saved</AlertTitle><AlertDescription>
            <p>{saved.service_code} · {saved.service_name} → {saved.external_code}</p>
            <p>Effective from {saved.effective_from}{saved.effective_until ? ` until ${saved.effective_until}` : ''}.</p>
            <p>Version {saved.version_number}.</p>
          </AlertDescription></Alert>
          <DialogFooter><Button type="button" onClick={close}>Done</Button></DialogFooter>
        </> : <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="grid gap-4">
            <MappingServicePicker form={form} disabled={create.isPending || unconfirmed} />
            <FormField control={form.control} name="external_code" render={({ field }) => (
              <FormItem><FormLabel>NHIS external code</FormLabel><FormControl><Input {...field} required disabled={create.isPending || unconfirmed} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField control={form.control} name="effective_from" render={({ field }) => (
                <FormItem><FormLabel>Effective from</FormLabel><FormControl><Input {...field} type="date" required disabled={create.isPending || unconfirmed} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="effective_until" render={({ field }) => (
                <FormItem><FormLabel>Effective until (optional)</FormLabel><FormControl><Input {...field} type="date" disabled={create.isPending || unconfirmed} /></FormControl><FormDescription>The end date is excluded from the effective period.</FormDescription><FormMessage /></FormItem>
              )} />
            </div>
            {create.error ? <Alert variant="destructive"><AlertTitle>{unconfirmed ? 'Save status unknown' : 'Mapping not saved'}</AlertTitle><AlertDescription>{create.error.message}</AlertDescription></Alert> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={create.isPending}>{unconfirmed ? 'Close and review mappings' : 'Cancel'}</Button>
              <Button type="submit" disabled={create.isPending || unconfirmed}>{create.isPending ? 'Saving…' : 'Save mapping'}</Button>
            </DialogFooter>
          </form>
        </Form>}
      </DialogContent>
    </Dialog>
  );
}
