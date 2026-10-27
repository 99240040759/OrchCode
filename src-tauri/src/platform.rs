
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
    use tauri::Manager;
    position_traffic_lights(window);
    let app_handle = window.app_handle().clone();
    let label = window.label().to_string();
    window.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::Resized(_)
            | tauri::WindowEvent::ScaleFactorChanged { .. }
            | tauri::WindowEvent::Focused(true) => {
                if let Some(win) = app_handle.get_webview_window(&label) {
                    position_traffic_lights(&win);
                }
            }
            _ => {}
        }
    });
}

#[cfg(target_os = "macos")]
fn position_traffic_lights(window: &tauri::WebviewWindow) {
    if window.is_fullscreen().unwrap_or(false) {
        return;
    }

    use objc2_app_kit::{NSWindow, NSWindowButton};
    use objc2_foundation::{MainThreadMarker, NSPoint};

    if MainThreadMarker::new().is_none() {
        return;
    }

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
        let superview = match close.superview() {
            Some(v) => v,
            None => return,
        };

        let is_flipped = superview.isFlipped();
        let target_y_from_top = (34.0 - btn_h) / 2.0;

        let origin_y = if is_flipped {
            target_y_from_top
        } else {
            let tb_h = superview.frame().size.height;
            tb_h - target_y_from_top - btn_h
        };

        let x = 12.0;
        let spacing = 20.0;

        let buttons = [&*close, &*miniatur, &*zoom];
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
