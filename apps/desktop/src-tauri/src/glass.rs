// Real macOS 26 Liquid Glass: an AppKit NSGlassEffectView placed BEHIND the transparent WKWebView,
// shaped as the floating sidebar panel (Mail / Notes style). Tauri has no glass API yet, so this
// talks to AppKit directly. On macOS < 26 the class does not exist and the window keeps vibrancy.
#![cfg(target_os = "macos")]

use objc2::msg_send;
use objc2::runtime::{AnyClass, AnyObject};
use objc2_foundation::{NSPoint, NSRect, NSSize};

pub const SIDEBAR_WIDTH: f64 = 232.0;
const INSET: f64 = 8.0;
const RADIUS: f64 = 18.0;

/// `webview` is the WKWebView pointer from `with_webview`. Returns false when glass is unavailable.
///
/// # Safety
/// Must run on the main thread with a live WKWebView pointer.
pub unsafe fn add_sidebar_glass(webview: *mut AnyObject) -> bool {
    let Some(class) = AnyClass::get(c"NSGlassEffectView") else {
        return false;
    };
    if webview.is_null() {
        return false;
    }
    let superview: *mut AnyObject = msg_send![webview, superview];
    if superview.is_null() {
        return false;
    }
    let bounds: NSRect = msg_send![superview, bounds];
    let frame = NSRect::new(
        NSPoint::new(INSET, INSET),
        NSSize::new(SIDEBAR_WIDTH - INSET * 2.0, (bounds.size.height - INSET * 2.0).max(0.0)),
    );
    let glass: *mut AnyObject = msg_send![class, alloc];
    let glass: *mut AnyObject = msg_send![glass, initWithFrame: frame];
    if glass.is_null() {
        return false;
    }
    let _: () = msg_send![glass, setCornerRadius: RADIUS];
    // NSViewHeightSizable (16) | NSViewMaxXMargin (4): grows with the window height, pinned left.
    let _: () = msg_send![glass, setAutoresizingMask: 20usize];
    // NSWindowBelow (-1): behind the web content, so the transparent sidebar shows real glass.
    let _: () = msg_send![superview, addSubview: glass, positioned: -1isize, relativeTo: webview];
    true
}
