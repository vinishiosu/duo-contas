import type { SessionRateLimit } from 'claude-code'

import type { Conta, Janela, Leitura, Leituras } from '../types'

export const OUTRA: Record<Conta, Conta> = { empresa: 'pessoal', pessoal: 'empresa' }

/** `CLAUDE_CONFIG_DIR` vazio ou `~/.claude` é a conta pessoal; qualquer outro (`~/.claude-empresa`), a empresa. */
export function contaDoConfigDir(dir: string | undefined): Conta {
  if (!dir) return 'pessoal'
  const nome = dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop()?.toLowerCase() ?? ''

  return nome === '.claude' ? 'pessoal' : 'empresa'
}

/** As janelas de 5h e de 7 dias do jeito que a resposta da API as informou. */
export function janelas(limits: readonly SessionRateLimit[]): Pick<Leitura, 'cinco' | 'sete'> {
  const pegar = (kind: string): Janela | undefined => {
    const w = limits.find(l => l.kind === kind)

    return w ? { pct: w.percentUsed, ...(w.resetsAt ? { renova: w.resetsAt } : {}) } : undefined
  }

  return { cinco: pegar('five_hour'), sete: pegar('seven_day') }
}

/** O uso da janela agora: 0 se ela já renovou desde a leitura. */
export function pctEfetivo(j: Janela | undefined, agora: number): number | undefined {
  if (!j) return undefined
  if (j.renova !== undefined && Date.parse(j.renova) <= agora) return 0

  return j.pct
}

/** Se a janela de 5h da conta está correndo agora (o "--" do claude-hud é o contrário). */
export function janelaAtiva(l: Leitura | undefined, agora: number): boolean {
  const renova = l?.cinco?.renova

  return renova !== undefined && Date.parse(renova) > agora
}

/** A janela mais apertada da conta (5h ou 7 dias): é ela que trava a conta. */
export function pressao(l: Leitura | undefined, agora: number): number | undefined {
  const cinco = pctEfetivo(l?.cinco, agora)
  const sete = pctEfetivo(l?.sete, agora)
  if (cinco === undefined) return sete
  if (sete === undefined) return cinco

  return Math.max(cinco, sete)
}

export type Situacao = 'livre' | 'trocar' | 'voltar' | 'ambas-no-limite'

/**
 * Se a sessão desta conta deve passar para a outra.
 * - `trocar`: esta conta bateu o limite e a outra tem folga (vale para as duas contas).
 * - `voltar`: a sessão está na pessoal e a empresa tem folga (abaixo de `volta`): a cota da
 *   empresa é a que se gasta primeiro. A folga entre `volta` (80) e `limite` (95) evita o vaivém:
 *   dentro de uma janela o uso só sobe, então a empresa só fica abaixo de 80 quando renova.
 */
export function situacao(conta: Conta, leituras: Leituras, limite: number, agora: number, volta = 80): Situacao {
  const minha = pressao(leituras[conta], agora)
  const outra = pressao(leituras[OUTRA[conta]], agora)
  if (minha !== undefined && minha >= limite) return outra !== undefined && outra >= limite ? 'ambas-no-limite' : 'trocar'
  if (conta === 'pessoal' && outra !== undefined && outra < volta) return 'voltar'

  return 'livre'
}

/**
 * O teto: daqui para cima a troca não espera o segundo plano (a conta vai travar de qualquer jeito
 * e a sessão congelaria até a janela renovar). `estourou` = uma resposta já morreu no limite.
 */
export function noTeto(conta: Conta, leituras: Leituras, limite: number, teto: number, agora: number, estourou = false): boolean {
  if (situacao(conta, estourou ? estourada(conta, leituras, agora) : leituras, limite, agora) !== 'trocar') return false

  return estourou || (pressao(leituras[conta], agora) ?? 0) >= teto
}

/**
 * As leituras com esta conta em 100%: a resposta morreu no limite, mesmo que a última leitura não
 * tenha chegado lá. A janela de 5h fica com a renovação que tinha (renovou, volta a valer zero) e a
 * de 7 dias fica como está.
 */
export function estourada(conta: Conta, leituras: Leituras, agora: number): Leituras {
  const l = leituras[conta]
  const renova = l?.cinco?.renova !== undefined && Date.parse(l.cinco.renova) > agora ? l.cinco.renova : undefined

  return { ...leituras, [conta]: { ...l, conta, cinco: { pct: 100, ...(renova ? { renova } : {}) }, em: l?.em ?? agora } }
}

