/**
 * RosterImportsTab - CSV import functionality
 * Chronicle Design System styling
 */
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Clipboard from 'lucide-react/dist/esm/icons/clipboard.js';
import UploadCloud from 'lucide-react/dist/esm/icons/upload-cloud.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import XCircle from 'lucide-react/dist/esm/icons/x-circle.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import { toast } from 'sonner';
import {
  useDepartmentRosterImportPreview,
  useDepartmentRosterImportApply,
  useTeamRosterImportPreview,
  useTeamRosterImportApply,
} from '@/features/admin/hooks';
import { CSV_DELIMITER_HELP } from './constants';
import {
  RosterHeader,
  InlineField,
  CSVStatusSummary,
  ImportPreviewTable,
  RosterCsvGuidance,
  useCopyCsv,
} from './components';

export function RosterImportsTab() {
  const fieldId = useId();
  const previewDepartmentImport = useDepartmentRosterImportPreview();
  const applyDepartmentImport = useDepartmentRosterImportApply();
  const previewTeamImport = useTeamRosterImportPreview();
  const applyTeamImport = useTeamRosterImportApply();

  const [departmentCsv, setDepartmentCsv] = useState('');
  const [teamCsv, setTeamCsv] = useState('');
  const [departmentPreview, setDepartmentPreview] = useState(null);
  const [teamPreview, setTeamPreview] = useState(null);
  const [departmentApplyRows, setDepartmentApplyRows] = useState(true);
  const [teamApplyRows, setTeamApplyRows] = useState(true);
  const [departmentConflictStrategy, setDepartmentConflictStrategy] = useState('skip');
  const [teamConflictStrategy, setTeamConflictStrategy] = useState('skip');

  const departmentCopy = useCopyCsv(departmentCsv);
  const teamCopy = useCopyCsv(teamCsv);

  const handleDepartmentPreview = async () => {
    try {
      const result = await previewDepartmentImport.mutateAsync({ csv: departmentCsv });
      const payload = result?.data || result;
      setDepartmentPreview(payload);
      toast.success('Department roster CSV validated.');
    } catch (error) {
      toast.error(error.message || 'Failed to preview department CSV.');
    }
  };

  const handleDepartmentApply = async () => {
    if (!departmentPreview?.rows?.length) {
      toast.error('No rows to apply.');
      return;
    }
    try {
      const rows = departmentApplyRows ? departmentPreview.rows : [];
      const result = await applyDepartmentImport.mutateAsync({
        rows,
        conflict_strategy: departmentConflictStrategy,
      });
      const payload = result?.data || result;
      toast.success(`Applied ${payload?.created ?? 0} department roster rows.`);
      setDepartmentPreview(null);
    } catch (error) {
      toast.error(error.message || 'Failed to apply department roster import.');
    }
  };

  const handleTeamPreview = async () => {
    try {
      const result = await previewTeamImport.mutateAsync({ csv: teamCsv });
      const payload = result?.data || result;
      setTeamPreview(payload);
      toast.success('Team roster CSV validated.');
    } catch (error) {
      toast.error(error.message || 'Failed to preview team CSV.');
    }
  };

  const handleTeamApply = async () => {
    if (!teamPreview?.rows?.length) {
      toast.error('No rows to apply.');
      return;
    }
    try {
      const rows = teamApplyRows ? teamPreview.rows : [];
      const result = await applyTeamImport.mutateAsync({
        rows,
        conflict_strategy: teamConflictStrategy,
      });
      const payload = result?.data || result;
      toast.success(`Applied ${payload?.created ?? 0} team roster rows.`);
      setTeamPreview(null);
    } catch (error) {
      toast.error(error.message || 'Failed to apply team roster import.');
    }
  };

  const departmentRows = departmentPreview?.rows || [];
  const departmentErrors = departmentPreview?.errors || [];
  const departmentConflicts = departmentPreview?.conflicts || [];

  const teamRows = teamPreview?.rows || [];
  const teamErrors = teamPreview?.errors || [];
  const teamConflicts = teamPreview?.conflicts || [];

  return (
    <div className="space-y-8">
      <RosterHeader
        title="CSV Imports"
        subtitle="Validate and apply roster CSVs. Preview the rows before applying."
        actions={
          <Badge variant="outline" className="text-[10px] font-mono">
            {CSV_DELIMITER_HELP}
          </Badge>
        }
      />

      {/* Department Roster Import */}
      <Card className="border-border">
        <CardHeader className="border-b border-border">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="size-5 text-primary" />
            </div>
            <div>
              <CardTitle className="font-heading text-base">Department Roster Import</CardTitle>
              <CardDescription>Upload cycle pattern slots for department plans.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          <RosterCsvGuidance
            title="Department Roster CSV"
            columns={['department_code', 'plan_name', 'pattern_name', 'cycle_day', 'duty_type_code', 'team_code']}
            example={`department_code,plan_name,pattern_name,cycle_day,duty_type_code,team_code,start_time,end_time\nSURG,Weekday Coverage,Default,0,ADM,TEAM-A,08:00,16:00`}
          />
          <InlineField label="CSV Content">
            <Textarea
              value={departmentCsv}
              onChange={(e) => setDepartmentCsv(e.target.value)}
              rows={6}
              placeholder="Paste department roster CSV here"
              className="font-mono text-xs"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" onClick={departmentCopy.copy} disabled={!departmentCsv}>
                <Clipboard className="size-4 mr-2" />
                <span className="font-mono text-xs">{departmentCopy.hasCopied ? 'Copied' : 'Copy CSV'}</span>
              </Button>
              <Button onClick={handleDepartmentPreview} disabled={!departmentCsv || previewDepartmentImport.isPending}>
                <UploadCloud className="size-4 mr-2" />
                <span className="font-mono text-xs uppercase tracking-wide">
                  {previewDepartmentImport.isPending ? 'Validating...' : 'Preview'}
                </span>
              </Button>
            </div>
          </InlineField>

          {departmentPreview && (
            <div className="space-y-4">
              <CSVStatusSummary
                errorsCount={departmentErrors.length}
                conflictsCount={departmentConflicts.length}
                rowsCount={departmentRows.length}
              />
              <ImportPreviewTable
                caption="Validated Department Rows"
                rows={departmentRows.map((row) => ({
                  line: row.line,
                  plan_id: row.plan_id,
                  pattern_name: row.pattern_name || 'Default',
                  day_offset: row.day_offset,
                  duty_type_id: row.duty_type_id,
                  team_id: row.team_id,
                  start_time: row.start_time || '—',
                  end_time: row.end_time || '—',
                }))}
                columns={['line', 'plan_id', 'pattern_name', 'day_offset', 'duty_type_id', 'team_id', 'start_time', 'end_time']}
              />

              {/* Errors */}
              {departmentErrors.length > 0 && (
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4">
                  <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-heading font-medium text-sm">
                    <XCircle className="size-4" />
                    Validation Errors
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-rose-600 dark:text-rose-400 font-mono">
                    {departmentErrors.map((err, idx) => (
                      <li key={`${err.line}-${idx}`}>Line {err.line}: {err.field} - {err.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Conflicts */}
              {departmentConflicts.length > 0 && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-heading font-medium text-sm">
                    <AlertTriangle className="size-4" />
                    Conflicts Detected
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-amber-600 dark:text-amber-400 font-mono">
                    {departmentConflicts.map((c, idx) => (
                      <li key={`${c.line}-${idx}`}>Line {c.line}: {c.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <label htmlFor={`${fieldId}-department-apply-rows`} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox id={`${fieldId}-department-apply-rows`} checked={departmentApplyRows} onCheckedChange={(v) => setDepartmentApplyRows(Boolean(v))} />
                  <span className="text-sm">Apply validated rows</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono uppercase text-muted-foreground">Conflicts:</span>
                  <Select value={departmentConflictStrategy} onValueChange={setDepartmentConflictStrategy}>
                    <SelectTrigger className="w-[160px] h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[200]">
                      <SelectItem value="skip">Skip conflicts</SelectItem>
                      <SelectItem value="overwrite">Overwrite</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleDepartmentApply}
                  disabled={applyDepartmentImport.isPending || departmentErrors.length > 0 || !departmentApplyRows}
                >
                  {applyDepartmentImport.isPending ? 'Applying...' : 'Apply Import'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Team Roster Import */}
      <Card className="border-border">
        <CardHeader className="border-b border-border">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-sky-500/10 flex items-center justify-center">
              <FileText className="size-5 text-sky-600 dark:text-sky-400" />
            </div>
            <div>
              <CardTitle className="font-heading text-base">Team Roster Import</CardTitle>
              <CardDescription>Load practitioner assignments for specific dates.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          <RosterCsvGuidance
            title="Team Roster CSV"
            columns={['team_code', 'date', 'duty_type_code', 'practitioner_id']}
            example={`team_code,date,duty_type_code,practitioner_id,station_code,start_time,end_time\nTEAM-A,2026-02-01,ADM,7d9c...,STN-1,08:00,16:00`}
          />
          <InlineField label="CSV Content">
            <Textarea
              value={teamCsv}
              onChange={(e) => setTeamCsv(e.target.value)}
              rows={6}
              placeholder="Paste team roster CSV here"
              className="font-mono text-xs"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" onClick={teamCopy.copy} disabled={!teamCsv}>
                <Clipboard className="size-4 mr-2" />
                <span className="font-mono text-xs">{teamCopy.hasCopied ? 'Copied' : 'Copy CSV'}</span>
              </Button>
              <Button onClick={handleTeamPreview} disabled={!teamCsv || previewTeamImport.isPending}>
                <UploadCloud className="size-4 mr-2" />
                <span className="font-mono text-xs uppercase tracking-wide">
                  {previewTeamImport.isPending ? 'Validating...' : 'Preview'}
                </span>
              </Button>
            </div>
          </InlineField>

          {teamPreview && (
            <div className="space-y-4">
              <CSVStatusSummary
                errorsCount={teamErrors.length}
                conflictsCount={teamConflicts.length}
                rowsCount={teamRows.length}
              />
              <ImportPreviewTable
                caption="Validated Team Rows"
                rows={teamRows.map((row) => ({
                  line: row.line,
                  team_id: row.team_id,
                  date: row.date,
                  duty_type_id: row.duty_type_id,
                  practitioner_id: row.practitioner_id,
                  station_id: row.station_id || '—',
                  start_time: row.start_time || '—',
                  end_time: row.end_time || '—',
                }))}
                columns={['line', 'team_id', 'date', 'duty_type_id', 'practitioner_id', 'station_id', 'start_time', 'end_time']}
              />

              {/* Errors */}
              {teamErrors.length > 0 && (
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4">
                  <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-heading font-medium text-sm">
                    <XCircle className="size-4" />
                    Validation Errors
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-rose-600 dark:text-rose-400 font-mono">
                    {teamErrors.map((err, idx) => (
                      <li key={`${err.line}-${idx}`}>Line {err.line}: {err.field} - {err.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Conflicts */}
              {teamConflicts.length > 0 && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-heading font-medium text-sm">
                    <AlertTriangle className="size-4" />
                    Conflicts Detected
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-amber-600 dark:text-amber-400 font-mono">
                    {teamConflicts.map((c, idx) => (
                      <li key={`${c.line}-${idx}`}>Line {c.line}: {c.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <label htmlFor={`${fieldId}-team-apply-rows`} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox id={`${fieldId}-team-apply-rows`} checked={teamApplyRows} onCheckedChange={(v) => setTeamApplyRows(Boolean(v))} />
                  <span className="text-sm">Apply validated rows</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono uppercase text-muted-foreground">Conflicts:</span>
                  <Select value={teamConflictStrategy} onValueChange={setTeamConflictStrategy}>
                    <SelectTrigger className="w-[160px] h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[200]">
                      <SelectItem value="skip">Skip conflicts</SelectItem>
                      <SelectItem value="overwrite">Overwrite</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleTeamApply}
                  disabled={applyTeamImport.isPending || teamErrors.length > 0 || !teamApplyRows}
                >
                  {applyTeamImport.isPending ? 'Applying...' : 'Apply Import'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
