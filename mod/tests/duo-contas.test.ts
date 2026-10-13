import type { AgentStatus, On, RenderElement, SessionRateLimit } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { contaDoConfigDir, emQuanto, estourada, horaBR, humor, janelaAtiva, noTeto, ordenarPorAba, pctEfetivo, quandoBR, situacao } from '../hooks/logic'
import { COLUNAS, LINHAS, SUOR, SUOR_BRILHO, arranjo, barraCelulas, celulas, desenhar, desenharGrupo } from '../hooks/sprites'
import type { Quadro } from '../hooks/sprites'

const AGORA = Date.parse('2026-10-12T15:00:00Z') // 12:00 em Brasília, segunda
const HORA = 3_600_000
const RAIZ = 'C:/Users/vini/.duo-contas'
const daqui = (ms: number) => new Date(AGORA + ms).toISOString()

type Mundo = {
  conta: 'empresa' | 'pessoal'
  token?: string
  rateLimits?: SessionRateLimit[]
  arquivos?: Record<string, string>
  /** O que o $.store guarda ao abrir (ex.: o modo do painel). */
  guardado?: Record<string, unknown>
  /** Os agentes que o $.agent.list devolve (o teste muda a lista no meio). */
  agentes?: { id: string; status: AgentStatus }[]
  /** Variáveis a mais no ambiente (ex.: CLAUDE_DUO_PIDS, que o claude-duo põe). */
  env?: Record<string, string>
  /** O que o claude-duo.ps1 --pais responde: os processos acima de cada claude pedido. */
  pais?: Record<string, number[]>
  /** A extensão duo-contas-abas do VS Code reserva os pedidos de continuar na mesma aba. */
  extensaoAtende?: boolean
}

