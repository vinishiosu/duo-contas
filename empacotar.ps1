# duo-contas: monta o zip para compartilhar, a partir do que esta instalado em ~\.duo-contas.
#
#   powershell -ExecutionPolicy Bypass -File .\empacotar.ps1 [-Saida <pasta>] [-Repo <pasta do git>]
#
# Sai duo-contas-<versao>.zip (padrao: Downloads) com: README.md, instalar.ps1, desinstalar.ps1,
# o catalogo (.claude-plugin), o mod, a extensao do VS Code (.vsix e a fonte) e as previas.
# Fica de fora tudo o que e da maquina: contas, atividade, abas, troca, backup, config.json.
# Com -Repo, espelha os mesmos arquivos (mais este script) na copia local do repositorio do GitHub,
# apagando la o que saiu do pacote; o commit, o push e a release ficam por conta de quem publica.
# (Arquivo so com ASCII de proposito: o PowerShell 5.1 le .ps1 sem BOM como ANSI.)
param([string]$Saida = (Join-Path $env:USERPROFILE 'Downloads'), [string]$Repo)
$ErrorActionPreference = 'Stop'
$Raiz = Join-Path $env:USERPROFILE '.duo-contas'
$versao = (Get-Content -LiteralPath (Join-Path $Raiz 'mod\.claude-plugin\plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$nome = "duo-contas-$versao"
$tmp = Join-Path $env:TEMP $nome
if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$tmp = (Get-Item -LiteralPath $tmp).FullName # o TEMP vem com nome curto (VINICI~1); os arquivos, com o longo

foreach ($f in @('README.md', 'LICENSE', 'instalar.ps1', 'desinstalar.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $f) -Destination $tmp }
New-Item -ItemType Directory -Force -Path (Join-Path $tmp '.claude-plugin') | Out-Null
Copy-Item -LiteralPath (Join-Path $Raiz '.claude-plugin\marketplace.json') -Destination (Join-Path $tmp '.claude-plugin')

# o mod, sem os tipos que o engine gera e sem nada de node_modules
$modDe = Join-Path $Raiz 'mod'
$modPara = Join-Path $tmp 'mod'
foreach ($item in Get-ChildItem -LiteralPath $modDe -Recurse -File) {
  $rel = $item.FullName.Substring($modDe.Length + 1)
  if ($rel -like '.claude-plugin\types\*' -or $rel -like 'node_modules\*' -or $rel -like '*\node_modules\*') { continue }
  $alvo = Join-Path $modPara $rel
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $alvo) | Out-Null
  Copy-Item -LiteralPath $item.FullName -Destination $alvo
}

# a extensao: o .vsix mais novo e a fonte, para quem quiser ler antes de instalar
$ext = Join-Path $Raiz 'vscode-abas'
New-Item -ItemType Directory -Force -Path (Join-Path $tmp 'vscode\fonte') | Out-Null
$vsix = Get-ChildItem -LiteralPath $ext -Filter '*.vsix' | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $vsix) { throw "nenhum .vsix em $ext" }
Copy-Item -LiteralPath $vsix.FullName -Destination (Join-Path $tmp 'vscode')
foreach ($f in @('extension.js', 'package.json')) { Copy-Item -LiteralPath (Join-Path $ext $f) -Destination (Join-Path $tmp 'vscode\fonte') }

New-Item -ItemType Directory -Force -Path (Join-Path $tmp 'previa') | Out-Null
foreach ($f in @('claudinhos.gif', 'claudinhos-v081.png', 'agentes-v09.png')) {
  $p = Join-Path $Raiz "previa\$f"
  if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination (Join-Path $tmp 'previa') }
}

New-Item -ItemType Directory -Force -Path $Saida | Out-Null
$zip = Join-Path $Saida "$nome.zip"
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
# entradas com "/" (o CreateFromDirectory do .NET Framework grava "\", que outros descompactadores leem como nome)
$arquivoZip = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($item in Get-ChildItem -LiteralPath $tmp -Recurse -File -Force) {
    $entrada = "$nome/" + $item.FullName.Substring($tmp.Length + 1).Replace('\', '/')
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($arquivoZip, $item.FullName, $entrada, [IO.Compression.CompressionLevel]::Optimal)
  }
} finally {
  $arquivoZip.Dispose()
}

if ($Repo) {
  if (-not (Test-Path -LiteralPath (Join-Path $Repo '.git'))) { throw "$Repo nao e uma copia do repositorio (sem .git)" }
  Copy-Item -LiteralPath $PSCommandPath -Destination $tmp
  # os arquivos vao como estao, sem o git converter fim de linha (o repositorio fica igual ao zip)
  [IO.File]::WriteAllText((Join-Path $tmp '.gitattributes'), "* -text`n")
  $null = & robocopy $tmp $Repo /MIR /XD .git /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -ge 8) { throw "robocopy falhou ($LASTEXITCODE) ao espelhar em $Repo" }
  Write-Host "[duo-contas] arquivos espelhados em $Repo" -ForegroundColor Green
}
Remove-Item -LiteralPath $tmp -Recurse -Force
Write-Host "[duo-contas] $zip ($([math]::Round((Get-Item -LiteralPath $zip).Length / 1KB)) KB)" -ForegroundColor Green
