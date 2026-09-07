use std::{
    borrow::Cow,
    collections::HashMap,
    fmt,
    ops::{Deref, DerefMut},
    sync::Arc,
};

use crate::{Procedure, State};

pub struct Procedures<TCtx> {
    // TODO: Probally `Arc` around map and share that with `State`?
    procedures: HashMap<Cow<'static, str>, Procedure<TCtx>>,
    state: Arc<State>,
}

impl<TCtx> Procedures<TCtx> {
    // TODO: Work out this API. I'm concerned how `rspc_devtools` and `rspc_tracing` fit into this.
    // TODO: Also accept `Into` maybe?
    pub fn new(procedures: HashMap<Cow<'static, str>, Procedure<TCtx>>, state: Arc<State>) -> Self {
        Self { procedures, state }
    }

    pub fn state(&self) -> &Arc<State> {
        &self.state
    }
}

impl<TCtx> Clone for Procedures<TCtx> {
    fn clone(&self) -> Self {
        Self {
            procedures: self.procedures.clone(),
            state: self.state.clone(),
        }
    }
}

impl<TCtx> Into<Procedures<TCtx>> for &Procedures<TCtx> {
    fn into(self) -> Procedures<TCtx> {
        self.clone()
    }
}

impl<TCtx> fmt::Debug for Procedures<TCtx> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_map().entries(self.procedures.iter()).finish()
    }
}

impl<TCtx> IntoIterator for Procedures<TCtx> {
    type Item = (Cow<'static, str>, Procedure<TCtx>);
    type IntoIter = std::collections::hash_map::IntoIter<Cow<'static, str>, Procedure<TCtx>>;

    fn into_iter(self) -> Self::IntoIter {
        self.procedures.into_iter()
    }
}

// impl<TCtx> FromIterator<(Cow<'static, str>, Procedure<TCtx>)> for Procedures<TCtx> {
//     fn from_iter<I: IntoIterator<Item = (Cow<'static, str>, Procedure<TCtx>)>>(iter: I) -> Self {
//         Self(iter.into_iter().collect())
//     }
// }

/// Read-only access to the procedure map; `Procedures` owns its `State`, so it cannot be
/// built from a bare map.
impl<TCtx> Deref for Procedures<TCtx> {
    type Target = HashMap<Cow<'static, str>, Procedure<TCtx>>;

    fn deref(&self) -> &Self::Target {
        &self.procedures
    }
}

impl<TCtx> DerefMut for Procedures<TCtx> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.procedures
    }
}
