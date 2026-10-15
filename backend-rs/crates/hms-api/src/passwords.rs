use anyhow::Result;
use argon2::{Argon2, PasswordHasher};
use password_hash::SaltString;
use rand_core::OsRng;

static DUMMY_PASSWORD_HASH: std::sync::OnceLock<Result<String, String>> =
    std::sync::OnceLock::new();

pub(crate) fn dummy_password_hash() -> Result<String> {
    DUMMY_PASSWORD_HASH
        .get_or_init(|| {
            hash_password(&hms_db::provision::generate_secret_token())
                .map_err(|_| "dummy password hash could not be initialized".to_owned())
        })
        .as_ref()
        .cloned()
        .map_err(|message| anyhow::anyhow!(message.clone()))
}

pub(crate) fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|error| anyhow::anyhow!("failed to hash password: {error}"))?
        .to_string())
}
