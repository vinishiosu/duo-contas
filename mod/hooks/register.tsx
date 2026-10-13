import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderSurface, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Abas, Conta, Contexto, Leitura, Leituras, Modo, Pedido, Ram, SessaoViva, Sessoes, Tarefa } from '../types'
import {
  LEGENDA,
  OUTRA,
  contaDoConfigDir,
  descreverTarefa,
  estourada,
  fmtGB,
  fmtPct,
  fmtTokens,
  haQuanto,
  horaBR,
  humor,
  janelaAtiva,
  janelas,
  lerJson,
  noTeto,
  pctEfetivo,
  pressao,
  quandoBR,
  ordenarPorAba,
  situacao,
} from './logic'
import { LINHAS, arranjo, barraCelulas, celulas, desenhar, desenharGrupo } from './sprites'
import type { Arranjo, Estado, Membro, Rgb } from './sprites'

const leituras = atom({ plugin: 'duo-contas', key: 'leituras' } as const, {} as Leituras)
const modo = atom({ plugin: 'duo-contas', key: 'modo' } as const, 'abaixo' as Modo)
const relogio = atom({ plugin: 'duo-contas', key: 'relogio' } as const, 0)
const contexto = atom({ plugin: 'duo-contas', key: 'contexto' } as const, null as Contexto | null)
const ultimaResposta = atom({ plugin: 'duo-contas', key: 'ultimaResposta' } as const, null as number | null)
const ram = atom({ plugin: 'duo-contas', key: 'ram' } as const, null as Ram | null)
const aviso = atom({ plugin: 'duo-contas', key: 'aviso' } as const, null as string | null)
const luz = atom({ plugin: 'duo-contas', key: 'luz' } as const, 0)
const sessoes = atom({ plugin: 'duo-contas', key: 'sessoes' } as const, { empresa: [], pessoal: [] } as Sessoes)
const agentes = atom({ plugin: 'duo-contas', key: 'agentes' } as const, 0)
const abas = atom({ plugin: 'duo-contas', key: 'abas' } as const, {} as Record<string, number>)
/** O segundo plano do último Stop, no estado da sessão: um /reload-plugins zera as variáveis do mod, não isto. */
const segundoPlanoGuardado = atom({ plugin: 'duo-contas', key: 'segundoPlano' } as const, [] as Tarefa[])

const MODOS: readonly Modo[] = ['abaixo', 'acima', 'oculto']
/** Quanto o /exit tem para sair sozinho antes de o processo ser encerrado (a saída normal leva poucos segundos). */
const ENCERRAR_S = 20
const CONTAS: readonly Conta[] = ['empresa', 'pessoal']
const TRAVA_ACORDAR_MS = 15 * 60_000

// Desta sessão; um reload refaz tudo no session.start.
let limite = 95
/** Daqui para cima a troca não espera o segundo plano (a conta vai travar e a sessão congelaria). */
let teto = 98
/** Na pessoal, a empresa abaixo disto volta a ser a conta da sessão. */
let volta = 80
let automatico = true
let acordar = true
let cacheMs = 60 * 60_000
let conta: Conta | undefined
let raiz = ''
let token: string | undefined
let eu = ''
let interativo = false
let trabalhando = false
let tiques = 0
// animação: onde o painel está montado, desde quando, e o último quadro mandado de cada bichinho
let sitio: string | undefined
let t0 = 0
const ultimoQuadro: Partial<Record<Conta, string>> = {}
/** O arranjo que o painel desenhou para cada conta (tamanho, quantos, colunas): o blit tem de caber no mesmo Raster. */
const naTela: Partial<Record<Conta, Arranjo & { orcamento: number }>> = {}
/** Se o último quadro do painel saiu com as barras brilhando (para apagar o brilho quando a sessão para). */
let acesa = false
let trocando = false
let avisado: string | undefined
/** Trabalho em segundo plano desta sessão (shell, subagente, monitor), pelo último Stop: sair agora o mataria. */
let segundoPlano: Tarefa[] = []
/** Uma resposta desta sessão morreu no limite (StopFailure rate_limit): a conta está travada, leia ela o que ler. */
let estourou = false
/** Subagentes desta sessão rodando agora (os filhotes), pela última leitura do $.agent.list. */
let agentesAqui = 0
/** A aba do terminal do VS Code de cada sessão viva (1 = a primeira), pela extensão duo-contas-abas; o atom `abas` é a cópia que redesenha o painel. */
let abasAtuais: Record<string, number> = {}
/** As pastas onde o Claude de cada conta grava `<pid>.json` das sessões abertas (sessionId, pid, procStart). */
let pastasSessoes: string[] = []
/** O processo deste claude e o shell da aba do VS Code dele (pela extensão): para a troca continuar na mesma aba. */
let meuClaude: number | undefined
let meuShell: number | undefined

const continuar = (de: Conta, para: Conta, pct: number) =>
  `Continue exatamente de onde parou. (duo-contas: a conta ${de} chegou a ${pct}% do limite ` +
  `e esta sessão foi retomada na conta ${para}, com a conversa inteira.)`

/** A mensagem para a sessão retomada, com o recado do que a troca encerrou em segundo plano (se encerrou). */
const comTarefas = (texto: string | undefined, tarefas: readonly Tarefa[]) =>
  tarefas.length === 0
    ? texto
    : [
        texto,
        `(duo-contas: a troca encerrou o que rodava em segundo plano:\n${tarefas.map(descreverTarefa).join('\n')}\n` +
          'Confira a saída de cada uma e relance as que puderem ser retomadas sem duplicar trabalho.)',
      ]
        .filter(Boolean)
        .join('\n\n')

/** Só troca sozinho em sessão aberta pelo claude-duo, que sabe reabrir a conversa no mesmo terminal. */
const trocaSozinha = () => automatico && token !== undefined

const arquivoConta = (c: Conta) => `${raiz}/contas/${c}.json`

