<#
.SYNOPSIS
  Publica o backend do SCE no Google Cloud Run, sem tocar no Render.

.DESCRIPTION
  Diferente do sci-chamados, aqui nao ha Prisma, migrations nem build step:
  o server.js e JS puro e so preciso de 4 segredos + 2 variaveis de ambiente.
  O script cria a infra, sobe os segredos, builda a imagem e publica o servico.

  A regiao padrao e us-west1 porque o pooler do Supabase do portal fica em
  us-west-2 (mesmo host, mesmo Supabase).

  O Render nao e desconfigurado: nada aqui altera o proxy do vercel.json nem
  apaga o servico. Troque o destino do proxy so DEPOIS de validar aqui.

.EXAMPLE
  ./deploy-sce.ps1 -ProjectId portal-ure -SecretsFile deploy/secrets.env

.EXAMPLE
  Sem mexer nos segredos (ja estao no Secret Manager):
  ./deploy-sce.ps1 -ProjectId portal-ure
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [string]$Region     = 'us-west1',
  [string]$Service    = 'sce-api',
  [string]$Repository = 'sce-backend',
  [string]$EnvFile    = 'deploy/env-producao.yaml',
  [string]$SecretsFile = '',
  [string]$Tag        = ''
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }
function Die($msg)  { Write-Host "    ERRO: $msg" -ForegroundColor Red; exit 1 }

# --- pre-requisitos --------------------------------------------------------
Step 'Verificando ferramentas'
foreach ($bin in @('gcloud', 'docker')) {
  if (-not (Get-Command $bin -ErrorAction SilentlyContinue)) { Die "'$bin' nao encontrado no PATH." }
}
if (-not $Tag) { $Tag = (Get-Date -Format 'yyyyMMdd-HHmmss') }
Ok "gcloud e docker ok. Tag: $Tag"

gcloud config set project $ProjectId | Out-Null

# --- 1. APIs ---------------------------------------------------------------
Step 'Habilitando APIs do Google Cloud'
foreach ($api in @('run.googleapis.com', 'artifactregistry.googleapis.com', 'secretmanager.googleapis.com')) {
  gcloud services enable $api --quiet 2>$null
}
Ok 'APIs habilitadas'

# --- 2. Artifact Registry --------------------------------------------------
Step 'Garantindo o repositorio de imagens'
$Registry = "$Region-docker.pkg.dev"
$RepoPath = "$ProjectId/$Repository"
$exists = gcloud artifacts repositories describe $RepoPath --location $Region --format='value(name)' 2>$null
if (-not $exists) {
  gcloud artifacts repositories create $Repository `
    --repository-format docker --location $Region `
    --description 'Imagens do backend do SCE' --quiet | Out-Null
  Ok "repositorio $Repository criado"
} else {
  Ok "repositorio $Repository ja existe"
}

$Image = "$Registry/$RepoPath/${Service}:$Tag"

# --- 3. Segredos -----------------------------------------------------------
# As 4 chaves que o container realmente usa. GOOGLE_*/SPREADSHEET_* ficam de
# fora de proposito: so os scripts locais de migracao leem essas.
$SecretEnvVars = @(
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'SSO_SECRET', 'SCE_SYNC_KEY'
)

if ($SecretsFile) {
  $resolved = if ([IO.Path]::IsPathRooted($SecretsFile)) { $SecretsFile } else { Join-Path $RepoRoot $SecretsFile }
  if (-not (Test-Path $resolved)) { Die "SecretsFile nao encontrado: $resolved" }

  Step 'Criando/atualizando segredos no Secret Manager'
  foreach ($line in Get-Content $resolved) {
    if ($line -match '^\s*(#|$)') { continue }
    $parts = $line -split '=', 2
    if ($parts.Count -ne 2) { continue }
    $key = $parts[0].Trim()
    $val = $parts[1].Trim()
    if (-not $val) { Warn "$key vazio no arquivo, pulando"; continue }
    if ($key -notin $SecretEnvVars) { Warn "$key nao esta na lista do container, pulando"; continue }

    $kebab = ($key -creplace '([a-z0-9])([A-Z])', '$1-$2').ToLower()
    $name = "sce-$kebab"

    # --data-file=- le do stdin; o proprio gcloud faz a base64.
    if (gcloud secrets describe $name --location $Region 2>$null) {
      $val | gcloud secrets versions add $name --data-file=- --location $Region --quiet | Out-Null
    } else {
      gcloud secrets create $name --replication-policy automatic --location $Region --quiet | Out-Null
      $val | gcloud secrets versions add $name --data-file=- --location $Region --quiet | Out-Null
    }
    Ok "secret $name atualizado"
  }
}

