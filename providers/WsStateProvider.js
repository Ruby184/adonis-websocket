'use strict'

/**
 * adonis-websocket
 *
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

const { ServiceProvider } = require('@adonisjs/fold')

class WsStateProvider extends ServiceProvider {
  register () {
    this.app.singleton('Adonis/Addons/WsState', (app) => {
      const Config = app.use('Adonis/Src/Config')
      const WsState = require('../src/State')

      return new WsState(
        app.use('Adonis/Addons/Redis'),
        Config.get('socket.state', {})
      )
    })

    this.app.bind('Adonis/Middleware/WsState', () => {
      const StateMiddleware = require('../src/State/Middleware')
      return new StateMiddleware()
    })
  }

  /**
   * Add request getter to the WsContext
   *
   * @method boot
   *
   * @return {void}
   */
  boot () {
    const Ws = this.app.use('Adonis/Addons/Ws')
    const WsState = this.app.use('Adonis/Addons/WsState')
    const WsContext = this.app.use('Adonis/Addons/WsContext')

    Ws.onConnection(WsState.handleConnection.bind(WsState))

    WsContext.getter('state', function () {
      return this.socket.connection.state.forTopic(this.socket.topic)
    }, true)
  }
}

module.exports = WsStateProvider
