param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("enable", "disable", "restart", "pair")]
  [string]$Action,
  [switch]$NoBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$RepoPath = Split-Path -Parent $PSScriptRoot
$NodePath = (Get-Command node.exe -ErrorAction Stop).Source
$ServerEntry = Join-Path $RepoPath "apps\server\dist\bin.mjs"
$BaseDir = Join-Path $RepoPath ".t3\production"
$PidFile = Join-Path $BaseDir "server.pid"
$LogDir = Join-Path $BaseDir "logs"
$StdoutLog = Join-Path $LogDir "production.stdout.log"
$StderrLog = Join-Path $LogDir "production.stderr.log"
$ServerHost = "0.0.0.0"
$ServerHealthUrl = "http://127.0.0.1:3773"
$WhisperResourceDir = Join-Path $RepoPath ".t3\runtime\whisper"

function Get-PhysicalLanIPv4Address {
  $physicalAdapters = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object {
    $_.Status -eq "Up"
  })

  foreach ($adapter in $physicalAdapters) {
    $address = Get-NetIPAddress `
      -InterfaceIndex $adapter.ifIndex `
      -AddressFamily IPv4 `
      -AddressState Preferred `
      -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -notlike "169.254.*" } |
      Select-Object -First 1
    if ($null -ne $address) {
      return [string]$address.IPAddress
    }
  }

  return $null
}

function Get-TailscaleIPv4Address {
  try {
    $statusOutput = @(& tailscale.exe status --json 2>$null)
    if ($LASTEXITCODE -ne 0) {
      return $null
    }

    $status = ($statusOutput -join [Environment]::NewLine) | ConvertFrom-Json
    return @($status.Self.TailscaleIPs | Where-Object { $_ -match "^\d{1,3}(\.\d{1,3}){3}$" }) |
      Select-Object -First 1
  } catch {
    return $null
  }
}

$LanIPv4Address = Get-PhysicalLanIPv4Address
$TailscaleIPv4Address = Get-TailscaleIPv4Address
$LanUrl = if ($null -ne $LanIPv4Address) { "http://${LanIPv4Address}:3773" } else { $null }
$TailscaleUrl = if ($null -ne $TailscaleIPv4Address) { "http://${TailscaleIPv4Address}:3773" } else { $null }
# Loopback enables browser microphone access on this machine. Other devices
# keep using the LAN or Tailscale address printed below.
$ServerUrl = $ServerHealthUrl

function Write-DirectServerUrls {
  Write-Host "Direct server addresses:"
  if ($null -ne $LanUrl) {
    Write-Host "  LAN:       $LanUrl"
  }
  if ($null -ne $TailscaleUrl) {
    Write-Host "  Tailscale: $TailscaleUrl"
  }
  if ($null -eq $LanUrl -and $null -eq $TailscaleUrl) {
    Write-Host "  Local only: $ServerHealthUrl"
  }
}

function Open-T3CodeProduction {
  if ($NoBrowser) {
    Write-Host "Browser launch skipped for diagnostics."
    return
  }

  # Browser authentication belongs to an origin. A LAN session does not carry
  # over to loopback, so pair this browser when opening the local connection.
  $desktopPairingUrl = New-LocalT3CodePairingUrl
  Write-Host "Opening T3 Code at $ServerUrl with a fresh local pairing link..."
  try {
    Start-Process -FilePath $desktopPairingUrl
  } catch {
    Write-Warning "Windows could not open the browser automatically: $($_.Exception.Message)"
    Write-Host "Open this URL manually: $desktopPairingUrl"
  }
}

