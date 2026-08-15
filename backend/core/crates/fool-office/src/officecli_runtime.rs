//! Finding the officecli binary this application ships with.
//!
//! It used to be found on `PATH`, and when it was not there the application
//! downloaded a script from the internet and executed it — `irm … | iex` on
//! Windows, `curl … | bash` elsewhere. Three things were wrong with that, and
//! the third is the one that matters:
//!
//! 1. Nothing was pinned. Whatever the mirror served that day became the tool.
//! 2. Nothing was verified. The script was executed on the strength of the
//!    address it came from.
//! 3. It did not work offline, and it did not work behind a proxy that rewrites
//!    TLS. So the Office half of this product was a capability that might or
//!    might not exist on any given machine — while ten builtin skills and six
//!    assistants described it to the model as something it could do.
//!
//! OfficeCLI is Apache-2.0 and publishes self-contained native binaries, so the
//! honest arrangement is to ship one. `scripts/fetch-officecli.mjs` downloads a
//! pinned version, checks it against a recorded SHA-256, and puts it where
//! electron-builder will package it; the application then tells this crate where
//! it landed through `FOOL_OFFICECLI_PATH`.
//!
//! **Nothing here downloads or executes anything.** If the binary is missing,
//! that is reported as missing. A tool that is not there must not be described
//! to a model as one that is.

use std::ffi::OsStr;
use std::path::PathBuf;

use fool_runtime::resolve_command_path;

/// Where the packaged application says it put the binary.
///
/// Set by the Electron main process at spawn time, because only it knows
/// `process.resourcesPath` — that path differs between a development run, an
/// installed application and a portable one, and guessing it from this side
/// would be three guesses that each break separately.
pub(crate) const OFFICECLI_PATH_ENV: &str = "FOOL_OFFICECLI_PATH";

/// Where release notes live, for a version check that only reports.
pub(crate) const OFFICECLI_LATEST_RELEASE_URL: &str = "https://github.com/iOfficeAI/OfficeCli/releases/latest";

/// The binary to run, in the order worth trying.
///
/// The bundled one wins. A copy on `PATH` is whatever the user installed for
/// themselves, possibly years old and possibly a different major version, and
/// silently preferring it would make this application's behaviour depend on
/// something nobody here chose.
pub(crate) fn resolve_officecli_path() -> Option<PathBuf> {
    bundled_officecli_path()
        .or_else(|| resolve_command_path("officecli"))
        .or_else(resolve_known_officecli_install_path)
}

fn bundled_officecli_path() -> Option<PathBuf> {
    bundled_officecli_path_from_env(std::env::var_os(OFFICECLI_PATH_ENV).as_deref())
}

pub(crate) fn bundled_officecli_path_from_env(configured: Option<&OsStr>) -> Option<PathBuf> {
    let path = PathBuf::from(configured?);
    // Checked rather than trusted. A stale variable pointing at a file that was
    // moved by an upgrade would otherwise take precedence over a working copy
    // on PATH and turn a working install into a broken one.
    path.is_file().then_some(path)
}

fn resolve_known_officecli_install_path() -> Option<PathBuf> {
    resolve_known_officecli_install_path_from_env(
        std::env::var_os("HOME").as_deref(),
        std::env::var_os("LOCALAPPDATA").as_deref(),
    )
}

fn resolve_known_officecli_install_path_from_env(
    home: Option<&OsStr>,
    local_app_data: Option<&OsStr>,
) -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(local_app_data) = local_app_data {
        candidates.push(PathBuf::from(local_app_data).join("OfficeCli").join("officecli.exe"));
    }

    if let Some(home) = home {
        candidates.push(PathBuf::from(home).join(".local").join("bin").join("officecli"));
    }

    candidates.into_iter().find(|path| path.is_file())
}

#[cfg(test)]
#[path = "officecli_runtime_test.rs"]
mod officecli_runtime_test;

#[cfg(test)]
pub(crate) fn resolve_officecli_path_from_env_for_test(
    bundled: Option<&OsStr>,
    path_env: Option<&OsStr>,
    home: Option<&std::path::Path>,
    local_app_data: Option<&std::path::Path>,
) -> Option<PathBuf> {
    bundled_officecli_path_from_env(bundled)
        .or_else(|| find_officecli_in_path(path_env))
        .or_else(|| {
            resolve_known_officecli_install_path_from_env(
                home.map(std::path::Path::as_os_str),
                local_app_data.map(std::path::Path::as_os_str),
            )
        })
}

#[cfg(test)]
fn find_officecli_in_path(path_env: Option<&OsStr>) -> Option<PathBuf> {
    let path_env = path_env?;
    for dir in std::env::split_paths(path_env) {
        let candidate = dir.join("officecli");
        if candidate.is_file() {
            return Some(candidate);
        }

        #[cfg(windows)]
        {
            let candidate = dir.join("officecli.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}
