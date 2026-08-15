use super::{Completeness, HaddonError, HaddonResult, Outcome, OwnerKind, ResourceLink, Stage};
use std::io::{Cursor, Read};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;
use zip::ZipArchive;

pub(crate) const STATE_OPEN: u8 = 0;
pub(crate) const STATE_CLOSED: u8 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ByteRange {
    pub start: u64,
    pub end_exclusive: u64,
}

impl ByteRange {
    pub fn new(start: u64, end_exclusive: u64) -> Result<Self, HaddonError> {
        if end_exclusive < start {
            return Err(HaddonError::InvalidArgument {
                stage: Stage::Resource,
                field: "range".to_string(),
                message: "end_exclusive must be greater than or equal to start".to_string(),
            });
        }
        Ok(Self {
            start,
            end_exclusive,
        })
    }

    fn len(self) -> u64 {
        self.end_exclusive - self.start
    }
}

pub struct Resource {
    link: ResourceLink,
    archive_path: String,
    source: Arc<[u8]>,
    publication_state: Arc<AtomicU8>,
    closed: AtomicBool,
}

impl Resource {
    pub(crate) fn new(
        link: ResourceLink,
        archive_path: String,
        source: Arc<[u8]>,
        publication_state: Arc<AtomicU8>,
    ) -> Self {
        Self {
            link,
            archive_path,
            source,
            publication_state,
            closed: AtomicBool::new(false),
        }
    }

    pub fn link(&self) -> &ResourceLink {
        &self.link
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Acquire)
            || self.publication_state.load(Ordering::Acquire) != STATE_OPEN
    }

    pub fn length(&self) -> HaddonResult<Option<u64>> {
        self.ensure_open()?;
        let mut archive = self.open_archive()?;
        let file = archive
            .by_name(&self.archive_path)
            .map_err(|_| self.not_found())?;
        Ok(Outcome::complete(Some(file.size())))
    }

    pub fn read(&self, range: Option<ByteRange>) -> HaddonResult<Vec<u8>> {
        self.ensure_open()?;
        let mut archive = self.open_archive()?;
        let mut file = archive
            .by_name(&self.archive_path)
            .map_err(|_| self.not_found())?;

        let length = file.size();
        if let Some(range) = range {
            if range.end_exclusive < range.start || range.end_exclusive > length {
                return Err(HaddonError::InvalidArgument {
                    stage: Stage::Resource,
                    field: "range".to_string(),
                    message: format!(
                        "requested byte range [{}, {}) exceeds resource length {length}",
                        range.start, range.end_exclusive
                    ),
                });
            }

            std::io::copy(&mut (&mut file).take(range.start), &mut std::io::sink())
                .map_err(|error| self.read_failed(error))?;
            let mut bytes = Vec::with_capacity(range.len() as usize);
            (&mut file)
                .take(range.len())
                .read_to_end(&mut bytes)
                .map_err(|error| self.read_failed(error))?;
            if bytes.len() as u64 != range.len() {
                return Err(HaddonError::ResourceReadFailed {
                    href: self.link.href.clone(),
                    retryable: false,
                    message: "resource ended before the requested range was complete".to_string(),
                });
            }
            Ok(Outcome {
                value: bytes,
                completeness: Completeness::Complete,
                warnings: Vec::new(),
                coverage: None,
            })
        } else {
            let mut bytes = Vec::with_capacity(length as usize);
            file.read_to_end(&mut bytes)
                .map_err(|error| self.read_failed(error))?;
            Ok(Outcome::complete(bytes))
        }
    }

    pub fn close(&self) -> HaddonResult<()> {
        self.closed.store(true, Ordering::Release);
        Ok(Outcome::complete(()))
    }

    fn ensure_open(&self) -> Result<(), HaddonError> {
        if self.publication_state.load(Ordering::Acquire) != STATE_OPEN {
            return Err(HaddonError::Closed {
                stage: Stage::Resource,
                owner: OwnerKind::Publication,
            });
        }
        if self.closed.load(Ordering::Acquire) {
            return Err(HaddonError::Closed {
                stage: Stage::Resource,
                owner: OwnerKind::Resource,
            });
        }
        Ok(())
    }

    fn open_archive(&self) -> Result<ZipArchive<Cursor<&[u8]>>, HaddonError> {
        ZipArchive::new(Cursor::new(self.source.as_ref())).map_err(|error| {
            HaddonError::ContainerCorrupt {
                message: error.to_string(),
            }
        })
    }

    fn not_found(&self) -> HaddonError {
        HaddonError::ResourceNotFound {
            href: self.link.href.clone(),
        }
    }

    fn read_failed(&self, error: std::io::Error) -> HaddonError {
        HaddonError::ResourceReadFailed {
            href: self.link.href.clone(),
            retryable: false,
            message: error.to_string(),
        }
    }
}
