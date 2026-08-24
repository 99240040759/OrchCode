const REQUIRED_HTTPS: &[&str] = &["GCP_FUNCTIONS_URL"];
const REQUIRED_VARS: &[&str] = &["FIREBASE_API_KEY", "FIREBASE_AUTH_DOMAIN"];
const OPTIONAL_VARS: &[&str] = &[
    "SENTRY_DSN",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "NOTION_CLIENT_ID",
    "NOTION_CLIENT_SECRET",
    "SLACK_CLIENT_ID",
    "SLACK_CLIENT_SECRET",
    "JIRA_CLIENT_ID",
    "JIRA_CLIENT_SECRET",
];

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
        if !value.starts_with("https://") {
            panic!("{key} must be an https:// URL, got: {value}");
        }
        println!("cargo:rustc-env={key}={value}");
        println!("cargo:rerun-if-env-changed={key}");
    }

    for key in REQUIRED_VARS {
        let value = std::env::var(key).unwrap_or_default();
        if value.is_empty() {
            panic!("{key} is not set: define it in .env or the build environment before compiling");
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
