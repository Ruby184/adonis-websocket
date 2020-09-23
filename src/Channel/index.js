'use strict'

/**
 * adonis-websocket
 *
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

const GE = require('@adonisjs/generic-exceptions')
const debug = require('debug')('adonis:websocket')
const middleware = require('../Middleware')

/**
 * Channel class gives a simple way to divide the application
 * level concerns by maintaing a single TCP connection.
 *
 * @class Channel
 *
 * @param {String} name         Unique channel name
 * @param {Function} onConnect  Function to be invoked when a socket joins a Channel
 */
class Channel {
  constructor (clusterHop, name, onConnect) {
    this._validateArguments(name, onConnect)
    
    this.name = name
    
    this._clusterHop = clusterHop
    this._onConnect = onConnect

    /**
     * If channel controller is an ES6 class, then we let users
     * define listeners using a convention by prefixing `on`
     * in front of their methods.
     *
     * Instead of re-findings these listeners again and again on
     * the class prototype, we just pull them for once.
     *
     * @type {Array}
     */
    this._channelControllerListeners = []

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
     * Named middleware defined on the channel
     */
    this._middleware = []

    /**
     * The method attached as an event listener to each
     * subscription.
     */
    this.deleteSubscription = function (subscription) {
      const topic = this.subscriptions.get(subscription.topic)
      debug('removing channel subscription for %s topic', subscription.topic)

      if (topic && topic.delete(subscription) && topic.size === 0) {
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
   * Executes the middleware stack
   *
   * @method _executeMiddleware
   *
   * @param  {Object}           context
   *
   * @return {Promise}
   *
   * @private
   */
  _executeMiddleware (context) {
    return middleware
      .composeGlobalAndNamed(this._middleware)
      .params([context])
      .run()
  }

  /**
   * Returns the channel controller Class when it is a string.
   *
   * This method relies of the globals of `ioc container`.
   *
   * @method _getChannelController
   *
   * @return {Class}
   *
   * @private
   */
  _getChannelController () {
    const namespace = global.iocResolver.forDir('wsControllers').translate(this._onConnect)
    return global.use(namespace)
  }

  /**
   * Returns the listeners on the controller class
   *
   * @method _getChannelControllerListeners
   *
   * @param  {Class}                       Controller
   *
   * @return {Array}
   *
   * @private
   */
  _getChannelControllerListeners (Controller) {
    if (!this._channelControllerListeners.length) {
      /**
       * Looping over each method of the class prototype
       * and pulling listeners from them
       */
      this._channelControllerListeners = Object
        .getOwnPropertyNames(Controller.prototype)
        .filter((method) => method.startsWith('on') && method !== 'on')
        .map((method) => {
          const eventName = method.replace(/^on(\w)/, (match, group) => group.toLowerCase())
          return { eventName, method }
        })
    }

    return this._channelControllerListeners
  }

  /**
   * Invokes the onConnect handler for the channel.
   *
   * @method _callOnConnect
   *
   * @param  {Object}       context
   *
   * @return {void}
   */
  _callOnConnect (context) {
    /**
     * When the onConnect handler is a plain function
     */
    if (typeof (this._onConnect) === 'function') {
      process.nextTick(() => {
        this._onConnect(context)
      })
      return
    }

    /**
     * When onConnect handler is a reference to the channel
     * controler
     */
    const Controller = this._getChannelController()
    const controllerListeners = this._getChannelControllerListeners(Controller)

    /**
     * Calling onConnect in the next tick, so that the parent
     * connection saves a reference to it, before the closure
     * is executed.
     */
    process.nextTick(() => {
      const controller = new Controller(context)
      controllerListeners.forEach((item) => {
        context.socket.on(item.eventName, controller[item.method].bind(controller))
      })
    })
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
    await this._executeMiddleware(context)
    const subscriptions = this.getTopicSubscriptions(context.socket.topic)

    /**
     * Add new subscription to existing subscriptions
     */
    subscriptions.add(context.socket)
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

    this._callOnConnect(context)
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
    this._middleware = this._middleware.concat(middlewareList)
    return this
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
    this.subscriptions.has(topic) && this.getTopicSubscriptions(topic).forEach((socket) => {
      const socketIndex = filterSockets.indexOf(socket.id)
      const shouldSend = inverse ? socketIndex > -1 : socketIndex === -1

      if (shouldSend) {
        socket.connection.write(payload)
      }
    })
  }
}

module.exports = Channel
