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

## Using a hosted Citadel Workspace

When the web app is served from somewhere else (work.avarok.net, say), your
browser reaches this agent as `wss://local.avarok.net:12345` -- a name the
operator points at `127.0.0.1` and holds a certificate for. Tell the agent the
name and where to fetch the certificate:

```bash
./citadel-agent --bind 127.0.0.1:12345 --backend filesystem \
  --allowed-origins https://work.avarok.net \
  --loopback-host local.avarok.net \
  --loopback-cert-url https://work.avarok.net/agent
```

The certificate is fetched at start (with `curl`) and cached beside your data,
so later starts work offline. It is renewed every ninety days on the operator's
side; you never handle it. The private key it comes with is public by
construction -- the name resolves to your own machine, so there is no network
between the browser and the agent to protect -- it exists to make the browser
willing to open the socket. What protects the socket is `--allowed-origins`
and the agent refusing any `Host` that is not its own.

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
