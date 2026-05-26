import User from 'lucide-react/dist/esm/icons/user.js';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import Save from 'lucide-react/dist/esm/icons/save.js';
import Mail from 'lucide-react/dist/esm/icons/mail.js';
import Phone from 'lucide-react/dist/esm/icons/phone.js';
import BadgeCheck from 'lucide-react/dist/esm/icons/badge-check.js';
import { useNavigate } from 'react-router-dom';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useProfile, useUpdateProfile } from '@/features/settings/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';

// Validation schema
const profileSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(50, 'First name too long'),
  last_name: z.string().min(1, 'Last name is required').max(50, 'Last name too long'),
  phone_number: z.string().max(20, 'Phone number too long').optional().or(z.literal('')),
});

/**
 * ProfileSettingsPage - Edit personal information
 * Chronicle Design: Editorial layout with warm typography
 */
const ProfileSettingsPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: profile, isLoading, isError } = useProfile();
  const updateProfile = useUpdateProfile();

  const pageMeta = usePageMeta({
    title: 'Profile Settings | HMS',
    breadcrumbs: [
      { label: 'Settings', href: '/settings' },
      { label: 'Profile' },
    ],
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      first_name: '',
      last_name: '',
      phone_number: '',
    },
    values: profile ? {
      first_name: profile.first_name || '',
      last_name: profile.last_name || '',
      phone_number: profile.phone_number || '',
    } : undefined,
  });

  const onSubmit = async (data) => {
    try {
      await updateProfile.mutateAsync(data);
      toast.success('Profile updated successfully');
      reset(data);
    } catch (error) {
      toast.error(error.message || 'Failed to update profile');
    }
  };

  // Format role for display
  const formatRole = (role) => {
    if (!role) return 'User';
    return role.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  return (
    <PageShell>
      {pageMeta}
        <PageHeader
          title={(
            <span className="flex items-center gap-3 sm:gap-4">
              <span className="p-2.5 sm:p-3 rounded-xl bg-primary/10 border border-primary/20">
                <User className="size-6 sm:h-7 sm:w-7 text-primary" aria-hidden="true" />
              </span>
              Profile
            </span>
          )}
          description="Manage your personal information"
          contentClassName="max-w-2xl mx-auto w-full"
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/settings')}
            className="-ml-2 font-mono text-xs"
          >
            <ArrowLeft className="size-4 mr-2" />
            Back to Settings
          </Button>
        </PageHeader>

        {/* Main Content */}
        <main className="p-4 sm:p-6 lg:p-8">
          <div className="max-w-2xl mx-auto">
            {isLoading ? (
              <LoadingSkeleton />
            ) : isError ? (
              <ErrorState onRetry={() => window.location.reload()} />
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                {/* User Info Card */}
                <section className="bg-card border border-border rounded-2xl p-5 sm:p-6 animate-chronicle-enter">
                  <div className="flex items-center gap-4 mb-6 pb-6 border-b border-border">
                    <div className="size-16 sm:w-20 sm:h-20 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center">
                      <span className="font-display text-2xl sm:text-3xl text-primary">
                        {(profile?.first_name?.[0] || user?.firstName?.[0] || 'U').toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <h2 className="font-display text-xl sm:text-2xl text-foreground">
                        {profile?.first_name || user?.firstName} {profile?.last_name || user?.lastName}
                      </h2>
                      <div className="flex items-center gap-2 mt-1">
                        <BadgeCheck className="size-4 text-emerald-400" />
                        <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                          {formatRole(user?.role)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="first_name" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        First Name
                      </Label>
                      <Input
                        id="first_name"
                        {...register('first_name')}
                        placeholder="Enter first name"
                        className={cn(
                          'font-mono',
                          errors.first_name && 'border-destructive focus-visible:ring-destructive'
                        )}
                      />
                      {errors.first_name && (
                        <p className="text-xs text-destructive font-mono">{errors.first_name.message}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="last_name" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        Last Name
                      </Label>
                      <Input
                        id="last_name"
                        {...register('last_name')}
                        placeholder="Enter last name"
                        className={cn(
                          'font-mono',
                          errors.last_name && 'border-destructive focus-visible:ring-destructive'
                        )}
                      />
                      {errors.last_name && (
                        <p className="text-xs text-destructive font-mono">{errors.last_name.message}</p>
                      )}
                    </div>
                  </div>
                </section>

                {/* Contact Details Section */}
                <section className="bg-card border border-border rounded-2xl p-5 sm:p-6 animate-chronicle-enter" style={{ animationDelay: '75ms' }}>
                  <h3 className="font-display text-lg text-foreground mb-4">
                    Contact Details
                  </h3>

                  <div className="space-y-4">
                    {/* Email - Read only */}
                    <div className="space-y-2">
                      <Label htmlFor="email" className="font-mono text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <Mail className="size-3.5" />
                        Email Address
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        value={profile?.email || user?.email || ''}
                        disabled
                        className="bg-muted/50 font-mono text-muted-foreground"
                      />
                      <p className="text-[11px] text-muted-foreground font-mono">
                        Email cannot be changed. Contact an administrator if you need to update it.
                      </p>
                    </div>

                    {/* Phone Number */}
                    <div className="space-y-2">
                      <Label htmlFor="phone_number" className="font-mono text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <Phone className="size-3.5" />
                        Phone Number
                      </Label>
                      <Input
                        id="phone_number"
                        type="tel"
                        {...register('phone_number')}
                        placeholder="Enter phone number"
                        className={cn(
                          'font-mono',
                          errors.phone_number && 'border-destructive focus-visible:ring-destructive'
                        )}
                      />
                      {errors.phone_number && (
                        <p className="text-xs text-destructive font-mono">{errors.phone_number.message}</p>
                      )}
                    </div>
                  </div>
                </section>

                {/* Save Button */}
                <div className="flex justify-end animate-chronicle-enter" style={{ animationDelay: '150ms' }}>
                  <Button
                    type="submit"
                    disabled={!isDirty || updateProfile.isPending}
                    className="font-mono text-xs min-w-[140px]"
                  >
                    {updateProfile.isPending ? (
                      'Saving...'
                    ) : (
                      <>
                        <Save className="size-4 mr-2" />
                        Save Changes
                      </>
                    )}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </main>
      </PageShell>
  );
};

/**
 * LoadingSkeleton - Chronicle styled loading state
 */
const LoadingSkeleton = () => (
  <div className="space-y-6">
    <div className="bg-card border border-border rounded-2xl p-6">
      <div className="flex items-center gap-4 mb-6 pb-6 border-b border-border">
        <Skeleton className="size-20 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </div>
    <div className="bg-card border border-border rounded-2xl p-6">
      <Skeleton className="h-6 w-32 mb-4" />
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </div>
  </div>
);

/**
 * ErrorState
 */
const ErrorState = ({ onRetry }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center animate-chronicle-enter">
    <div className="size-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
      <User className="size-8 text-destructive" />
    </div>
    <h3 className="font-display text-xl text-foreground mb-2">
      Failed to load profile
    </h3>
    <p className="text-muted-foreground text-sm mb-4 max-w-md">
      There was an error loading your profile. Please try again.
    </p>
    <Button variant="outline" size="sm" onClick={onRetry} className="font-mono text-xs">
      Retry
    </Button>
  </div>
);

export default ProfileSettingsPage;
