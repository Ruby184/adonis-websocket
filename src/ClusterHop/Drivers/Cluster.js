'use strict'

const cluster = require('cluster')
const ProcessSender = require('./ProcessSender')

class ClusterDriver extends ProcessSender {
  constructor () {
    super()
    this.eventType = 'broadcast'
  }

  setConfig (config) {
    if (config.eventType) {
      this.eventType = config.eventType
    }
  }

  onProcessMessage (message, receiver) {
    if (typeof message !== 'string') {
      return
    }

    try {
      const deserialized = JSON.parse(message)

      if (!deserialized || typeof deserialized !== 'object') {
        return
      }

      const { handle, ...data } = deserialized

      if (handle !== this.eventType) {
        return
      }

      receiver(data)
    } catch (err) {
      //
    }
  }

  listen (receiver) {
    if (!cluster.isWorker) {
      return
    }

    return super.listen(receiver)
  }

  async send (data) {
    return this.sendProcessMessage(JSON.stringify({ handle: this.eventType, ...data }))
  }
}

module.exports = ClusterDriver
