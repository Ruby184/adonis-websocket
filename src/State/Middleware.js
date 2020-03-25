'use strict'

class StateMiddleware {
  async wsHandle ({ state }, next) {
    await state.initialize()
    await next()
  }
}

module.exports = StateMiddleware