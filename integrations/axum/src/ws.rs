//! Every procedure over one WebSocket, so long-lived subscriptions do not each hold one of the
//! browser's ~6 HTTP/1.1 connections per origin the way SSE does.
//!
//! The client sends, as text frames:
//!
//! ```json
//! { "method": "subscribe", "id": 1, "path": "a.b", "input": null }
//! { "method": "unsubscribe", "id": 1 }
//! ```
//!
//! and gets back, per subscription, the same shapes the SSE transport sends:
//!
//! ```json
//! { "id": 1, "item": "<each value>" }
//! { "id": 1, "stopped": true }
//! { "id": 1, "error": { "status": 500, "data": "<error>" } }
//! ```
//!
//! `stopped` and `error` end the subscription. An unsubscribed one ends without either. Ids are
//! the client's and only need to be unique among its open subscriptions; subscribing with an
//! open id replaces that subscription. Nothing resumes across a reconnect, so a client
//! resubscribes and procedures should emit their current state first.

use std::{collections::HashMap, sync::Arc, time::Duration};

use axum::{
    body::Bytes,
    extract::ws::{Message, WebSocket},
    http::{StatusCode, request::Parts},
};
use futures::{
    StreamExt,
    channel::oneshot,
    stream::{self, BoxStream, SelectAll},
};
use rspc_procedure::{ProcedureError, Procedures};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::time::{Instant, interval_at};

use crate::{endpoint::next, extractors::TCtxFunc};

/// Detects connections that died without a close frame, and keeps proxies from idling them out.
const KEEP_ALIVE: Duration = Duration::from_secs(15);

type Id = u64;

#[derive(Deserialize)]
#[serde(tag = "method", rename_all = "camelCase")]
enum Request {
    Subscribe {
        id: Id,
        path: String,
        #[serde(default)]
        input: Value,
    },
    Unsubscribe {
        id: Id,
    },
}

#[derive(Serialize)]
#[serde(untagged)]
enum Response {
    Item { id: Id, item: Value },
    Error { id: Id, error: ErrorBody },
    Stopped { id: Id, stopped: bool },
}

#[derive(Serialize)]
struct ErrorBody {
    status: u16,
    data: Value,
}

impl Response {
    fn error(id: Id, status: StatusCode, data: Value) -> Self {
        Self::Error {
            id,
            error: ErrorBody {
                status: status.as_u16(),
                data,
            },
        }
    }
}

pub(crate) async fn serve<TCtx, TCtxFn, TCtxFnMarker, TState>(
    mut socket: WebSocket,
    procedures: Arc<Procedures<TCtx>>,
    ctx_fn: TCtxFn,
    parts: Parts,
    state: TState,
) where
    TCtx: Send + Sync + 'static,
    TCtxFn: TCtxFunc<TCtx, TState, TCtxFnMarker>,
    TCtxFnMarker: Send + Sync + 'static,
    TState: Clone + Send + Sync + 'static,
{
    // Dropping a sender ends its subscription, through `take_until` below.
    let mut cancels = HashMap::<Id, oneshot::Sender<()>>::new();
    let mut outgoing = SelectAll::<BoxStream<'static, Response>>::new();
    let mut keep_alive = interval_at(Instant::now() + KEEP_ALIVE, KEEP_ALIVE);

    loop {
        let response = tokio::select! {
            message = socket.recv() => match message {
                Some(Ok(Message::Text(text))) => {
                    // Unknown messages are skipped rather than fatal, so a newer client still
                    // gets the parts this server understands.
                    match serde_json::from_str(text.as_str()) {
                        Ok(Request::Subscribe { id, path, input }) => {
                            cancels.retain(|_, cancel| !cancel.is_canceled());
                            let (cancel, cancelled) = oneshot::channel();
                            cancels.insert(id, cancel);
                            outgoing.push(
                                stream::once(subscribe(
                                    procedures.clone(),
                                    ctx_fn.clone(),
                                    parts.clone(),
                                    state.clone(),
                                    id,
                                    path,
                                    input,
                                ))
                                .flatten()
                                .take_until(cancelled)
                                .boxed(),
                            );
                        }
                        Ok(Request::Unsubscribe { id }) => {
                            cancels.remove(&id);
                        }
                        Err(_) => {}
                    }
                    continue;
                }
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                Some(Ok(_)) => continue,
            },
            Some(response) = outgoing.next(), if !outgoing.is_empty() => response,
            _ = keep_alive.tick() => {
                if socket.send(Message::Ping(Bytes::new())).await.is_err() {
                    break;
                }
                continue;
            }
        };

        let Ok(text) = serde_json::to_string(&response) else {
            continue;
        };
        if socket.send(Message::Text(text.into())).await.is_err() {
            break;
        }
    }
}

