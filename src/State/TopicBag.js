const _ = require('lodash')

class TopicBag {
  constructor (state, id, name) {
    this._state = state
    this._id = id
    this._name = name
    this._values = {}
    this.isDirty = false
  }

  async initialize () {
    this._values = await this._state.retrieveTopic(this._id, this._name)
  }

  async save () {
    if (!this.isDirty) {
      return
    }

    this.isDirty = false

    await this._state.updateTopic(this._id, this._name, this._values)
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