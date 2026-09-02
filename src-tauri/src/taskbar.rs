//! The Windows taskbar: thumbnail transport buttons and the jump list.
//!
//! # What these are
//!
//! Two things Windows offers and almost nothing uses well. Hovering the
//! taskbar button shows a thumbnail of the window with up to seven buttons
//! under it — the place every media player on Windows puts previous, play/pause
//! and next, so you can skip a track without raising the window. Right-clicking
//! the same taskbar button shows a jump list, which is where recent items go.
//!
//! # Why this is raw COM
//!
//! There is no crate wrapping `ITaskbarList3` or `ICustomDestinationList`, and
//! writing one would be a larger project than using them. The `windows` crate
//! gives the bindings; the unsafe blocks below are the calls themselves.
//!
//! # Why the icons are drawn rather than shipped
//!
//! A thumbnail button needs an `HICON`, and shipping three `.ico` files means
//! three assets that have to be found at runtime, in a bundle whose layout
//! differs per installer. Drawing a triangle and two bars into a 32×32 buffer
//! is about forty lines, has no files to lose, and scales to whatever size the
//! shell asks for. [`glyph`] is that drawing, and it is pure arithmetic, so it
//! is tested.
//!
//! # Everything here is best-effort
//!
//! A taskbar button that could not be registered is a convenience nobody has
//! yet; a failure that took down the window would be a bug. Every entry point
//! returns `Result` and every caller logs rather than propagates.

/// Which transport button a thumbnail click was.
///
/// The ids are what Windows sends back in `WM_COMMAND`, so they have to be
/// stable and small. Named rather than bare numbers because a mistyped literal
/// in the message handler would silently wire "next" to "previous".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThumbButton {
    Previous,
    PlayPause,
    Next,
}

impl ThumbButton {
    pub const fn id(self) -> u32 {
        match self {
            Self::Previous => 1,
            Self::PlayPause => 2,
            Self::Next => 3,
        }
    }

    pub const fn from_id(id: u32) -> Option<Self> {
        match id {
            1 => Some(Self::Previous),
            2 => Some(Self::PlayPause),
            3 => Some(Self::Next),
            _ => None,
        }
    }

    /// The tooltip, which is also what a screen reader announces.
    pub const fn label(self, playing: bool) -> &'static str {
        match self {
            Self::Previous => "Previous",
            // One button, two meanings, like every transport bar. The tooltip
            // has to follow the state or it says the opposite of what the
            // button does.
            Self::PlayPause => {
                if playing {
                    "Pause"
                } else {
                    "Play"
                }
            }
            Self::Next => "Next",
        }
    }
}

/// Which shape to draw.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Glyph {
    Previous,
    Play,
    Pause,
    Next,
}

/// Draws one transport glyph as 32-bit premultiplied BGRA, `size` × `size`.
///
/// White, fully opaque where the shape is and fully transparent elsewhere: the
/// taskbar draws these on a dark chrome that the app does not control, and a
/// glyph with its own background would be a white square on it.
///
/// Premultiplied, because that is what `CreateDIBSection` and `CreateIconIndirect`
/// expect for an alpha bitmap — and getting it wrong produces a glyph with a
/// dark halo rather than an error.
pub fn glyph(shape: Glyph, size: usize) -> Vec<u8> {
    let mut pixels = vec![0u8; size * size * 4];

    // A margin, so the shape does not touch the edges of its button.
    let inset = size as f32 * 0.22;
    let span = size as f32 - inset * 2.0;

    for y in 0..size {
        for x in 0..size {
            // Sampled at the centre of the pixel, which is what stops a
            // triangle's edge landing a whole pixel off at small sizes.
            let fx = (x as f32 + 0.5 - inset) / span;
            let fy = (y as f32 + 0.5 - inset) / span;
            if !(0.0..=1.0).contains(&fx) || !(0.0..=1.0).contains(&fy) {
                continue;
            }

            if !inside(shape, fx, fy) {
                continue;
            }

            let at = (y * size + x) * 4;
            // BGRA, premultiplied. White at full alpha is 255 in all four.
            pixels[at] = 255;
            pixels[at + 1] = 255;
            pixels[at + 2] = 255;
            pixels[at + 3] = 255;
        }
    }

    pixels
}

