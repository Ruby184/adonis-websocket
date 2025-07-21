'use strict'

/**
 * adonis-websocket
 *
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

const { WebSocketServer } = require('ws')
const url = require('url')
const { resolver, ioc } = require('@adonisjs/fold')
const GE = require('@adonisjs/generic-exceptions')
const Connection = require('../Connection')
const ClusterHop = require('../ClusterHop')
const Channel = require('../Channel')
const ChannelManager = require('../Channel/Manager')
const JsonEncoder = require('../JsonEncoder')
const middleware = require('../Middleware')

/**
 * The websocket server is a wrapper over `ws` node library and
 * written for AdonisJs specifically.
 *
 * @class Ws
 *
 * @package {Config} Config - Reference of Config provider
 */
class Ws {
  constructor (Config, Logger) {
    this.Logger = Logger
    
    this._options = Config.merge('socket', {
      path: '/adonis-ws',
      serverInterval: 30000,
      serverAttempts: 3,
      clientInterval: 25000,
      clientAttempts: 3,
      encoder: JsonEncoder
    })

    /**
     * These options are passed directly to the `Websocket.Server` constructor
     *
     * @type {Object}
     */
    this._serverOptions = {
      path: this._options.path,
      verifyClient: this._verifyClient.bind(this)
    }

    /**
     * The function to be called on connection
     * handshake
     *
     * @type {Function}
     */
    this._handshakeFn = null

    /**
     * The function to be called on connection
     *
     * @type {Function}
     */
    this._connectionFn = null

    /**
     * Reference to actual websocket server. It will
     * be set when `listen` method is called.
     *
     * @type {WebSocketServer}
     */
    this._wsServer = null

    /**
     * Encoder to be used for encoding the messages
     *
     * @type {Encoders}
     */
    this._encoder = this._options.encoder

    /**
     * Tracking all the connections, this is required to play
     * ping/pong
     *
     * @type {Set}
     */
    this._connections = new Set()

    /**
     * The timer initiated for monitoring connections
     * and terminating them if they are dead.
     *
     * @type {Timer}
     */
    this._heartBeatTimer = null

    /**
     * The exception handler used for reporting and handling errors
     *
     * @type {String}
     */
    this._exceptionHandler = null

    /**
     * Instance of cluster hop with encoder to allow broadcast
     * between cluster workers
     *
     * @type {ClusterHop}
     */
    this._clusterHop = new ClusterHop(this._encoder)
  }

  /**
   * Reference to @ref('Channel') class
   *
   * @attribute Channel
   */
  get Channel () {
    return Channel
  }

  /**
   * Verifies the handshake of a new connection.
   *
   * @method _verifyClient
   *
   * @param  {Object}      info
   * @param  {Function}      ack
   *
   * @return {void}
   *
   * @private
   */
  async _verifyClient (info, ack) {
    if (typeof (this._handshakeFn) !== 'function') {
      return ack(true)
    }

    try {
      await this._handshakeFn(info)
      ack(true)
    } catch (error) {
      ack(false, error.status, error.message)
    }
  }

  /**
   * The heart bear timer is required to monitor the health
   * of connections.
   *
   * Server will create only one timer for all the connections.
   *
   * @method _registerTimer
   *
   * @return {void}
   *
   * @private
   */
  _registerTimer () {
    this._heartBeatTimer = setInterval(() => {
      this._connections.forEach((connection) => {
        if (connection.pingElapsed >= this._options.serverAttempts) {
          connection.terminate('ping elapsed')
        } else {
          connection.pingElapsed++
        }
      })
    }, this._options.serverInterval)
  }

  /**
   * Clearing the timer when server closes
   *
   * @method _clearTimer
   *
   * @return {void}
   *
   * @private
   */
  _clearTimer () {
    clearInterval(this._heartBeatTimer)
  }

  /**
   * Returns the exception handler to handle the WS exceptions
   *
   * @method _getExceptionHandler
   *
   * @return {Class}
   *
   * @private
   */
  _getExceptionHandler () {
    try {
      return ioc.use(resolver.forDir('exceptions').translate('WsHandler'))
    } catch (_) {
      return ioc.use('Adonis/Addons/WsBaseExceptionHandler')
    }
  }

  /**
   * Handles the exception by invoking `handle` method
   * on the registered exception handler.
   *
   * @method handleException
   *
   * @param  {Object}         error
   * @param  {Object}         ctx
   *
   * @return {void}
   *
   * @private
   */
  async _handleException (error, ctx) {
    try {
      this._exceptionHandler.report(error, ctx)
      return await this._exceptionHandler.handle(error, ctx)
    } catch (err) {
      this.Logger.crit('Ws._handleException failed while trying to handle error: ', err)
      return error
    }
  }

  /**
   * Bind a single function to validate the handshakes
   *
   * @method onHandshake
   *
   * @param  {Function}  fn
   *
   * @chainable
   */
  onHandshake (fn) {
    if (typeof (fn) !== 'function') {
      throw GE.InvalidArgumentException.invalidParameter('Ws.onHandshake accepts a function', fn)
    }

    this._handshakeFn = fn
    return this
  }

