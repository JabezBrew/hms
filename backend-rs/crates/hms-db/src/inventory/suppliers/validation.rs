use super::*;
use sha2::{Digest, Sha256};

pub(super) fn hash(bytes: impl AsRef<[u8]>) -> Vec<u8> {
    Sha256::digest(bytes).to_vec()
}
pub(super) fn digest(input: &InventorySupplierReviewedInput) -> anyhow::Result<Vec<u8>> {
    Ok(hash(serde_json::to_vec(&serde_json::to_value(input)?)?))
}
pub(super) fn facts(
    input: &InventorySupplierReviewedInput,
) -> (Uuid, Option<Uuid>, Option<i64>, &'static str) {
    match input {
        InventorySupplierReviewedInput::Create {
            client_request_id, ..
        } => (*client_request_id, None, None, "create"),
        InventorySupplierReviewedInput::Correct {
            client_request_id,
            supplier_id,
            expected_version,
            ..
        } => (
            *client_request_id,
            Some(*supplier_id),
            Some(*expected_version),
            "correct",
        ),
        InventorySupplierReviewedInput::Retire {
            client_request_id,
            supplier_id,
            expected_version,
        } => (
            *client_request_id,
            Some(*supplier_id),
            Some(*expected_version),
            "retire",
        ),
        InventorySupplierReviewedInput::Reactivate {
            client_request_id,
            supplier_id,
            expected_version,
        } => (
            *client_request_id,
            Some(*supplier_id),
            Some(*expected_version),
            "reactivate",
        ),
    }
}
pub(super) fn validate_identity(
    input: &InventorySupplierReviewedInput,
) -> Result<(), InventorySupplierError> {
    let (key, id, version, _) = facts(input);
    if key.is_nil()
        || id.is_some_and(|value| value.is_nil())
        || version.is_some_and(|value| value < 1)
    {
        Err(InventorySupplierError::Invalid)
    } else {
        Ok(())
    }
}
fn text(value: String, chars: usize, bytes: usize) -> Result<String, InventorySupplierError> {
    let value = value.trim().to_owned();
    if value.is_empty()
        || value.len() > bytes
        || value.chars().count() > chars
        || value.chars().any(char::is_control)
    {
        Err(InventorySupplierError::Invalid)
    } else {
        Ok(value)
    }
}
fn nullable(
    value: Option<String>,
    old: Option<&Option<String>>,
    chars: usize,
    bytes: usize,
    multiline: bool,
) -> Result<Option<String>, InventorySupplierError> {
    if old.is_some_and(|old| old == &value) {
        return Ok(value);
    }
    if value.as_ref().is_some_and(|value| {
        value.len() > bytes
            || value.chars().count() > chars
            || value
                .chars()
                .any(|c| c.is_control() && !(multiline && matches!(c, '\t' | '\r' | '\n')))
    }) {
        Err(InventorySupplierError::Invalid)
    } else {
        Ok(value)
    }
}
/// Bounded pure syntax, with no DNS/delivery claim or stored-text rewriting.
/// ASCII dot-atom/quoted local parts are supported; SMTPUTF8 local parts are not.
fn email_syntax(value: &str) -> bool {
    if value.is_empty() {
        return true;
    }
    let Some((local, domain)) = value.rsplit_once('@') else {
        return false;
    };
    if local.is_empty() || local.len() > 64 || !local.is_ascii() || domain.is_empty() {
        return false;
    }
    let local_ok = if local.starts_with('"') && local.ends_with('"') && local.len() >= 2 {
        let mut escaped = false;
        let mut valid = true;
        for byte in local[1..local.len() - 1].bytes() {
            if !(32..=126).contains(&byte) {
                valid = false;
                break;
            }
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                valid = false;
                break;
            }
        }
        valid && !escaped
    } else {
        !local.starts_with('.')
            && !local.ends_with('.')
            && !local.contains("..")
            && local
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b".!#$%&'*+-/=?^_`{|}~".contains(&byte))
    };
    if !local_ok {
        return false;
    }
    if let Some(literal) = domain
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
    {
        return literal
            .strip_prefix("IPv6:")
            .unwrap_or(literal)
            .parse::<std::net::IpAddr>()
            .is_ok();
    }
    if domain == "localhost" {
        return true;
    }
    let Ok(ascii) = idna::domain_to_ascii_strict(domain) else {
        return false;
    };
    let mut labels = ascii.split('.');
    let Some(first) = labels.next() else {
        return false;
    };
    let remaining: Vec<_> = labels.collect();
    if remaining.is_empty() || remaining.last().is_none_or(|label| label.len() < 2) {
        return false;
    }
    std::iter::once(first).chain(remaining).all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && label
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphanumeric)
            && label
                .as_bytes()
                .last()
                .is_some_and(u8::is_ascii_alphanumeric)
            && label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    })
}
fn email(
    value: Option<String>,
    old: Option<&Option<String>>,
) -> Result<Option<String>, InventorySupplierError> {
    if old.is_some_and(|old| old == &value) {
        return Ok(value);
    }
    let value = nullable(value, None, 254, 1016, false)?;
    if value.as_ref().is_some_and(|value| !email_syntax(value)) {
        Err(InventorySupplierError::Invalid)
    } else {
        Ok(value)
    }
}
pub(super) fn normalize(
    input: InventorySupplierReviewedInput,
    before: Option<&GovernedInventorySupplier>,
) -> Result<InventorySupplierReviewedInput, InventorySupplierError> {
    Ok(match input {
        InventorySupplierReviewedInput::Create {
            client_request_id,
            code,
            name,
            contact_name,
            phone,
            email: value,
            address,
        } => InventorySupplierReviewedInput::Create {
            client_request_id,
            code: text(code, 120, 480)?,
            name: text(name, 100, 400)?,
            contact_name: nullable(contact_name, None, 100, 400, false)?,
            phone: nullable(phone, None, 20, 80, false)?,
            email: email(value, None)?,
            address: nullable(address, None, 8000, 8000, true)?,
        },
        InventorySupplierReviewedInput::Correct {
            client_request_id,
            supplier_id,
            expected_version,
            name,
            contact_name,
            phone,
            email: value,
            address,
            reason,
        } => {
            let before = before.ok_or(InventorySupplierError::InvalidSource)?;
            InventorySupplierReviewedInput::Correct {
                client_request_id,
                supplier_id,
                expected_version,
                name: if name == before.name {
                    name
                } else {
                    text(name, 100, 400)?
                },
                contact_name: nullable(contact_name, Some(&before.contact_name), 100, 400, false)?,
                phone: nullable(phone, Some(&before.phone), 20, 80, false)?,
                email: email(value, Some(&before.email))?,
                address: nullable(address, Some(&before.address), 8000, 8000, true)?,
                reason: text(reason, 1000, 4000)?,
            }
        }
        other => other,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn supplier_email_syntax_and_exact_nullable_legacy_values() {
        for valid in [
            "",
            "a@example.com",
            "first.last+stock@example.com",
            "\"a b@c\"@example.com",
            "a@bücher.example",
            "a@localhost",
            "a@[127.0.0.1]",
            "a@[::1]",
            "a@[IPv6:::1]",
        ] {
            assert!(email_syntax(valid), "supported syntax class");
        }
        for invalid in [
            "a",
            "a@",
            "@example.com",
            ".a@example.com",
            "a..b@example.com",
            "a.@example.com",
            "a b@example.com",
            "a@-example.com",
            "a@example-.com",
            "a@example.c",
            "a@example.com ",
            "a@example.com\n",
            "é@example.com",
            "\"a\\\"@example.com",
        ] {
            assert!(!email_syntax(invalid), "unsupported syntax class");
        }
        let malformed = Some(" retained malformed\naddress ".to_owned());
        assert!(
            email(malformed.clone(), Some(&malformed)).unwrap() == malformed,
            "unchanged legacy email stays exact"
        );
        assert!(email(malformed, None).is_err());
        assert_eq!(email(None, None).unwrap(), None);
        assert_eq!(
            email(Some(String::new()), None).unwrap(),
            Some(String::new())
        );
        assert_eq!(
            nullable(Some("\n\t".to_owned()), None, 8000, 8000, true).unwrap(),
            Some("\n\t".to_owned())
        );
    }
}
