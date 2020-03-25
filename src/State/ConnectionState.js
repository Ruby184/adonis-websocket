const TopicBag = require('./TopicBag')

class ConnectionState {
  constructor (state, id) {
    this._state = state
    this._id = id
    this._topics = new Map()
  }

  forTopic (name) {
    if (!this._topics.has(name)) {
      this._topics.set(name, new TopicBag(this._state, this._id, name))
    }

    return this._topics.get(name)
  }

  async save () {
    const promises = []
    
    for (const bag of this._topics) {
      promises.push(bag.save())
    }

    await Promise.all(promises)
  }

  // TODO:
  async destroy () {
    this._topics.clear()
  }
}

module.exports = ConnectionState