'use strict'

const ProcessSender = require('./ProcessSender')

class Pm2Driver extends ProcessSender {
  constructor () {
    super()
    this.eventType = 'adonis:hop'
  }

  setConfig (config) {
    if (config.eventType) {
      this.eventType = config.eventType
    }
  }

  onProcessMessage (message, receiver) {
    if (typeof message === 'object' && message.type === this.eventType) {
      receiver(message.data)
    }
  }

  async send (data) {
    return this.sendProcessMessage({ type: this.eventType, data })
  }
}

module.exports = Pm2Driver
