//! JSON validation / formatting that never re-encodes values.
//!
//! An iterative scanner checks strict JSON (RFC 8259) and re-emits it with new whitespace only, so
//! every string, number, key order and duplicate key is preserved byte for byte (`1e400`, `-0`,
//! `0.10`, 40-digit integers, `\ud800`), and nesting depth is limited only by memory (no recursion).
//!
//! JSONC mode also accepts `//` and `/* */` comments and trailing commas. Pretty-printing keeps
//! both; minifying drops them, so its output is strict JSON.

use serde::Serialize;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JsonError {
    pub line: usize,
    /// 1-based column in UTF-16 code units (what the editor counts).
    pub column: usize,
    pub message: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JsonResult {
    pub ok: bool,
    pub output: Option<String>,
    pub error: Option<JsonError>,
    /// Minify removed comments or trailing commas.
    pub stripped: bool,
}

enum Layout<'a> {
    Check,
    Minify,
    Pretty(&'a [u8]),
}

/// Pretty output bigger than this (and than 16x the input) is refused instead of built:
/// deep nesting makes indentation grow quadratically.
const PRETTY_MIN_CAP: usize = 64 << 20;

/// Error offset for problems that are not at a place in the text (reported as line 0, column 0).
const NO_POSITION: usize = usize::MAX;

const NO_COMMENTS: &str = "comments are not allowed in JSON (they are in JSONC)";

struct Scan<'a, 'b> {
    s: &'a [u8],
    text: &'a str,
    i: usize,
    out: Vec<u8>,
    layout: Layout<'b>,
    cap: usize,
    /// Accept comments and trailing commas.
    jsonc: bool,
    /// Input offset just past the last token copied (or skipped comment).
    last_tok_end: usize,
    /// Output offset of the last newline written by `newline`.
    line_start: Option<usize>,
    /// Nesting depth of the container being scanned, for indenting comments.
    depth: usize,
    stripped: bool,
}

type Res<T> = Result<T, (usize, String)>;

impl<'a, 'b> Scan<'a, 'b> {
    fn fail<T>(&self, at: usize, msg: impl Into<String>) -> Res<T> {
        Err((at, msg.into()))
    }

    /// `msg`, unless the input at `at` starts a comment that strict JSON rejects.
    fn unexpected<T>(&self, at: usize, msg: &str) -> Res<T> {
        let comment = self.s.get(at) == Some(&b'/') && matches!(self.s.get(at + 1), Some(b'/' | b'*'));
        self.fail(at, if comment && !self.jsonc { NO_COMMENTS } else { msg })
    }

    /// Skip whitespace and, in JSONC mode, comments (copying them when pretty-printing).
    fn ws(&mut self) -> Res<()> {
        loop {
            while self.i < self.s.len() && matches!(self.s[self.i], b' ' | b'\t' | b'\n' | b'\r') {
                self.i += 1;
            }
            if !self.jsonc || self.s.get(self.i) != Some(&b'/') {
                return Ok(());
            }
            let start = self.i;
            match self.s.get(start + 1) {
                Some(b'/') => {
                    let len = self.s[start..].iter().position(|&b| b == b'\n' || b == b'\r').unwrap_or(self.s.len() - start);
                    self.i = start + len;
                    self.comment(start, true)?;
                }
                Some(b'*') => {
                    let Some(end) = self.s[start + 2..].windows(2).position(|w| w == b"*/") else {
                        return self.fail(start, "unterminated comment");
                    };
                    self.i = start + 2 + end + 2;
                    self.comment(start, false)?;
                }
                _ => return Ok(()),
            }
        }
    }

    /// The comment `s[start..i]`. Pretty output keeps a comment that followed a token on the same
    /// line there, and puts any other comment on its own line.
    fn comment(&mut self, start: usize, line: bool) -> Res<()> {
        match self.layout {
            Layout::Check => {}
            Layout::Minify => self.stripped = true,
            Layout::Pretty(_) => {
                let mut text = &self.s[start..self.i];
                while let [rest @ .., b' ' | b'\t'] = text {
                    text = rest;
                }
                let own_line = self.out.is_empty() || self.s[self.last_tok_end..start].iter().any(|&b| b == b'\n' || b == b'\r');
                if own_line {
                    if !self.out.is_empty() && !self.at_line_start() {
                        self.newline(self.depth)?;
                    }
                    self.out.extend_from_slice(text);
                    self.newline(self.depth)?;
                } else {
                    // Undo a line break written after the previous token so the comment stays beside it.
                    if let Some(p) = self.line_start.filter(|_| self.at_line_start()) {
                        self.out.truncate(p);
                        self.line_start = None;
                    }
                    self.trim_spaces();
                    self.out.push(b' ');
                    self.out.extend_from_slice(text);
                    if line {
                        self.newline(self.depth)?;
                    } else {
                        self.out.push(b' ');
                    }
                }
            }
        }
        self.last_tok_end = self.i;
        Ok(())
    }

    /// Nothing but indentation has been written since the last `newline`.
    fn at_line_start(&self) -> bool {
        self.line_start.is_some_and(|p| p < self.out.len() && self.out[p + 1..].iter().all(|&b| b == b' ' || b == b'\t'))
    }

    fn trim_spaces(&mut self) {
        while matches!(self.out.last(), Some(b' ' | b'\t')) {
            self.out.pop();
        }
    }

    fn emit(&mut self, b: &[u8]) -> Res<()> {
        self.last_tok_end = self.i;
        if !matches!(self.layout, Layout::Check) {
            self.out.extend_from_slice(b);
            if self.out.len() > self.cap {
                return self.fail(NO_POSITION, format!("the formatted output would exceed {} MB (nesting too deep to pretty-print)", self.cap >> 20));
            }
        }
        Ok(())
    }

    /// Start a new line at `depth`. Repeated calls re-indent the same empty line.
    fn newline(&mut self, depth: usize) -> Res<()> {
        if let Layout::Pretty(unit) = self.layout {
            match self.line_start.filter(|_| self.at_line_start()) {
                Some(p) => self.out.truncate(p + 1),
                None => {
                    self.trim_spaces();
                    self.out.push(b'\n');
                    self.line_start = Some(self.out.len() - 1);
                }
            }
            for _ in 0..depth {
                self.out.extend_from_slice(unit);
            }
            if self.out.len() > self.cap {
                return self.fail(NO_POSITION, format!("the formatted output would exceed {} MB (nesting too deep to pretty-print)", self.cap >> 20));
            }
        }
        Ok(())
    }

    fn string(&mut self) -> Res<()> {
        let start = self.i;
        self.i += 1; // opening quote
        loop {
            let Some(&c) = self.s.get(self.i) else { return self.fail(self.i, "EOF while parsing a string") };
            match c {
                b'"' => {
                    self.i += 1;
                    break;
                }
                b'\\' => {
                    let esc = self.i;
                    match self.s.get(self.i + 1) {
                        Some(b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't') => self.i += 2,
                        Some(b'u') => {
                            let hex = self.s.get(self.i + 2..self.i + 6);
                            if !hex.is_some_and(|h| h.iter().all(u8::is_ascii_hexdigit)) {
                                return self.fail(esc, "invalid \\u escape (expected 4 hex digits)");
                            }
                            self.i += 6;
                        }
                        None => return self.fail(self.i + 1, "EOF while parsing a string"),
                        Some(_) => return self.fail(esc, "invalid escape"),
                    }
                }
                0x00..=0x1f => return self.fail(self.i, "control character (\\u0000-\\u001F) found while parsing a string"),
                _ => self.i += 1,
            }
        }
        let tok = &self.s[start..self.i];
        self.emit(tok)
    }

    fn number(&mut self) -> Res<()> {
        let start = self.i;
        let s = self.s;
        let digits = |mut i: usize| {
            while i < s.len() && s[i].is_ascii_digit() {
                i += 1;
            }
            i
        };
        if s[self.i] == b'-' {
            self.i += 1;
        }
        match s.get(self.i) {
            Some(b'0') => self.i += 1,
            Some(b'1'..=b'9') => self.i = digits(self.i),
            _ => return self.fail(self.i, "invalid number"),
        }
        if s.get(self.i) == Some(&b'.') {
            let d = digits(self.i + 1);
            if d == self.i + 1 {
                return self.fail(d, "invalid number (expected digits after '.')");
            }
            self.i = d;
        }
        if matches!(s.get(self.i), Some(b'e' | b'E')) {
            let mut j = self.i + 1;
            if matches!(s.get(j), Some(b'+' | b'-')) {
                j += 1;
            }
            let d = digits(j);
            if d == j {
                return self.fail(d, "invalid number (expected exponent digits)");
            }
            self.i = d;
        }
        if s.get(self.i).is_some_and(|c| c.is_ascii_digit()) {
            return self.fail(self.i, "invalid number (leading zero)");
        }
        let tok = &s[start..self.i];
        self.emit(tok)
    }

    fn literal(&mut self) -> Res<()> {
        for lit in [&b"true"[..], b"false", b"null"] {
            if self.s[self.i..].starts_with(lit) {
                self.i += lit.len();
                return self.emit(lit);
            }
        }
        self.fail(self.i, "expected value")
    }

    /// Walk the whole document. `stack` holds the open containers (b'{' / b'['), so depth costs heap, not stack.
    fn run(&mut self) -> Res<()> {
        // A leading byte-order mark is not JSON, but files carry one; skip it like the tree view does.
        if self.text.starts_with('\u{feff}') {
            self.i = 3;
            self.last_tok_end = 3;
        }
        let mut stack: Vec<u8> = Vec::new();
        // JSONC: the next `]` / `}` may close the container right after a comma (a trailing comma).
        let mut may_close = false;
        'value: loop {
            // ---- expect a value
            self.ws()?;
            let Some(&c) = self.s.get(self.i) else { return self.fail(self.i, "EOF while parsing a value") };
            match c {
                b'{' | b'[' => {
                    let close = if c == b'{' { b'}' } else { b']' };
                    self.i += 1;
                    self.emit(&[c])?;
                    self.ws()?;
                    if self.s.get(self.i) == Some(&close) {
                        self.i += 1;
                        self.emit(&[close])?;
                    } else {
                        stack.push(c);
                        self.depth = stack.len();
                        self.newline(stack.len())?;
                        may_close = c == b'{' && self.key()?;
                        continue 'value;
                    }
                }
                b'"' => self.string()?,
                b'-' | b'0'..=b'9' => self.number()?,
                b't' | b'f' | b'n' => self.literal()?,
                b']' | b'}' if may_close && stack.last() == Some(&if c == b'}' { b'{' } else { b'[' }) => {
                    self.i += 1;
                    if matches!(self.layout, Layout::Minify) && self.out.last() == Some(&b',') {
                        self.out.pop();
                        self.stripped = true;
                    }
                    stack.pop();
                    self.depth = stack.len();
                    self.newline(stack.len())?;
                    self.emit(&[c])?;
                }
                b']' | b'}' if !stack.is_empty() => return self.fail(self.i, "trailing comma"),
                _ => return self.unexpected(self.i, "expected value"),
            }
            // ---- after a value: separators and closers
            loop {
                let Some(&top) = stack.last() else {
                    self.ws()?;
                    if self.i < self.s.len() {
                        return self.unexpected(self.i, "trailing characters");
                    }
                    return Ok(());
                };
                let close = if top == b'{' { b'}' } else { b']' };
                self.ws()?;
                match self.s.get(self.i) {
                    Some(b',') => {
                        self.i += 1;
                        self.emit(b",")?;
                        self.newline(stack.len())?;
                        may_close = if top == b'{' { self.key()? } else { self.jsonc };
                        continue 'value;
                    }
                    Some(&c) if c == close => {
                        self.i += 1;
                        stack.pop();
                        self.depth = stack.len();
                        self.newline(stack.len())?;
                        self.emit(&[close])?;
                    }
                    Some(_) => return self.unexpected(self.i, if top == b'{' { "expected `,` or `}`" } else { "expected `,` or `]`" }),
                    None => return self.fail(self.i, if top == b'{' { "EOF while parsing an object" } else { "EOF while parsing a list" }),
                }
            }
        }
    }

    /// An object key and its colon. Returns true instead when JSONC allows the object to close here.
    fn key(&mut self) -> Res<bool> {
        self.ws()?;
        match self.s.get(self.i) {
            Some(b'"') => self.string()?,
            Some(b'}') if self.jsonc => return Ok(true),
            Some(b'}') => return self.fail(self.i, "trailing comma"),
            Some(_) => return self.unexpected(self.i, "key must be a string"),
            None => return self.fail(self.i, "EOF while parsing an object"),
        }
        self.ws()?;
        if self.s.get(self.i) != Some(&b':') {
            return self.unexpected(self.i, if self.i >= self.s.len() { "EOF while parsing an object" } else { "expected `:`" });
        }
        self.i += 1;
        self.emit(if matches!(self.layout, Layout::Pretty(_)) { b": " } else { b":" })?;
        Ok(false)
    }
}

