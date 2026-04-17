/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
const path = require('path')
const Module = require('module')

function createMockPty() {
  const dataListeners = new Set()
  const exitListeners = new Set()

  return {
    pid: Math.floor(Math.random() * 10_000) + 1,
    process: 'mock-shell',
    onData(cb) {
      dataListeners.add(cb)
      return { dispose: () => dataListeners.delete(cb) }
    },
    onExit(cb) {
      exitListeners.add(cb)
      return { dispose: () => exitListeners.delete(cb) }
    },
    write(data) {
      const output = data ? `echo:${data}` : ''
      for (const cb of dataListeners) cb(output)
    },
    resize() {},
    kill() {
      for (const cb of exitListeners) cb({ exitCode: 0, signal: 0 })
    }
  }
}

const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'node-pty') {
    return {
      spawn() {
        return createMockPty()
      }
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

const mainEntry = process.argv[2]
if (!mainEntry) {
  throw new Error('Expected main entry path as first argument')
}

require(path.resolve(mainEntry))
