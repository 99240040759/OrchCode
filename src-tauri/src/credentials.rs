use keyring::Entry;

use crate::error::{AppError, AppResult};

const SERVICE: &str = "Orch";

fn entry(account: &str) -> AppResult<Entry> {
    Entry::new(SERVICE, account)
        .map_err(|e| AppError::other(format!("credential store unavailable for {account}: {e}")))
}

pub fn save(account: &str, value: &str) -> AppResult<()> {
    entry(account)?.set_password(value).map_err(|e| {
        AppError::other(format!("could not save {account} to the credential store: {e}"))
    })
}

pub fn load(account: &str) -> Option<String> {
    let entry = entry(account).ok()?;
    match entry.get_password() {
        Ok(value) if !value.is_empty() => Some(value),
        Ok(_) | Err(keyring::Error::NoEntry) => None,
        Err(e) => {
            eprintln!("[credentials] could not read {account} from the credential store: {e}");
            None
        }
    }
}

pub fn delete(account: &str) {
    let Ok(entry) = entry(account) else {
        return;
    };
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) => eprintln!("[credentials] could not delete {account} from the credential store: {e}"),
    }
}
