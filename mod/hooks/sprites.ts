// Os Claudinhos, em pixel art feita para o terminal: o mascote do Claude Code
// (▐▛███▜▌ / ▝▜█████▛▘ / ▘▘ ▝▝) redesenhado em 13x8 pixels, com luz e sombra, num Raster
// de COLUNAS x LINHAS células. Cada célula leva dois pixels (▀ com frente e
// fundo); letras de verdade entram por cima, nítidas: os olhos de expressão
// (^ - x o, com o fundo na cor do corpo), os "z", o código que sobe, a fumaça.
//
// Empresa: o Claudinho no notebook. Pessoal: o Claudinho normal.
// Com mais de uma sessão na conta, um Claudinho menor por sessão (desenharGrupo).
import type { Conta } from '../types'

export type Rgb = readonly [number, number, number]
export type Estado = 'dormindo' | 'feliz' | 'ok' | 'apertado' | 'exausto'

export const COLUNAS = 20
export const LINHAS = 5
const H = LINHAS * 2
/** Quadros por segundo da animação. */
export const FPS = 8

/** Um quadro: pixels em linhas (`null` = fundo do terminal), as letras por cima e a largura em colunas. */
export type Quadro = { px: (Rgb | null)[]; letras: Letra[]; colunas: number }
type Letra = { col: number; lin: number; ch: string; cor: Rgb; fundo?: Rgb }

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
const misturar = (a: Rgb, b: Rgb, t: number): Rgb => [
  clamp(a[0] + (b[0] - a[0]) * t),
  clamp(a[1] + (b[1] - a[1]) * t),
  clamp(a[2] + (b[2] - a[2]) * t),
]
const cinza = (c: Rgb): Rgb => {
  const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11
  return [l, l, l]
}

// a paleta do Claudinho (o coral do Claude) e do cenário
const CLARO: Rgb = [240, 156, 124]
const CORAL: Rgb = [217, 119, 87]
const ESCURO: Rgb = [172, 86, 58]
const OLHO: Rgb = [38, 22, 18]
const CANECA: Rgb = [236, 236, 242]
const CAFE: Rgb = [112, 70, 48]
export const SUOR: Rgb = [130, 200, 255]
export const SUOR_BRILHO: Rgb = [226, 244, 255]
const ZZZ: Rgb = [176, 192, 255]
const BRILHO: Rgb = [255, 226, 140]
const FUMACA: Rgb = [170, 174, 186]
const CODIGO: readonly Rgb[] = [[130, 200, 255], [196, 160, 255], [255, 196, 120], [140, 224, 170]]
/** A setinha em cima do Claudinho da sessão desta janela, quando a conta tem várias (como o "◀ aqui" do nome). */
const MARCA: Rgb = [240, 156, 124]

// o notebook: alumínio escuro (space gray) de costas para nós, base prateada, e a luz da tela no rosto.
// A borda de cima da tampa é ESCURA, o contorno que separa o notebook do Claudinho: com um aro
// cinza-claro (até a v0.8.1) os dois tinham a mesma claridade e se misturavam, pior ainda desbotado.
const TAMPA: Rgb = [92, 97, 113]
const TAMPA_BORDA: Rgb = [36, 38, 48]
const TAMPA_CLARA: Rgb = [118, 124, 140]
const TAMPA_ESCURA: Rgb = [70, 74, 88]
const DOBRADICA: Rgb = [52, 55, 66]
/** Quanto o Claudinho perde a cor sem cota: cansado, mas ainda coral (0,6 virava cinza e sumia no notebook). */
const DESBOTA_EXAUSTO = 0.45
const BASE: Rgb = [188, 192, 204]
const BASE_PONTA: Rgb = [138, 142, 156]
const LED_VERDE: Rgb = [110, 232, 140]
const LED_AMBAR: Rgb = [255, 176, 72]
const LED_VERMELHO: Rgb = [255, 84, 72]
const LED_APAGADO: Rgb = [96, 100, 112]
/** A luz azulada que a tela joga no rosto de quem está na frente dela. */
export const TELA_LUZ: Rgb = [160, 212, 255]

class Tela {
  colunas: number
  px: (Rgb | null)[]
  letras: Letra[] = []
  constructor(colunas: number = COLUNAS) {
    this.colunas = colunas
    this.px = new Array(colunas * H).fill(null)
  }
  p(x: number, y: number, c: Rgb) {
    if (x >= 0 && x < this.colunas && y >= 0 && y < H) this.px[y * this.colunas + x] = c
  }
  /** Uma letra na célula; `fundo` pinta a célula inteira por trás dela. */
  l(col: number, lin: number, ch: string, cor: Rgb, fundo?: Rgb) {
    if (col >= 0 && col < this.colunas && lin >= 0 && lin < LINHAS) this.letras.push({ col, lin, ch, cor, ...(fundo ? { fundo } : {}) })
  }
}

type Olhos = 'abertos' | 'fechados' | 'feliz' | 'x' | 'arregalados'
type Pose = {
  ox: number
  oy: number
  olhos: Olhos
  olhar?: -1 | 0 | 1
  /** Quanto cada braço sobe (-) ou desce (+) em relação ao meio do corpo; `null` = sem braço (o notebook desenha). */
  bracos?: [number, number] | null
  pernas?: 'paradas' | 'passo1' | 'passo2' | 'escondidas'
  /** 0..1: quanto perde a cor (no limite). */
  desbota?: number
  /** 0..1: quanto a tela do notebook ilumina o rosto (mais forte embaixo, perto da tampa). */
  tela?: number
}

