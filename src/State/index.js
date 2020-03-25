const url = require('url')
const cuid = require('cuid')
const ConnectionState = require('./ConnectionState')

class RedisState {
  constructor (Redis, config) {
    this._Redis = Redis
    this._config = config
  }

  connection () {
    return this._Redis.connection(this._config.connection)
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
    
    connection.on('ping', async () => {
      await connection.state.save()
    })

    connection.on('close', async () => {
      await connection.state.save()
    })

    return { state }
  }

  async updateTopic (id, topic, data) {
    const connKey = this.connectionKeyFor(id)
    const ttl = await this.connection().ttl(connKey)

    const key = this.topicKeyFor(id, topic)
    const expiresIn = 1800 // 30m

    const multi = this.connection().multi()

    multi.set(key, JSON.stringify(data))
    multi.expire(key, expiresIn)
    // sadd maybe
    multi.rpush(connKey, key)

    if (expiresIn > ttl) {
      multi.expire(connKey, expiresIn)
    }

    await multi.exec()
  }

  async retrieveTopic (id, topic) {
    const payload = await this.connection().get(this.topicKeyFor(id, topic))

    if (!payload) {
      return {}
    }

    return JSON.parse(payload)
  }

  async clearTopic (id, topic) {
    const key = this.topicKeyFor(id, topic)

    await Promise.all([
      this.connection().del(key),
      this.connection().lrem(this.connectionKeyFor(id), 0, key)
    ])
  }

  async hasConnection (id) {
    return this.connection().exists(this.connectionKeyFor(id))
  }

  async destroyConnection (id) {
    const connKey = this.connectionKeyFor(id)
    const keys = await this.connection().lrange(connKey, 0, -1)
    const multi = this.connection().multi()

    multi.del(connKey)
    keys.forEach((key) => multi.del(key))

    await multi.exec()
  }
}

module.exports = RedisState