use std::env;
use std::fs;
use std::path::Path;

use hms_api::openapi::openapi_json;

fn main() -> anyhow::Result<()> {
    let json = openapi_json()?;

    if let Some(path) = env::args().nth(1) {
        let path = Path::new(&path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, json)?;
    } else {
        println!("{json}");
    }

    Ok(())
}
