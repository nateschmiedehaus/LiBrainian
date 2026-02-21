/**
 * @fileoverview EventBus interface for Record-and-Replay support
 *
 * ARCHITECTURAL ALIGNMENT (Two Dominating Principles):
 * - Record-and-Replay: Events are the primitive for reproducible runs
 * - Two-Level Evaluation: Events enable trajectory inspection (Layer 2)
 *
 * CONTROL THEORY MODEL:
 * - LiBrainian = Perception (emits events about what it observes)
 * - Agent = Controller (subscribes to events, emits actions)
 * - Events are the signals between them
 *
 * DETERMINISM REQUIREMENTS:
 * - All events must be serializable for replay
 * - Event ordering is preserved via sequence numbers
 * - Non-deterministic sources (timestamps, UUIDs) are recorded, not regenerated
 */

import type { Result } from './result.js';
import { Ok, Err } from './result.js';

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Base event interface that all events must implement.
 * Events are immutable, serializable records of something that happened.
 */
export interface Event<T extends string = string, P = unknown> {
  /** Event type discriminator */
  readonly type: T;
  /** Event payload - must be JSON-serializable */
  readonly payload: P;
  /** Unique event ID (recorded, not regenerated during replay) */
  readonly eventId: string;
  /** Sequence number for ordering (monotonic within a session) */
  readonly sequence: number;
  /** Timestamp when event was created (recorded, not regenerated) */
  readonly timestamp: number;
  /** Source component that emitted this event */
  readonly source: string;
  /** Correlation ID for request tracing */
  readonly correlationId?: string;
  /** Causation ID linking to triggering event */
  readonly causationId?: string;
}

/**
 * Event metadata for filtering and replay
 */
export interface EventMeta {
  eventId: string;
  type: string;
  sequence: number;
  timestamp: number;
  source: string;
  correlationId?: string;
  causationId?: string;
}

// ============================================================================
// LIBRARIAN-SPECIFIC EVENTS
// ============================================================================

/** File indexed event */
export interface FileIndexedEvent extends Event<'file.indexed'> {
  payload: {
    filePath: string;
    entityId: string;
    contentHash: string;
    embeddingGenerated: boolean;
  };
}

/** Query executed event */
export interface QueryExecutedEvent extends Event<'query.executed'> {
  payload: {
    queryId: string;
    queryText: string;
    resultCount: number;
    latencyMs: number;
    rerankingUsed: boolean;
  };
}

/** Extraction completed event */
export interface ExtractionCompletedEvent extends Event<'extraction.completed'> {
  payload: {
    entityId: string;
    extractorName: string;
    fieldsExtracted: string[];
    llmUsed: boolean;
  };
}

/** Bootstrap started event */
export interface BootstrapStartedEvent extends Event<'bootstrap.started'> {
  payload: {
    workspaceRoot: string;
    fileCount: number;
    estimatedDurationMs: number;
  };
}

/** Bootstrap completed event */
export interface BootstrapCompletedEvent extends Event<'bootstrap.completed'> {
  payload: {
    workspaceRoot: string;
    filesIndexed: number;
    entitiesCreated: number;
    durationMs: number;
    errors: Array<{ file: string; error: string }>;
  };
}

/** Knowledge updated event */
export interface KnowledgeUpdatedEvent extends Event<'knowledge.updated'> {
  payload: {
    entityId: string;
    fieldsUpdated: string[];
    reason: string;
  };
}

/** Union of all librainian events */
export type LiBrainianEvent =
  | FileIndexedEvent
  | QueryExecutedEvent
  | ExtractionCompletedEvent
  | BootstrapStartedEvent
  | BootstrapCompletedEvent
  | KnowledgeUpdatedEvent;

// ============================================================================
// EVENT BUS INTERFACE
// ============================================================================

export type EventHandler<E extends Event = Event> = (event: E) => void | Promise<void>;

export interface EventSubscription {
  /** Unsubscribe from events */
  unsubscribe(): void;
}

/**
 * EventBus interface for pub/sub with Record-and-Replay support.
 *
 * DETERMINISM REQUIREMENTS:
 * - Recording: All emitted events are persisted to an event log
 * - Replaying: Events are read from log and dispatched in sequence order
 * - Mode is explicit (record/replay/live) - no silent mode switching
 */
export interface EventBus<E extends Event = Event> {
  /**
   * Emit an event to all subscribers.
   * In record mode, persists to event log.
   * In replay mode, this should not be called (events come from log).
   */
  emit(event: Omit<E, 'eventId' | 'sequence' | 'timestamp'>): E;

  /**
   * Subscribe to events of a specific type.
   * Handler receives events in sequence order during replay.
   */
  subscribe<T extends E['type']>(
    type: T,
    handler: EventHandler<Extract<E, { type: T }>>
  ): EventSubscription;

  /**
   * Subscribe to all events.
   */
  subscribeAll(handler: EventHandler<E>): EventSubscription;

