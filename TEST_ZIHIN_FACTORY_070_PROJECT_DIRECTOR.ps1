$ErrorActionPreference = "Stop"
$BaseUrl = "https://zihin-factory-governor.alerthum.workers.dev"

function Plain([Security.SecureString]$s) {
  $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try {[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)}
  finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}
}

$token = Plain (Read-Host "FACTORY_ADMIN_TOKEN" -AsSecureString)
$headers = @{ Authorization = "Bearer $token" }

Write-Host "1. SURUM / SAGLIK" -ForegroundColor Cyan
$health = Invoke-RestMethod "$BaseUrl/health"
$health | ConvertTo-Json -Depth 10
$version = @($health.meta | Where-Object {$_.key -eq "factory_version"} | Select-Object -First 1).value
if($version -ne "0.7.0" -or $health.phase -ne "project-director-production-engine") {
  throw "0.7.0 Project Director deploy aktif degil."
}

Write-Host "`n2. FABRIKAYI DEVAM ETTIR / DIRECTOR TURU" -ForegroundColor Cyan
$start = Invoke-RestMethod -Method Post -Uri "$BaseUrl/admin/start" -Headers $headers
$start | ConvertTo-Json -Depth 15

Write-Host "`n3. PROJECT DIRECTOR BACKLOG DOLDURMA" -ForegroundColor Cyan
$feed = Invoke-RestMethod -Method Post -Uri "$BaseUrl/admin/project-feed" -Headers $headers
$feed | ConvertTo-Json -Depth 15

Write-Host "`n4. DIRECTOR + 4 PARALEL SLOT KONTROLU" -ForegroundColor Cyan
$deadline=(Get-Date).AddMinutes(4)
$last=$null
$pass=$false
while((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 5
  $last=Invoke-RestMethod -Uri "$BaseUrl/dashboard/api" -Headers $headers
  $director=@($last.roadmap | Where-Object { $_.id -like "ZA-DIRECTOR-*" })
  $active=@($last.activeJobs).Count
  $starting=@($last.startingJobs).Count
  $eligible=@($last.eligibleRoadmap).Count
  $blockedDeps=@($last.blockedReadyRoadmap).Count
  $six=$last.last6h
  Write-Host ("director={0} | active={1} | starting={2} | eligible={3} | depWait={4} | last6h jobs={5} done={6} quarantine={7} blocked={8} PR={9}" -f `
    $director.Count,$active,$starting,$eligible,$blockedDeps,$six.jobs,$six.completed,$six.quarantine,$six.blocked,$six.prs)

  $directorState=@($last.state | Where-Object {$_.key -eq "project_director_mode"} | Select-Object -First 1).value
  if([int]$last.parallelLimit -eq 4 -and @($last.laneSummary).Count -eq 5 -and $directorState -eq "continuous-backlog" -and $director.Count -ge 4 -and (($active+$starting) -ge 1 -or $eligible -ge 4)) {
    $pass=$true
    break
  }
}

Write-Host "`n5. SON DURUM" -ForegroundColor Cyan
if($last){
  [pscustomobject]@{
    Version=$last.version
    ParallelLimit=$last.parallelLimit
    Active=@($last.activeJobs).Count
    Starting=@($last.startingJobs).Count
    Eligible=@($last.eligibleRoadmap).Count
    DependencyWaiting=@($last.blockedReadyRoadmap).Count
    DirectorRoadmap=@($last.roadmap | Where-Object {$_.id -like "ZA-DIRECTOR-*"}).Count
    Last6hJobs=$last.last6h.jobs
    Last6hCompleted=$last.last6h.completed
    Last6hQuarantine=$last.last6h.quarantine
    Last6hBlocked=$last.last6h.blocked
    Last6hPR=$last.last6h.prs
  } | Format-List
}

if($pass) {
  Write-Host "PASS - PROJECT DIRECTOR SUREKLI BACKLOG + MULTI-LANE MOTOR AKTIF." -ForegroundColor Green
  Write-Host "Fabrika tarayici kapali olsa da Cloudflare cron/queue/workflow uzerinden devam eder." -ForegroundColor Green
  exit 0
}

Write-Host "Project Director deploy oldu fakat 4 dakikalik pencerede yeterli executable backlog gorulmedi." -ForegroundColor Yellow
Write-Host "Dashboard Son 6 Saat ve Sorunlar/Cozumler alanlari tani icin kullanilabilir. Factory durdurulmadi." -ForegroundColor Yellow
exit 3
