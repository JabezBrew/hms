import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { useBreadcrumb } from '@/components/layout/PageBreadcrumb';
import { useNoteTemplates, useDeleteNoteTemplate } from '@/hooks/useClinicalNotesQueries';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Pencil, Trash2, Plus, Eye } from 'lucide-react';
import TemplateBuilder from '@/components/clinical-notes/TemplateBuilder';

export default function TemplateListPage() {
  const [activeTab, setActiveTab] = useState('list');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateToDelete, setTemplateToDelete] = useState(null);

  // Fetch templates
  const { data: templates, isLoading, isError, refetch } = useNoteTemplates();

  // Delete template mutation
  const deleteTemplate = useDeleteNoteTemplate();

  // Set breadcrumb
  const { updateBreadcrumbs } = useBreadcrumb();

  // Update breadcrumbs
  useEffect(() => {
    updateBreadcrumbs([
      { label: 'Clinical Notes', path: '/clinical-notes' },
      { label: 'Templates', path: '/clinical-notes/templates' }
    ]);
  }, [updateBreadcrumbs]);

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
    <>
      <Helmet>
        <title>Clinical Note Templates | HMS</title>
        <meta name="description" content="Manage clinical note templates" />
      </Helmet>

      <div className="container mx-auto py-6 space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Clinical Note Templates</h1>
            <p className="text-muted-foreground">
              Create and manage templates for clinical documentation
            </p>
          </div>

          {activeTab === 'list' && (
            <Button onClick={() => setActiveTab('create')}>
              <Plus className="h-4 w-4 mr-2" />
              Create Template
            </Button>
          )}

          {activeTab !== 'list' && (
            <Button variant="outline" onClick={() => {
              setActiveTab('list');
              setSelectedTemplate(null);
            }}>
              Back to Templates
            </Button>
          )}
        </div>

        <Separator />

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
                      <p className="text-sm text-muted-foreground">
                        {template.structure.length} section{template.structure.length !== 1 ? 's' : ''}
                      </p>
                      <div className="mt-2">
                        <ul className="text-sm list-disc list-inside">
                          {template.structure.slice(0, 3).map((section, index) => (
                            <li key={index} className="truncate">
                              {section.section}
                            </li>
                          ))}
                          {template.structure.length > 3 && (
                            <li className="text-muted-foreground">
                              +{template.structure.length - 3} more
                            </li>
                          )}
                        </ul>
                      </div>
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
                      {selectedTemplate.structure.map((section, index) => (
                        <div key={index} className="border rounded-md p-4">
                          <div className="flex justify-between items-center">
                            <h4 className="font-medium">{section.section}</h4>
                            <Badge variant="outline">
                              {section.type}
                              {section.observation_type && ` (${section.observation_type})`}
                            </Badge>
                          </div>
                        </div>
                      ))}
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
    </>
  );
}