/** A cor do corpo na linha `y` (a partir do topo `oy`): desbotada no limite, tingida pela luz da tela. */
function tom(p: Pick<Pose, 'oy' | 'desbota' | 'tela'>, altura: number) {
  const k = p.desbota ?? 0
  const luz = p.tela ?? 0
  return (c: Rgb, y: number): Rgb => {
    const d = k ? misturar(c, cinza(c), k) : c
    return luz ? misturar(d, TELA_LUZ, luz * (0.35 + 0.65 * Math.min(1, (y - p.oy) / altura))) : d
  }
}

const GLIFO: Partial<Record<Olhos, string>> = { feliz: '^', fechados: '-', x: 'x', arregalados: 'o' }

/**
 * O Claudinho, 13x8 pixels a partir de (ox, oy): corpo 9x6 com dois olhos, bracinhos
 * de 2 na altura do meio, quatro perninhas. Luz em cima à esquerda, sombra embaixo à direita.
 * Os olhos ficam nas linhas oy+1 e oy+2: com oy ímpar eles caem numa célula só e viram letra.
 */
function claudinho(tl: Tela, p: Pose) {
  const cor = tom(p, 5)
  const { ox, oy } = p
  for (let x = 2; x <= 10; x++) {
    tl.p(ox + x, oy, cor(CLARO, oy))
    for (const y of [1, 2, 3, 4]) tl.p(ox + x, oy + y, cor(x === 2 ? CLARO : x === 10 ? ESCURO : CORAL, oy + y))
    tl.p(ox + x, oy + 5, cor(ESCURO, oy + 5))
  }
  if (p.bracos !== null) {
    const [de, dd] = p.bracos ?? [0, 0]
    for (const [xs, d] of [[[0, 1], de], [[11, 12], dd]] as const) {
      for (const x of xs) {
        tl.p(ox + x, oy + 3 + d, cor(CORAL, oy + 3 + d))
        tl.p(ox + x, oy + 4 + d, cor(ESCURO, oy + 4 + d))
      }
    }
  }
  const pernas = p.pernas ?? 'paradas'
  if (pernas !== 'escondidas') {
    for (const [x, grupo] of [[3, 1], [5, 2], [7, 1], [9, 2]] as const) {
      const ergue = (pernas === 'passo1' && grupo === 1) || (pernas === 'passo2' && grupo === 2)
      tl.p(ox + x, oy + 6, cor(ESCURO, oy + 6))
      if (!ergue) tl.p(ox + x, oy + 7, cor(ESCURO, oy + 7))
    }
  }
  // olhos: pixel escuro quando abertos; letra de expressão quando a célula cabe certinho
  const ex = [4 + (p.olhar ?? 0), 8 + (p.olhar ?? 0)]
  const alinhado = (oy + 1) % 2 === 0
  for (const x of ex) {
    const g = GLIFO[p.olhos]
    if (g && alinhado) {
      tl.l(ox + x, (oy + 1) / 2, g, OLHO, cor(CORAL, oy + 1.5))
      continue
    }
    if (p.olhos === 'fechados' || p.olhos === 'feliz') tl.p(ox + x, oy + 2, OLHO)
    else {
      tl.p(ox + x, oy + 1, OLHO)
      tl.p(ox + x, oy + 2, OLHO)
    }
  }
}

/** Os "z" subindo na diagonal, do lado direito. */
function zzz(tl: Tela, f: number, col: number, lin: number) {
  const passo = Math.floor(f / 4) % 3
  tl.l(col + passo, lin - passo, passo === 0 ? 'z' : 'Z', misturar(ZZZ, [40, 40, 50], passo * 0.28))
}

/**
 * Uma gota de suor escorrendo pela têmpora (coluna `x`, a beirada direita do rosto), de `topo`
 * até `fundo`: dois pixels, o brilho em cima e o azul embaixo. Desenhada por último, por cima do corpo.
 */
function suor(tl: Tela, f: number, x: number, topo: number, fundo: number, pixels: 1 | 2 = 2) {
  const curso = Math.max(1, fundo - topo + (pixels === 1 ? 1 : 0))
  const y = topo + (Math.floor(f / 2) % curso)
  if (pixels === 1) return tl.p(x, y, SUOR)
  tl.p(x, y, SUOR_BRILHO)
  tl.p(x, y + 1, SUOR)
}

// --------------------------------------------------------- empresa: notebook

/** Onde começam o Claudinho e o notebook: duas colunas livres à esquerda, para o código subir dos dois lados. */
const OX = 2

type Notebook = {
  /** Primeira e última coluna da tampa (a base passa um pixel de cada lado). */
  de: number
  ate: number
  /** Linhas da tampa: a de cima é o aro, a de baixo a sombra da dobradiça; a base fica logo embaixo. */
  topo: number
  fundo: number
  /** 0..1: quanto o logo do Claude brilha na tampa. */
  logo: number
  led: Rgb
}

/** A tampa (de costas para nós, cantos redondos, logo aceso) e a base prateada mais larga, com o LED. */
function notebook(tl: Tela, n: Notebook) {
  for (let y = n.topo; y <= n.fundo; y++) {
    for (let x = n.de; x <= n.ate; x++) {
      const canto = y === n.topo && n.fundo > n.topo && (x === n.de || x === n.ate)
      if (canto) continue
      // tampa de uma linha só (o mini): sem contorno, senão ela inteira some no escuro
      const borda = y === n.topo && n.fundo > n.topo
      tl.p(x, y, borda ? TAMPA_BORDA : y === n.fundo && n.fundo > n.topo + 1 ? DOBRADICA : x === n.de ? TAMPA_CLARA : x === n.ate ? TAMPA_ESCURA : TAMPA)
    }
  }
  // o logo do Claude no meio: um ponto claro com brilho dos lados, na horizontal (na vertical ele
  // furava o contorno e a dobradiça, e parecia o corpo vazando pela tampa). Com a tela apagada
  // (logo 0) ele fica quase da cor da tampa.
  const meio = Math.round((n.de + n.ate) / 2)
  const aceso = misturar(misturar(TAMPA, CORAL, 0.4), [255, 222, 204], n.logo)
  const halo = misturar(TAMPA, aceso, 0.5)
  const ly = n.fundo - n.topo >= 2 ? n.fundo - 1 : n.fundo
  tl.p(meio, ly, aceso)
  if (n.ate - n.de >= 6) {
    tl.p(meio - 1, ly, halo)
    tl.p(meio + 1, ly, halo)
  }
  const by = n.fundo + 1
  for (let x = n.de - 1; x <= n.ate + 1; x++) tl.p(x, by, x === n.de - 1 || x === n.ate + 1 ? BASE_PONTA : BASE)
  tl.p(n.ate, by, n.led)
}

