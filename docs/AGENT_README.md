# Citadel agent

This is the local agent (the "internal service") that Citadel Workspace talks
to. It owns your protocol connections: the browser never speaks the Citadel
protocol directly, it speaks to this process over a WebSocket on your own
machine.

Nothing here phones home on its own. The agent connects where you tell it to.

## Running it

```bash
./citadel-agent --bind 127.0.0.1:12345 --backend filesystem --allowed-origins https://work.avarok.net
```

Then reload Citadel Workspace in your browser.

Both flags matter:

- **`--bind` has no default.** Run the agent with no arguments and it exits with
  a usage error rather than starting. `127.0.0.1:12345` is what the web app
  expects; bind to `127.0.0.1` rather than `0.0.0.0` unless you intend other
  machines on your network to reach it.
- **`--allowed-origins` names the web app that may drive this agent.** A
  WebSocket is exempt from the browser's same-origin policy, so without this
  list ANY page you visit could open a connection to your agent and act as you.
  Put the origin you load Citadel Workspace from -- `https://work.avarok.net`
  above; `http://localhost:5291` if you run the UI locally -- and nothing else.
  The agent refuses to start without it. `INTERNAL_SERVICE_ALLOWED_ORIGINS` in
  the environment does the same and takes precedence.
- **`--backend filesystem` persists your account.** The default backend is
  in-memory, which is right for tests and wrong for you: without this flag your
  account and message history are gone the next time the agent restarts. Data
  is written to `./internal-service-data` unless `--data-dir` says otherwise.

## That directory is your account

Not a cache. Your account's identity and key material live there, on your
machine — a Citadel account is not a row on a server that a password can
retrieve.

The consequences are worth knowing before you rely on it:

- **Signing in works only from the machine you registered on**, with the same
  data directory. From anywhere else the agent answers "Client does not exist",
  because it has never heard of the account — the server is not even consulted.
- **Registering again is not a way back in.** It creates a SEPARATE account with
  a new identity. Anyone who had already connected to you still points at the
  old one, so you would be a stranger to your own contacts.
- **Keep the directory if you move machines**, and back it up as you would an
  SSH key or a password manager's vault. It is the same kind of secret.

If you run the agent from a temporary folder, or delete `./internal-service-data`
between sessions, you are creating a new account every time.

## Windows

```powershell
.\citadel-agent.exe --bind 127.0.0.1:12345 --backend filesystem --allowed-origins https://work.avarok.net
```

## Checking it is up

The web app tells you — the "unable to reach the connection service" notice
clears once the agent is listening. From a terminal:

```bash
nc -z 127.0.0.1 12345 && echo "agent is listening"
```

If `nc` is not installed:

```bash
curl -sS --max-time 2 http://127.0.0.1:12345 >/dev/null 2>&1; \
  [ $? -ne 7 ] && echo "agent is listening"
```

(The agent speaks WebSocket, not HTTP, so curl will not get a useful reply — but
exit code 7 is specifically "failed to connect", which is the question being
asked.)

## Verifying your download

Each release ships a `.sha256` beside every archive. Run this in the directory
holding both files:

```bash
# macOS
shasum -a 256 -c citadel-agent-<platform>.tar.gz.sha256

# Linux (shasum is Perl-based and not always installed)
sha256sum -c citadel-agent-<platform>.tar.gz.sha256
```

Both print `OK`. Anything else means the download is not the file that was
published, and you should not run it.
