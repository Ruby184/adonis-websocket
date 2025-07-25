'use strict'

const { ioc, resolver } = require('@adonisjs/fold')
const haye = require('haye')
const middleware = require('../Middleware')
const CONTROLLER_LISTENERS_SYMBOL = Symbol('CONTROLLER_LISTENERS_SYMBOL')
const hasOwn = Object.call.bind(Object.hasOwnProperty)
const INTERCEPTOR_GLOBAL = Symbol('INTERCEPTOR_GLOBAL')
const INTERCEPTOR_ALL_EVENTS = Symbol('INTERCEPTOR_ALL_EVENTS')

/**
 * EventExecutor is responsible for managing channel event handlers, interceptors, and middleware.
 * It resolves controllers, executes middleware, and applies interceptors to channel events.
 */
class EventExecutor {

  static get CONTROLLER_LISTENERS_SYMBOL () {
    return CONTROLLER_LISTENERS_SYMBOL
  }

  static get INTERCEPTOR_GLOBAL () {
    return INTERCEPTOR_GLOBAL
  }

  static get INTERCEPTOR_ALL_EVENTS () {
    return INTERCEPTOR_ALL_EVENTS
  }

  /**
   * @param {Function|string} onConnect - The controller class or namespace, or a function to handle onConnect.
   * @param {Function} handleException - Exception handler function.
   */
  constructor (onConnect, handleException) {
    this._onConnect = onConnect
    this._handleException = handleException
    this._resolvedControllerClass = null

    /**
     * Interceptors handlers map
     */
    this._interceptors = new Map()

    /**
     * Named middleware defined on the channel
     */
    this._middleware = []

    /**
     * Adds a global interceptor that handles exceptions for all events.
     * This interceptor catches errors thrown by event handlers and passes them to the exception handler.
     */
    this.addInterceptor(INTERCEPTOR_GLOBAL, async (data, next, context) => {
      try {
        return await next(data)
      } catch (error) {
        return this._handleException(error, context).then((err) => Promise.reject(err))
      }
    })
  }

  /**
   * Adds an interceptor which is global or for a specific event or all events.
   *
   * @param {string[]|symbol} events - The name of the events to intercept.
   * @param {Function|string} handler - The interceptor function to handle the event.
   * @param {Array} [params=[]] - Additional parameters to pass to the interceptor.
   * @returns {void}
   */
  addInterceptor (events, handler, params = []) {
    const interceptor = this._compileInterceptor(handler, params)

    for (const event of Array.isArray(events) ? events : [events]) {
      if (!this._interceptors.has(event)) {
        this._interceptors.set(event, [])
      }

      this._interceptors.get(event).push(interceptor)
    }
  }

  /**
   * Adds middleware to the channel's middleware stack.
   * @param {Array|Function|string} middleware - Middleware(s) to add.
   */
  addMiddleware (middleware) {
    this._middleware = this._middleware.concat(middleware)
  }

  /**
   * Compiles an interceptor handler into a standard format.
   * @param {Function|string} interceptor - The interceptor handler or its namespace string.
   * @param {Array} [params=[]] - Additional parameters to pass to the interceptor.
   * @returns {Object} Compiled interceptor object.
   */
  _compileInterceptor (interceptor, params = []) {
    if (typeof (interceptor) === 'function') {
      return { namespace: interceptor, params }
    }

    const [{ name, args }] = haye.fromPipe(interceptor).toArray()

    return {
      namespace: `${name}.intercept`,
      params: args.concat(params)
    }
  }

  /**
   * Resolves an interceptor to a callable handler function.
   * @param {Object} interceptor - Compiled interceptor object.
   * @returns {Function} Callable interceptor function.
   */
  _resolveInterceptor (interceptor) {
    const handlerInstance = resolver.resolveFunc(interceptor.namespace)
    return (...args) => handlerInstance.method(...args.concat([interceptor.params]))
  }

