'use strict'

const { randomUUID } = require('crypto')

class RedisDriver {
  constructor (Redis) {
    this.Redis = Redis
    this.channelPrefix = 'adonis-hop-broadcast'
    this.redisConnectionName = null
    this.senderId = randomUUID()
  }

  static get inject () {
    return ['Adonis/Addons/Redis']
  }

  setConfig (config) {
    if (config.connection) {
      this.redisConnectionName = config.connection
    }

    if (config.channelPrefix) {
      this.channelPrefix = config.channelPrefix
    }
  }

  connection () {
    return this.Redis.connection(this.redisConnectionName)
  }

  getChannelName (topic = '*') {
    return `${this.channelPrefix}#${topic}`
  }

  listen (receiver) {
    const broadcastFn = (_, message) => {
      const [senderId, data] = JSON.parse(message)

      if (senderId === this.senderId) {
        return
      }

      receiver(data)
    }

    return this.connection().psubscribe(this.getChannelName(), broadcastFn)
  }

  send (data) {
    return this.connection().publish(this.getChannelName(data.topic), JSON.stringify([this.senderId, data]))
  }

  destroy () {
    return this.connection().punsubscribe(this.getChannelName())
  }
}

module.exports = RedisDriver
