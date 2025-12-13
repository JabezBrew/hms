import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, Plus, CheckCircle2, XCircle, Shield, Loader2 } from 'lucide-react';
import {
  usePatientAllergies,
  useCreateAllergy,
  useDeactivateAllergy,
  useVerifyAllergy,
} from '@/hooks/useDrugSafetyQueries';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

const ALLERGY_TYPES = [
  { value: 'drug', label: 'Drug' },
  { value: 'food', label: 'Food' },
  { value: 'environmental', label: 'Environmental' },
  { value: 'other', label: 'Other' },
];

const SEVERITY_LEVELS = [
  { value: 'mild', label: 'Mild', color: 'bg-blue-100 text-blue-800' },
  { value: 'moderate', label: 'Moderate', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'severe', label: 'Severe', color: 'bg-orange-100 text-orange-800' },
  { value: 'life_threatening', label: 'Life Threatening', color: 'bg-red-100 text-red-800' },
];

/**
 * AllergyManager - Component for managing patient allergies
 *
 * @param {Object} props
 * @param {string} props.patientId - Patient ID
 * @param {boolean} props.editable - Whether allergies can be edited
 * @param {boolean} props.compact - Compact view mode
 */
export function AllergyManager({ patientId, editable = true, compact = false }) {
  const [isAddingAllergy, setIsAddingAllergy] = useState(false);
  const [newAllergy, setNewAllergy] = useState({
    allergen_name: '',
    allergy_type: 'drug',
    severity: 'moderate',
    reaction_description: '',
    notes: '',
  });

  const { data: allergiesData, isLoading } = usePatientAllergies(patientId);
  const createAllergy = useCreateAllergy();
  const deactivateAllergy = useDeactivateAllergy();
  const verifyAllergy = useVerifyAllergy();

  const allergies = allergiesData?.allergies || [];
  const activeAllergies = allergies.filter((a) => a.is_active);

  const handleAddAllergy = async () => {
    if (!newAllergy.allergen_name.trim()) {
      toast.error('Please enter the allergen name');
      return;
    }

    try {
      await createAllergy.mutateAsync({
        ...newAllergy,
        patient: patientId,
      });

      toast.success('Allergy added successfully');
      setIsAddingAllergy(false);
      setNewAllergy({
        allergen_name: '',
        allergy_type: 'drug',
        severity: 'moderate',
        reaction_description: '',
        notes: '',
      });
    } catch (error) {
      toast.error('Failed to add allergy');
    }
  };

  const handleDeactivate = async (allergyId) => {
    if (!confirm('Are you sure you want to deactivate this allergy?')) {
      return;
    }

    try {
      await deactivateAllergy.mutateAsync(allergyId);
      toast.success('Allergy deactivated');
    } catch (error) {
      toast.error('Failed to deactivate allergy');
    }
  };

  const handleVerify = async (allergyId) => {
    try {
      await verifyAllergy.mutateAsync(allergyId);
      toast.success('Allergy verified');
    } catch (error) {
      toast.error('Failed to verify allergy');
    }
  };

  const getSeverityConfig = (severity) => {
    return SEVERITY_LEVELS.find((s) => s.value === severity) || SEVERITY_LEVELS[1];
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <div className="space-y-2">
        {activeAllergies.length === 0 ? (
          <p className="text-sm text-muted-foreground">No known allergies</p>
        ) : (
          activeAllergies.map((allergy) => {
            const severityConfig = getSeverityConfig(allergy.severity);
            return (
              <div
                key={allergy.id}
                className="flex items-center justify-between p-2 border rounded-lg"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-600" />
                  <span className="font-medium">{allergy.allergen_name}</span>
                  <Badge className={severityConfig.color} variant="outline">
                    {severityConfig.label}
                  </Badge>
                </div>
                {allergy.verified_by && (
                  <Shield className="h-4 w-4 text-green-600" title="Verified" />
                )}
              </div>
            );
          })
        )}
      </div>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Allergies & Intolerances</CardTitle>
              <CardDescription>
                {activeAllergies.length} active {activeAllergies.length === 1 ? 'allergy' : 'allergies'}
              </CardDescription>
            </div>
            {editable && (
              <Button onClick={() => setIsAddingAllergy(true)} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Allergy
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {activeAllergies.length === 0 ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>No known allergies or intolerances on file.</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              {activeAllergies.map((allergy) => {
                const severityConfig = getSeverityConfig(allergy.severity);
                return (
                  <Card key={allergy.id} className="border-l-4 border-l-orange-500">
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className="h-5 w-5 text-orange-600" />
                            <h4 className="font-semibold text-lg">{allergy.allergen_name}</h4>
                            <Badge className={severityConfig.color} variant="outline">
                              {severityConfig.label}
                            </Badge>
                            <Badge variant="outline">{allergy.allergy_type_display}</Badge>
                            {allergy.verified_by && (
                              <Badge variant="default" className="bg-green-600">
                                <Shield className="h-3 w-3 mr-1" />
                                Verified
                              </Badge>
                            )}
                          </div>

                          {allergy.reaction_description && (
                            <p className="text-sm text-muted-foreground mt-2">
                              <span className="font-medium">Reaction:</span>{' '}
                              {allergy.reaction_description}
                            </p>
                          )}

                          {allergy.notes && (
                            <p className="text-sm text-muted-foreground mt-1">
                              <span className="font-medium">Notes:</span> {allergy.notes}
                            </p>
                          )}

                          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                            <span>
                              Added by {allergy.created_by_name} •{' '}
                              {formatDistanceToNow(new Date(allergy.created_at), { addSuffix: true })}
                            </span>
                            {allergy.verified_by && (
                              <span>
                                Verified by {allergy.verified_by_name} •{' '}
                                {formatDistanceToNow(new Date(allergy.verified_at), { addSuffix: true })}
                              </span>
                            )}
                          </div>
                        </div>

                        {editable && (
                          <div className="flex gap-2 ml-4">
                            {!allergy.verified_by && (
                              <Button
                                onClick={() => handleVerify(allergy.id)}
                                size="sm"
                                variant="outline"
                                disabled={verifyAllergy.isPending}
                              >
                                <Shield className="h-4 w-4 mr-1" />
                                Verify
                              </Button>
                            )}
                            <Button
                              onClick={() => handleDeactivate(allergy.id)}
                              size="sm"
                              variant="outline"
                              disabled={deactivateAllergy.isPending}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Deactivate
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isAddingAllergy} onOpenChange={setIsAddingAllergy}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Allergy</DialogTitle>
            <DialogDescription>
              Record a new allergy or intolerance for this patient.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="allergen_name">
                Allergen Name <span className="text-red-600">*</span>
              </Label>
              <Input
                id="allergen_name"
                value={newAllergy.allergen_name}
                onChange={(e) =>
                  setNewAllergy({ ...newAllergy, allergen_name: e.target.value })
                }
                placeholder="e.g., Penicillin, Peanuts, Latex"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="allergy_type">Type</Label>
                <Select
                  value={newAllergy.allergy_type}
                  onValueChange={(value) =>
                    setNewAllergy({ ...newAllergy, allergy_type: value })
                  }
                >
                  <SelectTrigger id="allergy_type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALLERGY_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="severity">Severity</Label>
                <Select
                  value={newAllergy.severity}
                  onValueChange={(value) =>
                    setNewAllergy({ ...newAllergy, severity: value })
                  }
                >
                  <SelectTrigger id="severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITY_LEVELS.map((level) => (
                      <SelectItem key={level.value} value={level.value}>
                        {level.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="reaction_description">Reaction Description</Label>
              <Textarea
                id="reaction_description"
                value={newAllergy.reaction_description}
                onChange={(e) =>
                  setNewAllergy({ ...newAllergy, reaction_description: e.target.value })
                }
                placeholder="Describe the reaction (e.g., rash, anaphylaxis, nausea)"
                rows={3}
              />
            </div>

            <div>
              <Label htmlFor="notes">Additional Notes</Label>
              <Textarea
                id="notes"
                value={newAllergy.notes}
                onChange={(e) => setNewAllergy({ ...newAllergy, notes: e.target.value })}
                placeholder="Any additional information"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddingAllergy(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddAllergy} disabled={createAllergy.isPending}>
              {createAllergy.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Allergy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