/** Caminho com barras do Windows, para o wt.exe, o powershell.exe e o node. */
const win = (path: string) => path.replace(/\//g, '\\')

/** Para trabalho disparado sem esperar (timers): um erro ali não derruba nada nem fica solto. */
const solto = (p: Promise<unknown>) => void p.catch(() => undefined)

/** Traz as leituras que outras sessões (das duas contas) gravaram. */
async function sincronizar($: EngineInterface) {
  for (const c of CONTAS) {
    const arq = arquivoConta(c)
    if (!(await $.fs.exists(arq))) continue
    const l = lerJson<Leitura>(await $.fs.read(arq))
    if (l === undefined || typeof l.em !== 'number') continue
    await update($, leituras, atual => ((atual[c]?.em ?? 0) >= l.em ? atual : { ...atual, [c]: l }))
  }
}

/** Guarda a leitura desta conta (para o bichinho e para as outras sessões) e decide. */
async function registrar($: EngineInterface, limits: readonly SessionRateLimit[]) {
  const c = conta
  if (c === undefined) return
  const l: Leitura = { conta: c, ...janelas(limits), em: await $.clock.now(), limite }
  if (l.cinco === undefined && l.sete === undefined) return
  await update($, leituras, atual => ({ ...atual, [c]: l }))
  await $.fs.write(arquivoConta(c), JSON.stringify(l))
  await avaliar($)
}

async function guardarContexto($: EngineInterface, c: SessionContextUsage) {
  await update($, contexto, () => ({
    janela: c.window,
    ...(c.percent !== undefined ? { pct: c.percent } : {}),
    ...(c.tokens !== undefined ? { tokens: c.tokens } : {}),
  }))
}

/** Avisa uma vez por situação; a troca acontece na próxima mensagem, no fim da resposta ou no teto. */
async function avaliar($: EngineInterface) {
  if (conta === undefined || trocando) return
  const agora = await $.clock.now()
  const ls = await read($, leituras)
  const s = situacao(conta, ls, limite, agora, volta)
  const outra = OUTRA[conta]
  const pct = Math.round(pressao(ls[conta], agora) ?? 0)
  const ocupada = segundoPlano.length > 0

  let texto: string | null = null
  if (s === 'ambas-no-limite') {
    const renova = [ls.empresa?.cinco?.renova, ls.pessoal?.cinco?.renova].filter(r => r !== undefined).sort()[0]
    const quando = quandoBR(renova, agora)
    texto = `as duas contas estão no limite${quando ? `; a primeira renova às ${quando}` : ''}`
  } else if (s === 'trocar') {
    texto = !trocaSozinha()
      ? `${conta} em ${pct}%: use /trocar-conta (aberta com claude-empresa, a troca seria sozinha)`
      : ocupada
        ? `${conta} em ${pct}%: troco para a ${outra} quando o segundo plano terminar (passou de ${teto}%, troco na hora)`
        : `${conta} em ${pct}%: a próxima mensagem já segue na conta ${outra}`
  } else if (s === 'voltar' && trocaSozinha()) {
    const pe = Math.round(pressao(ls.empresa, agora) ?? 0)
    texto = ocupada
      ? `empresa com folga (${pe}%): volto para ela na primeira mensagem sem nada em segundo plano`
      : `empresa com folga (${pe}%): a próxima mensagem volta para ela`
  }
  await update($, aviso, () => texto)
  const chave = `${s}:${ocupada}` // o percentual mudando não repete o toast; o segundo plano, sim
  if (texto !== null && avisado !== chave) $.ui.toast(`duo-contas: ${texto}`)
  avisado = texto === null ? undefined : chave
}

/**
 * A troca sem a mensagem da pessoa: no fim de uma resposta, quando uma resposta morre no limite, e no
 * relógio de 30 s. Até o teto, espera o segundo plano (sair o mataria); no teto, troca mesmo assim e
 * conta à sessão retomada o que foi encerrado. A volta para a empresa não passa por aqui: ela fica para
 * a próxima mensagem, para nunca cortar um trabalho no meio.
 */
async function decidir($: EngineInterface, origem: 'fim' | 'falha' | 'relogio', cortada = false) {
  if (conta === undefined || !trocaSozinha() || trocando) return
  await sincronizar($)
  const agora = await $.clock.now()
  const ls = await read($, leituras)
  const efetivas = estourou ? estourada(conta, ls, agora) : ls
  if (situacao(conta, efetivas, limite, agora, volta) !== 'trocar') return
  const pct = Math.round(pressao(efetivas[conta], agora) ?? 0)
  const forcar = noTeto(conta, ls, limite, teto, agora, estourou)
  // no meio de uma resposta só o limite de verdade (100%) troca: ali ela está parada esperando a janela
  if (trabalhando && !(estourou || pct >= 100)) return
  // o relógio só socorre quem travaria: segundo plano ou resposta parados no teto; sessão parada e
  // sem nada rodando troca na próxima mensagem (sair agora levaria o rascunho que a pessoa digita)
  if (origem === 'relogio' && !(forcar && (segundoPlano.length > 0 || trabalhando))) return
  if (segundoPlano.length > 0 && !forcar) return avaliar($) // o aviso diz que a troca espera o segundo plano

  const tarefas = forcar ? segundoPlano : []
  const parou = cortada || estourou || trabalhando || pct >= 100
  await trocar(
    $,
    comTarefas(parou ? continuar(conta, OUTRA[conta], pct) : undefined, tarefas),
    parou ? `a conta ${conta} chegou a ${pct}% no meio da resposta` : `a conta ${conta} chegou a ${pct}% do limite`,
    tarefas,
  )
}

/**
 * Passa esta sessão para a outra conta: deixa o pedido para o claude-duo.ps1
 * (que copia a conversa e as memórias novas e roda `claude --resume`) e sai.
 */
async function trocar(
  $: EngineInterface,
  prompt: string | undefined,
  motivo: string,
  tarefas: readonly Tarefa[] = [],
): Promise<boolean> {
  if (conta === undefined || trocando) return false
  trocando = true
  const para = OUTRA[conta]
  try {
    const pedido: Pedido = {
      sessionId: await $.session.id(),
      cwd: await $.session.cwd(),
      de: conta,
      para,
      motivo,
      inicio: (await $.session.usage()).startedAt,
      criadoEm: new Date(await $.clock.now()).toISOString(),
      ...(prompt ? { prompt } : {}),
      ...(tarefas.length > 0 ? { tarefas: [...tarefas] } : {}),
    }
    if (token !== undefined) {
      await $.fs.write(`${raiz}/troca/${token}.json`, JSON.stringify(pedido))
    } else {
      // Sessão aberta sem o claude-duo. No VS Code, com a extensão duo-contas-abas, a conversa continua
      // na MESMA aba: a extensão espera este claude sair e digita o claude-duo --retomar no shell dela.
      // Sem a extensão, a outra conta abre numa janela nova, que o próprio script abre. Nunca o wt.exe
      // direto daqui: com espaço no nome do perfil (C:\Users\Maria Silva) o Windows cortava o caminho dele
      // em dois ("erro 0x80070002 ao iniciar Silva\...\wt.exe"); o powershell.exe mora no System32.
      const arq = `${raiz}/troca/avulso-${pedido.sessionId}.json`
      await $.fs.write(arq, JSON.stringify(pedido))
      const script = win(`${$.plugin.root}/bin/claude-duo.ps1`)
      if (!(await pedirAba($, pedido.sessionId, win(arq), script))) {
        const r = await $.process
          .run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '--abrir', win(arq)], {
            timeoutMs: 20_000,
          })
          .catch(() => undefined)
        if (r === undefined || r.exitCode !== 0) {
          trocando = false
          $.ui.toast(`duo-contas: não consegui abrir a conta ${para}. Abra o Claude com \`claude-duo\` para a troca automática.`)
          return false
        }
      }
    }
  } catch (err) {
    trocando = false
    throw err
  }

  // O pedido está gravado: daqui em diante a saída tem de acontecer, então ela vem primeiro.
  $.clock.after(400, () => {
    void $.command.run({ command: 'exit', args: '' }).catch(() => {
      $.ui.toast(`duo-contas: saia desta sessão (/exit) para ela continuar na conta ${para}.`)
    })
  })
  // ...e se o /exit ficar na fila (sessão parada no limite, "continuing automatically at..."), o
  // claude-duo.ps1 --encerrar fecha este processo daqui a pouco; o claude-duo do terminal retoma.
  solto(
    $.process.run(
      ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', win(`${$.plugin.root}/bin/claude-duo.ps1`), '--encerrar', String(ENCERRAR_S)],
      { timeoutMs: 20_000 },
    ),
  )
  $.ui.log(`duo-contas: ${motivo}. A sessão continua na conta ${para}${token ? ' neste terminal' : ' numa janela nova'}.`)
  await update($, aviso, () => `continuando na conta ${para}...`)

  return true
}

