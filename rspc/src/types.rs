use std::{borrow::Cow, collections::BTreeMap, fmt};

use specta::TypeCollection;

use crate::procedure::ProcedureType;

#[derive(Clone)]
pub(crate) enum TypesOrType {
    Type(ProcedureType),
    Types(BTreeMap<Cow<'static, str>, TypesOrType>),
}

/// The type information for every procedure on a [`Router`](crate::Router), produced by
/// [`Router::build`](crate::Router::build) and consumed by an exporter.
pub struct Types {
    pub(crate) types: TypeCollection,
    pub(crate) procedures: BTreeMap<Cow<'static, str>, TypesOrType>,
}

impl Types {
    /// Every type referenced by a procedure, for exporters that need to emit them.
    pub fn types(&self) -> &TypeCollection {
        &self.types
    }

    /// The dotted path of every procedure, in a stable order.
    pub fn procedure_names(&self) -> Vec<String> {
        fn collect(out: &mut Vec<String>, prefix: &str, item: &TypesOrType) {
            match item {
                TypesOrType::Type(_) => out.push(prefix.to_string()),
                TypesOrType::Types(map) => {
                    for (key, item) in map {
                        let path = if prefix.is_empty() {
                            key.to_string()
                        } else {
                            format!("{prefix}.{key}")
                        };
                        collect(out, &path, item);
                    }
                }
            }
        }

        let mut out = Vec::new();
        collect(&mut out, "", &TypesOrType::Types(self.procedures.clone()));
        out
    }
}

impl fmt::Debug for Types {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Types")
            .field("procedures", &self.procedure_names())
            .finish_non_exhaustive()
    }
}
