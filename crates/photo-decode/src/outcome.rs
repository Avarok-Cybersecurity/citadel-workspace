//! What a decode is asked for and what it answers. Pure data; no format knowledge.

/// The page's decode caps (image-preview.ts holds the numbers; they are passed in, never
/// repeated here). Anything over either is refused before a pixel buffer is allocated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub max_pixels: u64,
    pub max_edge: u32,
}

impl Limits {
    /// Whether a `width` x `height` picture fits; zero-sized pictures never do.
    pub fn fits(&self, width: u32, height: u32) -> bool {
        width > 0
            && height > 0
            && width <= self.max_edge
            && height <= self.max_edge
            && u64::from(width) * u64::from(height) <= self.max_pixels
    }

    pub fn check(&self, width: u32, height: u32) -> Result<(), Refusal> {
        if self.fits(width, height) {
            Ok(())
        } else {
            Err(Refusal::TooLarge { width, height })
        }
    }
}

/// How far to go: stop once the picture is found to fit (so the page may try the browser's own
/// decoder first), or decode it to pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Depth {
    Probe,
    Pixels,
}

/// A picture that fits the limits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Found {
    /// The picture fits; nothing decoded. `native` says whether the bytes as a whole are the
    /// picture a browser that knows the format would draw (so drawing them natively is right).
    Fits {
        width: u32,
        height: u32,
        native: bool,
    },
    /// Straight RGBA, row-major, `width * height * 4` bytes, to be drawn rotated by EXIF
    /// `orientation` (1-8). `opaque` when every alpha is 255.
    Rgba {
        width: u32,
        height: u32,
        orientation: u8,
        opaque: bool,
        data: Vec<u8>,
    },
    /// A baseline or progressive JPEG cut out of the file (a camera RAW's preview), to be drawn
    /// rotated by EXIF `orientation` (1-8), which the JPEG itself usually does not carry.
    Jpeg {
        width: u32,
        height: u32,
        orientation: u8,
        data: Vec<u8>,
    },
}

/// Why a picture is not shown. Each maps to one sentence and one next step on the page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal {
    /// Over the limits: a decompression bomb, or a photo bigger than a preview is drawn at.
    TooLarge { width: u32, height: u32 },
    /// A well-formed file using something this decoder does not implement.
    Unsupported(String),
    /// Not a well-formed file of a format this decoder reads.
    Malformed(String),
}