/** O que fica abaixo do mod: env, relógio, arquivos, processos e a sessão, tudo em memória. */
function montar(on: On, m: Mundo) {
  const env: Record<string, string> = { USERPROFILE: 'C:\\Users\\vini' }
  if (m.conta === 'empresa') env['CLAUDE_CONFIG_DIR'] = 'C:\\Users\\vini\\.claude-empresa'
  if (m.token !== undefined) env['CLAUDE_DUO_TOKEN'] = m.token
  Object.assign(env, m.env ?? {})
  mock.env(on, env)
  mock.store(on, m.guardado ?? {})
  const relogio = mock.clock(on, { now: AGORA })

  // O engine entrega o caminho com barras do Windows; aqui tudo vira "/".
  const k = (path: string) => path.replace(/\\/g, '/')
  const arquivos = new Map(Object.entries(m.arquivos ?? {}))
  const comandos: string[] = []
  const enviados: string[] = []
  const toasts: string[] = []
  const processos: string[][] = []
  const blits: { key: string; columns: number }[] = []
  // existe se for um arquivo ou uma pasta com arquivos dentro
  on('fs.exists', ($, e) => ({ value: arquivos.has(k(e.path)) || [...arquivos.keys()].some(a => a.startsWith(k(e.path) + '/')) }))
  on('fs.read', ($, e) => {
    const t = arquivos.get(k(e.path))
    if (t === undefined) throw new Error(`não existe: ${e.path}`)
    return { value: t }
  })
  on('fs.write', ($, e) => {
    arquivos.set(k(e.path), e.text)
    // a extensão reserva o pedido de continuar na mesma aba renomeando para .aceito
    const pedido = /\/abrir\/(.+)\.json$/.exec(k(e.path))
    if (m.extensaoAtende && pedido && !e.text.includes('cancelado')) {
      arquivos.delete(k(e.path))
      arquivos.set(k(e.path).replace(/\.json$/, '.aceito'), e.text)
    }
    return { value: undefined }
  })
  on('fs.list', ($, e) => {
    const pasta = k(e.path).replace(/\/$/, '') + '/'
    const nomes = [...arquivos.keys()].filter(a => a.startsWith(pasta) && !a.slice(pasta.length).includes('/'))
    return { value: nomes.map(a => ({ name: a.slice(pasta.length), kind: 'file' as const, size: 1, mtimeMs: AGORA, isLink: false })) }
  })
  on('process.run', ($, e) => {
    processos.push([...e.argv])
    const fim = { stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    if (e.argv[0] === 'node') {
      return { value: { exitCode: 0, stdout: JSON.stringify({ usado: 13.6 * 1024 ** 3, total: 16 * 1024 ** 3 }), ...fim } }
    }
    const pais = e.argv.indexOf('--pais')
    if (pais >= 0) {
      const pedidos = (e.argv[pais + 1] ?? '').split(',')
      const achados = Object.fromEntries(pedidos.filter(p => m.pais?.[p]).map(p => [p, m.pais![p]!]))
      return { value: { exitCode: 0, stdout: `${JSON.stringify(achados)}\r\n`, ...fim } }
    }
    const acordar = e.argv.indexOf('--acordar')
    if (acordar >= 0) {
      // o que o claude-duo.ps1 --acordar faz: grava a janela que acabou de começar
      const c = e.argv[acordar + 1] ?? ''
      arquivos.set(`${RAIZ}/contas/${c}.json`, JSON.stringify({ conta: c, cinco: { pct: 1, renova: daqui(5 * HORA) }, em: AGORA + 1 }))
    }
    return { value: { exitCode: 0, stdout: '', ...fim } }
  })
  on('session.usage', () => ({
    value: { startedAt: AGORA - HORA, context: { window: 200_000, tokens: 62_000, percent: 31 }, rateLimits: m.rateLimits ?? [] },
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  const sessao = { id: 'sessao-1' } // o teste muda no meio (um /resume de outra conversa)
  on('session.id', () => ({ value: sessao.id }))
  on('session.cwd', () => ({ value: 'C:\\projetos\\exemplo' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('command.run', ($, e) => {
    comandos.push(e.command)
    return {}
  })
  on('prompt.submit', ($, e) => {
    enviados.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.blit', ($, e) => {
    if ('columns' in e) blits.push({ key: e.key, columns: e.columns ?? 0 })
    return { value: {} }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('classic.Stop', () => ({}))
  on('classic.StopFailure', () => ({}))
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  const agentes = m.agentes ?? []
  on('agent.list', () => ({ value: agentes.map(a => ({ id: a.id, description: 'tarefa', type: 'general-purpose', status: a.status })) }))

  return { arquivos, comandos, enviados, toasts, processos, relogio, blits, agentes, sessao }
}

const cinco = (percentUsed: number, resetsAt = daqui(2 * HORA)): SessionRateLimit => ({ kind: 'five_hour', percentUsed, resetsAt })
const leitura = (conta: string, pct: number, renova = daqui(2 * HORA)) =>
  JSON.stringify({ conta, cinco: { pct, renova }, em: AGORA - 60_000 })
const iniciar = ($: { session: { start: (e: { cwd: string; surface: 'terminal'; isInteractive: boolean }) => Promise<unknown> } }) =>
  $.session.start({ cwd: 'C:\\projetos\\exemplo', surface: 'terminal', isInteractive: true })
const digitar = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })
const resposta = (turnId: string) => ({ answer: 'feito', durationMs: 1_000, isAborted: false, turnId, reason: 'answer' as const })
const DICA = { isDraft: false, isWorking: true, hint: '? for shortcuts' }
const TELA = { columns: 160, rows: 40 }
const BAND = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} }

describe('lógica', () => {
  test('a conta sai do CLAUDE_CONFIG_DIR', async () => {
    expect(contaDoConfigDir(undefined)).toBe('pessoal')
    expect(contaDoConfigDir('C:\\Users\\vini\\.claude')).toBe('pessoal')
    expect(contaDoConfigDir('C:\\Users\\vini\\.claude-empresa\\')).toBe('empresa')
  })

  test('janela que já renovou conta como zero, e como parada', async () => {
    expect(pctEfetivo({ pct: 97, renova: daqui(-60_000) }, AGORA)).toBe(0)
    expect(pctEfetivo({ pct: 97, renova: daqui(HORA) }, AGORA)).toBe(97)
    expect(pctEfetivo(undefined, AGORA)).toBeUndefined()
    expect(janelaAtiva({ conta: 'pessoal', cinco: { pct: 3, renova: daqui(-60_000) }, em: AGORA }, AGORA)).toBe(false)
    expect(janelaAtiva(undefined, AGORA)).toBe(false)
    expect(janelaAtiva({ conta: 'pessoal', cinco: { pct: 3, renova: daqui(HORA) }, em: AGORA }, AGORA)).toBe(true)
  })

  test('troca a conta que bateu o limite, e não quando a outra também está no limite', async () => {
    const empresa = { conta: 'empresa' as const, cinco: { pct: 96 }, em: AGORA }
    const pessoal = (pct: number) => ({ conta: 'pessoal' as const, cinco: { pct }, em: AGORA })
    expect(situacao('empresa', { empresa }, 95, AGORA)).toBe('trocar')
    expect(situacao('empresa', { empresa, pessoal: pessoal(99) }, 95, AGORA)).toBe('ambas-no-limite')
    expect(situacao('empresa', { empresa: { ...empresa, cinco: { pct: 90 } } }, 95, AGORA)).toBe('livre')
    // a pessoal no limite também passa para a empresa, se ela tiver folga
    expect(situacao('pessoal', { pessoal: pessoal(99) }, 95, AGORA)).toBe('trocar')
    expect(situacao('pessoal', { pessoal: pessoal(99), empresa }, 95, AGORA)).toBe('ambas-no-limite')
    // a janela de 7 dias também trava a conta
    expect(situacao('empresa', { empresa: { ...empresa, cinco: { pct: 10 }, sete: { pct: 97 } } }, 95, AGORA)).toBe('trocar')
  })

  test('na pessoal, volta para a empresa só com folga de verdade (abaixo de 80): entre 80 e 95 fica, sem vaivém', async () => {
    const pessoal = { conta: 'pessoal' as const, cinco: { pct: 40 }, em: AGORA }
    const empresa = (pct: number, renova?: string) => ({ conta: 'empresa' as const, cinco: { pct, ...(renova ? { renova } : {}) }, em: AGORA })
    expect(situacao('pessoal', { pessoal, empresa: empresa(30) }, 95, AGORA)).toBe('voltar')
    expect(situacao('pessoal', { pessoal, empresa: empresa(85) }, 95, AGORA)).toBe('livre')
    // a janela da empresa renovou: vale zero, volta
    expect(situacao('pessoal', { pessoal, empresa: empresa(97, daqui(-60_000)) }, 95, AGORA)).toBe('voltar')
    // sem leitura da empresa não dá para saber: fica
    expect(situacao('pessoal', { pessoal }, 95, AGORA)).toBe('livre')
    // a semana da empresa estourada segura a volta, mesmo com a janela de 5h vazia
    expect(situacao('pessoal', { pessoal, empresa: { ...empresa(0), sete: { pct: 96 } } }, 95, AGORA)).toBe('livre')
    // a empresa nunca "volta": ela é a conta de partida
    expect(situacao('empresa', { empresa: empresa(10), pessoal }, 95, AGORA)).toBe('livre')
  })

  test('o teto: de 98% para cima, ou com uma resposta morta no limite, a troca não espera o segundo plano', async () => {
    const ls = (pe: number, pp = 40) => ({
      empresa: { conta: 'empresa' as const, cinco: { pct: pe, renova: daqui(HORA) }, sete: { pct: 30 }, em: AGORA },
      pessoal: { conta: 'pessoal' as const, cinco: { pct: pp }, em: AGORA },
    })
    expect(noTeto('empresa', ls(96), 95, 98, AGORA)).toBe(false)
    expect(noTeto('empresa', ls(98.5), 95, 98, AGORA)).toBe(true)
    // a resposta morreu no limite: a leitura (90%) estava atrasada, vale o teto
    expect(noTeto('empresa', ls(90), 95, 98, AGORA, true)).toBe(true)
    // ...mas sem conta para onde ir, não há troca
    expect(noTeto('empresa', ls(99, 99), 95, 98, AGORA)).toBe(false)
    // estourada: 100% até a janela de 5h renovar; a de 7 dias fica como estava
    const e = estourada('empresa', ls(90), AGORA).empresa
    expect(e?.cinco).toEqual({ pct: 100, renova: daqui(HORA) })
    expect(e?.sete?.pct).toBe(30)
    expect(pctEfetivo(e?.cinco, AGORA + 2 * HORA)).toBe(0)
  })

  test('horário de Brasília, com o dia da semana quando não é hoje', async () => {
    expect(horaBR(AGORA)).toBe('12:00')
    expect(quandoBR(daqui(3 * HORA + 20 * 60_000), AGORA)).toBe('15:20')
    expect(quandoBR('2026-10-16T18:00:00Z', AGORA)).toBe('sex 15:00')
    // 23h30 de Brasília ainda é "hoje", embora em UTC já seja amanhã
    expect(quandoBR('2026-10-13T02:30:00Z', AGORA)).toBe('23:30')
    expect(emQuanto(daqui(2 * HORA + 10 * 60_000), AGORA)).toBe('2h10')
  })

  test('Claudinhos: cada conta tem a sua cena, com olhos de expressão e efeitos em letras', async () => {
    expect(humor(undefined, 95)).toBe('dormindo')
    expect(humor(20, 95)).toBe('feliz')
    expect(humor(85, 95)).toBe('apertado')
    expect(humor(95, 95)).toBe('exausto')
    const tamanho = Math.ceil((COLUNAS * LINHAS * 12) / 3) * 4 // [caractere, frente, fundo] u32 por célula, base64
    const letras = (q: ReturnType<typeof desenhar>) => q.letras.map(l => l.ch)
    for (const c of ['empresa', 'pessoal'] as const) {
      const a = desenhar(c, 'feliz', 0.25, true)
      const b = desenhar(c, 'feliz', 0.5, true)
      expect(a.px.length).toBe(COLUNAS * LINHAS * 2)
      expect(a.px.filter(p => p !== null).length).toBeGreaterThan(50)
      expect(celulas(a).length).toBe(tamanho)
      expect(celulas(a)).not.toBe(celulas(b)) // trabalhando, cada quadro é diferente
      // dormindo: olhos fechados (-) e um "z" subindo; no limite: olhos de x
      expect(letras(desenhar(c, 'dormindo', 0.6, false))).toEqual(expect.arrayContaining(['-']))
      expect(letras(desenhar(c, 'dormindo', 0.6, false)).some(ch => ch.toLowerCase() === 'z')).toBe(true)
      expect(letras(desenhar(c, 'exausto', 0.3, false)).filter(ch => ch === 'x').length).toBe(2)
      // o olho de expressão tem o fundo na cor do corpo
      expect(desenhar(c, 'exausto', 0.3, false).letras.find(l => l.ch === 'x')?.fundo).toBeDefined()
    }
    // empresa: no notebook — código subindo trabalhando, fumacinha do café parado
    const simbolos = ['{', '}', '<', '/', '>', ';', '0', '1', '=', '(', ')']
    expect(letras(desenhar('empresa', 'feliz', 0.5, true)).some(ch => simbolos.includes(ch))).toBe(true)
    expect(letras(desenhar('empresa', 'feliz', 0, false))).toContain('~')
    // ...e o código sobe dos dois lados do notebook, em todo quadro
    for (let q = 0; q < 32; q++) {
      const cols = desenhar('empresa', 'feliz', q / 8, true).letras.filter(l => simbolos.includes(l.ch)).map(l => l.col)
      expect(cols.some(c => c < 2)).toBe(true)
      expect(cols.some(c => c > 14)).toBe(true)
    }
    // pessoal: dancinha com olhos felizes (^) e brilhinhos
    expect(letras(desenhar('pessoal', 'feliz', 0, true))).toEqual(expect.arrayContaining(['^', '*'])) // no chão; no ar o olho vira pixel
    // barras: uma célula por coluna, meio cheia em 50%
    const barra = barraCelulas(50, [90, 169, 240], 10)
    expect(barra.length).toBe(10)
    expect(barra.slice(0, 5).every(c => c.ch === '▀' && c.frente !== '#3e3e48')).toBe(true)
    expect(barra[9]!.frente).toBe('#3e3e48')
    // com luz (trabalhando), uma faixa clara corre pela parte cheia; sem luz, ou sem barra, nada muda
    const brilho = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16)
    const acesa = (t: number) => barraCelulas(50, [90, 169, 240], 10, t)
    expect(acesa(0.5)).not.toEqual(acesa(1))
    expect(acesa(0.5).some((c, i) => brilho(c.frente) > brilho(barra[i]!.frente))).toBe(true)
    expect(barraCelulas(undefined, [90, 169, 240], 10, 0.5)).toEqual(barraCelulas(undefined, [90, 169, 240], 10))
  })
})

describe('troca de conta', () => {
  test('empresa em 96%: a mensagem nova é levada para a pessoal e a sessão sai', async ($, on) => {
    const w = montar(on, { conta: 'empresa', token: 'tok', rateLimits: [cinco(96)] })
    await iniciar($)

    const r = await $.prompt.submit(digitar('continua o deploy'))
    expect('drop' in r && r.drop).toContain('pessoal')

    const pedido = JSON.parse(w.arquivos.get(`${RAIZ}/troca/tok.json`) ?? '{}')
    expect(pedido).toMatchObject({ sessionId: 'sessao-1', de: 'empresa', para: 'pessoal', prompt: 'continua o deploy' })
    expect(pedido.inicio).toBe(AGORA - HORA)

    await w.relogio.advance(500)
    expect(w.comandos).toContain('exit')
    // a leitura ficou gravada para as outras sessões e para o claude-duo.ps1
    expect(JSON.parse(w.arquivos.get(`${RAIZ}/contas/empresa.json`) ?? '{}').cinco.pct).toBe(96)
  })

  test('não troca se a pessoal também está no limite', async ($, on) => {
    const w = montar(on, {
      conta: 'empresa',
      token: 'tok',
      rateLimits: [cinco(96)],
      arquivos: { [`${RAIZ}/contas/pessoal.json`]: leitura('pessoal', 98) },
    })
    await iniciar($)

    const r = await $.prompt.submit(digitar('oi'))
    expect('drop' in r).toBe(false)
    expect(w.arquivos.has(`${RAIZ}/troca/tok.json`)).toBe(false)
    expect(w.toasts.join(' ')).toContain('as duas contas estão no limite')
  })

  test('não troca se a janela da empresa já renovou', async ($, on) => {
    const w = montar(on, { conta: 'empresa', token: 'tok', rateLimits: [cinco(97, daqui(-5 * 60_000))] })
    await iniciar($)

    const r = await $.prompt.submit(digitar('oi'))
    expect('drop' in r).toBe(false)
    expect(w.arquivos.has(`${RAIZ}/troca/tok.json`)).toBe(false)
  })

  test('sessão aberta sem o claude-duo só avisa, não troca sozinha', async ($, on) => {
    const w = montar(on, { conta: 'empresa', rateLimits: [cinco(96)] })
    await iniciar($)

    const r = await $.prompt.submit(digitar('oi'))
    expect('drop' in r).toBe(false)
    expect(w.toasts.join(' ')).toContain('/trocar-conta')
    await w.relogio.advance(1_000)
    expect(w.comandos).not.toContain('exit')
  })

  test('empresa no limite ao fim da resposta: a sessão passa sozinha, sem esperar a próxima mensagem', async ($, on) => {
    const w = montar(on, { conta: 'empresa', token: 'tok', rateLimits: [cinco(96)] })
    await iniciar($)

    await $.turn.start({ text: 'roda a recoleta', turnId: 't1' })
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    await $.turn.complete(resposta('t1'))
    await w.relogio.advance(2_500)

    const pedido = JSON.parse(w.arquivos.get(`${RAIZ}/troca/tok.json`) ?? '{}')
    expect(pedido).toMatchObject({ sessionId: 'sessao-1', de: 'empresa', para: 'pessoal' })
    expect(pedido.prompt).toBeUndefined() // a resposta terminou inteira: nada a continuar
    expect(w.comandos).toContain('exit')
  })

  test('resposta cortada pelo limite: a pessoal continua de onde parou', async ($, on) => {
    const w = montar(on, { conta: 'empresa', token: 'tok', rateLimits: [cinco(100)] })
    await iniciar($)

    await $.turn.start({ text: 'oi', turnId: 't1' })
    await $.turn.complete({ ...resposta('t1'), reason: 'error' })
    await w.relogio.advance(2_500)

    expect(JSON.parse(w.arquivos.get(`${RAIZ}/troca/tok.json`) ?? '{}').prompt).toContain('Continue exatamente de onde parou')
  })

  test('com tarefa em segundo plano, a troca espera (sair agora a mataria) e o aviso diz isso', async ($, on) => {
    const w = montar(on, { conta: 'empresa', token: 'tok', rateLimits: [cinco(96)] })
    await iniciar($)

    await $.turn.start({ text: 'roda a recoleta', turnId: 't1' })
    await $.classic.Stop({
      stop_hook_active: false,
      background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'recoleta' }],
    })
    await $.turn.complete(resposta('t1'))
    await w.relogio.advance(2_500)

    expect(w.arquivos.has(`${RAIZ}/troca/tok.json`)).toBe(false)
    expect(w.comandos).not.toContain('exit')
    expect(w.toasts.join(' ')).toContain('segundo plano')

    // o segundo plano acabou e acordou a sessão: no fim desse turno ela troca
    await $.turn.start({ text: '<task-notification>', turnId: 't2' })
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    await $.turn.complete(resposta('t2'))
    await w.relogio.advance(2_500)
    expect(w.comandos).toContain('exit')
  })

  test('aberta sem o claude-duo, /trocar-conta abre a janela nova pelo script (nunca o wt.exe direto) e sai', async ($, on) => {
    const w = montar(on, { conta: 'empresa', rateLimits: [cinco(100)] })
    await iniciar($)

    const r = await $.command.run({
      command: 'trocar-conta',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 160 },
    })
    expect('text' in r && r.text).toContain('pessoal')

    const abrir = w.processos.find(a => a.includes('--abrir'))
    expect(abrir?.[0]).toBe('powershell.exe')
    expect(abrir?.[abrir.length - 1]).toBe('C:\\Users\\vini\\.duo-contas\\troca\\avulso-sessao-1.json')
    expect(w.processos.some(a => a[0] === 'wt.exe')).toBe(false)
    expect(JSON.parse(w.arquivos.get(`${RAIZ}/troca/avulso-sessao-1.json`) ?? '{}')).toMatchObject({ de: 'empresa', para: 'pessoal' })
    await w.relogio.advance(500)
    expect(w.comandos).toContain('exit')
  })

  test('na pessoal, a mensagem nova volta para a empresa quando ela tem folga', async ($, on) => {
    const w = montar(on, {
      conta: 'pessoal',
      token: 'tok',
      rateLimits: [cinco(40)],
      arquivos: { [`${RAIZ}/contas/empresa.json`]: leitura('empresa', 10) },
    })
    await iniciar($)

    const r = await $.prompt.submit(digitar('segue a recoleta'))
    expect('drop' in r && r.drop).toContain('volta para a conta empresa')
    expect(JSON.parse(w.arquivos.get(`${RAIZ}/troca/tok.json`) ?? '{}')).toMatchObject({
      de: 'pessoal',
      para: 'empresa',
      prompt: 'segue a recoleta',
    })
    await w.relogio.advance(500)
    expect(w.comandos).toContain('exit')
  })

  test('na pessoal, com segundo plano rodando, não volta (sair mataria a tarefa); nem com a empresa entre 80 e 95', async ($, on) => {
    const w = montar(on, {
      conta: 'pessoal',
      token: 'tok',
      rateLimits: [cinco(40)],
      arquivos: { [`${RAIZ}/contas/empresa.json`]: leitura('empresa', 10) },
    })
    await iniciar($)
    await $.turn.start({ text: 'roda a recoleta', turnId: 't1' })
    await $.classic.Stop({
      stop_hook_active: false,
      background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'recoleta' }],
    })
    await $.turn.complete(resposta('t1'))
    await w.relogio.advance(2_500)

    const r = await $.prompt.submit(digitar('e aí?'))
    expect('drop' in r).toBe(false)
    expect(w.arquivos.has(`${RAIZ}/troca/tok.json`)).toBe(false)
    expect(w.toasts.join(' ')).toContain('empresa com folga')

    // a recoleta acabou, mas a empresa subiu para 85%: ainda não é folga
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    w.arquivos.set(`${RAIZ}/contas/empresa.json`, JSON.stringify({ conta: 'empresa', cinco: { pct: 85, renova: daqui(HORA) }, em: AGORA + 60_000 }))
    const r2 = await $.prompt.submit(digitar('e agora?'))
    expect('drop' in r2).toBe(false)
  })

  test('o caso do teto: job rodando e a conta indo de 96% a 99% por outras sessões; o relógio troca mesmo assim e conta o que encerrou', async ($, on) => {
    const w = montar(on, { conta: 'empresa', token: 'tok', rateLimits: [cinco(96)] })
    await iniciar($)
    await $.turn.start({ text: 'roda a recoleta', turnId: 't1' })
    await $.classic.Stop({
      stop_hook_active: false,
      background_tasks: [
        { id: 'b1', type: 'shell', status: 'running', description: 'Recoleta dos 4 tenants', command: 'python -u retomar_recoleta.py webmotors isaac' },
      ],
    })
    await $.turn.complete(resposta('t1'))
    await w.relogio.advance(2_500)
    expect(w.arquivos.has(`${RAIZ}/troca/tok.json`)).toBe(false) // 96%: espera o job

    // outra sessão da empresa gasta e grava 99%
    w.arquivos.set(`${RAIZ}/contas/empresa.json`, JSON.stringify({ conta: 'empresa', cinco: { pct: 99, renova: daqui(HORA) }, em: AGORA + 60_000 }))
    await w.relogio.advance(30_000)

    const pedido = JSON.parse(w.arquivos.get(`${RAIZ}/troca/tok.json`) ?? '{}')
    expect(pedido).toMatchObject({ de: 'empresa', para: 'pessoal' })
    expect(pedido.tarefas).toEqual([{ tipo: 'shell', descricao: 'Recoleta dos 4 tenants', comando: 'python -u retomar_recoleta.py webmotors isaac' }])
    expect(pedido.prompt).toContain('a troca encerrou o que rodava em segundo plano')
    expect(pedido.prompt).toContain('retomar_recoleta.py')
    await w.relogio.advance(500)
    expect(w.comandos).toContain('exit')
    // e se o /exit ficar na fila, o claude-duo.ps1 --encerrar fecha o processo
    expect(w.processos.some(a => a.includes('--encerrar'))).toBe(true)
  })

  test('a resposta morre no limite (StopFailure) com a leitura ainda em 90% e um job rodando: troca na hora e continua de onde parou', async ($, on) => {
    const w = montar(on, { conta: 'empresa', token: 'tok', rateLimits: [cinco(90)] })
    await iniciar($)
    await $.turn.start({ text: 'roda a recoleta', turnId: 't1' })
    await $.classic.Stop({
      stop_hook_active: false,
      background_tasks: [{ id: 'b1', type: 'subagent', status: 'running', description: 'revisão do PR' }],
    })
    await $.turn.complete(resposta('t1'))
    await w.relogio.advance(2_500)
    expect(w.arquivos.has(`${RAIZ}/troca/tok.json`)).toBe(false)

    // o aviso do job acorda a sessão, e a resposta morre no limite
    await $.turn.start({ text: '<task-notification>', turnId: 't2' })
    await $.classic.StopFailure({ error: 'rate_limit' })
    await $.turn.complete({ ...resposta('t2'), reason: 'error' })
    await w.relogio.advance(2_500)

    const pedido = JSON.parse(w.arquivos.get(`${RAIZ}/troca/tok.json`) ?? '{}')
    expect(pedido).toMatchObject({ de: 'empresa', para: 'pessoal' })
    expect(pedido.prompt).toContain('Continue exatamente de onde parou')
    expect(pedido.prompt).toContain('subagent "revisão do PR"')
  })

  test('outro erro de API (não o limite) não é teto', async ($, on) => {
    const w = montar(on, { conta: 'empresa', token: 'tok', rateLimits: [cinco(90)] })
    await iniciar($)
    await $.turn.start({ text: 'oi', turnId: 't1' })
    await $.classic.StopFailure({ error: 'server_error' })
    await $.turn.complete({ ...resposta('t1'), reason: 'error' })
    await w.relogio.advance(2_500)
    expect(w.arquivos.has(`${RAIZ}/troca/tok.json`)).toBe(false)
  })

  test('parada no meio da resposta esperando a janela (100%): o relógio troca mesmo com a resposta em andamento', async ($, on) => {
    const w = montar(on, { conta: 'empresa', token: 'tok', rateLimits: [cinco(90)] })
    await iniciar($)
    await $.turn.start({ text: 'oi', turnId: 't1' }) // e nunca termina: "continuing automatically at..."
    w.arquivos.set(`${RAIZ}/contas/empresa.json`, JSON.stringify({ conta: 'empresa', cinco: { pct: 100, renova: daqui(HORA) }, em: AGORA + 60_000 }))
    await w.relogio.advance(30_000)

    expect(JSON.parse(w.arquivos.get(`${RAIZ}/troca/tok.json`) ?? '{}').prompt).toContain('Continue exatamente de onde parou')
  })

  test('sessão parada, sem nada rodando, no teto: o relógio não troca (levaria o rascunho); a próxima mensagem troca', async ($, on) => {
    const w = montar(on, { conta: 'empresa', token: 'tok', rateLimits: [cinco(99)] })
    await iniciar($)
    await w.relogio.advance(30_000)
    expect(w.arquivos.has(`${RAIZ}/troca/tok.json`)).toBe(false)

    const r = await $.prompt.submit(digitar('oi'))
    expect('drop' in r && r.drop).toContain('pessoal')
  })

  test('a sessão retomada manda a mensagem que ficou pendente', async ($, on) => {
    const pedido = { sessionId: 'sessao-1', de: 'empresa', para: 'pessoal', prompt: 'continua o deploy', motivo: 'x' }
    const w = montar(on, {
      conta: 'pessoal',
      token: 'tok2',
      arquivos: { [`${RAIZ}/retomar/tok2.json`]: '\uFEFF' + JSON.stringify(pedido) },
    })
    await iniciar($)
    await w.relogio.advance(2_000)

    expect(w.enviados).toEqual(['continua o deploy'])
    expect(JSON.parse(w.arquivos.get(`${RAIZ}/retomar/tok2.json`) ?? '{}').consumido).toBe(true)
  })
})

