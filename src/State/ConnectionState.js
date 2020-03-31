const TopicBag = require('./TopicBag')

class ConnectionState {
  constructor (state, id) {
    this._state = state
    this._id = id
    this._topics = new Map()
  }

  forTopic (name) {
    if (!this._topics.has(name)) {
      this._topics.set(name, new TopicBag(this, name))
    }

    return this._topics.get(name)
  }

  async getData (name) {
    return this._state.retrieveTopic(this._id, name)
  }

  async commit () {
    const data = {}

    for (const [topic, bag] of this._topics) {
      data[topic] = bag.all()
    }

    await this._state.saveConnection(this._id, data)
  }
}

module.exports = ConnectionState