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
    pub active_label: &'static str,
    pub target: Target,
}

const fn action(
    slug: &'static str,
    label: &'static str,
    active_label: &'static str,
    target: Target,
) -> ActionDef {
    ActionDef { slug, label, active_label, target }
}

pub static GITHUB: &[ActionDef] = &[
    action("GITHUB_FIND_REPOSITORIES", "Searched repositories", "Searching repositories", Target::Key("query")),
    action("GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER", "Listed repositories", "Listing repositories", Target::None),
    action("GITHUB_GET_REPOSITORY_CONTENT", "Read file", "Reading file", Target::Path(&["owner", "repo", "path"])),
    action("GITHUB_LIST_BRANCHES", "Listed branches", "Listing branches", Target::Path(&["owner", "repo"])),
    action("GITHUB_SEARCH_CODE", "Searched code", "Searching code", Target::Key("q")),
    action("GITHUB_SEARCH_ISSUES", "Searched issues", "Searching issues", Target::Key("q")),
    action("GITHUB_LIST_REPOSITORY_ISSUES", "Listed issues", "Listing issues", Target::Path(&["owner", "repo"])),
    action("GITHUB_GET_ISSUE_COMMENTS", "Read issue comments", "Reading issue comments", Target::Path(&["owner", "repo", "issue_number"])),
    action("GITHUB_CREATE_AN_ISSUE", "Created issue", "Creating issue", Target::Key("title")),
    action("GITHUB_CREATE_AN_ISSUE_COMMENT", "Commented on issue", "Commenting on issue", Target::Path(&["owner", "repo", "issue_number"])),
    action("GITHUB_FIND_PULL_REQUESTS", "Searched pull requests", "Searching pull requests", Target::Key("query")),
    action("GITHUB_GET_A_PULL_REQUEST", "Read pull request", "Reading pull request", Target::Path(&["owner", "repo", "pull_number"])),
    action("GITHUB_LIST_PULL_REQUESTS_FILES", "Listed pull request files", "Listing pull request files", Target::Path(&["owner", "repo", "pull_number"])),
    action("GITHUB_CREATE_A_PULL_REQUEST", "Opened pull request", "Opening pull request", Target::Key("title")),
    action("GITHUB_CREATE_BRANCH", "Created branch", "Creating branch", Target::Key("branch_name")),
    action("GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS", "Wrote file", "Writing file", Target::Path(&["owner", "repo", "path"])),
    action("GITHUB_COMMIT_MULTIPLE_FILES", "Committed files", "Committing files", Target::Key("message")),
];

pub static SLACK: &[ActionDef] = &[
    action("SLACK_FIND_CHANNELS", "Searched channels", "Searching channels", Target::Key("query")),
    action("SLACK_LIST_ALL_CHANNELS", "Listed channels", "Listing channels", Target::None),
    action("SLACK_FETCH_CONVERSATION_HISTORY", "Read channel history", "Reading channel history", Target::Key("channel")),
    action("SLACK_SEARCH_MESSAGES", "Searched messages", "Searching messages", Target::Key("query")),
    action("SLACK_FIND_USERS", "Searched users", "Searching users", Target::Key("search_query")),
    action("SLACK_SEND_MESSAGE", "Sent message", "Sending message", Target::Key("channel")),
    action("SLACK_UPDATES_A_SLACK_MESSAGE", "Edited message", "Editing message", Target::Key("channel")),
    action("SLACK_ADD_REACTION_TO_AN_ITEM", "Added reaction", "Adding reaction", Target::Key("channel")),
    action("SLACK_SCHEDULE_MESSAGE", "Scheduled message", "Scheduling message", Target::Key("channel")),
];

pub static GOOGLEDRIVE: &[ActionDef] = &[
    action("GOOGLEDRIVE_FIND_FILE", "Searched Drive", "Searching Drive", Target::Key("q")),
    action("GOOGLEDRIVE_GET_FILE_METADATA", "Read file details", "Reading file details", Target::Key("fileId")),
    action("GOOGLEDRIVE_DOWNLOAD_FILE", "Downloaded file", "Downloading file", Target::Key("fileId")),
    action("GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE", "Exported file", "Exporting file", Target::Key("fileId")),
    action("GOOGLEDRIVE_READ_SPREADSHEET_VALUES", "Read spreadsheet", "Reading spreadsheet", Target::Key("spreadsheet_id")),
    action("GOOGLEDRIVE_CREATE_FOLDER", "Created folder", "Creating folder", Target::Key("name")),
    action("GOOGLEDRIVE_CREATE_FILE", "Created file", "Creating file", Target::Key("name")),
];