describe('acordar conta parada', () => {
  test('a conta sem janela de 5h ganha um "oi"; a que está rodando, não', async ($, on) => {
    const w = montar(on, { conta: 'empresa', rateLimits: [cinco(30)] })
    await iniciar($)
    await w.relogio.advance(5_000)
    await w.relogio.advance(1_000)

    const acordadas = w.processos.filter(a => a.includes('--acordar')).map(a => a[a.indexOf('--acordar') + 1])
    expect(acordadas).toEqual(['pessoal'])
    expect(w.toasts.join(' ')).toContain('conta pessoal acordada')

    // dentro da trava de 15 min, ninguém acorda de novo
    await w.relogio.advance(5 * 60_000)
    expect(w.processos.filter(a => a.includes('--acordar')).length).toBe(1)
  })

  test('não acorda quando outra sessão já está acordando', async ($, on) => {
    const w = montar(on, {
      conta: 'empresa',
      rateLimits: [cinco(30)],
      arquivos: { [`${RAIZ}/acordar/pessoal.json`]: JSON.stringify({ dono: 'outra', em: AGORA - 60_000 }) },
    })
    await iniciar($)
    await w.relogio.advance(6_000)

    expect(w.processos.filter(a => a.includes('--acordar'))).toEqual([])
  })
})

