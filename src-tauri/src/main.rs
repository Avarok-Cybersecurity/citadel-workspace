fn main() {
    #[cfg(desktop)] // only include this code on debug builds
    citadel_workspace::run();
}