function New-LocalT3CodePairingUrl {
  $desktopPairingOutput = @(& $NodePath --no-warnings $ServerEntry auth pairing create `
    --base-dir $BaseDir `
    --base-url $ServerUrl `
    --ttl "5m" `
    --label "Windows desktop launcher" `
    --json 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "T3 Code could not create a desktop pairing link: $($desktopPairingOutput -join ' ')"
  }
  $desktopPairing = ($desktopPairingOutput -join [Environment]::NewLine) | ConvertFrom-Json
  $desktopPairingUrl = [string]$desktopPairing.pairUrl
  if (-not $desktopPairingUrl.StartsWith("$ServerUrl/pair#token=")) {
    throw "T3 Code returned an unexpected desktop pairing URL."
  }

  return $desktopPairingUrl
}

function Write-NewT3CodePairingBlock {
  $desktopPairingUrl = New-LocalT3CodePairingUrl

  if ($NoBrowser) {
    Write-Host "Verified a fresh Windows browser pairing URL (browser launch skipped for diagnostics)."
  } else {
    Write-Host "Opening a freshly paired Windows browser at $ServerUrl..."
    try {
      Start-Process -FilePath $desktopPairingUrl
    } catch {
      Write-Warning "Windows could not open the browser automatically: $($_.Exception.Message)"
      Write-Host "Open this fresh desktop pairing URL manually: $desktopPairingUrl"
    }
  }

  Write-Host ""
  Write-Host "Creating a separate one-time QR for another directly connected device..."
  & $NodePath --no-warnings $ServerEntry pair --base-dir $BaseDir
  if ($LASTEXITCODE -ne 0) {
    throw "T3 Code could not create the direct pairing QR."
  }
  Write-Host ""
  Write-DirectServerUrls
}

function Get-T3CodeProductionProcess {
  if (-not (Test-Path -LiteralPath $PidFile)) {
    return $null
  }

  $rawProcessId = (Get-Content -LiteralPath $PidFile -Raw).Trim()
  $serverProcessId = 0
  if (-not [int]::TryParse($rawProcessId, [ref]$serverProcessId)) {
    Remove-Item -LiteralPath $PidFile -Force
    return $null
  }

  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $serverProcessId" -ErrorAction SilentlyContinue
  if ($null -eq $process) {
    Remove-Item -LiteralPath $PidFile -Force
    return $null
  }

  $executableMatches = [string]::Equals(
    [string]$process.ExecutablePath,
    $NodePath,
    [StringComparison]::OrdinalIgnoreCase
  )
  $commandLine = [string]$process.CommandLine
  $commandMatches = $commandLine.Contains($ServerEntry) -and $commandLine.Contains($BaseDir)

  if (-not $executableMatches -or -not $commandMatches) {
    throw "PID $serverProcessId belongs to an unexpected process. Refusing to stop it; remove '$PidFile' manually after inspecting the process."
  }

  return $process
}

function Stop-T3CodeProduction {
  $process = Get-T3CodeProductionProcess
  if ($null -eq $process) {
    Write-Host "T3 Code production is already disabled."
    return
  }

  $serverProcessId = [int]$process.ProcessId
  Stop-Process -Id $serverProcessId
  Wait-Process -Id $serverProcessId -Timeout 10 -ErrorAction SilentlyContinue

  if ($null -ne (Get-Process -Id $serverProcessId -ErrorAction SilentlyContinue)) {
    # The process can disappear between the presence check and this fallback.
    Stop-Process -Id $serverProcessId -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $serverProcessId -Timeout 5 -ErrorAction SilentlyContinue
  }

  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  Write-Host "T3 Code production disabled (stopped PID $serverProcessId)."
}

function Prepare-T3CodeProduction {
  & $NodePath (Join-Path $RepoPath "scripts\start-fork.ts") --prepare-only
  if ($LASTEXITCODE -ne 0) {
    throw "T3 Code build or voice runtime preparation failed."
  }
}

function Start-T3CodeProduction {
  param([switch]$SkipOpen)

  $existingProcess = Get-T3CodeProductionProcess
  if ($null -ne $existingProcess) {
    Write-Host "T3 Code production is already enabled at $ServerUrl (PID $($existingProcess.ProcessId))."
    Write-DirectServerUrls
    if (-not $SkipOpen) {
      Open-T3CodeProduction
    }
    return
  }

  if (-not (Test-Path -LiteralPath $NodePath)) {
    throw "Node.js was not found at '$NodePath'."
  }
  if (-not (Test-Path -LiteralPath $ServerEntry)) {
    throw "The production server bundle was not found at '$ServerEntry'. Build it before enabling T3 Code."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $RepoPath "apps\server\dist\client\index.html"))) {
    throw "The production web bundle is missing from the server distribution."
  }

  New-Item -ItemType Directory -Force -Path $BaseDir, $LogDir | Out-Null

  if ((Test-Path -LiteralPath (Join-Path $WhisperResourceDir "whisper-server.exe")) -and
      (Test-Path -LiteralPath (Join-Path $WhisperResourceDir "ggml-base.bin"))) {
    $env:T3CODE_WHISPER_RESOURCE_DIR = $WhisperResourceDir
  }

  $arguments = @(
    ('"{0}"' -f $ServerEntry),
    "serve",
    "--host", $ServerHost,
    "--port", "3773",
    "--base-dir", ('"{0}"' -f $BaseDir)
  )

  $process = Start-Process `
    -FilePath $NodePath `
    -ArgumentList $arguments `
    -WorkingDirectory $RepoPath `
    -WindowStyle Hidden `
    -RedirectStandardOutput $StdoutLog `
    -RedirectStandardError $StderrLog `
    -PassThru

  Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ascii

  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  $serverReady = $false
  while ([DateTime]::UtcNow -lt $deadline) {
    $process.Refresh()
    if ($process.HasExited) {
      Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
      $errorTail = if (Test-Path -LiteralPath $StderrLog) {
        (Get-Content -LiteralPath $StderrLog -Encoding utf8 -Tail 20) -join [Environment]::NewLine
      } else {
        "No error log was created."
      }
      throw "T3 Code exited during startup.`n$errorTail"
    }

    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "$ServerHealthUrl/" -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        $serverReady = $true
        break
      }
    } catch {
      # The process may be healthy but not listening yet.
    }

    Start-Sleep -Milliseconds 250
  }

  if (-not $serverReady) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    throw "T3 Code did not become reachable at $ServerHealthUrl within 30 seconds. See '$StderrLog'."
  }

  Write-Host "T3 Code production enabled at $ServerUrl (PID $($process.Id))."
  Write-DirectServerUrls
  Write-Host "Logs: $StdoutLog"
  if (-not $SkipOpen) {
    Open-T3CodeProduction
  }
}

function New-T3CodeProductionPairing {
  if ($null -eq (Get-T3CodeProductionProcess)) {
    Start-T3CodeProduction -SkipOpen
  }

  Write-NewT3CodePairingBlock
}

switch ($Action) {
  "enable" {
    if ($null -eq (Get-T3CodeProductionProcess)) { Prepare-T3CodeProduction }
    Start-T3CodeProduction
  }
  "disable" { Stop-T3CodeProduction }
  "restart" {
    Stop-T3CodeProduction
    Prepare-T3CodeProduction
    Start-T3CodeProduction
  }
  "pair" { New-T3CodeProductionPairing }
}
