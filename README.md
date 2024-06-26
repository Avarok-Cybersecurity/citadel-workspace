# Citadel Workspace

When it comes to virtual workspace security, don't slack. 

Citadel Workspace is a highly cryptographically post-quantum secure work environment for individuals, businesses, and government. By using The Citadel Protocol, a protocol far more secure and adjustable than Signal and other projects, Citadel Workspace technologically stands out. Whether used for casual messaging and/or transferring highly sensitive material (whether through messages or file transfers), Citadel Workspace allows additional layers of encryption to be seamlessly added. Additionally, Citadel Workspaces allows for optional per-message re-keying, the option of pre-shared keys, and much, much more.

All code is free and 100% open-source.

### Manual Install

Install `cargo install create-tauri-app`

Run `cargo install tauri-cli --version 2.0.0-beta.1`

Install Bun JS runtime dependencies `curl -fsSL https://bun.sh/install | bash`

Install JS dependencies `bun install`

## Running

### Running with just

You can use `just` to run this project automatically. Install `just` with:

```sh
cargo install just # using cargo

# or, alternatively
apt install just # for debian & ubuntu
brew install just # for MacOS
```

You'll need to add a `.env` file that includes a path to your local copy of the internal service repo:

```sh
INTERNAL_SERVICE_PATH = "/Users/johndoe/Avarok/citadel-internal-service" # <-- No trailing `/`
```

Then, run the following to open the app

```sh
just dev # run the complete tauri app
just dev-browser # run the tauri app in the browser
just -l # to list other options

```

### Manual Running

> Running the app from vscode's terminal can lead to an error, try running from your system terminal.

Run the desktop app with `cargo tauri dev`

Run the web app with `bun run dev`

Run Storybook server with `bun run sb`

> You will also need to start the citadel internal service servers
