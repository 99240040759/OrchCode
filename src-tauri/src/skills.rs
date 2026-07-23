use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub file_path: String,
    pub source: String,
}

const BUNDLED_SKILLS: &[(&str, &str, &str)] = &[
    (
        "rust-production-standards",
        "Guidelines for writing idiomatic, high-performance, and safe production Rust code.",
        "---\nname: \"rust-production-standards\"\ndescription: \"Guidelines for writing idiomatic, high-performance, and safe production Rust code.\"\n---\n\n### RUST PRODUCTION STANDARDS\n- Enforce strict error handling via `Result` and `thiserror`/`anyhow`. Never use `unwrap()` or `expect()` in production paths.\n- Keep lock scopes minimal. Never hold `Mutex` or `RwLock` guards across `.await` points.\n- Leverage async tokio primitives correctly (`spawn_blocking` for CPU-heavy or sync I/O).\n- Preserve type safety, ownership semantics, and clear module organization."
    ),
    (
        "react-typescript-standards",
        "Best practices for building modern, scalable React 19 and TypeScript frontends.",
        "---\nname: \"react-typescript-standards\"\ndescription: \"Best practices for building modern, scalable React 19 and TypeScript frontends.\"\n---\n\n### REACT & TYPESCRIPT STANDARDS\n- Use functional components with explicit TypeScript prop interfaces.\n- Enforce immutable state updates (use Immer or functional Zustand updates).\n- Handle async UI states gracefully (loading, fallbacks, error boundaries).\n- Keep component code modular, cleanly separated from global store state."
    ),
    (
        "security-and-sanitization",
        "Security audit guidelines for input sanitization, path safety, and API hygiene.",
        "---\nname: \"security-and-sanitization\"\ndescription: \"Security audit guidelines for input sanitization, path safety, and API hygiene.\"\n---\n\n### SECURITY & SANITIZATION STANDARDS\n- Prevent path traversal: canonicalize and verify paths reside within workspace boundaries.\n- Sanitize command execution inputs: escape user inputs passed to shell processes.\n- Never output or log unmasked API keys, auth tokens, or private credentials."
    ),
];

const BUNDLED_VERSION: &str = "v2";

pub fn ensure_app_data_skills(data_dir: &Path) {
    let global_skills_dir = data_dir.join("skills");
    for (name, _desc, content) in BUNDLED_SKILLS {
        let skill_dir = global_skills_dir.join(name);
        let skill_file = skill_dir.join("SKILL.md");
        let version_file = skill_dir.join(".version");

        let needs_update = if skill_file.exists() {
            std::fs::read_to_string(&version_file).ok().as_deref() != Some(BUNDLED_VERSION)
        } else {
            true
        };

        if needs_update {
            if std::fs::create_dir_all(&skill_dir).is_ok() {
                let _ = std::fs::write(&skill_file, content);
                let _ = std::fs::write(&version_file, BUNDLED_VERSION);
            }
        }
    }
}

pub fn load_all_skills(data_dir: Option<&Path>, workspace: Option<&Path>) -> Vec<Skill> {
    let mut skills = Vec::new();
    let mut seen_names = std::collections::HashSet::new();

    if let Some(ws) = workspace {
        let ws_skills = ws.join(".agents").join("skills");
        scan_skills_directory(&ws_skills, "workspace", &mut skills, &mut seen_names);
    }

    if let Some(dir) = data_dir {
        ensure_app_data_skills(dir);
        let global_skills_dir = dir.join("skills");
        scan_skills_directory(&global_skills_dir, "app_data", &mut skills, &mut seen_names);
    }

    skills
}

fn scan_skills_directory(
    dir: &Path,
    source: &str,
    out: &mut Vec<Skill>,
    seen: &mut std::collections::HashSet<String>,
) {
    if !dir.is_dir() { return; }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let skill_file = path.join("SKILL.md");
            if skill_file.is_file() {
                match std::fs::read_to_string(&skill_file) {
                    Ok(raw) => {
                        if let Some(skill) = parse_skill_markdown(&raw, source, &skill_file) {
                            if !seen.contains(&skill.name) {
                                seen.insert(skill.name.clone());
                                out.push(skill);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[skills] failed to read {}: {e}", skill_file.display());
                    }
                }
            }
        } else if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("md") {
            match std::fs::read_to_string(&path) {
                Ok(raw) => {
                    if let Some(skill) = parse_skill_markdown(&raw, source, &path) {
                        if !seen.contains(&skill.name) {
                            seen.insert(skill.name.clone());
                            out.push(skill);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[skills] failed to read {}: {e}", path.display());
                }
            }
        }
    }
}

fn parse_skill_markdown(raw: &str, source: &str, file_path: &Path) -> Option<Skill> {
    let fallback_name = file_path
        .parent()
        .and_then(|p| p.file_name())
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "unnamed-skill".to_string());

    let normalized_path = file_path.to_string_lossy().replace('\\', "/");

    if raw.starts_with("---") {
        let parts: Vec<&str> = raw.splitn(3, "---").collect();
        if parts.len() >= 3 {
            let yaml = parts[1];
            let mut name = fallback_name.clone();
            let mut description = String::new();

            for line in yaml.lines() {
                if let Some(val) = line.strip_prefix("name:") {
                    name = val.trim().trim_matches('"').trim_matches('\'').to_string();
                } else if let Some(val) = line.strip_prefix("description:") {
                    description = val.trim().trim_matches('"').trim_matches('\'').to_string();
                }
            }

            if name.is_empty() { name = fallback_name; }

            return Some(Skill { name, description, file_path: normalized_path, source: source.to_string() });
        }
    }

    Some(Skill {
        name: fallback_name,
        description: String::new(),
        file_path: normalized_path,
        source: source.to_string(),
    })
}
