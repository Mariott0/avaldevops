$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
New-Item -ItemType Directory -Force evidencias | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Start-Transcript -Path "evidencias/validacao-$stamp.log"
function Assert-Exit([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step falhou (exit $LASTEXITCODE)." }
}
try {
    docker info --format '{{.ServerVersion}}'
    Assert-Exit 'Docker Engine'
    docker compose config --quiet
    Assert-Exit 'Compose'
    # cmd oferece o redirecionamento < exigido, que nao existe no PowerShell.
    cmd /d /c 'docker run --rm -i hadolint/hadolint < api/Dockerfile'
    Assert-Exit 'Hadolint'
    Write-Output 'PASS: Hadolint aprovado sem avisos ou erros (exit 0).'
    docker compose up -d --build --wait
    Assert-Exit 'Inicializacao'
    Write-Output '> docker exec backend_api whoami'
    $userName = docker exec backend_api whoami
    Assert-Exit 'whoami'
    Write-Output $userName
    if ($userName.Trim() -ne 'appuser') { throw 'Usuario inesperado.' }
    docker exec backend_api id
    Assert-Exit 'id'
    $uid = docker exec backend_api id -u
    Assert-Exit 'UID'
    $gid = docker exec backend_api id -g
    Assert-Exit 'GID'
    if ($uid.Trim() -ne '10001' -or $gid.Trim() -ne '10001') { throw 'UID/GID incorretos.' }
    Write-Output '> docker exec backend_api touch /teste.txt'
    # Captura stderr nativo sem interromper o teste negativo no Windows PowerShell.
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $denial = docker exec backend_api touch /teste.txt 2>&1
    $touchExit = $LASTEXITCODE
    $ErrorActionPreference = $oldPreference
    Write-Output $denial
    if ($touchExit -eq 0 -or "$denial" -notmatch 'Read-only file system') { throw 'Raiz nao comprovada como read-only.' }
    $state = (docker inspect backend_api | ConvertFrom-Json)[0]
    Assert-Exit 'Inspect'
    if (!$state.HostConfig.ReadonlyRootfs -or 'ALL' -notin $state.HostConfig.CapDrop -or 'no-new-privileges:true' -notin $state.HostConfig.SecurityOpt) { throw 'Hardening incompleto.' }
    $processStatus = docker exec backend_api cat /proc/1/status
    Assert-Exit 'Status do processo'
    if (($processStatus -join "`n") -notmatch 'CapEff:\s+0000000000000000' -or ($processStatus -join "`n") -notmatch 'NoNewPrivs:\s+1') { throw 'Privilegios efetivos inesperados.' }
    $processStatus | Select-String '^(CapEff|NoNewPrivs):'
    if (!$state.HostConfig.Tmpfs.'/tmp') { throw '/tmp nao e tmpfs.' }
    $dataMount = $state.Mounts | Where-Object { $_.Destination -eq '/app/data' }
    if (!$dataMount -or $dataMount.Type -ne 'volume' -or !$dataMount.RW) { throw 'Volume SQLite incorreto.' }
    docker exec backend_api sh -c 'ls -ld /app/data && touch /tmp/teste-tmpfs && rm /tmp/teste-tmpfs'
    Assert-Exit 'tmpfs'
    $marker = 'Persistencia-' + [guid]::NewGuid().ToString()
    $loginBody = @{username='admin';password='admin'} | ConvertTo-Json
    $login = Invoke-RestMethod 'http://localhost:8080/api/auth/login' -Method Post -ContentType 'application/json' -Body $loginBody
    $headers = @{Authorization="Bearer $($login.token)"}
    $body = @{title=$marker;description='Teste de hardening';status='todo'} | ConvertTo-Json
    $saved = (Invoke-RestMethod 'http://localhost:8080/api/tasks' -Method Post -Headers $headers -ContentType 'application/json' -Body $body).task
    Write-Output "POST via Nginx: id=$($saved.id), title=$marker"
    docker exec backend_api ls -ln /app/data/app.db
    Assert-Exit 'Arquivo SQLite'
    # Recria os containers, preservando o volume nomeado.
    docker compose up -d --force-recreate --wait
    Assert-Exit 'Recriacao'
    $tasks = (Invoke-RestMethod 'http://localhost:8080/api/tasks' -Headers $headers).tasks
    if (!($tasks | Where-Object { $_.id -eq $saved.id -and $_.title -eq $marker })) { throw 'Dado nao persistiu.' }
    Write-Output 'PASS: usuario, raiz read-only, controles defensivos, tmpfs e persistencia apos recriacao.'
    Write-Output 'Capture tambem os testes no terminal e uma gravacao pelo formulario do navegador.'
} finally {
    Stop-Transcript
}
