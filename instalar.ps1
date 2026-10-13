# duo-contas: instalador. Rode na pasta onde descompactou o zip, num PowerShell:
#
#   powershell -ExecutionPolicy Bypass -File .\instalar.ps1
#
# Opcoes:
#   -PastaEmpresa <pasta>   pasta de configuracao da conta que se gasta primeiro ("empresa").
#                           Padrao: ~\.claude-empresa. A outra ("pessoal") e a padrao do Claude, ~\.claude.
#   -SemVSCode              nao instala a extensao do VS Code
#   -SemPerfil              nao cria os comandos claude-duo e claude-empresa no perfil do PowerShell
#
# Pode rodar de novo para atualizar: o mod anterior vai para ~\.duo-contas\backup e o estado fica.
# (Arquivo so com ASCII de proposito: o PowerShell 5.1 le .ps1 sem BOM como ANSI.)
param(
  [string]$PastaEmpresa = (Join-Path $env:USERPROFILE '.claude-empresa'),
  [switch]$SemVSCode,
  [switch]$SemPerfil
)
$ErrorActionPreference = 'Stop'
$Origem = $PSScriptRoot
$Raiz = Join-Path $env:USERPROFILE '.duo-contas'
$Catalogo = 'duo-contas-local'

function Diz([string]$texto, [string]$cor = 'Cyan') { Write-Host "[duo-contas] $texto" -ForegroundColor $cor }

# --- 1. requisitos ---------------------------------------------------------------------------
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  throw 'O Claude Code (comando claude) nao esta no PATH. Instale-o antes e rode este script de novo.'
}
$versao = (& claude --version) -join ' '
Diz "Claude Code encontrado: $versao"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Diz 'node nao encontrado: o painel funciona, so a RAM da maquina nao aparece nele.' 'Yellow'
}
$PastaEmpresa = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($PastaEmpresa))
if ($PastaEmpresa.TrimEnd('\') -ieq (Join-Path $env:USERPROFILE '.claude')) {
  throw '-PastaEmpresa nao pode ser ~\.claude: essa e a pasta da conta pessoal. Use outra, como ~\.claude-empresa.'
}

# --- 2. arquivos em ~\.duo-contas (o estado que ja existir fica) -------------------------------
New-Item -ItemType Directory -Force -Path $Raiz | Out-Null
$modAqui = Join-Path $Raiz 'mod'
if (Test-Path -LiteralPath $modAqui) {
  $guarda = Join-Path $Raiz ('backup\mod-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $guarda) | Out-Null
  Move-Item -LiteralPath $modAqui -Destination $guarda
  Diz "versao anterior do mod guardada em $guarda"
}
Copy-Item -LiteralPath (Join-Path $Origem 'mod') -Destination $modAqui -Recurse -Force
New-Item -ItemType Directory -Force -Path (Join-Path $Raiz '.claude-plugin') | Out-Null
Copy-Item -LiteralPath (Join-Path $Origem '.claude-plugin\marketplace.json') -Destination (Join-Path $Raiz '.claude-plugin\marketplace.json') -Force
# arquivos baixados da internet vem "bloqueados" e o PowerShell recusaria rodar o claude-duo.ps1
Get-ChildItem -LiteralPath $Raiz -Recurse -File | Unblock-File
[IO.File]::WriteAllText((Join-Path $Raiz 'config.json'), (@{ pastaEmpresa = $PastaEmpresa } | ConvertTo-Json -Compress))
Diz "arquivos em $Raiz (conta empresa: $PastaEmpresa)" 'Green'

# --- 3. o plugin nas duas contas --------------------------------------------------------------
function Install-NaConta([string]$nome, [string]$dir) {
  $ErrorActionPreference = 'Continue' # o claude escreve avisos no stderr; nao e erro
  $antes = $env:CLAUDE_CONFIG_DIR
  try {
    if ($dir) { $env:CLAUDE_CONFIG_DIR = $dir } else { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
    $null = & claude plugin marketplace add $Raiz 2>&1 # ja adicionado numa instalacao anterior: segue
    $saida = & claude plugin install "duo-contas@$Catalogo" 2>&1
    if ($LASTEXITCODE -eq 0) { Diz "conta ${nome}: plugin instalado" 'Green' }
    elseif ("$saida" -match 'already|ja esta|instalad') { Diz "conta ${nome}: plugin ja estava instalado (atualizado pelos arquivos novos)" 'Green' }
    else { Diz "conta ${nome}: a instalacao respondeu: $("$saida".Trim())" 'Yellow' }
  } finally {
    if ($null -eq $antes) { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue } else { $env:CLAUDE_CONFIG_DIR = $antes }
  }
}
Install-NaConta 'pessoal' $null
Install-NaConta 'empresa' $PastaEmpresa

# --- 4. os comandos claude-duo e claude-empresa ------------------------------------------------
if (-not $SemPerfil) {
  $perfil = $PROFILE.CurrentUserAllHosts
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $perfil) | Out-Null
  $bloco = @(
    '# duo-contas (inicio) - criado pelo instalar.ps1; o desinstalar.ps1 tira',
    'function claude-duo { & "$env:USERPROFILE\.duo-contas\mod\bin\claude-duo.ps1" @args }',
    'function claude-empresa { & "$env:USERPROFILE\.duo-contas\mod\bin\claude-duo.ps1" @args }',
    '# duo-contas (fim)'
  ) -join "`r`n"
  $atual = if (Test-Path -LiteralPath $perfil) { [IO.File]::ReadAllText($perfil) } else { '' }
  $atual = [regex]::Replace($atual, '(?s)# duo-contas \(inicio\).*?# duo-contas \(fim\)\r?\n?', '')
  [IO.File]::WriteAllText($perfil, ($atual.TrimEnd() + "`r`n`r`n" + $bloco + "`r`n").TrimStart())
  Diz "comandos claude-duo e claude-empresa criados em $perfil" 'Green'
  $politica = Get-ExecutionPolicy
  if ($politica -in @('Restricted', 'AllSigned')) {
    Diz "a politica de execucao do PowerShell ($politica) nao carrega o perfil. Rode uma vez:" 'Yellow'
    Diz '    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned' 'Yellow'
  }
}

# --- 5. a extensao do VS Code ------------------------------------------------------------------
if (-not $SemVSCode) {
  $ErrorActionPreference = 'Continue'
  $vsix = Get-ChildItem -LiteralPath (Join-Path $Origem 'vscode') -Filter '*.vsix' | Sort-Object Name | Select-Object -Last 1
  if (-not (Get-Command code -ErrorAction SilentlyContinue)) {
    Diz 'VS Code (comando code) nao encontrado: sem a extensao ficam de fora a ordem das abas e o /trocar-conta na mesma aba.' 'Yellow'
  } elseif ($vsix) {
    $null = & code --install-extension $vsix.FullName --force 2>&1
    Diz 'extensao do VS Code instalada: no VS Code, rode "Developer: Reload Window" uma vez' 'Green'
  }
  $ErrorActionPreference = 'Stop'
}

Write-Host ''
Diz 'Pronto. Falta so:' 'White'
Diz "  1. Entrar na conta empresa uma vez:   `$env:CLAUDE_CONFIG_DIR = '$PastaEmpresa'; claude   (e /login nela)" 'White'
Diz '  2. Abrir um terminal novo e usar:      claude-empresa' 'White'
Diz '  Guia completo: README.md (ou https://github.com/vinishiosu/duo-contas)' 'White'