async fn subscribe<TCtx, TCtxFn, TCtxFnMarker, TState>(
    procedures: Arc<Procedures<TCtx>>,
    ctx_fn: TCtxFn,
    parts: Parts,
    state: TState,
    id: Id,
    path: String,
    input: Value,
) -> BoxStream<'static, Response>
where
    TCtx: Send + Sync + 'static,
    TCtxFn: TCtxFunc<TCtx, TState, TCtxFnMarker>,
    TCtxFnMarker: Send + Sync + 'static,
    TState: Send + Sync + 'static,
{
    let Some(procedure) = procedures.get(path.as_str()) else {
        return stream::iter([Response::error(
            id,
            StatusCode::NOT_FOUND,
            json!(ProcedureError::NotFound),
        )])
        .boxed();
    };

    let Ok(ctx) = ctx_fn.exec(parts, &state).await else {
        return stream::iter([Response::error(
            id,
            StatusCode::INTERNAL_SERVER_ERROR,
            rspc_err_json!("failed to execute context function"),
        )])
        .boxed();
    };

    let procedure_stream = procedure.exec_with_deserializer(ctx, input);

    stream::unfold(Some(procedure_stream), move |procedure_stream| async move {
        let mut procedure_stream = procedure_stream?;
        let response = match next(&mut procedure_stream).await {
            Some(Ok(item)) => return Some((Response::Item { id, item }, Some(procedure_stream))),
            Some(Err(err)) => {
                let (status, data) = err.into_status_and_data();
                Response::error(id, status, data)
            }
            None => Response::Stopped { id, stopped: true },
        };
        Some((response, None))
    })
    .boxed()
}

#[cfg(test)]
mod test {
    use super::*;
    use rspc_procedure::{Procedure, ProcedureStream, ResolverError};
    use std::{borrow::Cow, convert::Infallible};

    fn procedures(procedure: Procedure<()>) -> Arc<Procedures<()>> {
        Arc::new(Procedures::new(
            HashMap::from([(Cow::Borrowed("p"), procedure)]),
            Default::default(),
        ))
    }

    async fn run(procedures: Arc<Procedures<()>>, path: &str) -> Vec<Value> {
        let parts = axum::http::Request::new(()).into_parts().0;
        subscribe(
            procedures,
            || (),
            parts,
            (),
            1,
            path.to_string(),
            Value::Null,
        )
        .await
        .map(|response| serde_json::to_value(response).unwrap())
        .collect()
        .await
    }

    #[tokio::test]
    async fn streams_each_item_then_stopped() {
        let procedure =
            Procedure::<()>::new(|_, _| ProcedureStream::from_stream(stream::iter([1, 2]).map(Ok)));

        assert_eq!(
            run(procedures(procedure), "p").await,
            vec![
                json!({ "id": 1, "item": 1 }),
                json!({ "id": 1, "item": 2 }),
                json!({ "id": 1, "stopped": true }),
            ]
        );
    }

    #[tokio::test]
    async fn an_error_ends_the_subscription() {
        let procedure = Procedure::<()>::new(|_, _| {
            ProcedureStream::from_stream(stream::iter([
                Ok(1),
                Err(ProcedureError::Resolver(ResolverError::new(
                    json!("error"),
                    None::<Infallible>,
                ))),
                Ok(3),
            ]))
        });

        assert_eq!(
            run(procedures(procedure), "p").await,
            vec![
                json!({ "id": 1, "item": 1 }),
                json!({ "id": 1, "error": { "status": 500, "data": "error" } }),
            ]
        );
    }

    #[tokio::test]
    async fn an_unknown_path_is_a_404() {
        let procedure = Procedure::new(|_: (), _| ProcedureStream::from_future(async { Ok(()) }));

        let responses = run(procedures(procedure), "missing").await;

        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0]["error"]["status"], 404);
        assert_eq!(responses[0]["error"]["data"]["~rspc"], true);
    }

    #[test]
    fn input_defaults_to_null() {
        let request: Request =
            serde_json::from_str(r#"{ "method": "subscribe", "id": 7, "path": "p" }"#).unwrap();
        assert!(matches!(
            request,
            Request::Subscribe {
                id: 7,
                input: Value::Null,
                ..
            }
        ));
    }
}