/**
 * Pede à extensão duo-contas-abas que a troca continue nesta mesma aba do VS Code. Só se sabe a aba
 * (o shell dela) quando a extensão está instalada; ela reserva o pedido renomeando para `.aceito`, em
 * menos de 1 s (vigia a pasta; a reserva é o relógio de 5 s). Sem resposta em 6 s, o pedido é
 * cancelado e a troca vai para uma janela nova, como antes.
 */
async function pedirAba($: EngineInterface, id: string, pedido: string, script: string): Promise<boolean> {
  if (meuShell === undefined || meuClaude === undefined) return false
  const base = `${raiz}/abrir/${id}`
  const p = { pedido, script, shell: meuShell, claude: meuClaude, criadoEm: new Date(await $.clock.now()).toISOString() }
  const levou = async () => (await $.fs.exists(`${base}.aceito`)) || (await $.fs.exists(`${base}.feito`))
  await $.fs.write(`${base}.json`, JSON.stringify(p))
  for (let i = 0; i < 24; i++) {
    if (await levou()) return true
    await $.clock.sleep(250)
  }
  await $.fs.write(`${base}.json`, JSON.stringify({ ...p, cancelado: true }))
  return levou() // a extensão pode ter reservado bem na hora de cancelar: aí vale a aba
}

/** Na sessão retomada pelo claude-duo.ps1: manda a mensagem que ficou pendente. */
async function retomar($: EngineInterface) {
  const arq = `${raiz}/retomar/${token}.json`
  if (!(await $.fs.exists(arq))) return
  const p = lerJson<Pedido & { consumido?: boolean }>(await $.fs.read(arq))
  if (p === undefined || p.consumido) return
  await $.fs.write(arq, JSON.stringify({ ...p, consumido: true }))
  $.ui.toast(`duo-contas: sessão retomada na conta ${p.para} (veio da ${p.de}).`)
  const texto = p.prompt
  if (texto) $.clock.after(1500, () => solto($.prompt.submit({ text: texto })))
}

/** Marca, para as outras sessões (e o Claudinho da outra conta), se esta sessão está trabalhando e quantos agentes ela tem rodando. */
async function sinalizar($: EngineInterface, fim = false) {
  if (!interativo || eu === '') return
  const em = await $.clock.now()
  const marca = {
    conta,
    trabalhando: fim ? false : trabalhando,
    agentes: fim ? 0 : agentesAqui,
    em,
    ...(fim ? { fim: true } : {}),
  }
  await $.fs.write(`${raiz}/atividade/${eu}.json`, JSON.stringify(marca))
}

/** O agente ainda está trabalhando (não terminou, não foi parado; teammate esperando mensagem não conta). */
const AGENTE_ATIVO: readonly string[] = ['pending', 'running', 'waiting']

/**
 * Quantos subagentes desta sessão estão rodando: a lista do engine é a verdade, então um agente
 * que termina (ou some) sai da conta na leitura seguinte, sem ficar preso. Lida a cada segundo
 * e na hora do SubagentStart/SubagentStop; mudou, o painel redesenha e a marca de atividade conta.
 */
async function lerAgentes($: EngineInterface) {
  const lista = await $.agent.list().catch(() => undefined)
  if (lista === undefined) return
  const n = lista.filter(a => AGENTE_ATIVO.includes(a.status)).length
  if (n === agentesAqui) return
  agentesAqui = n
  await update($, agentes, () => n)
  await sinalizar($)
}

/** A assinatura (nome e hora) dos arquivos da extensão das abas, para saber se ela regravou algo. */
let abasVistas = ''

/** Se a extensão das abas regravou algum arquivo desde a última olhada (uma listagem de pasta, nada mais). */
async function abasMudaram($: EngineInterface): Promise<boolean> {
  const lista = await $.fs.list(`${raiz}/abas`).catch(() => [])
  const assinatura = lista.map(a => `${a.name}:${a.mtimeMs}`).sort().join('|')
  if (assinatura === abasVistas) return false
  abasVistas = assinatura
  return true
}

/**
 * A conversa da janela mudou (/resume de outra, /clear): o id dela também. A marca de atividade passa
 * para o id novo e a do antigo sai do painel; sem isso, a aba desta sessão não casava com o
 * `sessions/<pid>.json` do Claude (que já traz o id novo) e o Claudinho ia para o fim da fila.
 */
async function seguirConversa($: EngineInterface) {
  const id = await $.session.id()
  if (!interativo || id === eu || id === '') return
  const antigo = eu
  eu = id
  if (antigo !== '') {
    await $.fs.write(`${raiz}/atividade/${antigo}.json`, JSON.stringify({ conta, trabalhando: false, em: await $.clock.now(), fim: true }))
  }
}

/**
 * A aba do terminal de cada sessão viva, para os Claudinhos ficarem na ordem das abas. Sem depender da
 * versão do mod nas outras sessões:
 * 1. a extensão duo-contas-abas do VS Code grava os terminais de cada janela, na ordem, com o shell de cada um;
 * 2. o Claude de cada conta grava `sessions/<pid>.json` (sessionId, pid, procStart) de cada sessão aberta;
 * 3. o shell da aba está acima do claude.exe: os processos acima de cada claude ficam em ~/.duo-contas/pais.json,
 *    de todas as sessões; o que faltar (claude novo), o claude-duo.ps1 --pais descobre de uma vez, num
 *    PowerShell de menos de 1 s. A chave leva o procStart: número de processo reaproveitado não confunde.
 */
