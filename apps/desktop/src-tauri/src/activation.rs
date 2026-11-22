//! `whyfull://activate?key=…` links from the purchase email and website.
//!
//! The key is checked for shape here, then handed to the local engine, which
//! verifies the signature and stores it exactly as a pasted key would be.
use std::{
    io::{Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpStream},
    time::Duration,
};

pub const SCHEME: &str = "whyfull";
const PREFIX: &str = "WHYFULL-";
/// Longer than any key the engine accepts (2048 + 200 + prefix), shorter than any abuse.
pub const MAX_KEY_LENGTH: usize = 4096;
const MAX_RESPONSE: u64 = 64 * 1024;

fn base64url(part: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&part.len())
        && part
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// `WHYFULL-<base64url>.<base64url>`, with the engine's own length bounds.
pub fn valid_key(key: &str) -> bool {
    if key.len() > MAX_KEY_LENGTH {
        return false;
    }
    let Some(rest) = key.strip_prefix(PREFIX) else {
        return false;
    };
    let mut parts = rest.split('.');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(body), Some(signature), None) => {
            base64url(body, 8, 2048) && base64url(signature, 40, 200)
        }
        _ => false,
    }
}

/// The license key in an activation link: `whyfull://activate?key=…` or `#key=…`.
pub fn key_from_url(raw: &str) -> Result<String, &'static str> {
    if raw.len() > MAX_KEY_LENGTH + 64 {
        return Err("That activation link is too long.");
    }
    let url = url::Url::parse(raw).map_err(|_| "That activation link is not valid.")?;
    if url.scheme() != SCHEME
        || !url
            .host_str()
            .is_some_and(|host| host.eq_ignore_ascii_case("activate"))
        || !matches!(url.path(), "" | "/")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Whyfull doesn’t recognize that link.");
    }
    let mut keys = url
        .query_pairs()
        .chain(
            url.fragment()
                .map(|fragment| url::form_urlencoded::parse(fragment.as_bytes()))
                .into_iter()
                .flatten(),
        )
        .filter(|(name, _)| name == "key")
        .map(|(_, value)| value.trim().to_string());
    let key = keys
        .next()
        .ok_or("That activation link has no license key.")?;
    if keys.any(|other| other != key) {
        return Err("That activation link has more than one license key.");
    }
    if !valid_key(&key) {
        return Err("That activation link doesn’t contain a valid Whyfull license key. Paste the key from your purchase email instead.");
    }
    Ok(key)
}

/// The engine's local API: `127.0.0.1:<port>` with its session bearer token.
#[derive(Clone)]
pub struct EngineApi {
    pub port: u16,
    pub token: String,
}

impl EngineApi {
    /// The engine's readiness URL carries the port and the bearer token (fragment).
    pub fn from_url(url: &url::Url) -> Self {
        Self {
            port: url.port().unwrap_or_default(),
            token: url.fragment().unwrap_or("").to_string(),
        }
    }
}

pub fn request(api: &EngineApi, key: &str) -> String {
    let body = serde_json::json!({ "action": "activate", "key": key }).to_string();
    format!(
        "POST /api/license HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n{body}",
        port = api.port,
        token = api.token,
        length = body.len(),
    )
}

fn dechunk(mut body: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        let end = body.windows(2).position(|w| w == b"\r\n")?;
        let size = std::str::from_utf8(&body[..end]).ok()?;
        let size = usize::from_str_radix(size.split(';').next()?.trim(), 16).ok()?;
        body = &body[end + 2..];
        if size == 0 {
            return Some(out);
        }
        out.extend_from_slice(body.get(..size)?);
        body = body.get(size + 2..)?;
    }
}

/// The status code and JSON body of an HTTP/1.1 response.
pub fn parse_response(raw: &[u8]) -> Option<(u16, serde_json::Value)> {
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = std::str::from_utf8(&raw[..split]).ok()?;
    let mut lines = head.split("\r\n");
    let status = lines.next()?.split(' ').nth(1)?.parse().ok()?;
    let chunked = lines.any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.eq_ignore_ascii_case("transfer-encoding")
                && value.trim().eq_ignore_ascii_case("chunked")
        })
    });
    let body = &raw[split + 4..];
    let body = if chunked {
        dechunk(body)?
    } else {
        body.to_vec()
    };
    Some((status, serde_json::from_slice(&body).ok()?))
}

/// What the viewer and dialogs show: success, or the engine's error message.
#[derive(Debug, PartialEq)]
pub struct Outcome {
    pub ok: bool,
    pub message: String,
}

pub fn outcome(status: u16, value: &serde_json::Value) -> Outcome {
    if status == 200 && value["licensed"] == true {
        let message = match value["holder"].as_str() {
            Some(holder) if !holder.trim().is_empty() => format!("Licensed to {}", holder.trim()),
            _ => "Licensed".to_string(),
        };
        return Outcome { ok: true, message };
    }
    let message = value["error"]
        .as_str()
        .unwrap_or("Whyfull could not activate this license.")
        .chars()
        .take(500)
        .collect();
    Outcome { ok: false, message }
}

pub fn activate(api: &EngineApi, key: &str) -> Outcome {
    let result = (|| -> std::io::Result<Vec<u8>> {
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, api.port));
        let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(5))?;
        stream.set_read_timeout(Some(Duration::from_secs(15)))?;
        stream.set_write_timeout(Some(Duration::from_secs(5)))?;
        stream.write_all(request(api, key).as_bytes())?;
        let mut raw = Vec::new();
        stream.take(MAX_RESPONSE).read_to_end(&mut raw)?;
        Ok(raw)
    })();
    match result {
        Ok(raw) => match parse_response(&raw) {
            Some((status, value)) => outcome(status, &value),
            None => Outcome {
                ok: false,
                message: "Whyfull’s engine sent an unexpected reply.".into(),
            },
        },
        Err(error) => Outcome {
            ok: false,
            message: format!("Could not reach Whyfull’s engine: {error}"),
        },
    }
}

