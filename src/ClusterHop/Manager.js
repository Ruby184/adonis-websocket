'use strict'

const { ioc } = require('@adonisjs/fold')
const GE = require('@adonisjs/generic-exceptions')
const Drivers = require('./Drivers')

class ClusterHopManager {
  /**
   * Extend by adding your own drivers
   *
   * @method extend
   *
   * @param  {String} name
   * @param  {Object} implementation
   *
   * @return {void}
   */
  static extend (name, implementation) {
    this._drivers[name] = implementation
  }

  /**
   * Returns the driver instance for a given driver. Also
   * calls `setConfig` method on the driver to pass
   * the configuration
   *
   * @method driver
   *
   * @param  {String} name
   * @param  {Object} config
   *
   * @return {Object}
   */
  static driver (name, config) {
    const Driver = this._drivers[name] || Drivers[name]

    /**
     * If driver doesn't exists, let the end user know
     * about it
     */
    if (!Driver) {
      throw GE.RuntimeException.invoke(`ClusterHop driver ${name} does not exists.`, 500, 'E_INVALID_DRIVER')
    }

    const driverInstance = ioc.make(Driver)
    driverInstance.setConfig(config)
    return driverInstance
  }
}

ClusterHopManager._drivers = {}

module.exports = ClusterHopManager
