#!/bin/bash

# Automated Session Management Fix Verification
# Verifies that the session management fixes are present in the code

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

# Check 1: Pre-connect cleanup by username
echo -n "1. Pre-connect cleanup by username (connect.rs:37-55)... "
if grep -q "Checking for existing sessions for user:" "$CONNECT_FILE" && \
   grep -q "Found .* existing session(s) for user" "$CONNECT_FILE" && \
   grep -q "server_map.remove(&cid)" "$CONNECT_FILE"; then
    echo -e "${GREEN}✓ PRESENT${NC}"
    PRECONNECT_CLEANUP=1
else
    echo -e "${RED}✗ MISSING${NC}"
    PRECONNECT_CLEANUP=0
fi

# Check 2: 50ms delay after cleanup
echo -n "2. 50ms delay after cleanup (connect.rs:58)... "
if grep -q "tokio::time::sleep.*Duration::from_millis(50)" "$CONNECT_FILE"; then
    echo -e "${GREEN}✓ PRESENT${NC}"
    DELAY=1
else
    echo -e "${RED}✗ MISSING${NC}"
    DELAY=0
fi

# Check 3: Exponential backoff retry as fallback
echo -n "3. Exponential backoff retry logic (connect.rs:60-62)... "
if grep -q "MAX_RETRIES" "$CONNECT_FILE" && \
   grep -q "INITIAL_BACKOFF_MS" "$CONNECT_FILE"; then
    echo -e "${GREEN}✓ PRESENT${NC}"
    RETRY_LOGIC=1
else
    echo -e "${RED}✗ MISSING${NC}"
    RETRY_LOGIC=0
fi

# Check 4: Disconnect cleanup
echo -n "4. Disconnect cleanup (disconnect.rs:24)... "
if grep -q "server_connection_map.*remove.*cid" "$DISCONNECT_FILE"; then
    echo -e "${GREEN}✓ PRESENT${NC}"
    DISCONNECT_CLEANUP=1
else
    echo -e "${RED}✗ MISSING${NC}"
    DISCONNECT_CLEANUP=0
fi

# Check 5: No redundant cleanup in spawned task
echo -n "5. No redundant cleanup in spawned stream reader... "
# Check that there's no server_connection_map.remove call in a spawned task context
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

TOTAL=$((PRECONNECT_CLEANUP + DELAY + RETRY_LOGIC + DISCONNECT_CLEANUP + REDUNDANT_CLEANUP))
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
    echo "  - On re-login: Old sessions removed before new connection"
    echo "  - No 'Session Already Connected' errors"
    echo "  - Minimal to no retry attempts needed"
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