/// 1-based line and UTF-16 column of byte offset `at`.
fn position(text: &str, at: usize) -> (usize, usize) {
    let mut at = at.min(text.len());
    while !text.is_char_boundary(at) {
        at -= 1;
    }
    let before = &text[..at];
    let line_start = before.rfind('\n').map_or(0, |p| p + 1);
    let line = before.bytes().filter(|&b| b == b'\n').count() + 1;
    let column = before[line_start..].encode_utf16().count() + 1;
    (line, column)
}

fn run(text: &str, layout: Layout, jsonc: bool) -> JsonResult {
    let cap = match layout {
        Layout::Pretty(_) => PRETTY_MIN_CAP.max(text.len().saturating_mul(16)),
        _ => usize::MAX,
    };
    let reserve = if matches!(layout, Layout::Check) { 0 } else { text.len() + text.len() / 2 };
    let mut sc = Scan { s: text.as_bytes(), text, i: 0, out: Vec::with_capacity(reserve), layout, cap, jsonc, last_tok_end: 0, line_start: None, depth: 0, stripped: false };
    match sc.run() {
        Ok(()) => {
            let output = if matches!(sc.layout, Layout::Check) {
                None
            } else {
                // A comment after the root value leaves a line break behind.
                while matches!(sc.out.last(), Some(b' ' | b'\t' | b'\n')) {
                    sc.out.pop();
                }
                // Only whole tokens of valid UTF-8 input and ASCII punctuation were copied.
                Some(String::from_utf8(sc.out).expect("scanner copies whole UTF-8 tokens"))
            };
            JsonResult { ok: true, output, error: None, stripped: sc.stripped }
        }
        Err((at, message)) => {
            let (line, column) = if at == NO_POSITION { (0, 0) } else { position(text, at) };
            JsonResult { ok: false, output: None, error: Some(JsonError { line, column, message }), stripped: false }
        }
    }
}

