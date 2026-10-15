import { useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { catalogCorrectionSchema, catalogToday } from '../api/catalogCorrections';
import { useCatalogCorrection } from '../hooks/useCatalogCorrection';

const TEXT_FIELDS = [
  { name: 'code', label: 'Item code' },
  { name: 'name', label: 'Item name' },
  { name: 'unit', label: 'Unit of measure' },
];

function SavedCatalogCorrection({ version }) {
  return (
    <Alert role="status">
      <AlertTitle>Catalog correction saved</AlertTitle>
      <AlertDescription>
        <p>The saved version contains the following values.</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 pt-2">
          <dt>Item code</dt><dd className="break-words font-mono">{version.code}</dd>
          <dt>Item name</dt><dd className="break-words">{version.name}</dd>
          <dt>Unit of measure</dt><dd>{version.unit}</dd>
          <dt>Effective date (UTC)</dt><dd>{version.effective_from}</dd>
          <dt>Reason</dt><dd className="break-words">{version.reason}</dd>
        </dl>
      </AlertDescription>
    </Alert>
  );
}

export function CatalogCorrectionDialog({ item, onClose }) {
  const correction = useCatalogCorrection();
  const submittingRef = useRef(false);
  const form = useForm({
    resolver: zodResolver(catalogCorrectionSchema),
    defaultValues: {
      code: item.code || item.sku || '', name: item.name || '',
      unit: item.unit || item.unit_of_measure || '', effective_from: catalogToday(), reason: '',
    },
  });
  const unconfirmed = correction.error?.code === 'catalog_correction_unconfirmed';
  const saved = correction.data;
  const handleClose = () => { if (!correction.isPending) onClose(); };
  const submit = async (data) => {
    if (submittingRef.current || saved || unconfirmed) return;
    submittingRef.current = true;
    try {
      await correction.mutateAsync({ itemId: item.id, data });
    } catch {
      // The mutation exposes a safe message inline; never log catalog free text.
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Correct catalog details</DialogTitle>
          <DialogDescription>
            Correct the code, name or unit for {item.name}. The effective date and reason are recorded with the change.
          </DialogDescription>
        </DialogHeader>
        {saved ? <>
          <SavedCatalogCorrection version={saved} />
          <DialogFooter><Button type="button" onClick={handleClose}>Done</Button></DialogFooter>
        </> : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submit)} className="grid gap-4">
              {TEXT_FIELDS.map(({ name, label }) => (
                <FormField key={name} control={form.control} name={name} render={({ field }) => (
                  <FormItem>
                    <FormLabel>{label}</FormLabel>
                    <FormControl><Input {...field} required disabled={correction.isPending || unconfirmed} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              ))}
              <FormField control={form.control} name="effective_from" render={({ field }) => (
                <FormItem>
                  <FormLabel>Effective date (UTC)</FormLabel>
                  <FormControl><Input {...field} type="date" required max={catalogToday()} disabled={correction.isPending || unconfirmed} /></FormControl>
                  <FormDescription>Choose today or an earlier date. The current catalog updates when saved.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="reason" render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason for correction</FormLabel>
                  <FormControl><Textarea {...field} required rows={2} disabled={correction.isPending || unconfirmed} /></FormControl>
                  <FormDescription>Use 120 characters or fewer.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              {correction.error ? <Alert variant="destructive">
                <AlertTitle>{unconfirmed ? 'Save status unknown' : 'Correction not saved'}</AlertTitle>
                <AlertDescription>{correction.error.message}</AlertDescription>
              </Alert> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleClose} disabled={correction.isPending}>
                  {unconfirmed ? 'Close and review item' : 'Cancel'}
                </Button>
                <Button type="submit" disabled={correction.isPending || unconfirmed}>
                  {correction.isPending ? 'Saving…' : 'Save correction'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
