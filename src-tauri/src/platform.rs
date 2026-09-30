
#[cfg(target_os = "windows")]
pub fn setup_native_window(window: &tauri::WebviewWindow) {
    let _ = window.set_decorations(false);
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE, DWMWA_WINDOW_CORNER_PREFERENCE,
        DWMWCP_ROUND,
    };
    if let Ok(hwnd_ptr) = window.hwnd() {
        let hwnd = HWND(hwnd_ptr.0 as _);
        unsafe {
            let use_dark_mode: u32 = 1;
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_USE_IMMERSIVE_DARK_MODE,
                &use_dark_mode as *const _ as _,
                std::mem::size_of::<u32>() as u32,
            );
            let corner_pref: u32 = DWMWCP_ROUND.0 as u32;
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &corner_pref as *const _ as _,
                std::mem::size_of::<u32>() as u32,
            );
        }
    }
}


#[cfg(target_os = "macos")]
pub fn setup_native_window(window: &tauri::WebviewWindow) {
    position_traffic_lights(window, 14.0);
}

#[cfg(target_os = "macos")]
fn position_traffic_lights(window: &tauri::WebviewWindow, x: f64) {
    use objc2::rc::Retained;
    use objc2_app_kit::{NSView, NSWindow, NSWindowButton};
    use objc2_foundation::NSPoint;

    let ns_win_ptr = match window.ns_window() {
        Ok(ptr) => ptr,
        Err(_) => return,
    };

    unsafe {
        let ns_window: &NSWindow = &*(ns_win_ptr as *const NSWindow);

        let close    = ns_window.standardWindowButton(NSWindowButton::CloseButton);
        let miniatur = ns_window.standardWindowButton(NSWindowButton::MiniaturizeButton);
        let zoom     = ns_window.standardWindowButton(NSWindowButton::ZoomButton);

        let (close, miniatur, zoom) = match (close, miniatur, zoom) {
            (Some(c), Some(m), Some(z)) => (c, m, z),
            _ => return,
        };

        let btn_h = close.frame().size.height;

        let title_bar_container: Retained<NSView> = {
            let sv1 = close.superview();
            match sv1.and_then(|v| v.superview()) {
                Some(v) => v,
                None    => return,
            }
        };

        let tb_h = title_bar_container.frame().size.height;

        // Vertical center of the button within the title bar container,
        // computed from real geometry (not a hardcoded fudge value).
        let origin_y = (tb_h - btn_h) / 2.0;

        let spacing = miniatur.frame().origin.x - close.frame().origin.x;

        let buttons: &[&NSView] = &[&*close, &*miniatur, &*zoom];
        for (i, btn) in buttons.iter().enumerate() {
            btn.setFrameOrigin(NSPoint {
                x: x + (i as f64) * spacing,
                y: origin_y,
            });
        }
    }
}


#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn setup_native_window(_window: &tauri::WebviewWindow) {}
