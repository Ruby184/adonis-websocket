'use strict'

/**
 * adonis-websocket
 *
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

const Emittery = require('emittery')
const debug = require('debug')('adonis:websocket')
const GE = require('@adonisjs/generic-exceptions')
const { deserializeError } = require('@uxtweak/adonis-websocket-packet')

/**
 * Socket is instance of a subscription for a given topic.
 * Socket will always have access to the channel and
 * it's parent connection.
 *
 * @class Socket
 *
 * @param {String}  topic
 * @param {Connect} connection
 */
class Socket {
  constructor (topic, connection, context) {
    this._acks = new Map()
    this._nextAckId = 0
    this._handlerMap = new Map()
    this._eventExecutorCache = new Map()

    this.channel = null

    /**
     * Below properties cannot be changed
     */
    Object.defineProperty(this, 'topic', {
      get () { return topic }
    })

    Object.defineProperty(this, 'connection', {
      get () { return connection }
    })

    Object.defineProperty(this, 'id', {
      get () { return `${topic}#${connection.id}` }
    })

    Object.defineProperty(this, 'context', {
      get () { return context }
    })

    this.emitter = new Emittery()

    this._finalEventHandler = async (finalData, context) => {
      const eventName = context.event.name
      const handler = this._handlerMap.get(eventName)

      const [response] = await Promise.all([
        handler && handler(finalData, context),
        this.emitter.emit(eventName, finalData)
      ])

      return response
    }
  }

  setHandler (eventName, handler) {
    if (this._handlerMap.has(eventName)) {
      throw GE.InvalidArgumentException.invoke(`Trying to set duplicate event handler for "${eventName}" on topic "${this.topic}".`)
    }

    this._handlerMap.set(eventName, handler)
  }

  /**
   * Associates the channel to the socket
   *
   * @method associateChannel
   *
   * @param  {Channel}         channel
   *
   * @return {void}
   */
  associateChannel (channel) {
    this.channel = channel
  }

  /* istanbul ignore next */
  /**
   * Bind a listener
   *
   * @method on
   *
   * @param  {...Spread} args
   *
   * @return {void}
   */
  on (...args) {
    return this.emitter.on(...args)
  }

  /* istanbul ignore next */
  /**
   * Bind a listener for one time only
   *
   * @method once
   *
   * @param  {...Spread} args
   *
   * @return {void}
   */
  once (...args) {
    return this.emitter.once(...args)
  }

  /* istanbul ignore next */
  /**
   * Remove listener
   *
   * @method off
   *
   * @param  {...Spread} args
   *
   * @return {void}
   */
  off (...args) {
    return this.emitter.off(...args)
  }

  /**
   * Emit message to the client
   *
   * @method emit
   *
   * @param  {String}   event
   * @param  {Object}   data
   * @param  {Function} [responseAck]
   *
   * @return {void}
   */
  emit (event, data, responseAck) {
    let id, ack
    if (typeof (responseAck) === 'function') {
      id = this._nextAckId++
      ack = (err) => {
        if (err) {
          return responseAck(err)
        }
        this._acks.set(id, responseAck)
      }
    }

    this.connection.sendEvent(this.topic, event, data, ack, id)
  }

  /**
   * Broadcast event to everyone except the current socket.
   *
   * @method broadcast
   *
   * @param  {String}   event
   * @param  {Mixed}    data
   * @param  {Array}    exceptIds
   *
   * @return {void}
   */
  broadcast (event, data, exceptIds = [this.connection.id]) {
    if (!Array.isArray(exceptIds)) {
      throw GE.InvalidArgumentException.invalidParameter('broadcast expects 3rd parameter to be an array of socket ids', exceptIds)
    }

    this.channel.topic(this.topic).broadcast(event, data, exceptIds)
  }

  /**
   * Broadcasts the message to everyone who has joined the
   * current topic.
   *
   * @method broadcastToAll
   *
   * @param  {String}       event
   * @param  {Mixed}       data
   *
   * @return {void}
   */
  broadcastToAll (event, data) {
    this.channel.topic(this.topic).broadcastToAll(event, data)
  }

  /**
   * Emit event to selected socket ids
   *
   * @method emitTo
   *
   * @param  {String} event
   * @param  {Mixed}  data
   * @param  {Array}  ids
   *
   * @return {void}
   */
  emitTo (event, data, ids) {
    if (!Array.isArray(ids)) {
      throw GE.InvalidArgumentException.invalidParameter('emitTo expects 3rd parameter to be an array of socket ids', ids)
    }

    this.channel.topic(this.topic).emitTo(event, data, ids)
  }

  /**
   * Invoked when internal connection gets a TCP error
   *
   * @method serverError
   *
   * @param  {Number}    code
   * @param  {String}    reason
   *
   * @return {void}
   */
  serverError (code, reason) {
    this.emitter.emit('error', { code, reason })
  }

  /**
   * A new message received
   *
   * @method serverMessage
   *
   * @param  {String}      options.event
   * @param  {Mixed}       options.data
   *
   * @return {Promise}
   */
  async serverMessage ({ event, data }) {
    let executor = this._eventExecutorCache.get(event)

    if (!executor) {
      executor = this.channel.executor.intercept(event, this._finalEventHandler)
      this._eventExecutorCache.set(event, executor)
    }

    const context = this.context.clone({
      event: Object.freeze({ name: event, data })
    })

    return executor(data, context)
  }

  /**
   * A new ack received
   *
   * @method serverAck
   *
   * @param  {Number}      options.id
   * @param  {Mixed}       options.data
   *
   * @return {void}
   */
  serverAck ({ id, data }) {
    if (this._acks.has(id)) {
      const ack = this._acks.get(id)
      ack(null, data)
      this._acks.delete(id)
    } else {
      debug('bad ack %s for %s topic', id, this.topic)
    }
  }

  /**
   * A new ack error received
   *
   * @method serverAckError
   *
   * @param  {Number}      options.id
   * @param  {String}      options.message
   *
   * @return {void}
   */
  serverAckError ({ id, error }) {
    if (this._acks.has(id)) {
      const ack = this._acks.get(id)
      ack(deserializeError(error))
      this._acks.delete(id)
    } else {
      debug('bad ack %s for %s topic', id, this.topic)
    }
  }

  /**
   * Close the subscription, when client asks for it
   * or when server connection closes
   *
   * @method serverClose
   *
   * @return {Promise}
   */
  serverClose () {
    const cleanup = () => {
      this.emitter.clearListeners()
      this._acks.clear()
      this._handlerMap.clear()
      this._eventExecutorCache.clear()
    }

    return this.emitter.emit('close', this).then(cleanup).catch(cleanup)
  }

  /**
   * Close the subscription manually
   *
   * @method close
   *
   * @return {Promise}
   */
  close () {
    debug('self closing subscription for %s topic', this.topic)

    return this
      .serverClose()
      .then(() => {
        this.connection.sendLeavePacket(this.topic)
      })
  }
}

module.exports = Socket
