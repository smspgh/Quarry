//! Creating a GitHub repository, GitHub accounts and a remote's Private / Public badge. Spec: specs/git.md.

use super::{blocking, exec, git, run, run_text, Output};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

// ---------- creating a GitHub repository ----------

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepo {
    /// `owner/name`.
    pub full_name: String,
    pub clone_url: String,
    pub html_url: String,
    /// The account already had a repository with this name (nothing was created).
    pub existed: bool,
    /// It has no commits yet (always true for a new one).
    pub empty: bool,
    pub private: bool,
}

const GITHUB_API: &str = "https://api.github.com";

/// GitHub's own rule for repository names.
fn valid_repo_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 100 && name != "." && name != ".." && name.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
}

/// `key=value` lines of the git credential protocol.
fn credential_field<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    text.lines().find_map(|l| l.strip_prefix(key)?.strip_prefix('='))
}

/// `git credential <action>`; the credential goes on stdin, never the command line.
fn credential(root: &Path, action: &str, input: &str) -> Result<Output, String> {
    let mut cmd = git(root, true);
    cmd.args(["credential", action]);
    exec(cmd, Some(input.as_bytes().to_vec()))
}

/// A stored github.com token for `account`, without ever showing a sign-in window (None if there
/// is none).
fn stored_github_token(root: &Path, account: &str) -> Option<String> {
    if account.is_empty() || account.contains(['\n', '\r']) {
        return None;
    }
    let mut cmd = git(root, true);
    cmd.args(["credential", "fill"]).env("GCM_INTERACTIVE", "never");
    let out = exec(cmd, Some(format!("protocol=https\nhost=github.com\nusername={account}\n\n").into_bytes())).ok()?;
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    credential_field(&text, "password").filter(|t| out.ok && !t.is_empty()).map(str::to_string)
}

