/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
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
import { useState, useMemo } from 'react';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { useNoteTemplates, useDeleteNoteTemplate } from '@/features/clinical-notes/hooks';
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
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';

/**
 * TemplateListPage - Chronicle-style clinical note templates
 *
 * Features:
 * - Magazine-style template cards
 * - Search functionality
 * - Grid/list view toggle
 * - Mobile responsive
 */
function getTemplateSections(template) {
  return Array.isArray(template.structure)
    ? template.structure
    : template.structure?.sections || [];
}

function TemplateListView({
  filteredTemplates,
  headerDescription,
  isError,
  isLoading,
  onClearSearch,
  onCreate,
  onDelete,
  onEdit,
  onRefresh,
  onSearchChange,
  onView,
  pageMeta,
  searchQuery,
  setViewMode,
  viewMode,
}) {
  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title="Note Templates"
        description={headerDescription}
        actions={(
          <Button
            onClick={onCreate}
            size="sm"
            className="font-mono text-xs w-full sm:w-auto"
            data-onboarding="note-template-create"
          >
            <Plus className="size-4 mr-2" />
            Create Template
          </Button>
        )}
      />

      <main className="p-4 sm:p-6 space-y-4">
        <TemplateListToolbar
          onClearSearch={onClearSearch}
          onRefresh={onRefresh}
          onSearchChange={onSearchChange}
          searchQuery={searchQuery}
          setViewMode={setViewMode}
          viewMode={viewMode}
        />

        {isLoading ? (
          <LoadingSkeleton viewMode={viewMode} />
        ) : isError ? (
          <ErrorState onRetry={onRefresh} />
        ) : filteredTemplates.length === 0 ? (
          <EmptyState
            hasSearch={!!searchQuery}
            onClear={onClearSearch}
            onCreate={onCreate}
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
                sections={getTemplateSections(template)}
                viewMode={viewMode}
                onView={() => onView(template)}
                onEdit={() => onEdit(template)}
                onDelete={() => onDelete(template)}
              />
            ))}
          </div>
        )}
      </main>
    </PageShell>
  );
}

function TemplateListToolbar({
  onClearSearch,
  onRefresh,
  onSearchChange,
  searchQuery,
  setViewMode,
  viewMode,
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search templates..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10 font-mono text-sm bg-background"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-muted rounded-lg p-0.5 ml-auto">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              viewMode === 'grid'
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              viewMode === 'list'
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <List className="size-4" />
          </button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          className="shrink-0 size-9"
        >
          <RefreshCw className="size-4" />
        </Button>

        {searchQuery ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearSearch}
            className="font-mono text-xs h-9"
          >
            <X className="size-4 mr-1" />
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function TemplateEditorView({ isEditingTemplate, onBack, onTemplateSuccess, pageMeta, selectedTemplate }) {
  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title={(
          <span className="flex items-center gap-3">
            <span className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-900/30">
              <ClipboardList className="size-6 text-amber-600 dark:text-amber-400" />
            </span>
            {isEditingTemplate ? 'Edit Note Template' : 'New Note Template'}
          </span>
        )}
        description={
          isEditingTemplate
            ? selectedTemplate?.title || 'Update template sections and sharing rules.'
            : 'Build a Chronicle-aligned template for structured clinical documentation.'
        }
        descriptionClassName="font-mono text-xs text-muted-foreground"
        contentClassName="max-w-6xl mx-auto w-full"
        actions={(
          <Button
            variant="outline"
            size="sm"
            onClick={onBack}
            className="font-mono text-xs"
          >
            <ChevronLeft className="size-4 mr-1.5" />
            Back to Templates
          </Button>
        )}
      />

      <main className="p-4 sm:p-6 max-w-6xl mx-auto w-full">
        <TemplateBuilder
          initialTemplate={selectedTemplate}
          onSuccess={onTemplateSuccess}
        />
      </main>
    </PageShell>
  );
}

function TemplateDetailView({ onBack, onEdit, pageMeta, selectedTemplate }) {
  const sections = getTemplateSections(selectedTemplate);

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title="Note Template"
        description={selectedTemplate.description || 'Clinical note template details'}
        contentClassName="max-w-4xl mx-auto w-full"
        actions={(
          <Button
            variant="outline"
            size="sm"
            onClick={onEdit}
          >
            <Pencil className="size-4 mr-2" />
            Edit
          </Button>
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="-ml-2"
        >
          <ChevronLeft className="size-4 mr-1" />
          Templates
        </Button>
      </PageHeader>

      <main className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
        <TemplateDetailHeader selectedTemplate={selectedTemplate} />
        <TemplateStructure sections={sections} />
      </main>
    </PageShell>
  );
}

function TemplateDetailHeader({ selectedTemplate }) {
  return (
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
              <CheckCircle className="size-3" />
            ) : (
              <XCircle className="size-3" />
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
              <Globe className="size-3" />
            ) : (
              <Lock className="size-3" />
            )}
            {selectedTemplate.is_public ? 'Public' : 'Private'}
          </span>
        </div>
      </div>
      {selectedTemplate.description ? (
        <p className="text-muted-foreground">
          {selectedTemplate.description}
        </p>
      ) : null}
      {selectedTemplate.created_by_name ? (
        <p className="font-mono text-xs text-muted-foreground">
          Created by {selectedTemplate.created_by_name}
        </p>
      ) : null}
    </div>
  );
}

