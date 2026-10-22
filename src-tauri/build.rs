const REQUIRED_HTTPS: &[&str] = &["GCP_FUNCTIONS_URL"];
const REQUIRED_VARS: &[&str] = &["FIREBASE_API_KEY"];
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

    let target = std::env::var("TARGET").unwrap_or_default();
    let mut attrs = tauri_build::Attributes::new();

    if target.contains("windows") {
        let windows = tauri_build::WindowsAttributes::new()
            .app_manifest(include_str!("orch.exe.manifest"));
        attrs = attrs.windows_attributes(windows);
        println!("cargo:rerun-if-changed=orch.exe.manifest");
    }

    tauri_build::try_build(attrs).expect("failed to run tauri build");
}

fn load_dotenv_for_compile() {
    if dotenvy::from_path("../.env").is_err() {
        let _ = dotenvy::dotenv();
    }

    let is_release = std::env::var("PROFILE").map(|p| p == "release").unwrap_or(false);

    for key in REQUIRED_HTTPS {
        let mut value = std::env::var(key).unwrap_or_default();
        if value.is_empty() {
            if is_release {
                panic!("{key} is not set: define it in .env or the build environment before compiling release");
            } else {
                println!("cargo:warning={key} not set; using development fallback URL");
                value = "https://functions.orch.live".into();
            }
        } else if !value.starts_with("https://") {
            panic!("{key} must be an https:// URL, got: {value}");
        }
        println!("cargo:rustc-env={key}={value}");
        println!("cargo:rerun-if-env-changed={key}");
    }

    for key in REQUIRED_VARS {
        let mut value = std::env::var(key).unwrap_or_default();
        if value.is_empty() {
            if is_release {
                panic!("{key} is not set: define it in .env or the build environment before compiling release");
            } else {
                println!("cargo:warning={key} not set; using development fallback key");
                value = "orch-dev-key".into();
            }
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
