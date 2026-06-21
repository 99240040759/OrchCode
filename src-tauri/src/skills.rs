use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill { pub name: String, pub content: String }

pub fn list() -> Result<Vec<Skill>> {
    let path = dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".gemini").join("skills");
    if !path.exists() { return Ok(vec![]); }
    let mut skills = Vec::new();
    for e in std::fs::read_dir(&path)?.flatten() {
        if !e.file_type()?.is_dir() { continue; }
        let f = e.path().join("SKILL.md");
        if !f.exists() { continue; }
        skills.push(Skill { name: e.file_name().to_string_lossy().into(), content: std::fs::read_to_string(f)? });
    }
    Ok(skills)
}

pub fn section(skills: &[Skill]) -> String {
    if skills.is_empty() { return String::new(); }
    let mut s = String::from("\n\n## Advanced Skills\n");
    for sk in skills { s.push_str(&format!("### {}\n{}\n\n", sk.name, sk.content)); }
    s
}
