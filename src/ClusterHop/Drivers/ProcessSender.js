'use strict'

class ProcessSender {
  constructor (proc = process) {
    this._proc = proc
    this._queue = []
    this._canSend = true
    this._messageHandler = null
  }

  async sendProcessMessage (data) {
    if (!this._proc.send) {
      return false
    }

    return new Promise((resolve, reject) => {
      this._queue.push({ data, resolve, reject })
      this._processQueue()
    })
  }

  onProcessMessage (message, receiver) {
    //
  }

  listen (receiver) {
    this._messageHandler = (message) => this.onProcessMessage(message, receiver)
    this._proc.on('message', this._messageHandler)
  }

  destroy () {
    if (!this._messageHandler) {
      return
    }

    this._proc.removeListener('message', this._messageHandler)
    this._messageHandler = null
  }

  _processQueue () {
    if (!this._canSend || this._queue.length === 0) {
      return
    }

    const { data, resolve, reject } = this._queue.shift()

    this._canSend = this._proc.send(data, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }

      if (!this._canSend) {
        this._canSend = true
        this._processQueue()
      }
    })

    this._processQueue()
  }
}

module.exports = ProcessSender
