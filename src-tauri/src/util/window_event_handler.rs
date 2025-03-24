use tauri::{Window, WindowEvent};

// In an event handler:
pub(crate) fn on_window_event(_window: &Window, _event: &WindowEvent) {
    // Get a handle to the app so we can get the global state.
    // let app_handle = event.window().app_handle();
    //let state = app_handle.state::<Mutex<AppState>>();

    // Lock the mutex to mutably access the state.
    //let mut state = state.lock().unwrap();
    //state.counter += 1;
}