/** O LED de energia: verde (piscando trabalhando), âmbar respirando dormindo, vermelho piscando sem cota. */
function ledDo(estado: Estado, f: number, trabalhando: boolean): Rgb {
  if (estado === 'dormindo') return f % 16 < 8 ? LED_AMBAR : misturar(LED_AMBAR, LED_APAGADO, 0.7)
  if (estado === 'exausto') return f % 8 < 4 ? LED_VERMELHO : LED_APAGADO
  return trabalhando && f % 2 ? misturar(LED_VERDE, LED_APAGADO, 0.5) : LED_VERDE
}

/** Os bracinhos descendo pelos lados da tampa até o teclado; `de`/`dd` = quanto cada mão sobe (digitando). */
function bracosDigitando(tl: Tela, ox: number, oy: number, larg: number, fundo: number, de: number, dd: number, desbota = 0) {
  const coral = desbota ? misturar(CORAL, cinza(CORAL), desbota) : CORAL
  const escuro = desbota ? misturar(ESCURO, cinza(ESCURO), desbota) : ESCURO
  for (const [xo, xi, d] of [[ox, ox + 1, de], [ox + larg, ox + larg - 1, dd]] as const) {
    tl.p(xi, oy + 3, coral)
    tl.p(xo, oy + 3, coral)
    for (let y = oy + 4; y <= fundo - d; y++) tl.p(xo, y, y === fundo - d ? escuro : coral)
  }
}

function caneca(tl: Tela, f: number) {
  for (let y = 6; y <= 9; y++) for (let x = 16; x <= 18; x++) tl.p(x, y, CANECA)
  tl.p(17, 6, CAFE)
  tl.p(19, 7, CANECA)
  tl.p(19, 8, CANECA)
  // fumacinha subindo
  const fase = Math.floor(f / 3) % 3
  tl.l(17 + (fase === 1 ? 1 : 0), 2 - fase, '~', misturar(FUMACA, [40, 40, 50], fase * 0.3))
}

const SIMBOLOS = ['{', '}', '<', '/', '>', ';', '0', '1', '=', '(', ')']

/**
 * O código subindo dos dois lados do notebook: dois símbolos à esquerda (colunas 0-1)
 * e dois à direita (16-19), cada um numa altura, trocando de símbolo e de cor a cada subida.
 */
function codigo(tl: Tela, f: number, soEsquerda = false) {
  for (let n = 0; n < 4; n++) {
    if (soEsquerda && n % 2 === 0) continue // à direita estão os filhotes, com o código deles
    const v = Math.floor(f / 2) + n * 3
    const volta = Math.floor(v / 4)
    const col = n % 2 === 0 ? 16 + ((volta * 3 + n) % 4) : (volta + n) % 2
    tl.l(col, 3 - (v % 4), SIMBOLOS[(volta * 3 + n * 5) % SIMBOLOS.length]!, CODIGO[(volta + n) % CODIGO.length]!)
  }
}

/** A canequinha do lado esquerdo (colunas 0-1), quando os filhotes ocupam a direita: o chefe no café. */
function canequinha(tl: Tela, f: number) {
  tl.p(0, 6, CAFE)
  tl.p(1, 6, CAFE)
  for (let y = 7; y <= 9; y++) for (const x of [0, 1]) tl.p(x, y, CANECA)
  const fase = Math.floor(f / 3) % 3
  tl.l(fase === 1 ? 1 : 0, 2 - fase, '~', misturar(FUMACA, [40, 40, 50], fase * 0.3))
}

/**
 * A luz da tela no rosto: fraca parado, tremulando com o código rolando; nada com a tela dormindo.
 * Sutil de propósito: mais forte, o azul acinzentava o coral e o rosto se misturava com a tampa.
 */
const luzDaTela = (f: number, trabalhando: boolean) => (trabalhando ? 0.16 + 0.05 * ((f * 5) % 3) : 0.14)

/** Acordado, a tampa é alta (linhas 5 a 8) e cobre a parte de baixo do rosto; com a cabeça caída, baixa (6 a 8). */
const NOTEBOOK_GRANDE = { de: OX + 1, ate: OX + 11, topo: 5, fundo: 8 }
const NOTEBOOK_BAIXO = { ...NOTEBOOK_GRANDE, topo: 6 }

/**
 * A empresa. Com `nf` filhotes (os agentes da sessão) à direita: trabalhando, todos digitam juntos,
 * cada filhote no seu notebookzinho, o código subindo de todos; parado, é o chefe no café (a canequinha
 * vai para a esquerda) de olho na turma que trabalha.
 */
