use anyhow::Result;
use argon2::{Argon2, PasswordHasher};
use password_hash::SaltString;
use rand_core::OsRng;

pub(crate) fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|error| anyhow::anyhow!("failed to hash password: {error}"))?
        .to_string())
}
