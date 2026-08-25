# Citadel agent

This is the local agent (the "internal service") that Citadel Workspace talks
to. It owns your protocol connections: the browser never speaks the Citadel
protocol directly, it speaks to this process over a WebSocket on your own
machine.

Nothing here phones home on its own. The agent connects where you tell it to.

## Running it

```bash
./citadel-agent --bind 127.0.0.1:12345 --backend filesystem
```

Then reload Citadel Workspace in your browser.

Both flags matter:

- **`--bind` has no default.** Run the agent with no arguments and it exits with
  a usage error rather than starting. `127.0.0.1:12345` is what the web app
  expects; bind to `127.0.0.1` rather than `0.0.0.0` unless you intend other
  machines on your network to reach it.
- **`--backend filesystem` persists your account.** The default backend is
  in-memory, which is right for tests and wrong for you: without this flag your
  account and message history are gone the next time the agent restarts. Data
  is written to `./internal-service-data` unless `--data-dir` says otherwise.

## Windows

```powershell
.\citadel-agent.exe --bind 127.0.0.1:12345 --backend filesystem
```

## Checking it is up

The web app tells you — the "unable to reach the connection service" notice
clears once the agent is listening. From a terminal:

```bash
nc -z 127.0.0.1 12345 && echo "agent is listening"
```

## Verifying your download

Each release ships a `.sha256` beside every archive:

```bash
shasum -a 256 -c citadel-agent-<platform>.tar.gz.sha256
```
