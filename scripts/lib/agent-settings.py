#!/usr/bin/env python3
"""The flags every packaged agent starts with, read from their one source.

apps/macos-agent/Info.plist holds them for the Mac app (Support.swift reads it at launch).
The Linux wrapper and the Windows installer are generated from the same keys here, so the
three launchers cannot drift apart:

    agent-settings.py <Info.plist> get <Key>
    agent-settings.py <Info.plist> render <template>   # @Key@ -> value, to stdout

Every value is checked against the shape the agent accepts before it is written into a
shell script or an installer, so a stray quote in the plist cannot become code.
"""
import plistlib
import re
import sys

SHAPES = {
    "CitadelWorkspaceOrigin": r"https://[a-z0-9.-]+(:[0-9]{1,5})?",
    # Loopback only: the agent holds decrypted messages and an unauthenticated control plane.
    "CitadelAgentBind": r"127\.0\.0\.1:[0-9]{1,5}",
    "CitadelAgentDataDirectoryName": r"\.?[A-Za-z0-9_-]+",
    "CitadelAgentStunServers": r"[a-z0-9.-]+:[0-9]{1,5}(,[a-z0-9.-]+:[0-9]{1,5}){2}",
}


def load(path: str) -> dict:
    with open(path, "rb") as f:
        plist = plistlib.load(f)
    settings = {}
    for key, shape in SHAPES.items():
        value = plist.get(key)
        if not isinstance(value, str) or not re.fullmatch(shape, value):
            sys.exit(f"agent-settings: {path} has no usable {key}: {value!r}")
        settings[key] = value
    return settings


def render(settings: dict, template: str) -> str:
    def value(m: re.Match) -> str:
        if m.group(1) not in settings:
            sys.exit(f"agent-settings: the template names an unknown key @{m.group(1)}@")
        return settings[m.group(1)]

    out = re.sub(r"@([A-Za-z]+)@", value, template)
    return out


def main(argv: list) -> None:
    if len(argv) != 4 or argv[2] not in ("get", "render"):
        sys.exit("usage: agent-settings.py <Info.plist> get <Key> | render <template>")
    settings = load(argv[1])
    if argv[2] == "get":
        if argv[3] not in settings:
            sys.exit(f"agent-settings: no such key {argv[3]}; known: {', '.join(settings)}")
        print(settings[argv[3]])
    else:
        with open(argv[3], encoding="utf-8") as f:
            sys.stdout.write(render(settings, f.read()))


if __name__ == "__main__":
    main(sys.argv)
