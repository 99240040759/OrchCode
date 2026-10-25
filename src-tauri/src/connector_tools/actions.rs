#[derive(Debug, Clone, Copy)]
pub enum Target {
    None,
    Key(&'static str),
    Path(&'static [&'static str]),
}

#[derive(Debug, Clone, Copy)]
pub struct ActionDef {
    pub slug: &'static str,
    pub label: &'static str,
    pub target: Target,
}

const fn action(slug: &'static str, label: &'static str, target: Target) -> ActionDef {
    ActionDef { slug, label, target }
}

pub static GITHUB: &[ActionDef] = &[
    action("GITHUB_FIND_REPOSITORIES", "Searched repositories", Target::Key("query")),
    action("GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER", "Listed repositories", Target::None),
    action("GITHUB_GET_REPOSITORY_CONTENT", "Read file", Target::Path(&["owner", "repo", "path"])),
    action("GITHUB_LIST_BRANCHES", "Listed branches", Target::Path(&["owner", "repo"])),
    action("GITHUB_SEARCH_CODE", "Searched code", Target::Key("q")),
    action("GITHUB_SEARCH_ISSUES", "Searched issues", Target::Key("q")),
    action("GITHUB_LIST_REPOSITORY_ISSUES", "Listed issues", Target::Path(&["owner", "repo"])),
    action("GITHUB_GET_ISSUE_COMMENTS", "Read issue comments", Target::Path(&["owner", "repo", "issue_number"])),
    action("GITHUB_CREATE_AN_ISSUE", "Created issue", Target::Key("title")),
    action("GITHUB_CREATE_AN_ISSUE_COMMENT", "Commented on issue", Target::Path(&["owner", "repo", "issue_number"])),
    action("GITHUB_FIND_PULL_REQUESTS", "Searched pull requests", Target::Key("query")),
    action("GITHUB_GET_A_PULL_REQUEST", "Read pull request", Target::Path(&["owner", "repo", "pull_number"])),
    action("GITHUB_LIST_PULL_REQUESTS_FILES", "Listed pull request files", Target::Path(&["owner", "repo", "pull_number"])),
    action("GITHUB_CREATE_A_PULL_REQUEST", "Opened pull request", Target::Key("title")),
    action("GITHUB_CREATE_BRANCH", "Created branch", Target::Key("branch_name")),
    action("GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS", "Wrote file", Target::Path(&["owner", "repo", "path"])),
    action("GITHUB_COMMIT_MULTIPLE_FILES", "Committed files", Target::Key("message")),
];

pub static SLACK: &[ActionDef] = &[
    action("SLACK_FIND_CHANNELS", "Searched channels", Target::Key("query")),
    action("SLACK_LIST_ALL_CHANNELS", "Listed channels", Target::None),
    action("SLACK_FETCH_CONVERSATION_HISTORY", "Read channel history", Target::Key("channel")),
    action("SLACK_SEARCH_MESSAGES", "Searched messages", Target::Key("query")),
    action("SLACK_FIND_USERS", "Searched users", Target::Key("search_query")),
    action("SLACK_SEND_MESSAGE", "Sent message", Target::Key("channel")),
    action("SLACK_UPDATES_A_SLACK_MESSAGE", "Edited message", Target::Key("channel")),
    action("SLACK_ADD_REACTION_TO_AN_ITEM", "Added reaction", Target::Key("channel")),
    action("SLACK_SCHEDULE_MESSAGE", "Scheduled message", Target::Key("channel")),
];

pub static GOOGLEDRIVE: &[ActionDef] = &[
    action("GOOGLEDRIVE_FIND_FILE", "Searched Drive", Target::Key("q")),
    action("GOOGLEDRIVE_GET_FILE_METADATA", "Read file details", Target::Key("fileId")),
    action("GOOGLEDRIVE_DOWNLOAD_FILE", "Downloaded file", Target::Key("fileId")),
    action("GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE", "Exported file", Target::Key("fileId")),
    action("GOOGLEDRIVE_READ_SPREADSHEET_VALUES", "Read spreadsheet", Target::Key("spreadsheet_id")),
    action("GOOGLEDRIVE_CREATE_FOLDER", "Created folder", Target::Key("name")),
    action("GOOGLEDRIVE_CREATE_FILE", "Created file", Target::Key("name")),
];