  /**
   * Bind a single function when connection is created
   *
   * @method onHandshake
   *
   * @param  {Function}  fn
   *
   * @chainable
   */
  onConnection (fn) {
    if (typeof (fn) !== 'function') {
      throw GE.InvalidArgumentException.invalidParameter('Ws.onConnection accepts a function', fn)
    }

    this._connectionFn = fn
    return this
  }

  /**
   * Register a new channel to accept topic subscriptions
   *
   * @method channel
   *
   * @param  {...Spread} args
   *
   * @return {Channel}
   */
  channel (name, onConnect) {
    return ChannelManager.add(this._clusterHop, name, onConnect, this._handleException.bind(this))
  }

  /**
   * Returns channel instance for a given channel
   *
   * @method getChannel
   *
   * @param  {String}   name
   *
   * @return {Channel}
   */
  getChannel (name) {
    return ChannelManager.get(name)
  }

  /**
   * Handle a new connection
   *
   * @method handle
   *
   * @param  {Object} ws
   * @param  {Object} req
   *
   * @return {void}
   */
  async handle (ws, req) {
    const connection = new Connection(ws, req, this._encoder)

    /**
     * Important to leave the connection instance, when it closes to
     * avoid memory leaks.
     */
    connection.on('close', (__connection__) => {
      this._connections.delete(__connection__)
    })

    const options = {
      connId: connection.id,
      serverInterval: this._options.serverInterval,
      serverAttempts: this._options.serverAttempts,
      clientInterval: this._options.clientInterval,
      clientAttempts: this._options.clientAttempts
    }

    if (typeof (this._connectionFn) === 'function') {
      Object.assign(options, await this._connectionFn(connection))
    }

    /**
     * Open packet is an acknowledgement to the client that server is
     * ready to accept subscriptions
     */
    connection.sendOpenPacket(options)

    this._connections.add(connection)

    if (this._exceptionHandler && typeof (this._exceptionHandler.onConnection) === 'function') {
      try {
        await this._exceptionHandler.onConnection(connection, options)
      } catch (error) {
        this.Logger.crit(`Exception handler ${this._exceptionHandler.constructor.name}.onConnection failed while trying to handle connection: `, error)
      }
    }
  }

  /**
   * Start the websocket server
   *
   * @method listen
   *
   * @param  {Http.Server} server
   *
   * @return {void}
   */
  listen (server) {
    this._exceptionHandler = ioc.make(this._getExceptionHandler())

    if (typeof (this._exceptionHandler.handle) !== 'function' || typeof (this._exceptionHandler.report) !== 'function') {
      throw GE.RuntimeException.invoke(`Exception handler ${this._exceptionHandler.constructor.name} class must have handle and report methods on it`)
    }

    this._wsServer = new WebSocketServer(Object.assign({}, this._serverOptions, { server }))

    /**
     * Override the shouldHandle method to allow trailing slashes
     */
    this._wsServer.shouldHandle = function (req) {
      return this.options.path && url.parse(req.url).pathname.replace(/\/$/, '') === this.options.path
    }

    /**
     * Listening for new connections
     */
    this._wsServer.on('connection', this.handle.bind(this))

    this._registerTimer()
    this._clusterHop.init()
  }

  /**
   * Closes the websocket server
   *
   * @method close
   *
   * @return {void}
   */
  close () {
    ChannelManager.clear()
    this._clusterHop.destroy()

    if (this._wsServer) {
      this._connections.forEach((connection) => connection.terminate('closing server'))
      this._wsServer.close()
      this._clearTimer()
      this._exceptionHandler = null
    }
  }

  /**
   * Register an array of global middleware
   *
   * @method registerGlobal
   *
   * @param  {Array}       list
   *
   * @chainable
   *
   * @example
   * ```js
   * Ws.registerGlobal([
   *   'Adonis/Middleware/AuthInit'
   * ])
   * ```
   */
  registerGlobal (list) {
    middleware.registerGlobal(list)
    return this
  }

  /**
   * Register a list of named middleware
   *
   * @method registerNamed
   *
   * @param  {Object}      list
   *
   * @chainable
   *
   * ```js
   * Ws.registerNamed({
   *   auth: 'Adonis/Middleware/Auth'
   * })
   * ```
   */
  registerNamed (list) {
    middleware.registerNamed(list)
    return this
  }

  /**
   * Register a list of interceptors to be used by all channels
   *
   * @method registerInterceptors
   *
   * @param  {Array}      list
   *
   * @chainable
   *
   * @example
   * ```js
   * Ws.registerInterceptors([
   *   'App/Interceptors/Log',
   *   'App/Interceptors/Validate'
   * ])
   * ```
   */
  registerInterceptors (list) {
    if (!Array.isArray(list)) {
      throw GE.InvalidArgumentException.invalidParameter('Ws.registerInterceptors expects an array of interceptors', list)
    }

    ChannelManager.addGlobalInterceptors(list)
    return this
  }
}

module.exports = Ws
