use std::path::PathBuf;
use schemars::JsonSchema;
use serde::Deserialize;
use rig::tool::Tool;
use super::ToolError;
use crate::skills::load_all_skills;
use crate::state::WorkspaceHandle;

#[derive(Deserialize, JsonSchema)]
pub struct ReadSkillArgs {
    pub name: String,
}

pub struct ReadSkill {
    data_dir: Option<PathBuf>,
    workspace: WorkspaceHandle,
}

impl ReadSkill {
    pub fn new(data_dir: Option<PathBuf>, workspace: WorkspaceHandle) -> Self {
        Self { data_dir, workspace }
    }
}

impl Tool for ReadSkill {
    const NAME: &'static str = "read_skill";
    type Error = ToolError;
    type Args = ReadSkillArgs;
    type Output = String;

    fn description(&self) -> String {
        "Read the full instructions for an available skill by its name, as listed in the skills index.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(ReadSkillArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let workspace = self.workspace.read().ok().and_then(|g| g.clone());
        let skills = load_all_skills(self.data_dir.as_deref(), workspace.as_deref());
        let target = args.name.trim().to_lowercase();
        let skill = skills
            .into_iter()
            .find(|s| s.name.to_lowercase() == target)
            .ok_or_else(|| ToolError::msg(format!("no skill named '{}'", args.name)))?;
        tokio::fs::read_to_string(&skill.file_path)
            .await
            .map_err(|e| ToolError::msg(format!("cannot read skill '{}': {e}", args.name)))
    }
}
