import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import { AppointmentTypeSelectField } from './AppointmentTypeSelectField';

export function AppointmentTypeDialog({
  open,
  onOpenChange,
  isEditing,
  currentAppointmentType,
  colorOptions,
  categoryOptions,
  onInputChange,
  onSelectChange,
  onSwitchChange,
  onCancel,
  onSubmit,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Appointment Type' : 'Create Appointment Type'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the details of this appointment type.'
              : 'Add a new appointment type to the system.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              value={currentAppointmentType.name}
              onChange={onInputChange}
              placeholder="e.g., Regular Checkup"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="duration_minutes">Duration (minutes)</Label>
            <Input
              id="duration_minutes"
              name="duration_minutes"
              type="number"
              min="1"
              value={currentAppointmentType.duration_minutes}
              onChange={onInputChange}
              placeholder="e.g., 30"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Input
              id="description"
              name="description"
              value={currentAppointmentType.description}
              onChange={onInputChange}
              placeholder="e.g., Standard consultation for regular patients"
            />
          </div>

          <AppointmentTypeSelectField
            id="category"
            label="Category"
            value={currentAppointmentType.category}
            options={categoryOptions}
            placeholder="Select a category"
            onValueChange={(value) => onSelectChange('category', value)}
          />

          <AppointmentTypeSelectField
            id="color"
            label="Color"
            value={currentAppointmentType.color}
            options={colorOptions}
            placeholder="Select a color"
            showColor
            onValueChange={(value) => onSelectChange('color', value)}
          />

          <div className="flex items-center gap-x-2">
            <Switch
              id="is_active"
              checked={currentAppointmentType.is_active}
              onCheckedChange={onSwitchChange}
            />
            <Label htmlFor="is_active">Active</Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit">
              {isEditing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