function empresa(estado: Estado, f: number, trabalhando: boolean, nf = 0): Quadro {
  const tl = new Tela(larguraCena(nf))
  if (estado === 'dormindo' || estado === 'exausto') {
    // cabeça caída no notebook (a tela apagou)
    const desbota = estado === 'exausto' ? DESBOTA_EXAUSTO : 0
    claudinho(tl, { ox: OX, oy: 3, olhos: estado === 'exausto' ? 'x' : 'fechados', bracos: null, pernas: 'escondidas', desbota })
    notebook(tl, { ...NOTEBOOK_BAIXO, logo: 0, led: ledDo(estado, f, false) })
    bracosDigitando(tl, OX, 3, 12, 8, 0, 0, desbota)
    if (nf > 0) filhotes(tl, 'empresa', estado, f, nf, false)
    else if (estado === 'dormindo') zzz(tl, f, 16, 2)
    if (estado === 'exausto') suor(tl, f, OX + 10, 3, 5)
    return tl
  }
  if (trabalhando) {
    // digitando: uma mão de cada vez (as duas, se apertado), lendo de um lado para o outro
    const rapido = estado === 'apertado'
    const toque = rapido ? f % 2 : Math.floor(f / 2) % 2
    const olhar = ([-1, 0, 1, 0] as const)[Math.floor(f / 4) % 4] ?? 0
    claudinho(tl, { ox: OX, oy: 1, olhos: 'abertos', olhar, bracos: null, pernas: 'escondidas', tela: luzDaTela(f, true) })
    notebook(tl, { ...NOTEBOOK_GRANDE, logo: 0.55 + 0.45 * Math.abs(Math.sin(f / 3)), led: ledDo(estado, f, true) })
    bracosDigitando(tl, OX, 1, 12, 8, toque ? 1 : 0, toque ? 0 : 1)
    codigo(tl, f, nf > 0)
    if (nf > 0) filhotes(tl, 'empresa', estado, f, nf, true) // trabalho em equipe: todo mundo digitando
    if (rapido) suor(tl, f, OX + 10, 1, 4)
    return tl
  }
  // parado: pausa para o café, piscando; com filhotes trabalhando, o olho fica neles
  const pisca = f % 24 >= 21
  claudinho(tl, {
    ox: OX,
    oy: 1,
    olhos: pisca ? 'fechados' : 'abertos',
    olhar: nf > 0 ? 1 : f % 48 >= 30 ? 1 : 0,
    bracos: null,
    pernas: 'escondidas',
    tela: luzDaTela(f, false),
  })
  notebook(tl, { ...NOTEBOOK_GRANDE, logo: 0.35, led: ledDo(estado, f, false) })
  bracosDigitando(tl, OX, 1, 12, 8, 0, 0)
  if (nf > 0) {
    canequinha(tl, f)
    filhotes(tl, 'empresa', estado, f, nf, false) // o chefe no café, de olho na turma
  } else caneca(tl, f)
  if (estado === 'apertado') suor(tl, f, OX + 10, 1, 4)
  return tl
}

// ---------------------------------------------------------- pessoal: normal

/**
 * A pessoal. Com `nf` filhotes à direita: dançando, eles dançam junto, no mesmo compasso (a conga);
 * parado, o principal fica em pé olhando os filhotes, que pulam cada um no seu ritmo.
 */
function pessoal(estado: Estado, f: number, trabalhando: boolean, nf = 0): Quadro {
  const tl = new Tela(larguraCena(nf))
  if (estado === 'dormindo' || estado === 'exausto') {
    // deitadinho
    const desbota = estado === 'exausto' ? DESBOTA_EXAUSTO : 0
    claudinho(tl, { ox: 2, oy: 3, olhos: estado === 'exausto' ? 'x' : 'fechados', bracos: [1, 1], pernas: 'escondidas', desbota })
    if (nf > 0) filhotes(tl, 'pessoal', estado, f, nf, false)
    else if (estado === 'dormindo') zzz(tl, f, 16, 2)
    if (estado === 'exausto') suor(tl, f, 2 + 10, 3, 6)
    return tl
  }
  if (trabalhando) {
    // dancinha: pulinho, passinho, braços para cima e olhos felizes; brilhinhos em volta
    const fase = f % 4
    const noAr = fase === 1 || fase === 2
    const oy = noAr ? 0 : 1
    claudinho(tl, {
      ox: 2,
      oy,
      olhos: 'feliz',
      bracos: fase % 2 ? [-2, 0] : [0, -2],
      pernas: noAr ? (fase === 1 ? 'passo1' : 'passo2') : 'paradas',
    })
    // com filhotes, os brilhos ficam só à esquerda: a direita é deles (que trazem os seus)
    const brilhos: [number, number][] = nf > 0 ? [[0, 0], [0, 3]] : [[0, 0], [17, 0], [0, 3], [17, 3]]
    for (let n = 0; n < 2; n++) {
      const [col, lin] = brilhos[(Math.floor(f / 3) + n * 2) % brilhos.length]!
      tl.l(col, lin, n ? '+' : '*', BRILHO)
    }
    if (nf > 0) filhotes(tl, 'pessoal', estado, f, nf, true) // a conga: todos pulam juntos
    if (estado === 'apertado') suor(tl, f, 2 + 10, oy, oy + 3)
    return tl
  }
  // parado: respira, pisca, olha para os lados; o bracinho balança de vez em quando.
  // Com filhotes trabalhando, os olhos ficam neles (à direita).
  const pisca = f % 26 >= 23
  const olhar = nf > 0 ? 1 : f % 40 < 8 ? -1 : f % 40 >= 20 && f % 40 < 28 ? 1 : 0
  claudinho(tl, {
    ox: 2,
    oy: 1,
    olhos: estado === 'apertado' ? 'arregalados' : pisca ? 'fechados' : 'abertos',
    olhar,
    bracos: f % 32 >= 28 ? [0, -1] : [0, 0],
  })
  if (nf > 0) filhotes(tl, 'pessoal', estado, f, nf, false)
  if (estado === 'apertado') suor(tl, f, 2 + 10, 1, 4)
  return tl
}

/**
 * O Claudinho da conta no instante `t` (segundos), com `nf` filhotes (os agentes da sessão que cabem
 * na tela; ver `arranjo`) à direita.
 */
