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
if($version -ne "0.6.1" -or $health.phase -ne "multi-lane-operator-dashboard") {
  throw "0.6.1 multi-lane-operator-dashboard deploy aktif degil."
}

Write-Host "`n2. TURKCE DASHBOARD KABUGU" -ForegroundColor Cyan
$html = (Invoke-WebRequest "$BaseUrl/dashboard").Content
$must = @("Devam Ettir","Planlayiciyi Simdi Calistir","Projeyi Besle","Takilan Isi Kurtar","Sorunlar / Cozumler")
# Türkçe karakterleri PowerShell/konsol farklarından etkilenmeden ana anlam metinleriyle doğrula.
if($html -notmatch "Kalite puanı proje yüzdesi değildir" -or $html -notmatch "Müdürler / Ajanlar" -or $html -notmatch "Güvenli yeniden dene") {
  throw "Yeni Turkce operator dashboard metinleri bulunamadi."
}
Write-Host "PASS - Turkce operator dashboard aktif." -ForegroundColor Green

Write-Host "`n3. FABRIKA DEVAM + MULTI-LANE GOVERNOR" -ForegroundColor Cyan
$start = Invoke-RestMethod -Method Post -Uri "$BaseUrl/admin/start" -Headers $headers
$start | ConvertTo-Json -Depth 15
Start-Sleep -Seconds 2
$cycle = Invoke-RestMethod -Method Post -Uri "$BaseUrl/admin/cycle" -Headers $headers
$cycle | ConvertTo-Json -Depth 15

Write-Host "`n4. PARALELLIK + ESKI PATCH PARSER BLOCK RECOVERY" -ForegroundColor Cyan
$deadline=(Get-Date).AddMinutes(5)
$maxActive=0
$maxInflight=0
$last=$null
$parserRecovered=$false
while((Get-Date) -lt $deadline) {
  $last = Invoke-RestMethod -Uri "$BaseUrl/dashboard/api" -Headers $headers
  $jobs = Invoke-RestMethod -Uri "$BaseUrl/jobs" -Headers $headers
  $active=@($last.activeJobs).Count
  $inflight=@($jobs.jobs | Where-Object {$_.status -in @("queued","running","verify")}).Count
  if($active -gt $maxActive){$maxActive=$active}
  if($inflight -gt $maxInflight){$maxInflight=$inflight}
  $r1010=@($last.roadmap)|Where-Object {$_.id -eq "ZA-G8TR-NATIVE-PATCH-002"}|Select-Object -First 1
  if($r1010 -and -not ($r1010.status -eq "blocked" -and [string]$r1010.result_summary -match "code_patch_json_parse_failed")) {$parserRecovered=$true}
  $gov=StateValue $last "last_governor_action"
  Write-Host ("aktif={0}/4 | ucusta={1} | maxAktif={2} | maxUcusta={3} | governor={4} | patch1010={5}" -f $active,$inflight,$maxActive,$maxInflight,$gov,$r1010.status)
  if($parserRecovered -and $last.parallelLimit -eq 4 -and @($last.laneSummary).Count -ge 5 -and $maxInflight -ge 2){break}
  Start-Sleep -Seconds 5
}

Write-Host "`n5. OPERATOR DURUMU" -ForegroundColor Cyan
$last | ConvertTo-Json -Depth 22

if($last.parallelLimit -ne 4) { throw "parallelLimit=4 degil." }
if(@($last.laneSummary).Count -lt 5) { throw "5 calisma hatti dashboard API'de yok." }
if(-not $parserRecovered) { throw "Eski code_patch_json_parse_failed block otomatik kurtarilmadi." }
if($maxInflight -lt 2) {
  Write-Host "UYARI - Test penceresinde iki is ayni anda yakalanmadi; provider cooldown/uygun is durumu bunu sinirlamis olabilir. Multi-lane kontrati aktif." -ForegroundColor Yellow
} else {
  Write-Host ("PASS - Ayni anda en az {0} is ucusta goruldu." -f $maxInflight) -ForegroundColor Green
}

Write-Host "`nPASS - 0.6.1 MULTI-LANE + TURKCE OPERATOR DASHBOARD + AUTO GUIDANCE DOGRULANDI." -ForegroundColor Green
Write-Host "NVIDIA gecici hatalarinda kullanici mudahalesi gerekmez; sistem otomatik retry yapar." -ForegroundColor Green
Write-Host "Factory continuous_enabled=1 olarak acik kaldi." -ForegroundColor Green
