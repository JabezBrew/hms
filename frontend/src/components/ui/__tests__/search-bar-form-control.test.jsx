import { createRef, useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import userEvent from '@testing-library/user-event';
import { AppointmentCreateSidebar } from '@/features/appointments/pages/appointment-create/AppointmentCreateSidebar';
import { afterEach, expect, it, vi } from 'vitest';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { SearchBar } from '@/components/ui/search-bar';

afterEach(cleanup);
function FieldHarness({ kind, inputRef }) {
  const form = useForm({ defaultValues: { selection: '' } });
  useEffect(() => { form.setError('selection', { message: 'Synthetic selection required' }); }, [form]);
  return <Form {...form}><FormField control={form.control} name="selection" render={({ field }) => <FormItem><FormLabel>Synthetic field</FormLabel><FormControl ref={inputRef}>{kind === 'search' ? <SearchBar {...field} options={[]} placeholder="Synthetic search" /> : <Input {...field} />}</FormControl><FormDescription>Synthetic field help</FormDescription><FormMessage /></FormItem>} /></Form>;
}
it.each(['input', 'search'])('real %s control preserves Form label, id, description, error and forwarded input ref', async kind => {
  const inputRef = createRef(); render(<FieldHarness kind={kind} inputRef={inputRef} />); await screen.findByText('Synthetic selection required');
  const input = screen.getByRole('textbox', { name: 'Synthetic field' });
  expect(input).toHaveAttribute('id', screen.getByText('Synthetic field').getAttribute('for'));
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input.getAttribute('aria-describedby').split(' ')).toEqual([screen.getByText('Synthetic field help').id, screen.getByText('Synthetic selection required').id]);
  expect(inputRef.current).toBe(input); expect(input).toHaveAttribute('name', 'selection');
});

it('preserves selection/search/clear callbacks and internal focus while forwarding a callback input ref', async () => {
  const ev = userEvent.setup(), onChange = vi.fn(), onInputChange = vi.fn(), onBlur = vi.fn(), onFocus = vi.fn(), forwardedRef = vi.fn();
  const props = { options: [{ value: 'synthetic-option', label: 'Synthetic option' }], onChange, onInputChange, onBlur, onFocus, ref: forwardedRef, 'aria-label': 'Synthetic selector', isLoading: false, maxHeight: '15rem', searchPlaceholder: 'Synthetic search hint' };
  const view = render(<SearchBar {...props} value="" />); const input = screen.getByRole('textbox', { name: 'Synthetic selector' });
  expect(forwardedRef).toHaveBeenCalledWith(input); fireEvent.change(input, { target: { value: 'Synthetic query' } });
  expect(onInputChange).toHaveBeenLastCalledWith('Synthetic query'); expect(onChange).not.toHaveBeenCalled(); await waitFor(() => expect(input).toHaveFocus()); expect(onFocus).toHaveBeenCalled();
  await ev.click(await screen.findByRole('option', { name: 'Synthetic option' })); expect(onChange).toHaveBeenLastCalledWith('synthetic-option');
  view.rerender(<SearchBar {...props} value="synthetic-option" />); expect(input).toHaveValue('Synthetic option'); await ev.click(screen.getByRole('button', { name: 'Clear' }));
  expect(onChange).toHaveBeenLastCalledWith(null); expect(onInputChange).toHaveBeenLastCalledWith(''); expect(onBlur).toHaveBeenCalled();
  for (const attr of ['options', 'maxHeight', 'isLoading', 'searchPlaceholder', 'onInputChange']) expect(input).not.toHaveAttribute(attr);
  view.unmount(); expect(forwardedRef).toHaveBeenLastCalledWith(null);
});
function BookingFieldsHarness() {
  const form = useForm({ defaultValues: { patientId: '', practitionerId: '', clinicId: '', appointmentTypeId: '', description: '', comment: '' } });
  return <Form {...form}><AppointmentCreateSidebar form={form} appointmentTypes={[]} clinics={[]} patientOptions={[]} practitionerOptions={[]} clinicState={{ isPoolClinic: false, selectedClinic: null, watchClinicId: 'synthetic-clinic' }} searchState={{ isLoadingPatients: false, isLoadingPractitioners: false }} submissionState={{ isWaitlistPromotion: false, submitting: false }} formReady={false} /></Form>;
}
it('connects actual booking Patient and Doctor labels to the real shared search inputs', () => {
  render(<BookingFieldsHarness />); for (const name of ['Patient', 'Doctor']) { const input = screen.getByRole('textbox', { name }); expect(input).toHaveAttribute('id', screen.getByText(name, { selector: 'label' }).getAttribute('for')); }
});
