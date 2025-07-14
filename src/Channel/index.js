'use strict'

/**
 * adonis-websocket
 *
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

const Macroable = require('macroable')
const GE = require('@adonisjs/generic-exceptions')
const debug = require('debug')('adonis:websocket')
const EventExecutor = require('./EventExecutor')

/**
 * Channel class gives a simple way to divide the application
 * level concerns by maintaing a single TCP connection.
 *
 * @class Channel
 *
 * @param {String} name         Unique channel name
 * @param {Function} onConnect  Function to be invoked when a socket joins a Channel
 */
class Channel extends Macroable {
  constructor (clusterHop, name, onConnect, handleException) {
    super()

    this._validateArguments(name, onConnect)

    this.name = name
    this._clusterHop = clusterHop
    this.executor = new EventExecutor(onConnect, handleException)

    /**
     * All of the channel subscriptions are grouped
     * together as per their topics.
     *
     * @example
     * this.subscriptions.set('chat:watercooler', new Set())
     * this.subscriptions.set('chat:general', new Set())
     *
     * @type {Map}
     */
    this.subscriptions = new Map()

    /**
     * The method attached as an event listener to each
     * subscription.
     */
    this.deleteSubscription = function (subscription) {
      const topic = this.subscriptions.get(subscription.topic)
      debug('removing channel subscription for %s topic', subscription.topic)

      if (topic && topic.delete(subscription) && topic.size === 0) {
        this.subscriptions.delete(subscription.topic)
      }
    }.bind(this)
  }

  /**
   * Validate the new instance arguments to make sure we
   * can instantiate the channel.
   *
   * @method _validateArguments
   *
   * @param  {String}           name
   * @param  {Function}           onConnect
   *
   * @return {void}
   *
   * @throws {InvalidArgumentException} If arguments are incorrect
   *
   * @private
   */
  _validateArguments (name, onConnect) {
    if (typeof (name) !== 'string' || !name) {
      throw GE.InvalidArgumentException.invalidParameter('Expected channel name to be string')
    }

    if (typeof (onConnect) !== 'function' && typeof (onConnect) !== 'string') {
      throw GE.InvalidArgumentException.invalidParameter('Expected channel callback to be a function')
    }
  }

  /**
   * Returns the channel controller Class.
   *
   * @method getChannelController
   *
   * @return {Class}
   */
  getChannelController () {
    return this.executor.getChannelController()
  }

  /**
   * Returns the subscriptions set for a given topic. If there are no
   * subscriptions, an empty set will be initialized and returned.
   *
   * @method getTopicSubscriptions
   *
   * @param  {String}              name
   *
   * @return {Set}
   */
  getTopicSubscriptions (topic) {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set())
    }
    return this.subscriptions.get(topic)
  }

  /**
   * Join a topic by saving the subscription reference. This method
   * will execute the middleware chain before saving the
   * subscription reference and invoking the onConnect
   * callback.
   *
   * @method joinTopic
   *
   * @param  {Context}  context
   *
   * @return {void}
   */
  async joinTopic (context) {
    await this.executor.executeMiddleware(context)

    /**
     * Add new subscription to existing subscriptions
     */
    this.getTopicSubscriptions(context.socket.topic).add(context.socket)

    debug('adding channel subscription for %s topic', context.socket.topic)

    /**
     * Add reference of channel to the subscription
     */
    context.socket.associateChannel(this)

    /**
     * Binding to close event, so that we can clear the
     * subscription object from the subscriptions
     * set.
     */
    context.socket.on('close', this.deleteSubscription)

    return async () => this.executor.callOnConnect(context).catch((error) => {
      this.deleteSubscription(context.socket)
      return Promise.reject(error)
    })
  }

  /**
   * Add middleware to the channel. It will be called everytime a
   * subscription joins a topic
   *
   * @method middleware
   *
   * @param  {Function|Function[]}   middleware
   *
   * @chainable
   */
  middleware (middleware) {
    const middlewareList = Array.isArray(middleware) ? middleware : [middleware]
    this.executor.addMiddleware(middlewareList)

    return this
  }

  /**
   * Adds one or more interceptors to events emitted on the channel.
   * Interceptors allow you to transform event data, returned output, or exceptions.
   *
   * @method interceptor
   * @param {Function|string|Function[]} interceptor - A single interceptor function or an array of interceptor functions.
   * @param {string|string[]} [eventNames=EventExecutor.INTERCEPTOR_ALL_EVENTS] - The event name(s) to apply the interceptor(s) to. Defaults to all events.
   * @param {Array} [params=[]] - Additional parameters to pass to the interceptor(s).
   * @returns {Channel} Returns the current Channel instance for chaining.
   */
  interceptor (interceptor, eventNames = EventExecutor.INTERCEPTOR_ALL_EVENTS, params = []) {
    for (const handler of Array.isArray(interceptor) ? interceptor : [interceptor]) {
      this.executor.addInterceptor(eventNames, handler, params)
    }

    return this
  }

  /**
   * Adds a global interceptor that applies to all events on the channel.
   * @param {Function|string|Function[]} interceptors
   * @returns {Channel} Returns the current Channel instance for chaining.
   */
  globalInterceptors (interceptors) {
    return this.interceptor(interceptors, EventExecutor.INTERCEPTOR_GLOBAL)
  }

  /**
   * Scope broadcasting to a given topic
   *
   * @method topic
   *
   * @param  {String} topic
   *
   * @return {Object|Null}
   */
  topic (topic, ipcBroadcast = true) {
    return this._clusterHop.broadcastForTopic(this, topic, ipcBroadcast)
  }

  /**
   * Broadcast event message to a given topic.
   *
   * @method broadcastPayload
   *
   * @param  {String}    topic
   * @param  {String}    payload
   * @param  {Array}     filterSockets
   * @param  {Boolean}   inverse
   *
   * @return {void}
   */
  broadcastPayload (topic, payload, filterSockets = [], inverse = false) {
    this.subscriptions.has(topic) && this.getTopicSubscriptions(topic).forEach((socket) => {
      const socketIndex = filterSockets.indexOf(socket.id)
      const shouldSend = inverse ? socketIndex > -1 : socketIndex === -1

      if (shouldSend) {
        socket.connection.write(payload)
      }
    })
  }
}

module.exports = Channel
