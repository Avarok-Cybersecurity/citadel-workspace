//! A bounds-checked walk over a TIFF file's image directories: the main chain and each
//! directory's SubIFDs. Camera RAW files (DNG, CR2, NEF, ARW) are TIFF containers, and where they
//! keep their JPEG previews is in these directories. Reads only the tags a preview needs; every
//! offset is checked against the file, every count against a small bound, and a directory is
//! visited once however the file links them.

pub const IMAGE_WIDTH: u16 = 0x0100;
pub const IMAGE_LENGTH: u16 = 0x0101;
pub const BITS_PER_SAMPLE: u16 = 0x0102;
pub const COMPRESSION: u16 = 0x0103;
pub const PHOTOMETRIC: u16 = 0x0106;
pub const STRIP_OFFSETS: u16 = 0x0111;
pub const ORIENTATION: u16 = 0x0112;
pub const SAMPLES_PER_PIXEL: u16 = 0x0115;
pub const STRIP_BYTE_COUNTS: u16 = 0x0117;
pub const PLANAR_CONFIGURATION: u16 = 0x011C;
pub const SUB_IFDS: u16 = 0x014A;
pub const JPEG_OFFSET: u16 = 0x0201;
pub const JPEG_LENGTH: u16 = 0x0202;

/// The most directories read from one file, and entries from one directory.
const MAX_DIRECTORIES: usize = 64;
const MAX_ENTRIES: usize = 512;
/// The most values read for one tag (BitsPerSample has a few; StripOffsets may have many).
const MAX_VALUES: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Endian {
    Little,
    Big,
}

pub struct Tiff<'a> {
    pub bytes: &'a [u8],
    pub endian: Endian,
    pub first: u32,
}

/// One directory: its tags' values (SHORT or LONG, at most MAX_VALUES each), and where it sits
/// in the main chain (`None` for a SubIFD).
#[derive(Debug, Clone, Default)]
pub struct Directory {
    pub chain_index: Option<usize>,
    tags: Vec<(u16, Vec<u32>)>,
}

impl Directory {
    pub fn values(&self, tag: u16) -> Option<&[u32]> {
        self.tags
            .iter()
            .find(|(t, _)| *t == tag)
            .map(|(_, v)| v.as_slice())
    }

    pub fn first(&self, tag: u16) -> Option<u32> {
        self.values(tag).and_then(|v| v.first().copied())
    }
}

impl<'a> Tiff<'a> {
    /// The header: byte order, the magic 42, and the first directory's offset. CR2's "CR" marker
    /// at byte 8 needs no special case; it sits after the header.
    pub fn open(bytes: &'a [u8]) -> Option<Tiff<'a>> {
        let endian = match bytes.get(0..4)? {
            [b'I', b'I', 42, 0] => Endian::Little,
            [b'M', b'M', 0, 42] => Endian::Big,
            _ => return None,
        };
        let mut tiff = Tiff {
            bytes,
            endian,
            first: 0,
        };
        tiff.first = tiff.u32_at(4)?;
        Some(tiff)
    }

    pub fn u16_at(&self, at: usize) -> Option<u16> {
        let b: [u8; 2] = self.bytes.get(at..at.checked_add(2)?)?.try_into().ok()?;
        Some(match self.endian {
            Endian::Little => u16::from_le_bytes(b),
            Endian::Big => u16::from_be_bytes(b),
        })
    }

    pub fn u32_at(&self, at: usize) -> Option<u32> {
        let b: [u8; 4] = self.bytes.get(at..at.checked_add(4)?)?.try_into().ok()?;
        Some(match self.endian {
            Endian::Little => u32::from_le_bytes(b),
            Endian::Big => u32::from_be_bytes(b),
        })
    }

    /// Every directory reachable from the header, main chain first, each at most once.
    pub fn directories(&self) -> Vec<Directory> {
        let mut seen: Vec<u32> = Vec::new();
        let mut out: Vec<Directory> = Vec::new();
        let mut next = self.first;
        let mut index = 0usize;
        while next != 0 && out.len() < MAX_DIRECTORIES && !seen.contains(&next) {
            seen.push(next);
            let Some((mut dir, following)) = self.directory(next) else {
                break;
            };
            dir.chain_index = Some(index);
            index += 1;
            let subs: Vec<u32> = dir
                .values(SUB_IFDS)
                .map(<[u32]>::to_vec)
                .unwrap_or_default();
            out.push(dir);
            for sub in subs {
                if out.len() >= MAX_DIRECTORIES || seen.contains(&sub) {
                    continue;
                }
                seen.push(sub);
                if let Some((dir, _)) = self.directory(sub) {
                    out.push(dir);
                }
            }
            next = following;
        }
        out
    }

    /// The directory at `at`, and the offset of the next one in its chain (0 for none).
    fn directory(&self, at: u32) -> Option<(Directory, u32)> {
        let at = usize::try_from(at).ok()?;
        let count = usize::from(self.u16_at(at)?);
        if count > MAX_ENTRIES {
            return None;
        }
        let mut dir = Directory::default();
        for i in 0..count {
            let entry = at.checked_add(2 + i * 12)?;
            if let Some(tag) = self.entry(entry) {
                dir.tags.push(tag);
            }
        }
        let next = self.u32_at(at.checked_add(2 + count * 12)?).unwrap_or(0);
        Some((dir, next))
    }

    /// One 12-byte entry, when its type is SHORT (3), LONG (4) or IFD (13).
    fn entry(&self, at: usize) -> Option<(u16, Vec<u32>)> {
        let tag = self.u16_at(at)?;
        let kind = self.u16_at(at + 2)?;
        let count = usize::try_from(self.u32_at(at + 4)?).ok()?.min(MAX_VALUES);
        let size = match kind {
            3 => 2,
            4 | 13 => 4,
            _ => return None,
        };
        let inline = count * size <= 4;
        let base = if inline {
            at + 8
        } else {
            usize::try_from(self.u32_at(at + 8)?).ok()?
        };
        let mut values = Vec::with_capacity(count);
        for i in 0..count {
            let p = base.checked_add(i * size)?;
            values.push(if size == 2 {
                u32::from(self.u16_at(p)?)
            } else {
                self.u32_at(p)?
            });
        }
        Some((tag, values))
    }
}
