//! Bounded literal template substitution. No persistence, execution, or base-body rewrite.
use super::note_records::key;
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashSet};

const MAX_CHARS: usize = 20_000;
const MAX_SECTIONS: usize = 100;
const MAX_DEPTH: usize = 10;
const MAX_FIELDS: usize = 200;
const MAX_DIAGNOSTICS: usize = 32;
const MAX_TOKEN_NAME: usize = 64;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RenderMode {
    All,
    EmptyOnly,
    Selected,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RenderKind {
    Plain,
    Structured,
}

/// These values must come from the current protected patient projection, never
/// a caller-supplied dictionary. Age and today are derived from one UTC instant.
#[derive(Clone, Copy)]
pub struct PatientTokens<'a> {
    pub first_name: &'a str,
    pub last_name: &'a str,
    pub date_of_birth: Option<NaiveDate>,
    pub sex: &'a str,
    pub mrn: &'a str,
}
pub struct RenderInput<'a> {
    pub source: &'a str,
    pub base_body: &'a str,
    pub mode: RenderMode,
    pub sections: &'a [String],
    pub patient: PatientTokens<'a>,
    /// The only token supplied explicitly by the clinician; never inferred.
    pub chief_complaint: Option<&'a str>,
    pub now: DateTime<Utc>,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnresolvedToken {
    pub name: String,
    pub count: u32,
}
#[derive(Clone, Debug, PartialEq)]
pub struct RenderedPatch {
    pub kind: RenderKind,
    /// Only generated section values, or a plain string. Never a merged body.
    pub patch: Value,
    /// Source order; object key order in the patch is not significant.
    pub applied_sections: Vec<String>,
    pub unresolved: Vec<UnresolvedToken>,
    pub unresolved_truncated: bool,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RenderError {
    InvalidInput,
    UnsupportedSchema,
    LimitExceeded,
}
impl std::fmt::Display for RenderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidInput => "invalid_template_render_input",
            Self::UnsupportedSchema => "unsupported_template_render_schema",
            Self::LimitExceeded => "template_render_limit_exceeded",
        })
    }
}
impl std::error::Error for RenderError {}
type Result<T> = std::result::Result<T, RenderError>;

