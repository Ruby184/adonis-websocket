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

  get (key, defaultValue = null) {
    return _.get(this._values, key, defaultValue)
  }

  forget (key) {
    if (!_.has(this._values, key)) {
      return
    }

    this.isDirty = true
    _.unset(this._values, key)
  }

  all () {
    return _.cloneDeep(this._values)
  }
}

module.exports = TopicBag