/// `validate` for raw bytes (a large file's memory mapping): JSON must be UTF-8, so invalid UTF-8
/// is reported at its line and column like any other error. Nothing is copied.
pub fn validate_bytes(bytes: &[u8], jsonc: bool) -> JsonResult {
    match std::str::from_utf8(bytes) {
        Ok(text) => validate(text, jsonc),
        Err(e) => {
            let valid = std::str::from_utf8(&bytes[..e.valid_up_to()]).unwrap_or("");
            let (line, column) = position(valid, valid.len());
            let message = "not valid UTF-8 text (JSON must be UTF-8)".to_string();
            JsonResult { ok: false, output: None, error: Some(JsonError { line, column, message }), stripped: false }
        }
    }
}

/// Strict JSON, or JSONC (comments and trailing commas allowed) when `jsonc` is set.
pub fn validate(text: &str, jsonc: bool) -> JsonResult {
    run(text, Layout::Check, jsonc)
}

/// Pretty-print. Comments and trailing commas are accepted and kept where they were.
pub fn format(text: &str, indent: usize, use_tabs: bool) -> JsonResult {
    let unit: Vec<u8> = if use_tabs { b"\t".to_vec() } else { vec![b' '; indent] };
    run(text, Layout::Pretty(&unit), true)
}

