//! `model-api` `hello` binary: minimal HTTP server exposing a health check
//! endpoint. Real API surface is filled in by later tasks.

use axum::{routing::get, Json, Router};
use serde_json::{json, Value};

const BIND_ADDR: &str = "0.0.0.0:8080";

async fn healthz() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

#[tokio::main]
async fn main() {
    let app = Router::new().route("/healthz", get(healthz));

    let listener = tokio::net::TcpListener::bind(BIND_ADDR)
        .await
        .expect("failed to bind health server address");

    println!("model-api listening on {BIND_ADDR}");

    axum::serve(listener, app)
        .await
        .expect("server error");
}
