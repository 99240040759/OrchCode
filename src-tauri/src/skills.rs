use std::collections::HashSet;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub file_path: String,
}

const BUNDLED_SKILLS: &[(&str, &str)] = &[
    (
        "api-and-interface-design",
        include_str!("../../.agents/skills/api-and-interface-design/SKILL.md"),
    ),
    (
        "browser-testing-with-devtools",
        include_str!("../../.agents/skills/browser-testing-with-devtools/SKILL.md"),
    ),
    (
        "ci-cd-and-automation",
        include_str!("../../.agents/skills/ci-cd-and-automation/SKILL.md"),
    ),
    (
        "code-review-and-quality",
        include_str!("../../.agents/skills/code-review-and-quality/SKILL.md"),
    ),
    (
        "code-simplification",
        include_str!("../../.agents/skills/code-simplification/SKILL.md"),
    ),
    (
        "context-engineering",
        include_str!("../../.agents/skills/context-engineering/SKILL.md"),
    ),
    (
        "debugging-and-error-recovery",
        include_str!("../../.agents/skills/debugging-and-error-recovery/SKILL.md"),
    ),
    (
        "deprecation-and-migration",
        include_str!("../../.agents/skills/deprecation-and-migration/SKILL.md"),
    ),
    (
        "documentation-and-adrs",
        include_str!("../../.agents/skills/documentation-and-adrs/SKILL.md"),
    ),
    (
        "doubt-driven-development",
        include_str!("../../.agents/skills/doubt-driven-development/SKILL.md"),
    ),
    (
        "frontend-ui-engineering",
        include_str!("../../.agents/skills/frontend-ui-engineering/SKILL.md"),
    ),
    (
        "git-workflow-and-versioning",
        include_str!("../../.agents/skills/git-workflow-and-versioning/SKILL.md"),
    ),
    (
        "idea-refine",
        include_str!("../../.agents/skills/idea-refine/SKILL.md"),
    ),
    (
        "incremental-implementation",
        include_str!("../../.agents/skills/incremental-implementation/SKILL.md"),
    ),
    (
        "interview-me",
        include_str!("../../.agents/skills/interview-me/SKILL.md"),
    ),
    (
        "observability-and-instrumentation",
        include_str!("../../.agents/skills/observability-and-instrumentation/SKILL.md"),
    ),
    (
        "performance-optimization",
        include_str!("../../.agents/skills/performance-optimization/SKILL.md"),
    ),
    (
        "planning-and-task-breakdown",
        include_str!("../../.agents/skills/planning-and-task-breakdown/SKILL.md"),
    ),
    (
        "security-and-hardening",
        include_str!("../../.agents/skills/security-and-hardening/SKILL.md"),
    ),
    (
        "shipping-and-launch",
        include_str!("../../.agents/skills/shipping-and-launch/SKILL.md"),
    ),
    (
        "source-driven-development",
        include_str!("../../.agents/skills/source-driven-development/SKILL.md"),
    ),
    (
        "spec-driven-development",
        include_str!("../../.agents/skills/spec-driven-development/SKILL.md"),
    ),
    (
        "test-driven-development",
        include_str!("../../.agents/skills/test-driven-development/SKILL.md"),
    ),
    (
        "using-agent-skills",
        include_str!("../../.agents/skills/using-agent-skills/SKILL.md"),
    ),
];

const BUNDLED_VERSION: &str = "v4";

pub fn seed_bundled_skills(data_dir: &Path) {
    let global_skills_dir = data_dir.join("skills");
    for (name, content) in BUNDLED_SKILLS {
        let skill_dir = global_skills_dir.join(name);
        let skill_file = skill_dir.join("SKILL.md");
        let version_file = skill_dir.join(".version");

        let up_to_date = skill_file.exists()
            && std::fs::read_to_string(&version_file).ok().as_deref() == Some(BUNDLED_VERSION);
        if up_to_date {
            continue;
        }

        if std::fs::create_dir_all(&skill_dir).is_ok() {
            let _ = std::fs::write(&skill_file, content);
            let _ = std::fs::write(&version_file, BUNDLED_VERSION);
        }
    }
}

pub fn load_all_skills(data_dir: &Path, workspace: Option<&Path>) -> Vec<Skill> {
    let mut skills = Vec::new();
    let mut seen = HashSet::new();

    if let Some(ws) = workspace {
        scan_skills_directory(&ws.join(".agents").join("skills"), &mut skills, &mut seen);
    }
    scan_skills_directory(&data_dir.join("skills"), &mut skills, &mut seen);

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills
}

fn scan_skills_directory(dir: &Path, out: &mut Vec<Skill>, seen: &mut HashSet<String>) {
    if !dir.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let skill_file = if path.is_dir() {
            let candidate = path.join("SKILL.md");
            if !candidate.is_file() {
                continue;
            }
            candidate
        } else if path.extension().and_then(|s| s.to_str()) == Some("md") {
            path
        } else {
            continue;
        };

        let Ok(raw) = std::fs::read_to_string(&skill_file) else {
            continue;
        };
        let Some(skill) = parse_skill_markdown(&raw, &skill_file) else {
            continue;
        };
        if seen.insert(skill.name.clone()) {
            out.push(skill);
        }
    }
}

fn parse_skill_markdown(raw: &str, file_path: &Path) -> Option<Skill> {
    let fallback_name = file_path
        .parent()
        .and_then(|p| p.file_name())
        .map(|s| s.to_string_lossy().to_string())?;
    let normalized_path = file_path.to_string_lossy().replace('\\', "/");

    let mut name = fallback_name;
    let mut description = String::new();

    if raw.starts_with("---") {
        let parts: Vec<&str> = raw.splitn(3, "---").collect();
        if parts.len() >= 3 {
            for line in parts[1].lines() {
                if let Some(val) = line.strip_prefix("name:") {
                    let parsed = val.trim().trim_matches('"').trim_matches('\'').to_string();
                    if !parsed.is_empty() {
                        name = parsed;
                    }
                } else if let Some(val) = line.strip_prefix("description:") {
                    description = val.trim().trim_matches('"').trim_matches('\'').to_string();
                }
            }
        }
    }

    if description.is_empty() {
        return None;
    }

    Some(Skill {
        name,
        description,
        file_path: normalized_path,
    })
}
