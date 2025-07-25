'use strict'

class BaseExceptionHandler {
  constructor (ExceptionStore) {
    this.ExceptionStore = ExceptionStore
  }

  static get inject () {
    return ['Adonis/Src/Exception']
  }

  _convertToClientError (error, withStack = false, useErrorMessageAndData = withStack) {
    return Object.assign(
      new Error(useErrorMessageAndData ? error.message : 'An error occurred while processing the request'),
      useErrorMessageAndData ? { ...error } : {},
      {
        code: error.code || 'E_GENERIC',
        status: error.status || 500,
        stack: withStack ? error.stack : '',
      }
    )
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
    const isDev = process.env.NODE_ENV === 'development'

    if (typeof (error.toJSON) === 'function') {
      return this._convertToClientError(error.toJSON(ctx), isDev, true)
    }

    return this._convertToClientError(error, isDev)
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