/// Whether a point in the unit square is part of the shape.
fn inside(shape: Glyph, x: f32, y: f32) -> bool {
    match shape {
        // A triangle pointing right: as `x` grows, the band of `y` it covers
        // narrows to a point.
        Glyph::Play => {
            let half = (1.0 - x) * 0.5;
            (y - 0.5).abs() <= half
        }
        Glyph::Pause => {
            // Two bars with a gap. Written as bands rather than as rectangles
            // so the proportions hold at any size.
            (0.12..0.38).contains(&x) || (0.62..0.88).contains(&x)
        }
        // A bar and a triangle pointing left.
        Glyph::Previous => {
            if x < 0.18 {
                return true;
            }
            let half = (x - 0.18) / 0.82 * 0.5;
            (y - 0.5).abs() <= half
        }
        // The mirror image.
        Glyph::Next => {
            if x > 0.82 {
                return true;
            }
            let half = (0.82 - x) / 0.82 * 0.5;
            (y - 0.5).abs() <= half
        }
    }
}

#[cfg(target_os = "windows")]
mod win {
    use super::{glyph, Glyph, ThumbButton};

    use crate::control::{RemoteAction, CONTROL_EVENT};
    use tauri::Emitter;
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        CreateBitmap, CreateDIBSection, DeleteObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS, HBITMAP,
    };
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{
        DefSubclassProc, DestinationList, EnumerableObjectCollection, ICustomDestinationList,
        IShellLinkW, SHStrDupW, SetWindowSubclass, ShellLink, TaskbarList,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateIconIndirect, DestroyIcon, HICON, ICONINFO, WM_COMMAND,
    };

    /// The size Windows asks thumbnail buttons for.
    ///
    /// Fixed at 16×16 in the API — the shell scales it for high-DPI displays
    /// rather than asking for a larger one, which is why these are drawn at
    /// 32 and handed over as an alpha bitmap the shell can rescale cleanly.
    const ICON_SIZE: usize = 32;

    /// `PKEY_Title`, which is what a jump-list entry's label reads from.
    ///
    /// Spelled out rather than imported: the constant lives in a header the
    /// `windows` crate does not re-export, and the GUID is stable and public.
    const PKEY_TITLE: PROPERTYKEY = PROPERTYKEY {
        fmtid: windows::core::GUID::from_u128(0xf29f85e0_4ff9_1068_ab91_08002b27b3d9),
        pid: 2,
    };

    /// Initialises COM for this thread, tolerating an already-initialised one.
    ///
    /// Tauri's window thread may already have done it, and `RPC_E_CHANGED_MODE`
    /// is not a failure — it means somebody got there first with a different
    /// threading model, and the calls below work either way.
    fn ensure_com() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Turns a premultiplied BGRA buffer into an `HICON`.
    ///
    /// The mask bitmap is required even for a 32-bit icon and is ignored when
    /// the colour bitmap has an alpha channel — passing a null one produces an
    /// icon that silently fails to draw.
    unsafe fn icon_from(pixels: &[u8], size: usize) -> Option<HICON> {
        let header = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: size as i32,
                // Negative, so the rows run top-down like the buffer does.
                // Positive would draw every glyph upside down.
                biHeight: -(size as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let colour: HBITMAP =
            unsafe { CreateDIBSection(None, &header, DIB_RGB_COLORS, &mut bits, None, 0) }.ok()?;

        if bits.is_null() {
            unsafe {
                let _ = DeleteObject(colour.into());
            }
            return None;
        }
        unsafe {
            std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits.cast::<u8>(), pixels.len());
        }

        let mask: HBITMAP = unsafe { CreateBitmap(size as i32, size as i32, 1, 1, None) };

        let info = ICONINFO {
            fIcon: true.into(),
            xHotspot: 0,
            yHotspot: 0,
            hbmMask: mask,
            hbmColor: colour,
        };

        let icon = unsafe { CreateIconIndirect(&info) }.ok();

        // The bitmaps are copied into the icon; keeping them would leak two GDI
        // objects per button per track change.
        unsafe {
            let _ = DeleteObject(colour.into());
            let _ = DeleteObject(mask.into());
        }

        icon
    }

    /// A `PROPVARIANT` holding a string.
    ///
    /// Built by hand because this version of the `windows` crate has no
    /// conversion for it, and the two helpers it does expose produce a *vector*
    /// of strings — which `PKEY_Title` rejects, leaving a jump list of rows
    /// with no labels and no error to explain them.
    ///
    /// The string is duplicated with `SHStrDupW` so it lives in the COM task
    /// allocator: the shell takes ownership through `SetValue`, and a pointer
    /// into a Rust `Vec` would be freed under it.
    unsafe fn lpwstr(text: &str) -> Option<PROPVARIANT> {
        let wide = wide(text);
        let owned = unsafe { SHStrDupW(PCWSTR(wide.as_ptr())) }.ok()?;

        let mut value = PROPVARIANT::default();
        // Zeroed by `default`, so only the two fields that matter are written.
        unsafe {
            let inner = &mut *value.Anonymous.Anonymous;
            inner.vt = VT_LPWSTR;
            inner.Anonymous.pwszVal = owned;
        }
        Some(value)
    }

    /// Installs or updates the three transport buttons under the thumbnail.
    ///
    /// `ThumbBarAddButtons` may be called only once per window; every call
    /// after it has to be `ThumbBarUpdateButtons`. Calling add twice returns an
    /// error and leaves the first set in place, which is why the caller tracks
    /// whether it has added them.
    pub fn set_thumb_buttons(hwnd: isize, playing: bool, added: bool) -> Result<(), String> {
        ensure_com();

        let hwnd = HWND(hwnd as *mut core::ffi::c_void);

        let list: windows::Win32::UI::Shell::ITaskbarList3 =
            unsafe { CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER) }
                .map_err(|e| format!("no taskbar interface: {e}"))?;
        unsafe { list.HrInit() }.map_err(|e| format!("could not talk to the taskbar: {e}"))?;

        let shapes = [
            (ThumbButton::Previous, Glyph::Previous),
            (
                ThumbButton::PlayPause,
                if playing { Glyph::Pause } else { Glyph::Play },
            ),
            (ThumbButton::Next, Glyph::Next),
        ];

        let mut icons: Vec<HICON> = Vec::with_capacity(shapes.len());
        let mut buttons = Vec::with_capacity(shapes.len());

        for (button, shape) in shapes {
            let pixels = glyph(shape, ICON_SIZE);
            let Some(icon) = (unsafe { icon_from(&pixels, ICON_SIZE) }) else {
                continue;
            };
            icons.push(icon);

            let mut entry = windows::Win32::UI::Shell::THUMBBUTTON {
                dwMask: windows::Win32::UI::Shell::THB_ICON
                    | windows::Win32::UI::Shell::THB_TOOLTIP
                    | windows::Win32::UI::Shell::THB_FLAGS,
                iId: button.id(),
                hIcon: icon,
                dwFlags: windows::Win32::UI::Shell::THBF_ENABLED,
                ..Default::default()
            };

            let label = wide(button.label(playing));
            for (at, unit) in label.iter().take(entry.szTip.len() - 1).enumerate() {
                entry.szTip[at] = *unit;
            }

            buttons.push(entry);
        }

        let result = if added {
            unsafe { list.ThumbBarUpdateButtons(hwnd, &buttons) }
        } else {
            unsafe { list.ThumbBarAddButtons(hwnd, &buttons) }
        };

        // The icons are owned by the shell once the call succeeds, and by
        // nobody at all if it failed. Destroying them either way would leave
        // the buttons blank; leaking them would leak three GDI handles per
        // track. The shell copies them, so destroying after the call is right.
        for icon in icons {
            unsafe {
                let _ = DestroyIcon(icon);
            }
        }

        result.map_err(|e| format!("could not set the taskbar buttons: {e}"))
    }

    /// Replaces the jump list with the given recent items.
    ///
    /// Each entry relaunches the app with `--open <path>`, which the CLI
    /// already understands — so the jump list needs no separate code path and
    /// cannot drift from what double-clicking a file does.
    pub fn set_jump_list(exe: &str, items: &[(String, String)]) -> Result<(), String> {
        ensure_com();

        let list: ICustomDestinationList =
            unsafe { CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER) }
                .map_err(|e| format!("no jump list interface: {e}"))?;

        let mut slots = 0u32;
        // The removed list has to be fetched even when it is not used: the
        // shell refuses `AddUserTasks` until `BeginList` has been called, and
        // `BeginList` is what reports how many entries will fit.
        let _removed: IObjectArray = unsafe { list.BeginList(&mut slots) }
            .map_err(|e| format!("could not begin the jump list: {e}"))?;

        let collection: IObjectCollection =
            unsafe { CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER) }
                .map_err(|e| format!("no jump list collection: {e}"))?;

        for (title, path) in items.iter().take(slots.max(1) as usize) {
            let Ok(link) = (unsafe {
                CoCreateInstance::<_, IShellLinkW>(&ShellLink, None, CLSCTX_INPROC_SERVER)
            }) else {
                continue;
            };

            let exe_wide = wide(exe);
            let args = wide(&format!("--open \"{path}\""));
            unsafe {
                let _ = link.SetPath(PCWSTR(exe_wide.as_ptr()));
                let _ = link.SetArguments(PCWSTR(args.as_ptr()));
                // The app's own icon, from the executable. A jump list entry
                // with no icon shows a blank square.
                let _ = link.SetIconLocation(PCWSTR(exe_wide.as_ptr()), 0);
            }

            // The visible label lives in the property store rather than on the
            // link: `SetDescription` sets the *tooltip*, which is the mistake
            // that produces a jump list of blank rows.
            if let Ok(store) = link.cast::<IPropertyStore>() {
                if let Some(value) = unsafe { lpwstr(title) } {
                    unsafe {
                        let _ = store.SetValue(&PKEY_TITLE, &value);
                        let _ = store.Commit();
                    }
                }
            }

            let _ = unsafe { collection.AddObject(&link) };
        }

        let array: IObjectArray = collection
            .cast()
            .map_err(|e| format!("could not read the jump list back: {e}"))?;

        // Bound rather than written inline. A `PCWSTR` built from
        // `wide(..).as_ptr()` inside the call argument points into a temporary
        // that is only alive because the whole statement is one expression —
        // true today and one refactor away from a dangling pointer.
        let category = wide("Recent");

        // `AppendCategory` fails with `E_ACCESSDENIED` when the process has no
        // registered AppUserModelID, which is every launch that did not come
        // from an installed shortcut — so, every development build. It is not
        // something the caller or the user can act on, and it is not a failure
        // of anything they asked for.
        if let Err(why) = unsafe { list.AppendCategory(PCWSTR(category.as_ptr()), &array) } {
            log::info!(
                "no jump list on this launch ({why}) - Windows only offers one \
                 to an installed application with a Start Menu entry"
            );
            // Abandoned rather than committed: committing an empty list would
            // clear whatever a previously installed copy had put there.
            unsafe {
                let _ = list.AbortList();
            }
            return Ok(());
        }

        unsafe { list.CommitList() }.map_err(|e| format!("could not save the jump list: {e}"))?;

        Ok(())
    }

    /// Which button a `WM_COMMAND` was, if any.
    ///
    /// Split out and taking plain integers so it can be tested without a
    /// window: the packing is the part that is easy to get wrong, and getting
    /// it wrong wires "next" to "previous" with nothing to say so.
    pub fn thumb_button_from_message(wparam: usize, _lparam: isize) -> Option<ThumbButton> {
        // The button id is the low word of `wParam`; the high word is the
        // notification code, which for a thumbnail button is `THBN_CLICKED`.
        const THBN_CLICKED: u32 = 0x1800;
        if ((wparam >> 16) & 0xFFFF) as u32 != THBN_CLICKED {
            return None;
        }
        ThumbButton::from_id((wparam & 0xFFFF) as u32)
    }

    /// Where a thumbnail click is sent.
    ///
    /// A static, because a window procedure is a bare function pointer with
    /// nowhere to hang a closure. Set once, at install time.
    static APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

    /// The subclass id. Any value, as long as it is the same one at removal.
    const SUBCLASS_ID: usize = 0x4d41_4442;

    unsafe extern "system" fn wnd_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        if message == WM_COMMAND {
            if let Some(button) = thumb_button_from_message(wparam.0, lparam.0) {
                if let Some(app) = APP.get() {
                    let action = match button {
                        ThumbButton::Previous => RemoteAction::Previous,
                        ThumbButton::PlayPause => RemoteAction::PlayPause,
                        ThumbButton::Next => RemoteAction::Next,
                    };
                    // The same event the remote control and the CLI use, so
                    // there is one path in the frontend for "something outside
                    // this window asked us to do a thing".
                    let _ = app.emit(CONTROL_EVENT, &action);
                }
                return LRESULT(0);
            }
        }

        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }

    /// Starts listening for thumbnail-button clicks on a window.
    ///
    /// Subclassing rather than a Tauri hook, because Tauri does not surface raw
    /// window messages and `WM_COMMAND` is the only way the shell reports these.
    /// `SetWindowSubclass` chains rather than replaces, so Tauri's own handling
    /// is untouched.
    pub fn listen_for_clicks(app: tauri::AppHandle, hwnd: isize) -> Result<(), String> {
        let _ = APP.set(app);

        let hwnd = HWND(hwnd as *mut core::ffi::c_void);
        let ok = unsafe { SetWindowSubclass(hwnd, Some(wnd_proc), SUBCLASS_ID, 0) };
        if ok.as_bool() {
            Ok(())
        } else {
            Err("could not listen for taskbar button clicks".into())
        }
    }
    #[cfg(test)]
    mod message_tests {
        use super::*;

        /// The notification code the shell sends with a thumbnail click.
        const CLICKED: usize = 0x1800 << 16;

        #[test]
        fn reads_the_button_out_of_the_message() {
            assert_eq!(
                thumb_button_from_message(CLICKED | 1, 0),
                Some(ThumbButton::Previous)
            );
            assert_eq!(
                thumb_button_from_message(CLICKED | 3, 0),
                Some(ThumbButton::Next)
            );
        }

        #[test]
        fn ignores_every_other_command() {
            // A window receives WM_COMMAND for menus and accelerators as well.
            // Acting on those would make an unrelated menu item skip a track.
            assert_eq!(thumb_button_from_message(1, 0), None);
            assert_eq!(thumb_button_from_message((0x0300usize << 16) | 1, 0), None);
        }

        #[test]
        fn ignores_a_click_on_a_button_that_does_not_exist() {
            assert_eq!(thumb_button_from_message(CLICKED | 9, 0), None);
        }
    }
}