pub static GMAIL: &[ActionDef] = &[
    action("GMAIL_FETCH_EMAILS", "Searched emails", Target::Key("query")),
    action("GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", "Read email", Target::Key("message_id")),
    action("GMAIL_GET_ATTACHMENT", "Fetched attachment", Target::Key("file_name")),
    action("GMAIL_LIST_DRAFTS", "Listed drafts", Target::None),
    action("GMAIL_GET_DRAFT", "Read draft", Target::Key("draft_id")),
    action("GMAIL_CREATE_EMAIL_DRAFT", "Drafted email", Target::Key("subject")),
    action("GMAIL_UPDATE_DRAFT", "Updated draft", Target::Key("subject")),
    action("GMAIL_SEND_EMAIL", "Sent email", Target::Key("recipient_email")),
    action("GMAIL_SEND_DRAFT", "Sent draft", Target::Key("draft_id")),
    action("GMAIL_REPLY_TO_THREAD", "Replied to thread", Target::Key("recipient_email")),
];

pub static JIRA: &[ActionDef] = &[
    action("JIRA_SEARCH_ISSUES", "Searched issues", Target::Key("jql")),
    action("JIRA_GET_ISSUE", "Read issue", Target::Key("issue_id_or_key")),
    action("JIRA_LIST_ISSUE_COMMENTS", "Read issue comments", Target::Key("issue_id_or_key")),
    action("JIRA_GET_ALL_PROJECTS", "Listed projects", Target::None),
    action("JIRA_GET_ISSUE_TYPES", "Listed issue types", Target::None),
    action("JIRA_GET_CREATE_METADATA_ISSUE_TYPE_FIELDS", "Read issue fields", Target::Key("projectIdOrKey")),
    action("JIRA_CREATE_ISSUE", "Created issue", Target::Key("summary")),
    action("JIRA_EDIT_ISSUE", "Edited issue", Target::Key("issue_id_or_key")),
    action("JIRA_ADD_COMMENT", "Commented on issue", Target::Key("issue_id_or_key")),
    action("JIRA_ASSIGN_ISSUE", "Assigned issue", Target::Key("issue_id_or_key")),
    action("JIRA_GET_TRANSITIONS", "Read transitions", Target::Key("issue_id_or_key")),
    action("JIRA_TRANSITION_ISSUE", "Moved issue", Target::Key("issue_id_or_key")),
    action("JIRA_FIND_USERS2", "Searched users", Target::Key("query")),
];

pub static NOTION: &[ActionDef] = &[
    action("NOTION_SEARCH_NOTION_PAGE", "Searched Notion", Target::Key("query")),
    action("NOTION_RETRIEVE_PAGE", "Read page", Target::Key("page_id")),
    action("NOTION_GET_PAGE_MARKDOWN", "Read page", Target::Key("page_id")),
    action("NOTION_FETCH_BLOCK_CONTENTS", "Read blocks", Target::Key("block_id")),
    action("NOTION_FETCH_ALL_BLOCK_CONTENTS", "Read page content", Target::Key("block_id")),
    action("NOTION_QUERY_DATABASE", "Queried database", Target::Key("database_id")),
    action("NOTION_FETCH_DATABASE", "Read database", Target::Key("database_id")),
    action("NOTION_CREATE_NOTION_PAGE", "Created page", Target::Key("title")),
    action("NOTION_ADD_MULTIPLE_PAGE_CONTENT", "Added page content", Target::Key("parent_block_id")),
    action("NOTION_UPDATE_PAGE", "Updated page", Target::Key("page_id")),
    action("NOTION_CREATE_COMMENT", "Commented", Target::Key("parent_page_id")),
];