describe('painel dos bichinhos', () => {
  test('o Claudinho da outra conta dança quando ela trabalha em outra sessão', async ($, on) => {
    const w = montar(on, {
      conta: 'empresa',
      rateLimits: [cinco(40)],
      arquivos: {
        [`${RAIZ}/contas/pessoal.json`]: leitura('pessoal', 12),
        [`${RAIZ}/atividade/outra-sessao.json`]: JSON.stringify({ conta: 'pessoal', trabalhando: true, em: AGORA - 30_000 }),
      },
    })
    await iniciar($)
    await w.relogio.settle()

    const ui = await $.ui.mount({ plugin: 'duo-contas', surface: 'terminal', component: 'PromptHint', props: { ...DICA, isWorking: false }, viewport: TELA })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
    expect(textos).toContain('dançando') // a pessoal, trabalhando lá
    expect(textos).toContain('pausa pro café') // a empresa, parada aqui
    // e esta sessão marcou que não está trabalhando
    expect(JSON.parse(w.arquivos.get(`${RAIZ}/atividade/sessao-1.json`) ?? '{}')).toMatchObject({ conta: 'empresa', trabalhando: false })
    await ui.unmount()
  })

  test('embaixo do prompt: as duas contas, contexto, cache e RAM, com a dica do engine em cima', async ($, on) => {
    const w = montar(on, {
      conta: 'empresa',
      rateLimits: [cinco(62, daqui(3 * HORA + 20 * 60_000))],
      arquivos: { [`${RAIZ}/contas/pessoal.json`]: leitura('pessoal', 12) },
    })
    await iniciar($)
    await w.relogio.settle() // a leitura de RAM roda em segundo plano

    const ui = await $.ui.mount({ plugin: 'duo-contas', surface: 'terminal', component: 'PromptHint', props: DICA, viewport: TELA })
    const rasters = (await ui.findAll({ type: 'Raster' })).map(r => r.key)
    expect(rasters.sort()).toEqual(['bicho-empresa', 'bicho-pessoal']) // as barras são texto, só os bichinhos são pixels
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
    for (const esperado of ['? for shortcuts', 'empresa', 'pessoal', ' 62%', 'renova 15:20', ' 12%', 'codando', 'contexto', ' 31%', '62k/200k', 'cache', 'RAM', '13,6/16 GB']) {
      expect(textos).toContain(esperado)
    }
    await ui.unmount()

    // fora do terminal não há Raster: o mesmo painel em texto
    const desk = await $.ui.mount({ plugin: 'duo-contas', surface: 'desktop', component: 'PromptHint', props: DICA, viewport: TELA })
    expect((await desk.findAll({ type: 'Raster' })).length).toBe(0)
    const textosDesk = (await desk.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
    for (const esperado of ['empresa', 'pessoal', ' 62%', 'contexto', 'RAM']) expect(textosDesk).toContain(esperado)
    await desk.unmount()
  })

  test('trabalhando, a luz corre nas barras desta conta e do contexto; as da outra conta e a RAM ficam paradas', async ($, on) => {
    const w = montar(on, {
      conta: 'empresa',
      rateLimits: [cinco(62)],
      arquivos: { [`${RAIZ}/contas/pessoal.json`]: leitura('pessoal', 40) },
    })
    await iniciar($)
    await w.relogio.settle()

    const ui = await $.ui.mount({ plugin: 'duo-contas', surface: 'terminal', component: 'PromptHint', props: DICA, viewport: TELA })
    // as células das barras, na ordem: empresa 5h e 7d, pessoal 5h e 7d, contexto, RAM (10 cada)
    const barras = async () =>
      (await ui.findAll({ type: 'Text' })).filter(t => /^[▀▏▎▍▌▋▊▉]$/.test(t.text)).map(t => `${String(t.props['color'])}/${String(t.props['backgroundColor'])}`)
    const antes = await barras()
    expect(antes.length).toBe(60)
    await w.relogio.advance(500)
    expect(await barras()).toEqual(antes) // sem turno andando, o painel nem redesenha

    await $.turn.start({ text: 'oi', turnId: 't1' })
    await w.relogio.advance(500)
    const depois = await barras()
    const mudou = (de: number) => depois.slice(de, de + 10).join() !== antes.slice(de, de + 10).join()
    expect(mudou(0)).toBe(true) // 5h da empresa (a conta desta sessão)
    expect(mudou(20)).toBe(false) // 5h da pessoal
    expect(mudou(40)).toBe(true) // contexto
    expect(mudou(50)).toBe(false) // RAM
    await ui.unmount()
  })

  test('conta sem janela aparece parada, como o "--" do claude-hud', async ($, on) => {
    montar(on, { conta: 'empresa', rateLimits: [cinco(40)] })
    await iniciar($)

    const ui = await $.ui.mount({ plugin: 'duo-contas', surface: 'terminal', component: 'PromptHint', props: DICA, viewport: TELA })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(textos).toContain('sem janela ativa')
    expect(textos).toContain('dormindo')
    await ui.unmount()
  })

  test('com /bichinhos acima, o painel sobe e a linha de dicas volta a ser do engine', async ($, on) => {
    montar(on, { conta: 'empresa', rateLimits: [cinco(62)], guardado: { modo: 'acima' } })
    // o que o engine desenharia sozinho em cada lugar
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, `engine ${e.component}`) as RenderElement
    })
    await iniciar($)

    const acima = await $.ui.mount({ plugin: 'duo-contas', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect(await acima.find({ text: /contexto/ })).toBeDefined()
    await acima.unmount()

    const abaixo = await $.ui.mount({ plugin: 'duo-contas', surface: 'terminal', component: 'PromptHint', props: DICA })
    expect(await abaixo.find({ text: /engine PromptHint/ })).toBeDefined()
    await abaixo.unmount()
  })
})