async function lerAbas($: EngineInterface) {
  const shells = new Map<number, number>()
  for (const arq of await $.fs.list(`${raiz}/abas`).catch(() => [])) {
    if (arq.kind !== 'file' || !arq.name.endsWith('.json')) continue // sem a extensão, a pasta nem existe
    const a = lerJson<Abas>(await $.fs.read(`${raiz}/abas/${arq.name}`).catch(() => ''))
    for (const x of a?.abas ?? []) if (x.pid !== null) shells.set(x.pid, x.pos)
  }
  const mapa: Record<string, number> = {}
  if (shells.size > 0) {
    const ss = await read($, sessoes)
    const vivas = new Set([eu, ...CONTAS.flatMap(c => ss[c].map(s => s.id))])
    const processo = new Map<string, string>() // sessionId -> "pid:procStart"
    for (const pasta of pastasSessoes) {
      for (const arq of await $.fs.list(pasta).catch(() => [])) {
        if (arq.kind !== 'file' || !/^\d+\.json$/.test(arq.name)) continue
        const s = lerJson<{ pid?: number; sessionId?: string; procStart?: string }>(await $.fs.read(`${pasta}/${arq.name}`).catch(() => ''))
        if (s?.sessionId && typeof s.pid === 'number' && vivas.has(s.sessionId)) processo.set(s.sessionId, `${s.pid}:${s.procStart ?? ''}`)
      }
    }
    const guardados = lerJson<Record<string, number[]>>(await $.fs.read(`${raiz}/pais.json`).catch(() => '')) ?? {}
    const pais: Record<string, number[]> = {}
    for (const chave of processo.values()) if (guardados[chave]) pais[chave] = guardados[chave]
    const faltam = [...processo.values()].filter(chave => !pais[chave])
    if (faltam.length > 0) {
      const pids = faltam.map(chave => chave.split(':')[0]).join(',')
      const r = await $.process
        .run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', win(`${$.plugin.root}/bin/claude-duo.ps1`), '--pais', pids], {
          timeoutMs: 15_000,
        })
        .catch(() => undefined)
      const achados = lerJson<Record<string, number[]>>((r?.stdout ?? '').trim()) ?? {}
      // o que não se achou (processo que já saiu) fica vazio, para não perguntar de novo
      for (const chave of faltam) pais[chave] = achados[chave.split(':')[0] ?? ''] ?? []
    }
    // só os vivos: o arquivo não cresce com processos que já saíram
    if (faltam.length > 0 || Object.keys(guardados).length !== Object.keys(pais).length) {
      await $.fs.write(`${raiz}/pais.json`, JSON.stringify(pais))
    }
    for (const [id, chave] of processo) {
      const pos = (pais[chave] ?? []).map(p => shells.get(p)).find(x => x !== undefined)
      if (pos !== undefined) mapa[id] = pos
      if (id === eu) {
        // o processo deste claude e o shell da aba dele: o /trocar-conta continua nesta mesma aba
        meuClaude = Number(chave.split(':')[0]) || undefined
        meuShell = (pais[chave] ?? []).find(p => shells.has(p))
      }
    }
  }
  // a sessão estava numa aba e a aba sumiu da lista: fecharam a aba (o processo morre sem avisar).
  // Sem a lista da extensão (janela recarregando, extensão fora) não se conclui nada.
  let fechou = false
  if (shells.size > 0) {
    for (const id of Object.keys(abasAtuais)) {
      if (mapa[id] === undefined && id !== eu && !abaFechada.has(id)) {
        abaFechada.add(id)
        fechou = true
      }
    }
  }
  for (const id of Object.keys(mapa)) abaFechada.delete(id) // reapareceu (outra janela): volta
  if (fechou) solto(lerAtividade($))
  if (JSON.stringify(mapa) === JSON.stringify(abasAtuais)) return
  abasAtuais = mapa
  await update($, abas, () => mapa)
}

/**
 * Uma sessão está viva se marcou há menos disto (cada sessão interativa regrava a marca a cada 30 s).
 * Era 3 min: fechar a aba mata o processo sem session.end (nenhuma marca de `fim`), e o Claudinho dela
 * ficava 3 min no painel. Com a extensão das abas ela sai na hora (abaFechada); isto é a reserva.
 */
const VIVA_MS = 90_000
/** Sessões cuja aba do VS Code fechou (o shell sumiu da lista da extensão): saem do painel já. */
const abaFechada = new Set<string>()

/**
 * Lê as marcas de todas as sessões: quais estão vivas em cada conta e se estão trabalhando.
 * Só mexe no atom quando algo mudou (o painel redesenha com o número novo de Claudinhos).
 */
async function lerAtividade($: EngineInterface) {
  const pasta = `${raiz}/atividade`
  const lista = await $.fs.list(pasta).catch(() => []) // pasta ainda não existe: ninguém marcou nada
  const agora = await $.clock.now()
  const novo: Sessoes = { empresa: [], pessoal: [] }
  for (const arq of lista) {
    if (arq.kind !== 'file' || !arq.name.endsWith('.json') || agora - arq.mtimeMs > VIVA_MS) continue
    const texto = await $.fs.read(`${pasta}/${arq.name}`).catch(() => '') // a sessão saiu e apagou no meio
    const m = lerJson<{ conta?: Conta; trabalhando?: boolean; agentes?: number; fim?: boolean; em?: number }>(texto)
    if (!m?.conta || !CONTAS.includes(m.conta) || m.fim || agora - (m.em ?? 0) >= VIVA_MS) continue
    const id = arq.name.replace(/.json$/, '')
    if (abaFechada.has(id)) continue
    const ag = typeof m.agentes === 'number' && m.agentes > 0 ? { agentes: m.agentes } : {}
    novo[m.conta].push({ id, trabalhando: m.trabalhando === true, ...ag })
  }
  for (const c of CONTAS) novo[c].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const antes = await read($, sessoes)
  if (JSON.stringify(antes) === JSON.stringify(novo)) return
  await update($, sessoes, () => novo)
  // abriu ou fechou sessão: a aba dela entra já, sem esperar o relógio de 30 s
  const ids = (s: Sessoes) => CONTAS.flatMap(c => s[c].map(x => x.id)).sort().join(',')
  if (ids(antes) !== ids(novo)) solto(lerAbas($))
}

/**
 * Um Claudinho por sessão viva da conta (o desta janela com o estado de agora, não o da última marca),
 * na ordem das abas do terminal: na terceira aba, o desta janela é o terceiro (com a setinha). Sem aba
 * conhecida (fora do VS Code, sem a extensão), o desta janela primeiro. Conta sem sessão nenhuma
 * ainda tem o seu, parado.
 */
function membrosDa(c: Conta, ss: Sessoes, aquiTrabalhando: boolean, aquiAgentes = agentesAqui, abasDe = abasAtuais): Membro[] {
  const vivas: readonly SessaoViva[] = ss[c]
  const daqui: Membro = { trabalhando: aquiTrabalhando, aqui: true, ...(aquiAgentes > 0 ? { agentes: aquiAgentes } : {}) }
  const lista = vivas.map(s => ({
    id: s.id,
    m: s.id === eu ? daqui : { trabalhando: s.trabalhando, ...(s.agentes ? { agentes: s.agentes } : {}) },
  }))
  if (c === conta && !vivas.some(s => s.id === eu)) lista.push({ id: eu, m: daqui })
  const membros = ordenarPorAba(lista, x => abasDe[x.id], x => x.m.aqui === true).map(x => x.m)
  return membros.length > 0 ? membros : [{ trabalhando: false }]
}

/** As células dos Claudinhos de uma conta: a cena inteira com uma sessão (e os filhotes dos agentes), o grupo com várias. */
function quadroDa(c: Conta, estado: Estado, t: number, membros: readonly Membro[], arr: Arranjo) {
  if (arr.tamanho === 'cena') return celulas(desenhar(c, estado, t, membros[0]?.trabalhando ?? false, arr.filhotes))
  return celulas(desenharGrupo(c, estado, t, membros.slice(0, arr.mostrados), arr.tamanho))
}

