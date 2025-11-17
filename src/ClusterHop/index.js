'use strict'

/**
 * adonis-websocket
 *
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

const debug = require('debug')('adonis:websocket')
const msp = require('@uxtweak/adonis-websocket-packet')
const ChannelsManager = require('../Channel/Manager')
const ClusterHopManager = require('./Manager')

const PacketFlags = Object.freeze({
  NONE: 0,
  BINARY: 1 << 0,
  LOCAL: 1 << 1,
  INVERSE: 1 << 2,
  ALL: ~(~0 << 3),
})

class ClusterHop {
  constructor (encoder, options) {
    this._encoder = encoder
    this._driver = ClusterHopManager.driver(options.driver, options.config || {})
  }

  initialize () {
    debug('adding listener from worker to receive node message')
    return this._driver.listen(this._deliverMessage.bind(this))
  }

  destroy () {
    debug('cleaning up cluster listeners')
    return this._driver.destroy()
  }

  _deliverMessage ({ topic, payload, ids = [], flags = PacketFlags.NONE }) {
    const channel = ChannelsManager.resolve(topic)

    if (!channel) {
      return debug('broadcast topic %s cannot be handled by any channel', topic)
    }

    return channel.broadcastPayload(
      topic,
      flags & PacketFlags.BINARY ? Buffer.from(payload) : payload,
      ids,
      Boolean(flags & PacketFlags.INVERSE)
    )
  }

  _broadcastEvent (channel, topic, event, data, ids = [], flags = PacketFlags.NONE) {
    const packet = msp.eventPacket(topic, event, data)

    /**
     * Encoding the packet before hand, so that we don't pay the penalty of
     * re-encoding the same message again and again
     */
    return new Promise((resolve, reject) => {
      this._encoder.encode(packet, (err, payload) => {
        if (err) {
          return reject(err)
        }

        channel.broadcastPayload(topic, payload, ids, Boolean(flags & PacketFlags.INVERSE))

        if (flags & PacketFlags.LOCAL) {
          resolve()
        } else {
          Promise.resolve(this._driver.send({
            topic,
            payload,
            ids,
            flags: Buffer.isBuffer(payload) ? flags | PacketFlags.BINARY : flags
          })).then(resolve, reject)
        }
      })
    })
  }

  broadcastForTopic (channel, topic, ipcBroadcast = true) {
    if (ChannelsManager.resolve(topic) !== channel) {
      return null
    }

    const $this = this
    const flags = ipcBroadcast ? PacketFlags.NONE : PacketFlags.LOCAL

    return {
      broadcast (event, data, exceptIds = []) {
        return $this._broadcastEvent(channel, topic, event, data, exceptIds, flags)
      },

      broadcastToAll (event, data) {
        return $this._broadcastEvent(channel, topic, event, data, [], flags)
      },

      emitTo (event, data, onlyIds) {
        return $this._broadcastEvent(channel, topic, event, data, onlyIds, flags | PacketFlags.INVERSE)
      }
    }
  }
}

module.exports = ClusterHop
