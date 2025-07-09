'use strict'

class BaseExceptionHandler {
  constructor (ExceptionStore) {
    this.ExceptionStore = ExceptionStore
  }

  static get inject () {
    return ['Adonis/Src/Exception']
  }

  /**
   * Returns plain error to be used when running
   * server in production. Since production
   * server should not show error stack.
   *
   * @method _getPlainError
   *
   * @param  {Object}       error  - The error object
   *
   * @return {Object}
   *
   * @private
   */
  _convertToClientError (error, isDev = false) {
    return Object.assign(new Error(isDev ? error.message : 'An error occurred while processing the request'), {
      code: error.code || 'E_GENERIC',
      status: error.status || 500,
      stack: isDev ? error.stack : '',
    })
  }

  /**
   * The default handler to report exception when no one handles
   * a given exception
   *
   * @method _defaultHandler
   *
   * @param  {Object}        error
   * @param  {Object}        options.request
   * @param  {Object}        options.response
   *
   * @return {void}
   *
   * @private
   */
  async _defaultHandler (error) {
    return this._convertToClientError(error, process.env.NODE_ENV === 'development')
  }

  /**
   * Handles the exception by sending a response
   *
   * @method handle
   *
   * @param  {Object} error
   * @param  {Object} ctx
   *
   * @return {Mixed}
   */
  async handle (error, ctx) {
    if (typeof (error.wsHandle) === 'function') {
      return error.wsHandle(error, ctx)
    }

    return this._defaultHandler(error, ctx)
  }

  /**
   * Reports the error by invoking report on the exception
   * or pulls a custom defined reporter
   *
   * @method report
   *
   * @param  {Object} error
   * @param  {Object} ctx
   *
   * @return {boolean}
   */
  report (error, ctx) {
    if (typeof (error.report) === 'function' && error.report(error, ctx) !== false) {
      return true
    }

    const customReporter = this.ExceptionStore.getReporter(error.name)

    if (customReporter && typeof (customReporter.method) === 'function') {
      return customReporter.method(error, ctx) !== false
    }

    return false
  }
}

module.exports = BaseExceptionHandler