/** Onde estão as gotas de suor do quadro: [x, y] de cada pixel delas. */
const gotas = (q: Quadro) =>
  q.px.flatMap((c, i) => (c && (c.join() === SUOR.join() || c.join() === SUOR_BRILHO.join()) ? [[i % q.colunas, Math.floor(i / q.colunas)] as const] : []))
/** A primeira linha com pixel (o topo da cabeça) entre as colunas [de, ate). */
const topo = (q: Quadro, de: number, ate: number) => {
  for (let y = 0; y < LINHAS * 2; y++) for (let x = de; x < ate; x++) if (q.px[y * q.colunas + x]) return y
  return -1
}
const marca = (conta: string, trabalhando: boolean, em = AGORA - 30_000) => JSON.stringify({ conta, trabalhando, em })

describe('vários Claudinhos: um por sessão', () => {
  test('a gota de suor escorre no rosto (dentro do corpo), nunca solta no ar nem em cima da tampa', async () => {
    for (const c of ['empresa', 'pessoal'] as const) {
      for (const [estado, trab] of [['apertado', true], ['apertado', false], ['exausto', false]] as const) {
        for (let q = 0; q < 12; q++) {
          const px = gotas(desenhar(c, estado, q / 8, trab))
          expect(px.length).toBeGreaterThan(0)
          // o corpo vai da coluna 4 à 12; a gota fica na têmpora, a beirada direita do rosto
          for (const [x, y] of px) {
            expect(x).toBe(12)
            if (c === 'empresa') expect(y).toBeLessThan(estado === 'exausto' ? 6 : 5) // acima da tampa do notebook
          }
        }
      }
    }
    // no grupo também: cada gota cai dentro do corpo do seu Claudinho
    const g = desenharGrupo('pessoal', 'apertado', 0.3, [{ trabalhando: true }, { trabalhando: false }], 'medio')
    expect(gotas(g).length).toBeGreaterThan(0)
    for (const [x] of gotas(g)) expect(x % 10).toBe(7)
  })

  test('o notebook acende o rosto do Claudinho (a luz da tela)', async () => {
    const [r, , b] = desenhar('empresa', 'feliz', 0, true).px[3 * COLUNAS + 7]! // um pixel do rosto, acima da tampa
    expect(b - r).toBeGreaterThan(-125) // tingido de azul (o coral puro tem b - r = -130)...
    expect(b - r).toBeLessThan(-80) // ...mas ainda coral: luz forte acinzentava o rosto e ele sumia na tampa
    const [r2, , b2] = desenhar('pessoal', 'feliz', 0, false).px[3 * COLUNAS + 7]!
    expect(b2 - r2).toBeLessThan(-125) // sem notebook, sem luz
  })

  test('o notebook não se mistura com o Claudinho: a borda da tampa é bem mais escura que o rosto logo acima', async () => {
    const claridade = ([r, g, b]: readonly [number, number, number]) => r * 0.3 + g * 0.59 + b * 0.11
    // acordado a tampa começa na linha 5; com a cabeça caída (dormindo, exausto), na 6
    for (const [estado, trab, topo] of [['feliz', false, 5], ['feliz', true, 5], ['apertado', true, 5], ['dormindo', false, 6], ['exausto', false, 6]] as const) {
      const q = desenhar('empresa', estado, 0.3, trab)
      for (const x of [5, 6, 10]) {
        const rosto = q.px[(topo - 1) * COLUNAS + x]!
        const borda = q.px[topo * COLUNAS + x]!
        expect(claridade(rosto) - claridade(borda)).toBeGreaterThan(70)
      }
    }
  })

  test('a sessão desta janela ganha uma setinha em cima da cabeça, não uma faixa no chão (parecia reflexo)', async () => {
    for (const conta of ['pessoal', 'empresa'] as const) {
      for (const tamanho of ['medio', 'mini'] as const) {
        const passo = tamanho === 'medio' ? 10 : 6
        const g = desenharGrupo(conta, 'feliz', 0.25, [{ trabalhando: false }, { trabalhando: true, aqui: true }, { trabalhando: false }], tamanho)
        const setas = g.letras.filter(l => l.ch === 'v')
        expect(setas.length).toBe(1)
        expect(Math.floor(setas[0]!.col / passo)).toBe(1) // em cima do segundo, o desta janela
        expect(celulas(g)).not.toBe(celulas(desenharGrupo(conta, 'feliz', 0.25, [{ trabalhando: false }, { trabalhando: true }, { trabalhando: false }], tamanho)))
      }
      // sem a sessão desta janela no grupo, ninguém ganha seta; e nada é pintado abaixo dos pés
      const semAqui = desenharGrupo(conta, 'feliz', 0, [{ trabalhando: false }, { trabalhando: false }], 'medio')
      expect(semAqui.letras.some(l => l.ch === 'v')).toBe(false)
      const comAqui = desenharGrupo(conta, 'feliz', 0, [{ trabalhando: false, aqui: true }, { trabalhando: false }], 'medio')
      expect(comAqui.px.filter(p => p !== null).length).toBe(semAqui.px.filter(p => p !== null).length)
    }
  })

  test('quantos e de que tamanho: uma sessão é a cena inteira; mais sessões encolhem até caber', async () => {
    expect(arranjo(1, 40)).toEqual({ tamanho: 'cena', mostrados: 1, colunas: 20, filhotes: 0 })
    expect(arranjo(2, 40)).toEqual({ tamanho: 'medio', mostrados: 2, colunas: 20, filhotes: 0 })
    expect(arranjo(3, 40)).toEqual({ tamanho: 'medio', mostrados: 3, colunas: 30, filhotes: 0 })
    expect(arranjo(4, 40)).toEqual({ tamanho: 'mini', mostrados: 4, colunas: 24, filhotes: 0 })
    expect(arranjo(9, 40)).toEqual({ tamanho: 'mini', mostrados: 5, colunas: 30, filhotes: 0 }) // o teto: 30 colunas
    expect(arranjo(3, 10)).toEqual({ tamanho: 'mini', mostrados: 3, colunas: 18, filhotes: 0 }) // tela estreita: nunca menos de 20
  })

  test('dois Claudinhos trabalhando dançam juntos: pulam no mesmo quadro, espelhados', async () => {
    const dois = [{ trabalhando: true }, { trabalhando: true }]
    let espelhados = 0
    for (let q = 0; q < 16; q++) {
      const g = desenharGrupo('pessoal', 'feliz', q / 8, dois, 'medio')
      expect(g.colunas).toBe(20)
      expect(topo(g, 0, 10)).toBe(topo(g, 10, 20)) // o mesmo pulo
      // o segundo não é cópia do primeiro: um levanta o braço esquerdo enquanto o outro levanta o direito
      const primeiro = g.px.filter((_, i) => i % 20 < 10).map(c => c?.join() ?? '')
      const segundo = g.px.filter((_, i) => i % 20 >= 10).map(c => c?.join() ?? '')
      if (primeiro.join('|') !== segundo.join('|')) espelhados++
    }
    expect(espelhados).toBeGreaterThan(0)
    // um parado no meio de quem dança fica no chão
    const misto = desenharGrupo('pessoal', 'feliz', 0.25, [{ trabalhando: true }, { trabalhando: false }], 'medio')
    expect(topo(misto, 0, 10)).toBeLessThan(topo(misto, 10, 20))
  })

  test('duas sessões pessoais trabalhando: o painel mostra os dois Claudinhos e a contagem', async ($, on) => {
    const w = montar(on, {
      conta: 'empresa',
      rateLimits: [cinco(40)],
      arquivos: {
        [`${RAIZ}/contas/pessoal.json`]: leitura('pessoal', 12),
        [`${RAIZ}/atividade/p1.json`]: marca('pessoal', true),
        [`${RAIZ}/atividade/p2.json`]: marca('pessoal', true),
      },
    })
    await iniciar($)
    await w.relogio.settle()

    const ui = await $.ui.mount({ plugin: 'duo-contas', surface: 'terminal', component: 'PromptHint', props: { ...DICA, isWorking: false }, viewport: TELA })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
    expect(textos).toContain('2 sessões · 2 dançando')
    expect(textos).toContain('pausa pro café') // a empresa, só esta sessão, parada
    await w.relogio.advance(500)
    const doPessoal = w.blits.filter(b => b.key === 'bicho-pessoal')
    expect(doPessoal.length).toBeGreaterThan(0) // dançando: um quadro novo a cada passo
    expect(doPessoal.every(b => b.columns === 20)).toBe(true)
    await ui.unmount()
  })

  test('três sessões na empresa: o Raster alarga; numa tela estreita, elas viram minis; sessão fechada ou sumida sai', async ($, on) => {
    const w = montar(on, {
      conta: 'empresa',
      rateLimits: [cinco(40)],
      arquivos: {
        [`${RAIZ}/atividade/e1.json`]: marca('empresa', true),
        [`${RAIZ}/atividade/e2.json`]: marca('empresa', false),
        [`${RAIZ}/atividade/fechada.json`]: JSON.stringify({ conta: 'empresa', trabalhando: false, em: AGORA - 30_000, fim: true }),
        [`${RAIZ}/atividade/sumida.json`]: marca('empresa', true, AGORA - 5 * 60_000),
      },
    })
    await iniciar($)
    await w.relogio.settle()

    const largo = await $.ui.mount({ plugin: 'duo-contas', surface: 'terminal', component: 'PromptHint', props: { ...DICA, isWorking: false }, viewport: TELA })
    const rasterLargo = (await largo.findAll({ type: 'Raster' })).find(r => r.key === 'bicho-empresa')
    expect(rasterLargo?.props['columns']).toBe(30)
    expect((await largo.findAll({ type: 'Text' })).map(t => t.text).join(' | ')).toContain('3 sessões · 1 codando')
    await largo.unmount()

    const estreito = await $.ui.mount({
      plugin: 'duo-contas',
      surface: 'terminal',
      component: 'PromptHint',
      props: { ...DICA, isWorking: false },
      viewport: { columns: 100, rows: 40 },
    })
    const rasterEstreito = (await estreito.findAll({ type: 'Raster' })).find(r => r.key === 'bicho-empresa')
    expect(rasterEstreito?.props['columns']).toBe(18)
    await estreito.unmount()
  })
})