/**
 * Anima os Claudinhos repintando só os pixels deles (blit), sem redesenhar o painel:
 * 8 quadros por segundo; só manda o quadro que mudou (parado, quase nada muda).
 * Enquanto esta sessão trabalha, o painel inteiro redesenha a cada quadro: é o brilho
 * correndo nas barras (que são texto, não pixels); ao parar, um último quadro o apaga.
 */
async function animar($: EngineInterface) {
  tiques += 1
  if (tiques % 40 === 0) {
    await lerAtividade($) // a cada 5 s
    if (await abasMudaram($)) solto(lerAbas($)) // abriu, fechou ou trocou aba: na hora, não no relógio de 30 s
  }
  if (tiques % 8 === 0) solto(lerAgentes($)) // a cada 1 s: os filhotes nascem e somem com os agentes
  if (sitio === undefined) return
  if ((await read($, modo)) === 'oculto') return
  if (trabalhando || acesa) {
    acesa = trabalhando
    await update($, luz, () => tiques)
  }
  const agora = await $.clock.now()
  const ls = await read($, leituras)
  const ss = await read($, sessoes)
  const t = (agora - t0) / 1000
  for (const c of CONTAS) {
    const desenhado = naTela[c]
    if (desenhado === undefined) continue
    const membros = membrosDa(c, ss, trabalhando)
    // mudou o número de sessões (ou de agentes) e o painel ainda não redesenhou: o blit tem de caber no Raster que está lá
    const arr = arranjo(membros.length, desenhado.orcamento, membros)
    if (arr.tamanho !== desenhado.tamanho || arr.colunas !== desenhado.colunas || arr.filhotes !== desenhado.filhotes) continue
    const cells = quadroDa(c, estadoDa(c, ls[c], ss, agora), t, membros, arr)
    if (cells === ultimoQuadro[c]) continue
    ultimoQuadro[c] = cells
    await $.ui.blit({ requestId: sitio, key: `bicho-${c}`, cells, columns: arr.colunas, rows: LINHAS })
  }
}

/** A RAM da máquina: uma leitura a cada ~12 s para todas as sessões juntas (~/.duo-contas/ram.json). */
async function medirRam($: EngineInterface) {
  const arq = `${raiz}/ram.json`
  const agora = await $.clock.now()
  const salvo = (await $.fs.exists(arq)) ? lerJson<Ram>(await $.fs.read(arq)) : undefined
  if (salvo !== undefined && agora - salvo.em < 12_000) {
    await update($, ram, () => salvo)
    return
  }
  const r = await $.process
    .run(['node', win(`${$.plugin.root}/bin/ram.mjs`)], { timeoutMs: 10_000 })
    .catch(() => undefined)
  const v = r?.exitCode === 0 ? lerJson<{ usado: number; total: number }>(r.stdout) : undefined
  if (v === undefined || !(v.total > 0)) return
  const novo: Ram = { usado: v.usado, total: v.total, em: agora }
  await $.fs.write(arq, JSON.stringify(novo))
  await update($, ram, () => novo)
}

/**
 * Conta com a janela de 5h parada ("--"): roda um Claude invisível nela, manda
 * "oi" no haiku e sai assim que a janela começa. Uma sessão por vez faz isso
 * (trava em ~/.duo-contas/acordar/<conta>.json, 15 min).
 */
async function acordarContas($: EngineInterface) {
  if (!acordar || !interativo) return
  const agora = await $.clock.now()
  const ls = await read($, leituras)
  for (const c of CONTAS) {
    if (janelaAtiva(ls[c], agora)) continue
    const trava = `${raiz}/acordar/${c}.json`
    const antes = (await $.fs.exists(trava)) ? lerJson<{ dono: string; em: number }>(await $.fs.read(trava)) : undefined
    if (antes !== undefined && agora - antes.em < TRAVA_ACORDAR_MS) continue
    await $.fs.write(trava, JSON.stringify({ dono: eu, em: agora }))
    await $.clock.sleep(500)
    if (lerJson<{ dono: string }>(await $.fs.read(trava))?.dono !== eu) continue // outra sessão pegou
    solto(acordarConta($, c))
  }
}

async function acordarConta($: EngineInterface, c: Conta) {
  $.ui.toast(`duo-contas: a conta ${c} está sem janela de 5h; mandando um "oi" para ela começar...`)
  const script = win(`${$.plugin.root}/bin/claude-duo.ps1`)
  const r = await $.process
    .run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '--acordar', c], {
      timeoutMs: 180_000,
    })
    .catch(() => undefined)
  await sincronizar($)
  const agora = await $.clock.now()
  const l = (await read($, leituras))[c]
  $.ui.toast(
    janelaAtiva(l, agora)
      ? `duo-contas: conta ${c} acordada; a janela de 5h vai até ${quandoBR(l?.cinco?.renova, agora)}`
      : `duo-contas: não consegui acordar a conta ${c}${r ? ` (saída ${r.exitCode})` : ''}; tento de novo em 15 min`,
  )
}

type Dados = {
  aqui: Conta
  ls: Leituras
  trabalhando: boolean
  ctx: Contexto | null
  resposta: number | null
  ram: Ram | null
  aviso: string | null
  ss: Sessoes
  /** Os subagentes desta sessão rodando agora. */
  agentes: number
  dica?: string
  colunas: number
  agora: number
}

/** A cor de cada medida: cada barra a sua, para bater o olho e saber qual é qual. */
const COR = {
  cinco: [90, 169, 240],
  sete: [180, 140, 242],
  contexto: [240, 151, 90],
  ram: [61, 201, 168],
  critico: [240, 96, 90],
} as const satisfies Record<string, Rgb>
const AMARELO = '#F2C94C'
const VERDE = '#7BD88F'
const hex = (c: Rgb) => `#${c.map(n => n.toString(16).padStart(2, '0')).join('')}`

/** Onde cada medida fica amarela (o número) e vermelha (a barra também). */
type Faixa = { aviso: number; critico: number }
const faixaConta = (): Faixa => ({ aviso: 70, critico: limite })
const FAIXA_CONTEXTO: Faixa = { aviso: 70, critico: 85 }
const FAIXA_RAM: Faixa = { aviso: 80, critico: 92 }
const corDaBarra = (pct: number | undefined, propria: Rgb, f: Faixa): Rgb =>
  pct !== undefined && pct >= f.critico ? COR.critico : propria
const corDoNumero = (pct: number | undefined, f: Faixa): string | undefined =>
  pct === undefined ? 'inactive' : pct >= f.critico ? hex(COR.critico) : pct >= f.aviso ? AMARELO : undefined

/**
 * O humor do bichinho: a janela mais apertada da conta; sem janela de 5h ativa, dorme. A outra conta
 * sem nenhuma sessão aberta também dorme (fecharam a aba dela: ninguém trabalha ali), menos no limite,
 * que é o recado mais útil (olhos de x).
 */
function estadoDa(c: Conta, l: Leitura | undefined, ss: Sessoes, agora: number): Estado {
  const e = humor(janelaAtiva(l, agora) ? pressao(l, agora) : undefined, limite)
  return e !== 'exausto' && c !== conta && ss[c].length === 0 ? 'dormindo' : e
}

