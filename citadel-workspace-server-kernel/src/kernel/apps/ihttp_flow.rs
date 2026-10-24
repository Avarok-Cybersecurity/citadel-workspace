//! One relayed internal-HTTP stream's flow (R4.4), pure: which frame each side may send next,
//! body chunks only against credit the other side granted, bodies within their declared length
//! and the caps and, at `End`, all of a declared length, and when the stream is over. Credit is
//! the receiver's buffer space, one chunk per unit, and may be granted before the response head.

use citadel_ihttp_types::{
    IhttpFrameKind, INITIAL_CREDIT, MAX_REQUEST_BODY_BYTES, MAX_RESPONSE_BODY_BYTES,
};

/// Which end of the stream sent a frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    /// The caller, who sent the `RequestHead`.
    Client,
    /// The serving host.
    Server,
}

/// A frame the stream's state does not admit from that side.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FlowFault {
    /// A head that is not this side's, or a second one, or a body before the response head.
    OutOfOrder,
    /// A body chunk without credit.
    NoCredit,
    /// More body than declared, or than the cap.
    TooLarge,
    /// An `End` before the body reached the length its head declared.
    ShortBody,
    /// Anything after this side's `End` but `Credit` for the other side, or a `Cancel`.
    AfterEnd,
}

/// One direction: what its sender may still send.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Flow {
    credit: u32,
    bytes: u64,
    cap: u64,
    declared: Option<u64>,
    head: bool,
    ended: bool,
}

impl Flow {
    fn new(cap: u64, declared: Option<u64>, head: bool) -> Self {
        Self {
            credit: INITIAL_CREDIT,
            bytes: 0,
            cap: declared.map_or(cap, |d| d.min(cap)),
            declared,
            head,
            ended: false,
        }
    }

    fn body(&mut self, len: usize) -> Result<(), FlowFault> {
        if !self.head {
            return Err(FlowFault::OutOfOrder);
        }
        if self.credit == 0 {
            return Err(FlowFault::NoCredit);
        }
        let bytes = self.bytes + len as u64;
        if bytes > self.cap {
            return Err(FlowFault::TooLarge);
        }
        self.credit -= 1;
        self.bytes = bytes;
        Ok(())
    }
}

/// Both directions of one stream, opened by its `RequestHead`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamFlow {
    request: Flow,
    response: Flow,
    cancelled: bool,
}

/// The most credit one direction may hold unspent; a grant past it is refused.
pub const MAX_OUTSTANDING_CREDIT: u32 = 1024;

impl StreamFlow {
    /// A stream whose `RequestHead` declared `body_len`.
    pub fn opened(body_len: Option<u64>) -> Self {
        Self {
            request: Flow::new(MAX_REQUEST_BODY_BYTES, body_len, true),
            response: Flow::new(MAX_RESPONSE_BODY_BYTES, None, false),
            cancelled: false,
        }
    }

    /// Admit `kind` from `side`, updating the state; `Err` leaves the state as it was.
    pub fn admit(&mut self, side: Side, kind: &IhttpFrameKind) -> Result<(), FlowFault> {
        let mut next = self.clone();
        let (own, other) = match side {
            Side::Client => (&mut next.request, &mut next.response),
            Side::Server => (&mut next.response, &mut next.request),
        };
        // An end that finished sending may still grant credit and still give up waiting.
        let still_admitted = matches!(
            kind,
            IhttpFrameKind::Credit { .. } | IhttpFrameKind::Cancel { .. }
        );
        if own.ended && !still_admitted {
            return Err(FlowFault::AfterEnd);
        }
        match kind {
            IhttpFrameKind::RequestHead { .. } => return Err(FlowFault::OutOfOrder),
            IhttpFrameKind::ResponseHead { body_len, .. } => {
                if side != Side::Server || own.head {
                    return Err(FlowFault::OutOfOrder);
                }
                // Credit the caller granted before the head is the caller's buffer, still free.
                let credit = own.credit;
                *own = Flow::new(MAX_RESPONSE_BODY_BYTES, *body_len, true);
                own.credit = credit;
            }
            IhttpFrameKind::Body { bytes } => own.body(bytes.len())?,
            IhttpFrameKind::End => {
                if !own.head {
                    return Err(FlowFault::OutOfOrder);
                }
                if own.declared.is_some_and(|declared| own.bytes < declared) {
                    return Err(FlowFault::ShortBody);
                }
                own.ended = true;
            }
            IhttpFrameKind::Cancel { .. } => next.cancelled = true,
            IhttpFrameKind::Credit { n } => {
                let credit = other.credit.saturating_add(*n);
                if credit > MAX_OUTSTANDING_CREDIT {
                    return Err(FlowFault::NoCredit);
                }
                other.credit = credit;
            }
        }
        *self = next;
        Ok(())
    }

    /// Both sides ended, or either cancelled.
    pub fn is_over(&self) -> bool {
        self.cancelled || (self.request.ended && self.response.ended)
    }

    /// Body bytes both sides have sent so far.
    pub fn body_bytes(&self) -> u64 {
        self.request.bytes + self.response.bytes
    }
}
