import { useState } from 'react';
import { useActiveNoteTemplates } from '@/features/clinical-notes/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Component for selecting a clinical note template
 */
const TemplateSelector = ({ onSelectTemplate }) => {
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const { data: templates, isLoading, isError } = useActiveNoteTemplates();

  // Handle template selection
  const handleSelectTemplate = (templateId) => {
    setSelectedTemplateId(templateId);
  };

  // Handle template confirmation
  const handleConfirmTemplate = () => {
    if (!selectedTemplateId || !templates) return;
    
    const selectedTemplate = templates.find(template => template.id === selectedTemplateId);
    if (selectedTemplate && onSelectTemplate) {
      onSelectTemplate(selectedTemplate);
    }
  };

  if (isLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Select Template</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-1/3" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Error</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-red-500">Failed to load templates. Please try again later.</p>
        </CardContent>
      </Card>
    );
  }

  if (!templates || templates.length === 0) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>No Templates Available</CardTitle>
        </CardHeader>
        <CardContent>
          <p>No active templates found. Please create a template first.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Select Template</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select value={selectedTemplateId} onValueChange={handleSelectTemplate}>
          <SelectTrigger>
            <SelectValue placeholder="Select a template" />
          </SelectTrigger>
          <SelectContent>
            {templates.map(template => (
              <SelectItem key={template.id} value={template.id}>
                {template.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        <Button 
          onClick={handleConfirmTemplate} 
          disabled={!selectedTemplateId}
          className="w-full md:w-auto"
        >
          Use Template
        </Button>
      </CardContent>
    </Card>
  );
};

export default TemplateSelector;