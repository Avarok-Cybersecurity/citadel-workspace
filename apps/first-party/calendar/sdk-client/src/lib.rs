//! citadel-calendar-sdk: add, change, remove and read events in the member's Calendar from
//! another app (Calendar design §3.8).
//!
//! Every call goes to the Calendar in the member's own session, over internal HTTP: the app's
//! manifest lists `{"cap":"ihttp.call","targets":["net.avarok.calendar"]}`, its installer holds
//! `AppInstallAllowInternalCall`, and the member answers the Calendar's consent prompt the first
//! time the app changes their calendar. An app changes only the events it added, at the revision
//! it last saw; a call from an app in another member's session is refused (`CrossUser`).
//!
//! ```ignore
//! let calendar = Calendar::new(&ctx);
//! calendar.add_event(event, |app: &mut MyApp, added| match added {
//!     Ok(r) => app.saved(r.id, r.rev),
//!     Err(CalendarRefusal::NotConsented) => app.say("The member did not allow this."),
//!     Err(other) => app.say(&format!("{other:?}")),
//! });
//! ```

pub mod wire;

pub use calendar_core::sdk::{
    EventPatch, EventRef, EventView, Events, FreeBusy, FreeBusyQuery, Health, Include, ListQuery,
    NewEvent, Rev, UserBusy,
};
pub use wire::{CalendarRefusal, CalendarRequest, CALENDAR_APP_ID};

#[cfg(target_arch = "wasm32")]
mod calls;
#[cfg(target_arch = "wasm32")]
pub use calls::Calendar;

#[cfg(test)]
mod wire_fake;
#[cfg(test)]
mod wire_tests;
