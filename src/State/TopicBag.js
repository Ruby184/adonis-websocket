const _ = require('lodash')

class TopicBag {
  constructor (state, name) {
    this._state = state
    this._name = name
    this._values = {}
    this.isDirty = false
  }

  async initialize () {
    this._values = await this._state.getData(this._name)
  }

  put (key, value) {
    this.isDirty = this.isDirty || this.get(key) !== value
    return _.set(this._values, key, value)
  }

  merge (values) {
    this.isDirty = true
    return _.merge(this._values, values)
  }

  get (key, defaultValue = null) {
    return _.get(this._values, key, defaultValue)
  }

  forget (key) {
    return this.isDirty = _.unset(this._values, key)
  }

  pull (key, defaultValue) {
    return ((value) => {
      this.forget(key)
      return value
    })(this.get(key, defaultValue))
  }

  clear () {
    this.isDirty = true
    this._values = {}
  }

  all () {
    return _.cloneDeep(this._values)
  }
}

module.exports = TopicBag