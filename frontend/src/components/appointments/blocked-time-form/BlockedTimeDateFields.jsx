import { BlockedTimeDatePickerField } from './BlockedTimeDatePickerField';

export function BlockedTimeDateFields({ control, mode, todayStart }) {
  if (mode === 'single') {
    return (
      <BlockedTimeDatePickerField
        control={control}
        name="date"
        label="Date"
        todayStart={todayStart}
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <BlockedTimeDatePickerField
        control={control}
        name="start_date"
        label="Start Date"
        todayStart={todayStart}
      />
      <BlockedTimeDatePickerField
        control={control}
        name="end_date"
        label="End Date"
        todayStart={todayStart}
      />
    </div>
  );
}