function TemplateStructure({ sections }) {
  return (
    <section>
      <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
        <FileText className="size-5 text-muted-foreground" />
        Template Structure
      </h2>
      <div className="space-y-3">
        {sections.map((section, index) => (
          <div
            key={section.id || section.name || section.section}
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
  );
}

function DeleteTemplateDialog({ onConfirm, onOpenChange, templateToDelete }) {
  return (
    <AlertDialog open={!!templateToDelete} onOpenChange={onOpenChange}>
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
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function TemplateListPage() {
  const [view, setView] = useState('list'); // 'list', 'create', 'edit', 'detail'
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateToDelete, setTemplateToDelete] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grid');

  // Fetch templates
  const { data: templates = [], isLoading, isError, refetch } = useNoteTemplates({ page_size: 200 });

  // Delete template mutation
  const deleteTemplate = useDeleteNoteTemplate();

  const pageTitle = view === 'edit'
    ? 'Edit Template | HMS'
    : view === 'create'
    ? 'Create Template | HMS'
    : view === 'detail'
    ? `${selectedTemplate?.title || 'Template'} | HMS`
    : 'Clinical Note Templates | HMS';

  const pageMeta = usePageMeta({
    title: pageTitle,
    breadcrumbs: [
      { label: 'Clinical Notes', href: '/clinical-notes' },
      { label: 'Templates', href: '/clinical-notes/templates' },
    ],
  });

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

  const headerDescription = (
    <span>
      {stats.total} templates
      {stats.active !== stats.total && (
        <span className="ml-2">· {stats.active} active</span>
      )}
      {stats.public > 0 && (
        <span className="text-primary ml-2">· {stats.public} public</span>
      )}
    </span>
  );

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
    } catch {
      toast.error('Failed to delete template');
    }
  };

  // Render list view
  if (view === 'list') {
    return (
      <>
        <TemplateListView
          filteredTemplates={filteredTemplates}
          headerDescription={headerDescription}
          isError={isError}
          isLoading={isLoading}
          onClearSearch={() => setSearchQuery('')}
          onCreate={() => setView('create')}
          onDelete={setTemplateToDelete}
          onEdit={(template) => {
            setSelectedTemplate(template);
            setView('edit');
          }}
          onRefresh={refetch}
          onSearchChange={setSearchQuery}
          onView={(template) => {
            setSelectedTemplate(template);
            setView('detail');
          }}
          pageMeta={pageMeta}
          searchQuery={searchQuery}
          setViewMode={setViewMode}
          viewMode={viewMode}
        />
        <DeleteTemplateDialog
          onConfirm={handleDeleteTemplate}
          onOpenChange={() => setTemplateToDelete(null)}
          templateToDelete={templateToDelete}
        />
      </>
    );
  }

  // Render create/edit view
  if (view === 'create' || view === 'edit') {
    const isEditingTemplate = view === 'edit';

    return (
      <TemplateEditorView
        isEditingTemplate={isEditingTemplate}
        onBack={() => {
          setView('list');
          setSelectedTemplate(null);
        }}
        onTemplateSuccess={handleTemplateSuccess}
        pageMeta={pageMeta}
        selectedTemplate={selectedTemplate}
      />
    );
  }

  // Render detail view
  if (view === 'detail' && selectedTemplate) {
    return (
      <TemplateDetailView
        onBack={() => {
          setView('list');
          setSelectedTemplate(null);
        }}
        onEdit={() => setView('edit')}
        pageMeta={pageMeta}
        selectedTemplate={selectedTemplate}
      />
    );
  }

  return null;
}

/**
 * TemplateCard - Chronicle-style template card
 */
function TemplateCard({ template, index, sections, viewMode, onView, onEdit, onDelete }) {
  return (
    <div
      className={cn(
        "group relative bg-card/50 backdrop-blur border border-border",
        "rounded-xl sm:rounded-2xl p-4 sm:p-6",
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
              <Globe className="size-2.5 sm:h-3 sm:w-3" />
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
        <div className="flex gap-2 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity ml-auto">
          <Button
            variant="secondary"
            size="sm"
            className="font-mono text-[10px] sm:text-xs h-8"
            onClick={(e) => {
              e.stopPropagation();
              onView();
            }}
          >
            <Eye className="size-3 mr-1" />
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
            <Pencil className="size-3 mr-1" />
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
            <Trash2 className="size-3" />
          </Button>
        </div>
      </footer>
    </div>
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
      <div className="size-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <XCircle className="size-8 text-destructive" />
      </div>
      <h3 className="font-display text-xl text-foreground mb-2">Failed to load templates</h3>
      <p className="text-muted-foreground text-sm mb-4">Please try again later.</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="size-4 mr-2" />
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
      <div className="size-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <FileText className="size-8 text-muted-foreground" />
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
          <X className="size-4 mr-2" />
          Clear Search
        </Button>
      ) : (
        <Button size="sm" onClick={onCreate} data-onboarding="note-template-create">
          <Plus className="size-4 mr-2" />
          Create Template
        </Button>
      )}
    </div>
  );
}
