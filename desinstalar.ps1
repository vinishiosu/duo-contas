# duo-contas: desinstalador. Tira o plugin das duas contas, os comandos do perfil do PowerShell e a
# extensao do VS Code. Os arquivos em ~\.duo-contas ficam, a menos que passe -ApagarTudo.
#
#   powershell -ExecutionPolicy Bypass -File .\desinstalar.ps1 [-ApagarTudo] [-SemVSCode] [-SemPerfil]
#
# (Arquivo so com ASCII de proposito: o PowerShell 5.1 le .ps1 sem BOM como ANSI.)
param([switch]$ApagarTudo, [switch]$SemVSCode, [switch]$SemPerfil)
$ErrorActionPreference = 'Continue'
$Raiz = Join-Path $env:USERPROFILE '.duo-contas'
$Catalogo = 'duo-contas-local'

function Diz([string]$texto, [string]$cor = 'Cyan') { Write-Host "[duo-contas] $texto" -ForegroundColor $cor }

$PastaEmpresa = Join-Path $env:USERPROFILE '.claude-empresa'
$arqConfig = Join-Path $Raiz 'config.json'
if (Test-Path -LiteralPath $arqConfig) {
  try { $cfg = Get-Content -LiteralPath $arqConfig -Raw -Encoding UTF8 | ConvertFrom-Json; if ($cfg.pastaEmpresa) { $PastaEmpresa = $cfg.pastaEmpresa } } catch {}
}

foreach ($conta in @(@{ nome = 'pessoal'; dir = $null }, @{ nome = 'empresa'; dir = $PastaEmpresa })) {
  $antes = $env:CLAUDE_CONFIG_DIR
  if ($conta.dir) { $env:CLAUDE_CONFIG_DIR = $conta.dir } else { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
  $null = & claude plugin uninstall "duo-contas@$Catalogo" 2>&1
  $null = & claude plugin marketplace remove $Catalogo 2>&1
  if ($null -eq $antes) { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue } else { $env:CLAUDE_CONFIG_DIR = $antes }
  Diz "conta $($conta.nome): plugin removido"
}

$perfil = $PROFILE.CurrentUserAllHosts
if (-not $SemPerfil -and (Test-Path -LiteralPath $perfil)) {
  $texto = [IO.File]::ReadAllText($perfil)
  if ($texto -match '# duo-contas \(inicio\)') {
    [IO.File]::WriteAllText($perfil, [regex]::Replace($texto, '(?s)\r?\n?# duo-contas \(inicio\).*?# duo-contas \(fim\)\r?\n?', "`r`n"))
    Diz "comandos tirados de $perfil"
  }
}

if (-not $SemVSCode -and (Get-Command code -ErrorAction SilentlyContinue)) {
  $null = & code --uninstall-extension vinishiosu.duo-contas-abas 2>&1
  Diz 'extensao do VS Code removida'
}

if ($ApagarTudo -and (Test-Path -LiteralPath $Raiz)) {
  Remove-Item -LiteralPath $Raiz -Recurse -Force
  Diz "$Raiz apagado"
} else {
  Diz "os arquivos continuam em $Raiz (apague a pasta, ou rode com -ApagarTudo)"
}
Diz 'Feche e abra o terminal para os comandos claude-duo/claude-empresa sumirem.' 'White'
