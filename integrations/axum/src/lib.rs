//! rspc-axum: [Axum](https://docs.rs/axum) integration for [rspc](https://rspc.dev).
#![forbid(unsafe_code)]
#![cfg_attr(docsrs, feature(doc_cfg))]
#![doc(
    html_logo_url = "https://github.com/specta-rs/rspc/raw/main/.github/logo.png",
    html_favicon_url = "https://github.com/specta-rs/rspc/raw/main/.github/logo.png"
)]

mod endpoint;
mod extractors;

/// The rspc 0.3 JSON-RPC + WebSocket transport, so v1 clients keep working while a server
/// migrates procedure by procedure. Pairs with `rspc`'s `legacy` feature.
#[cfg(feature = "legacy")]
#[cfg_attr(docsrs, doc(cfg(feature = "legacy")))]
mod legacy;

pub use endpoint::{Endpoint, flush};

#[cfg(feature = "legacy")]
pub use legacy::endpoint;
