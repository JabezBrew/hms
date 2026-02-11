import Pencil from 'lucide-react/dist/esm/icons/pencil.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import { useState } from 'react';
import { useNoteTemplates, useDeleteNoteTemplate } from '@/features/clinical-notes/hooks';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

import TemplateBuilder from '@/components/clinical-notes/TemplateBuilder';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

export default function TemplateListPage() {
  const [activeTab, setActiveTab] = useState('list');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateToDelete, setTemplateToDelete] = useState(null);

  // Fetch templates
  const { data: templates, isLoading, isError, refetch } = useNoteTemplates();

  // Delete template mutation
  const deleteTemplate = useDeleteNoteTemplate();

  const pageMeta = usePageMeta({
    title: 'Clinical Note Templates | HMS',
    breadcrumbs: [
      { label: 'Clinical Notes', href: '/clinical-notes' },
      { label: 'Templates', href: '/clinical-notes/templates' },
    ],
  });

  // Handle template creation success
  const handleTemplateCreationSuccess = () => {
    toast.success('Template created successfully');
    setActiveTab('list');
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

  // View template details
  const viewTemplateDetails = (template) => {
    setSelectedTemplate(template);
    setActiveTab('view');
  };

  // Edit template
  const editTemplate = (template) => {
    setSelectedTemplate(template);
    setActiveTab('edit');
  };

  return (
    <PageShell>
      {pageMeta}
        <PageHeader
          title="Clinical Note Templates"
          description="Create and manage templates for clinical documentation"
          actions={(
            activeTab === 'list' ? (
              <Button onClick={() => setActiveTab('create')}>
                <Plus className="h-4 w-4 mr-2" />
                Create Template
              </Button>
            ) : (
              <Button variant="outline" onClick={() => {
                setActiveTab('list');
                setSelectedTemplate(null);
              }}>
                Back to Templates
              </Button>
            )
          )}
          contentClassName="max-w-6xl mx-auto w-full"
        />

        <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="hidden">
            <TabsTrigger value="list">Templates</TabsTrigger>
            <TabsTrigger value="create">Create Template</TabsTrigger>
            <TabsTrigger value="edit">Edit Template</TabsTrigger>
            <TabsTrigger value="view">View Template</TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="space-y-4">
            {isLoading ? (
              <Card>
                <CardHeader>
                  <CardTitle>Loading templates...</CardTitle>
                </CardHeader>
              </Card>
            ) : isError ? (
              <Card>
                <CardHeader>
                  <CardTitle>Error</CardTitle>
                  <CardDescription>Failed to load templates. Please try again later.</CardDescription>
                </CardHeader>
              </Card>
            ) : !templates || templates.length === 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>No Templates</CardTitle>
                  <CardDescription>No templates found. Create your first template to get started.</CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button onClick={() => setActiveTab('create')}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Template
                  </Button>
                </CardFooter>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {templates.map(template => (
                  <Card key={template.id} className="flex flex-col">
                    <CardHeader>
                      <div className="flex justify-between items-start">
                        <CardTitle className="truncate">{template.title}</CardTitle>
                        <div className="flex space-x-1">
                          {template.is_active ? (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">
                              Inactive
                            </Badge>
                          )}
                          {template.is_public && (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                              Public
                            </Badge>
                          )}
                        </div>
                      </div>
                      <CardDescription className="line-clamp-2">
                        {template.description || 'No description provided'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow">
                      {(() => {
                        // Handle both array and object structure formats
                        const sections = Array.isArray(template.structure)
                          ? template.structure
                          : template.structure?.sections || [];
                        return (
                          <>
                            <p className="text-sm text-muted-foreground">
                              {sections.length} section{sections.length !== 1 ? 's' : ''}
                            </p>
                            <div className="mt-2">
                              <ul className="text-sm list-disc list-inside">
                                {sections.slice(0, 3).map((section, index) => (
                                  <li key={index} className="truncate">
                                    {section.name || section.section}
                                  </li>
                                ))}
                                {sections.length > 3 && (
                                  <li className="text-muted-foreground">
                                    +{sections.length - 3} more
                                  </li>
                                )}
                              </ul>
                            </div>
                          </>
                        );
                      })()}
                    </CardContent>
                    <CardFooter className="flex justify-between">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => viewTemplateDetails(template)}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        View
                      </Button>
                      <div className="flex space-x-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => editTemplate(template)}
                        >
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button 
                              variant="outline" 
                              size="sm"
                              className="text-red-500 hover:text-red-700"
                              onClick={() => setTemplateToDelete(template)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Template</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete the template "{templateToDelete?.title}"? 
                                This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel onClick={() => setTemplateToDelete(null)}>
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={handleDeleteTemplate}
                                className="bg-red-500 hover:bg-red-600"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="create">
            <TemplateBuilder onSuccess={handleTemplateCreationSuccess} />
          </TabsContent>

          <TabsContent value="edit">
            {selectedTemplate && (
              <TemplateBuilder 
                initialTemplate={selectedTemplate} 
                onSuccess={handleTemplateCreationSuccess} 
              />
            )}
          </TabsContent>

          <TabsContent value="view">
            {selectedTemplate && (
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle>{selectedTemplate.title}</CardTitle>
                      <CardDescription>{selectedTemplate.description || 'No description provided'}</CardDescription>
                    </div>
                    <div className="flex space-x-2">
                      {selectedTemplate.is_active ? (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">
                          Inactive
                        </Badge>
                      )}
                      {selectedTemplate.is_public && (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                          Public
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h3 className="text-lg font-medium">Template Structure</h3>
                    <Separator className="my-2" />
                    <div className="space-y-4 mt-4">
                      {(() => {
                        const sections = Array.isArray(selectedTemplate.structure)
                          ? selectedTemplate.structure
                          : selectedTemplate.structure?.sections || [];
                        return sections.map((section, index) => (
                          <div key={index} className="border rounded-md p-4">
                            <div className="flex justify-between items-center">
                              <h4 className="font-medium">{section.name || section.section}</h4>
                              <Badge variant="outline">
                                {section.type}
                                {(section.observationType || section.observation_type) &&
                                  ` (${section.observationType || section.observation_type})`}
                              </Badge>
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-between">
                  <Button 
                    variant="outline" 
                    onClick={() => setActiveTab('list')}
                  >
                    Back to Templates
                  </Button>
                  <Button 
                    onClick={() => editTemplate(selectedTemplate)}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit Template
                  </Button>
                </CardFooter>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}
