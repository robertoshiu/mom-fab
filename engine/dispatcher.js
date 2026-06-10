// engine/dispatcher.js
// Typed pub/sub event dispatcher for the MOM FAB simulation.
// Not a global EventBus — a single instance is held by SimulationController.

import { eventRouting } from '../scenarios/mom-fab.js';

const EVENT_TYPES = new Set(Object.keys(eventRouting));

export class Dispatcher {
  constructor(gateFn = null) {
    this._gateFn = typeof gateFn === 'function' ? gateFn : null;
    this._subs = new Map();        // eventType -> Set<callback>
    this._owners = new Map();      // owner -> Array<unsubscribe handle>
    this._warned = new Set();      // owner keys already warned (one warn per owner)
  }

  _assertType(eventType) {
    if (!EVENT_TYPES.has(eventType)) {
      throw new Error('Dispatcher: unknown event type "' + eventType + '"');
    }
  }

  subscribe(eventType, callback) {
    this._assertType(eventType);
    if (typeof callback !== 'function') {
      throw new Error('Dispatcher: callback must be a function');
    }
    let set = this._subs.get(eventType);
    if (!set) {
      set = new Set();
      this._subs.set(eventType, set);
    }
    set.add(callback);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const s = this._subs.get(eventType);
      if (s) {
        s.delete(callback);
        if (s.size === 0) this._subs.delete(eventType);
      }
    };
  }

  subscribeAll(owner, handlers) {
    const handles = this._owners.get(owner) || [];
    for (const eventType in handlers) {
      if (Object.prototype.hasOwnProperty.call(handlers, eventType)) {
        handles.push(this.subscribe(eventType, handlers[eventType]));
      }
    }
    this._owners.set(owner, handles);
  }

  unsubscribeAll(owner) {
    const handles = this._owners.get(owner);
    if (!handles) return;
    for (const off of handles) off();
    this._owners.delete(owner);
  }

  emit(eventType, payload) {
    this._assertType(eventType);
    const event = { type: eventType, payload };
    if (this._gateFn && !this._gateFn(event)) return;
    const set = this._subs.get(eventType);
    if (!set) return;
    for (const cb of Array.from(set)) {
      try {
        cb(payload, event);
      } catch (err) {
        const key = (cb && cb.__owner) || eventType;
        if (!this._warned.has(key)) {
          this._warned.add(key);
          console.warn('Dispatcher: subscriber threw for "' + eventType + '":', err && err.message);
        }
      }
    }
  }
}
