# 启动本机 PostgreSQL（幂等：已在跑就直接返回）。
#
# 为什么需要这个脚本：本机没有 docker（daemon 不可用、`docker compose` 子命令也不存在），
# 数据库是 scoop 装的 PostgreSQL 18。`pg_ctl start` 在 Windows 上会阻塞当前控制台，
# 而用 `Start-Process -Wait` 起的话，postgres 会成为那个作业的子进程 ——
# 一旦外层作业被取消，数据库跟着死（实测踩过：job_kill 把 postgres 一起杀了）。
# 所以这里用 -WindowStyle Hidden 且不 -Wait，让 postgres 真正脱离。
param(
    [string]$PgRoot = "C:\Users\Yhwhy\scoop\apps\postgresql\current"
)

$ErrorActionPreference = "Stop"

$bin = Join-Path $PgRoot "bin"
$data = Join-Path $PgRoot "data"
$log = Join-Path $PgRoot "pg.log"
$pgctl = Join-Path $bin "pg_ctl.exe"

if (-not (Test-Path $pgctl)) {
    Write-Error "找不到 pg_ctl.exe：$pgctl"
    exit 1
}

# 已经能连上就不动它
$listening = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue
if ($listening) {
    Write-Output "PostgreSQL 已在 127.0.0.1:5432 监听（PID $($listening[0].OwningProcess)），跳过启动。"
    exit 0
}

Write-Output "启动 PostgreSQL（data=$data）…"
Start-Process -FilePath $pgctl `
    -ArgumentList "start", "-D", $data, "-l", $log `
    -WindowStyle Hidden

# 等它真的能接连接，最多 30 秒
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $conn = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        Write-Output "已就绪：127.0.0.1:5432（PID $($conn[0].OwningProcess)）"
        exit 0
    }
}

Write-Error "30 秒内没起来，看日志：$log"
exit 1
