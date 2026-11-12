//! Lazy JSON tree for large files. One container's children are listed straight from the bytes
//! (the memory mapping), a page at a time, so the tree of a file of any size needs no index and
//! almost no memory: expanding a node reads only that node.
//!
//! Each listed child is skipped over to find the next one, which also yields its byte range and,
//! for objects and arrays, its child count. Strict JSON plus what JSONC adds (comments, trailing
//! commas); anything malformed is reported with its byte offset rather than guessed around.

use serde::Serialize;

pub type Kind = &'static str;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    /// Object member name; `None` for array items and the root.
    pub key: Option<String>,
    /// Position among its siblings (array index, or member order for objects).
    pub index: u64,
    /// "object" | "array" | "string" | "number" | "boolean" | "null"
    pub kind: Kind,
    /// Short display text: the value for scalars, "{…}" / "[…]" (or "{}" / "[]") for containers.
    pub preview: String,
    /// Byte offset where the value starts.
    pub start: u64,
    /// Byte offset just past the value (`None` for the root, which is never skipped over).
    pub end: Option<u64>,
    /// Number of members / items of an object or array (`None` for scalars and the root).
    pub count: Option<u64>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TreePage {
    pub nodes: Vec<TreeNode>,
    /// Where to resume listing (pass as `resume`), when the container has more children.
    pub next: Option<u64>,
}

/// A problem at a byte offset.
pub type Fail = (u64, String);
type Res<T> = Result<T, Fail>;

const PREVIEW_BYTES: usize = 160;

fn fail<T>(at: usize, msg: impl Into<String>) -> Res<T> {
    Err((at as u64, msg.into()))
}

/// Skip whitespace and comments.
fn skip_ws(b: &[u8], mut i: usize) -> Res<usize> {
    loop {
        match b.get(i) {
            Some(b' ' | b'\t' | b'\n' | b'\r') => i += 1,
            Some(b'/') if b.get(i + 1) == Some(&b'/') => match memchr::memchr(b'\n', &b[i..]) {
                Some(n) => i += n + 1,
                None => return Ok(b.len()),
            },
            Some(b'/') if b.get(i + 1) == Some(&b'*') => match memchr::memmem::find(&b[i + 2..], b"*/") {
                Some(n) => i += n + 4,
                None => return fail(i, "unterminated comment"),
            },
            _ => return Ok(i),
        }
    }
}

/// `i` is at an opening quote; returns the offset just past the closing quote.
fn skip_string(b: &[u8], mut i: usize) -> Res<usize> {
    let open = i;
    i += 1;
    loop {
        // A trailing backslash skips past the end: that is an unterminated string, not a panic.
        let Some(rest) = b.get(i..) else { return fail(open, "unterminated string") };
        match memchr::memchr2(b'"', b'\\', rest) {
            Some(n) if b[i + n] == b'"' => return Ok(i + n + 1),
            Some(n) => i += n + 2,
            None => return fail(open, "unterminated string"),
        }
    }
}

/// `i` is at a value; returns the offset just past it and, for a container, its child count.
fn skip_value(b: &[u8], i: usize) -> Res<(usize, Option<u64>)> {
    match b.get(i) {
        Some(b'"') => Ok((skip_string(b, i)?, None)),
        Some(b'{' | b'[') => {
            // Depth-counting scan; strings are skipped whole so their brackets don't count.
            let (mut j, mut depth, mut count, mut item) = (i, 0usize, 0u64, false);
            loop {
                match b.get(j) {
                    None => return fail(i, "unterminated object or array"),
                    Some(b'"') => {
                        if depth == 1 {
                            item = true;
                        }
                        j = skip_string(b, j)?;
                        continue;
                    }
                    Some(b'{' | b'[') => {
                        if depth == 1 {
                            item = true;
                        }
                        depth += 1;
                    }
                    Some(b'}' | b']') => {
                        if depth == 1 {
                            return Ok((j + 1, Some(count + item as u64)));
                        }
                        depth -= 1;
                    }
                    Some(b',') if depth == 1 => {
                        count += item as u64;
                        item = false;
                    }
                    Some(b'/') if matches!(b.get(j + 1), Some(b'/' | b'*')) => {
                        j = skip_ws(b, j)?;
                        continue;
                    }
                    Some(b' ' | b'\t' | b'\n' | b'\r' | b':' | b',') => {}
                    Some(_) => {
                        if depth == 1 {
                            item = true;
                        }
                    }
                }
                j += 1;
            }
        }
        Some(c) if c.is_ascii_digit() || *c == b'-' || matches!(c, b't' | b'f' | b'n') => {
            let n = b[i..].iter().position(|c| matches!(c, b',' | b'}' | b']' | b' ' | b'\t' | b'\n' | b'\r' | b'/')).unwrap_or(b.len() - i);
            Ok((i + n, None))
        }
        Some(_) => fail(i, "expected a value"),
        None => fail(i, "unexpected end of file"),
    }
}

