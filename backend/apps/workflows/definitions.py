"""
Workflow definitions module - Template-based workflow configuration

This module provides dataclasses for defining workflow templates that can be used
to configure multi-step clinical workflows without requiring code changes.
"""
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from enum import Enum


class FieldType(str, Enum):
    """Types of fields that can be used in workflow steps"""
    TEXT = 'text'
    TEXTAREA = 'textarea'
    RICHTEXT = 'richtext'
    SELECT = 'select'
    BOOLEAN = 'boolean'
    DATE = 'date'
    DATETIME = 'datetime'
    NUMBER = 'number'
    CHECKLIST = 'checklist'
    MEDICATION_LIST = 'medication_list'
    LAB_ORDER_LIST = 'lab_order_list'
    ORDERS_LIST = 'orders_list'
    DIAGNOSIS_SEARCH = 'diagnosis_search'
    PATIENT_SEARCH = 'patient_search'
    WARD_SELECT = 'ward_select'
    BED_SELECT = 'bed_select'


@dataclass
class FieldDefinition:
    """Definition of a single form field in a workflow step"""
    name: str
    field_type: FieldType
    label: Optional[str] = None
    required: bool = False
    options: List[str] = field(default_factory=list)
    default_value: Any = None
    help_text: str = ""
    placeholder: str = ""

    def __post_init__(self):
        if self.label is None:
            # Auto-generate label from field name
            self.label = self.name.replace('_', ' ').title()


@dataclass
class ValidationRule:
    """Validation rule for workflow step data"""
    rule_type: str  # 'required', 'min_length', 'max_length', 'pattern', 'custom'
    params: Dict[str, Any] = field(default_factory=dict)
    error_message: str = ""


@dataclass
class WorkflowStepDefinition:
    """Definition of a single step in a workflow"""
    step_number: int
    name: str  # Machine-readable name: 'patient_review', 'clinical_assessment'
    title: str  # Human-readable title: 'Patient Review'
    description: str
    fields: List[FieldDefinition] = field(default_factory=list)
    validations: List[ValidationRule] = field(default_factory=list)
    is_optional: bool = False
    auto_advance: bool = False  # Auto-advance to next step on save


@dataclass
class WorkflowDefinition:
    """Complete definition of a workflow type"""
    workflow_type: str  # Matches WorkflowType enum value
    name: str  # Human-readable name
    total_steps: int
    steps: List[WorkflowStepDefinition]
    completion_artifacts: List[str] = field(default_factory=list)  # ['encounter', 'note', 'orders', 'admission_record', 'discharge_record']
    encounter_type: str = 'outpatient'  # 'inpatient', 'outpatient', 'emergency'
    description: str = ""

    def __post_init__(self):
        # Validate that total_steps matches the number of steps
        if len(self.steps) != self.total_steps:
            raise ValueError(
                f"Workflow {self.workflow_type}: total_steps ({self.total_steps}) "
                f"does not match number of steps defined ({len(self.steps)})"
            )

        # Validate step numbers are sequential
        for i, step in enumerate(self.steps, start=1):
            if step.step_number != i:
                raise ValueError(
                    f"Workflow {self.workflow_type}: step {i} has incorrect "
                    f"step_number {step.step_number}"
                )

    def get_step(self, step_number: int) -> Optional[WorkflowStepDefinition]:
        """Get step definition by step number"""
        if 1 <= step_number <= self.total_steps:
            return self.steps[step_number - 1]
        return None

    def get_step_by_name(self, name: str) -> Optional[WorkflowStepDefinition]:
        """Get step definition by name"""
        for step in self.steps:
            if step.name == name:
                return step
        return None
