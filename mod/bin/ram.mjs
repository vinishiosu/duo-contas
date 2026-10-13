// A RAM da máquina para o painel do duo-contas: { usado, total } em bytes.
import os from 'node:os'

const total = os.totalmem()
process.stdout.write(JSON.stringify({ usado: total - os.freemem(), total }))