/// Windows' own curl (not Git's or another one on PATH).
fn curl() -> Command {
    let sys = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let exe = sys.join("System32").join("curl.exe");
    let mut cmd = Command::new(if exe.is_file() { exe } else { PathBuf::from("curl") });
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

enum CreateError {
    /// GitHub turned the token down (401): forget it so the next try signs in again.
    Unauthorized,
    Other(String),
}

/// One GitHub API call with `token` ("" for none): (HTTP status, JSON body). The token reaches
/// curl through its config on stdin, so it is never on a command line.
fn github_api(api: &str, token: &str, method: &str, path: &str, body: Option<&str>) -> Result<(u16, serde_json::Value), CreateError> {
    let mut cmd = curl();
    cmd.args(["-sS", "--max-time", "60", "-K", "-", "-X", method]);
    cmd.args(["-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2022-11-28"]);
    if let Some(body) = body {
        cmd.args(["-H", "Content-Type: application/json", "--data-raw", body]);
    }
    cmd.args(["-w", "\n%{http_code}", &format!("{api}{path}")]);
    let config = if token.is_empty() { String::new() } else { format!("header = \"Authorization: Bearer {token}\"\n") };
    let out = exec(cmd, Some(config.into_bytes())).map_err(|e| CreateError::Other(e.replace("git", "curl")))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let (json, code) = text.rsplit_once('\n').unwrap_or(("", &text));
    let code: u16 = code.trim().parse().unwrap_or(0);
    if code == 0 || !out.ok {
        return Err(CreateError::Other(format!("could not reach GitHub: {}", if out.stderr.is_empty() { "no response" } else { &out.stderr })));
    }
    if code == 401 {
        return Err(CreateError::Unauthorized);
    }
    Ok((code, serde_json::from_str(json).unwrap_or(serde_json::Value::Null)))
}

fn repo_from(v: &serde_json::Value, existed: bool) -> GithubRepo {
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    // `size` (KB) is 0 until the first push.
    let empty = !existed || v.get("size").and_then(|x| x.as_u64()) == Some(0);
    let private = v.get("private").and_then(|x| x.as_bool()).unwrap_or(false);
    GithubRepo { full_name: s("full_name"), clone_url: s("clone_url"), html_url: s("html_url"), existed, empty, private }
}

/// `(owner, name)` of a github.com remote URL (https or ssh), or None for any other host.
fn github_slug(url: &str) -> Option<(String, String)> {
    let u = url.trim();
    let at = u.find("github.com")?;
    // github.com itself, not e.g. notgithub.com: preceded by "//" or "user@".
    if !(u[..at].ends_with("//") || u[..at].ends_with('@')) {
        return None;
    }
    let rest = &u[at + "github.com".len()..];
    let rest = rest.strip_prefix(':').or_else(|| rest.strip_prefix('/'))?.trim_end_matches('/');
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let (owner, name) = rest.split_once('/')?;
    let owner_ok = !owner.is_empty() && owner.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
    (owner_ok && valid_repo_name(name)).then(|| (owner.to_string(), name.to_string()))
}

/// GET /repos/{owner}/{name}: the repository, or None when this token (or none) can't see it.
fn repo_info_request(api: &str, token: &str, owner: &str, name: &str) -> Result<Option<GithubRepo>, String> {
    match github_api(api, token, "GET", &format!("/repos/{owner}/{name}"), None) {
        Ok((200, v)) => Ok(Some(repo_from(&v, true))),
        Ok(_) | Err(CreateError::Unauthorized) => Ok(None),
        Err(CreateError::Other(e)) => Err(e),
    }
}

/// A github.com remote's repository (for its Private / Public badge), with `account`'s stored
/// sign-in when there is one, else without any (which only sees public repositories). Never opens
/// a sign-in window. None for other hosts or a repository that can't be seen.
fn github_repo_info(root: &Path, url: &str, account: Option<&str>) -> Result<Option<GithubRepo>, String> {
    let Some((owner, name)) = github_slug(url) else { return Ok(None) };
    if let Some(token) = account.and_then(|a| stored_github_token(root, a.trim()))
        && let Some(repo) = repo_info_request(GITHUB_API, &token, &owner, &name)?
    {
        return Ok(Some(repo));
    }
    repo_info_request(GITHUB_API, "", &owner, &name)
}

/// The signed-in account's repository `name`, when there is one.
fn existing_repo(api: &str, token: &str, name: &str) -> Option<GithubRepo> {
    let (code, user) = github_api(api, token, "GET", "/user", None).ok()?;
    let login = user.get("login")?.as_str().filter(|_| code == 200)?.to_string();
    let (code, v) = github_api(api, token, "GET", &format!("/repos/{login}/{name}"), None).ok()?;
    (code == 200).then(|| repo_from(&v, true))
}

/// POST /user/repos. When the name is taken on the account, that repository is returned instead
/// (`existed`), for the caller to offer.
fn create_repo_request(api: &str, token: &str, name: &str, private: bool) -> Result<GithubRepo, CreateError> {
    let body = serde_json::json!({ "name": name, "private": private }).to_string();
    let (code, v) = github_api(api, token, "POST", "/user/repos", Some(&body))?;
    if code == 201 {
        return Ok(repo_from(&v, false));
    }
    // 422 explains itself in `errors` ("name already exists on this account").
    let detail = v.get("errors").and_then(|e| e.as_array()).and_then(|a| a.iter().find_map(|e| e.get("message")?.as_str())).map(str::to_string);
    let msg = detail.unwrap_or_else(|| v.get("message").and_then(|m| m.as_str()).unwrap_or("").to_string());
    if code == 422
        && msg.contains("already exists")
        && let Some(repo) = existing_repo(api, token, name)
    {
        return Ok(repo);
    }
    Err(CreateError::Other(match code {
        403 | 404 => format!("GitHub refused to create the repository ({code}: {msg}). Your sign-in may not be allowed to create repositories."),
        _ => format!("GitHub could not create the repository ({code}): {msg}"),
    }))
}

/// Accounts in `git credential-manager github list` output, one per line.
fn account_lines(text: &str) -> Vec<String> {
    text.lines().map(str::trim).filter(|l| !l.is_empty()).map(str::to_string).collect()
}

/// The GitHub accounts Git Credential Manager is signed in to (no window, no network). An error
/// when GCM isn't there (Git without it, or another credential helper).
fn github_accounts(root: &Path) -> Result<Vec<String>, String> {
    Ok(account_lines(&run_text(root, true, &["credential-manager", "github", "list"])?))
}

/// Sign in to (another) GitHub account in Git Credential Manager's own window; the accounts after.
fn github_login(root: &Path) -> Result<Vec<String>, String> {
    run(root, false, &["credential-manager", "github", "login"], None)?;
    github_accounts(root)
}

/// Create a repository on a GitHub account (`account`, or the one Git Credential Manager picks),
/// with the sign-in Git already keeps for github.com (GCM opens its sign-in window when there is none).
fn github_create(root: &Path, name: &str, private: bool, account: Option<&str>) -> Result<GithubRepo, String> {
    let name = name.trim();
    if !valid_repo_name(name) {
        return Err("a GitHub repository name can only use letters, digits, '-', '_' and '.'".into());
    }
    let user = account.map(str::trim).filter(|a| !a.is_empty() && !a.contains(['\n', '\r'])).map(|a| format!("username={a}\n")).unwrap_or_default();
    let ask = format!("protocol=https\nhost=github.com\n{user}\n");
    let filled = credential(root, "fill", &ask)?;
    let cred = String::from_utf8_lossy(&filled.stdout).into_owned();
    let Some(token) = credential_field(&cred, "password").filter(|t| filled.ok && !t.is_empty()) else {
        return Err(format!("no GitHub sign-in: {}", if filled.stderr.is_empty() { "Git Credential Manager did not return one" } else { &filled.stderr }));
    };
    // The protocol's answer, ending in a blank line, is what approve / reject take back.
    let back = format!("{}\n\n", cred.trim_end());
    match create_repo_request(GITHUB_API, token, name, private) {
        Ok(repo) => {
            let _ = credential(root, "approve", &back);
            Ok(repo)
        }
        Err(CreateError::Unauthorized) => {
            let _ = credential(root, "reject", &back);
            Err("GitHub did not accept your sign-in. Try again to sign in afresh.".into())
        }
        Err(CreateError::Other(e)) => Err(e),
    }
}

// ---------- commands ----------

#[tauri::command]
pub async fn github_create_repo(root: String, name: String, private: bool, account: Option<String>) -> Result<GithubRepo, String> {
    blocking(move || github_create(Path::new(&root), &name, private, account.as_deref())).await
}

#[tauri::command]
pub async fn github_repo(root: String, url: String, account: Option<String>) -> Result<Option<GithubRepo>, String> {
    blocking(move || github_repo_info(Path::new(&root), &url, account.as_deref())).await
}

#[tauri::command]
pub async fn github_accounts_list(root: String) -> Result<Vec<String>, String> {
    blocking(move || github_accounts(Path::new(&root))).await
}

#[tauri::command]
pub async fn github_sign_in(root: String) -> Result<Vec<String>, String> {
    blocking(move || github_login(Path::new(&root))).await
}

#[cfg(test)]
mod tests {
    use super::super::*;
    use super::*;

    #[test]
    fn github_repo_names_and_credential_fields() {
        assert!(valid_repo_name("my-repo_1.x"));
        for bad in ["", ".", "..", "has space", "a/b", "ü"] {
            assert!(!valid_repo_name(bad), "{bad}");
        }
        let cred = "protocol=https\nhost=github.com\nusername=ada\npassword=gho_abc=def\n";
        assert_eq!(credential_field(cred, "username"), Some("ada"));
        assert_eq!(credential_field(cred, "password"), Some("gho_abc=def"));
        assert_eq!(credential_field(cred, "path"), None);
        assert_eq!(account_lines("smspgh\r\n\r\nada\n"), vec!["smspgh", "ada"]);
    }

    /// HTTP exchanges on a local port, one connection per answer, in order: returns the requests
    /// as received (request line, headers, body).
    fn fake_github(answers: Vec<(&'static str, &'static str)>) -> (String, std::thread::JoinHandle<Vec<String>>) {
        use std::io::Read;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let api = format!("http://{}", listener.local_addr().unwrap());
        let h = std::thread::spawn(move || {
            let mut seen = Vec::new();
            for (status, body) in answers {
                let (mut s, _) = listener.accept().unwrap();
                let mut req = Vec::new();
                let mut buf = [0u8; 4096];
                // Read the headers, then the body by Content-Length.
                loop {
                    let n = s.read(&mut buf).unwrap();
                    req.extend_from_slice(&buf[..n]);
                    let text = String::from_utf8_lossy(&req).to_string();
                    if let Some(i) = text.find("\r\n\r\n") {
                        let len = text.lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap())).unwrap_or(0);
                        if req.len() >= i + 4 + len {
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                let resp = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                s.write_all(resp.as_bytes()).unwrap();
                seen.push(String::from_utf8_lossy(&req).into_owned());
            }
            seen
        });
        (api, h)
    }

    const TAKEN: &str = r#"{"message":"Repository creation failed.","errors":[{"message":"name already exists on this account"}]}"#;

    #[test]
    fn github_create_request_sends_the_token_and_reads_the_answer() {
        let (api, h) = fake_github(vec![("201 Created", r#"{"full_name":"ada/demo","clone_url":"https://github.com/ada/demo.git","html_url":"https://github.com/ada/demo"}"#)]);
        let repo = create_repo_request(&api, "tok123", "demo", true).ok().unwrap();
        assert_eq!(repo, GithubRepo { full_name: "ada/demo".into(), clone_url: "https://github.com/ada/demo.git".into(), html_url: "https://github.com/ada/demo".into(), existed: false, empty: true, private: false });
        let req = &h.join().unwrap()[0];
        assert!(req.starts_with("POST /user/repos "), "{req}");
        assert!(req.contains("Authorization: Bearer tok123\r\n"), "{req}");
        assert!(req.ends_with(r#"{"name":"demo","private":true}"#), "{req}");

        let (api, h) = fake_github(vec![("401 Unauthorized", r#"{"message":"Bad credentials"}"#)]);
        assert!(matches!(create_repo_request(&api, "t", "demo", false), Err(CreateError::Unauthorized)));
        h.join().unwrap();

        let (api, h) = fake_github(vec![("422 Unprocessable Entity", r#"{"message":"Validation Failed","errors":[{"message":"name is too long"}]}"#)]);
        match create_repo_request(&api, "t", "demo", false) {
            Err(CreateError::Other(e)) => assert!(e.contains("name is too long"), "{e}"),
            _ => panic!("expected an error"),
        }
        h.join().unwrap();
    }

    #[test]
    fn a_taken_github_name_returns_the_existing_repository() {
        let (api, h) = fake_github(vec![
            ("422 Unprocessable Entity", TAKEN),
            ("200 OK", r#"{"login":"ada"}"#),
            ("200 OK", r#"{"full_name":"ada/demo","clone_url":"https://github.com/ada/demo.git","html_url":"https://github.com/ada/demo","size":0}"#),
        ]);
        let repo = create_repo_request(&api, "t", "demo", true).ok().unwrap();
        assert!(repo.existed && repo.empty);
        assert_eq!(repo.clone_url, "https://github.com/ada/demo.git");
        let reqs = h.join().unwrap();
        assert!(reqs[1].starts_with("GET /user "), "{}", reqs[1]);
        assert!(reqs[2].starts_with("GET /repos/ada/demo "), "{}", reqs[2]);

        // One with commits is offered too, marked not empty.
        let (api, h) = fake_github(vec![("422 Unprocessable Entity", TAKEN), ("200 OK", r#"{"login":"ada"}"#), ("200 OK", r#"{"full_name":"ada/demo","clone_url":"u","html_url":"w","size":12}"#)]);
        let repo = create_repo_request(&api, "t", "demo", true).ok().unwrap();
        assert!(repo.existed && !repo.empty);
        h.join().unwrap();

        // If it can't be looked up, the original message stays.
        let (api, h) = fake_github(vec![("422 Unprocessable Entity", TAKEN), ("200 OK", r#"{"login":"ada"}"#), ("404 Not Found", r#"{"message":"Not Found"}"#)]);
        match create_repo_request(&api, "t", "demo", false) {
            Err(CreateError::Other(e)) => assert!(e.contains("name already exists"), "{e}"),
            _ => panic!("expected an error"),
        }
        h.join().unwrap();
    }

    #[test]
    fn github_slugs_come_only_from_github_urls() {
        let slug = |u| github_slug(u).map(|(o, n)| format!("{o}/{n}"));
        assert_eq!(slug("https://github.com/smspgh/Quarry.git").as_deref(), Some("smspgh/Quarry"));
        assert_eq!(slug("https://ada@github.com/ada/demo/").as_deref(), Some("ada/demo"));
        assert_eq!(slug("git@github.com:ada/demo.git").as_deref(), Some("ada/demo"));
        assert_eq!(slug("ssh://git@github.com/ada/demo").as_deref(), Some("ada/demo"));
        for other in ["https://notgithub.com/a/b", "https://gitlab.com/a/b", "C:\\repos\\demo.git", "https://github.com/a", "https://github.com/a/b/c"] {
            assert_eq!(slug(other), None, "{other}");
        }
    }

    #[test]
    fn repo_info_reads_visibility_and_tolerates_unseen_repos() {
        let (api, h) = fake_github(vec![("200 OK", r#"{"full_name":"ada/demo","clone_url":"u","html_url":"w","size":3,"private":true}"#)]);
        let repo = repo_info_request(&api, "tok", "ada", "demo").unwrap().unwrap();
        assert!(repo.private && !repo.empty);
        let req = &h.join().unwrap()[0];
        assert!(req.starts_with("GET /repos/ada/demo "), "{req}");
        assert!(req.contains("Authorization: Bearer tok\r\n"), "{req}");

        // No token: no Authorization header at all; a 404 (private, or gone) is just "unknown".
        let (api, h) = fake_github(vec![("404 Not Found", r#"{"message":"Not Found"}"#)]);
        assert_eq!(repo_info_request(&api, "", "ada", "demo").unwrap(), None);
        let req = &h.join().unwrap()[0];
        assert!(!req.to_ascii_lowercase().contains("authorization"), "{req}");
    }
}
