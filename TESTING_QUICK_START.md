# Session Management Testing - Quick Start

## TL;DR

```bash
# 1. Verify fixes are in code
./verify-session-fixes.sh

# 2. Run guided manual test
./test-session-management.sh

# 3. Review results
cat ./logs/session-test-*.log | tail -50
```

---

## What's Being Tested

The "Session Already Connected" bug fix that:
- Cleans up old sessions before re-login
- Prevents duplicate session errors
- Enables smooth logout → login cycles

---

## Files Created

| File | Purpose | When to Use |
|------|---------|-------------|
| `verify-session-fixes.sh` | Checks code for fixes | Before testing, CI/CD |
| `test-session-management.sh` | Guided UI testing | Manual testing |
| `SESSION_MANAGEMENT_TEST_RESULTS.md` | Full documentation | Reference, troubleshooting |
| `./logs/session-test-*.log` | Test output logs | After test runs |

---

## Quick Test (5 minutes)

### Step 1: Verify Code
```bash
./verify-session-fixes.sh
```
**Expected**: All 5 checks pass ✅

### Step 2: Run UI Test
```bash
./test-session-management.sh
```

Follow the prompts:
1. Create account at http://localhost:5173/
2. Logout via avatar dropdown
3. Login again with same credentials

### Step 3: Check Results
The script will tell you:
- ✅ Pass: No session errors
- ⚠️ Warning: Needed retries
- ❌ Fail: Session errors occurred

---

## What Success Looks Like

### In Logs (`tilt logs internal-service`)
```
Checking for existing sessions for user: testuser123
Found 1 existing session(s) for user testuser123, cleaning up: [12345]
ConnectSuccess { cid: 67890 }
```

### In UI
- Create account → enters workspace immediately
- Logout → redirected to index page
- Login → **enters workspace immediately** (no loading spinner stuck)

---

## What Failure Looks Like

### In Logs
```
Session Already Connected
Retry attempt 1/3 for Session Already Connected error
Retry attempt 2/3 for Session Already Connected error
```

### In UI
- Stuck on loading screen
- Multiple connection attempts
- Error messages

---

## Troubleshooting

### Script won't run
```bash
chmod +x verify-session-fixes.sh test-session-management.sh
```

### Services not running
```bash
tilt get uiresources
# Should show: ui, server, internal-service
```

### Can't access UI
```bash
# Check if UI is on port 5173
lsof -i :5173

# If not, check Tiltfile for port config
```

### Need more detailed logs
```bash
# Follow internal-service logs in real-time
tilt logs internal-service -f

# In another terminal, run your test
```

---

## After Testing

### If Successful ✅
- Document results in commit message
- Update bug tracker: RESOLVED
- Consider automated UI tests (Playwright)

### If Failed ❌
1. Save logs: `tilt logs internal-service > failed-test.log`
2. Check which fix component failed
3. Review SESSION_MANAGEMENT_TEST_RESULTS.md
4. Report findings with logs

### If Needed Retries ⚠️
- Fix is working (fallback logic)
- But pre-connect cleanup could be improved
- Consider increasing 50ms delay or investigating timing

---

## For CI/CD

Add to pipeline:
```yaml
- name: Verify Session Management Fixes
  run: ./verify-session-fixes.sh
```

---

## Questions?

Read the full documentation:
```bash
cat SESSION_MANAGEMENT_TEST_RESULTS.md
```

Or check the code:
- Pre-connect cleanup: `citadel-internal-service/citadel-internal-service/src/kernel/requests/connect.rs:37-55`
- Disconnect cleanup: `citadel-internal-service/citadel-internal-service/src/kernel/requests/disconnect.rs:24`
- Request docs: `citadel-internal-service/REQUESTS.md`
