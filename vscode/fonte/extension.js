// duo-contas-abas: a ponte entre o mod duo-contas do Claude Code e as abas do terminal do VS Code.
// 1. Grava em ~/.duo-contas/abas/<pid deste host de extensões>.json os terminais desta janela, na ordem,
//    com o processo (o shell) de cada um: o mod põe cada Claudinho na posição da aba dele.
// 2. Atende ~/.duo-contas/abrir/<sessão>.json: o /trocar-conta de uma sessão aberta sem o claude-duo pede
//    para a conversa continuar na outra conta NA MESMA ABA. A extensão espera aquele claude sair e digita,
//    no shell da aba, o claude-duo --retomar. (Sem a extensão, o mod abre uma janela nova do terminal.)
// Leve de propósito: roda dentro do host de extensões que já existe (nenhum processo novo), reage aos
// eventos de terminal e à pasta de pedidos, e confere a cada 5 s (arrastar aba não tem evento).
const vscode = require('vscode')
const fs = require('fs')
const os = require('os')
const path = require('path')

const raiz = path.join(os.homedir(), '.duo-contas')
const pasta = path.join(raiz, 'abas')
const pedidos = path.join(raiz, 'abrir')
const arquivo = path.join(pasta, `${process.pid}.json`)
let ultimo = ''
const atendendo = new Set()

/** Se o processo ainda existe (o arquivo de uma janela que fechou sem avisar fica para trás). */
function vivo(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

const esperar = ms => new Promise(r => setTimeout(r, ms))

/** O shell de um terminal; um terminal sem processo (de extensão) não segura a gravação. */
function shellDe(t) {
  return Promise.race([Promise.resolve(t.processId), esperar(1000).then(() => undefined)])
}

async function gravar() {
  const terminais = vscode.window.terminals
  const abas = []
  for (let i = 0; i < terminais.length; i++) {
    const pid = await shellDe(terminais[i])
    abas.push({ pos: i + 1, nome: terminais[i].name, pid: pid ?? null })
  }
  const texto = JSON.stringify(abas)
  if (texto === ultimo) return
  ultimo = texto
  fs.mkdirSync(pasta, { recursive: true })
  fs.writeFileSync(arquivo, JSON.stringify({ em: Date.now(), janela: vscode.workspace.name ?? null, abas }))
}

function limparAntigos() {
  if (!fs.existsSync(pasta)) return
  for (const nome of fs.readdirSync(pasta)) {
    const pid = Number(nome.replace(/\.json$/, ''))
    if (pid && pid !== process.pid && !vivo(pid)) fs.rmSync(path.join(pasta, nome), { force: true })
  }
}

/** Um argumento entre aspas duplas que vale no PowerShell, no cmd e no bash (caminhos do Windows). */
const aspas = s => `"${String(s).replace(/"/g, '')}"`

/**
 * Um pedido de retomar na mesma aba. Só a janela que tem a aba atende: ela o reserva renomeando para
 * `.aceito` (a primeira que renomear leva), espera o claude daquela aba sair (o /exit do mod; se ele
 * ficar na fila, o claude-duo --encerrar fecha o processo em 20 s) e digita o claude-duo --retomar no
 * shell da aba. No fim, `.feito` (ou `.falhou`, com o motivo).
 */
async function atender(nome) {
  const id = nome.replace(/\.json$/, '')
  if (atendendo.has(id)) return
  const json = path.join(pedidos, nome)
  let p
  try {
    p = JSON.parse(fs.readFileSync(json, 'utf8').replace(/^﻿/, ''))
  } catch {
    return // ainda sendo escrito, ou já levado por outra janela
  }
  if (p.cancelado) return
  const terminal = []
  for (const t of vscode.window.terminals) if ((await shellDe(t)) === p.shell) terminal.push(t)
  if (terminal.length === 0) return // a aba é de outra janela do VS Code
  const aceito = path.join(pedidos, `${id}.aceito`)
  try {
    fs.renameSync(json, aceito)
  } catch {
    return // outra janela levou
  }
  atendendo.add(id)
  const fim = (sufixo, dados) => {
    try {
      fs.writeFileSync(path.join(pedidos, `${id}.${sufixo}`), JSON.stringify({ ...p, ...dados, em: new Date().toISOString() }))
      fs.rmSync(aceito, { force: true })
    } catch {
      // só registro: falhou, o pedido fica .aceito
    }
    atendendo.delete(id)
  }
  // até 40 s para aquele claude sair (o vigia do mod o fecha em 20 s, se o /exit ficar na fila)
  for (let i = 0; i < 160 && p.claude && vivo(p.claude); i++) await esperar(250)
  if (p.claude && vivo(p.claude)) return fim('falhou', { motivo: 'o claude da aba não saiu em 40 s' })
  await esperar(600) // o prompt do shell volta
  const comando = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${aspas(p.script)} --retomar ${aspas(p.pedido)}`
  terminal[0].sendText(comando, true)
  fim('feito', {})
}

function olharPedidos() {
  if (!fs.existsSync(pedidos)) return
  for (const nome of fs.readdirSync(pedidos)) {
    if (nome.endsWith('.json')) atender(nome).catch(() => undefined)
  }
}

function activate(ctx) {
  const seguro = () => {
    gravar().catch(() => undefined)
  }
  try {
    limparAntigos()
  } catch {
    // limpeza é só higiene: falhou, segue
  }
  ctx.subscriptions.push(
    vscode.window.onDidOpenTerminal(seguro),
    vscode.window.onDidCloseTerminal(seguro),
    vscode.window.onDidChangeActiveTerminal(seguro),
  )
  // os pedidos chegam na hora pela pasta; o relógio de 5 s é a reserva (e o arraste de aba, que não tem evento)
  try {
    fs.mkdirSync(pedidos, { recursive: true })
    const vigia = fs.watch(pedidos, () => olharPedidos())
    ctx.subscriptions.push({ dispose: () => vigia.close() })
  } catch {
    // sem fs.watch, o relógio dá conta
  }
  const relogio = setInterval(() => {
    seguro()
    olharPedidos()
  }, 5000)
  ctx.subscriptions.push({
    dispose: () => {
      clearInterval(relogio)
      fs.rmSync(arquivo, { force: true })
    },
  })
  seguro()
  olharPedidos()
}

function deactivate() {}

module.exports = { activate, deactivate }