/** Uma barra como texto colorido: tubo com brilho, cor própria, vermelha no crítico; `brilho` = o instante da luz que corre nela. */
function barraTexto(Text: Elements['terminal']['Text'], pct: number | undefined, cor: Rgb, colunas: number, brilho?: number) {
  return barraCelulas(pct, cor, colunas, brilho).map(c => (
    <Text color={c.frente} backgroundColor={c.fundo}>
      {c.ch}
    </Text>
  ))
}

/** Quantas colunas o texto de um cartão (conta, 5h, 7d, legenda) ocupa em cada formato do painel. */
const TEXTO_DO_CARTAO = { largo: 36, medio: 24, estreito: 14 } as const

/** A legenda embaixo das barras: o que o Claudinho faz; com várias sessões, quantas e quantas trabalhando. */
function legendaDa(c: Conta, estado: Estado, membros: readonly Membro[]): string {
  const ativos = membros.filter(m => m.trabalhando).length
  const verbo = c === 'empresa' ? 'codando' : 'dançando'
  const ag = membros.reduce((a, m) => a + (m.agentes ?? 0), 0)
  if (membros.length <= 1) {
    // com agentes: trabalhando junto com eles, ou parado de olho neles
    if (ag > 0) return ativos ? `${verbo} com ${quantosAgentes(ag)}` : `de olho em ${quantosAgentes(ag)}`
    return ativos ? verbo : c === 'empresa' && (estado === 'feliz' || estado === 'ok') ? 'pausa pro café' : LEGENDA[estado]
  }
  return `${membros.length} sessões · ${ativos ? `${ativos} ${verbo}` : LEGENDA[estado]}${ag > 0 ? ` · ${quantosAgentes(ag)}` : ''}`
}

const quantosAgentes = (n: number) => `${n} agente${n > 1 ? 's' : ''}`

/** O painel no terminal: os bichinhos em pixel art (Raster, animados por blit) e as barras em texto colorido. */
function painelPixels({ Box, Text, Raster }: Elements['terminal'], d: Dados) {
  const formato = d.colunas >= 120 ? 'largo' : d.colunas >= 90 ? 'medio' : 'estreito'
  const larguraBarra = formato === 'largo' ? 10 : 6
  const t = (d.agora - t0) / 1000
  // as colunas que sobram para os Claudinhos de cada conta, tirando o texto dos dois cartões e os espaços
  const orcamento = Math.floor((d.colunas - 2 * TEXTO_DO_CARTAO[formato] - 8) / 2)

  // cada linha é UM Text (com pedaços dentro): nada de Box por linha, que desalinhava as barras
  // a luz correndo nas barras: as da conta desta sessão e a do contexto, enquanto ela trabalha
  const brilho = d.trabalhando ? t : undefined

  const linhaJanela = (rotulo: '5h' | '7d', pct: number | undefined, renova: string | undefined, ativa: boolean, luz?: number) => {
    const mostra = ativa ? pct : undefined
    const propria = rotulo === '5h' ? COR.cinco : COR.sete
    const quando = !ativa ? (formato === 'largo' ? '  sem janela ativa' : '') : !renova ? '' : formato === 'largo' ? `  renova ${renova}` : ` ↻${renova}`

    return (
      <Text wrap="truncate-end">
        <Text color={hex(propria)}>{rotulo} </Text>
        {formato !== 'estreito' ? barraTexto(Text, mostra, corDaBarra(mostra, propria, faixaConta()), larguraBarra, luz) : null}
        <Text color={corDoNumero(mostra, faixaConta())}>{fmtPct(mostra)}</Text>
        <Text dimColor>{quando}</Text>
      </Text>
    )
  }

  const cartao = (c: Conta) => {
    const l = d.ls[c]
    const ativa5 = janelaAtiva(l, d.agora)
    const estado = estadoDa(c, l, d.ss, d.agora)
    const daqui = c === d.aqui
    // um Claudinho por sessão: quanto mais sessões, menores, até o teto de colunas
    const membros = membrosDa(c, d.ss, d.trabalhando, d.agentes)
    const arr = arranjo(membros.length, orcamento, membros)
    naTela[c] = { ...arr, orcamento }
    const quadro = quadroDa(c, estado, t, membros, arr)
    ultimoQuadro[c] = quadro
    const visto = !daqui && l !== undefined && formato === 'largo' ? ` · visto ${haQuanto(l.em, d.agora)}` : ''
    const sete = pctEfetivo(l?.sete, d.agora)

    return (
      <Box key={c} flexDirection="row" gap={2}>
        <Raster key={`bicho-${c}`} columns={arr.colunas} rows={LINHAS} cells={quadro} />
        <Box flexDirection="column" marginTop={1}>
          <Text wrap="truncate-end">
            <Text bold color={daqui ? 'claude' : undefined}>
              {c}
            </Text>
            <Text dimColor>{daqui ? '  ◀ aqui' : ''}</Text>
          </Text>
          {linhaJanela('5h', pctEfetivo(l?.cinco, d.agora), quandoBR(l?.cinco?.renova, d.agora), ativa5, daqui ? brilho : undefined)}
          {linhaJanela('7d', sete, quandoBR(l?.sete?.renova, d.agora), sete !== undefined, daqui ? brilho : undefined)}
          <Text dimColor wrap="truncate-end">
            {legendaDa(c, estado, membros)}
            {visto}
          </Text>
        </Box>
      </Box>
    )
  }

  const s = sessao(d)

  return (
    <Box flexDirection="column">
      {d.dica ? (
        <Text dimColor wrap="truncate-end">
          {d.dica}
        </Text>
      ) : null}
      <Box flexDirection="row" gap={formato === 'estreito' ? 1 : 4}>
        {CONTAS.map(cartao)}
      </Box>
      <Text wrap="truncate-end">
        <Text color={hex(COR.contexto)}>contexto </Text>
        {barraTexto(Text, s.ctxPct, corDaBarra(s.ctxPct, COR.contexto, FAIXA_CONTEXTO), larguraBarra, brilho)}
        <Text color={corDoNumero(s.ctxPct, FAIXA_CONTEXTO)}>{fmtPct(s.ctxPct)}</Text>
        <Text dimColor>{s.ctxTam}</Text>
        <Text dimColor>{'   cache '}</Text>
        <Text color={s.cache.cor}>{s.cache.texto}</Text>
        <Text color={hex(COR.ram)}>{'   RAM '}</Text>
        {barraTexto(Text, s.ramPct, corDaBarra(s.ramPct, COR.ram, FAIXA_RAM), larguraBarra)}
        <Text color={corDoNumero(s.ramPct, FAIXA_RAM)}>{fmtPct(s.ramPct)}</Text>
        <Text dimColor>{s.ramTam}</Text>
      </Text>
      {d.aviso !== null && <Text color={AMARELO}>→ {d.aviso}</Text>}
    </Box>
  )
}

