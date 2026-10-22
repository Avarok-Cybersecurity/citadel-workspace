//! A reference implementation of the host side of citadel_app_abi_1, as the ABI text states it:
//! every group import exists; an ungranted group answers `{refused: "ungranted"}` to every call
//! without reading anything; a granted one bounds-checks, then answers a size limit, an unknown
//! op or bad arguments as refusals; the intrinsic capabilities are always held. Refusals and
//! `canvas`/`log` answer at once; every other granted call is PENDING until [`Instance::pump`]
//! resolves it and delivers `AppEvent::ReplyReady`, as a browser port would. Reply handles are
//! released by the first complete read. Fuel stands in for the watchdog, and the memory the host
//! constructs has the hard maximum.

pub use crate::remote::IhttpRemote;
use crate::remote::Remote;
use crate::state::{group_call, reply_len, reply_read};
pub use crate::state::{Limits, State};
use citadel_app_sdk_types::abi::{EXPORT_CLOSE, MEMORY, NAMESPACE, REPLY_LEN, REPLY_READ};
use citadel_app_sdk_types::{
    encode, AppContext, AppEvent, Capability, CloseReason, Group, LifecycleState, LifecycleStep,
};
use std::collections::BTreeMap;
use wasmi::{Caller, Config, Engine, Linker, Memory, MemoryType, Module, Store, TypedFunc};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Trap {
    OutOfFuel,
    Other(String),
}

pub struct Instance {
    store: Store<State>,
    memory: Memory,
    alloc: TypedFunc<i32, i32>,
    free: TypedFunc<(i32, i32), ()>,
    init: TypedFunc<(i32, i32), i32>,
    event: TypedFunc<(i32, i32), ()>,
    frame: Option<TypedFunc<i32, ()>>,
    close: TypedFunc<i32, i32>,
}

fn trap(e: wasmi::Error) -> Trap {
    if e.as_trap_code() == Some(wasmi::TrapCode::OutOfFuel) {
        Trap::OutOfFuel
    } else {
        Trap::Other(e.to_string())
    }
}

