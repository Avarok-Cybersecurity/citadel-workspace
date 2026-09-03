#!/usr/bin/env python3
"""Emit a compose file that declares only the named service.

deploy.sh deploys every service its compose file declares, and
select-deploy-services.sh intersects that with the deployable set. A
server-only tenant is therefore expressed as a compose file that declares
only `server` -- which is the path deploy.sh already anticipates, in its own
words, when it looks for "the services a slimmed deployment DROPPED".

Generated from the canonical file rather than maintained as a second one:
two hand-kept compose files drift, and the direction they drift in is a
production service configured differently from the one anybody reviews.

Anything outside the `services:` map is passed through untouched, including
`volumes:`. An unused volume declaration costs nothing; dropping one that a
later topology change needs would silently orphan its data.
"""
import re
import sys

SERVICE_KEY = re.compile(r"^  ([A-Za-z0-9_.-]+):\s*$")


def trim(text: str, keep: str) -> str:
    out: list[str] = []
    in_services = False
    mode = "head"
    for line in text.split("\n"):
        if line.rstrip() == "services:":
            in_services, mode = True, "head"
            out.append(line)
            continue
        if in_services:
            match = SERVICE_KEY.match(line)
            if match:
                mode = "keep" if match.group(1) == keep else "drop"
            # A non-indented, non-comment line ends the services map.
            if line and not line.startswith(" ") and not line.startswith("#"):
                in_services, mode = False, "head"
                out.append(line)
                continue
            if mode != "drop":
                out.append(line)
            continue
        out.append(line)
    return "\n".join(out)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: trim-compose.py <compose-file> <service-to-keep>", file=sys.stderr)
        return 2
    path, keep = sys.argv[1], sys.argv[2]
    text = open(path, encoding="utf-8").read()
    result = trim(text, keep)
    # A trim that kept nothing is a silent, total failure: deploy.sh would then
    # report "nothing to deploy" as a successful no-op. Refuse instead.
    if not re.search(rf"^  {re.escape(keep)}:\s*$", result, re.M):
        print(f"trim-compose: '{keep}' is not a service in {path}", file=sys.stderr)
        return 1
    sys.stdout.write(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
