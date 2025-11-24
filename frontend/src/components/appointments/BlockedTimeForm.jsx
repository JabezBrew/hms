import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { usePractitioners } from '@/hooks/useStaffQueries';
import { useCreateBlockedTime, useBulkCreateBlockedTime, useUpdateBlockedTime } from '@/hooks/useAppointmentQueries';

const formSchema = z.object({
    practitioner_id: z.string().min(1, 'Practitioner is required'),
    reason: z.string().min(1, 'Reason is required'),
    is_all_day: z.boolean().default(false),
    mode: z.enum(['single', 'range']).default('single'),
    date: z.date().optional(),
    start_date: z.date().optional(),
    end_date: z.date().optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
}).refine((data) => {
    if (data.mode === 'single') {
        return !!data.date;
    }
    return !!data.start_date && !!data.end_date;
}, {
    message: "Date selection is required",
    path: ["date"],
}).refine((data) => {
    if (data.is_all_day) return true;
    if (data.mode === 'single') {
        return !!data.start_time && !!data.end_time;
    }
    return true; // Range mode is always all-day effectively, or we could add time support for ranges if needed, but backend supports is_all_day for ranges usually.
}, {
    message: "Start and end times are required for partial day blocks",
    path: ["start_time"],
});

const BlockedTimeForm = ({ initialData, onSuccess, onCancel }) => {
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { data: practitioners = [] } = usePractitioners();
    const createBlockedTime = useCreateBlockedTime();
    const bulkCreateBlockedTime = useBulkCreateBlockedTime();
    const updateBlockedTime = useUpdateBlockedTime();

    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: {
            practitioner_id: initialData?.practitioner || '',
            reason: initialData?.reason || '',
            is_all_day: initialData?.is_all_day || false,
            mode: initialData?.end_date && initialData.start_date !== initialData.end_date ? 'range' : 'single',
            date: initialData?.date ? new Date(initialData.date) : new Date(),
            start_date: initialData?.start_date ? new Date(initialData.start_date) : new Date(),
            end_date: initialData?.end_date ? new Date(initialData.end_date) : new Date(),
            start_time: initialData?.start_time || '09:00',
            end_time: initialData?.end_time || '17:00',
        },
    });

    const mode = form.watch('mode');
    const isAllDay = form.watch('is_all_day');

    const onSubmit = async (values) => {
        setIsSubmitting(true);
        try {
            if (initialData) {
                // Update existing
                await updateBlockedTime.mutateAsync({
                    id: initialData.id,
                    data: {
                        practitioner_id: values.practitioner_id,
                        date: format(values.date, 'yyyy-MM-dd'),
                        start_time: values.is_all_day ? null : values.start_time,
                        end_time: values.is_all_day ? null : values.end_time,
                        reason: values.reason,
                        is_all_day: values.is_all_day,
                    }
                });
            } else {
                // Create new
                if (values.mode === 'range') {
                    await bulkCreateBlockedTime.mutateAsync({
                        practitioner_id: values.practitioner_id,
                        start_date: format(values.start_date, 'yyyy-MM-dd'),
                        end_date: format(values.end_date, 'yyyy-MM-dd'),
                        reason: values.reason,
                        is_all_day: true, // Bulk create usually implies full days off like vacation
                    });
                } else {
                    await createBlockedTime.mutateAsync({
                        practitioner_id: values.practitioner_id,
                        date: format(values.date, 'yyyy-MM-dd'),
                        start_time: values.is_all_day ? null : values.start_time,
                        end_time: values.is_all_day ? null : values.end_time,
                        reason: values.reason,
                        is_all_day: values.is_all_day,
                    });
                }
            }
            onSuccess?.();
        } catch (error) {
            console.error('Failed to save blocked time:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                    control={form.control}
                    name="practitioner_id"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Practitioner</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value} disabled={!!initialData}>
                                <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a practitioner" />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {practitioners.map((practitioner) => (
                                        <SelectItem key={practitioner.id} value={practitioner.id}>
                                            {practitioner.staff_details?.user_details?.first_name} {practitioner.staff_details?.user_details?.last_name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                {!initialData && (
                    <FormField
                        control={form.control}
                        name="mode"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Type</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select type" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="single">Single Day / Partial Day</SelectItem>
                                        <SelectItem value="range">Date Range (Vacation/Leave)</SelectItem>
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                )}

                {mode === 'single' ? (
                    <FormField
                        control={form.control}
                        name="date"
                        render={({ field }) => (
                            <FormItem className="flex flex-col">
                                <FormLabel>Date</FormLabel>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <FormControl>
                                            <Button
                                                variant={"outline"}
                                                className={cn(
                                                    "w-full pl-3 text-left font-normal",
                                                    !field.value && "text-muted-foreground"
                                                )}
                                            >
                                                {field.value ? (
                                                    format(field.value, "PPP")
                                                ) : (
                                                    <span>Pick a date</span>
                                                )}
                                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                            </Button>
                                        </FormControl>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar
                                            mode="single"
                                            selected={field.value}
                                            onSelect={field.onChange}
                                            disabled={(date) =>
                                                date < new Date(new Date().setHours(0, 0, 0, 0))
                                            }
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                ) : (
                    <div className="grid grid-cols-2 gap-4">
                        <FormField
                            control={form.control}
                            name="start_date"
                            render={({ field }) => (
                                <FormItem className="flex flex-col">
                                    <FormLabel>Start Date</FormLabel>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <FormControl>
                                                <Button
                                                    variant={"outline"}
                                                    className={cn(
                                                        "w-full pl-3 text-left font-normal",
                                                        !field.value && "text-muted-foreground"
                                                    )}
                                                >
                                                    {field.value ? (
                                                        format(field.value, "PPP")
                                                    ) : (
                                                        <span>Pick a date</span>
                                                    )}
                                                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                </Button>
                                            </FormControl>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0" align="start">
                                            <Calendar
                                                mode="single"
                                                selected={field.value}
                                                onSelect={field.onChange}
                                                disabled={(date) =>
                                                    date < new Date(new Date().setHours(0, 0, 0, 0))
                                                }
                                                initialFocus
                                            />
                                        </PopoverContent>
                                    </Popover>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="end_date"
                            render={({ field }) => (
                                <FormItem className="flex flex-col">
                                    <FormLabel>End Date</FormLabel>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <FormControl>
                                                <Button
                                                    variant={"outline"}
                                                    className={cn(
                                                        "w-full pl-3 text-left font-normal",
                                                        !field.value && "text-muted-foreground"
                                                    )}
                                                >
                                                    {field.value ? (
                                                        format(field.value, "PPP")
                                                    ) : (
                                                        <span>Pick a date</span>
                                                    )}
                                                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                </Button>
                                            </FormControl>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0" align="start">
                                            <Calendar
                                                mode="single"
                                                selected={field.value}
                                                onSelect={field.onChange}
                                                disabled={(date) =>
                                                    date < new Date(new Date().setHours(0, 0, 0, 0))
                                                }
                                                initialFocus
                                            />
                                        </PopoverContent>
                                    </Popover>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                )}

                {mode === 'single' && (
                    <FormField
                        control={form.control}
                        name="is_all_day"
                        render={({ field }) => (
                            <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                                <FormControl>
                                    <Checkbox
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                </FormControl>
                                <div className="space-y-1 leading-none">
                                    <FormLabel>
                                        All Day
                                    </FormLabel>
                                    <FormDescription>
                                        Block the entire day
                                    </FormDescription>
                                </div>
                            </FormItem>
                        )}
                    />
                )}

                {mode === 'single' && !isAllDay && (
                    <div className="grid grid-cols-2 gap-4">
                        <FormField
                            control={form.control}
                            name="start_time"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Start Time</FormLabel>
                                    <FormControl>
                                        <Input type="time" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="end_time"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>End Time</FormLabel>
                                    <FormControl>
                                        <Input type="time" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                )}

                <FormField
                    control={form.control}
                    name="reason"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Reason</FormLabel>
                            <FormControl>
                                <Textarea
                                    placeholder="e.g. Vacation, Doctor Appointment, Emergency"
                                    className="resize-none"
                                    {...field}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="flex justify-end space-x-2">
                    <Button variant="outline" type="button" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {initialData ? 'Update' : 'Create'}
                    </Button>
                </div>
            </form>
        </Form>
    );
};

export default BlockedTimeForm;
