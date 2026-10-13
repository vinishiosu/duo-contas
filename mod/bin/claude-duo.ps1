# claude-duo: abre o Claude Code pela conta da empresa e, quando o mod duo-contas
# pede a troca (janela de 5h ou de 7 dias da empresa no limite), retoma a MESMA
# sessao na conta pessoal, no mesmo terminal: a conversa inteira vai junto, e as
# memorias criadas ou editadas durante a sessao tambem.
#
#   claude-duo                      comeca pela empresa (ou pela pessoal, se a empresa ja estiver no limite)
#   claude-duo --conta pessoal      escolhe a conta inicial (empresa | pessoal)
#   claude-duo --resume <id> ...    o resto vai direto para o claude
#   claude-duo --abrir <pedido>     usado pelo mod quando a sessao nao foi aberta pelo claude-duo: abre uma janela nova com o --retomar
#   claude-duo --retomar <pedido>   retoma, neste terminal, a sessao do pedido na outra conta
#   claude-duo --acordar <conta>    usado pelo mod: manda "oi" (haiku, invisivel) para a janela de 5h da conta comecar
#   claude-duo --encerrar <seg>     usado pelo mod ao trocar: se o /exit nao sair em <seg> s (sessao parada no
#                                   limite, /exit na fila), encerra o claude que chamou; o claude-duo do terminal retoma
#
# Contas: empresa = CLAUDE_CONFIG_DIR na pasta de ~\.duo-contas\config.json (padrao ~\.claude-empresa);
# pessoal = sem CLAUDE_CONFIG_DIR (~\.claude). O claude-empresa (funcao do perfil do PowerShell que o
# instalar.ps1 cria, ou ~\bin\claude-empresa.ps1) chama este script: e o que liga a troca automatica.
# (Arquivo so com ASCII de proposito: o PowerShell 5.1 le .ps1 sem BOM como ANSI.)

$ErrorActionPreference = 'Stop'

$Casa = $env:USERPROFILE
$Raiz = Join-Path $Casa '.duo-contas'
$Mod = Split-Path -Parent $PSScriptRoot

# A pasta da conta "empresa" (a que se gasta primeiro) vem de ~\.duo-contas\config.json ("pastaEmpresa"),
# que o instalar.ps1 grava; sem ele, ~\.claude-empresa. A "pessoal" e a padrao do Claude (~\.claude).
$PastaEmpresa = Join-Path $Casa '.claude-empresa'
$arqConfig = Join-Path $Raiz 'config.json'
if (Test-Path -LiteralPath $arqConfig) {
  try {
    $cfg = Get-Content -LiteralPath $arqConfig -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($cfg.pastaEmpresa) { $PastaEmpresa = [Environment]::ExpandEnvironmentVariables([string]$cfg.pastaEmpresa) }
  } catch {}
}
$Dirs = @{ empresa = $PastaEmpresa; pessoal = $null }

function Get-ConfigDir([string]$conta) {
  if ($Dirs[$conta]) { return $Dirs[$conta] }
  return (Join-Path $Casa '.claude')
}

function Write-Duo([string]$texto, [string]$cor = 'Cyan') {
  Write-Host "[claude-duo] $texto" -ForegroundColor $cor
}

# Tira as variaveis que o Claude Code poe nos processos filhos: o script pode ter vindo de dentro
# de uma sessao (o mod, o --abrir) e o claude novo nao pode se achar aninhado nela. Tira tambem as
# que a janela nova herdaria e nao sao dela: NO_COLOR=1 (o Claude liga para os comandos que roda;
# a janela de 12/10 18:43 abriu com o texto todo sem cor) e as marcas do terminal do VS Code
# (TERM_PROGRAM=vscode, VSCODE_*), que fariam o Claude se achar no VS Code dentro do Windows Terminal.
function Clear-SessaoClaude {
  # CLAUDE_CODE_SSE_PORT e a ponte com o VS Code (a extensao do Claude Code a poe em cada aba do
  # terminal): so sai se o script veio de dentro de outra sessao (CLAUDECODE=1); da aba, ela fica.
  $aninhado = [bool]$env:CLAUDECODE
  foreach ($v in @('CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN',
      'CLAUDE_PID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_DUO_TOKEN')) {
    Remove-Item "Env:$v" -ErrorAction SilentlyContinue
  }
  if ($aninhado) { Remove-Item Env:CLAUDE_CODE_SSE_PORT -ErrorAction SilentlyContinue }
  # cor: so tira se nao for configuracao do proprio usuario
  foreach ($v in @('NO_COLOR', 'FORCE_COLOR')) {
    if (-not [Environment]::GetEnvironmentVariable($v, 'User') -and -not [Environment]::GetEnvironmentVariable($v, 'Machine')) {
      Remove-Item "Env:$v" -ErrorAction SilentlyContinue
    }
  }
}

