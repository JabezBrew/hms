import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Pencil from 'lucide-react/dist/esm/icons/pencil.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid.js';
import List from 'lucide-react/dist/esm/icons/list.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import Globe from 'lucide-react/dist/esm/icons/globe.js';
import Lock from 'lucide-react/dist/esm/icons/lock.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useBreadcrumb } from '@/components/layout/PageBreadcrumb';
import { useNoteTemplates, useDeleteNoteTemplate } from '@/hooks/useClinicalNotesQueries';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import TemplateBuilder from '@/components/clinical-notes/TemplateBuilder';

/**
 * TemplateListPage - Chronicle-style clinical note templates
 *
 * Features:
 * - Magazine-style template cards
 * - Search functionality
 * - Grid/list view toggle
 * - Mobile responsive
 */
export default function TemplateListPage() {
  const navigate = useNavigate();
  const [view, setView] = useState('list'); // 'list', 'create', 'edit', 'detail'
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateToDelete, setTemplateToDelete] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grid');

  // Fetch templates
  const { data: templates = [], isLoading, isError, refetch } = useNoteTemplates();

  // Delete template mutation
  const deleteTemplate = useDeleteNoteTemplate();

  // Set breadcrumb
  const { updateBreadcrumbs } = useBreadcrumb();

  useEffect(() => {
    updateBreadcrumbs([
      { label: 'Clinical Notes', path: '/clinical-notes' },
      { label: 'Templates', path: '/clinical-notes/templates' }
    ]);
  }, [updateBreadcrumbs]);

  // Filter templates by search
  const filteredTemplates = useMemo(() => {
    if (!searchQuery) return templates;
    const query = searchQuery.toLowerCase();
    return templates.filter(t =>
      t.title?.toLowerCase().includes(query) ||
      t.description?.toLowerCase().includes(query) ||
      t.created_by_name?.toLowerCase().includes(query)
    );
  }, [templates, searchQuery]);

  // Calculate stats
  const stats = useMemo(() => ({
    total: templates.length,
    active: templates.filter(t => t.is_active).length,
    public: templates.filter(t => t.is_public).length
  }), [templates]);

  // Get sections from template structure
  const getSections = (template) => {
    return Array.isArray(template.structure)
      ? template.structure
      : template.structure?.sections || [];
  };

  // Handle template creation success
  const handleTemplateSuccess = () => {
    toast.success(selectedTemplate ? 'Template updated successfully' : 'Template created successfully');
    setView('list');
    setSelectedTemplate(null);
    refetch();
  };

  // Handle template deletion
  const handleDeleteTemplate = async () => {
    if (!templateToDelete) return;
    try {
      await deleteTemplate.mutateAsync(templateToDelete.id);
      toast.success('Template deleted successfully');
      setTemplateToDelete(null);
      refetch();
    } catch (error) {
      toast.error('Failed to delete template');
      console.error('Error deleting template:', error);
    }
  };

  // Render list view
  if (view === 'list') {
    return (
      <>
        <Helmet>
          <title>Clinical Note Templates | HMS</title>
        </Helmet>

        <div className="min-h-screen bg-background">
          {/* Page Header */}
          <header className="bg-card border-b border-border px-4 sm:px-6 py-4 sm:py-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4 sm:mb-6">
              <div>
                <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl text-foreground tracking-tight mb-1">
                  Note Templates
                </h1>
                <p className="text-sm text-muted-foreground">
                  {stats.total} templates
                  {stats.active !== stats.total && (
                    <span className="ml-2">· {stats.active} active</span>
                  )}
                  {stats.public > 0 && (
                    <span className="text-primary ml-2">· {stats.public} public</span>
                  )}
                </p>
              </div>

              <Button
                onClick={() => setView('create')}
                size="sm"
                className="font-mono text-xs w-full sm:w-auto"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Template
              </Button>
            </div>

            {/* Search and Filters */}
            <div className="flex flex-col gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search templates..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 font-mono text-sm bg-background"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* View Mode Toggle */}
                <div className="flex bg-muted rounded-lg p-0.5 ml-auto">
                  <button
                    onClick={() => setViewMode('grid')}
                    className={cn(
                      "p-1.5 rounded-md transition-colors",
                      viewMode === 'grid'
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={cn(
                      "p-1.5 rounded-md transition-colors",
                      viewMode === 'list'
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <List className="h-4 w-4" />
                  </button>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => refetch()}
                  className="shrink-0 h-9 w-9"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>

                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSearchQuery('')}
                    className="font-mono text-xs h-9"
                  >
                    <X className="h-4 w-4 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </header>

          {/* Template List */}
          <main className="p-4 sm:p-6">
            {isLoading ? (
              <LoadingSkeleton viewMode={viewMode} />
            ) : isError ? (
              <ErrorState onRetry={refetch} />
            ) : filteredTemplates.length === 0 ? (
              <EmptyState
                hasSearch={!!searchQuery}
                onClear={() => setSearchQuery('')}
                onCreate={() => setView('create')}
              />
            ) : (
              <div className={cn(
                viewMode === 'grid'
                  ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6"
                  : "space-y-4"
              )}>
                {filteredTemplates.map((template, index) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    index={index}
                    sections={getSections(template)}
                    viewMode={viewMode}
                    onView={() => {
                      setSelectedTemplate(template);
                      setView('detail');
                    }}
                    onEdit={() => {
                      setSelectedTemplate(template);
                      setView('edit');
                    }}
                    onDelete={() => setTemplateToDelete(template)}
                  />
                ))}
              </div>
            )}
          </main>

          {/* Delete Confirmation Dialog */}
          <AlertDialog open={!!templateToDelete} onOpenChange={() => setTemplateToDelete(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Template</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete "{templateToDelete?.title}"?
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteTemplate}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </>
    );
  }

  // Render create/edit view
  if (view === 'create' || view === 'edit') {
    return (
      <>
        <Helmet>
          <title>{view === 'edit' ? 'Edit Template' : 'Create Template'} | HMS</title>
        </Helmet>

        <div className="min-h-screen bg-background">
          <header className="bg-card border-b border-border px-4 sm:px-6 py-4 sm:py-6">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setView('list');
                  setSelectedTemplate(null);
                }}
                className="-ml-2"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Templates
              </Button>
              <div>
                <h1 className="font-display text-xl sm:text-2xl text-foreground tracking-tight">
                  {view === 'edit' ? 'Edit Template' : 'Create Template'}
                </h1>
              </div>
            </div>
          </header>

          <main className="p-4 sm:p-6">
            <TemplateBuilder
              initialTemplate={selectedTemplate}
              onSuccess={handleTemplateSuccess}
            />
          </main>
        </div>
      </>
    );
  }

  // Render detail view
  if (view === 'detail' && selectedTemplate) {
    const sections = getSections(selectedTemplate);

    return (
      <>
        <Helmet>
          <title>{selectedTemplate.title} | HMS</title>
        </Helmet>

        <div className="min-h-screen bg-background">
          <header className="bg-card border-b border-border px-4 sm:px-6 py-4 sm:py-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setView('list');
                    setSelectedTemplate(null);
                  }}
                  className="-ml-2"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Templates
                </Button>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setView('edit')}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              </div>
            </div>
          </header>

          <main className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
            {/* Template Header */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl sm:text-3xl text-foreground tracking-tight">
                  {selectedTemplate.title}
                </h1>
                <div className="flex gap-1.5">
                  <span className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                    selectedTemplate.is_active
                      ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30"
                      : "bg-muted text-muted-foreground border border-border"
                  )}>
                    {selectedTemplate.is_active ? (
                      <CheckCircle className="h-3 w-3" />
                    ) : (
                      <XCircle className="h-3 w-3" />
                    )}
                    {selectedTemplate.is_active ? 'Active' : 'Inactive'}
                  </span>
                  <span className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                    selectedTemplate.is_public
                      ? "bg-sky-500/10 text-sky-600 border border-sky-500/30"
                      : "bg-muted text-muted-foreground border border-border"
                  )}>
                    {selectedTemplate.is_public ? (
                      <Globe className="h-3 w-3" />
                    ) : (
                      <Lock className="h-3 w-3" />
                    )}
                    {selectedTemplate.is_public ? 'Public' : 'Private'}
                  </span>
                </div>
              </div>
              {selectedTemplate.description && (
                <p className="text-muted-foreground">
                  {selectedTemplate.description}
                </p>
              )}
              {selectedTemplate.created_by_name && (
                <p className="font-mono text-xs text-muted-foreground">
                  Created by {selectedTemplate.created_by_name}
                </p>
              )}
            </div>

            {/* Template Structure */}
            <section>
              <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
                <FileText className="h-5 w-5 text-muted-foreground" />
                Template Structure
              </h2>
              <div className="space-y-3">
                {sections.map((section, index) => (
                  <div
                    key={index}
                    className="p-4 rounded-xl bg-card/50 border border-border flex items-center justify-between"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div>
                      <h3 className="font-medium text-foreground">
                        {section.name || section.section}
                      </h3>
                      <p className="font-mono text-xs text-muted-foreground mt-0.5">
                        {section.type}
                        {(section.observationType || section.observation_type) &&
                          ` · ${section.observationType || section.observation_type}`}
                      </p>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                      Section {index + 1}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </main>
        </div>
      </>
    );
  }

  return null;
}

