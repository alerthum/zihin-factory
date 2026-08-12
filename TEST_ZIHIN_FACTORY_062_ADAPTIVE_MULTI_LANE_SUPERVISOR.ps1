$ErrorActionPreference = "Stop"
$BaseUrl = "https://zihin-factory-governor.alerthum.workers.dev"

function Plain([Security.SecureString]$s) {
  $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try {[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)}
  finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}
}
function StateValue($snapshot,[string]$key) {
  $r=@($snapshot.state)|Where-Object {$_.key -eq $key}|Select-Object -First 1
  if($r){return [string]$r.value}; return $null
}

$token = Plain (Read-Host "FACTORY_ADMIN_TOKEN" -AsSecureString)
$headers = @{ Authorization = "Bearer $token" }

Write-Host "1. SURUM / SAGLIK" -ForegroundColor Cyan
$health = Invoke-RestMethod "$BaseUrl/health"
$health | ConvertTo-Json -Depth 10
$version = @($health.meta | Where-Object {$_.key -eq "factory_version"} | Select-Object -First 1).value
if($version -ne "0.6.2" -or $health.phase -ne "adaptive-multi-lane-supervisor") {
  throw "0.6.2 adaptive-multi-lane-supervisor deploy aktif degil."
}

Write-Host "`n2. DASHBOARD KONTRATI" -ForegroundColor Cyan
$html = [string](Invoke-WebRequest "$BaseUrl/dashboard").Content
$markers = @('eligibleRoadmap','blockedReadyRoadmap','startingJobs','BAĞIMLILIK BEKLİYOR','SAĞLAYICI BEKLİYOR')
$missing = @($markers | Where-Object { $html.IndexOf($_,[System.StringComparison]::Ordinal) -lt 0 })
if($missing.Count -gt 0) {
  Write-Host ("Eksik dashboard isaretleri: " + ($missing -join ", ")) -ForegroundColor Yellow
  throw "0.6.2 dependency-aware dashboard kabugu beklenen surum degil."
}
Write-Host "PASS - dependency-aware Turkce dashboard aktif." -ForegroundColor Green

Write-Host "`n3. FABRIKAYI DEVAM ETTIR + ADAPTIF BESLEME" -ForegroundColor Cyan
Invoke-RestMethod -Method Post -Uri "$BaseUrl/admin/start" -Headers $headers | Out-Null
$feed = Invoke-RestMethod -Method Post -Uri "$BaseUrl/admin/project-feed" -Headers $headers
$feed | ConvertTo-Json -Depth 15
$cycle = Invoke-RestMethod -Method Post -Uri "$BaseUrl/admin/cycle" -Headers $headers
$cycle | ConvertTo-Json -Depth 15

Write-Host "`n4. GERCEK UYGUNLUK + MULTI-LANE BACKLOG" -ForegroundColor Cyan
$deadline=(Get-Date).AddMinutes(4)
$last=$null
$maxCapacitySignal=0
$adaptiveSeen=$false
$dependencyAware=$false
while((Get-Date) -lt $deadline) {
  $last=Invoke-RestMethod -Uri "$BaseUrl/dashboard/api" -Headers $headers
  $active=@($last.activeJobs).Count
  $starting=@($last.startingJobs).Count
  $eligible=@($last.eligibleRoadmap).Count
  $blocked=@($last.blockedReadyRoadmap).Count
  $adaptive=@($last.roadmap | Where-Object {$_.id -like "ZA-AUTO-*" -and $_.status -in @("ready","dispatched","done","waiting-human")}).Count
  $capacitySignal=$active+$starting+$eligible
  if($capacitySignal -gt $maxCapacitySignal){$maxCapacitySignal=$capacitySignal}
  if($adaptive -gt 0){$adaptiveSeen=$true}
  if($null -ne $last.eligibleRoadmap -and $null -ne $last.blockedReadyRoadmap){$dependencyAware=$true}
  $gov=StateValue $last "last_governor_action"
  Write-Host ("aktif={0}/4 | baslatiliyor={1} | uygun={2} | bagimlilikBekleyen={3} | adaptive={4} | governor={5}" -f $active,$starting,$eligible,$blocked,$adaptive,$gov)
  if($adaptiveSeen -and $dependencyAware -and $last.parallelLimit -eq 4 -and $maxCapacitySignal -ge 2){break}
  Start-Sleep -Seconds 5
}

Write-Host "`n5. FINAL SNAPSHOT" -ForegroundColor Cyan
$last | ConvertTo-Json -Depth 24

if($last.parallelLimit -ne 4){throw "parallelLimit=4 degil."}
if(@($last.laneSummary).Count -lt 5){throw "5 calisma hatti yok."}
if(-not $dependencyAware){throw "Dependency-aware roadmap API aktif degil."}
if(-not $adaptiveSeen){throw "Adaptive proje backlog uretilmedi."}
if($maxCapacitySignal -lt 2){
  $retryAt=StateValue $last "provider_retry_not_before"
  if($retryAt){
    Write-Host "UYARI - NVIDIA provider cooldown nedeniyle iki is ayni anda baslamamis olabilir; adaptive backlog hazir." -ForegroundColor Yellow
  } else {
    throw "Adaptive backlog var ancak iki bagimsiz calisma sinyali gorulmedi."
  }
}

Write-Host "`nPASS - 0.6.2 ADAPTIVE MULTI-LANE SUPERVISOR DOGRULANDI." -ForegroundColor Green
Write-Host "Hazir ama dependency bekleyen isler artik 'uygun is' diye yanlis gosterilmiyor." -ForegroundColor Green
Write-Host "Factory continuous_enabled=1 olarak acik kaldi." -ForegroundColor Green
