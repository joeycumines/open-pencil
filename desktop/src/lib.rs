mod fig_container;
mod fonts;
mod http;
mod menu;
mod menu_events;
#[cfg(target_os = "macos")]
mod window;

use fig_container::build_fig_file;
use fonts::{list_system_fonts, load_system_font};
use http::proxy_http_request;
use menu::install_app_menu;
use menu_events::handle_menu_event;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;
#[cfg(target_os = "macos")]
use window::show_main_window;

#[derive(Clone, serde::Serialize)]
struct PendingOpenFile {
    path: String,
}

struct PendingOpen(Mutex<Vec<PendingOpenFile>>);

#[tauri::command]
fn take_pending_open(state: tauri::State<PendingOpen>) -> Vec<PendingOpenFile> {
    state
        .0
        .lock()
        .map(|mut pending| pending.drain(..).collect())
        .unwrap_or_default()
}

#[tauri::command]
fn is_same_existing_native_file(first_path: String, second_path: String) -> Option<bool> {
    same_file::is_same_file(first_path, second_path).ok()
}

fn file_association_path(path: PathBuf) -> Option<PathBuf> {
    let path = path.canonicalize().ok()?;
    if !path.is_file() {
        return None;
    }
    let ext = path.extension()?.to_string_lossy().to_lowercase();
    matches!(ext.as_str(), "fig" | "pen").then_some(path)
}

fn path_from_arg(arg: String, cwd: &Path) -> Option<PathBuf> {
    if arg.starts_with('-') {
        return None;
    }

    if let Ok(url) = tauri::Url::parse(&arg) {
        if let Ok(path) = url.to_file_path() {
            return Some(path);
        }
    }

    let path = PathBuf::from(arg);
    Some(if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    })
}

fn open_paths_from_args(args: Vec<String>, cwd: &Path) -> Vec<PathBuf> {
    args.into_iter()
        .filter_map(|arg| path_from_arg(arg, cwd))
        .filter_map(file_association_path)
        .collect()
}

/// Collapse runs of consecutive forward slashes into a single slash.
fn collapse_duplicate_slashes(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_slash = false;
    for ch in s.chars() {
        if ch == '/' {
            if prev_slash {
                continue;
            }
            prev_slash = true;
        } else {
            prev_slash = false;
        }
        out.push(ch);
    }
    out
}

fn strip_trailing_slash(s: &str) -> &str {
    s.strip_suffix('/').unwrap_or(s)
}

/// Normalise a path for identity comparison on the current platform.
///
/// - Case is preserved because lexical paths do not prove the semantics of the
///   backing volume or directory. Existing paths use physical-file proof when
///   their lexical forms differ.
/// - Duplicate forward slashes are collapsed and a single trailing forward
///   slash is removed on all platforms.
/// - Backslashes are converted to forward slashes only on Windows.
/// - Windows verbatim prefixes (`\\?\` and `\\?\UNC\`) are stripped, and plain
///   UNC paths (`\\server\share`) keep their leading `//` after normalization.
/// - Non-UTF-8 paths are rejected before pending serialization because a lossy
///   string cannot preserve file identity for the frontend.
fn path_identity_key(path: &Path) -> String {
    let lossy = path.to_string_lossy();
    #[cfg(target_os = "windows")]
    {
        // Canonicalized Windows paths may carry the extended-length (`\\?\`) or
        // extended-length UNC (`\\?\UNC\`) verbatim prefix. Strip it before
        // slash normalization so the identity key matches ordinary paths sent
        // by the frontend. Plain UNC paths (`\\server\share`) keep their leading
        // `//` after normalization.
        let raw = lossy.into_owned();
        let (rest, is_unc) = if let Some(r) = raw.strip_prefix(r"\\?\UNC\") {
            (r, true)
        } else if let Some(r) = raw.strip_prefix(r"\\?\") {
            (r, false)
        } else if raw.starts_with("\\\\") {
            (&raw[2..], true)
        } else {
            (raw.as_str(), false)
        };

        let slash_normalized = rest.replace('\\', "/");
        let collapsed = collapse_duplicate_slashes(&slash_normalized);
        let without_trailing = strip_trailing_slash(&collapsed);
        let with_prefix = if is_unc {
            format!("//{}", without_trailing)
        } else {
            without_trailing.to_string()
        };

        with_prefix
    }
    #[cfg(target_os = "macos")]
    {
        let collapsed = collapse_duplicate_slashes(&lossy);
        strip_trailing_slash(&collapsed).to_string()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let collapsed = collapse_duplicate_slashes(&lossy);
        strip_trailing_slash(&collapsed).to_string()
    }
}