/** Fora do terminal (o app desktop não tem Raster): o mesmo painel só com texto. */
function painelTexto({ Box, Text }: Elements[RenderSurface], d: Dados) {
  const s = sessao(d)
  const conta1 = (c: Conta) => {
    const l = d.ls[c]
    const ativa5 = janelaAtiva(l, d.agora)
    const cinco = ativa5 ? pctEfetivo(l?.cinco, d.agora) : undefined
    const sete = pctEfetivo(l?.sete, d.agora)
    const renova = ativa5 ? quandoBR(l?.cinco?.renova, d.agora) : undefined
    const membros = membrosDa(c, d.ss, d.trabalhando, d.agentes)
    const n = membros.length
    const ag = membros.reduce((a, m) => a + (m.agentes ?? 0), 0)

    return (
      <Text>
        <Text bold color={c === d.aqui ? 'claude' : undefined}>
          {c}
        </Text>
        <Text dimColor>{n > 1 ? ` ×${n}` : ''}</Text>
        <Text dimColor>{ag > 0 ? ` · ${quantosAgentes(ag)}` : ''}</Text>
        <Text color={hex(COR.cinco)}> 5h</Text>
        <Text color={corDoNumero(cinco, faixaConta())}>{fmtPct(cinco)}</Text>
        <Text dimColor>{renova ? ` ↻${renova}` : ''}</Text>
        <Text color={hex(COR.sete)}> 7d</Text>
        <Text color={corDoNumero(sete, faixaConta())}>{fmtPct(sete)}</Text>
      </Text>
    )
  }

  return (
    <Box flexDirection="column">
      {d.dica ? <Text dimColor>{d.dica}</Text> : null}
      <Box flexDirection="row" gap={4}>
        {CONTAS.map(conta1)}
      </Box>
      <Text>
        <Text color={hex(COR.contexto)}>contexto</Text>
        <Text color={corDoNumero(s.ctxPct, FAIXA_CONTEXTO)}>{fmtPct(s.ctxPct)}</Text>
        <Text dimColor>{s.ctxTam}</Text>
        <Text dimColor>{'   cache '}</Text>
        <Text color={s.cache.cor}>{s.cache.texto}</Text>
        <Text color={hex(COR.ram)}>{'   RAM'}</Text>
        <Text color={corDoNumero(s.ramPct, FAIXA_RAM)}>{fmtPct(s.ramPct)}</Text>
        <Text dimColor>{s.ramTam}</Text>
      </Text>
      {d.aviso !== null && <Text color={AMARELO}>→ {d.aviso}</Text>}
    </Box>
  )
}

/** Contexto, cache e RAM: da sessão e da máquina, não da conta. */
function sessao(d: Dados) {
  const ctxPct = d.ctx?.pct
  const ctxTam = d.ctx?.tokens !== undefined ? ` ${fmtTokens(d.ctx.tokens)}/${fmtTokens(d.ctx.janela)}` : ''
  const expira = d.resposta !== null ? d.resposta + cacheMs : undefined
  const resta = expira !== undefined ? expira - d.agora : undefined
  const cache =
    d.trabalhando
      ? { texto: 'renovando', cor: VERDE }
      : expira === undefined || resta === undefined
        ? { texto: '--', cor: 'inactive' }
        : resta <= 0
          ? { texto: `expirou ${horaBR(expira)}`, cor: 'inactive' }
          : { texto: `até ${horaBR(expira)}`, cor: resta < 10 * 60_000 ? AMARELO : VERDE }
  const ramPct = d.ram ? (d.ram.usado / d.ram.total) * 100 : undefined
  const ramTam = d.ram ? ` ${fmtGB(d.ram.usado)}/${fmtGB(d.ram.total)} GB` : ''

  return { ctxPct, ctxTam, cache, ramPct, ramTam }
}

/** Tudo o que o painel desenha; ler os valores aqui faz o painel redesenhar quando eles mudam. */
async function dados($: EngineInterface, isWorking: boolean, colunas: number): Promise<Dados> {
  await read($, relogio)
  await read($, luz)
  await read($, abas) // a ordem dos Claudinhos segue as abas: mudou, redesenha

  return {
    aqui: conta ?? 'empresa',
    ls: await read($, leituras),
    trabalhando: isWorking,
    ctx: await read($, contexto),
    resposta: await read($, ultimaResposta),
    ram: await read($, ram),
    aviso: await read($, aviso),
    ss: await read($, sessoes),
    agentes: await read($, agentes),
    colunas,
    agora: await $.clock.now(),
  }
}

