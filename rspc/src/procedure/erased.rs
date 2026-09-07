use std::{borrow::Cow, fmt, panic::Location, sync::Arc};

use specta::TypeCollection;

use crate::{procedure::ProcedureType, ProcedureKind, State};

pub struct ErasedProcedure<TCtx> {
    // Both take the procedure's key, which only the router knows, so `ProcedureMeta::name`
    // reports the real path rather than a placeholder.
    pub(crate) setup: Vec<Box<dyn FnOnce(&mut State, Cow<'static, str>) + 'static>>,
    pub(crate) location: Location<'static>,
    pub(crate) kind: ProcedureKind,
    pub(crate) inner: Box<
        dyn FnOnce(
            Cow<'static, str>,
            Arc<State>,
            &mut TypeCollection,
        ) -> (rspc_procedure::Procedure<TCtx>, ProcedureType),
    >,
}

impl<TCtx> fmt::Debug for ErasedProcedure<TCtx> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ErasedProcedure")
            .field("kind", &self.kind)
            .field("location", &self.location)
            .finish_non_exhaustive()
    }
}

impl<TCtx> ErasedProcedure<TCtx> {
    /// Whether this is a query, mutation or subscription.
    pub fn kind(&self) -> ProcedureKind {
        self.kind
    }

    /// Where the procedure was defined, for error reporting.
    pub fn location(&self) -> &Location<'static> {
        &self.location
    }

    // /// Export the [Specta](https://docs.rs/specta) types for this procedure.
    // ///
    // /// TODO - Use this with `rspc::typescript`
    // ///
    // /// # Usage
    // ///
    // /// ```rust
    // /// todo!(); # TODO: Example
    // /// ```
    // pub fn ty(&self) -> &ProcedureTypeDefinition {
    //     &self.ty
    // }

    // /// Execute a procedure with the given context and input.
    // ///
    // /// This will return a [`ProcedureStream`] which can be used to stream the result of the procedure.
    // ///
    // /// # Usage
    // ///
    // /// ```rust
    // /// use serde_json::Value;
    // ///
    // /// fn run_procedure(procedure: Procedure) -> Vec<Value> {
    // ///     procedure
    // ///         .exec((), Value::Null)
    // ///         .collect::<Vec<_>>()
    // ///         .await
    // ///         .into_iter()
    // ///         .map(|result| result.serialize(serde_json::value::Serializer).unwrap())
    // ///         .collect::<Vec<_>>()
    // /// }
    // /// ```
    // pub fn exec<'de, T: ProcedureInput<'de>>(
    //     &self,
    //     ctx: TCtx,
    //     input: T,
    // ) -> Result<ProcedureStream, InternalError> {
    //     match input.into_deserializer() {
    //         Ok(deserializer) => {
    //             let mut input = <dyn erased_serde::Deserializer>::erase(deserializer);
    //             (self.handler)(ctx, &mut input)
    //         }
    //         Err(input) => (self.handler)(ctx, &mut AnyInput(Some(input.into_value()))),
    //     }
    // }
}