describe('agentes: os filhotes', () => {
  const marcaDe = (w: { arquivos: Map<string, string> }) => JSON.parse(w.arquivos.get(`${RAIZ}/atividade/sessao-1.json`) ?? '{}')

  test('agente começa e termina: a contagem vem do $.agent.list, vai para a marca de atividade e nada fica preso', async ($, on) => {
    const w = montar(on, { conta: 'pessoal', rateLimits: [cinco(30)] })
    await iniciar($)
    await w.relogio.settle()
    expect(marcaDe(w).agentes).toBe(0)

    // dois rodando e um teammate esperando mensagem (idle não conta)
    w.agentes.push({ id: 'a1', status: 'running' }, { id: 'a2', status: 'waiting' }, { id: 't1', status: 'idle' })
    await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'general-purpose' })
    await w.relogio.settle()
    expect(marcaDe(w).agentes).toBe(2)

    // um terminou; o outro sumiu da lista sem SubagentStop: a leitura de cada segundo zera os dois
    w.agentes.splice(0, w.agentes.length, { id: 'a1', status: 'completed' })
    await w.relogio.advance(1_100)
    expect(marcaDe(w).agentes).toBe(0)
  })

  test('a outra sessão com agentes: o painel desta lê a contagem da marca dela', async ($, on) => {
    const w = montar(on, {
      conta: 'empresa',
      rateLimits: [cinco(40)],
      arquivos: {
        [`${RAIZ}/contas/pessoal.json`]: leitura('pessoal', 12),
        [`${RAIZ}/atividade/outra.json`]: JSON.stringify({ conta: 'pessoal', trabalhando: false, agentes: 2, em: AGORA - 20_000 }),
      },
    })
    await iniciar($)
    await w.relogio.settle()
    const ui = await $.ui.mount({ plugin: 'duo-contas', surface: 'terminal', component: 'PromptHint', props: { ...DICA, isWorking: false }, viewport: TELA })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
    expect(textos).toContain('de olho em 2 agentes')
    const raster = (await ui.findAll({ type: 'Raster' })).find(r => r.key === 'bicho-pessoal')
    expect(raster?.props['columns']).toBe(27) // a cena com dois filhotes
    await ui.unmount()
  })

  test('nesta sessão: parado é "de olho em", trabalhando é "com"; a cena alarga um filhote por agente', async ($, on) => {
    const w = montar(on, { conta: 'pessoal', rateLimits: [cinco(30)], agentes: [{ id: 'a1', status: 'running' }, { id: 'a2', status: 'running' }] })
    await iniciar($)
    await w.relogio.settle()
    for (const [trab, esperado] of [[false, 'de olho em 2 agentes'], [true, 'dançando com 2 agentes']] as const) {
      const ui = await $.ui.mount({ plugin: 'duo-contas', surface: 'terminal', component: 'PromptHint', props: { ...DICA, isWorking: trab }, viewport: TELA })
      const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
      expect(textos).toContain(esperado)
      expect((await ui.findAll({ type: 'Raster' })).find(r => r.key === 'bicho-pessoal')?.props['columns']).toBe(27)
      await ui.unmount()
    }
    // fora do terminal, o texto conta os agentes
    const desk = await $.ui.mount({ plugin: 'duo-contas', surface: 'desktop', component: 'PromptHint', props: DICA, viewport: TELA })
    expect((await desk.findAll({ type: 'Text' })).map(t => t.text).join(' | ')).toContain('2 agentes')
    await desk.unmount()
  })

  test('com agentes, os filhotes aparecem à direita; trabalhando junto e supervisionando são quadros diferentes', async () => {
    for (const conta of ['empresa', 'pessoal'] as const) {
      expect(desenhar(conta, 'feliz', 0.25, true, 0).colunas).toBe(20)
      for (const [n, colunas] of [[1, 21], [2, 27], [3, 33]] as const) {
        const q = desenhar(conta, 'feliz', 0.25, true, n)
        expect(q.colunas).toBe(colunas)
        // cada filhote tem pixels na sua faixa (16-20, 22-26, 28-32)
        for (let i = 0; i < n; i++) expect(q.px.some((p, k) => p !== null && k % q.colunas >= 16 + 6 * i && k % q.colunas <= 20 + 6 * i)).toBe(true)
      }
      expect(celulas(desenhar(conta, 'feliz', 0.25, true, 1))).not.toBe(celulas(desenhar(conta, 'feliz', 0.25, false, 1)))
    }
    // empresa: cada filhote no seu notebookzinho (a base prateada embaixo dele)
    const e = desenhar('empresa', 'feliz', 0.25, true, 1)
    expect(e.px[(LINHAS * 2 - 1) * e.colunas + 18]).not.toBeNull()
    // e, supervisionando, a canequinha do chefe vai para a esquerda
    const chefe = desenhar('empresa', 'feliz', 0.25, false, 1)
    expect(chefe.px[8 * chefe.colunas + 0]).not.toBeNull()
  })

  test('na pessoal, trabalhando junto os filhotes pulam no compasso do principal (a conga); supervisionando, cada um no seu', async () => {
    let foraDeCompasso = 0
    for (let q = 0; q < 16; q++) {
      const junto = desenhar('pessoal', 'feliz', q / 8, true, 2)
      const principalNoAr = topo(junto, 0, 15) === 0
      expect(topo(junto, 16, 21) === 4).toBe(principalNoAr)
      expect(topo(junto, 22, 27)).toBe(topo(junto, 16, 21))
      const chefe = desenhar('pessoal', 'feliz', q / 8, false, 2)
      expect(topo(chefe, 0, 15)).toBe(1) // o principal parado, no chão
      if (topo(chefe, 16, 21) !== topo(chefe, 22, 27)) foraDeCompasso++
    }
    expect(foraDeCompasso).toBeGreaterThan(0)
  })

  test('parado com agentes, os olhos do principal vão para os filhotes (à direita)', async () => {
    const escuro = (q: Quadro, x: number, y: number) => {
      const p = q.px[y * q.colunas + x]
      return p !== null && p !== undefined && p[0] + p[1] + p[2] < 120
    }
    for (const conta of ['empresa', 'pessoal'] as const) {
      const t = 10 / 8 // um quadro em que, sem agentes, ele olha para a frente
      const sem = desenhar(conta, 'feliz', t, false, 0)
      const com = desenhar(conta, 'feliz', t, false, 2)
      expect(escuro(sem, 6, 2) && escuro(sem, 10, 2)).toBe(true)
      expect(escuro(com, 7, 2) && escuro(com, 11, 2)).toBe(true)
      expect(escuro(com, 6, 2)).toBe(false)
    }
  })

  test('nos grupos, quem tem agente leva um filhotinho ao lado, e o arranjo conta a largura dele', async () => {
    const membros = [{ trabalhando: true, aqui: true, agentes: 2 }, { trabalhando: false }]
    expect(arranjo(2, 40, membros)).toMatchObject({ tamanho: 'medio', mostrados: 2, colunas: 25 })
    const g = desenharGrupo('pessoal', 'feliz', 0.25, membros, 'medio')
    expect(g.colunas).toBe(25)
    expect(g.px.some((p, k) => p !== null && k % 25 >= 10 && k % 25 <= 13)).toBe(true) // o filhotinho entre os dois
    // a cena: até 3 filhotes, e só os que cabem na tela
    expect(arranjo(1, 40, [{ trabalhando: true, agentes: 5 }])).toEqual({ tamanho: 'cena', mostrados: 1, colunas: 33, filhotes: 3 })
    expect(arranjo(1, 28, [{ trabalhando: true, agentes: 3 }])).toMatchObject({ colunas: 27, filhotes: 2 })
    expect(arranjo(1, 20, [{ trabalhando: true, agentes: 2 }])).toMatchObject({ colunas: 20, filhotes: 0 })
  })
})