/**
 * TemplateCard - Chronicle-style template card
 */
function TemplateCard({ template, index, sections, viewMode, onView, onEdit, onDelete }) {
  return (
    <article
      onClick={onView}
      className={cn(
        "group relative bg-card/50 backdrop-blur border border-border",
        "rounded-xl sm:rounded-2xl p-4 sm:p-6 cursor-pointer",
        "hover:border-primary/30 transition-all duration-500",
        "hover:shadow-[0_0_40px_-12px_var(--chronicle-amber)]",
        "animate-chronicle-enter",
        viewMode === 'list' && "max-w-none"
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Status Bar */}
      <div className={cn(
        "absolute top-0 left-0 right-0 h-1 rounded-t-xl sm:rounded-t-2xl",
        template.is_active
          ? "bg-gradient-to-r from-emerald-500/30 to-transparent"
          : "bg-gradient-to-r from-muted/50 to-transparent"
      )} />

      {/* Header */}
      <header className="flex items-start justify-between gap-2 mb-3 sm:mb-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg sm:text-xl text-foreground tracking-tight truncate">
            {template.title}
          </h3>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1 line-clamp-2">
            {template.description || 'No description'}
          </p>
        </div>

        {/* Status Badges */}
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1 sm:gap-2 shrink-0">
          <span className={cn(
            "inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium",
            template.is_active
              ? "bg-emerald-500/10 text-emerald-600"
              : "bg-muted text-muted-foreground"
          )}>
            {template.is_active ? 'Active' : 'Inactive'}
          </span>
          {template.is_public && (
            <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-sky-500/10 text-sky-600">
              <Globe className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
              <span className="hidden sm:inline">Public</span>
            </span>
          )}
        </div>
      </header>

      {/* Synopsis */}
      <div className="mb-3 sm:mb-4 p-2 sm:p-3 rounded-lg sm:rounded-xl bg-background/50">
        <p className="font-mono text-[10px] sm:text-xs text-muted-foreground mb-1">
          {sections.length} section{sections.length !== 1 ? 's' : ''}
        </p>
        <ul className="space-y-0.5">
          {sections.slice(0, 3).map((section, idx) => (
            <li key={idx} className="font-mono text-xs text-foreground/80 truncate">
              · {section.name || section.section}
            </li>
          ))}
          {sections.length > 3 && (
            <li className="font-mono text-xs text-muted-foreground">
              +{sections.length - 3} more
            </li>
          )}
        </ul>
      </div>

      {/* Footer */}
      <footer className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 sm:pt-4 border-t border-border">
        {template.created_by_name && (
          <p className="font-mono text-[10px] sm:text-xs text-muted-foreground truncate">
            by {template.created_by_name}
          </p>
        )}

        {/* Actions - Always visible on mobile */}
        <div className="flex gap-2 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity ml-auto">
          <Button
            variant="secondary"
            size="sm"
            className="font-mono text-[10px] sm:text-xs h-8"
            onClick={(e) => {
              e.stopPropagation();
              onView();
            }}
          >
            <Eye className="h-3 w-3 mr-1" />
            View
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="font-mono text-[10px] sm:text-xs h-8"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="font-mono text-[10px] sm:text-xs h-8 text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </footer>
    </article>
  );
}

/**
 * LoadingSkeleton - Loading state
 */
function LoadingSkeleton({ viewMode }) {
  const count = viewMode === 'grid' ? 6 : 4;
  return (
    <div className={cn(
      viewMode === 'grid'
        ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6"
        : "space-y-4"
    )}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-card/50 border border-border rounded-2xl p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-56" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-20 w-full rounded-xl" />
          <div className="flex justify-between pt-4 border-t border-border">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * ErrorState - Error display
 */
function ErrorState({ onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <XCircle className="h-8 w-8 text-destructive" />
      </div>
      <h3 className="font-display text-xl text-foreground mb-2">Failed to load templates</h3>
      <p className="text-muted-foreground text-sm mb-4">Please try again later.</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="h-4 w-4 mr-2" />
        Try Again
      </Button>
    </div>
  );
}

/**
 * EmptyState - No templates state
 */
function EmptyState({ hasSearch, onClear, onCreate }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <FileText className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="font-display text-xl text-foreground mb-2">
        {hasSearch ? 'No matching templates' : 'No templates yet'}
      </h3>
      <p className="text-muted-foreground text-sm mb-4 max-w-md">
        {hasSearch
          ? 'Try adjusting your search.'
          : 'Create your first template to streamline clinical documentation.'}
      </p>
      {hasSearch ? (
        <Button variant="outline" size="sm" onClick={onClear}>
          <X className="h-4 w-4 mr-2" />
          Clear Search
        </Button>
      ) : (
        <Button size="sm" onClick={onCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Create Template
        </Button>
      )}
    </div>
  );
}
