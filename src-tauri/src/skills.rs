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
        "api-and-interface-design",
        "Guides stable API and interface design. Use when designing APIs, module boundaries, or any public interface. Use when creating REST or GraphQL endpoints, defining type contracts between modules, or establishing boundaries between frontend and backend.",
        include_str!("../../.agents/skills/api-and-interface-design/SKILL.md"),
    ),
    (
        "browser-testing-with-devtools",
        "Tests in real browsers via Chrome DevTools MCP. Use when building or debugging anything that runs in a browser. Use when you need to inspect the DOM, capture console errors, analyze network requests, profile performance, or verify visual output with real runtime data. Requires the chrome-devtools MCP server to be configured.",
        include_str!("../../.agents/skills/browser-testing-with-devtools/SKILL.md"),
    ),
    (
        "ci-cd-and-automation",
        "Automates CI/CD pipeline setup. Use when setting up or modifying build and deployment pipelines. Use when you need to automate quality gates, configure test runners in CI, or establish deployment strategies.",
        include_str!("../../.agents/skills/ci-cd-and-automation/SKILL.md"),
    ),
    (
        "code-review-and-quality",
        "Conducts multi-axis code review. Use before merging any change. Use when reviewing code written by yourself, another agent, or a human. Use when you need to assess code quality across multiple dimensions before it enters the main branch.",
        include_str!("../../.agents/skills/code-review-and-quality/SKILL.md"),
    ),
    (
        "code-simplification",
        "Simplifies code for clarity. Use when refactoring code for clarity without changing behavior. Use when code works but is harder to read, maintain, or extend than it should be. Use when reviewing code that has accumulated unnecessary complexity.",
        include_str!("../../.agents/skills/code-simplification/SKILL.md"),
    ),
    (
        "context-engineering",
        "Optimizes agent context setup. Use when starting a new session, when agent output quality degrades, when switching between tasks, or when you need to configure rules files and context for a project.",
        include_str!("../../.agents/skills/context-engineering/SKILL.md"),
    ),
    (
        "debugging-and-error-recovery",
        "Guides systematic root-cause debugging. Use when tests fail, builds break, behavior doesn't match expectations, or you encounter any unexpected error. Use when you need a systematic approach to finding and fixing the root cause rather than guessing.",
        include_str!("../../.agents/skills/debugging-and-error-recovery/SKILL.md"),
    ),
    (
        "deprecation-and-migration",
        "Manages deprecation and migration. Use when removing old systems, APIs, or features. Use when migrating users from one implementation to another. Use when deciding whether to maintain or sunset existing code.",
        include_str!("../../.agents/skills/deprecation-and-migration/SKILL.md"),
    ),
    (
        "documentation-and-adrs",
        "Records decisions and documentation. Use when making architectural decisions, changing public APIs, shipping features, or when you need to record context that future engineers and agents will need to understand the codebase.",
        include_str!("../../.agents/skills/documentation-and-adrs/SKILL.md"),
    ),
    (
        "doubt-driven-development",
        "Subjects every non-trivial decision to a fresh-context adversarial review before it stands. Use when correctness matters more than speed, when working in unfamiliar code, when stakes are high (production, security-sensitive logic, irreversible operations), or any time a confident output would be cheaper to verify now than to debug later.",
        include_str!("../../.agents/skills/doubt-driven-development/SKILL.md"),
    ),
    (
        "frontend-ui-engineering",
        "Builds production-quality, accessible, responsive user-facing UIs. Use when building or modifying interfaces and pages, creating components, implementing layouts, meeting WCAG accessibility requirements, managing state, or when the output needs to look and feel production-quality rather than AI-generated.",
        include_str!("../../.agents/skills/frontend-ui-engineering/SKILL.md"),
    ),
    (
        "git-workflow-and-versioning",
        "Structures git workflow practices. Use when making any code change. Use when committing, branching, resolving conflicts, or when you need to organize work across multiple parallel streams. Use when cutting a release, choosing a semantic version bump, tagging, or writing a changelog.",
        include_str!("../../.agents/skills/git-workflow-and-versioning/SKILL.md"),
    ),
    (
        "idea-refine",
        "Refines raw ideas into sharp, actionable concepts through structured divergent and convergent thinking. Use when an idea is still vague, when you need to stress-test assumptions before committing to a plan, or when you want to expand options before converging on one. Triggers on \"ideate\", \"refine this idea\", or \"stress-test my plan\".",
        include_str!("../../.agents/skills/idea-refine/SKILL.md"),
    ),
    (
        "incremental-implementation",
        "Delivers changes incrementally. Use when implementing any feature or change that touches more than one file. Use when you're about to write a large amount of code at once, or when a task feels too big to land in one step.",
        include_str!("../../.agents/skills/incremental-implementation/SKILL.md"),
    ),
    (
        "interview-me",
        "Extracts what the user actually wants instead of what they think they should want. Achieves this through one-question-at-a-time interview until ~95% confidence about the underlying intent. Use when an ask is underspecified (\"build me X\" without \"for whom\" or \"why now\"), when the user explicitly invokes (\"interview me\", \"grill me\", \"are we sure?\", \"stress-test my thinking\"), or when you catch yourself silently filling in ambiguous requirements before any plan, spec, or code exists.",
        include_str!("../../.agents/skills/interview-me/SKILL.md"),
    ),
    (
        "observability-and-instrumentation",
        "Instruments code so production behavior is visible and diagnosable. Use when adding logging, metrics, tracing, or alerting. Use when shipping any feature that runs in production and you need evidence it works. Use when production issues are reported but you can't tell what happened from the available data.",
        include_str!("../../.agents/skills/observability-and-instrumentation/SKILL.md"),
    ),
    (
        "performance-optimization",
        "Optimizes application performance across frontend, backend, queries, and databases. Use when performance requirements exist, when you suspect performance regressions, when Core Web Vitals or load times need improvement, when N+1 query patterns need fixing, or when profiling reveals bottlenecks.",
        include_str!("../../.agents/skills/performance-optimization/SKILL.md"),
    ),
    (
        "planning-and-task-breakdown",
        "Breaks work into ordered tasks. Use when you have a spec or clear requirements and need to break work into implementable tasks. Use when a task feels too large to start, when you need to estimate scope, or when parallel work is possible.",
        include_str!("../../.agents/skills/planning-and-task-breakdown/SKILL.md"),
    ),
    (
        "security-and-hardening",
        "Hardens code against vulnerabilities. Use when handling user input, authentication, data storage, or external integrations. Use when building any feature that accepts untrusted data, manages user sessions, or interacts with third-party services.",
        include_str!("../../.agents/skills/security-and-hardening/SKILL.md"),
    ),
    (
        "shipping-and-launch",
        "Prepares production launches. Use when preparing to deploy to production. Use when you need a pre-launch checklist, when setting up monitoring, when planning a staged rollout, or when you need a rollback strategy.",
        include_str!("../../.agents/skills/shipping-and-launch/SKILL.md"),
    ),
    (
        "source-driven-development",
        "Grounds every implementation decision in official documentation. Use when you want authoritative, source-cited code free from outdated patterns. Use when building with any framework or library where correctness matters.",
        include_str!("../../.agents/skills/source-driven-development/SKILL.md"),
    ),
    (
        "spec-driven-development",
        "Creates specs before coding. Use when starting a new project, feature, or significant change and no specification exists yet. Use when requirements are unclear, ambiguous, or only exist as a vague idea.",
        include_str!("../../.agents/skills/spec-driven-development/SKILL.md"),
    ),
    (
        "test-driven-development",
        "Drives development with tests. Use when implementing any logic, fixing any bug, or changing any behavior. Use when you need to prove that code works, when a bug report arrives, or when you're about to modify existing functionality.",
        include_str!("../../.agents/skills/test-driven-development/SKILL.md"),
    ),
    (
        "using-agent-skills",
        "Discovers and invokes agent skills. Use when starting a session or when you need to discover which skill applies to the current task. This is the meta-skill that governs how all other skills are discovered and invoked.",
        include_str!("../../.agents/skills/using-agent-skills/SKILL.md"),
    ),
];

const BUNDLED_VERSION: &str = "v3";

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