describe('abas do terminal do VS Code', () => {
  const ABAS = (abas: { pos: number; pid: number | null }[]) => JSON.stringify({ em: AGORA, janela: 'exemplo', abas })
  const SESSOES = 'C:/Users/vini/.claude/sessions'
  const sessao = (pid: number, sessionId: string) => JSON.stringify({ pid, sessionId, procStart: `${pid}0`, kind: 'interactive' })
  /** A coluna da setinha "v" no Raster (as células são [caractere, frente, fundo] u32, em base64). */
  const colunaDaSetinha = (r: { props: Record<string, unknown> }) => {
    const colunas = r.props['columns'] as number
    const bytes = Uint8Array.from(atob(r.props['cells'] as string), ch => ch.charCodeAt(0))
    const palavras = new Uint32Array(bytes.buffer)
    for (let i = 0; i * 3 < palavras.length; i++) if (palavras[i * 3] === 0x76) return i % colunas
    return -1
  }

  test('a ordem: a das abas; sem aba conhecida vai para o fim, e entre esses o desta janela primeiro', async () => {
    const aba: Record<string, number> = { a: 3, b: 1, c: 2 }
    const de = (ids: string[], aqui: string) => ordenarPorAba(ids, x => aba[x], x => x === aqui)
    expect(de(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a'])
    expect(de(['x', 'a', 'y', 'b'], 'y')).toEqual(['b', 'a', 'y', 'x'])
    expect(de(['x', 'y'], 'y')).toEqual(['y', 'x']) // fora do VS Code: como antes das abas
  })

  test('na terceira aba, o Claudinho desta janela é o terceiro, com a setinha; mudou de aba, ele acompanha', async ($, on) => {
    const w = montar(on, {
      conta: 'pessoal',
      rateLimits: [cinco(20)],
      // as outras duas sessões rodam um mod antigo: nada nas marcas delas diz a aba
      pais: { '11': [1001, 50], '22': [1002, 50], '33': [1003, 50] },
      arquivos: {
        [`${RAIZ}/atividade/p1.json`]: marca('pessoal', false),
        [`${RAIZ}/atividade/p2.json`]: marca('pessoal', false),
        [`${SESSOES}/11.json`]: sessao(11, 'p1'),
        [`${SESSOES}/22.json`]: sessao(22, 'p2'),
        [`${SESSOES}/33.json`]: sessao(33, 'sessao-1'),
        [`${SESSOES}/33.d2cd0b7e.key`]: 'segredo', // as chaves das sessões não são lidas
        [`${RAIZ}/abas/777.json`]: ABAS([{ pos: 1, pid: 1001 }, { pos: 2, pid: 1002 }, { pos: 3, pid: 1003 }]),
      },
    })
    await iniciar($)
    await w.relogio.settle()

    const abrir = async () => {
      const ui = await $.ui.mount({ plugin: 'duo-contas', surface: 'terminal', component: 'PromptHint', props: { ...DICA, isWorking: false }, viewport: TELA })
      const r = (await ui.findAll({ type: 'Raster' })).find(x => x.key === 'bicho-pessoal')!
      const col = colunaDaSetinha(r)
      const colunas = r.props['columns'] as number
      await ui.unmount()
      return { col, colunas }
    }
    const t1 = await abrir()
    expect(t1.col).toBeGreaterThan((t1.colunas * 2) / 3) // o terceiro dos três

    // uma consulta só aos processos, para os três; a resposta fica para as outras sessões
    expect(w.processos.filter(a => a.includes('--pais'))).toEqual([expect.arrayContaining(['--pais', '11,22,33'])])
    expect(JSON.parse(w.arquivos.get(`${RAIZ}/pais.json`) ?? '{}')).toEqual({ '11:110': [1001, 50], '22:220': [1002, 50], '33:330': [1003, 50] })

    // arrastou a aba desta sessão para o começo: no relógio seguinte ela vira a primeira, sem consultar processo de novo
    w.arquivos.set(`${RAIZ}/abas/777.json`, ABAS([{ pos: 1, pid: 1003 }, { pos: 2, pid: 1001 }, { pos: 3, pid: 1002 }]))
    await w.relogio.advance(30_000)
    const t2 = await abrir()
    expect(t2.col).toBeLessThan(t2.colunas / 3)
    expect(w.processos.filter(a => a.includes('--pais')).length).toBe(1)
  })

  test('/resume de outra conversa na mesma aba: a marca passa para o id novo e a aba continua sendo reconhecida', async ($, on) => {
    const w = montar(on, {
      conta: 'empresa',
      rateLimits: [cinco(20)],
      pais: { '44': [1004, 50] },
      arquivos: { [`${RAIZ}/abas/777.json`]: ABAS([{ pos: 1, pid: 1004 }]) },
    })
    await iniciar($)
    await w.relogio.settle()
    expect(JSON.parse(w.arquivos.get(`${RAIZ}/atividade/sessao-1.json`) ?? '{}').fim).toBeUndefined()

    // a aba agora roda outra conversa: o Claude regrava o sessions/<pid>.json com o id dela
    w.sessao.id = 'retomada'
    w.arquivos.set('C:/Users/vini/.claude-empresa/sessions/44.json', sessao(44, 'retomada'))
    await w.relogio.advance(30_000)
    expect(JSON.parse(w.arquivos.get(`${RAIZ}/atividade/sessao-1.json`) ?? '{}').fim).toBe(true) // a antiga sai do painel
    expect(JSON.parse(w.arquivos.get(`${RAIZ}/atividade/retomada.json`) ?? '{}')).toMatchObject({ conta: 'empresa' })
    expect(w.processos.some(a => a.includes('--pais') && a.includes('44'))).toBe(true) // casou o processo da conversa nova
  })

  test('fechou a aba da outra conta: a sessão sai do painel já (não espera a marca vencer) e o Claudinho dela dorme', async ($, on) => {
    const w = montar(on, {
      conta: 'empresa',
      rateLimits: [cinco(20)],
      pais: { '11': [1001, 50], '33': [1003, 50] },
      arquivos: {
        [`${RAIZ}/contas/pessoal.json`]: leitura('pessoal', 30),
        [`${RAIZ}/atividade/p1.json`]: marca('pessoal', true, AGORA - 5_000),
        [`${SESSOES}/11.json`]: sessao(11, 'p1'),
        ['C:/Users/vini/.claude-empresa/sessions/33.json']: sessao(33, 'sessao-1'),
        [`${RAIZ}/abas/777.json`]: ABAS([{ pos: 1, pid: 1001 }, { pos: 2, pid: 1003 }]),
      },
    })
    await iniciar($)
    await w.relogio.settle()
    const legendas = async () => {
      const ui = await $.ui.mount({ plugin: 'duo-contas', surface: 'terminal', component: 'PromptHint', props: { ...DICA, isWorking: false }, viewport: TELA })
      const t = (await ui.findAll({ type: 'Text' })).map(x => x.text).join(' | ')
      await ui.unmount()
      return t
    }
    expect(await legendas()).toContain('dançando') // a pessoal trabalhando na aba 1

    // fechou a aba 1: o processo morre sem marcar fim, e a marca dela ainda parece viva
    w.arquivos.set(`${RAIZ}/abas/777.json`, ABAS([{ pos: 1, pid: 1003 }]))
    await w.relogio.advance(30_000)
    const depois = await legendas()
    expect(depois).not.toContain('dançando')
    expect(depois).toContain('dormindo') // conta sem sessão aberta dorme
  })

  test('conta sem sessão aberta dorme, menos no limite (os olhos de x avisam mais)', async ($, on) => {
    const w = montar(on, {
      conta: 'empresa',
      rateLimits: [cinco(20)],
      arquivos: { [`${RAIZ}/contas/pessoal.json`]: leitura('pessoal', 99) },
    })
    await iniciar($)
    await w.relogio.settle()
    const ui = await $.ui.mount({ plugin: 'duo-contas', surface: 'terminal', component: 'PromptHint', props: { ...DICA, isWorking: false }, viewport: TELA })
    const t = (await ui.findAll({ type: 'Text' })).map(x => x.text).join(' | ')
    await ui.unmount()
    expect(t).toContain('exausto')
    expect(t).not.toContain('dormindo')
  })

  const COMANDO = { command: 'trocar-conta', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 160 } }
  const naAba = (extensaoAtende: boolean) => ({
    conta: 'empresa' as const, // aberta sem o claude-duo: sem token
    rateLimits: [cinco(40)],
    extensaoAtende,
    pais: { '33': [1003, 50] },
    arquivos: {
      ['C:/Users/vini/.claude-empresa/sessions/33.json']: sessao(33, 'sessao-1'),
      [`${RAIZ}/abas/777.json`]: ABAS([{ pos: 1, pid: 1003 }]),
    },
  })

  test('/trocar-conta no VS Code: a extensão continua a conversa na MESMA aba, sem janela nova do terminal', async ($, on) => {
    const w = montar(on, naAba(true))
    await iniciar($)
    await w.relogio.settle()

    const r = await $.command.run(COMANDO)
    expect('text' in r && r.text).toContain('pessoal')
    expect(w.processos.some(a => a.includes('--abrir'))).toBe(false)
    const pedido = JSON.parse(w.arquivos.get(`${RAIZ}/abrir/sessao-1.aceito`) ?? '{}')
    expect(pedido).toMatchObject({ shell: 1003, claude: 33, pedido: 'C:\\Users\\vini\\.duo-contas\\troca\\avulso-sessao-1.json' })
    expect(pedido.script).toMatch(/claude-duo\.ps1$/)
    expect(JSON.parse(w.arquivos.get(`${RAIZ}/troca/avulso-sessao-1.json`) ?? '{}')).toMatchObject({ de: 'empresa', para: 'pessoal' })
    await w.relogio.advance(500)
    expect(w.comandos).toContain('exit')
  })

  test('/trocar-conta com a aba conhecida mas a extensão calada: cancela o pedido e abre a janela nova, como antes', async ($, on) => {
    const w = montar(on, naAba(false))
    await iniciar($)
    await w.relogio.settle()

    const indo = $.command.run(COMANDO)
    await w.relogio.advance(7_000)
    const r = await indo
    expect('text' in r && r.text).toContain('pessoal')
    expect(JSON.parse(w.arquivos.get(`${RAIZ}/abrir/sessao-1.json`) ?? '{}').cancelado).toBe(true)
    expect(w.processos.some(a => a.includes('--abrir'))).toBe(true)
  })

  test('sem a extensão (ou fora do VS Code): nenhum processo, e o desta janela primeiro como antes', async ($, on) => {
    const w = montar(on, {
      conta: 'pessoal',
      rateLimits: [cinco(20)],
      arquivos: { [`${RAIZ}/atividade/p1.json`]: marca('pessoal', false), [`${SESSOES}/33.json`]: sessao(33, 'sessao-1') },
    })
    await iniciar($)
    await w.relogio.advance(30_000)
    expect(w.processos.some(a => a.includes('--pais'))).toBe(false)
  })

  test('o Stop guarda o segundo plano no estado da sessão (o /reload-plugins zera as variáveis do mod, não o estado)', async ($, on) => {
    const w = montar(on, {
      conta: 'pessoal',
      token: 'tok',
      rateLimits: [cinco(40)],
      arquivos: { [`${RAIZ}/contas/empresa.json`]: leitura('empresa', 10) },
    })
    const gravados: unknown[] = []
    on('state.set', ($, e, next) => {
      if ((e as { key?: string }).key === 'segundoPlano') gravados.push((e as { value?: unknown }).value)
      return next(e)
    })
    await iniciar($)
    await $.turn.start({ text: 'roda a recoleta', turnId: 't1' })
    await $.classic.Stop({
      stop_hook_active: false,
      background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'Recoleta dos 4 tenants', command: 'python -u retomar_recoleta.py' }],
    })
    expect(gravados.at(-1)).toEqual([{ tipo: 'shell', descricao: 'Recoleta dos 4 tenants', comando: 'python -u retomar_recoleta.py' }])
    const r = await $.prompt.submit(digitar('e aí?'))
    expect('drop' in r).toBe(false) // a recoleta segura a volta para a empresa

    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    expect(gravados.at(-1)).toEqual([])
    expect(w.arquivos.has(`${RAIZ}/troca/tok.json`)).toBe(false)
  })
})
