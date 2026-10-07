//! Private, session-owned CLI input files. Never trust the shared OS temp root.
use std::{collections::HashMap, path::{Path, PathBuf}, sync::{Mutex, OnceLock}};

static ROOTS: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();

pub fn folder(base: &Path, session: &str) -> Result<PathBuf, String> {
    if session.is_empty() { return Err("Session identity required".into()); }
    let mut roots = ROOTS.get_or_init(Default::default).lock().map_err(|_| "Input folders unavailable")?;
    if let Some(root) = roots.get(session) {
        if root.canonicalize().is_ok_and(|current| current == *root) { return Ok(root.clone()); }
        return Err("Session input folder identity changed".into());
    }
    std::fs::create_dir_all(base).map_err(|e| e.to_string())?;
    let base = base.canonicalize().map_err(|e| e.to_string())?;
    let root = base.join(format!("mono-input-{}", uuid::Uuid::new_v4()));
    create_private(&root).map_err(|e| e.to_string())?;
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    if root.parent() != Some(base.as_path()) { return Err("Input folder escaped app data".into()); }
    roots.insert(session.into(), root.clone());
    Ok(root)
}

pub fn allows(path: &Path, session: &str) -> bool {
    let Some(roots) = ROOTS.get() else { return false; };
    let Ok(roots) = roots.lock() else { return false; };
    let Some(root) = roots.get(session) else { return false; };
    let (Ok(current), Ok(path)) = (root.canonicalize(), path.canonicalize()) else { return false; };
    current == *root && path != *root && path.starts_with(root) && path.is_file()
}

pub fn remove(session: &str) {
    let Some(roots) = ROOTS.get() else { return; };
    let Ok(mut roots) = roots.lock() else { return; };
    let Some(root) = roots.remove(session) else { return; };
    // Only this exact randomly named, app-created folder; never follow a replaced root.
    if root.file_name().is_some_and(|name| name.to_string_lossy().starts_with("mono-input-"))
        && root.canonicalize().is_ok_and(|current| current == root) {
        if let Err(error) = std::fs::remove_dir_all(&root) { eprintln!("Session input cleanup failed: {error}"); }
    }
}

#[cfg(unix)]
fn create_private(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    std::fs::DirBuilder::new().mode(0o700).create(path)
}

#[cfg(windows)]
fn create_private(path: &Path) -> std::io::Result<()> {
    use std::{os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, LocalFree},
        Security::{Authorization::{ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1}, GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER, SECURITY_ATTRIBUTES},
        Storage::FileSystem::CreateDirectoryW,
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    };
    unsafe {
        let mut token = ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 { return Err(std::io::Error::last_os_error()); }
        let mut size = 0;
        GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut size);
        let mut data = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
        let ok = GetTokenInformation(token, TokenUser, data.as_mut_ptr().cast(), size, &mut size);
        CloseHandle(token);
        if ok == 0 { return Err(std::io::Error::last_os_error()); }
        let mut sid = ptr::null_mut();
        if ConvertSidToStringSidW((*(data.as_ptr().cast::<TOKEN_USER>())).User.Sid, &mut sid) == 0 { return Err(std::io::Error::last_os_error()); }
        let mut len = 0; while *sid.add(len) != 0 { len += 1; }
        let sid_text = String::from_utf16_lossy(std::slice::from_raw_parts(sid, len));
        LocalFree(sid.cast());
        // Protected DACL: only the current user, inherited by child files/folders.
        let sddl: Vec<u16> = format!("O:{sid_text}D:P(A;OICI;FA;;;{sid_text})").encode_utf16().chain(Some(0)).collect();
        let mut descriptor = ptr::null_mut();
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), SDDL_REVISION_1, &mut descriptor, ptr::null_mut()) == 0 { return Err(std::io::Error::last_os_error()); }
        let attributes = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: descriptor, bInheritHandle: 0 };
        let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let ok = CreateDirectoryW(path.as_ptr(), &attributes);
        let error = std::io::Error::last_os_error();
        LocalFree(descriptor);
        if ok == 0 { Err(error) } else { Ok(()) }
    }
}

#[cfg(not(any(unix, windows)))]
fn create_private(_: &Path) -> std::io::Result<()> {
    Err(std::io::Error::other("Owner-only input folders are unsupported"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inputs_require_their_private_session_root_and_cleanup_revokes_it() {
        let base = std::env::temp_dir().join(format!("mono-input-test-{}", uuid::Uuid::new_v4()));
        let a = folder(&base, "private-input-a").unwrap();
        let b = folder(&base, "private-input-b").unwrap();
        let own = a.join("own.json");
        let outside = base.join("shared.json");
        std::fs::write(&own, "{}").unwrap();
        std::fs::write(&outside, "{}").unwrap();
        assert!(allows(&own, "private-input-a"));
        assert!(!allows(&own, "private-input-b"));
        assert!(!allows(&outside, "private-input-a"));
        assert!(!allows(&std::env::temp_dir(), "private-input-a"));
        #[cfg(unix)] {
            use std::os::unix::fs::{symlink, PermissionsExt};
            assert_eq!(std::fs::metadata(&a).unwrap().permissions().mode() & 0o777, 0o700);
            let link = a.join("escape.json");
            symlink(&outside, &link).unwrap();
            assert!(!allows(&link, "private-input-a"));
        }
        #[cfg(windows)] {
            // Junctions do not require Developer Mode or symlink privileges.
            let junction = a.join("escape");
            let status = std::process::Command::new(std::env::var_os("ComSpec").unwrap_or_else(|| "cmd.exe".into()))
                .args(["/d", "/c", "mklink", "/J"]).arg(&junction).arg(&b).output().unwrap();
            assert!(status.status.success());
            std::fs::write(b.join("other.json"), "{}").unwrap();
            assert!(!allows(&junction.join("other.json"), "private-input-a"));
            std::fs::remove_dir(junction).unwrap();
        }
        remove("private-input-a"); remove("private-input-b");
        assert!(!a.exists()); assert!(!b.exists());
        assert!(outside.exists());
        assert!(!allows(&own, "private-input-a"));
        std::fs::remove_file(outside).unwrap(); std::fs::remove_dir(base).unwrap();
    }
}