impl Instance {
    /// Instantiate `wasm` with every ABI import, a memory of `initial_pages..max_memory_pages`.
    pub fn new(
        wasm: &[u8],
        initial_pages: u32,
        granted: &[Capability],
        limits: Limits,
    ) -> Instance {
        let mut config = Config::default();
        config.consume_fuel(true);
        let engine = Engine::new(&config);
        let module = Module::new(&engine, wasm).expect("a valid module");
        let state = State {
            granted: granted.to_vec(),
            limits,
            memory: None,
            replies: BTreeMap::new(),
            to_resolve: vec![],
            next_handle: 1,
            remote: limits.ihttp_remote.map(Remote::new),
            inbound: vec![],
            log: vec![],
            calls: vec![],
            lifecycle: LifecycleState::Created,
            kv: BTreeMap::new(),
        };
        let mut store = Store::new(&engine, state);
        store.set_fuel(limits.fuel_per_call).expect("fuel is on");
        let ty = MemoryType::new(initial_pages, Some(limits.max_memory_pages));
        let memory = Memory::new(&mut store, ty).expect("the memory fits");
        store.data_mut().memory = Some(memory);
        let mut linker = Linker::<State>::new(&engine);
        linker.define(NAMESPACE, MEMORY, memory).unwrap();
        for &group in Group::ALL {
            let f = move |c: Caller<'_, State>, op: i32, ptr: i32, len: i32| {
                group_call(c, group, op, ptr, len)
            };
            linker.func_wrap(NAMESPACE, group.import_name(), f).unwrap();
        }
        linker.func_wrap(NAMESPACE, REPLY_READ, reply_read).unwrap();
        linker.func_wrap(NAMESPACE, REPLY_LEN, reply_len).unwrap();
        let inst = linker
            .instantiate_and_start(&mut store, &module)
            .expect("instantiates");
        Instance {
            alloc: inst.get_typed_func(&store, "app_alloc").unwrap(),
            free: inst.get_typed_func(&store, "app_free").unwrap(),
            init: inst.get_typed_func(&store, "app_init").unwrap(),
            event: inst.get_typed_func(&store, "app_event").unwrap(),
            frame: inst.get_typed_func(&store, "app_frame").ok(),
            close: inst.get_typed_func(&store, EXPORT_CLOSE).unwrap(),
            store,
            memory,
        }
    }

    /// Fuel for the next call, except while closing: then the close grace's fuel is all there is.
    fn refuel(&mut self) {
        if self.store.data().lifecycle == LifecycleState::Closing {
            return;
        }
        let fuel = self.store.data().limits.fuel_per_call;
        self.store.set_fuel(fuel).expect("fuel is on");
    }

    /// Copy `bytes` into an `app_alloc` buffer, run `f` on it, then `app_free` it.
    fn with_buffer<R>(
        &mut self,
        bytes: &[u8],
        f: impl FnOnce(&mut Self, i32, i32) -> Result<R, Trap>,
    ) -> Result<R, Trap> {
        self.refuel();
        let len = bytes.len() as i32;
        let ptr = self.alloc.call(&mut self.store, len).map_err(trap)?;
        assert_ne!(ptr, 0, "app_alloc failed");
        let start = ptr as u32 as usize;
        self.memory.data_mut(&mut self.store)[start..start + bytes.len()].copy_from_slice(bytes);
        // The buffer is the host's to free; a reply the app has not read yet stays live.
        self.refuel();
        let out = f(self, ptr, len)?;
        self.free.call(&mut self.store, (ptr, len)).map_err(trap)?;
        Ok(out)
    }

    pub fn init(&mut self, ctx: &AppContext) -> Result<i32, Trap> {
        let got = self.with_buffer(&encode(ctx), |me, p, l| {
            me.init.call(&mut me.store, (p, l)).map_err(trap)
        });
        self.step(match got {
            Ok(0) => LifecycleStep::Initialised,
            _ => LifecycleStep::Abort,
        });
        got
    }

    /// The host's own lifecycle; a step it does not allow is a harness bug.
    fn step(&mut self, step: LifecycleStep) {
        let state = &mut self.store.data_mut().lifecycle;
        *state = state.step(step).unwrap_or_else(|e| panic!("{e:?}"));
    }

    /// Start the app: `AppEvent::Init`.
    pub fn start(&mut self) -> Result<(), Trap> {
        self.step(LifecycleStep::Start);
        self.event(&AppEvent::Init)
    }

    pub fn event(&mut self, event: &AppEvent) -> Result<(), Trap> {
        match event {
            AppEvent::Suspend { .. } => self.step(LifecycleStep::Suspend),
            AppEvent::Resume => self.step(LifecycleStep::Resume),
            _ => {}
        }
        let got = self.with_buffer(&encode(event), |me, p, l| {
            me.event.call(&mut me.store, (p, l)).map_err(trap)
        });
        if got.is_err() {
            self.step(LifecycleStep::Abort);
        }
        got
    }

    /// Close: `app_close(reason)` and then every reply it waits on, all inside the close grace's
    /// fuel. Answers what `app_close` answered; the instance is closed either way.
    pub fn close(&mut self, reason: CloseReason) -> Result<i32, Trap> {
        self.step(LifecycleStep::Close);
        let fuel = self.store.data().limits.close_grace_fuel;
        self.store.set_fuel(fuel).expect("fuel is on");
        let answered = self
            .close
            .call(&mut self.store, reason.code())
            .map_err(trap);
        let settled = answered.clone().and_then(|_| self.pump());
        self.step(match settled {
            Ok(()) => LifecycleStep::Settled,
            Err(_) => LifecycleStep::Abort,
        });
        settled.and(answered)
    }

    /// `app_close` called again, past the host's own refusal: what the guest itself answers.
    pub fn close_again(&mut self, reason: CloseReason) -> Result<i32, Trap> {
        self.refuel();
        self.close
            .call(&mut self.store, reason.code())
            .map_err(trap)
    }

    pub fn frame(&mut self, dt_ms: i32) -> Result<(), Trap> {
        self.refuel();
        let frame = self.frame.expect("app_frame is exported");
        frame.call(&mut self.store, dt_ms).map_err(trap)
    }

    /// Resolve every pending reply and deliver its `ReplyReady`, then every inbound event,
    /// until neither is left (a continuation may start more). Stops at the first trap.
    pub fn pump(&mut self) -> Result<(), Trap> {
        loop {
            let state = self.store.data_mut();
            let replies = std::mem::take(&mut state.to_resolve);
            let inbound = std::mem::take(&mut state.inbound);
            if replies.is_empty() && inbound.is_empty() {
                return Ok(());
            }
            for (handle, reply) in replies {
                self.store.data_mut().replies.insert(handle, Some(reply));
                self.event(&AppEvent::ReplyReady { handle })?;
            }
            for event in inbound {
                self.event(&event)?;
            }
        }
    }

    pub fn state(&self) -> &State {
        self.store.data()
    }

    pub fn memory_pages(&self) -> u64 {
        self.memory.size(&self.store)
    }

    /// The fixture's `probe=answer` log lines.
    pub fn report(&self) -> BTreeMap<String, String> {
        let lines = self.state().log.iter().filter_map(|l| l.split_once('='));
        lines.map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }
}
