//! The page's one entry point. The file's bytes cross in once (`&[u8]` is one copy into this
//! module's memory) and the answer's bytes cross out once (`take_data`); everything else is a
//! number or a short sentence. The decode cannot throw: a refusal is an answer.

use crate::outcome::{Depth, Found, Limits, Refusal};
use wasm_bindgen::prelude::*;

/// What the answer is. The page's PhotoAnswerKind mirrors these numbers.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnswerKind {
    Fits = 0,
    Rgba = 1,
    Jpeg = 2,
    TooLarge = 3,
    Unsupported = 4,
    Malformed = 5,
}

#[wasm_bindgen]
pub struct Answer {
    kind: AnswerKind,
    width: u32,
    height: u32,
    orientation: u8,
    flag: bool,
    detail: String,
    data: Vec<u8>,
}

#[wasm_bindgen]
impl Answer {
    #[wasm_bindgen(getter)]
    pub fn kind(&self) -> AnswerKind {
        self.kind
    }
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }
    /// EXIF orientation (1-8) to draw `Rgba` or `Jpeg` with.
    #[wasm_bindgen(getter)]
    pub fn orientation(&self) -> u8 {
        self.orientation
    }
    /// `Fits`: the browser's own decoder may draw the file as it is. `Rgba`: every alpha is 255.
    #[wasm_bindgen(getter)]
    pub fn flag(&self) -> bool {
        self.flag
    }
    /// For a refusal, why, as a clause.
    #[wasm_bindgen(getter)]
    pub fn detail(&self) -> String {
        self.detail.clone()
    }
    /// The pixels or the JPEG, moved out (a second call answers empty).
    pub fn take_data(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.data)
    }
}

/// Decodes `bytes` within `max_pixels` and `max_edge`; with `pixels` false, stops once the
/// picture is known to fit (a RAW's JPEG preview is still cut out: it costs no decode).
#[wasm_bindgen]
pub fn decode_photo(bytes: &[u8], max_pixels: u32, max_edge: u32, pixels: bool) -> Answer {
    let limits = Limits {
        max_pixels: u64::from(max_pixels),
        max_edge,
    };
    let depth = if pixels { Depth::Pixels } else { Depth::Probe };
    answer(crate::decode(bytes, &limits, depth))
}

fn answer(result: Result<Found, Refusal>) -> Answer {
    let blank = |kind: AnswerKind| Answer {
        kind,
        width: 0,
        height: 0,
        orientation: 1,
        flag: false,
        detail: String::new(),
        data: Vec::new(),
    };
    match result {
        Ok(Found::Fits {
            width,
            height,
            native,
        }) => Answer {
            width,
            height,
            flag: native,
            ..blank(AnswerKind::Fits)
        },
        Ok(Found::Rgba {
            width,
            height,
            orientation,
            opaque,
            data,
        }) => Answer {
            width,
            height,
            orientation,
            flag: opaque,
            data,
            ..blank(AnswerKind::Rgba)
        },
        Ok(Found::Jpeg {
            width,
            height,
            orientation,
            data,
        }) => Answer {
            width,
            height,
            orientation,
            data,
            ..blank(AnswerKind::Jpeg)
        },
        Err(Refusal::TooLarge { width, height }) => Answer {
            width,
            height,
            ..blank(AnswerKind::TooLarge)
        },
        Err(Refusal::Unsupported(detail)) => Answer {
            detail,
            ..blank(AnswerKind::Unsupported)
        },
        Err(Refusal::Malformed(detail)) => Answer {
            detail,
            ..blank(AnswerKind::Malformed)
        },
    }
}
