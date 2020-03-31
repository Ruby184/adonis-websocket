const url = require('url')
const cuid = require('cuid')
const ChannelManager = require('../Channel/Manager')
const ConnectionState = require('./ConnectionState')

class RedisState {
  constructor (Redis, config) {
    this._Redis = Redis
    this._config = config
  }

  _now () {
    return Math.floor(Date.now() / 1000)
  }

  _expiresAt () {
    return this._now() + (this._config.expire || 1800)
  }

  connection () {
    return this._Redis.connection(this._config.connection)
  }

  get wsExpiredKey () {
    return 'ws:to_be_expired'
  }

  topicKeyFor (id, name) {
    // use uuidv5 with namespace id
    return `topic:${id}:${name}`
  }

  connectionKeyFor (id) {
    return `connection:${id}`
  }

  handleConnection (connection) {
    const { query } = url.parse(connection.req.url, true)
    const state = query.state || cuid()

    connection.state = new ConnectionState(this, state)

    connection.on('close', async () => {
      await connection.state.commit()
    })

    return { state }
  }

  async saveConnection (id, data) {
    const multi = this.connection().multi()
    const topics = Object.keys(data)

    topics.forEach((topic) => {
      multi.set(this.topicKeyFor(id, topic), JSON.stringify(data[topic]))
    })

    multi.sadd(this.connectionKeyFor(id), topics)
    multi.zadd(this.wsExpiredKey, this._expiresAt(), id)

    await multi.exec()
  }

  async retrieveTopic (id, topic) {
    const payload = await this.connection().get(this.topicKeyFor(id, topic))

    if (!payload) {
      return {}
    }

    return JSON.parse(payload)
  }

  async purgeExpired () {
    const ids = await this.connection().purgeExpired(this.wsExpiredKey, this._now())

    if (ids === false) {
      return false
    }

    const multi = this.connection().multi()

    for (const id of ids) {
      const connKey = this.connectionKeyFor(id)
      const topics = await this.connection().smembers(connKey)

      for (const topic of topics) {
        try {
          await this._callExpiredOnController(id, topic)
        } catch (err) {
          //
        }

        multi.del(this.topicKeyFor(id, topic))
      }

      multi.del(connKey)
    }

    await multi.exec()

    return true
  }

  async _callExpiredOnController (id, topic) {
    const channel = ChannelManager.resolve(topic)

    if (!channel || typeof(channel._onConnect) !== 'string') {
      return
    }

    const Controller = channel._getChannelController()

    if (typeof (Controller['onExpiredState']) !== 'function') {
      return
    }

    const data = await this.retrieveTopic(id, topic)

    return Controller.onExpiredState(data, topic)
  }
}

module.exports = RedisState