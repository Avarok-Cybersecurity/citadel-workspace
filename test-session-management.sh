#!/bin/bash

# Session Management Lifecycle Test Script
# Tests the complete account lifecycle: create -> logout -> login
# Monitors internal-service logs for session management behavior

set -e

TIMESTAMP=$(date +%s)
USERNAME="testuser${TIMESTAMP}"
PASSWORD="test12345"
LOG_FILE="./logs/session-test-${TIMESTAMP}.log"
WORKSPACE_MASTER_PASSWORD="SUPER_SECRET_ADMIN_PASSWORD_CHANGE_ME"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

mkdir -p ./logs

echo "========================================" | tee -a "$LOG_FILE"
echo "Session Management Lifecycle Test" | tee -a "$LOG_FILE"
echo "Timestamp: $(date)" | tee -a "$LOG_FILE"
echo "Username: ${USERNAME}" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Function to capture internal-service logs
capture_logs() {
    local phase=$1
    local duration=${2:-5}

    echo -e "${YELLOW}Capturing internal-service logs for ${phase} (${duration}s)...${NC}" | tee -a "$LOG_FILE"
    echo "--- ${phase} Logs (Start) ---" >> "$LOG_FILE"

    timeout ${duration}s tilt logs internal-service 2>&1 | tail -100 >> "$LOG_FILE" || true

    echo "--- ${phase} Logs (End) ---" >> "$LOG_FILE"
    echo "" >> "$LOG_FILE"
}

# Function to check for critical log patterns
check_log_patterns() {
    local phase=$1

    echo "" | tee -a "$LOG_FILE"
    echo "=== Log Analysis for ${phase} ===" | tee -a "$LOG_FILE"

    # Check for pre-connect cleanup
    if grep -q "Checking for existing sessions for user:" "$LOG_FILE" 2>/dev/null; then
        echo -e "${GREEN}✓ Pre-connect cleanup check executed${NC}" | tee -a "$LOG_FILE"

        if grep -q "Found .* existing session(s) for user" "$LOG_FILE" 2>/dev/null; then
            local count=$(grep "Found .* existing session(s) for user" "$LOG_FILE" | tail -1 | sed -E 's/.*Found ([0-9]+) existing.*/\1/')
            echo -e "${GREEN}✓ Found and cleaned up ${count} existing session(s)${NC}" | tee -a "$LOG_FILE"
        fi
    fi

    # Check for "Session Already Connected" errors
    if grep -q "Session Already Connected" "$LOG_FILE" 2>/dev/null; then
        echo -e "${RED}✗ ERROR: 'Session Already Connected' detected!${NC}" | tee -a "$LOG_FILE"
        echo "This indicates the session management fix is NOT working correctly." | tee -a "$LOG_FILE"
        return 1
    else
        echo -e "${GREEN}✓ No 'Session Already Connected' errors${NC}" | tee -a "$LOG_FILE"
    fi

    # Check for retry attempts
    if grep -q "Retry attempt" "$LOG_FILE" 2>/dev/null; then
        echo -e "${YELLOW}⚠ Retry attempts detected (fallback used)${NC}" | tee -a "$LOG_FILE"
    else
        echo -e "${GREEN}✓ No retry attempts needed (pre-connect cleanup worked)${NC}" | tee -a "$LOG_FILE"
    fi

    # Check for successful connection
    if grep -q "ConnectSuccess" "$LOG_FILE" 2>/dev/null || grep -q "successfully connected" "$LOG_FILE" 2>/dev/null; then
        echo -e "${GREEN}✓ Connection successful${NC}" | tee -a "$LOG_FILE"
    fi

    echo "" | tee -a "$LOG_FILE"
}

echo "" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "MANUAL TEST INSTRUCTIONS" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "This script will guide you through testing the account lifecycle." | tee -a "$LOG_FILE"
echo "Follow the prompts and perform the actions in the UI at http://localhost:5173/" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Phase 1: Create Account
echo "========================================" | tee -a "$LOG_FILE"
echo "PHASE 1: CREATE ACCOUNT" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "1. Navigate to http://localhost:5173/" | tee -a "$LOG_FILE"
echo "2. Click 'Join Workspace'" | tee -a "$LOG_FILE"
echo "3. Enter workspace location: 127.0.0.1:12349" | tee -a "$LOG_FILE"
echo "4. Leave workspace password empty, click 'Next'" | tee -a "$LOG_FILE"
echo "5. Click 'Next' on security modal (use defaults)" | tee -a "$LOG_FILE"
echo "6. Fill in user credentials:" | tee -a "$LOG_FILE"
echo "   - Full Name: John Doe" | tee -a "$LOG_FILE"
echo "   - Username: ${USERNAME}" | tee -a "$LOG_FILE"
echo "   - Password: ${PASSWORD}" | tee -a "$LOG_FILE"
echo "   - Confirm Password: ${PASSWORD}" | tee -a "$LOG_FILE"
echo "7. If first user, initialize workspace with master password: ${WORKSPACE_MASTER_PASSWORD}" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
read -p "Press ENTER when account creation is complete and you're in the workspace..."