#[derive(Default)]
struct Budget {
    chars: usize,
    fields: usize,
}
impl Budget {
    fn add(&mut self, count: usize) -> Result<()> {
        self.chars = self
            .chars
            .checked_add(count)
            .ok_or(RenderError::LimitExceeded)?;
        if self.chars > MAX_CHARS {
            return Err(RenderError::LimitExceeded);
        }
        Ok(())
    }
    fn field(&mut self) -> Result<()> {
        self.fields += 1;
        if self.fields > MAX_FIELDS {
            return Err(RenderError::LimitExceeded);
        }
        Ok(())
    }
    fn property(&mut self, name: &str, first: bool) -> Result<()> {
        self.add(json_string_cost(name) + 1 + usize::from(!first))
    }
}
fn char_cost(value: char) -> usize {
    match value {
        '"' | '\\' | '\n' | '\r' | '\t' | '\u{0008}' | '\u{000c}' => 2,
        c if c < '\u{0020}' => 6,
        _ => 1,
    }
}
fn json_string_cost(value: &str) -> usize {
    2 + value.chars().map(char_cost).sum::<usize>()
}
fn bounded(value: &str, limit: usize) -> Result<()> {
    if value.chars().take(limit + 1).count() > limit {
        return Err(RenderError::LimitExceeded);
    }
    Ok(())
}
fn depth(value: &Value, at: usize) -> Result<()> {
    if at > MAX_DEPTH {
        return Err(RenderError::LimitExceeded);
    }
    match value {
        Value::Array(items) => {
            for item in items {
                depth(item, at + 1)?;
            }
        }
        Value::Object(items) => {
            for item in items.values() {
                depth(item, at + 1)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn meaningful(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(text) => !text.trim().is_empty(),
        Value::Array(items) => !items.is_empty(),
        Value::Object(items) => !items.is_empty(),
        Value::Bool(_) | Value::Number(_) => true,
    }
}
fn unsafe_key(value: &str) -> bool {
    matches!(value, "__proto__" | "constructor" | "prototype")
}
fn selected(input: &RenderInput<'_>, available: &HashSet<String>) -> Result<HashSet<String>> {
    if input.sections.len() > MAX_SECTIONS {
        return Err(RenderError::LimitExceeded);
    }
    if (input.mode == RenderMode::Selected) == input.sections.is_empty() {
        return Err(RenderError::InvalidInput);
    }
    let mut result = HashSet::new();
    for value in input.sections {
        bounded(value, MAX_CHARS)?;
        if value.is_empty()
            || key(value) != *value
            || unsafe_key(value)
            || !available.contains(value)
            || !result.insert(value.clone())
        {
            return Err(RenderError::InvalidInput);
        }
    }
    Ok(result)
}

#[derive(Default)]
struct Diagnostics {
    names: BTreeMap<String, u32>,
    truncated: bool,
}
impl Diagnostics {
    fn record(&mut self, name: &str) {
        if let Some(count) = self.names.get_mut(name) {
            *count = count.saturating_add(1);
        } else if self.names.len() < MAX_DIAGNOSTICS {
            self.names.insert(name.to_owned(), 1);
        } else {
            self.truncated = true;
        }
    }
    fn finish(self) -> (Vec<UnresolvedToken>, bool) {
        (
            self.names
                .into_iter()
                .map(|(name, count)| UnresolvedToken { name, count })
                .collect(),
            self.truncated,
        )
    }
}
struct Tokens<'a> {
    patient: PatientTokens<'a>,
    chief: Option<&'a str>,
    today: String,
    age: Option<String>,
}
impl<'a> Tokens<'a> {
    fn new(input: &RenderInput<'a>) -> Self {
        let today = input.now.date_naive();
        let age = input
            .patient
            .date_of_birth
            .filter(|birth| *birth <= today)
            .map(|birth| {
                // Like the legacy completed-years rule, a leap-day birthday in a
                // non-leap year is reached on March 1, never February 28.
                let years = today.year()
                    - birth.year()
                    - i32::from((today.month(), today.day()) < (birth.month(), birth.day()));
                years.to_string()
            });
        Self {
            patient: input.patient,
            chief: input.chief_complaint,
            today: today.format("%Y-%m-%d").to_string(),
            age,
        }
    }
    fn append(&self, name: &str, output: &mut String, budget: &mut Budget) -> Result<bool> {
        let value = match name {
            "patient_name" => {
                let first = self.patient.first_name.trim();
                let last = self.patient.last_name.trim();
                if first.is_empty() && last.is_empty() {
                    append(output, "Patient", budget)?;
                } else {
                    append(output, first, budget)?;
                    if !first.is_empty() && !last.is_empty() {
                        append(output, " ", budget)?;
                    }
                    append(output, last, budget)?;
                }
                return Ok(true);
            }
            "patient_first_name" => Some(self.patient.first_name.trim()),
            "patient_last_name" => Some(self.patient.last_name.trim()),
            "age" => self.age.as_deref(),
            "sex" => Some(self.patient.sex),
            "mrn" => Some(self.patient.mrn),
            "today" => Some(self.today.as_str()),
            "chief_complaint" => self.chief,
            _ => None,
        };
        if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
            append(output, value, budget)?;
            return Ok(true);
        }
        Ok(false)
    }
}
fn append(output: &mut String, text: &str, budget: &mut Budget) -> Result<()> {
    for character in text.chars() {
        budget.add(char_cost(character))?;
        output.push(character);
    }
    Ok(())
}
fn render_text(
    text: &str,
    tokens: &Tokens<'_>,
    budget: &mut Budget,
    diagnostics: &mut Diagnostics,
) -> Result<Value> {
    budget.field()?;
    budget.add(2)?;
    let mut output = String::with_capacity(text.len().min(256));
    let mut remaining = text.trim();
    while let Some(start) = remaining.find("{{") {
        append(&mut output, &remaining[..start], budget)?;
        let rest = &remaining[start + 2..];
        let Some(end) = rest.find("}}") else {
            diagnostics.record("unsupported_placeholder");
            append(&mut output, &remaining[start..], budget)?;
            remaining = "";
            break;
        };
        let original = &remaining[start..start + 2 + end + 2];
        let name = rest[..end].trim();
        if name.is_empty()
            || name.len() > MAX_TOKEN_NAME
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        {
            diagnostics.record("unsupported_placeholder");
            if name.len() > MAX_TOKEN_NAME {
                diagnostics.truncated = true;
            }
            append(&mut output, original, budget)?;
        } else {
            let name = name.to_ascii_lowercase();
            if !tokens.append(&name, &mut output, budget)? {
                diagnostics.record(&name);
                append(&mut output, original, budget)?;
            }
        }
        remaining = &rest[end + 2..];
    }
    append(&mut output, remaining, budget)?;
    // Match the legacy leaf trim after substitution, including whitespace
    // introduced by an explicit complaint, without rescanning any tokens.
    if output.trim().len() != output.len() {
        output = output.trim().to_owned();
    }
    Ok(Value::String(output))
}

struct Subsection<'a> {
    name: String,
    starter: Option<&'a str>,
}
struct Section<'a> {
    name: String,
    kind: String,
    starter: Option<&'a str>,
    children: Vec<Subsection<'a>>,
}
fn starter(value: &Value) -> Option<&str> {
    value
        .get("default_text")
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .or_else(|| {
            value
                .get("defaultText")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
        })
}
fn sections(value: &Value) -> Result<Vec<Section<'_>>> {
    let items = value
        .as_array()
        .or_else(|| value.get("sections").and_then(Value::as_array))
        .ok_or(RenderError::UnsupportedSchema)?;
    if items.is_empty() {
        return Err(RenderError::UnsupportedSchema);
    }
    if items.len() > MAX_SECTIONS {
        return Err(RenderError::LimitExceeded);
    }
    let mut names = HashSet::new();
    let mut result = Vec::with_capacity(items.len());
    for item in items {
        if !item.is_object()
            || item
                .get("required")
                .is_some_and(|value| !value.is_boolean())
        {
            return Err(RenderError::UnsupportedSchema);
        }
        let label = item
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| !name.trim().is_empty())
            .or_else(|| item.get("section").and_then(Value::as_str))
            .ok_or(RenderError::UnsupportedSchema)?
            .trim();
        let name = key(label);
        if name.is_empty()
            || unsafe_key(&label.to_lowercase())
            || unsafe_key(&name)
            || !names.insert(name.clone())
        {
            return Err(RenderError::UnsupportedSchema);
        }
        let kind = match item.get("type") {
            None | Some(Value::Null) => "text".to_owned(),
            Some(Value::String(value)) => value.to_lowercase(),
            _ => return Err(RenderError::UnsupportedSchema),
        };
        let mut children = Vec::new();
        if kind == "structured" {
            if let Some(raw) = item.get("subsections") {
                let raw = raw.as_array().ok_or(RenderError::UnsupportedSchema)?;
                let mut child_names = HashSet::new();
                for child in raw {
                    let label = child
                        .get("name")
                        .and_then(Value::as_str)
                        .ok_or(RenderError::UnsupportedSchema)?
                        .trim();
                    let child_name = label.to_lowercase().replace(' ', "_");
                    if child_name.is_empty()
                        || unsafe_key(&child_name)
                        || !child_names.insert(child_name.clone())
                        || child
                            .get("required")
                            .is_some_and(|value| !value.is_boolean())
                    {
                        return Err(RenderError::UnsupportedSchema);
                    }
                    children.push(Subsection {
                        name: child_name,
                        starter: starter(child),
                    });
                }
            }
        }
        result.push(Section {
            name,
            kind,
            starter: starter(item),
            children,
        });
    }
    Ok(result)
}
impl Section<'_> {
    fn has_starter(&self) -> bool {
        self.starter.is_some() || self.children.iter().any(|child| child.starter.is_some())
    }
    fn render(
        &self,
        tokens: &Tokens<'_>,
        budget: &mut Budget,
        diagnostics: &mut Diagnostics,
    ) -> Result<Value> {
        if self.children.iter().any(|child| child.starter.is_some()) {
            let mut patch = Map::new();
            budget.add(2)?;
            for child in self.children.iter().filter(|child| child.starter.is_some()) {
                budget.property(&child.name, patch.is_empty())?;
                patch.insert(
                    child.name.clone(),
                    render_text(
                        child.starter.unwrap_or_default(),
                        tokens,
                        budget,
                        diagnostics,
                    )?,
                );
            }
            return Ok(Value::Object(patch));
        }
        let text = self.starter.unwrap_or_default();
        if matches!(
            self.kind.as_str(),
            "condition" | "observation" | "medication_administration"
        ) {
            budget.add(2)?;
            budget.property("notes", true)?;
            let value = render_text(text, tokens, budget, diagnostics)?;
            return Ok(Value::Object(Map::from_iter([("notes".to_owned(), value)])));
        }
        render_text(text, tokens, budget, diagnostics)
    }
}

