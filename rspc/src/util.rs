// TODO: Move into `langauge/typescript.rs` once legacy stuff is removed

#[cfg(feature = "legacy")]
use std::borrow::Cow;

#[cfg(feature = "legacy")]
use specta::{datatype::DataType, SpectaID};

// TODO: Probally using `DataTypeFrom` stuff cause we shouldn't be using `specta::internal`
#[cfg(feature = "legacy")]
pub(crate) fn literal_object(
    name: Cow<'static, str>,
    sid: Option<SpectaID>,
    fields: impl Iterator<Item = (Cow<'static, str>, DataType)>,
) -> DataType {
    specta::internal::construct::r#struct(
        name,
        sid,
        Default::default(),
        specta::internal::construct::struct_named(
            fields
                .into_iter()
                .map(|(name, ty)| {
                    (
                        name.into(),
                        specta::internal::construct::field(false, false, None, "".into(), Some(ty)),
                    )
                })
                .collect(),
            None,
        ),
    )
    .into()
}