/// Minify. Comments and trailing commas are accepted and removed, so the output is strict JSON.
pub fn minify(text: &str) -> JsonResult {
    run(text, Layout::Minify, true)
}


#[cfg(test)]
mod tests {
    use super::*;

    /// Strict validation (shadows the glob-imported two-argument `validate`).
    fn validate(text: &str) -> JsonResult {
        super::validate(text, false)
    }

    #[test]
    fn jsonc_comments_are_kept_by_format_and_dropped_by_minify() {
        let src = "// head\n{\"a\":1, // one\n\"b\":[1,2,], /* two */ \"c\":0.10,\n// last\n}";
        assert_eq!(validate(src).error.unwrap().message, NO_COMMENTS);
        assert!(super::validate(src, true).ok);
        let pretty = format(src, 2, false);
        assert_eq!(
            pretty.output.unwrap(),
            "// head\n{\n  \"a\": 1, // one\n  \"b\": [\n    1,\n    2,\n  ], /* two */ \"c\": 0.10,\n  // last\n}"
        );
        let min = minify(src);
        assert!(min.stripped);
        assert_eq!(min.output.unwrap(), "{\"a\":1,\"b\":[1,2],\"c\":0.10}");
        // Formatting is stable.
        let once = format(src, 2, false).output.unwrap();
        assert_eq!(format(&once, 2, false).output.unwrap(), once);
    }

