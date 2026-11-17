#!/usr/bin/env python3
"""The flags every packaged agent starts with, read from their one source.

apps/macos-agent/Info.plist holds them for the Mac app (Support.swift reads it at launch).
The Linux wrapper and the Windows installer are generated from the same keys here, so the
three launchers cannot drift apart:

    agent-settings.py <Info.plist> get <Key>
    agent-settings.py <Info.plist> render <template>   # @Key@ -> value, to stdout
    agent-settings.py <Info.plist> launch-asset <template>   # citadel-agent-launch.json

`launch-asset` writes the release asset a tarball's updating agent reads (citadel-internal-
service's updater/launch_settings.rs): {"v":1,"settings":{"--flag":"value"}}, every flag the
Linux launcher template passes a release-wide value for (a `--flag '@Key@'` line), with that
key's value. The flags and their values are the launcher's, so the asset cannot drift from
what the packages start the agent with. The release signs it like every other asset.

Every value is checked against the shape the agent accepts before it is written into a
shell script or an installer, so a stray quote in the plist cannot become code.
"""
import json
import plistlib
import re
import sys

SHAPES = {
    "CitadelWorkspaceOrigin": r"https://[a-z0-9.-]+(:[0-9]{1,5})?",
    # Loopback only: the agent holds decrypted messages and an unauthenticated control plane.
    "CitadelAgentBind": r"127\.0\.0\.1:[0-9]{1,5}",
    "CitadelAgentDataDirectoryName": r"\.?[A-Za-z0-9_-]+",
    "CitadelAgentStunServers": r"[a-z0-9.-]+:[0-9]{1,5}(,[a-z0-9.-]+:[0-9]{1,5}){2}",
    # How long the portable identity stays unlocked: whole seconds above zero, as the agent takes it.
    "CitadelAgentIdentityUnlockIdleSecs": r"[1-9][0-9]{0,5}",
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


# A `--flag '@Key@' \` line of the launcher template.
LAUNCH_LINE = re.compile(r"^\s*(--[a-z0-9][a-z0-9-]*) '@([A-Za-z]+)@' \\$", re.M)
# The format the updater reads; it refuses any other.
LAUNCH_FORMAT = 1
# Never offered: structopt requires --bind, so every running agent was given it (perhaps as
# -b, which the updater cannot see as the same flag), and offering it could only repeat it.
NOT_OFFERED = {"--bind"}


def launch_asset(settings: dict, template: str) -> str:
    flags = {}
    for flag, key in LAUNCH_LINE.findall(template):
        if key not in settings:
            sys.exit(f"agent-settings: the template names an unknown key @{key}@")
        if flag not in NOT_OFFERED:
            flags[flag] = settings[key]
    if not flags:
        sys.exit("agent-settings: the template passes no release-wide setting; is it the launcher?")
    asset = {"v": LAUNCH_FORMAT, "settings": flags}
    return json.dumps(asset, sort_keys=True, separators=(",", ":")) + "\n"


def main(argv: list) -> None:
    if len(argv) != 4 or argv[2] not in ("get", "render", "launch-asset"):
        sys.exit("usage: agent-settings.py <Info.plist> get <Key> | render <template> | launch-asset <template>")
    settings = load(argv[1])
    if argv[2] == "get":
        if argv[3] not in settings:
            sys.exit(f"agent-settings: no such key {argv[3]}; known: {', '.join(settings)}")
        print(settings[argv[3]])
    else:
        with open(argv[3], encoding="utf-8") as f:
            template = f.read()
        out = render(settings, template) if argv[2] == "render" else launch_asset(settings, template)
        sys.stdout.write(out)


if __name__ == "__main__":
    main(sys.argv)
