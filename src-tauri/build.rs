const REQUIRED_HTTPS: &[&str] = &["GCP_FUNCTIONS_URL", "SUPABASE_URL"];
const OPTIONAL_VARS: &[&str] = &["SUPABASE_ANON_KEY", "SENTRY_DSN"];

fn main() {
    load_dotenv_for_compile();
    tauri_build::build();
}

fn load_dotenv_for_compile() {
    if dotenvy::from_path("../.env").is_err() {
        let _ = dotenvy::dotenv();
    }

    for key in REQUIRED_HTTPS {
        match std::env::var(key) {
            Ok(value) if value.starts_with("https://") => {
                println!("cargo:rustc-env={key}={value}");
            }
            Ok(value) if !value.is_empty() => {
                println!("cargo:warning={key} is set but does not start with https:// — value: {value}");
                println!("cargo:rustc-env={key}={value}");
            }
            Ok(_) | Err(_) => {
                println!("cargo:warning={key} is not set; authentication and inference will fail at runtime");
                println!("cargo:rustc-env={key}=");
            }
        }
        println!("cargo:rerun-if-env-changed={key}");
    }

    for key in OPTIONAL_VARS {
        if let Ok(value) = std::env::var(key) {
            println!("cargo:rustc-env={key}={value}");
        }
        println!("cargo:rerun-if-env-changed={key}");
    }

    println!("cargo:rerun-if-changed=../.env");
    println!("cargo:rerun-if-changed=.env");
}
