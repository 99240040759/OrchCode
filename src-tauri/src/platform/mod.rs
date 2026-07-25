#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::setup_native_window;

#[cfg(not(target_os = "windows"))]
mod other;
#[cfg(not(target_os = "windows"))]
pub use other::setup_native_window;