pub static GMAIL: &[ActionDef] = &[
    action("GMAIL_FETCH_EMAILS", "Searched emails", "Searching emails", Target::Key("query")),
    action("GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", "Read email", "Reading email", Target::Key("message_id")),
    action("GMAIL_GET_ATTACHMENT", "Fetched attachment", "Fetching attachment", Target::Key("file_name")),
    action("GMAIL_LIST_DRAFTS", "Listed drafts", "Listing drafts", Target::None),
    action("GMAIL_GET_DRAFT", "Read draft", "Reading draft", Target::Key("draft_id")),
    action("GMAIL_CREATE_EMAIL_DRAFT", "Drafted email", "Drafting email", Target::Key("subject")),
    action("GMAIL_UPDATE_DRAFT", "Updated draft", "Updating draft", Target::Key("subject")),
    action("GMAIL_SEND_EMAIL", "Sent email", "Sending email", Target::Key("recipient_email")),
    action("GMAIL_SEND_DRAFT", "Sent draft", "Sending draft", Target::Key("draft_id")),
    action("GMAIL_REPLY_TO_THREAD", "Replied to thread", "Replying to thread", Target::Key("recipient_email")),
];

pub static JIRA: &[ActionDef] = &[
    action("JIRA_SEARCH_ISSUES", "Searched issues", "Searching issues", Target::Key("jql")),
    action("JIRA_GET_ISSUE", "Read issue", "Reading issue", Target::Key("issue_id_or_key")),
    action("JIRA_LIST_ISSUE_COMMENTS", "Read issue comments", "Reading issue comments", Target::Key("issue_id_or_key")),
    action("JIRA_GET_ALL_PROJECTS", "Listed projects", "Listing projects", Target::None),
    action("JIRA_GET_ISSUE_TYPES", "Listed issue types", "Listing issue types", Target::None),
    action("JIRA_GET_CREATE_METADATA_ISSUE_TYPE_FIELDS", "Read issue fields", "Reading issue fields", Target::Key("projectIdOrKey")),
    action("JIRA_CREATE_ISSUE", "Created issue", "Creating issue", Target::Key("summary")),
    action("JIRA_EDIT_ISSUE", "Edited issue", "Editing issue", Target::Key("issue_id_or_key")),
    action("JIRA_ADD_COMMENT", "Commented on issue", "Commenting on issue", Target::Key("issue_id_or_key")),
    action("JIRA_ASSIGN_ISSUE", "Assigned issue", "Assigning issue", Target::Key("issue_id_or_key")),
    action("JIRA_GET_TRANSITIONS", "Read transitions", "Reading transitions", Target::Key("issue_id_or_key")),
    action("JIRA_TRANSITION_ISSUE", "Moved issue", "Moving issue", Target::Key("issue_id_or_key")),
    action("JIRA_FIND_USERS2", "Searched users", "Searching users", Target::Key("query")),
];

pub static NOTION: &[ActionDef] = &[
    action("NOTION_SEARCH_NOTION_PAGE", "Searched Notion", "Searching Notion", Target::Key("query")),
    action("NOTION_RETRIEVE_PAGE", "Read page", "Reading page", Target::Key("page_id")),
    action("NOTION_GET_PAGE_MARKDOWN", "Read page", "Reading page", Target::Key("page_id")),
    action("NOTION_FETCH_BLOCK_CONTENTS", "Read blocks", "Reading blocks", Target::Key("block_id")),
    action("NOTION_FETCH_ALL_BLOCK_CONTENTS", "Read page content", "Reading page content", Target::Key("block_id")),
    action("NOTION_QUERY_DATABASE", "Queried database", "Querying database", Target::Key("database_id")),
    action("NOTION_FETCH_DATABASE", "Read database", "Reading database", Target::Key("database_id")),
    action("NOTION_CREATE_NOTION_PAGE", "Created page", "Creating page", Target::Key("title")),
    action("NOTION_ADD_MULTIPLE_PAGE_CONTENT", "Added page content", "Adding page content", Target::Key("parent_block_id")),
    action("NOTION_UPDATE_PAGE", "Updated page", "Updating page", Target::Key("page_id")),
    action("NOTION_CREATE_COMMENT", "Commented", "Commenting", Target::Key("parent_page_id")),
];
