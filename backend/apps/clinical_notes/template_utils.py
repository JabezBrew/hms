import re


TOKEN_PATTERN = re.compile(r"{{\s*([a-zA-Z0-9_]+)\s*}}")

ALLOWED_TEMPLATE_TOKENS = {
    'patient_name',
    'patient_first_name',
    'patient_last_name',
    'age',
    'sex',
    'mrn',
    'today',
    'chief_complaint',
}


def get_structure_sections(structure):
    if isinstance(structure, dict):
        sections = structure.get('sections', [])
    elif isinstance(structure, list):
        sections = structure
    else:
        sections = []
    return sections if isinstance(sections, list) else []


def normalize_template_structure(structure):
    normalized_sections = []

    for section in get_structure_sections(structure):
        if not isinstance(section, dict):
            continue

        section_name = (section.get('name') or section.get('section') or '').strip()
        if not section_name:
            continue

        normalized_section = {
            'id': section.get('id') or section_name.lower().replace(' ', '_'),
            'name': section_name,
            'type': section.get('type') or 'text',
            'required': bool(section.get('required', False)),
        }

        help_text = section.get('helpText') or section.get('help_text')
        if help_text:
            normalized_section['helpText'] = str(help_text)

        placeholder = section.get('placeholder')
        if placeholder:
            normalized_section['placeholder'] = str(placeholder)

        observation_type = section.get('observationType') or section.get('observation_type')
        if observation_type:
            normalized_section['observationType'] = str(observation_type)

        default_text = section.get('default_text') or section.get('defaultText')
        if default_text:
            normalized_section['default_text'] = str(default_text)

        subsections = section.get('subsections') if isinstance(section.get('subsections'), list) else []
        if subsections:
            normalized_subsections = []
            for subsection in subsections:
                if not isinstance(subsection, dict):
                    continue
                subsection_name = (subsection.get('name') or '').strip()
                if not subsection_name:
                    continue

                normalized_subsection = {
                    'name': subsection_name,
                    'type': subsection.get('type') or 'text',
                    'required': bool(subsection.get('required', False)),
                }
                subsection_help_text = subsection.get('helpText') or subsection.get('help_text')
                if subsection_help_text:
                    normalized_subsection['helpText'] = str(subsection_help_text)

                subsection_observation = subsection.get('observationType') or subsection.get('observation_type')
                if subsection_observation:
                    normalized_subsection['observationType'] = str(subsection_observation)

                subsection_default_text = subsection.get('default_text') or subsection.get('defaultText')
                if subsection_default_text:
                    normalized_subsection['default_text'] = str(subsection_default_text)

                normalized_subsections.append(normalized_subsection)

            if normalized_subsections:
                normalized_section['subsections'] = normalized_subsections

        normalized_sections.append(normalized_section)

    return {
        'schema_version': 2,
        'sections': normalized_sections,
    }


def infer_template_mode(structure, fallback='structured'):
    sections = get_structure_sections(structure)
    if not sections:
        return fallback

    has_default_text = False
    has_structured_or_non_text = False

    for section in sections:
        if not isinstance(section, dict):
            continue
        if section.get('default_text') or section.get('defaultText'):
            has_default_text = True
        section_type = (section.get('type') or 'text').lower()
        if section_type not in {'text', 'textarea'} or section.get('subsections'):
            has_structured_or_non_text = True
        for subsection in section.get('subsections', []) or []:
            if isinstance(subsection, dict) and (subsection.get('default_text') or subsection.get('defaultText')):
                has_default_text = True

    if not has_default_text:
        return 'structured'
    return 'hybrid' if has_structured_or_non_text else 'written'


def _is_meaningful(value):
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, dict, set)):
        return len(value) > 0
    return True


def _to_key(name):
    return str(name or '').strip().lower().replace(' ', '_')


def _render_tokens(text, token_values):
    if text is None:
        return ''

    def _replace(match):
        token = match.group(1).strip().lower()
        if token not in ALLOWED_TEMPLATE_TOKENS:
            return ''
        value = token_values.get(token)
        return '' if value is None else str(value)

    return TOKEN_PATTERN.sub(_replace, str(text)).strip()


def build_template_token_values(patient=None, today=None, base_data=None):
    token_values = dict(base_data or {})
    token_values['today'] = today

    if not patient:
        return token_values

    user = getattr(patient, 'user', None)
    first_name = (getattr(user, 'first_name', '') or '').strip()
    last_name = (getattr(user, 'last_name', '') or '').strip()
    full_name = f"{first_name} {last_name}".strip()

    token_values.setdefault('patient_name', full_name or 'Patient')
    token_values.setdefault('patient_first_name', first_name)
    token_values.setdefault('patient_last_name', last_name)
    token_values.setdefault('sex', getattr(patient, 'gender', '') or '')
    token_values.setdefault('mrn', getattr(patient, 'medical_record_number', '') or '')

    age_value = None
    date_of_birth = getattr(patient, 'date_of_birth', None)
    if date_of_birth and today:
        age_value = today.year - date_of_birth.year - (
            (today.month, today.day) < (date_of_birth.month, date_of_birth.day)
        )
    token_values.setdefault('age', age_value if age_value is not None else '')
    return token_values


def render_template_defaults(content, token_values, base_data=None, apply_mode='empty_only', selected_sections=None):
    base_data = base_data if isinstance(base_data, dict) else {}
    selected_sections = set(selected_sections or [])
    rendered_data = {}
    sections = get_structure_sections(content)

    for section in sections:
        if not isinstance(section, dict):
            continue

        section_name = section.get('name') or section.get('section')
        if not section_name:
            continue

        if apply_mode == 'selected' and section_name not in selected_sections:
            continue

        existing_value = base_data.get(section_name)
        if apply_mode == 'empty_only' and _is_meaningful(existing_value):
            continue

        section_type = (section.get('type') or 'text').lower()
        section_default = section.get('default_text') or section.get('defaultText')
        subsections = section.get('subsections') if isinstance(section.get('subsections'), list) else []

        if section_type == 'structured' and subsections:
            subsection_payload = {}
            for subsection in subsections:
                if not isinstance(subsection, dict):
                    continue
                subsection_name = subsection.get('name')
                subsection_default = subsection.get('default_text') or subsection.get('defaultText')
                if not subsection_name or not subsection_default:
                    continue
                subsection_payload[_to_key(subsection_name)] = _render_tokens(subsection_default, token_values)
            if subsection_payload:
                rendered_data[section_name] = subsection_payload
            elif section_default:
                rendered_data[section_name] = _render_tokens(section_default, token_values)
            continue

        if not section_default:
            continue

        rendered_text = _render_tokens(section_default, token_values)
        if section_type in {'condition', 'observation', 'medication_administration'}:
            rendered_data[section_name] = {'notes': rendered_text}
        else:
            rendered_data[section_name] = rendered_text

    return rendered_data