  /**
   * Gets the list of event listener methods from a controller prototype.
   * @param {Object} proto - Controller prototype.
   * @returns {Array} Array of event listener descriptors.
   */
  _getChannelControllerListeners (proto) {
    const methods = new Set()

    do {
      for (const method of Object.getOwnPropertyNames(proto).filter(
        (method) => method.startsWith('on') && method !== 'on' && typeof proto[method] === 'function'
      )) {
        methods.add(method)
      }
    } while ((proto = Object.getPrototypeOf(proto)) && proto !== Object.prototype)

    return [...methods].map((method) => ({
      eventName: method.replace(/^on(\w)/, (_, group) => group.toLowerCase()),
      method,
    }))
  }

  /**
   * Resolves the channel controller class or function.
   * @returns {Function} The resolved controller.
   */
  _resolveController () {
    if (typeof this._onConnect === 'function') {
      const Controller = this._onConnect
      // create a constructor from function to allow using new
      return function AnonymousController (ctx) {
        return Controller(ctx)
      }
    }

    const namespace = resolver.forDir('wsControllers').translate(this._onConnect)
    const Controller = ioc.use(namespace)

    return Object.defineProperty(Controller, CONTROLLER_LISTENERS_SYMBOL, {
      value: this._getChannelControllerListeners(Controller.prototype),
      enumerable: false,
      writable: false,
      configurable: true,
    })
  }

  /**
   * Returns the channel controller class, resolving it if necessary.
   * @returns {Function} The channel controller.
   */
  getChannelController () {
    if (!this._resolvedControllerClass) {
      this._resolvedControllerClass = this._resolveController()
    }

    return this._resolvedControllerClass
  }

  /**
   * Executes the middleware stack for the given context.
   * @param {Object} context - The context object.
   * @returns {Promise}
   */
  async executeMiddleware (context) {
    try {
      return await middleware.composeGlobalAndNamed(this._middleware).params([context]).run()
    } catch (error) {
      return this._handleException(error, context).then((err) => Promise.reject(err))
    }
  }

  /**
   * Invokes the onConnect handler for the channel and sets up event listeners.
   * @param {Object} context - The context object.
   * @returns {Promise<Object>} The controller instance.
   */
  async callOnConnect (context) {
    try {
      const Controller = this.getChannelController()
      const controllerInstance = new Controller(context)

      const controllerListeners = hasOwn(Controller, CONTROLLER_LISTENERS_SYMBOL)
        ? Controller[CONTROLLER_LISTENERS_SYMBOL]
        : this._getChannelControllerListeners(controllerInstance)

      for (const { eventName, method } of controllerListeners) {
        context.socket.setHandler(eventName, controllerInstance[method].bind(controllerInstance))
      }

      return controllerInstance
    } catch (error) {
      return this._handleException(error, context).then((err) => Promise.reject(err))
    }
  }

  /**
   * Gets the list of interceptor handlers for a given event.
   * Interceptors are applied in the following order: global, all-events, then event-specific.
   * @param {string} eventName - The event name.
   * @returns {Array<Function>} Array of interceptor functions.
   */
  getInterceptors (eventName) {
    const interceptors = []

    for (const interceptorType of [INTERCEPTOR_GLOBAL, INTERCEPTOR_ALL_EVENTS, eventName]) {
      if (this._interceptors.has(interceptorType)) {
        interceptors.push(...this._interceptors.get(interceptorType))
      }
    }

    return interceptors.map((interceptor) => this._resolveInterceptor(interceptor))
  }

  /**
   * Applies interceptors to an event handler, returning a composed handler function.
   * @param {string} eventName - The event name.
   * @param {Function} finalHandler - The final event handler.
   * @returns {Function} The composed handler function with interceptors applied.
   */
  intercept (eventName, finalHandler) {
    return this.getInterceptors(eventName).reduceRight(
      (next, handler) => async (data, context) => {
        const wrappedNext = async (newData) => next(newData, context)
        return await handler(data, wrappedNext, context)
      },
      async (finalData, context) => finalHandler(finalData, context)
    )
  }
}

module.exports = EventExecutor