export function desenhar(conta: Conta, estado: Estado, t: number, trabalhando: boolean, nf = 0): Quadro {
  const f = Math.floor(t * FPS)
  const n = Math.max(0, Math.min(MAX_FILHOTES, nf))
  return conta === 'empresa' ? empresa(estado, f, trabalhando, n) : pessoal(estado, f, trabalhando, n)
}

// ------------------------------------------------- vários: um por sessão

/** Uma sessão da conta, para o grupo: se está trabalhando, se é a desta janela e quantos agentes ela tem rodando. */
export type Membro = { trabalhando: boolean; aqui?: boolean; agentes?: number }
export type Tamanho = 'cena' | 'medio' | 'mini'

/**
 * Os moldes dos Claudinhos menores, linha a linha: C claro, K coral, E escuro (a sombra),
 * o olho (sobre coral), b braço, l perna. O médio é o mascote em 9x5; o mini, um bloquinho 5x3 com olhos e duas perninhas.
 */
const MOLDES = {
  medio: ['.CCCCCCC.', '.CoKKKoE.', 'bCKKKKKEb', '.EEEEEEE.', '.l.l.l.l.'],
  mini: ['CCCCE', 'CoKoE', 'EEEEE', '.l.l.'],
} as const
/** Quantas colunas cada Claudinho ocupa no grupo (o desenho mais o respiro até o vizinho). */
const PASSO = { medio: 10, mini: 6 } as const
/** O máximo de colunas que um grupo ocupa, por conta: dali para cima, mais Claudinhos não cabem. */
export const TETO_COLUNAS = 30

// Os agentes (subagentes) de uma sessão são FILHOTES: Claudinhos pequenos ao lado do principal.
// Na cena inteira, o mini do grupo (5 px, no seu notebookzinho na empresa), até 3, alargando a cena
// para a direita; nos grupos, um filhotinho de 4 px ao lado de quem tem agente.
/** Quantos filhotes a cena mostra no máximo (o resto fica na legenda). */
export const MAX_FILHOTES = 3
/** Onde começa o primeiro filhote da cena: logo depois do principal (que vai até a coluna 14) e de um respiro. */
const PX_FILHOTES = 16
/** Quanto o filhotinho dos grupos ocupa: 4 px e o respiro. */
const PASSO_MICRO = 5

/** A largura da cena com `filhotes` agentes à direita (sem nenhum, as 20 colunas de sempre). */
export const larguraCena = (filhotes: number) => (filhotes > 0 ? Math.max(COLUNAS, PX_FILHOTES + PASSO.mini * filhotes - 1) : COLUNAS)

/** As colunas de um Claudinho do grupo: o desenho, o respiro e o filhotinho, se a sessão tem agente. */
const larguraNoGrupo = (tamanho: 'medio' | 'mini', m: Membro) => PASSO[tamanho] + ((m.agentes ?? 0) > 0 ? PASSO_MICRO : 0)

export type Arranjo = { tamanho: Tamanho; mostrados: number; colunas: number; filhotes: number }

/**
 * Quantos Claudinhos mostrar e em que tamanho, para `n` sessões em `orcamento` colunas:
 * uma sessão é a cena inteira (com os filhotes dos agentes que couberem); duas ou mais encolhem
 * (médio, depois mini) até caber. `membros`, na ordem do painel, diz quem tem agente.
 */
export function arranjo(n: number, orcamento: number, membros: readonly Membro[] = []): Arranjo {
  if (n <= 1) {
    const pedidos = Math.min(MAX_FILHOTES, membros[0]?.agentes ?? 0)
    // filhote só entra se a tela tem colunas de verdade para ele (a legenda diz os agentes de todo jeito)
    const cabem = Math.max(0, Math.floor((orcamento - PX_FILHOTES + 1) / PASSO.mini))
    const filhotes = Math.min(pedidos, cabem)
    return { tamanho: 'cena', mostrados: 1, colunas: larguraCena(filhotes), filhotes }
  }
  const teto = Math.max(COLUNAS, Math.min(TETO_COLUNAS, orcamento))
  const lista: readonly Membro[] = membros.length >= n ? membros.slice(0, n) : Array.from({ length: n }, (_, i) => membros[i] ?? { trabalhando: false })
  const soma = (tamanho: 'medio' | 'mini', ms: readonly Membro[]) => ms.reduce((a, m) => a + larguraNoGrupo(tamanho, m), 0)
  if (soma('medio', lista) <= teto) return { tamanho: 'medio', mostrados: n, colunas: soma('medio', lista), filhotes: 0 }
  let mostrados = 0
  while (mostrados < n && soma('mini', lista.slice(0, mostrados + 1)) <= teto) mostrados++
  mostrados = Math.max(1, mostrados)
  return { tamanho: 'mini', mostrados, colunas: soma('mini', lista.slice(0, mostrados)), filhotes: 0 }
}

type PosePequena = {
  ox: number
  oy: number
  olhos: Olhos
  /** O braço que sobe (dançando): -1 esquerdo, 1 direito, 0 nenhum, 2 os dois. */
  ergue?: -1 | 0 | 1 | 2
  /** Braços descendo até o teclado, em vez dos do molde. */
  semBracos?: boolean
  pernas?: 'paradas' | 'passo1' | 'passo2' | 'escondidas'
  desbota?: number
  tela?: number
  /** Para onde os olhos olham: -1 esquerda, 1 direita (de olho nos filhotes). */
  olhar?: -1 | 0 | 1
}