fn kind_of(b: &[u8], i: usize) -> Kind {
    match b.get(i) {
        Some(b'{') => "object",
        Some(b'[') => "array",
        Some(b'"') => "string",
        Some(b't' | b'f') => "boolean",
        Some(b'n') => "null",
        _ => "number",
    }
}

fn preview(b: &[u8], start: usize, end: Option<usize>, count: Option<u64>) -> String {
    match b.get(start) {
        Some(b'{') => if count == Some(0) { "{}".into() } else { "{…}".into() },
        Some(b'[') => if count == Some(0) { "[]".into() } else { "[…]".into() },
        _ => {
            let end = end.unwrap_or(b.len()).min(b.len());
            let cut = (start + PREVIEW_BYTES).min(end);
            let mut s = String::from_utf8_lossy(&b[start..cut]).into_owned();
            if cut < end {
                s.push('…');
            }
            s
        }
    }
}

/// An object key as text (escapes decoded); falls back to the raw text for odd escapes.
fn key_text(raw: &[u8]) -> String {
    serde_json::from_slice::<String>(raw).unwrap_or_else(|_| String::from_utf8_lossy(&raw[1..raw.len().saturating_sub(1)]).into_owned())
}

/// The top-level value (after a byte-order mark and whitespace).
pub fn root(b: &[u8]) -> Res<TreeNode> {
    let i = if b.starts_with(&[0xEF, 0xBB, 0xBF]) { 3 } else { 0 };
    let i = skip_ws(b, i)?;
    if i >= b.len() {
        return fail(i, "the file is empty");
    }
    let kind = kind_of(b, i);
    // Scalars are skipped (they are short); a container root is not, it may be the whole file.
    let end = if matches!(kind, "object" | "array") { None } else { Some(skip_value(b, i)?.0) };
    Ok(TreeNode { key: None, index: 0, kind, preview: preview(b, i, end, None), start: i as u64, end: end.map(|e| e as u64), count: None })
}

/// The number of children of the object or array at `start` (reads all of it: for the root of a
/// big file this is the one slow call, so the UI runs it in the background).
pub fn count(b: &[u8], start: u64) -> Res<u64> {
    match skip_value(b, start as usize)? {
        (_, Some(n)) => Ok(n),
        _ => fail(start as usize, "not an object or array"),
    }
}

