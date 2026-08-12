$ErrorActionPreference = "Stop"
$BaseUrl = "https://zihin-factory-governor.alerthum.workers.dev"
$TokenDir = Join-Path $env:LOCALAPPDATA "ZihinFactory"
$TokenFile = Join-Path $TokenDir "admin-token.dpapi"

function Plain([Security.SecureString]$s) {
  $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try {[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)}
  finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}
}

function Get-FactoryToken {
  if(Test-Path $TokenFile) {
    try {
      $enc = Get-Content $TokenFile -Raw
      $secure = ConvertTo-SecureString $enc
      return Plain $secure
    } catch {
      Remove-Item $TokenFile -Force -ErrorAction SilentlyContinue
    }
  }
  New-Item -ItemType Directory -Force -Path $TokenDir | Out-Null
  Write-Host "FACTORY_ADMIN_TOKEN bu Windows kullanicisi icin DPAPI ile bir kez sifreli kaydedilecek." -ForegroundColor Yellow
  $secure = Read-Host "FACTORY_ADMIN_TOKEN (son kez)" -AsSecureString
  ($secure | ConvertFrom-SecureString) | Set-Content -Path $TokenFile -Encoding UTF8
  return Plain $secure
}

$token = Get-FactoryToken
$headers = @{ Authorization = "Bearer $token" }

Write-Host "1. SURUM / SAGLIK" -ForegroundColor Cyan
$health = Invoke-RestMethod "$BaseUrl/health"
$health | ConvertTo-Json -Depth 10
$version = @($health.meta | Where-Object {$_.key -eq "factory_version"} | Select-Object -First 1).value
$schema = @($health.meta | Where-Object {$_.key -eq "schema_version"} | Select-Object -First 1).value
if($version -ne "0.8.0" -or $schema -ne "10" -or $health.phase -ne "learning-project-director") {
  throw "0.8.0 Learning Factory deploy aktif degil."
}

Write-Host "`n2. FABRIKA OGRENME + MODEL ROUTER KONTRATI" -ForegroundColor Cyan
$s = Invoke-RestMethod -Uri "$BaseUrl/dashboard/api" -Headers $headers
$learningEnabled = @($s.state | Where-Object {$_.key -eq "factory_learning_enabled"} | Select-Object -First 1).value
$routerMode = @($s.state | Where-Object {$_.key -eq "provider_router_mode"} | Select-Object -First 1).value
if($learningEnabled -ne "1") { throw "factory_learning_enabled aktif degil." }
if($routerMode -ne "adaptive-health") { throw "provider router adaptive-health degil." }
if($null -eq $s.learning) { throw "Dashboard learning ozeti yok." }
if($null -eq $s.learning.providers) { throw "Provider model saglik tablosu yok." }
if($null -eq $s.learning.lessons) { throw "Kalici kalite dersi tablosu yok." }
Write-Host "PASS - Kalici kalite hafizasi + adaptif model router aktif." -ForegroundColor Green

Write-Host "`n3. PROJECT DIRECTOR + 4 PARALEL HAT" -ForegroundColor Cyan
$start = Invoke-RestMethod -Method Post -Uri "$BaseUrl/admin/start" -Headers $headers
$feed = Invoke-RestMethod -Method Post -Uri "$BaseUrl/admin/project-feed" -Headers $headers
Start-Sleep -Seconds 5
$s = Invoke-RestMethod -Uri "$BaseUrl/dashboard/api" -Headers $headers
if([int]$s.parallelLimit -ne 4) { throw "parallelLimit=4 degil." }
if(@($s.laneSummary).Count -ne 5) { throw "5 calisma hatti bulunamadi." }
Write-Host "PASS - Project Director ve 4 paralel slot korunuyor." -ForegroundColor Green

Write-Host "`n4. OGRENME KPI" -ForegroundColor Cyan
[pscustomobject]@{
  FirstPassRate = "$($s.learning.firstPass.rate)%"
  FirstPass = "$($s.learning.firstPass.passed)/$($s.learning.firstPass.total)"
  RepeatedKnownDefects = $s.learning.repeatedKnownDefects
  DefectsLast6h = $s.learning.defects6h.total
  UniqueDefectsLast6h = $s.learning.defects6h.unique
  LearnedRules = @($s.learning.lessons).Count
  ProviderModelStats = @($s.learning.providers).Count
  ActiveJobs = @($s.activeJobs).Count
  StartingJobs = @($s.startingJobs).Count
  EligibleJobs = @($s.eligibleRoadmap).Count
  ProductPRLast6h = $s.last6h.prs
} | Format-List

Write-Host "`n5. DASHBOARD OGRENME SEKmesi" -ForegroundColor Cyan
$html = [string](Invoke-WebRequest "$BaseUrl/dashboard").Content
if($html -notmatch 'data-tab="learning"' -or $html -notmatch "renderLearning") {
  throw "Dashboard Fabrika Ogrenmesi sekmesi bulunamadi."
}
Write-Host "PASS - Fabrika Ogrenmesi dashboard'u aktif." -ForegroundColor Green

Write-Host "`nPASS - 0.8.0 LEARNING FACTORY AKTIF." -ForegroundColor Green
Write-Host "Ayni bilinen QA hatalari artik kalici role/ortak derse donusur; NVIDIA model sirasi saglik verisine gore degisir." -ForegroundColor Green
Write-Host "FACTORY_ADMIN_TOKEN bu Windows hesabinda sifreli kaydedildi; sonraki testlerde tekrar sorulmayacak." -ForegroundColor Green
exit 0
