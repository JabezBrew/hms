import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Home from 'lucide-react/dist/esm/icons/house.js';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { Checkbox } from '@/components/ui/checkbox';

import { useWardSections, useCreateSection, useUpdateSection, useDeleteSection } from '@/features/wards/hooks/useWardQueries';
import { toast } from 'sonner';

/**
 * SectionManagement - Admin interface for managing ward sections
 *
 * Features:
 * - List all sections for a ward
 * - Create new sections
 * - Edit existing sections
 * - Delete sections (with confirmation)
 */
export function SectionManagement({ wardId }) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedSection, setSelectedSection] = useState(null);

  const { data: sections = [], isLoading } = useWardSections(wardId, {
    enabled: !!wardId,
  });

  const createMutation = useCreateSection();
  const updateMutation = useUpdateSection();
  const deleteMutation = useDeleteSection();

  // Handle create
  const handleCreate = (data) => {
    createMutation.mutate(data, {
      onSuccess: () => {
        toast.success('Section created successfully');
        setCreateDialogOpen(false);
      },
      onError: (error) => {
        toast.error(error.message || 'Failed to create section');
      },
    });
  };

  // Handle update
  const handleUpdate = (sectionId, data) => {
    updateMutation.mutate({ id: sectionId, data }, {
      onSuccess: () => {
        toast.success('Section updated successfully');
        setEditDialogOpen(false);
        setSelectedSection(null);
      },
      onError: (error) => {
        toast.error(error.message || 'Failed to update section');
      },
    });
  };

  // Handle delete
  const handleDelete = (sectionId) => {
    deleteMutation.mutate(sectionId, {
      onSuccess: () => {
        toast.success('Section deleted successfully');
      },
      onError: (error) => {
        toast.error(error.message || 'Failed to delete section');
      },
    });
  };

  // Open edit dialog
  const openEditDialog = (section) => {
    setSelectedSection(section);
    setEditDialogOpen(true);
  };

  if (isLoading) {
    return <div>Loading sections…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Ward Sections</h3>
          <p className="text-sm text-muted-foreground">
            Manage sections, gender restrictions, and accommodation tiers
          </p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4 mr-2" />
              Create Section
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <SectionForm
              wardId={wardId}
              onSubmit={handleCreate}
              isSubmitting={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Sections List */}
      {sections.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/20">
          <Users className="size-12 text-muted-foreground mx-auto mb-4" />
          <h4 className="text-lg font-medium text-foreground mb-2">No sections configured</h4>
          <p className="text-sm text-muted-foreground mb-4">
            Create your first section to organize beds by gender, accommodation tier, or isolation capability
          </p>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="size-4 mr-2" />
            Create First Section
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sections
            .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
            .map((section) => (
              <SectionCard
                key={section.id}
                section={section}
                onEdit={() => openEditDialog(section)}
                onDelete={() => handleDelete(section.id)}
              />
            ))}
        </div>
      )}

      {/* Edit Dialog */}
      {selectedSection && (
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-2xl">
            <SectionForm
              wardId={wardId}
              section={selectedSection}
              onSubmit={(data) => handleUpdate(selectedSection.id, data)}
              isSubmitting={updateMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/**
 * SectionCard - Individual section display card
 */
function SectionCard({ section, onEdit, onDelete }) {
  // Get icon for accommodation tier
  const getTierIcon = (tier) => {
    switch (tier) {
      case 'vip':
        return <Sparkles className="size-4" />;
      case 'private':
        return <Home className="size-4" />;
      case 'semi_private':
        return <Users className="size-4" />;
      default:
        return null;
    }
  };

  // Get color for accommodation tier
  const getTierColor = (tier) => {
    switch (tier) {
      case 'vip':
        return 'text-amber-600 bg-amber-50 border-amber-200';
      case 'private':
        return 'text-sky-600 bg-sky-50 border-sky-200';
      case 'semi_private':
        return 'text-emerald-600 bg-emerald-50 border-emerald-200';
      case 'open':
        return 'text-stone-600 bg-stone-50 border-stone-200';
      default:
        return 'text-stone-600 bg-stone-50 border-stone-200';
    }
  };

  return (
    <div className={cn(
      "rounded-xl p-4 border space-y-4",
      section.is_active ? "bg-card" : "bg-muted/30 opacity-75"
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {getTierIcon(section.accommodation_tier)}
          <div className="min-w-0 flex-1">
            <h4 className="font-semibold text-sm text-foreground truncate">
              {section.name}
            </h4>
            {section.description && (
              <p className="text-xs text-muted-foreground truncate">
                {section.description}
              </p>
            )}
          </div>
        </div>
        {!section.is_active && (
          <Badge variant="outline" className="text-xs">
            Inactive
          </Badge>
        )}
      </div>

      {/* Tier Badge */}
      <div>
        <Badge
          variant="outline"
          className={cn('text-xs', getTierColor(section.accommodation_tier))}
        >
          {section.accommodation_tier?.replace('_', ' ')}
        </Badge>
      </div>

      {/* Info */}
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Bed Count:</span>
          <span className="font-medium">{section.bed_count || 0} beds</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Available:</span>
          <span className="font-medium text-emerald-600">
            {section.available_beds_count || 0}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Rate Multiplier:</span>
          <span className="font-medium">{section.rate_multiplier}x</span>
        </div>
        {section.max_beds > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Max Beds:</span>
            <span className="font-medium">{section.max_beds}</span>
          </div>
        )}
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5">
        {section.gender_restriction === 'male_only' && (
          <Badge variant="outline" className="text-xs text-sky-700 bg-sky-50 border-sky-200">
            Male Only
          </Badge>
        )}
        {section.gender_restriction === 'female_only' && (
          <Badge variant="outline" className="text-xs text-rose-700 bg-rose-50 border-rose-200">
            Female Only
          </Badge>
        )}
        {section.is_isolation_capable && (
          <Badge variant="outline" className="text-xs">
            <Shield className="size-3 mr-1" />
            Isolation
          </Badge>
        )}
        {section.has_negative_pressure && (
          <Badge variant="outline" className="text-xs">
            Negative Pressure
          </Badge>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t">
        <Button variant="outline" size="sm" onClick={onEdit} className="flex-1">
          <Edit className="size-3.5 mr-1" />
          Edit
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="text-destructive">
              <Trash2 className="size-3.5" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Section</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{section.name}"? This action cannot be undone.
                {section.bed_count > 0 && (
                  <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded flex items-start gap-2">
                    <AlertCircle className="size-4 text-amber-600 mt-0.5 shrink-0" />
                    <span className="text-amber-900 text-sm">
                      This section has {section.bed_count} beds assigned to it.
                    </span>
                  </div>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

/**
 * SectionForm - Form for creating/editing sections
 */
function SectionForm({ wardId, section = null, onSubmit, isSubmitting }) {
  const isEdit = !!section;
  const [formData, setFormData] = useState({
    ward: wardId,
    name: section?.name || '',
    description: section?.description || '',
    gender_restriction: section?.gender_restriction || 'mixed',
    accommodation_tier: section?.accommodation_tier || 'open',
    rate_multiplier: section?.rate_multiplier || 1.0,
    is_isolation_capable: section?.is_isolation_capable || false,
    has_negative_pressure: section?.has_negative_pressure || false,
    default_isolation_type: section?.default_isolation_type || 'none',
    max_beds: section?.max_beds || 0,
    display_order: section?.display_order || 0,
    is_active: section?.is_active ?? true,
  });

  const handleChange = (key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit Section' : 'Create Section'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Update section details, gender restrictions, and accommodation tier'
            : 'Create a new section to organize beds by gender, accommodation tier, or isolation capability'}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 py-4">
        {/* Name */}
        <div className="space-y-2">
          <Label htmlFor="name">Section Name *</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => handleChange('name', e.target.value)}
            placeholder="e.g., Male Wing, VIP Suite, ICU"
            required
          />
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={formData.description}
            onChange={(e) => handleChange('description', e.target.value)}
            placeholder="Optional description..."
            rows={2}
          />
        </div>

        {/* Two columns */}
        <div className="grid grid-cols-2 gap-4">
          {/* Gender Restriction */}
          <div className="space-y-2">
            <Label htmlFor="gender_restriction">Gender Restriction</Label>
            <Select
              value={formData.gender_restriction}
              onValueChange={(value) => handleChange('gender_restriction', value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mixed">Mixed</SelectItem>
                <SelectItem value="male_only">Male Only</SelectItem>
                <SelectItem value="female_only">Female Only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Accommodation Tier */}
          <div className="space-y-2">
            <Label htmlFor="accommodation_tier">Accommodation Tier</Label>
            <Select
              value={formData.accommodation_tier}
              onValueChange={(value) => handleChange('accommodation_tier', value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open Ward (6+ beds)</SelectItem>
                <SelectItem value="semi_private">Semi-Private (2-4 beds)</SelectItem>
                <SelectItem value="private">Private (single room)</SelectItem>
                <SelectItem value="vip">VIP (premium)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Two columns */}
        <div className="grid grid-cols-2 gap-4">
          {/* Rate Multiplier */}
          <div className="space-y-2">
            <Label htmlFor="rate_multiplier">Rate Multiplier</Label>
            <Input
              id="rate_multiplier"
              type="number"
              step="0.01"
              min="0"
              value={formData.rate_multiplier}
              onChange={(e) => handleChange('rate_multiplier', parseFloat(e.target.value))}
              required
            />
          </div>

          {/* Max Beds */}
          <div className="space-y-2">
            <Label htmlFor="max_beds">Max Beds (0 = unlimited)</Label>
            <Input
              id="max_beds"
              type="number"
              min="0"
              value={formData.max_beds}
              onChange={(e) => handleChange('max_beds', parseInt(e.target.value))}
            />
          </div>
        </div>

        {/* Isolation Capable */}
        <div className="flex items-center gap-x-2">
          <Checkbox
            id="is_isolation_capable"
            checked={formData.is_isolation_capable}
            onCheckedChange={(checked) => handleChange('is_isolation_capable', checked)}
          />
          <Label htmlFor="is_isolation_capable" className="cursor-pointer">
            Isolation Capable
          </Label>
        </div>

        {/* Negative Pressure (conditional) */}
        {formData.is_isolation_capable && (
          <div className="flex items-center gap-x-2">
            <Checkbox
              id="has_negative_pressure"
              checked={formData.has_negative_pressure}
              onCheckedChange={(checked) => handleChange('has_negative_pressure', checked)}
            />
            <Label htmlFor="has_negative_pressure" className="cursor-pointer">
              Has Negative Pressure
            </Label>
          </div>
        )}

        {/* Default Isolation Type (conditional) */}
        {formData.is_isolation_capable && (
          <div className="space-y-2">
            <Label htmlFor="default_isolation_type">Default Isolation Type</Label>
            <Select
              value={formData.default_isolation_type}
              onValueChange={(value) => handleChange('default_isolation_type', value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="contact">Contact</SelectItem>
                <SelectItem value="droplet">Droplet</SelectItem>
                <SelectItem value="airborne">Airborne</SelectItem>
                <SelectItem value="protective">Protective</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Two columns */}
        <div className="grid grid-cols-2 gap-4">
          {/* Display Order */}
          <div className="space-y-2">
            <Label htmlFor="display_order">Display Order</Label>
            <Input
              id="display_order"
              type="number"
              min="0"
              value={formData.display_order}
              onChange={(e) => handleChange('display_order', parseInt(e.target.value))}
            />
          </div>

          {/* Active */}
          <div className="flex items-center gap-x-2 pt-8">
            <Checkbox
              id="is_active"
              checked={formData.is_active}
              onCheckedChange={(checked) => handleChange('is_active', checked)}
            />
            <Label htmlFor="is_active" className="cursor-pointer">
              Active
            </Label>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : isEdit ? 'Update Section' : 'Create Section'}
        </Button>
      </DialogFooter>
    </form>
  );
}
