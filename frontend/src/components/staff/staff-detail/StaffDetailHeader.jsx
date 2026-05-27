import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import Save from 'lucide-react/dist/esm/icons/save.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import UserCheck from 'lucide-react/dist/esm/icons/user-check.js';
import X from 'lucide-react/dist/esm/icons/x.js';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { cn } from '@/lib/utils';

export function StaffDetailHeader({
  view,
  state,
  onBack,
  onCancelEdit,
  onEdit,
  onSave,
  onDelete,
  onReactivate,
}) {
  const RoleIcon = view.roleConfig.icon;
  const { isEditing, isDeleting, isSaving, isReactivating } = state;

  const headerDescription = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium',
            view.roleConfig.badgeClass
          )}
        >
          <RoleIcon className="size-3" />
          {view.roleConfig.label}
        </span>
        <span className="font-mono text-xs text-muted-foreground">{view.employeeId}</span>
      </div>
      <p className="text-sm text-muted-foreground">{view.roleConfig.description}</p>
    </div>
  );

  return (
    <PageHeader
      title={(
        <span className="flex items-center gap-4">
          <span
            className={cn(
              'size-16 sm:size-20 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0',
              view.roleConfig.badgeClass.replace('text-', 'bg-').replace('/10', '/20')
            )}
          >
            <RoleIcon className="size-8 sm:size-10 text-foreground/70" />
          </span>
          <span className="flex flex-wrap items-center gap-2">
            {view.fullName}
            {!view.isActive ? <Badge variant="secondary" className="text-xs">Inactive</Badge> : null}
          </span>
        </span>
      )}
      description={headerDescription}
      descriptionClassName="mt-2"
      actions={(
        <div className="flex gap-2">
          {isEditing ? (
            <>
              <Button variant="outline" size="sm" onClick={onCancelEdit}>
                <X className="size-4 mr-2" />
                Cancel
              </Button>
              <Button size="sm" onClick={onSave} disabled={isSaving}>
                <Save className="size-4 mr-2" />
                {isSaving ? 'Saving' : 'Save'}
              </Button>
            </>
          ) : (
            <>
              {!view.isActive ? (
                <Button
                  variant="default"
                  size="sm"
                  onClick={onReactivate}
                  disabled={isReactivating}
                  className="font-mono text-xs"
                >
                  <UserCheck className="size-4 mr-2" />
                  {isReactivating ? 'Reactivating' : 'Reactivate'}
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Edit className="size-4 mr-2" />
                <span className="hidden sm:inline">Edit</span>
              </Button>
              {view.isActive ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-4 sm:mr-2" />
                      <span className="hidden sm:inline">Deactivate</span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Deactivate {view.fullName}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will disable login, revoke active sessions, and remove active organization assignments while keeping the staff record for audit history.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={onDelete}
                        disabled={isDeleting}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {isDeleting ? 'Deactivating' : 'Deactivate'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </>
          )}
        </div>
      )}
      contentClassName="max-w-4xl mx-auto w-full"
    >
      <Button variant="ghost" size="sm" onClick={onBack} className="self-start -ml-2">
        <ChevronLeft className="size-4 mr-1" />
        Staff Directory
      </Button>
    </PageHeader>
  );
}
