use std::{borrow::Cow, sync::Arc};

// #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, specta::Type)]
// #[specta(rename_all = "camelCase")]
// pub enum ProcedureKind {
//     Query,
//     Mutation,
//     Subscription,
// }

// impl fmt::Display for ProcedureKind {
//     fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
//         match self {
//             Self::Query => write!(f, "Query"),
//             Self::Mutation => write!(f, "Mutation"),
//             Self::Subscription => write!(f, "Subscription"),
//         }
//     }
// }

use crate::{ProcedureKind, State};

#[derive(Debug, Clone)]
pub struct ProcedureMeta {
    name: Arc<str>,
    kind: ProcedureKind,
    state: Arc<State>,
}

impl ProcedureMeta {
    pub(crate) fn new(name: Cow<'static, str>, kind: ProcedureKind, state: Arc<State>) -> Self {
        Self {
            name: name.into_owned().into(),
            kind,
            state,
        }
    }
}

impl ProcedureMeta {
    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn kind(&self) -> ProcedureKind {
        self.kind
    }

    pub fn state(&self) -> &Arc<State> {
        &self.state
    }
}