    #[test]
    fn jsonc_edge_cases() {
        assert_eq!(format("[ // only a comment\n]", 2, false).output.unwrap(), "[ // only a comment\n]");
        assert_eq!(format("{\"a\": /* x */ 1}", 2, false).output.unwrap(), "{\n  \"a\": /* x */ 1\n}");
        assert_eq!(format("[1 // c\n]", 2, false).output.unwrap(), "[\n  1 // c\n]");
        assert_eq!(format("{} // after\n", 2, false).output.unwrap(), "{} // after");
        assert_eq!(super::validate("[1 /* open", true).error.unwrap().message, "unterminated comment");
        // A trailing comma is accepted only before a closer, never in place of a value.
        assert!(!super::validate("{\"a\": }", true).ok);
        assert!(!super::validate("[,]", true).ok);
        assert!(super::validate("{\"a\":[1,],}", true).ok);
        // Strict-only input is unaffected.
        let m = minify("[1,]");
        assert!(m.stripped);
        assert_eq!(m.output.unwrap(), "[1]");
        assert!(!minify("[1]").stripped);
    }

    const SRC: &str = r#"{"z":1,"a":2,"negzero":-0,"pi":3.14159265358979323846264,"bigger":123456789012345678901234567890,"e":1e+2,"huge":1e+400}"#;

    #[test]
    fn minify_preserves_order_and_number_text() {
        assert_eq!(minify(SRC).output.unwrap(), SRC);
    }