capture_logs "CREATE_ACCOUNT" 10
check_log_patterns "CREATE_ACCOUNT"

echo "" | tee -a "$LOG_FILE"
echo "Waiting 2 seconds before logout phase..." | tee -a "$LOG_FILE"
sleep 2

# Phase 2: Logout
echo "========================================" | tee -a "$LOG_FILE"
echo "PHASE 2: LOGOUT" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "1. Click the user avatar in the top right" | tee -a "$LOG_FILE"
echo "2. Click 'Sign out' from the dropdown" | tee -a "$LOG_FILE"
echo "3. Verify you're redirected to the index page (/)" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
read -p "Press ENTER when logout is complete and you're on the index page..."

capture_logs "LOGOUT" 5
check_log_patterns "LOGOUT"

echo "" | tee -a "$LOG_FILE"
echo "Waiting 2 seconds before login phase..." | tee -a "$LOG_FILE"
sleep 2

# Phase 3: Login
echo "========================================" | tee -a "$LOG_FILE"
echo "PHASE 3: LOGIN (Testing Pre-Connect Cleanup)" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "This is the CRITICAL test for session management fixes!" | tee -a "$LOG_FILE"
echo "We're testing if the pre-connect cleanup properly handles re-login." | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "1. Click 'Login Workspace'" | tee -a "$LOG_FILE"
echo "2. Enter credentials:" | tee -a "$LOG_FILE"
echo "   - Username: ${USERNAME}" | tee -a "$LOG_FILE"
echo "   - Password: ${PASSWORD}" | tee -a "$LOG_FILE"
echo "3. Click 'Connect'" | tee -a "$LOG_FILE"
echo "4. Verify you successfully enter the workspace (NO loading spinner stuck)" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
read -p "Press ENTER when login is complete and you're in the workspace..."

capture_logs "LOGIN" 10
check_log_patterns "LOGIN"

# Final Summary
echo "" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "TEST SUMMARY" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Count key log patterns
total_sessions_found=$(grep -c "Found .* existing session(s) for user" "$LOG_FILE" 2>/dev/null || echo "0")
total_cleanup_checks=$(grep -c "Checking for existing sessions for user:" "$LOG_FILE" 2>/dev/null || echo "0")
session_errors=$(grep -c "Session Already Connected" "$LOG_FILE" 2>/dev/null || echo "0")
retry_attempts=$(grep -c "Retry attempt" "$LOG_FILE" 2>/dev/null || echo "0")

echo "Key Metrics:" | tee -a "$LOG_FILE"
echo "- Pre-connect cleanup checks: ${total_cleanup_checks}" | tee -a "$LOG_FILE"
echo "- Existing sessions found and cleaned: ${total_sessions_found}" | tee -a "$LOG_FILE"
echo "- 'Session Already Connected' errors: ${session_errors}" | tee -a "$LOG_FILE"
echo "- Retry attempts: ${retry_attempts}" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

if [ "$session_errors" -gt 0 ]; then
    echo -e "${RED}❌ TEST FAILED: Session management bug still present${NC}" | tee -a "$LOG_FILE"
    echo "The pre-connect cleanup did not prevent 'Session Already Connected' errors." | tee -a "$LOG_FILE"
    exit 1
elif [ "$retry_attempts" -gt 0 ]; then
    echo -e "${YELLOW}⚠ TEST PASSED (with fallback): Session management working but needed retries${NC}" | tee -a "$LOG_FILE"
    echo "The fallback retry logic worked, but pre-connect cleanup may need adjustment." | tee -a "$LOG_FILE"
elif [ "$total_cleanup_checks" -ge 2 ]; then
    echo -e "${GREEN}✅ TEST PASSED: Session management fixes working perfectly!${NC}" | tee -a "$LOG_FILE"
    echo "Pre-connect cleanup successfully prevented session conflicts." | tee -a "$LOG_FILE"
    if [ "$total_sessions_found" -gt 0 ]; then
        echo "Old sessions were detected and cleaned up before reconnection." | tee -a "$LOG_FILE"
    fi
else
    echo -e "${YELLOW}⚠ TEST INCONCLUSIVE: Not enough log data captured${NC}" | tee -a "$LOG_FILE"
    echo "Review the full logs in ${LOG_FILE}" | tee -a "$LOG_FILE"
fi

echo "" | tee -a "$LOG_FILE"
echo "Full test log saved to: ${LOG_FILE}" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Display what we're looking for in the logs
echo "========================================" | tee -a "$LOG_FILE"
echo "EXPECTED LOG PATTERNS" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "GOOD patterns (should see):" | tee -a "$LOG_FILE"
echo "  - 'Checking for existing sessions for user: ${USERNAME}'" | tee -a "$LOG_FILE"
echo "  - 'Found X existing session(s) for user...' (during re-login)" | tee -a "$LOG_FILE"
echo "  - Smooth connection without retry messages" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "BAD patterns (should NOT see):" | tee -a "$LOG_FILE"
echo "  - 'Session Already Connected' errors" | tee -a "$LOG_FILE"
echo "  - Multiple 'Retry attempt' messages" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

echo "Test complete!" | tee -a "$LOG_FILE"