export const register: Register = (on, options) => {
  limite = Number(options['limite'] ?? 95) || 95
  teto = Math.max(limite, Number(options['teto'] ?? 98) || 98)
  volta = Math.min(limite, Number(options['volta'] ?? 80) || 80)
  automatico = options['automatico'] !== false
  acordar = options['acordar'] !== false
  cacheMs = (Number(options['cacheMinutos'] ?? 60) || 60) * 60_000

  on('session.start', async ($, e, next) => {
    conta = contaDoConfigDir(await $.env.get('CLAUDE_CONFIG_DIR'))
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
    raiz = `${home.replace(/\\/g, '/')}/.duo-contas`
    // a pasta da conta empresa: a deste processo, se for ela; senão a do config.json do instalador (padrão ~/.claude-empresa)
    const casa = home.replace(/\\/g, '/')
    const cfg = lerJson<{ pastaEmpresa?: string }>(await $.fs.read(`${raiz}/config.json`).catch(() => ''))
    const dirAqui = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
    const pastaEmpresa = conta === 'empresa' && dirAqui ? dirAqui : (cfg?.pastaEmpresa ?? `${casa}/.claude-empresa`).replace(/\\/g, '/')
    pastasSessoes = [`${casa}/.claude/sessions`, `${pastaEmpresa}/sessions`]
    token = (await $.env.get('CLAUDE_DUO_TOKEN')) || undefined
    interativo = e.isInteractive
    t0 = await $.clock.now()
    eu = await $.session.id()
    // depois de um /reload-plugins: o que rodava em segundo plano no último Stop continua rodando
    segundoPlano = await read($, segundoPlanoGuardado)

    const uso = await $.session.usage()
    await guardarContexto($, uso.context)
    await sincronizar($)
    await registrar($, uso.rateLimits)
    await avaliar($)
    if (!interativo) return next(e) // num `claude -p` só registra o uso: nada de painel, timers ou "acordar"

    await $.command.register({
      name: 'trocar-conta',
      description: 'Continua esta sessão na outra conta (empresa <-> pessoal), com a conversa inteira',
      argumentHint: '[mensagem para mandar lá]',
    })
    await $.command.register({
      name: 'bichinhos',
      description: 'Onde fica o painel dos bichinhos: abaixo do prompt, acima, ou oculto',
      argumentHint: '[abaixo|acima|oculto]',
    })
    const salvo = await $.store.get('modo')
    if (MODOS.includes(salvo as Modo)) await update($, modo, () => salvo as Modo)

    $.clock.every(125, () => solto(animar($)))
    $.clock.every(15_000, () => solto(medirRam($)))
    $.clock.every(30_000, () =>
      solto(
        (async () => {
          const agora = await $.clock.now()
          await update($, relogio, () => agora)
          await sincronizar($)
          await avaliar($)
          await decidir($, 'relogio')
          await seguirConversa($)
          await lerAbas($)
          await sinalizar($)
        })(),
      ),
    )
    $.clock.every(60_000, () => solto(acordarContas($)))
    solto(medirRam($))
    $.clock.after(5_000, () => solto(acordarContas($)))
    if (token !== undefined) solto(retomar($))
    solto(sinalizar($).then(() => lerAtividade($))) // a primeira leitura já procura as abas
    solto(lerAgentes($))

    return next(e)
  })

  // Sessão retomada: o cache conta a partir da última resposta que ela já tinha.
  on('classic.SessionStart', async ($, e, next) => {
    if (typeof e.seconds_since_last_response === 'number') {
      const t = (await $.clock.now()) - e.seconds_since_last_response * 1000
      await update($, ultimaResposta, () => t)
    }

    return next(e)
  }).catch(($, e, next) => next(e)) // é só para o relógio do cache: falhou, a sessão começa igual

  on('session.end', ($, e, next) => {
    solto(sinalizar($, true))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) await guardarContexto($, e.context)
    if (e.changed.includes('rateLimits')) await registrar($, e.rateLimits)

    return next(e)
  })

  on('turn.start', ($, e, next) => {
    trabalhando = true
    solto(sinalizar($))

    return next(e)
  })

  // Mensagem nova da pessoa: com esta conta no limite, ou na pessoal com a empresa folgada, ela já vai
  // pela outra conta. Com algo em segundo plano, só no teto (sair o mataria): fica aqui e o aviso explica.
  on('prompt.submit', async ($, e, next) => {
    const isDaPessoa = e.origin.kind === 'composer' && e.turnId === undefined
    const temAnexo = (e.attachments?.length ?? 0) > 0
    if (conta === undefined || !trocaSozinha() || trocando || !isDaPessoa || temAnexo || e.text.startsWith('/')) {
      return next(e)
    }
    await sincronizar($)
    const agora = await $.clock.now()
    const ls = await read($, leituras)
    const efetivas = estourou ? estourada(conta, ls, agora) : ls
    const s = situacao(conta, efetivas, limite, agora, volta)
    if (s !== 'trocar' && s !== 'voltar') return next(e)
    const forcar = s === 'trocar' && noTeto(conta, ls, limite, teto, agora, estourou)
    if (segundoPlano.length > 0 && !forcar) {
      await avaliar($)
      return next(e)
    }

    const para = OUTRA[conta]
    const pct = Math.round(pressao(efetivas[conta], agora) ?? 0)
    const pe = Math.round(pressao(ls.empresa, agora) ?? 0)
    const tarefas = forcar ? segundoPlano : []
    const motivo = s === 'voltar' ? `a empresa tem folga (${pe}%)` : `a conta ${conta} está em ${pct}% do limite`
    if (!(await trocar($, comTarefas(e.text, tarefas), motivo, tarefas))) return next(e)

    return {
      drop:
        s === 'voltar'
          ? `duo-contas: a empresa tem folga (${pe}%). Esta mensagem volta para a conta empresa.`
          : `duo-contas: ${conta} em ${pct}%. Esta mensagem continua na conta ${para}.`,
    }
  }).catch(($, e, next) => next(e)) // falhou: a mensagem segue nesta conta mesmo, nunca se perde

  // O Stop diz o que ficou rodando em segundo plano (Bash, subagente, monitor): sair agora o mataria.
  on('classic.Stop', async ($, e, next) => {
    const lista = (e.background_tasks ?? []).map(t => ({
      tipo: t.type,
      descricao: t.description,
      ...(t.command ? { comando: t.command } : {}),
    }))
    segundoPlano = lista
    await update($, segundoPlanoGuardado, () => lista)
    if (e.agent_id === undefined) estourou = false // a resposta veio inteira: a conta não está travada

    return next(e)
  }).catch(($, e, next) => next(e))

  // Uma resposta (desta sessão ou de um subagente dela) morreu no limite: a conta está travada, diga a
  // última leitura o que disser. É o teto: troca mesmo com segundo plano, que também não andaria mais.
  on('classic.StopFailure', async ($, e, next) => {
    const r = await next(e)
    if (e.error === 'rate_limit') {
      estourou = true
      $.clock.after(1_500, () => solto(decidir($, 'falha', e.agent_id === undefined)))
    }

    return r
  }).catch(($, e, next) => next(e))

  // Um agente começou ou acabou: os filhotes aparecem ou somem já, sem esperar a leitura de cada segundo.
  on('classic.SubagentStart', async ($, e, next) => {
    const r = await next(e)
    solto(lerAgentes($))

    return r
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    const r = await next(e)
    solto(lerAgentes($))

    return r
  }).catch(($, e, next) => next(e))

  // Fim da resposta: o cache conta daqui; e se esta conta chegou ao limite, a sessão já passa para a
  // outra (sem esperar a próxima mensagem). Se a resposta morreu no limite, ela continua de onde parou.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r
    trabalhando = false
    solto(sinalizar($))
    const agora = await $.clock.now()
    await update($, ultimaResposta, () => agora)
    if (e.isAborted || !trocaSozinha() || trocando) return r

    const cortada = e.reason === 'error'
    // um instante para o Stop contar o segundo plano e para ver se outro turno não começou
    $.clock.after(1_500, () => solto(decidir($, 'fim', cortada)))

    return r
  })

  on('command.run', { command: 'trocar-conta' }, async ($, e) => {
    if (conta === undefined) return { text: 'duo-contas ainda está iniciando.' }
    const para = OUTRA[conta]
    const tarefas = segundoPlano
    const foi = await trocar($, comTarefas(e.args.trim() || undefined, tarefas), 'troca pedida com /trocar-conta', tarefas)

    return { text: foi ? `Continuando na conta ${para}...` : 'Não deu para trocar agora.' }
  })

  on('command.run', { command: 'bichinhos' }, async ($, e) => {
    const pedido = e.args.trim().toLowerCase() as Modo
    const atual = await read($, modo)
    const novo = MODOS.includes(pedido) ? pedido : (MODOS[(MODOS.indexOf(atual) + 1) % MODOS.length] ?? 'abaixo')
    await update($, modo, () => novo)
    await $.store.set('modo', novo)

    return { text: `Bichinhos: ${novo}.` }
  })

  // Embaixo do prompt, no lugar do claude-hud: a linha de dicas do engine em cima, o painel embaixo dela.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (conta === undefined || (await read($, modo)) !== 'abaixo') return next(e)
    const d = { ...(await dados($, e.props.isWorking, e.viewport?.columns ?? 120)), dica: e.props.hint }
    if (e.surface !== 'terminal') return painelTexto($.ui.resolve(e), d)
    sitio = e.requestId

    return painelPixels($.ui.resolve(e), d)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (conta === undefined || e.props.hasSurvey || (await read($, modo)) !== 'acima') return next(e)
    const d = await dados($, e.props.isWorking, e.props.bodyColumns)
    if (e.surface !== 'terminal') return painelTexto($.ui.resolve(e), d)
    sitio = e.requestId

    return painelPixels($.ui.resolve(e), d)
  })
}