  /**
   * Get events matching a filter.
   * Used for trajectory inspection (Layer 2 evaluation).
   */
  getEvents(filter?: EventFilter): E[];

  /**
   * Get current sequence number.
   */
  getSequence(): number;

  /**
   * Current bus mode.
   */
  readonly mode: EventBusMode;
}

export type EventBusMode = 'record' | 'replay' | 'live';

export interface EventFilter {
  /** Filter by event type */
  type?: string | string[];
  /** Filter by source component */
  source?: string;
  /** Filter by correlation ID */
  correlationId?: string;
  /** Filter by sequence range */
  sequenceFrom?: number;
  sequenceTo?: number;
  /** Filter by time range */
  timestampFrom?: number;
  timestampTo?: number;
}

// ============================================================================
// EVENT LOG INTERFACE (For Record-and-Replay)
// ============================================================================

/**
 * Event log for persisting events during record and reading during replay.
 * Implementation may be file-based, database-based, or in-memory.
 */
export interface EventLog<E extends Event = Event> {
  /**
   * Append an event to the log.
   * Returns the sequence number assigned.
   */
  append(event: E): Promise<number>;

  /**
   * Read events from the log.
   */
  read(filter?: EventFilter): Promise<E[]>;

  /**
   * Get the last sequence number in the log.
   */
  getLastSequence(): Promise<number>;

  /**
   * Close the log (flush any pending writes).
   */
  close(): Promise<void>;
}

// ============================================================================
// IN-MEMORY EVENT BUS IMPLEMENTATION
// ============================================================================

/**
 * In-memory EventBus for testing and live mode.
 * For production record/replay, use a persistent EventLog implementation.
 */
export class InMemoryEventBus<E extends Event = Event> implements EventBus<E> {
  private events: E[] = [];
  private sequence = 0;
  private handlers = new Map<string, Set<EventHandler<E>>>();
  private allHandlers = new Set<EventHandler<E>>();
  readonly mode: EventBusMode;

  constructor(mode: EventBusMode = 'live') {
    this.mode = mode;
  }

  emit(partial: Omit<E, 'eventId' | 'sequence' | 'timestamp'>): E {
    const event = {
      ...partial,
      eventId: this.generateEventId(),
      sequence: ++this.sequence,
      timestamp: Date.now(),
    } as E;

    this.events.push(event);
    this.dispatch(event);
    return event;
  }

  subscribe<T extends E['type']>(
    type: T,
    handler: EventHandler<Extract<E, { type: T }>>
  ): EventSubscription {
    let handlers = this.handlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(type, handlers);
    }
    handlers.add(handler as EventHandler<E>);

    return {
      unsubscribe: () => handlers!.delete(handler as EventHandler<E>),
    };
  }

  subscribeAll(handler: EventHandler<E>): EventSubscription {
    this.allHandlers.add(handler);
    return {
      unsubscribe: () => this.allHandlers.delete(handler),
    };
  }

  getEvents(filter?: EventFilter): E[] {
    if (!filter) return [...this.events];

    return this.events.filter((e) => {
      if (filter.type) {
        const types = Array.isArray(filter.type) ? filter.type : [filter.type];
        if (!types.includes(e.type)) return false;
      }
      if (filter.source && e.source !== filter.source) return false;
      if (filter.correlationId && e.correlationId !== filter.correlationId) return false;
      if (filter.sequenceFrom !== undefined && e.sequence < filter.sequenceFrom) return false;
      if (filter.sequenceTo !== undefined && e.sequence > filter.sequenceTo) return false;
      if (filter.timestampFrom !== undefined && e.timestamp < filter.timestampFrom) return false;
      if (filter.timestampTo !== undefined && e.timestamp > filter.timestampTo) return false;
      return true;
    });
  }

  getSequence(): number {
    return this.sequence;
  }

  private dispatch(event: E): void {
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (e) {
          console.error(`[EventBus] Handler error for ${event.type}:`, e);
        }
      }
    }

    for (const handler of this.allHandlers) {
      try {
        handler(event);
      } catch (e) {
        console.error(`[EventBus] Handler error (all):`, e);
      }
    }
  }

  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create an event bus for the specified mode.
 */
export function createEventBus<E extends Event = Event>(
  mode: EventBusMode = 'live'
): EventBus<E> {
  return new InMemoryEventBus<E>(mode);
}

/**
 * Create an event from a partial specification.
 * Used when loading events from external sources.
 */
export function createEvent<E extends Event>(
  partial: Omit<E, 'eventId' | 'sequence' | 'timestamp'> & Partial<Pick<E, 'eventId' | 'sequence' | 'timestamp'>>
): E {
  return {
    eventId: partial.eventId ?? `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    sequence: partial.sequence ?? 0,
    timestamp: partial.timestamp ?? Date.now(),
    ...partial,
  } as E;
}
