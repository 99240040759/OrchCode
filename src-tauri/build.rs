const REQUIRED_HTTPS: &[&str] = &["GCP_FUNCTIONS_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"];
const OPTIONAL_VARS: &[&str] = &["SENTRY_DSN"];

fn main() {
    load_dotenv_for_compile();
    tauri_build::build();
}

fn load_dotenv_for_compile() {
    if dotenvy::from_path("../.env").is_err() {
        let _ = dotenvy::dotenv();
    }

    for key in REQUIRED_HTTPS {
        let value = std::env::var(key).unwrap_or_default();
        if value.is_empty() {
            panic!("{key} is not set: define it in .env or the build environment before compiling");
        }
        if *key != "SUPABASE_ANON_KEY" && !value.starts_with("https://") {
            panic!("{key} must be an https:// URL, got: {value}");
        }
        println!("cargo:rustc-env={key}={value}");
        println!("cargo:rerun-if-env-changed={key}");
    }

    for key in OPTIONAL_VARS {
        let value = std::env::var(key).unwrap_or_default();
        println!("cargo:rustc-env={key}={value}");
        println!("cargo:rerun-if-env-changed={key}");
    }

    println!("cargo:rerun-if-changed=../.env");
    println!("cargo:rerun-if-changed=.env");
}
