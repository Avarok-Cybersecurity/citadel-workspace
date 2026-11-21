# The Windows agent as it ships: the release build with this repository's source-path remapping
# (scripts/lib/remap-paths.mjs), then the shipped-artefact gate on the binary it produced.
# One script for the release leg (.github/actions/build-agent) and the PR job (validate.yml's
# windows-agent), so the PR builds exactly what the release gate will judge.
#
#   pwsh scripts/build-agent-windows.ps1 -Target x86_64-pc-windows-msvc
#
# PowerShell, not bash: vendored OpenSSL runs its Configure with the first perl on PATH, and
# under Git's bash that is Git's cut-down perl, which lacks the modules Configure needs.
param(
  [Parameter(Mandatory = $true)][string]$Target
)
$ErrorActionPreference = 'Stop'

$remap = node scripts/remap-path-env.mjs $Target
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$name, $value = $remap -split '=', 2
Set-Item -Path "env:$name" -Value $value

cargo build --release --target $Target -p citadel-workspace-internal-service --bin citadel-workspace-internal-service --features vendored,self-update,native-dialogs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node scripts/check-no-home-paths-shipped.mjs "target/$Target/release/citadel-workspace-internal-service.exe"
exit $LASTEXITCODE
