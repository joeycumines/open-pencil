use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Method,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Deserialize, Serialize)]
pub struct ProxyHttpHeader {
    name: String,
    value: String,
}

#[derive(Deserialize)]
pub struct ProxyHttpRequest {
    url: String,
    method: Option<String>,
    headers: Option<Vec<ProxyHttpHeader>>,
    body: Option<Vec<u8>>,
}

#[derive(Serialize)]
pub struct ProxyHttpResponse {
    status: u16,
    headers: Vec<ProxyHttpHeader>,
    body: Vec<u8>,
}

/// Metadata returned immediately so the JS side can start building
/// a ReadableStream before the full body arrives.
#[derive(Serialize)]
pub struct ProxyHttpStreamStart {
    status: u16,
    headers: Vec<ProxyHttpHeader>,
    /// A unique event name the JS side listens on for body chunks.
    event_name: String,
}

#[derive(Serialize)]
pub struct ProxyHttpChunk {
    /// Monotonic chunk index so the JS side can detect ordering issues.
    index: u64,
    /// `true` when this is the final chunk (stream end).
    done: bool,
    /// Raw bytes; empty when done == true.
    data: Vec<u8>,
    /// Error message; only set when the stream fails.
    error: Option<String>,
}

fn request_headers(headers: Option<Vec<ProxyHttpHeader>>) -> HeaderMap {
    let mut mapped = HeaderMap::new();
    for header in headers.unwrap_or_default() {
        let Ok(header_name) = HeaderName::from_bytes(header.name.as_bytes()) else {
            continue;
        };
        let Ok(header_value) = HeaderValue::from_str(&header.value) else {
            continue;
        };
        mapped.insert(header_name, header_value);
    }
    mapped
}

fn request_method(method: Option<String>) -> Result<Method, String> {
    let raw = method.unwrap_or_else(|| "GET".into());
    Method::from_bytes(raw.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxy_http_request(request: ProxyHttpRequest) -> Result<ProxyHttpResponse, String> {
    let parsed = reqwest::Url::parse(&request.url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only HTTP(S) requests are supported".into());
    }

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;
    let mut builder = client
        .request(request_method(request.method)?, parsed)
        .headers(request_headers(request.headers));
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            Some(ProxyHttpHeader {
                name: name.as_str().to_owned(),
                value: value.to_str().ok()?.to_owned(),
            })
        })
        .collect();
    let body = response.bytes().await.map_err(|e| e.to_string())?.to_vec();

    Ok(ProxyHttpResponse {
        status,
        headers,
        body,
    })
}

/// Streaming variant: returns headers immediately, then emits body chunks
/// via a Tauri event so the JS side can construct a ReadableStream.
/// This preserves token-by-token SSE streaming for AI chat.
#[tauri::command]
pub async fn proxy_http_request_stream(
    app: AppHandle,
    request: ProxyHttpRequest,
) -> Result<ProxyHttpStreamStart, String> {
    let parsed = reqwest::Url::parse(&request.url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only HTTP(S) requests are supported".into());
    }

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;
    let mut builder = client
        .request(request_method(request.method)?, parsed)
        .headers(request_headers(request.headers));
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            Some(ProxyHttpHeader {
                name: name.as_str().to_owned(),
                value: value.to_str().ok()?.to_owned(),
            })
        })
        .collect();

    // Generate a unique event name for this stream session
    let event_name = format!(
        "proxy-http-chunk-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );

    let event_name_clone = event_name.clone();
    let app_handle = app.clone();

    // Spawn the streaming task so we can return the headers immediately
    tauri::async_runtime::spawn(async move {
        use futures_util::StreamExt;
        let mut stream = response.bytes_stream();
        let mut index: u64 = 0;

        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(bytes) => {
                    let chunk = ProxyHttpChunk {
                        index,
                        done: false,
                        data: bytes.to_vec(),
                        error: None,
                    };
                    index += 1;
                    let _ = app_handle.emit(&event_name_clone, &chunk);
                }
                Err(e) => {
                    let chunk = ProxyHttpChunk {
                        index,
                        done: true,
                        data: vec![],
                        error: Some(e.to_string()),
                    };
                    let _ = app_handle.emit(&event_name_clone, &chunk);
                    return;
                }
            }
        }

        // Signal stream completion
        let chunk = ProxyHttpChunk {
            index,
            done: true,
            data: vec![],
            error: None,
        };
        let _ = app_handle.emit(&event_name_clone, &chunk);
    });

    Ok(ProxyHttpStreamStart {
        status,
        headers,
        event_name,
    })
}
