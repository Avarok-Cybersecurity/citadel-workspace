# Proves Citadel-Agent-x64.msi installs an agent that starts, answers the site, and uninstalls.
#
#   $env:EXPECTED_VERSION = 'X.Y.Z'; pwsh scripts/smoke-windows-msi.ps1 Citadel-Agent-x64.msi
#
# Silent install; the exe is under Program Files and prints the expected --version; the install
# started the agent; the Start-menu shortcut, started the way Explorer starts it, runs an agent that
# listens, answers the site's handshake with 101, refuses a foreign origin, and keeps the account in
# %USERPROFILE%; the login entry runs the same command; msiexec /x removes all of it.
# The port must be free: an agent already on it would answer every check for this one.
param([Parameter(Mandatory = $true)][string]$Msi)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expected = $env:EXPECTED_VERSION
if (-not ($expected -match '^\d+\.\d+\.\d+$')) { throw "EXPECTED_VERSION must be MAJOR.MINOR.PATCH, got '$expected'" }
$root = Split-Path -Parent $PSScriptRoot
$plist = Join-Path $root 'apps/macos-agent/Info.plist'
function Setting([string]$key) {
  $v = & python (Join-Path $root 'scripts/lib/agent-settings.py') $plist get $key
  if ($LASTEXITCODE -ne 0) { throw "no $key in $plist" }
  return $v.Trim()
}
$origin = Setting 'CitadelWorkspaceOrigin'
$port = [int]((Setting 'CitadelAgentBind').Split(':')[1])
$dataDir = Join-Path $env:USERPROFILE (Setting 'CitadelAgentDataDirectoryName')
$exe = Join-Path $env:ProgramFiles 'Citadel Agent\citadel-agent.exe'
$lnk = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Citadel Agent.lnk'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$log = Join-Path $env:RUNNER_TEMP 'msi.log'

function Fail([string]$why) { Write-Host "::error::$why"; exit 1 }
function Listening { [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }
function WaitFor([scriptblock]$cond, [int]$seconds) {
  for ($i = 0; $i -lt $seconds; $i++) { if (& $cond) { return $true }; Start-Sleep 1 }
  return (& $cond)
}
function StopAgent {
  Get-Process citadel-agent -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force
  if (-not (WaitFor { -not (Listening) } 15)) { Fail "stopping the agent left port $port open" }
}
function Handshake([string]$from) {
  & curl.exe -s -o NUL -w '%{http_code}' --max-time 5 --ssl-revoke-best-effort `
    --resolve "local.avarok.net:${port}:127.0.0.1" -H 'Connection: Upgrade' -H 'Upgrade: websocket' `
    -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' `
    -H "Origin: $from" "https://local.avarok.net:${port}/"
}
function Msiexec([string]$args_) {
  # Not -Wait, which also waits for descendants: the agent the install starts would hang it.
  $p = Start-Process msiexec.exe -ArgumentList $args_ -PassThru
  $p.WaitForExit()
  if ($p.ExitCode -ne 0) { Get-Content $log -Tail 40 -ErrorAction SilentlyContinue; Fail "msiexec $args_ exited $($p.ExitCode)" }
}

if (Listening) { Fail "port $port is already in use; that listener, not this install, would answer" }

# Another program's login entry, which uninstalling must leave alone: the MSI owns one
# value in the Run key, never the key.
$sentinel = 'CitadelSmokeSentinel-OtherApp'
New-Item -Path $runKey -Force | Out-Null
New-ItemProperty -Path $runKey -Name $sentinel -Value 'C:\\Windows\\notepad.exe' -PropertyType String -Force | Out-Null

Msiexec "/i `"$((Resolve-Path $Msi).Path)`" /qn /l*v `"$log`""
if (-not (Test-Path $exe)) { Fail "the MSI did not install $exe" }
$got = ((& $exe --version) -join "`n").Trim()
if ($LASTEXITCODE -ne 0) { Fail "$exe --version exited $LASTEXITCODE" }
if ($got -ne "citadel-agent $expected") { Fail "$exe --version printed '$got', expected exactly 'citadel-agent $expected'" }
Write-Host "  --version: $got"

# The install itself starts the agent.
if (-not (WaitFor { Listening } 60)) { Fail "the install did not start the agent on port $port" }
Write-Host "  the install started the agent"
StopAgent
# Removed so that the shortcut's run below must create it: proof its %USERPROFILE% was expanded.
Remove-Item -Recurse -Force $dataDir -ErrorAction SilentlyContinue

if (-not (Test-Path $lnk)) { Fail "no Start-menu shortcut at $lnk" }
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
if ($shortcut.TargetPath -ne $exe) { Fail "the shortcut targets '$($shortcut.TargetPath)', not $exe" }
$arguments = $shortcut.Arguments
foreach ($flag in '--bind', '--backend filesystem', '--data-dir', "--allowed-origins $origin", '--stun-servers') {
  if (-not $arguments.Contains($flag)) { Fail "the shortcut's arguments lack '$flag': $arguments" }
}
Start-Process -FilePath $lnk   # as Explorer starts it: ShellExecute on the .lnk
if (-not (WaitFor { Listening } 60)) { Fail "the Start-menu shortcut did not start an agent on port $port" }
Write-Host "  the Start-menu shortcut starts the agent: $arguments"
$ok = Handshake $origin
if ($ok -ne '101') { Fail "the agent answered the handshake from $origin with '$ok', not 101" }
$foreign = Handshake 'https://evil.example'
if ($foreign -ne '403') { Fail "the agent answered a foreign origin with '$foreign', not 403" }
Write-Host "  101 for $origin, 403 for a foreign origin"
if (-not (Test-Path $dataDir)) { Fail "the shortcut's agent did not keep its account in $dataDir" }
Write-Host "  the account is kept in $dataDir"
StopAgent

$run = Get-Item $runKey
if ($run.GetValueKind('Citadel Agent') -ne 'ExpandString') { Fail "the Run value is not REG_EXPAND_SZ, so Explorer would not expand %USERPROFILE%" }
$runValue = $run.GetValue('Citadel Agent', $null, 'DoNotExpandEnvironmentNames')
if ($runValue -ne "`"$exe`" $arguments") { Fail "the login entry runs '$runValue', not the shortcut's command" }
Write-Host "  the login entry runs the same command"

Msiexec "/x `"$((Resolve-Path $Msi).Path)`" /qn /l*v `"$log`""
foreach ($left in $exe, $lnk) { if (Test-Path $left) { Fail "uninstalling left $left" } }
$runAfter = Get-Item $runKey -ErrorAction SilentlyContinue
if ($null -eq $runAfter) { Fail "uninstalling removed the whole Run key, and with it other programs' login entries" }
if ($null -ne $runAfter.GetValue('Citadel Agent')) { Fail "uninstalling left the login entry" }
if ($null -eq $runAfter.GetValue($sentinel)) { Fail "uninstalling removed another program's login entry" }
Remove-ItemProperty -Path $runKey -Name $sentinel
Write-Host "  uninstalling removed only its own login entry"
Write-Host "== $Msi installs, runs the agent, and uninstalls =="