# Para a janela nova (Windows Terminal ou console): alem do Claude, tira as marcas do VS Code.
function Clear-TerminalVsCode {
  foreach ($v in @('TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'CLAUDE_CODE_SSE_PORT')) { Remove-Item "Env:$v" -ErrorAction SilentlyContinue }
  Get-ChildItem Env: | Where-Object { $_.Name -like 'VSCODE_*' } | ForEach-Object { Remove-Item "Env:$($_.Name)" -ErrorAction SilentlyContinue }
}

# Um argumento entre aspas para uma linha de comando do Windows (Start-Process junta tudo sem aspas).
function Format-Arg([string]$a) {
  if ($a -notmatch '[\s"]') { return $a }
  return '"' + ($a -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

# Abre uma janela nova (Windows Terminal, ou o console do PowerShell sem ele) que retoma o pedido.
# O mod nao chama o wt.exe direto: o caminho dele fica no WindowsApps, dentro do perfil, e com espaco
# no nome do perfil (C:\Users\Maria Silva) o Windows o cortava ("erro 0x80070002 ao iniciar Silva\...\wt.exe").
function Open-JanelaRetomar([string]$arqPedido) {
  $p = Get-Content -LiteralPath $arqPedido -Raw -Encoding UTF8 | ConvertFrom-Json
  $cwd = if ($p.cwd -and (Test-Path -LiteralPath $p.cwd)) { $p.cwd } else { $Casa }
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $script = @('-NoExit', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '--retomar', $arqPedido)
  Clear-SessaoClaude
  Clear-TerminalVsCode
  $wt = Get-Command wt.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($wt) {
    $linha = (@('-w', 'new', 'new-tab', '--title', "duo-contas: $($p.para)", '-d', $cwd, $ps) + $script | ForEach-Object { Format-Arg $_ }) -join ' '
    Start-Process -FilePath $wt.Source -ArgumentList $linha
  } else {
    Start-Process -FilePath $ps -WorkingDirectory $cwd -ArgumentList (($script | ForEach-Object { Format-Arg $_ }) -join ' ')
  }
  Write-Duo "janela nova aberta: $($p.de) -> $($p.para)"
  exit 0
}

# Entra na pasta da sessao; se ela nao existir, avisa e segue onde esta (nunca derruba a troca).
function Enter-Pasta([string]$cwd) {
  if (-not $cwd) { return }
  if (Test-Path -LiteralPath $cwd) { Set-Location -LiteralPath $cwd; return }
  Write-Duo "a pasta '$cwd' nao existe; seguindo em $((Get-Location).Path)" 'Yellow'
}

# Espera a sessao de origem terminar de sair (ela marca "fim" em ~\.duo-contas\atividade), ate 15 s:
# assim a transcricao copiada ja tem as ultimas linhas.
function Wait-SessaoSair([string]$sessionId) {
  $marca = Join-Path $Raiz "atividade\$sessionId.json"
  for ($i = 0; $i -lt 30; $i++) {
    try { if ((Get-Content -LiteralPath $marca -Raw -Encoding UTF8 | ConvertFrom-Json).fim) { return } } catch {}
    Start-Sleep -Milliseconds 500
  }
}

# Uso mais apertado (5h ou 7d) que a ultima leitura do mod registrou; 0 se a janela ja renovou.
function Get-Pressao([string]$conta) {
  $arq = Join-Path $Raiz "contas\$conta.json"
  if (-not (Test-Path -LiteralPath $arq)) { return $null }
  try { $l = Get-Content -LiteralPath $arq -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
  $max = $null
  foreach ($j in @($l.cinco, $l.sete)) {
    if ($null -eq $j) { continue }
    $pct = [double]$j.pct
    if ($j.renova) {
      try { if ([DateTimeOffset]::Parse($j.renova) -le [DateTimeOffset]::UtcNow) { $pct = 0 } } catch {}
    }
    if ($null -eq $max -or $pct -gt $max) { $max = $pct }
  }
  return $max
}

function Get-Limite {
  $arq = Join-Path $Raiz 'contas\empresa.json'
  try { $l = Get-Content -LiteralPath $arq -Raw -Encoding UTF8 | ConvertFrom-Json; if ($l.limite) { return [double]$l.limite } } catch {}
  return 95
}

# Leva as memorias criadas/editadas desde o inicio da sessao para a outra conta,
# com as linhas delas no MEMORY.md. O que for sobrescrito vai antes para ~\.duo-contas\backup.
function Sync-Memoria($pedido, [string]$projOrig, [string]$projDest) {
  $mo = Join-Path $projOrig 'memory'
  $md = Join-Path $projDest 'memory'
  if (-not (Test-Path -LiteralPath $mo)) { return 0 }
  $desde = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$pedido.inicio).UtcDateTime
  $novos = @(Get-ChildItem -LiteralPath $mo -File -Filter '*.md' |
    Where-Object { $_.Name -ne 'MEMORY.md' -and $_.LastWriteTimeUtc -ge $desde })
  if ($novos.Count -eq 0) { return 0 }

  New-Item -ItemType Directory -Force -Path $md | Out-Null
  $backup = Join-Path $Raiz ('backup\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $pedido.para)
  $levados = @()
  foreach ($f in $novos) {
    $alvo = Join-Path $md $f.Name
    if (Test-Path -LiteralPath $alvo) {
      if ((Get-Item -LiteralPath $alvo).LastWriteTimeUtc -ge $f.LastWriteTimeUtc) { continue }
      New-Item -ItemType Directory -Force -Path $backup | Out-Null
      Copy-Item -LiteralPath $alvo -Destination $backup -Force
    }
    Copy-Item -LiteralPath $f.FullName -Destination $alvo -Force
    $levados += $f
  }

  $indOrig = Join-Path $mo 'MEMORY.md'
  $indDest = Join-Path $md 'MEMORY.md'
  if ($levados.Count -gt 0 -and (Test-Path -LiteralPath $indOrig)) {
    $linhasOrig = [IO.File]::ReadAllLines($indOrig)
    $linhasDest = New-Object 'System.Collections.Generic.List[string]'
    if (Test-Path -LiteralPath $indDest) {
      New-Item -ItemType Directory -Force -Path $backup | Out-Null
      Copy-Item -LiteralPath $indDest -Destination $backup -Force
      foreach ($x in [IO.File]::ReadAllLines($indDest)) { $linhasDest.Add($x) }
    } else {
      $linhasDest.Add('# Memory Index'); $linhasDest.Add('')
    }
    foreach ($f in $levados) {
      $ref = "($($f.Name))"
      $linha = $linhasOrig | Where-Object { $_.Contains($ref) } | Select-Object -First 1
      if (-not $linha) { continue }
      $i = -1
      for ($k = 0; $k -lt $linhasDest.Count; $k++) { if ($linhasDest[$k].Contains($ref)) { $i = $k; break } }
      if ($i -ge 0) { $linhasDest[$i] = $linha } else { $linhasDest.Add($linha) }
    }
    [IO.File]::WriteAllLines($indDest, $linhasDest)
  }
  return $levados.Count
}

# Copia a transcricao (e a pasta da sessao, se houver) da conta de origem para a de destino.
function Copy-Sessao($pedido) {
  $orig = Join-Path (Get-ConfigDir $pedido.de) 'projects'
  $dest = Join-Path (Get-ConfigDir $pedido.para) 'projects'
  $nome = "$($pedido.sessionId).jsonl"
  $arq = Get-ChildItem -LiteralPath $orig -Directory |
    ForEach-Object { Join-Path $_.FullName $nome } |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $arq) { throw "transcricao $nome nao encontrada em $orig" }

  $projOrig = Split-Path -Parent $arq
  $projDest = Join-Path $dest (Split-Path -Leaf $projOrig)
  New-Item -ItemType Directory -Force -Path $projDest | Out-Null
  Copy-Item -LiteralPath $arq -Destination $projDest -Force
  $pasta = Join-Path $projOrig $pedido.sessionId
  if (Test-Path -LiteralPath $pasta) { Copy-Item -LiteralPath $pasta -Destination $projDest -Recurse -Force }

  try {
    $n = Sync-Memoria $pedido $projOrig $projDest
    if ($n -gt 0) { Write-Duo "$n memoria(s) desta sessao levada(s) para a conta $($pedido.para)" }
  } catch {
    Write-Duo "nao consegui levar as memorias: $($_.Exception.Message)" 'Yellow'
  }
}

# O mod esta instalado como plugin nessa conta? Se nao, vai por --plugin-dir.
function Test-ModInstalado([string]$conta) {
  $f = Join-Path (Get-ConfigDir $conta) 'plugins\installed_plugins.json'
  if (-not (Test-Path -LiteralPath $f)) { return $false }
  return [bool](Select-String -LiteralPath $f -SimpleMatch '"duo-contas@' -Quiet)
}

# Uma janela do rate_limit_event (utilization 0..1, resetsAt em segundos) no formato do mod.
function Convert-Janela($w) {
  if ($null -eq $w -or $null -eq $w.utilization) { return $null }
  $j = [ordered]@{ pct = [math]::Round([double]$w.utilization * 100, 1) }
  if ($w.resetsAt) {
    $j.renova = [DateTimeOffset]::FromUnixTimeSeconds([int64]$w.resetsAt).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
  }
  return $j
}

# --resume <id> numa conta que nao tem a transcricao (a empresa no limite fez comecar pela pessoal):
# copia a sessao da outra conta antes, como numa troca.
function Copy-SessaoSeFaltar([string[]]$argsClaude, [string]$conta) {
  $i = [array]::IndexOf($argsClaude, '--resume')
  if ($i -lt 0) { $i = [array]::IndexOf($argsClaude, '-r') }
  if ($i -lt 0 -or $i + 1 -ge $argsClaude.Count) { return }
  $id = $argsClaude[$i + 1]
  if ($id -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { return }
  $aqui = Join-Path (Get-ConfigDir $conta) 'projects'
  if (Get-ChildItem -LiteralPath $aqui -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "$id.jsonl") }) { return }
  $outra = if ($conta -eq 'empresa') { 'pessoal' } else { 'empresa' }
  try {
    Copy-Sessao ([pscustomobject]@{ sessionId = $id; de = $outra; para = $conta; inicio = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() })
    Write-Duo "sessao $id trazida da conta $outra"
  } catch {
    Write-Duo "nao achei a sessao $id na conta ${outra}: $($_.Exception.Message)" 'Yellow'
  }
}

# Acorda a conta: um Claude invisivel manda "oi" no haiku, a janela de 5h comeca a contar e a
# leitura que a resposta traz vai para ~\.duo-contas\contas\<conta>.json. Sai com 0 se deu certo.
function Invoke-Acordar([string]$conta) {
  $ErrorActionPreference = 'Continue'
  Clear-SessaoClaude
  if ($Dirs[$conta]) { $env:CLAUDE_CONFIG_DIR = $Dirs[$conta] } else { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
  $pasta = Join-Path $Raiz 'acordar-sessoes'   # as sessoes do "oi" ficam fora do projeto
  New-Item -ItemType Directory -Force -Path $pasta | Out-Null
  Set-Location -LiteralPath $pasta

  $saida = & claude -p --output-format stream-json --verbose --model haiku 'oi' 2>$null
  $janelas = $null
  foreach ($linha in @($saida)) {
    if ("$linha" -notlike '*rate_limit_event*') { continue }
    try { $j = "$linha" | ConvertFrom-Json } catch { continue }
    if ($j.rate_limit_info.unifiedWindows) { $janelas = $j.rate_limit_info.unifiedWindows }
  }
  if (-not $janelas) { Write-Duo "conta ${conta}: a resposta nao trouxe a janela" 'Yellow'; exit 2 }

  $arq = Join-Path $Raiz "contas\$conta.json"
  $limite = $null
  if (Test-Path -LiteralPath $arq) {
    try { $limite = (Get-Content -LiteralPath $arq -Raw -Encoding UTF8 | ConvertFrom-Json).limite } catch {}
  }
  $leitura = [ordered]@{ conta = $conta; em = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
  $cinco = Convert-Janela $janelas.five_hour
  $sete = Convert-Janela $janelas.seven_day
  if ($cinco) { $leitura.cinco = $cinco }
  if ($sete) { $leitura.sete = $sete }
  if ($limite) { $leitura.limite = $limite }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $arq) | Out-Null
  [IO.File]::WriteAllText($arq, ($leitura | ConvertTo-Json -Compress -Depth 5))
  Write-Duo "conta $conta acordada"
  exit 0
}

# Os processos acima de cada claude pedido (ate 4 niveis), de uma vez, em JSON: {"<pid>": [pai, avo, ...]}.
# O shell da aba do terminal esta entre eles: a extensao duo-contas-abas do VS Code grava o shell de
# cada aba, e o mod poe cada Claudinho na posicao da aba dele. Uma consulta so a todos os processos.
function Write-Pais([string]$lista) {
  $todos = @{}
  foreach ($w in @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId -ErrorAction SilentlyContinue)) {
    $todos[[int]$w.ProcessId] = [int]$w.ParentProcessId
  }
  $saida = [ordered]@{}
  foreach ($x in ($lista -split ',')) {
    $alvo = 0
    if (-not [int]::TryParse($x.Trim(), [ref]$alvo) -or -not $todos.ContainsKey($alvo)) { continue }
    $cadeia = @()
    $p = $todos[$alvo]
    for ($i = 0; $i -lt 4 -and $p -and $todos.ContainsKey($p); $i++) { $cadeia += $p; $p = $todos[$p] }
    if ($p -and $cadeia.Count -lt 4) { $cadeia += $p } # o ultimo pai pode ja ter saido: entra assim mesmo
    $saida["$alvo"] = $cadeia
  }
  Write-Output ($saida | ConvertTo-Json -Compress -Depth 3)
}

# O claude.exe acima deste processo (o mod roda o --encerrar como filho dele; pode haver um shell no meio).
function Find-ClaudeAcima {
  $p = $PID
  for ($i = 0; $i -lt 8; $i++) {
    $w = Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue
    if (-not $w) { return $null }
    if ($w.ProcessId -ne $PID -and $w.Name -ieq 'claude.exe') { return $w }
    $p = $w.ParentProcessId
  }
  return $null
}

# Saida garantida da troca: o mod grava o pedido, manda /exit e chama isto. Numa sessao parada no limite
# ("continuing automatically at...") o /exit fica na fila e a sessao congelaria ate a janela renovar.
# Daqui sai na hora (o mod nao espera): deixa um vigia solto, fora da arvore do claude (o taskkill /T nao
# o leva junto), que espera o claude sair sozinho ate o prazo; se nao saiu, encerra o claude e os filhos
# dele, como o /exit faria. O claude-duo do terminal ve o pedido de troca e retoma na outra conta.
function Invoke-Encerrar([int]$segundos) {
  $c = Find-ClaudeAcima
  if (-not $c) { Write-Duo 'nao achei o claude acima deste processo' 'Yellow'; exit 2 }
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $inicio = $c.CreationDate.ToUniversalTime().Ticks
  $argv = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $PSCommandPath,
    '--vigiar', "$($c.ProcessId)", "$inicio", "$segundos")
  Start-Process -FilePath $ps -WindowStyle Hidden -ArgumentList (($argv | ForEach-Object { Format-Arg $_ }) -join ' ')
  exit 0
}

function Invoke-Vigiar([int]$alvo, [int64]$inicio, [int]$segundos) {
  $fim = (Get-Date).AddSeconds($segundos)
  while ((Get-Date) -lt $fim) {
    if (-not (Get-Process -Id $alvo -ErrorAction SilentlyContinue)) { exit 0 } # saiu sozinho: nada a fazer
    Start-Sleep -Milliseconds 500
  }
  # o mesmo claude (numero de processo reaproveitado seria outro, com outra hora de inicio)
  $w = Get-CimInstance Win32_Process -Filter "ProcessId=$alvo" -ErrorAction SilentlyContinue
  if (-not $w -or $w.Name -ine 'claude.exe' -or $w.CreationDate.ToUniversalTime().Ticks -ne $inicio) { exit 0 }
  & taskkill.exe /PID $alvo /T /F | Out-Null
  $log = Join-Path $Raiz 'troca\encerrar.log'
  Add-Content -LiteralPath $log -Encoding ASCII -Value "$(Get-Date -Format s) claude $alvo encerrado: o /exit nao saiu em $segundos s"
  exit 0
}

# --- argumentos (sem param(): -c, -p etc. do claude nao podem virar parametros daqui) ---
$conta = 'auto'
$arqPedido = $null
$arqAbrir = $null
$acordar = $null
$resto = @()
for ($i = 0; $i -lt $args.Count; $i++) {
  if ($args[$i] -ceq '--conta') { $conta = $args[$i + 1]; $i++ }
  elseif ($args[$i] -ceq '--retomar') { $arqPedido = $args[$i + 1]; $i++ }
  elseif ($args[$i] -ceq '--abrir') { $arqAbrir = $args[$i + 1]; $i++ }
  elseif ($args[$i] -ceq '--acordar') { $acordar = $args[$i + 1]; $i++ }
  elseif ($args[$i] -ceq '--encerrar') { Invoke-Encerrar ([int]$args[$i + 1]) }
  elseif ($args[$i] -ceq '--pais') { Write-Pais $args[$i + 1]; exit 0 }
  elseif ($args[$i] -ceq '--vigiar') { Invoke-Vigiar ([int]$args[$i + 1]) ([int64]$args[$i + 2]) ([int]$args[$i + 3]) }
  else { $resto += $args[$i] }
}
if ($acordar) {
  if ($acordar -notin @('empresa', 'pessoal')) { throw "--acordar deve ser empresa ou pessoal (veio '$acordar')" }
  Invoke-Acordar $acordar
}
if ($arqAbrir) { Open-JanelaRetomar $arqAbrir }
if ($conta -notin @('auto', 'empresa', 'pessoal')) { throw "--conta deve ser empresa ou pessoal (veio '$conta')" }

Clear-SessaoClaude
$token = [guid]::NewGuid().ToString('N')
$antes = @{ dir = $env:CLAUDE_CONFIG_DIR; token = $env:CLAUDE_DUO_TOKEN }
foreach ($d in @('troca', 'retomar', 'contas')) { New-Item -ItemType Directory -Force -Path (Join-Path $Raiz $d) | Out-Null }

$argsClaude = $resto
$retomar = $null

if ($arqPedido) {
  $p = Get-Content -LiteralPath $arqPedido -Raw -Encoding UTF8 | ConvertFrom-Json
  Remove-Item -LiteralPath $arqPedido -Force
  Write-Duo "$($p.de) -> $($p.para): $($p.motivo)" 'Yellow'
  Wait-SessaoSair $p.sessionId
  Copy-Sessao $p
  $conta = $p.para
  Enter-Pasta $p.cwd
  $argsClaude = @('--resume', $p.sessionId)
  $retomar = $p
} elseif ($conta -eq 'auto') {
  $conta = 'empresa'
  $pe = Get-Pressao 'empresa'
  if ($null -ne $pe -and $pe -ge (Get-Limite)) {
    $conta = 'pessoal'
    Write-Duo "empresa em $([math]::Round($pe))% do limite: comecando pela conta pessoal" 'Yellow'
  }
}
if (-not $arqPedido) { Copy-SessaoSeFaltar $argsClaude $conta }

try {
  while ($true) {
    if ($Dirs[$conta]) { $env:CLAUDE_CONFIG_DIR = $Dirs[$conta] } else { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
    $env:CLAUDE_DUO_TOKEN = $token

    $arqRetomar = Join-Path $Raiz "retomar\$token.json"
    if ($retomar) { [IO.File]::WriteAllText($arqRetomar, ($retomar | ConvertTo-Json -Compress -Depth 5)) }

    Write-Duo "conta $conta"
    $carregar = if (Test-ModInstalado $conta) { @() } else { @('--plugin-dir', $Mod) }
    & claude @carregar @argsClaude

    if (Test-Path -LiteralPath $arqRetomar) { Remove-Item -LiteralPath $arqRetomar -Force }
    $arqTroca = Join-Path $Raiz "troca\$token.json"
    if (-not (Test-Path -LiteralPath $arqTroca)) { break }

    $p = Get-Content -LiteralPath $arqTroca -Raw -Encoding UTF8 | ConvertFrom-Json
    Remove-Item -LiteralPath $arqTroca -Force
    Write-Duo "$($p.de) -> $($p.para): $($p.motivo)" 'Yellow'
    Copy-Sessao $p
    $conta = $p.para
    Enter-Pasta $p.cwd
    $argsClaude = @('--resume', $p.sessionId)
    $retomar = $p
  }
} finally {
  if ($null -eq $antes.dir) { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue } else { $env:CLAUDE_CONFIG_DIR = $antes.dir }
  if ($null -eq $antes.token) { Remove-Item Env:CLAUDE_DUO_TOKEN -ErrorAction SilentlyContinue } else { $env:CLAUDE_DUO_TOKEN = $antes.token }
}