/**
 * A ordem dos Claudinhos de uma conta: a das abas do terminal (quem não tem aba conhecida vai para o fim,
 * na ordem em que veio); entre os sem aba, o desta janela primeiro, como era antes das abas.
 */
export function ordenarPorAba<T>(itens: readonly T[], aba: (x: T) => number | undefined, aqui: (x: T) => boolean): T[] {
  const chave = (x: T) => aba(x) ?? Number.MAX_SAFE_INTEGER
  return [...itens].sort((a, b) => chave(a) - chave(b) || Number(aqui(b)) - Number(aqui(a)))
}

/** Uma tarefa em segundo plano que a troca encerrou, contada à sessão retomada. */
export function descreverTarefa(t: { tipo: string; descricao: string; comando?: string }): string {
  const corta = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s)
  const comando = t.comando ? ` (comando: ${corta(t.comando.replace(/\s+/g, ' '), 300)})` : ''

  return `- ${t.tipo} "${corta(t.descricao, 200)}"${comando}`
}

export type Humor = 'dormindo' | 'feliz' | 'ok' | 'apertado' | 'exausto'

export function humor(pct: number | undefined, limite: number): Humor {
  if (pct === undefined) return 'dormindo'
  if (pct >= limite) return 'exausto'
  if (pct >= Math.min(80, limite - 10)) return 'apertado'
  if (pct >= 50) return 'ok'

  return 'feliz'
}

export const LEGENDA: Record<Humor, string> = {
  dormindo: 'dormindo',
  feliz: 'de boa',
  ok: 'firme',
  apertado: 'apertando...',
  exausto: 'exausto',
}

export function barra(pct: number | undefined, largura = 10): string {
  if (pct === undefined) return '░'.repeat(largura)
  const cheio = Math.round((Math.min(100, Math.max(0, pct)) / 100) * largura)

  return '█'.repeat(cheio) + '░'.repeat(largura - cheio)
}

export function fmtPct(pct: number | undefined): string {
  return pct === undefined ? '  --' : `${String(Math.round(pct)).padStart(3)}%`
}

const BRASILIA = -3 * 3_600_000 // sem horário de verão desde 2019
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const dois = (n: number) => String(n).padStart(2, '0')

/** "15:20" no horário de Brasília, sem depender do fuso da máquina. */
export function horaBR(ms: number): string {
  const d = new Date(ms + BRASILIA)

  return `${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}`
}

/** "15:20" se for hoje (em Brasília), "sex 15:00" se for outro dia. */
export function quandoBR(iso: string | undefined, agora: number): string | undefined {
  if (iso === undefined) return undefined
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return undefined
  const dia = (t: number) => Math.floor((t + BRASILIA) / 86_400_000)
  if (dia(ms) === dia(agora)) return horaBR(ms)

  return `${DIAS[new Date(ms + BRASILIA).getUTCDay()]} ${horaBR(ms)}`
}

/** Quanto falta até `iso`: "35min", "2h10", "3d4h". */
export function emQuanto(iso: string | undefined, agora: number): string | undefined {
  if (iso === undefined) return undefined
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return undefined
  const min = Math.max(0, Math.round((t - agora) / 60_000))
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  if (h >= 24) return `${Math.floor(h / 24)}d${h % 24}h`
  const m = min % 60

  return m ? `${h}h${dois(m)}` : `${h}h`
}

/** Há quanto tempo foi `em`: "agora", "12min", "3h". */
export function haQuanto(em: number, agora: number): string {
  const min = Math.max(0, Math.round((agora - em) / 60_000))
  if (min < 2) return 'agora'
  if (min < 60) return `${min}min`

  return `${Math.floor(min / 60)}h`
}

/** 62000 → "62k", 1200000 → "1,2M". */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',').replace(/,0$/, '')}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`

  return String(n)
}

/** 14_600_000_000 → "13,6". */
export function fmtGB(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1).replace('.', ',').replace(/,0$/, '')
}

/** Lê o JSON que o PowerShell gravou (às vezes com BOM); undefined se não der. */
export function lerJson<T>(texto: string): T | undefined {
  try {
    return JSON.parse(texto.replace(/^﻿/, '')) as T
  } catch {
    return undefined
  }
}
