export type Conta = 'empresa' | 'pessoal'

/** Uma janela de uso: percentual usado e quando renova (ISO 8601). */
export type Janela = { pct: number; renova?: string }

/** A última leitura de uma conta, gravada em ~/.duo-contas/contas/<conta>.json. */
export type Leitura = {
  conta: Conta
  cinco?: Janela
  sete?: Janela
  /** Quando foi lida (ms desde a época). */
  em: number
  limite?: number
}

export type Leituras = { empresa?: Leitura; pessoal?: Leitura }

/** Onde o painel dos bichinhos aparece: embaixo do prompt (no lugar do claude-hud), em cima, ou em lugar nenhum. */
export type Modo = 'abaixo' | 'acima' | 'oculto'

/** A janela de contexto desta sessão. */
export type Contexto = { pct?: number; tokens?: number; janela: number }

/** A RAM da máquina, lida por bin/ram.mjs e dividida entre as sessões em ~/.duo-contas/ram.json. */
export type Ram = { usado: number; total: number; em: number }

/** Uma sessão viva (pelas marcas em ~/.duo-contas/atividade): um Claudinho no painel; `agentes`, os subagentes rodando nela (os filhotes). */
export type SessaoViva = { id: string; trabalhando: boolean; agentes?: number }

/** O que a extensão duo-contas-abas grava em ~/.duo-contas/abas/<pid>.json: os terminais de uma janela do VS Code, na ordem. */
export type Abas = { em: number; janela?: string | null; abas: { pos: number; nome?: string; pid: number | null }[] }

/** As sessões vivas de cada conta, em ordem estável (pelo id). */
export type Sessoes = Record<Conta, SessaoViva[]>

/** O pedido de troca que o mod deixa para o script claude-duo.ps1. */
export type Pedido = {
  sessionId: string
  cwd: string
  de: Conta
  para: Conta
  prompt?: string
  motivo: string
  /** Quando a sessão começou (ms): as memórias mexidas desde então vão junto. */
  inicio: number
  criadoEm: string
  /** O que rodava em segundo plano e a troca encerrou (só na troca forçada, no teto). */
  tarefas?: Tarefa[]
}

/** Uma tarefa em segundo plano da sessão (shell, subagente, monitor), como o Stop a conta. */
export type Tarefa = { tipo: string; descricao: string; comando?: string }

declare module 'claude-code' {
  interface PluginState {
    'duo-contas': {
      leituras: Leituras
      modo: Modo
      /** Muda a cada 30 s: o painel redesenha "renova às", "cache até" e "visto há". */
      relogio: number
      contexto: Contexto | null
      /** Quando chegou a última resposta desta sessão (o cache vale a partir dela). */
      ultimaResposta: number | null
      ram: Ram | null
      aviso: string | null
      /** Muda a cada quadro (8 por segundo) enquanto a sessão trabalha: o painel redesenha a luz correndo nas barras. */
      luz: number
      /** As sessões vivas de cada conta: um Claudinho por sessão; muda quando uma abre, fecha, começa ou para de trabalhar. */
      sessoes: Sessoes
      /** Quantos subagentes desta sessão estão rodando agora (pelo $.agent.list): os filhotes ao lado do Claudinho. */
      agentes: number
      /** A aba do terminal do VS Code de cada sessão viva (sessionId -> 1, 2, 3...): os Claudinhos vão nessa ordem. */
      abas: Record<string, number>
      /** O segundo plano do último Stop: sobrevive ao /reload-plugins (as variáveis do mod, não). */
      segundoPlano: Tarefa[]
    }
  }
}
