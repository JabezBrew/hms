import Pencil from 'lucide-react/dist/esm/icons/pencil.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { AppointmentTypeStatusBadge } from './AppointmentTypeStatusBadge';

const getOptionName = (options, value) => {
  return options.find((option) => option.value === value)?.name;
};

export function AppointmentTypeTable({
  appointmentTypes,
  canMutate,
  colorOptions,
  categoryOptions,
  onEdit,
  onDelete,
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Duration (minutes)</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Color</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Description</TableHead>
          {canMutate ? (
            <TableHead className="w-[100px]">Actions</TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {appointmentTypes.map((type) => (
          <TableRow key={type.id}>
            <TableCell className="font-medium">{type.name}</TableCell>
            <TableCell>{type.duration_minutes}</TableCell>
            <TableCell>{getOptionName(categoryOptions, type.category) || type.category}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Avatar className="size-5">
                  <AvatarFallback style={{ backgroundColor: type.color }} />
                </Avatar>
                {getOptionName(colorOptions, type.color) || type.color}
              </div>
            </TableCell>
            <TableCell>
              <AppointmentTypeStatusBadge isActive={type.is_active} />
            </TableCell>
            <TableCell>{type.description}</TableCell>
            {canMutate ? (
              <TableCell>
                <div className="flex gap-x-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEdit(type)}
                    title="Edit"
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDelete(type.id)}
                    title="Delete"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