/// Up to `limit` children of the object or array starting at `start`, beginning at `resume` (a
/// `next` from an earlier page; `None` for the first page) with sibling number `first_index`.
pub fn children(b: &[u8], start: u64, resume: Option<u64>, first_index: u64, limit: usize) -> Res<TreePage> {
    let start = start as usize;
    let (is_obj, close) = match b.get(start) {
        Some(b'{') => (true, b'}'),
        Some(b'[') => (false, b']'),
        _ => return fail(start, "not an object or array"),
    };
    let mut i = resume.map(|r| r as usize).unwrap_or(start + 1);
    let mut nodes = Vec::new();
    let mut index = first_index;
    loop {
        i = skip_ws(b, i)?;
        match b.get(i) {
            None => return fail(start, "unterminated object or array"),
            Some(&c) if c == close => return Ok(TreePage { nodes, next: None }),
            Some(b',') if index > 0 => {
                i = skip_ws(b, i + 1)?;
                // A trailing comma (JSONC) before the close.
                if b.get(i) == Some(&close) {
                    return Ok(TreePage { nodes, next: None });
                }
            }
            _ => {}
        }
        if nodes.len() >= limit {
            return Ok(TreePage { nodes, next: Some(i as u64) });
        }
        let key = if is_obj {
            if b.get(i) != Some(&b'"') {
                return fail(i, "expected a key (a string)");
            }
            let key_end = skip_string(b, i)?;
            let k = key_text(&b[i..key_end]);
            i = skip_ws(b, key_end)?;
            if b.get(i) != Some(&b':') {
                return fail(i, "expected `:` after the key");
            }
            i = skip_ws(b, i + 1)?;
            Some(k)
        } else {
            None
        };
        let (end, count) = skip_value(b, i)?;
        nodes.push(TreeNode { key, index, kind: kind_of(b, i), preview: preview(b, i, Some(end), count), start: i as u64, end: Some(end as u64), count });
        index += 1;
        i = end;
        let after = skip_ws(b, i)?;
        if !matches!(b.get(after), Some(b',')) && b.get(after) != Some(&close) {
            return fail(after, if is_obj { "expected `,` or `}`" } else { "expected `,` or `]`" });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC: &str = r#"{
  "name": "Q \"x\"",
  "list": [1, {"a": [2, 3]}, "s,]", []],
  "obj": {"k": null, "t": true},
  "empty": {}
}"#;

    fn kids(b: &[u8], start: u64) -> Vec<(Option<String>, Kind, String, Option<u64>)> {
        children(b, start, None, 0, 100).unwrap().nodes.into_iter().map(|n| (n.key, n.kind, n.preview, n.count)).collect()
    }

    #[test]
    fn lists_members_with_kinds_previews_and_counts() {
        let b = DOC.as_bytes();
        let r = root(b).unwrap();
        assert_eq!((r.kind, r.start), ("object", 0));
        let top = kids(b, 0);
        assert_eq!(top[0], (Some("name".into()), "string", r#""Q \"x\"""#.into(), None));
        assert_eq!(top[1], (Some("list".into()), "array", "[…]".into(), Some(4)));
        assert_eq!(top[2], (Some("obj".into()), "object", "{…}".into(), Some(2)));
        assert_eq!(top[3], (Some("empty".into()), "object", "{}".into(), Some(0)));
        let list = children(b, 0, None, 0, 100).unwrap().nodes[1].start;
        let items = kids(b, list);
        assert_eq!(items.iter().map(|k| k.1).collect::<Vec<_>>(), vec!["number", "object", "string", "array"]);
        assert_eq!(items[2].2, r#""s,]""#);
        assert_eq!(items[3].3, Some(0));
    }

    #[test]
    fn a_string_ending_in_a_backslash_is_an_error_not_a_panic() {
        assert!(count(b"[\"abc\\", 0).is_err());
        assert!(children(b"[\"a\\", 0, None, 0, 10).is_err());
    }

    #[test]
    fn count_reads_the_whole_container() {
        assert_eq!(count(DOC.as_bytes(), 0), Ok(4));
        assert_eq!(count(b"[1, [2, 3], {\"a\": [4]}, \"]\"]", 0), Ok(4));
        assert!(count(b"42", 0).is_err());
    }

    #[test]
    fn pages_resume_where_they_stopped() {
        let b = br#"[10, 11, 12, 13, 14]"#;
        let p1 = children(b, 0, None, 0, 2).unwrap();
        assert_eq!(p1.nodes.iter().map(|n| n.preview.as_str()).collect::<Vec<_>>(), vec!["10", "11"]);
        let p2 = children(b, 0, p1.next, 2, 2).unwrap();
        assert_eq!(p2.nodes.iter().map(|n| (n.index, n.preview.as_str())).collect::<Vec<_>>(), vec![(2, "12"), (3, "13")]);
        let p3 = children(b, 0, p2.next, 4, 2).unwrap();
        assert_eq!((p3.nodes.len(), p3.next), (1, None));
    }

    #[test]
    fn jsonc_comments_and_trailing_commas_pass() {
        let b = b"{ // c\n \"a\": 1, /* x */ \"b\": [1, 2,], }";
        let top = kids(b, 0);
        assert_eq!(top.iter().map(|k| k.0.clone().unwrap()).collect::<Vec<_>>(), vec!["a", "b"]);
        assert_eq!(top[1].3, Some(2));
    }

    #[test]
    fn malformed_json_is_reported_at_its_offset() {
        let b = br#"{"a": 1 "b": 2}"#;
        let err = children(b, 0, None, 0, 10).unwrap_err();
        assert_eq!(err, (8, "expected `,` or `}`".into()));
        assert!(children(br#"["unterminated]"#, 0, None, 0, 10).is_err());
        assert_eq!(root(b"  \n").unwrap_err().1, "the file is empty");
    }

    #[test]
    fn long_strings_are_cut_in_the_preview() {
        let long = format!("[\"{}\"]", "x".repeat(1000));
        let n = &children(long.as_bytes(), 0, None, 0, 1).unwrap().nodes[0];
        assert!(n.preview.ends_with('…') && n.preview.len() < 200);
        assert_eq!(n.end, Some(long.len() as u64 - 1));
    }
}