/** Um Claudinho menor (médio ou mini) pelo molde; os olhos viram letra quando a célula cabe certinho. */
function pequeno(tl: Tela, tamanho: 'medio' | 'mini' | 'micro', p: PosePequena) {
  const molde = tamanho === 'micro' ? MICRO : MOLDES[tamanho]
  const cor = tom(p, molde.length - 1)
  const pernas = p.pernas ?? 'paradas'
  const alinhado = tamanho === 'medio' && (p.oy + 1) % 2 === 0
  const larg = molde[0]!.length
  const olhos: [number, number][] = []
  molde.forEach((linha, dy) => {
    const y = p.oy + dy
    ;[...linha].forEach((ch, dx) => {
      const x = p.ox + dx
      if (ch === 'C') tl.p(x, y, cor(CLARO, y))
      else if (ch === 'K') tl.p(x, y, cor(CORAL, y))
      else if (ch === 'E') tl.p(x, y, cor(ESCURO, y))
      else if (ch === 'b' && !p.semBracos) {
        const sobe = p.ergue === 2 || (p.ergue === -1 && dx === 0) || (p.ergue === 1 && dx === larg - 1)
        tl.p(x, sobe ? y - 1 : y, cor(CORAL, y))
      } else if (ch === 'l' && pernas !== 'escondidas') {
        const grupo = Math.floor(dx / 2) % 2 // pernas alternadas: 1ª e 3ª, 2ª e 4ª
        const ergue = (pernas === 'passo1' && grupo === 0) || (pernas === 'passo2' && grupo === 1)
        if (!ergue) tl.p(x, y, cor(ESCURO, y))
      } else if (ch === 'o') {
        tl.p(x, y, cor(CORAL, y)) // o rosto; o olho vem depois, já virado para onde olha
        olhos.push([x, y])
      }
    })
  })
  for (const [x0, y] of olhos) {
    const x = x0 + (p.olhar ?? 0)
    const g = GLIFO[p.olhos]
    if (g && alinhado) tl.l(x, y / 2, g, OLHO, cor(CORAL, y + 0.5))
    else tl.p(x, y, p.olhos === 'fechados' ? cor(ESCURO, y) : OLHO)
  }
}

/** O filhotinho dos grupos: 4 px, os olhos puxados para a esquerda (olhando o Claudinho dele) e duas perninhas. */
const MICRO = ['CKKE', 'oKoE', 'l.l.'] as const

/**
 * O filhotinho ao lado de um Claudinho do grupo (`x`, sua primeira coluna), com o mesmo significado da cena:
 * `junto` (o Claudinho também trabalha) pula no compasso dele ou digita junto; senão, se mexe no seu ritmo.
 */
function microFilhote(tl: Tela, conta: Conta, estado: Estado, f: number, x: number, chao: number, junto: boolean) {
  const g = junto ? f : f + 2 // fora do compasso quando o Claudinho dele está parado
  const desbota = estado === 'exausto' ? DESBOTA_EXAUSTO : 0
  const olhos: Olhos = estado === 'exausto' ? 'x' : 'abertos'
  if (conta === 'empresa') {
    // no seu notebookzinho: corpo nas linhas 6-7, tampa na 8, base prateada na 9
    pequeno(tl, 'micro', { ox: x, oy: H - 4, olhos, pernas: 'escondidas', desbota })
    notebook(tl, { de: x + 1, ate: x + 2, topo: H - 2, fundo: H - 2, logo: 0.55 + 0.45 * Math.abs(Math.sin(g / 3)), led: LED_APAGADO })
    // as mãozinhas dos lados da tampa; digitando, uma de cada vez some (subiu para bater na tecla)
    const ergue = Math.floor(g / 2) % 2
    if (ergue !== 0) tl.p(x, H - 2, CORAL)
    if (ergue !== 1) tl.p(x + 3, H - 2, CORAL)
    return
  }
  const noAr = g % 4 === 1 || g % 4 === 2
  pequeno(tl, 'micro', { ox: x, oy: chao - 2 - (noAr ? 1 : 0), olhos, pernas: noAr ? 'passo1' : 'paradas', desbota })
}

/** Onde o médio e o mini ficam: a coluna da têmpora (a gota) e a linha das pernas no chão (pessoal). */
const GEOMETRIA = {
  medio: { tempora: 7, chao: 7 },
  mini: { tempora: 4, chao: 8 },
} as const

/**
 * Um Claudinho do grupo (ou um filhote da cena, que é o mini) em `ox`. `olhar` vira os olhos de quem
 * está parado: 1 é "de olho nos filhotes" à direita.
 */
