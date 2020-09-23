'use strict'

/**
 * adonis-websocket
 *
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

const cluster = require('cluster')
const debug = require('debug')('adonis:websocket')
const msp = require('@uxtweak/adonis-websocket-packet')
const { serialize, deserialize } = require('./serializer')
const ChannelsManager = require('../Channel/Manager')

class ClusterHop {
  constructor (encoder) {
    this._encoder = encoder

    this.sender = function (handle, topic, payload, args = {}) {
      try {
        process.send && process.send(serialize({ handle, topic, payload, args }))
      } catch (error) {
        debug('cluster.send error %o', error)
      }
    }.bind(this)

    this.receiver = function (message) {
      let decoded = null
    
      try {
        decoded = deserialize(message)
      } catch (error) {
        return debug('dropping packet, since it is not valid')
      }

      try {
        this._deliverMessage(decoded)
      } catch (error) {
        debug('unable to process cluster message with error %o', error)
      }
    }.bind(this)
  }

  init () {
    if (cluster.isWorker) {
      debug('adding listener from worker to receive node message')
      process.on('message', this.receiver)
    }
  }

  destroy () {
    debug('cleaning up cluster listeners')
    process.removeListener('message', this.receiver)
  }

  _deliverMessage ({ handle, topic, payload, args = {} }) {
    if (handle === 'broadcast') {
      const channel = ChannelsManager.resolve(topic)
  
      if (!channel) {
        return debug('broadcast topic %s cannot be handled by any channel', topic)
      }
  
      return channel.broadcastPayload(topic, payload, args.ids, args.inverse)
    }
  
    debug('dropping packet, since %s handle is not allowed', handle)
  }

  _broadcastEvent (ipcBroadcast, channel, topic, event, data, ids = [], inverse = false) {
    const packet = msp.eventPacket(topic, event, data)

    /**
     * Encoding the packet before hand, so that we don't pay the penalty of
     * re-encoding the same message again and again
     */
    this._encoder.encode(packet, (err, payload) => {
      if (err) {
        return
      }

      channel.broadcastPayload(topic, payload, ids, inverse)
      ipcBroadcast && this.sender('broadcast', topic, payload, { ids, inverse })
    })
  }

  broadcastForTopic (channel, topic, ipcBroadcast = true) {
    if (ChannelsManager.resolve(topic) !== channel) {
      return null
    }
    
    const $this = this
    
    return {
      broadcast (event, data, exceptIds = []) {
        $this._broadcastEvent(ipcBroadcast, channel, topic, event, data, exceptIds)
      },

      broadcastToAll (event, data) {
        $this._broadcastEvent(ipcBroadcast, channel, topic, event, data)
      },

      emitTo (event, data, ids) {
        $this._broadcastEvent(ipcBroadcast, channel, topic, event, data, ids, true)
      }
    }
  }
}

module.exports = ClusterHop