$secretFlags = @()
foreach ($key in $SecretEnvVars) {
  $kebab = ($key -creplace '([a-z0-9])([A-Z])', '$1-$2').ToLower()
  $name = "sce-$kebab"
  if (gcloud secrets describe $name --location $Region 2>$null) {
    $secretFlags += "$key=${name}:latest"
  }
}
if ($secretFlags.Count -eq 0) { Die 'Nenhum segredo encontrado. Crie-os ou use -SecretsFile.' }
Ok "$($secretFlags.Count) segredo(s) serao injetados"

# Aviso que evita o erro de SSO mais comum.
if ($SecretsFile) {
  Warn 'Confirme que SSO_SECRET e IGUAL ao JWT_SECRET do backend de chamados.'
}

# --- 4. Imagem -------------------------------------------------------------
Step 'Build da imagem (contexto = raiz do repo)'
Push-Location $RepoRoot
try {
  docker build -f Dockerfile -t $Image .
  if ($LASTEXITCODE -ne 0) { Die 'docker build falhou.' }
  docker push $Image
  if ($LASTEXITCODE -ne 0) { Die 'docker push falhou.' }
  Ok "imagem publicada: $Image"
} finally { Pop-Location }

# --- 5. Servico ------------------------------------------------------------
Step 'Publicando o servico'
$envFileArg = @()
if ($EnvFile -and (Test-Path (Join-Path $RepoRoot $EnvFile))) {
  $envFileArg = @('--set-env-vars-file', $EnvFile)
  Ok "usando $EnvFile"
}

gcloud run deploy $Service `
  --image $Image `
  --region $Region `
  --platform managed `
  --allow-unauthenticated `
  --port 8080 `
  --cpu 1 `
  --memory 512Mi `
  --concurrency 80 `
  --min-instances 0 `
  --max-instances 5 `
  --startup-probe 'httpGet.path=/health,httpGet.port=8080,initialDelaySeconds=0,periodSeconds=5,timeoutSeconds=5,failureThreshold=12' `
  --set-secrets ($secretFlags -join ',') `
  @envFileArg `
  --quiet

if ($LASTEXITCODE -ne 0) { Die 'gcloud run deploy falhou.' }

$url = (gcloud run services describe $Service --region $Region --format='value(status.url)' 2>$null)
Ok "servico no ar: $url"

# --- 6. Validacao ----------------------------------------------------------
Step 'Health check'
$ok = $false
for ($i = 0; $i -lt 12; $i++) {
  Start-Sleep -Seconds 5
  try {
    $r = Invoke-RestMethod -Uri "$url/health" -TimeoutSec 10
    if ($r.success) { Ok "saudavel"; $ok = $true; break }
  } catch { }
}
if (-not $ok) { Warn "Ainda nao respondeu. Confira: gcloud run services logs tail $Service --region $Region" }

Write-Host "`n--- Proximos passos ------------------------------------------" -ForegroundColor Cyan
Write-Host "1. Aponte o proxy do sce/vercel.json (linha 8) para esta URL:"
Write-Host "     destination: `"$url/api/`$1`""
Write-Host "   Antigamente:  https://sce-nyjc.onrender.com/api/`$1"
Write-Host "2. O SCE e acessado pelo portal pela variavel VITE_API_SCE_URL no Vercel."
Write-Host "   Se ela aponta direto para o host antigo do Render, atualize e"
Write-Host "   REFAÇA O DEPLOY do portal (o Vite congela a variavel no build)."
Write-Host "3. Teste o SSO entrando pelo portal e abrindo um equipamento."
Write-Host "   Se der 401, provavelmente SSO_SECRET != JWT_SECRET."
Write-Host "4. So desligue o Render depois de validar."