/// Generates a shallow patch only. Callers must retain the original draft and
/// require clinician review before applying/saving; this function has no I/O.
pub fn render(input: RenderInput<'_>) -> Result<RenderedPatch> {
    bounded(input.source, MAX_CHARS)?;
    bounded(input.base_body, MAX_CHARS)?;
    for value in [
        input.patient.first_name,
        input.patient.last_name,
        input.patient.sex,
        input.patient.mrn,
    ] {
        bounded(value, MAX_CHARS)?;
    }
    if let Some(value) = input.chief_complaint {
        bounded(value, 500)?;
    }
    if input.source.trim().is_empty() {
        return Err(RenderError::InvalidInput);
    }
    let parsed = serde_json::from_str::<Value>(input.source);
    // Match the established template schema: invalid JSON is literal text.
    // Only parsed arrays or objects carrying sections are structured schemas.
    let structured = match &parsed {
        Ok(value) => {
            depth(value, 0)?;
            value.is_array()
                || value
                    .as_object()
                    .is_some_and(|object| object.contains_key("sections"))
        }
        // IgnoredAny validates with serde_json's iterative skip path, without
        // building a recursively nested Value. A valid JSON container that
        // cannot become a Value crossed a parser depth/range resource bound;
        // it must never be reinterpreted as a literal serialized template.
        // Genuine invalid JSON and scalar literal text keep plain semantics.
        Err(_)
            if matches!(
                input.source.trim_start().as_bytes().first(),
                Some(b'[' | b'{')
            ) && serde_json::from_str::<serde::de::IgnoredAny>(input.source).is_ok() =>
        {
            return Err(RenderError::LimitExceeded);
        }
        Err(_) => false,
    };
    let tokens = Tokens::new(&input);
    let mut diagnostics = Diagnostics::default();
    let mut budget = Budget::default();
    let (kind, patch, applied_sections) = if structured {
        let parsed = parsed
            .as_ref()
            .map_err(|_| RenderError::UnsupportedSchema)?;
        let sections = sections(parsed)?;
        let available = sections
            .iter()
            .map(|section| section.name.clone())
            .collect::<HashSet<_>>();
        let selected = selected(&input, &available)?;
        let base = if input.base_body.trim().is_empty() {
            Value::Object(Map::new())
        } else {
            serde_json::from_str::<Value>(input.base_body).map_err(|_| RenderError::InvalidInput)?
        };
        depth(&base, 0)?;
        let base = base.as_object().ok_or(RenderError::InvalidInput)?;
        // Existing root values must use the same canonical keys as note writes.
        // Otherwise a false/zero value under an alias could be overwritten.
        for name in base.keys().filter(|name| !name.starts_with('_')) {
            let canonical = key(name);
            if available.contains(&canonical) && *name != canonical {
                return Err(RenderError::InvalidInput);
            }
        }
        let mut patch = Map::new();
        let mut applied = Vec::new();
        budget.add(2)?;
        for section in sections {
            if !section.has_starter()
                || (input.mode == RenderMode::Selected && !selected.contains(&section.name))
                || (input.mode == RenderMode::EmptyOnly
                    && base.get(&section.name).is_some_and(meaningful))
            {
                continue;
            }
            budget.property(&section.name, patch.is_empty())?;
            let value = section.render(&tokens, &mut budget, &mut diagnostics)?;
            applied.push(section.name.clone());
            patch.insert(section.name, value);
        }
        (RenderKind::Structured, Value::Object(patch), applied)
    } else {
        let available = HashSet::from(["text".to_owned()]);
        selected(&input, &available)?;
        if input.mode == RenderMode::EmptyOnly && !input.base_body.trim().is_empty() {
            (RenderKind::Plain, Value::String(String::new()), Vec::new())
        } else {
            (
                RenderKind::Plain,
                render_text(input.source, &tokens, &mut budget, &mut diagnostics)?,
                vec!["text".to_owned()],
            )
        }
    };
    let (unresolved, unresolved_truncated) = diagnostics.finish();
    Ok(RenderedPatch {
        kind,
        patch,
        applied_sections,
        unresolved,
        unresolved_truncated,
    })
}