#[cfg(target_os = "windows")]
pub use win::{listen_for_clicks, set_jump_list, set_thumb_buttons};

#[cfg(not(target_os = "windows"))]
mod other {
    /// Not offered off Windows.
    ///
    /// macOS has a dock menu and Linux has neither; both are separate features
    /// rather than this one, so this reports its absence rather than pretending
    /// to have worked.
    pub fn set_thumb_buttons(_hwnd: isize, _playing: bool, _added: bool) -> Result<(), String> {
        Err("taskbar buttons are a Windows feature".into())
    }

    pub fn set_jump_list(_exe: &str, _items: &[(String, String)]) -> Result<(), String> {
        Err("the jump list is a Windows feature".into())
    }

    pub fn listen_for_clicks(_app: tauri::AppHandle, _hwnd: isize) -> Result<(), String> {
        Err("taskbar buttons are a Windows feature".into())
    }
}

#[cfg(not(target_os = "windows"))]
pub use other::{listen_for_clicks, set_jump_list, set_thumb_buttons};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn button_ids_round_trip() {
        // A mistyped literal in the message handler would wire "next" to
        // "previous" and nothing would say so.
        for button in [
            ThumbButton::Previous,
            ThumbButton::PlayPause,
            ThumbButton::Next,
        ] {
            assert_eq!(ThumbButton::from_id(button.id()), Some(button));
        }
    }

    #[test]
    fn an_unknown_id_is_not_a_button() {
        assert_eq!(ThumbButton::from_id(0), None);
        assert_eq!(ThumbButton::from_id(99), None);
    }

    #[test]
    fn the_play_button_says_what_it_will_do() {
        assert_eq!(ThumbButton::PlayPause.label(false), "Play");
        assert_eq!(ThumbButton::PlayPause.label(true), "Pause");
        // The other two mean the same thing either way.
        assert_eq!(
            ThumbButton::Next.label(true),
            ThumbButton::Next.label(false)
        );
    }

    #[test]
    fn a_glyph_is_the_size_it_was_asked_for() {
        assert_eq!(glyph(Glyph::Play, 32).len(), 32 * 32 * 4);
        assert_eq!(glyph(Glyph::Pause, 16).len(), 16 * 16 * 4);
    }

    /// How many pixels of a glyph are painted.
    fn painted(shape: Glyph, size: usize) -> usize {
        glyph(shape, size)
            .chunks_exact(4)
            .filter(|pixel| pixel[3] > 0)
            .count()
    }

    #[test]
    fn every_glyph_actually_draws_something() {
        // A button with a blank icon is indistinguishable from a broken one.
        for shape in [Glyph::Play, Glyph::Pause, Glyph::Previous, Glyph::Next] {
            let count = painted(shape, 32);
            assert!(count > 40, "{shape:?} painted only {count} pixels");
        }
    }

    #[test]
    fn nothing_is_drawn_outside_the_margin() {
        // The shell draws these inside a small button; a glyph touching the
        // edges reads as a rectangle rather than as a symbol.
        let size = 32;
        let pixels = glyph(Glyph::Play, size);
        for x in 0..size {
            for y in [0usize, size - 1] {
                assert_eq!(pixels[(y * size + x) * 4 + 3], 0);
                assert_eq!(pixels[(x * size + y) * 4 + 3], 0);
            }
        }
    }

    #[test]
    fn next_and_previous_are_mirror_images() {
        // If they are not, one of them is drawn pointing the wrong way — which
        // is a bug nobody notices in code and everybody notices on a taskbar.
        let size = 32;
        let next = glyph(Glyph::Next, size);
        let previous = glyph(Glyph::Previous, size);

        for y in 0..size {
            for x in 0..size {
                let here = next[(y * size + x) * 4 + 3];
                let mirrored = previous[(y * size + (size - 1 - x)) * 4 + 3];
                assert_eq!(here, mirrored, "row {y}, column {x}");
            }
        }
    }

    #[test]
    fn pause_is_two_bars_with_a_gap() {
        // Drawn as one block, it reads as a stop button.
        let size = 32;
        let pixels = glyph(Glyph::Pause, size);
        let middle = size / 2;

        let row: Vec<bool> = (0..size)
            .map(|x| pixels[(middle * size + x) * 4 + 3] > 0)
            .collect();

        let runs = row.windows(2).filter(|pair| pair[0] != pair[1]).count();
        // Off, on, off, on, off: four transitions.
        assert_eq!(runs, 4);
    }

    #[test]
    fn every_painted_pixel_is_opaque_white() {
        // Premultiplied BGRA. A partially transparent pixel with full colour
        // would show as a dark halo on the taskbar rather than as an error.
        for pixel in glyph(Glyph::Play, 32).chunks_exact(4) {
            if pixel[3] == 0 {
                assert_eq!(pixel, [0, 0, 0, 0]);
            } else {
                assert_eq!(pixel, [255, 255, 255, 255]);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Whether the transport buttons have been added to this window yet.
///
/// `ThumbBarAddButtons` may be called once per window and every call after has
/// to be an update; calling add twice returns an error and leaves the first set
/// in place, so a play/pause icon that never changes.
static ADDED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Set once the shell has refused, so it is not asked again.
///
/// This matters more than it sounds. Installing the buttons is blocking COM
/// work on the *main* thread — `CoCreateInstance`, `HrInit`, three icons, and a
/// shell call — and it runs on every play and every pause. On a machine that
/// will not take them (any build without a registered AppUserModelID, which
/// includes every development build) that is a guaranteed round trip to the
/// shell, on the UI thread, for a guaranteed failure, several times a minute.
///
/// One refusal is enough to know the answer. Asking again is how a feature
/// nobody has ends up costing everybody frames.
static REFUSED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Set once the jump list has been refused, for the same reason.
static JUMP_REFUSED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Whether the thumbnail buttons are on the taskbar right now.
///
/// Reported by the diagnostics screen. The buttons are a Windows feature that
/// can fail for reasons the app cannot see — a shell extension, a locked-down
/// policy — and "are they there" was otherwise unanswerable without a taskbar
/// to look at.
pub fn buttons_installed() -> bool {
    ADDED.load(std::sync::atomic::Ordering::Relaxed)
}

/// One recently played track, as the jump list shows it.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentItem {
    pub title: String,
    /// The audio file. Only local tracks can go in a jump list: an entry has to
    /// relaunch the app with something it can open, and a catalogue handle is
    /// not a file.
    pub path: String,
}

/// Brings the taskbar in line with the player.
///
/// Called on every track change and every play/pause, because the play button
/// under the thumbnail has to show what it will *do* rather than what the
/// player is doing.
///
/// # Why the work is posted to the main thread
///
/// Because it is not safe anywhere else, and doing it anywhere else crashed the
/// application. A `#[tauri::command]` runs on a worker thread from the async
/// runtime's pool, and two of the calls below are documented as belonging to
/// the thread that owns the window:
///
/// * **`SetWindowSubclass`** — "must be called from the thread that created the
///   window". Off-thread it corrupts the window's subclass chain rather than
///   failing, so nothing reports a problem until something dereferences it.
/// * **`ITaskbarList3`** — an apartment-threaded COM object. Creating it on a
///   pooled thread and then calling it against a window belonging to another
///   is undefined, and in practice takes the process down.
///
/// The symptom was the worst kind: the app died the moment a track started
/// playing, because that is when the player first reports what it is doing.
///
/// # What this returns now
///
/// Whether the work was *scheduled*, not whether it succeeded. The outcome is
/// known on the other thread and is logged there; the diagnostics screen reads
/// `buttons_installed` for the real answer rather than this return value.
#[tauri::command]
pub fn taskbar_update(app: tauri::AppHandle, playing: bool) -> Result<(), String> {
    use std::sync::atomic::Ordering;

    // Nothing to do, and nothing to schedule. Checked before posting to the
    // main thread rather than inside it: the cheapest main-thread work is the
    // work that is never posted.
    if REFUSED.load(Ordering::Relaxed) {
        return Ok(());
    }

    let handle = app.clone();

    app.run_on_main_thread(move || {
        use tauri::Manager;

        let Some(window) = handle.get_webview_window("main") else {
            return;
        };
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        let raw = hwnd.0 as isize;

        // Installed on the first call rather than at startup: the buttons only
        // exist once they have been added, and there is nothing to listen for
        // before that.
        if !ADDED.load(Ordering::Relaxed) {
            if let Err(why) = listen_for_clicks(handle.clone(), raw) {
                log::info!("taskbar buttons will not report clicks: {why}");
            }
        }

        match set_thumb_buttons(raw, playing, ADDED.load(Ordering::Relaxed)) {
            Ok(()) => ADDED.store(true, Ordering::Relaxed),
            // Logged once at info rather than returned: this runs on every
            // play and pause, and a shell that will not take the buttons is
            // not something the user can act on.
            //
            // And recorded, so it is not attempted again this session. See
            // `REFUSED`.
            Err(why) => {
                REFUSED.store(true, Ordering::Relaxed);
                log::info!("no taskbar buttons on this system: {why}");
            }
        }
    })
    .map_err(|e| format!("could not reach the main thread: {e}"))
}

/// Replaces the jump list with these tracks.
///
/// Each entry relaunches the app with `--open <path>`, which the CLI already
/// understands - so the jump list needs no separate code path and cannot drift
/// from what double-clicking a file does.
#[tauri::command]
pub fn taskbar_recent(app: tauri::AppHandle, items: Vec<RecentItem>) -> Result<(), String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("could not find the executable: {e}"))?
        .to_string_lossy()
        .into_owned();

    let pairs: Vec<(String, String)> = items
        .into_iter()
        .filter(|item| !item.path.trim().is_empty())
        .map(|item| (item.title, item.path))
        .collect();

    // On the main thread, for the same reason `taskbar_update` is: these are
    // apartment-threaded COM objects, and a `#[tauri::command]` runs on a
    // pooled worker. Creating an STA on a thread that never pumps messages is
    // how a shell call stops returning.
    app.run_on_main_thread(move || {
        use std::sync::atomic::Ordering;

        if JUMP_REFUSED.load(Ordering::Relaxed) {
            return;
        }

        if let Err(why) = set_jump_list(&exe, &pairs) {
            JUMP_REFUSED.store(true, Ordering::Relaxed);
            log::info!("no jump list: {why}");
        }
    })
    .map_err(|e| format!("could not reach the main thread: {e}"))
}
