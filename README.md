# Citadel Workspaces

## Testing

In terminal 1 (Internal Service):

```bash
just is
```

In terminal 2 (Server Kernel):

```bash
just server
```

In terminal 3 (Client/GUI):

```bash
just ui
```

When the UI opens, it has the internal service hardcoded to 127.0.0.1:12345 and will connect there automatically on start. The server is bound to 127.0.0.1:12349, so when testing, the server's address should be used as the internal service acts as a smart proxy between the client/GUI and the server.