fn paths_refer_to_same_existing_file(first: &Path, second: &Path) -> bool {
    path_identity_key(first) == path_identity_key(second)
        || same_file::is_same_file(first, second).unwrap_or(false)
}

fn pending_path_string(path: &Path) -> Option<String> {
    path.to_str().map(str::to_owned)
}

fn pending_contains_equivalent_path(pending: &[PendingOpenFile], path: &Path) -> bool {
    pending
        .iter()
        .any(|queued| paths_refer_to_same_existing_file(Path::new(&queued.path), path))
}

fn queue_open_paths<R: tauri::Runtime>(app: &tauri::AppHandle<R>, paths: Vec<PathBuf>) {
    let mut files: Vec<(PendingOpenFile, PathBuf)> = Vec::new();
    for path in paths {
        let Some(serialized_path) = pending_path_string(&path) else {
            continue;
        };
        if files
            .iter()
            .any(|(_, existing)| paths_refer_to_same_existing_file(existing, &path))
        {
            continue;
        }
        let _ = app.fs_scope().allow_file(&path);
        files.push((
            PendingOpenFile {
                path: serialized_path,
            },
            path,
        ));
    }

    if files.is_empty() {
        return;
    }

    if let Ok(mut pending) = app.state::<PendingOpen>().0.lock() {
        for (file, path) in files {
            if !pending_contains_equivalent_path(&pending, &path) {
                pending.push(file);
            }
        }
    }

    let _ = app.emit("open-associated-files", ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
}

fn startup_open_paths() -> Vec<PathBuf> {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    open_paths_from_args(std::env::args().skip(1).collect(), &cwd)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = fix_path_env::fix();

    let mut builder = tauri::Builder::default();

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            queue_open_paths(app, open_paths_from_args(args, Path::new(&cwd)));
        }));
    }

    builder
        .manage(PendingOpen(Mutex::new(Vec::new())))
        .invoke_handler(tauri::generate_handler![
            build_fig_file,
            is_same_existing_native_file,
            list_system_fonts,
            load_system_font,
            proxy_http_request,
            take_pending_open
        ])
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id().0.as_str());
        })
        .setup(|app| {
            queue_open_paths(app.handle(), startup_open_paths());
            Ok(install_app_menu(app)?)
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                let paths = urls
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter_map(file_association_path)
                    .collect();
                queue_open_paths(_app, paths);
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                if !has_visible_windows {
                    show_main_window(_app);
                }
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::Path,
        sync::atomic::{AtomicUsize, Ordering},
    };

    use super::{
        is_same_existing_native_file, path_identity_key, pending_contains_equivalent_path,
        pending_path_string, PendingOpenFile,
    };

    #[test]
    fn windows_normalizes_slashes_without_guessing_case_semantics() {
        // These assertions target Windows behaviour, but constructing the same
        // paths here is harmless on other platforms.
        #[cfg(target_os = "windows")]
        {
            assert_eq!(
                path_identity_key(Path::new(r"C:\foo\bar.txt")),
                "C:/foo/bar.txt"
            );
            assert_eq!(
                path_identity_key(Path::new(r"C:/foo\\bar.txt")),
                "C:/foo/bar.txt"
            );
            assert_eq!(path_identity_key(Path::new(r"C:\foo\\bar\")), "C:/foo/bar");
            assert_eq!(
                path_identity_key(Path::new(r"C:/foo//bar.txt")),
                "C:/foo/bar.txt"
            );
            assert_eq!(
                path_identity_key(Path::new(r"\\server\share\file.fig")),
                "//server/share/file.fig"
            );
            assert_eq!(
                path_identity_key(Path::new(r"\\server\share\dir\\")),
                "//server/share/dir"
            );
        }
    }

    #[test]
    fn windows_strips_verbatim_prefix_before_normalizing() {
        // These assertions target Windows behaviour, but constructing the same
        // paths here is harmless on other platforms.
        #[cfg(target_os = "windows")]
        {
            assert_eq!(
                path_identity_key(Path::new(r"\\?\C:\foo\bar.txt")),
                "C:/foo/bar.txt"
            );
            assert_eq!(
                path_identity_key(Path::new(r"\\?\C:\foo\bar.txt\\")),
                "C:/foo/bar.txt"
            );
            assert_eq!(
                path_identity_key(Path::new(r"\\?\UNC\server\share\file.fig")),
                "//server/share/file.fig"
            );
            assert_eq!(
                path_identity_key(Path::new(r"\\?\UNC\server\share\file.fig\\")),
                "//server/share/file.fig"
            );
            assert_eq!(
                path_identity_key(Path::new(r"\\?\UNC\Server\Share\dir")),
                "//Server/Share/dir"
            );
        }
    }

    #[test]
    fn lexical_keys_preserve_case_when_volume_semantics_are_unproven() {
        #[cfg(target_os = "macos")]
        {
            assert_eq!(
                path_identity_key(Path::new("/Users/Joey/File.txt")),
                "/Users/Joey/File.txt"
            );
        }
        #[cfg(target_os = "linux")]
        {
            assert_eq!(
                path_identity_key(Path::new("/Users/Joey/File.txt")),
                "/Users/Joey/File.txt"
            );
        }
    }

    #[test]
    fn collapses_slashes_and_strips_trailing_slash_respecting_case_sensitivity() {
        #[cfg(target_os = "macos")]
        {
            assert_eq!(
                path_identity_key(Path::new("/Users/Joey//File.txt/")),
                "/Users/Joey/File.txt"
            );
        }
        #[cfg(target_os = "linux")]
        {
            assert_eq!(
                path_identity_key(Path::new("/Users/Joey//File.txt/")),
                "/Users/Joey/File.txt"
            );
        }
    }

    #[test]
    fn posix_preserves_backslash_as_legal_filename_character() {
        // Backslash is a legal filename character on POSIX filesystems and must
        // not be treated as a path separator. Lexical identity preserves case;
        // existing paths use physical-file proof when representations differ.
        #[cfg(target_os = "macos")]
        {
            assert_eq!(
                path_identity_key(Path::new("/Users/joeyc/my\\file.fig")),
                "/Users/joeyc/my\\file.fig"
            );
        }
        #[cfg(target_os = "linux")]
        {
            assert_eq!(
                path_identity_key(Path::new("/Users/joeyc/my\\file.fig")),
                "/Users/joeyc/my\\file.fig"
            );
        }
    }

    #[test]
    fn native_identity_proves_hardlink_aliases_without_conflating_distinct_files() {
        static NEXT_DIRECTORY: AtomicUsize = AtomicUsize::new(0);
        let directory = std::env::temp_dir().join(format!(
            "open-pencil-same-file-{}-{}",
            std::process::id(),
            NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&directory).expect("create identity test directory");
        let original = directory.join("original.fig");
        let alias = directory.join("alias.fig");
        let distinct = directory.join("distinct.fig");
        fs::write(&original, b"original").expect("write original file");
        fs::hard_link(&original, &alias).expect("create hardlink alias");
        fs::write(&distinct, b"distinct").expect("write distinct file");

        let same = is_same_existing_native_file(
            original.to_string_lossy().into_owned(),
            alias.to_string_lossy().into_owned(),
        );
        let different = is_same_existing_native_file(
            original.to_string_lossy().into_owned(),
            distinct.to_string_lossy().into_owned(),
        );
        let pending = vec![PendingOpenFile {
            path: original.to_string_lossy().into_owned(),
        }];
        let alias_is_pending = pending_contains_equivalent_path(&pending, &alias);
        let distinct_is_pending = pending_contains_equivalent_path(&pending, &distinct);
        let _ = fs::remove_dir_all(directory);

        assert_eq!(same, Some(true));
        assert_eq!(different, Some(false));
        assert!(alias_is_pending);
        assert!(!distinct_is_pending);
    }

    #[cfg(unix)]
    #[test]
    fn non_utf_paths_are_not_serialized_as_pending_identity() {
        use std::{ffi::OsString, os::unix::ffi::OsStringExt, path::PathBuf};

        let path = PathBuf::from(OsString::from_vec(b"/tmp/design-\xff.fig".to_vec()));
        assert_eq!(pending_path_string(&path), None);
    }
}
