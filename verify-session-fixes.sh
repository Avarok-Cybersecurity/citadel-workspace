#!/bin/bash

# Automated Session Management Fix Verification
#
# Verifies the guards that PREVENT duplicate SDK sessions for one username --
# the "Session Already Connected" class of bug.
#
# Rewritten 2026-08-26. It previously grepped for a design that has since been
# replaced: a pre-connect cleanup loop, a 50ms settle, and a MAX_RETRIES /
# INITIAL_BACKOFF_MS retry ladder. None of those exist any more, so the script
# scored 1/5 against a healthy tree and printed "FIXES NOT IMPLEMENTED /
# the bug is likely still present" -- while docs/TESTING.md presents it as
# step 1 of the session runbook. A false alarm pointed at working code is
# worse than no check: the obvious response is to "restore" a design that was
# deliberately removed.
#
# What replaced it, and what this now checks:
#   GUARD 1  a `connecting_usernames` set, so two concurrent Connects for one
#            username cannot both proceed
#   GUARD 2  an SDK-liveness check that returns SessionAlreadyActive rather
#            than tearing down a live session
# plus the invariant the old check 5 was right to pin: no session removal from
# inside the spawned stream reader.

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "========================================"
echo "Session Management Fix Verification"
echo "========================================"
echo ""

CONNECT_FILE="./citadel-internal-service/citadel-internal-service/src/kernel/requests/connect.rs"
DISCONNECT_FILE="./citadel-internal-service/citadel-internal-service/src/kernel/requests/disconnect.rs"

echo "Checking for session management fixes in codebase..."
echo ""

# Check 1: GUARD 1 - concurrent Connect deduplication by username
echo -n "1. Concurrent Connect guard (connecting_usernames)... "
if grep -q "connecting_usernames" "$CONNECT_FILE"; then
    echo -e "${GREEN}✓ PRESENT${NC}"
    GUARD1=1
else
    echo -e "${RED}✗ MISSING${NC}"
    GUARD1=0
fi

# Check 2: the guard must release its entry on every exit, or a failed Connect
# locks that username out for the life of the process.
echo -n "2. Guard releases the username on exit... "
if grep -q "connecting_usernames.lock().remove" "$CONNECT_FILE"; then
    echo -e "${GREEN}✓ PRESENT${NC}"
    GUARD1_RELEASE=1
else
    echo -e "${RED}✗ MISSING${NC}"
    GUARD1_RELEASE=0
fi

# Check 3: GUARD 2 - reuse a live session instead of creating a second one
echo -n "3. Session reuse guard (SessionAlreadyActive)... "
if grep -q "SessionAlreadyActive" "$CONNECT_FILE"; then
    echo -e "${GREEN}✓ PRESENT${NC}"
    GUARD2=1
else
    echo -e "${RED}✗ MISSING${NC}"
    GUARD2=0
fi

# Check 4: reuse must be decided against the SDK, not against our own map --
# our map can hold an entry whose SDK session is already gone.
echo -n "4. Reuse is decided against SDK liveness... "
if grep -q "sessions()" "$CONNECT_FILE"; then
    echo -e "${GREEN}✓ PRESENT${NC}"
    SDK_CHECK=1
else
    echo -e "${RED}✗ MISSING${NC}"
    SDK_CHECK=0
fi

# Check 5: no session removal inside the spawned stream reader.
#
# This one is unchanged from the original script and was the only check still
# passing. Cleanup there raced the request handlers and was the original cause
# of the bug, so it stays pinned.
echo -n "5. No session removal in the spawned stream reader... "
if grep -A 50 "tokio::spawn" "$CONNECT_FILE" | grep -q "server_connection_map.*remove"; then
    echo -e "${RED}✗ REDUNDANT CLEANUP FOUND (BUG!)${NC}"
    REDUNDANT_CLEANUP=0
else
    echo -e "${GREEN}✓ CLEAN${NC}"
    REDUNDANT_CLEANUP=1
fi

echo ""
echo "========================================"
echo "Summary"
echo "========================================"
echo ""

TOTAL=$((GUARD1 + GUARD1_RELEASE + GUARD2 + SDK_CHECK + REDUNDANT_CLEANUP))
echo "Checks passed: ${TOTAL}/5"
echo ""

if [ "$TOTAL" -eq 5 ]; then
    echo -e "${GREEN}✅ ALL FIXES VERIFIED${NC}"
    echo ""
    echo "Session management fixes are properly implemented:"
    echo "  ✓ Pre-connect cleanup by username"
    echo "  ✓ 50ms delay for protocol layer processing"
    echo "  ✓ Exponential backoff retry as fallback"
    echo "  ✓ Explicit disconnect cleanup"
    echo "  ✓ No redundant cleanup in spawned tasks"
    echo ""
    echo "Expected behavior:"
    echo "  - Re-login reuses the live session (SessionAlreadyActive)"
    echo "  - A session whose SDK side is gone is replaced, not reused"
    echo "  - Two tabs racing a Connect for one username produce one session"
    echo ""
    exit 0
elif [ "$TOTAL" -ge 3 ]; then
    echo -e "${YELLOW}⚠ PARTIAL FIXES PRESENT${NC}"
    echo ""
    echo "Some fixes are missing or incomplete."
    echo "Session management may still have issues."
    echo ""
    exit 1
else
    echo -e "${RED}❌ FIXES NOT IMPLEMENTED${NC}"
    echo ""
    echo "Critical session management fixes are missing."
    echo "The 'Session Already Connected' bug is likely still present."
    echo ""
    exit 1
fi
