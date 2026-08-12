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
function Api([string]$method,[string]$path,$body=$null) {
  $args=@{ Method=$method; Uri="$BaseUrl$path"; Headers=$headers }
  if($null -ne $body){$args.ContentType="application/json";$args.Body=($body|ConvertTo-Json -Depth 20 -Compress)}
  Invoke-RestMethod @args
}

$token = Plain (Read-Host "FACTORY_ADMIN_TOKEN" -AsSecureString)
$headers = @{ Authorization = "Bearer $token" }

Write-Host "1. HEALTH / VERSION" -ForegroundColor Cyan
$health = Invoke-RestMethod "$BaseUrl/health"
$health | ConvertTo-Json -Depth 10
$version = @($health.meta | Where-Object {$_.key -eq "factory_version"} | Select-Object -First 1).value
if($health.phase -ne "production-loop-dashboard" -or $version -ne "0.6.0") { throw "0.6.0 production-loop-dashboard deploy aktif degil." }

Write-Host "`n2. DASHBOARD PUBLIC SHELL" -ForegroundColor Cyan
$page = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/dashboard"
if($page.StatusCode -ne 200 -or $page.Content -notmatch "Zihin Factory") { throw "Dashboard HTML shell acilmadi." }
Write-Host "PASS - $BaseUrl/dashboard" -ForegroundColor Green

Write-Host "`n3. PRODUCT GITHUB LIVE READINESS" -ForegroundColor Cyan
$gh = Api "GET" "/github/status"
$product = @($gh.live) | Where-Object {$_.alias -eq "product"} | Select-Object -First 1
$gh | ConvertTo-Json -Depth 12
if(-not $gh.secretConfigured){throw "GITHUB_TOKEN Worker secret gorunmuyor."}
if(-not $product -or -not $product.ok){throw "Product repo live access FAIL."}
if($product.repo -ne "alerthum/KuzenlerYarisiyor"){throw "Product repo yanlis: $($product.repo)"}

Write-Host "`n4. PROJECT FEED + CONTINUOUS START" -ForegroundColor Cyan
$feed = Api "POST" "/admin/project-feed"
$feed | ConvertTo-Json -Depth 15
$start = Api "POST" "/admin/start"
$start | ConvertTo-Json -Depth 15

Write-Host "`n5. DASHBOARD DATA CONTRACT" -ForegroundColor Cyan
$snap = Api "GET" "/dashboard/api"
$recon = @($snap.roadmap) | Where-Object {$_.id -eq "ZA-PRODUCT-RECON-001"} | Select-Object -First 1
$patch = @($snap.roadmap) | Where-Object {$_.id -eq "ZA-G8TR-NATIVE-PATCH-002"} | Select-Object -First 1
if(-not $recon -or -not $patch){throw "JOB-009 project feeder roadmap seed eksik."}
if(@($snap.agents).Count -lt 10){throw "Dashboard agent/mudur contract eksik."}
if((StateValue $snap "project_feeder_enabled") -ne "1"){throw "Project feeder enabled degil."}
Write-Host ("roadmap seed OK | RECON={0} | PATCH={1} | agents={2}" -f $recon.status,$patch.status,@($snap.agents).Count) -ForegroundColor Green

Write-Host "`n6. FIRST AUTONOMOUS PRODUCT LOOP START EVIDENCE" -ForegroundColor Cyan
$deadline=(Get-Date).AddMinutes(6)
$started=$false
$last=$snap
$counter=0
while((Get-Date) -lt $deadline){
  $last=Api "GET" "/dashboard/api"
  $recon=@($last.roadmap)|Where-Object {$_.id -eq "ZA-PRODUCT-RECON-001"}|Select-Object -First 1
  $patch=@($last.roadmap)|Where-Object {$_.id -eq "ZA-G8TR-NATIVE-PATCH-002"}|Select-Object -First 1
  $productActive=@($last.activeJobs)|Where-Object {$_.job_type -in @("product.repo-recon","product.code-patch")}|Select-Object -First 1
  $productEvent=@($last.recentEvents)|Where-Object {$_.event_type -in @("repo_recon_evidence_ready","product_patch_discovery_started","product_patch_producer_started","product_draft_pr_created")}|Select-Object -First 1
  $continuous=StateValue $last "continuous_enabled"
  $stage=if($productEvent){"$($productEvent.event_type):$($productEvent.message)"}elseif($productActive){$productActive.latest_event}else{"-"}
  Write-Host ("continuous={0} | RECON={1} | PATCH={2} | activeProduct={3} | stage={4}" -f $continuous,$recon.status,$patch.status,[bool]$productActive,$stage)
  if($continuous -eq "1" -and (($recon.work_queue_id) -or ($patch.work_queue_id) -or $productActive -or $productEvent)){$started=$true;break}
  $counter++
  if(($counter % 4) -eq 0){ try { $null=Api "POST" "/admin/cycle" } catch {} }
  Start-Sleep -Seconds 5
}

Write-Host "`n7. FINAL JOB-009 SNAPSHOT" -ForegroundColor Cyan
$last=Api "GET" "/dashboard/api"
$last | ConvertTo-Json -Depth 20

if(-not $started){throw "Production feeder seed edildi fakat 6 dakika icinde ilk product workflow baslangic kaniti gelmedi."}
if((StateValue $last "continuous_enabled") -ne "1"){throw "Factory continuous_enabled=1 degil."}

Write-Host "`nPASS - JOB-009 DASHBOARD + PROJECT FEEDER + PRODUCTION LOOP KURULDU." -ForegroundColor Green
Write-Host "Dashboard: $BaseUrl/dashboard" -ForegroundColor Green
Write-Host "Factory Cloudflare'da continuous_enabled=1 olarak acik kaldi." -ForegroundColor Green
Write-Host "Ilk product repo gorevleri artik cron/Governor tarafindan otonom ilerler; QA PASS code patch Draft PR olarak dashboard'a duser." -ForegroundColor Green