function desenharMembro(tl: Tela, conta: Conta, estado: Estado, f: number, i: number, ox: number, m: Membro, tamanho: 'medio' | 'mini', olhar: -1 | 0 | 1 = 0) {
  const molde = MOLDES[tamanho]
  const alto = molde.length
  const larg = molde[0]!.length
  const { tempora, chao } = GEOMETRIA[tamanho]
  const dormindo = estado === 'dormindo' || estado === 'exausto'
  const desbota = estado === 'exausto' ? DESBOTA_EXAUSTO : 0
  const pinta = (c: Rgb) => (desbota ? misturar(c, cinza(c), desbota) : c)
  /** A gota na têmpora: dois pixels escorrendo no médio; no mini, um só na beirada do rosto. */
  const gota = (oy: number) =>
    tamanho === 'medio' ? suor(tl, f + i * 3, ox + tempora, oy, oy + 2) : suor(tl, f + i * 3, ox + tempora, oy + 1, oy + 1, 1)
  /**
   * A setinha "v" no meio, uma célula acima da cabeça do Claudinho desta janela. (Era uma faixa embaixo
   * dos pés, que no terminal parecia reflexo no chão e foi confundida com bug.)
   */
  const marca = (oy: number) => {
    if (m.aqui) tl.l(ox + Math.floor(larg / 2), Math.max(0, Math.floor(oy / 2) - 1), 'v', MARCA)
  }
  const espelho = i % 2 === 1 // os vizinhos dançam espelhados: um levanta o braço esquerdo, o outro o direito
  const pisca = (f + i * 9) % 26 >= 23 // cada um pisca na sua hora
  const olhos: Olhos = estado === 'exausto' ? 'x' : estado === 'dormindo' || pisca ? 'fechados' : estado === 'apertado' ? 'arregalados' : 'abertos'
  const sono = (oy: number) => {
    if (estado === 'dormindo' && i % 2 === Math.floor(f / 12) % 2) tl.l(ox + larg - 1, Math.max(0, Math.floor(oy / 2) - 1), 'z', ZZZ)
  }

  if (conta === 'empresa') {
    // atrás do seu notebook: a base na última linha, a tampa logo acima cobrindo as pernas, as mãos nas pontas da base
    const fundo = H - 2
    const topo = tamanho === 'medio' ? fundo - 1 : fundo
    const oy = topo - (alto - 1) + (dormindo ? 1 : 0) // dormindo, a cabeça cai um pouco
    pequeno(tl, tamanho, {
      ox,
      oy,
      olhos: m.trabalhando && !dormindo ? 'abertos' : olhos,
      olhar: m.trabalhando ? 0 : olhar,
      semBracos: true,
      pernas: 'escondidas',
      desbota,
      tela: dormindo ? 0 : luzDaTela(f + i, m.trabalhando),
    })
    notebook(tl, {
      de: ox + 1,
      ate: ox + larg - 2,
      topo,
      fundo,
      logo: dormindo ? 0 : m.trabalhando ? 0.55 + 0.45 * Math.abs(Math.sin(f / 3)) : 0.35,
      // o LED aceso é o da sessão desta janela; os outros ficam apagadinhos
      led: m.aqui ? ledDo(estado, f, m.trabalhando) : misturar(ledDo(estado, f, m.trabalhando), LED_APAGADO, 0.6),
    })
    // as mãos descendo pelos lados até a base; digitando, sobem uma de cada vez
    const toque = m.trabalhando && !dormindo ? (estado === 'apertado' ? f % 2 : Math.floor(f / 2) % 2) : -1
    for (const [x, lado] of [[ox, 0], [ox + larg - 1, 1]] as const) {
      const sobe = toque === lado ? 1 : 0
      for (let y = oy + 2; y <= fundo - sobe; y++) tl.p(x, y, pinta(y === fundo - sobe ? ESCURO : CORAL))
    }
    if (m.trabalhando && !dormindo) {
      // um símbolo de código subindo por cima de cada um, trocando de lado a cada subida
      const v = Math.floor(f / 2) + i * 2
      const volta = Math.floor(v / 2)
      tl.l(ox + (volta % 2 ? larg - 1 : 0), 1 - (v % 2), SIMBOLOS[(volta * 3 + i * 5) % SIMBOLOS.length]!, CODIGO[(volta + i) % CODIGO.length]!)
    }
    sono(oy)
    if (estado === 'apertado' || estado === 'exausto') gota(oy)
    marca(oy)
    return
  }

  // pessoal: em pé; trabalhando, todos dançam no mesmo compasso
  const base = chao - (alto - 1) // o topo do corpo, com as pernas no chão
  if (dormindo) {
    pequeno(tl, tamanho, { ox, oy: base + 1, olhos, pernas: 'escondidas', desbota })
    sono(base)
    if (estado === 'exausto') gota(base + 1)
  } else if (m.trabalhando) {
    const fase = f % 4 // o mesmo `f` para todos: pulam juntos
    const noAr = fase === 1 || fase === 2
    const oy = noAr ? base - 1 : base
    const braco = (fase % 2 ? -1 : 1) * (espelho ? -1 : 1)
    pequeno(tl, tamanho, {
      ox,
      oy,
      olhos: 'feliz',
      ergue: braco as -1 | 1,
      pernas: noAr ? (fase === 1 ? 'passo1' : 'passo2') : 'paradas',
    })
    if ((Math.floor(f / 3) + i) % 2 === 0) tl.l(ox + (espelho ? 0 : larg - 1), 0, i % 2 ? '+' : '*', BRILHO)
    if (estado === 'apertado') gota(oy)
  } else {
    pequeno(tl, tamanho, { ox, oy: base, olhos, olhar, ergue: (f + i * 11) % 32 >= 28 ? (espelho ? -1 : 1) : 0 })
    if (estado === 'apertado') gota(base)
  }
  marca(base) // pela posição parada: a setinha não pula junto na dança
}

/**
 * Os filhotes da cena (um por agente da sessão), a partir da coluna PX_FILHOTES: o mini, cada um no
 * seu notebookzinho na empresa. `junto` (o principal também trabalha): na pessoal pulam no compasso
 * dele, como numa fila de conga; senão cada um no seu ritmo, enquanto o principal só olha.
 */
function filhotes(tl: Tela, conta: Conta, estado: Estado, f: number, n: number, junto: boolean) {
  const humorDeles: Estado = estado === 'dormindo' ? 'feliz' : estado // agente rodando: a conta está acordada
  for (let i = 0; i < n; i++) {
    const g = junto ? f : f + 2 + i * 3
    desenharMembro(tl, conta, humorDeles, g, i + 1, PX_FILHOTES + i * PASSO.mini, { trabalhando: true }, 'mini')
  }
}

/** O grupo de Claudinhos de uma conta: um por sessão, dançando (ou codando) juntos quando trabalham; quem tem agente leva um filhotinho ao lado. */
export function desenharGrupo(conta: Conta, estado: Estado, t: number, membros: readonly Membro[], tamanho: 'medio' | 'mini'): Quadro {
  const f = Math.floor(t * FPS)
  const tl = new Tela(membros.reduce((a, m) => a + larguraNoGrupo(tamanho, m), 0))
  const { chao } = GEOMETRIA[tamanho]
  let ox = 0
  membros.forEach((m, i) => {
    const comAgente = (m.agentes ?? 0) > 0
    // parado com agente rodando: os olhos vão para o filhotinho à direita (de olho nele)
    desenharMembro(tl, conta, estado, f, i, ox, m, tamanho, comAgente && !m.trabalhando ? 1 : 0)
    if (comAgente) microFilhote(tl, conta, estado, f + i, ox + PASSO[tamanho], chao, m.trabalhando)
    ox += larguraNoGrupo(tamanho, m)
  })
  return tl
}