    #[test]
    fn format_matches_serde_layout_and_roundtrips() {
        let pretty = format(SRC, 2, false).output.unwrap();
        assert!(pretty.starts_with("{\n  \"z\": 1,\n  \"a\": 2"));
        assert!(pretty.contains("\"pi\": 3.14159265358979323846264"));
        assert_eq!(minify(&pretty).output.unwrap(), SRC);
        assert_eq!(format(r#"{"a":[1,{"b":[]},{}],"c":{}}"#, 2, false).output.unwrap(), "{\n  \"a\": [\n    1,\n    {\n      \"b\": []\n    },\n    {}\n  ],\n  \"c\": {}\n}");
        assert_eq!(format("[1]", 0, true).output.unwrap(), "[\n\t1\n]");
    }

    #[test]
    fn numbers_roundtrip_byte_for_byte() {
        let src = "[1e400,-0,0.10,1234567890123456789012345678901234567890,1E-7,-0.0e+0]";
        assert_eq!(minify(src).output.unwrap(), src);
        assert_eq!(minify(&format(src, 4, false).output.unwrap()).output.unwrap(), src);
        for bad in ["[NaN]", "[01]", "[1.]", "[.5]", "[1e]", "[+1]", "[-]", "[Infinity]"] {
            assert!(!validate(bad).ok, "{bad} should be invalid");
        }
    }

    #[test]
    fn duplicate_keys_and_escapes_are_kept() {
        let src = r#"{"a":1,"a":2,"q\"\\\n\u00e9\ud800~/":"\ud83d\ude00","😀":"é"}"#;
        assert!(validate(src).ok);
        assert_eq!(minify(src).output.unwrap(), src);
        assert_eq!(minify(&format(src, 2, false).output.unwrap()).output.unwrap(), src);
    }

    #[test]
    fn validate_bytes_reports_invalid_utf8_where_it_is() {
        assert!(validate_bytes(b"{\"a\": [1, 2]}", false).ok);
        let r = validate_bytes(b"{\n  \"a\": \"x\xff\"\n}", false);
        let e = r.error.unwrap();
        assert_eq!((e.line, e.column), (2, 10));
        assert!(e.message.contains("UTF-8"), "{}", e.message);
        let r = validate_bytes(b"[1,\n 2,]", false);
        assert_eq!(r.error.unwrap().line, 2);
    }

    #[test]
    fn deep_nesting_has_no_recursion_limit() {
        let depth = 100_000;
        let src = format!("{}{}", "[".repeat(depth), "]".repeat(depth));
        assert!(validate(&src).ok);
        assert_eq!(minify(&src).output.unwrap(), src);
        // Pretty output of 10 000 levels is ~200 MB of indentation: refused with a clear message.
        let ten_k = format!("{}{}", "[".repeat(10_000), "]".repeat(10_000));
        let r = format(&ten_k, 2, false);
        let e = r.error.unwrap();
        assert!(e.message.contains("nesting too deep") && e.line == 0 && e.column == 0, "{e:?}");
        let ok = format!("{}1{}", "[".repeat(1000), "]".repeat(1000));
        assert!(format(&ok, 2, false).ok);
    }

    #[test]
    fn bom_and_crlf_whitespace() {
        assert!(validate("\u{feff}{\"a\":1}").ok);
        assert_eq!(minify("\u{feff}{\r\n  \"a\": \"x\"\r\n}").output.unwrap(), "{\"a\":\"x\"}");
        // A raw CR or LF inside a string is a control character.
        assert!(!validate("[\"a\r\nb\"]").ok);
        assert!(validate("[\"a\\r\\nb\"]").ok);
    }

    #[test]
    fn errors_report_line_and_utf16_column() {
        let r = validate("{\n  \"a\": 1,\n  \"b\": }");
        let e = r.error.unwrap();
        assert_eq!((e.line, e.column, e.message.as_str()), (3, 8, "trailing comma"));
        let e = validate("{\"a\": 1 \"b\": 2}").error.unwrap();
        assert_eq!((e.line, e.column, e.message.as_str()), (1, 9, "expected `,` or `}`"));
        // "😀" is two UTF-16 units, "é" one: the bad token sits at UTF-16 column 9.
        let e = validate("[\"😀é\", x]").error.unwrap();
        assert_eq!((e.line, e.column), (1, 9));
        let e = validate("[1,]").error.unwrap();
        assert_eq!(e.message, "trailing comma");
        assert_eq!(validate("").error.unwrap().message, "EOF while parsing a value");
        assert_eq!(validate("[1] x").error.unwrap().message, "trailing characters");
        assert_eq!(validate("{1:2}").error.unwrap().message, "key must be a string");
        assert_eq!(validate("{\"a\" 1}").error.unwrap().message, "expected `:`");
        assert_eq!(validate("[\"a").error.unwrap().message, "EOF while parsing a string");
        assert_eq!(validate("[1, 2").error.unwrap().message, "EOF while parsing a list");
        assert_eq!(validate("[\"\\x\"]").error.unwrap().message, "invalid escape");
        assert!(validate("[\"\\u12G4\"]").error.unwrap().message.contains("hex"));
    }

    #[test]
    fn agrees_with_serde_on_strict_json() {
        for src in [r#"{"a":[1,2,{"b":null}],"c":true,"d":"x"}"#, "[]", "{}", "\"s\"", "0", "-1.5e-3", r#"{"a":{"b":{"c":[[[]]]}}}"#] {
            assert!(validate(src).ok, "{src}");
            assert!(serde_json::from_str::<serde_json::Value>(src).is_ok());
        }
        for src in ["[1,]", "{,}", "[1 2]", "{'a':1}", "[true false]", "nul", "[\"\t\"]", "{\"a\":1,}"] {
            assert!(!validate(src).ok, "{src}");
            assert!(serde_json::from_str::<serde_json::Value>(src).is_err(), "{src}");
        }
    }
}
