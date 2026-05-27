import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const getOptionName = (options, value) => {
  return options.find((option) => option.value === value)?.name;
};

export function AppointmentTypeSelectField({
  id,
  label,
  value,
  options,
  placeholder,
  showColor = false,
  onValueChange,
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onValueChange} required>
        <SelectTrigger id={id}>
          <SelectValue placeholder={placeholder}>
            {showColor ? (
              <div className="flex items-center gap-2">
                <Avatar className="size-5">
                  <AvatarFallback style={{ backgroundColor: value }} />
                </Avatar>
                {getOptionName(options, value) || placeholder}
              </div>
            ) : null}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {showColor ? (
                <div className="flex items-center gap-2">
                  <Avatar className="size-5">
                    <AvatarFallback style={{ backgroundColor: option.value }} />
                  </Avatar>
                  {option.name}
                </div>
              ) : option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