/// Script that tells the viewer, with every value JSON-encoded.
pub fn viewer_script(outcome: &Outcome) -> String {
    let detail = serde_json::json!({ "ok": outcome.ok, "message": outcome.message });
    format!(
        "(()=>{{const detail={detail};window.__whyfullLicense=detail;window.dispatchEvent(new CustomEvent('whyfull-license',{{detail}}))}})()"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> String {
        format!("WHYFULL-{}.{}", "eyJ2IjoxfQ", "A".repeat(86))
    }

    #[test]
    fn accepts_query_and_fragment_keys() {
        let key = key();
        assert_eq!(
            key_from_url(&format!("whyfull://activate?key={key}")),
            Ok(key.clone())
        );
        assert_eq!(
            key_from_url(&format!("whyfull://activate/?key={key}")),
            Ok(key.clone())
        );
        assert_eq!(
            key_from_url(&format!("whyfull://activate#key={key}")),
            Ok(key.clone())
        );
        assert_eq!(
            key_from_url(&format!("WHYFULL://ACTIVATE?key={key}")),
            Ok(key.clone())
        );
        // encodeURIComponent output, and a repeat of the same key, still work.
        let encoded = key.replace('-', "%2D").replace('.', "%2E");
        assert_eq!(
            key_from_url(&format!("whyfull://activate?key={encoded}#key={key}")),
            Ok(key)
        );
    }

    #[test]
    fn rejects_other_links() {
        let key = key();
        for url in [
            format!("https://activate?key={key}"),
            format!("whyfull://open?key={key}"),
            format!("whyfull://activate/extra?key={key}"),
            format!("whyfull://user@activate?key={key}"),
            format!("whyfull://activate:9?key={key}"),
            "whyfull://activate".to_string(),
            "whyfull://activate?key=".to_string(),
            format!("whyfull://activate?key={key}&key={key}x"),
            "not a url".to_string(),
        ] {
            assert!(key_from_url(&url).is_err(), "{url}");
        }
    }

    #[test]
    fn validates_key_shape() {
        assert!(valid_key(&key()));
        let signature = "A".repeat(86);
        for bad in [
            "WHYFULL-bad.bad".to_string(),
            format!("whyfull-eyJ2IjoxfQ.{signature}"),
            format!("WHYFULL-eyJ2Ijo+fQ.{signature}"),
            format!("WHYFULL-eyJ2IjoxfQ.{signature}="),
            format!("WHYFULL-eyJ2IjoxfQ.{signature}.x"),
            format!("WHYFULL-eyJ2IjoxfQ{signature}"),
            format!("WHYFULL-eyJ2IjoxfQ.{signature}\n"),
            format!("WHYFULL-{}.{signature}", "A".repeat(2049)),
            format!("WHYFULL-eyJ2IjoxfQ.{}", "A".repeat(201)),
        ] {
            assert!(!valid_key(&bad), "{bad}");
        }
        let long = format!(
            "whyfull://activate?key=WHYFULL-{}.{signature}",
            "A".repeat(5000)
        );
        assert!(key_from_url(&long).is_err());
    }

    #[test]
    fn builds_an_authenticated_request() {
        let api = EngineApi {
            port: 4123,
            token: "ab".repeat(32),
        };
        let text = request(&api, &key());
        let (head, body) = text.split_once("\r\n\r\n").unwrap();
        assert!(head.starts_with("POST /api/license HTTP/1.1\r\nHost: 127.0.0.1:4123\r\n"));
        assert!(head.contains(&format!("Authorization: Bearer {}", "ab".repeat(32))));
        assert!(head.contains(&format!("Content-Length: {}", body.len())));
        let json: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "action": "activate", "key": key() })
        );
    }

    #[test]
    fn reads_engine_replies() {
        let ok = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"enabled\":true,\"licensed\":true,\"holder\":\"Ada\"}";
        let (status, value) = parse_response(ok).unwrap();
        assert_eq!(
            outcome(status, &value),
            Outcome {
                ok: true,
                message: "Licensed to Ada".into()
            }
        );
        let chunked = b"HTTP/1.1 400 Bad Request\r\ntransfer-encoding: chunked\r\n\r\n9\r\n{\"error\":\r\nA\r\n\"Nope \\\"\"}\r\n0\r\n\r\n";
        let (status, value) = parse_response(chunked).unwrap();
        assert_eq!(
            outcome(status, &value),
            Outcome {
                ok: false,
                message: "Nope \"".into()
            }
        );
        assert!(parse_response(b"HTTP/1.1 200 OK\r\n\r\nnot json").is_none());
        assert!(parse_response(b"garbage").is_none());
        let unlicensed = serde_json::json!({ "enabled": true, "licensed": false });
        assert!(!outcome(200, &unlicensed).ok);
    }

    #[test]
    fn escapes_viewer_messages() {
        let script = viewer_script(&Outcome {
            ok: false,
            message: "'); alert(1); ('\"</script>\u{2028}".into(),
        });
        assert!(script.contains(r#"{"message":"'); alert(1); ('\"</script>"#));
        assert!(script.contains("'whyfull-license'"));
        assert!(!script.contains("\"ok\":true"));
    }
}
