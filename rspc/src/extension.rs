use std::{fmt, marker::PhantomData};

use rspc_procedure::State;

use crate::ProcedureMeta;

// TODO: `TError`?
// TODO: Explain executor order and why to use over `Middleware`?
pub struct Extension<TCtx, TInput, TResult> {
    pub(crate) setup: Option<Box<dyn FnOnce(&mut State, ProcedureMeta) + 'static>>,
    pub(crate) phantom: PhantomData<fn() -> (TCtx, TInput, TResult)>,
    // pub(crate) inner: Box<
    //     dyn FnOnce(
    //         MiddlewareHandler<TError, TNextCtx, TNextInput, TNextResult>,
    //     ) -> MiddlewareHandler<TError, TThisCtx, TThisInput, TThisResult>,
    // >,
}

impl<TCtx, TInput, TResult> fmt::Debug for Extension<TCtx, TInput, TResult> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Extension")
            .field("setup", &self.setup.is_some())
            .finish_non_exhaustive()
    }
}

impl<TCtx, TInput, TResult> Default for Extension<TCtx, TInput, TResult> {
    fn default() -> Self {
        Self::new()
    }
}

impl<TCtx, TInput, TResult> Extension<TCtx, TInput, TResult> {
    pub fn new() -> Self {
        Self {
            setup: None,
            phantom: PhantomData,
        }
    }

    /// Replaces any previously set function.
    pub fn setup(mut self, func: impl FnOnce(&mut State, ProcedureMeta) + 'static) -> Self {
        self.setup = Some(Box::new(func));
        self
    }
}
