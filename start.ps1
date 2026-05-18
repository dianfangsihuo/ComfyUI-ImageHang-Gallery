$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 5174

Set-Location $Root

function Resolve-Tool {
  param([string]$Name)

  $tool = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $tool) {
    throw "Missing required tool: $Name. Please install Node.js first."
  }

  return $tool.Source
}

function Test-PortFree {
  param([int]$Candidate)

  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Candidate)
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($listener) {
      $listener.Stop()
    }
  }
}

$npm = Resolve-Tool "npm.cmd"

while (-not (Test-PortFree $Port)) {
  $Port += 1
}

$Url = "http://localhost:$Port/"

Write-Host ""
Write-Host "Image Hang one-click starter" -ForegroundColor Cyan
Write-Host "Project: $Root"

if (-not (Test-Path (Join-Path $Root "node_modules"))) {
  Write-Host ""
  Write-Host "Installing dependencies..." -ForegroundColor Yellow
  & $npm install
}

Write-Host ""
Write-Host "Starting development server on $Url" -ForegroundColor Green
Write-Host "Close this window or press Ctrl+C to stop the server."
Write-Host ""

$process = Start-Process `
  -FilePath $npm `
  -ArgumentList @("run", "dev", "--", "--port", "$Port", "--host", "0.0.0.0") `
  -WorkingDirectory $Root `
  -NoNewWindow `
  -PassThru

$opened = $false
for ($i = 0; $i -lt 40; $i += 1) {
  if ($process.HasExited) {
    exit $process.ExitCode
  }

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 1
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      Start-Process $Url
      $opened = $true
      break
    }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

if (-not $opened) {
  Write-Host "Server is still starting. Open $Url manually if the browser did not appear." -ForegroundColor Yellow
}

Wait-Process -Id $process.Id
exit $process.ExitCode