// ------------------------------------------------------------------ células

const TRANSPARENTE = 0x01000000
const ACIMA = 0x2580 // ▀: frente = pixel de cima, fundo = pixel de baixo
const ABAIXO = 0x2584 // ▄
const rgb = (c: Rgb) => (c[0] << 16) | (c[1] << 8) | c[2]

/** O quadro como as células de um Raster de `q.colunas` x LINHAS: [caractere, frente, fundo] por célula, em base64. */
export function celulas(q: Quadro): string {
  const w = q.colunas
  const palavras = new Uint32Array(w * LINHAS * 3)
  for (let r = 0; r < LINHAS; r++) {
    for (let c = 0; c < w; c++) {
      const cima = q.px[2 * r * w + c] ?? null
      const baixo = q.px[(2 * r + 1) * w + c] ?? null
      const i = (r * w + c) * 3
      if (cima && baixo) palavras.set([ACIMA, rgb(cima), rgb(baixo)], i)
      else if (cima) palavras.set([ACIMA, rgb(cima), TRANSPARENTE], i)
      else if (baixo) palavras.set([ABAIXO, rgb(baixo), TRANSPARENTE], i)
      else palavras.set([0x20, TRANSPARENTE, TRANSPARENTE], i)
    }
  }
  for (const l of q.letras) {
    const i = (l.lin * w + l.col) * 3
    // letra com fundo (olho de expressão) vale sempre; sem fundo, só no vazio
    if (!l.fundo && palavras[i] !== 0x20) continue
    palavras.set([l.ch.codePointAt(0) ?? 0x20, rgb(l.cor), l.fundo ? rgb(l.fundo) : TRANSPARENTE], i)
  }
  return base64(new Uint8Array(palavras.buffer))
}

// ------------------------------------------------- barras (em texto colorido)

/** Uma célula de barra como texto: o caractere e as cores de frente e de fundo (#rrggbb). */
export type CelulaTexto = { ch: string; frente: string; fundo: string }

const VAZIO_CIMA: Rgb = [62, 62, 72]
const VAZIO_BAIXO: Rgb = [40, 40, 48]
const PARCIAL = ['▏', '▎', '▍', '▌', '▋', '▊', '▉']
const hex = (c: Rgb) => `#${c.map(n => n.toString(16).padStart(2, '0')).join('')}`
const escala = (c: Rgb, k: number): Rgb => [clamp(c[0] * k), clamp(c[1] * k), clamp(c[2] * k)]

/**
 * Uma barra de `colunas` células: um tubo com luz em cima e sombra embaixo (▀ com
 * frente clara e fundo escuro), gradiente no comprimento e ponta fracionada em oitavos.
 * Com `luz` (o instante, em segundos), uma faixa de luz corre por ela como se estivesse enchendo.
 */
export function barraCelulas(pct: number | undefined, cor: Rgb, colunas: number, luz?: number): CelulaTexto[] {
  const fracao = pct === undefined ? 0 : Math.max(0, Math.min(1, pct / 100))
  const oitavos = Math.round(fracao * colunas * 8)
  const acende = faixaDeLuz(oitavos / 8, luz)
  const out: CelulaTexto[] = []
  for (let x = 0; x < colunas; x++) {
    const ao = 0.8 + 0.35 * (x / Math.max(1, colunas - 1))
    const cheios = oitavos - x * 8
    const k = acende(x)
    if (cheios >= 8) {
      out.push({
        ch: '▀',
        frente: hex(misturar(escala(misturar(cor, BRANCO, 0.35), ao), BRANCO, 0.6 * k)),
        fundo: hex(misturar(escala(cor, ao * 0.82), BRANCO, 0.45 * k)),
      })
    } else if (cheios <= 0) {
      // logo depois da ponta, a luz tinge o vazio de leve: a próxima célula "vai encher"
      out.push({ ch: '▀', frente: hex(misturar(VAZIO_CIMA, cor, 0.4 * k)), fundo: hex(misturar(VAZIO_BAIXO, cor, 0.25 * k)) })
    } else {
      out.push({
        ch: PARCIAL[cheios - 1]!,
        frente: hex(misturar(escala(cor, ao), BRANCO, 0.6 * k)),
        fundo: hex(misturar(misturar(VAZIO_CIMA, VAZIO_BAIXO, 0.5), cor, 0.3 * k)),
      })
    }
  }
  return out
}

const BRANCO: Rgb = [255, 255, 255]
/** Quanto dura uma passada da luz pela barra, em segundos. */
const PASSADA = 1.5

/**
 * O brilho de "enchendo": uma faixa de luz que sai de antes do começo da barra e corre
 * até um pouco depois da ponta (`cheio`, em células), uma passada a cada PASSADA segundos.
 * Devolve quanto cada célula acende (0 a 1); sem `luz` (ou barra vazia), nada acende.
 */
function faixaDeLuz(cheio: number, luz: number | undefined): (x: number) => number {
  if (luz === undefined || cheio <= 0) return () => 0
  const centro = -1.5 + ((luz % PASSADA) / PASSADA) * (cheio + 3)
  return x => Math.max(0, 1 - Math.abs(x + 0.5 - centro) / 1.8) ** 1.5
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Base64 padrão com padding, sem depender de Buffer nem de toBase64 (roda no mod e no Node). */
export function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += b === undefined ? '=' : B64[(n >> 6) & 63]!
    out += c === undefined ? '=' : B64[n & 63]!
  }
  return out
}
