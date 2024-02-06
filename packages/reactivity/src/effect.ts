import { NOOP, extend } from '@vue/shared'
import type { ComputedRefImpl } from './computed'
import {
  DirtyLevels,
  type TrackOpTypes,
  type TriggerOpTypes,
} from './constants'
import type { Dep } from './dep'
import { type EffectScope, recordEffectScope } from './effectScope'

export type EffectScheduler = (...args: any[]) => any

export type DebuggerEvent = {
  effect: ReactiveEffect
} & DebuggerEventExtraInfo

export type DebuggerEventExtraInfo = {
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

export let activeEffect: ReactiveEffect | undefined

export class ReactiveEffect<T = any> {
  active = true

  //收集了对当前fn对象的依赖
  deps: Dep[] = []

  /**
   * Can be attached after creation
   * @internal
   */
  computed?: ComputedRefImpl<T>
  /**
   * @internal
   */
  allowRecurse?: boolean

  onStop?: () => void
  // dev only
  onTrack?: (event: DebuggerEvent) => void
  // dev only
  onTrigger?: (event: DebuggerEvent) => void

  /**
   * @internal
   */
  _dirtyLevel = DirtyLevels.Dirty
  /**
   * @internal
   */
  _trackId = 0
  /**
   * @internal
   */
  _runnings = 0
  /**
   * @internal
   */
  _shouldSchedule = false
  /**
   * @internal
   */
  _depsLength = 0

  constructor(
    public fn: () => T,
    public trigger: () => void,
    public scheduler?: EffectScheduler,
  ) {
    // recordEffectScope(this, scope)
  }

  public get dirty() {
    if (this._dirtyLevel === DirtyLevels.MaybeDirty) {
      pauseTracking()
      for (let i = 0; i < this._depsLength; i++) {
        const dep = this.deps[i]
        if (dep.computed) {
          triggerComputed(dep.computed)
          if (this._dirtyLevel >= DirtyLevels.Dirty) {
            break
          }
        }
      }
      if (this._dirtyLevel < DirtyLevels.Dirty) {
        this._dirtyLevel = DirtyLevels.NotDirty
      }
      resetTracking()
    }
    return this._dirtyLevel >= DirtyLevels.Dirty
  }

  public set dirty(v) {
    this._dirtyLevel = v ? DirtyLevels.Dirty : DirtyLevels.NotDirty
  }

  run() {
    this._dirtyLevel = DirtyLevels.NotDirty
    if (!this.active) {
      return this.fn()
    }
    //记录状态
    let lastShouldTrack = shouldTrack
    let lastEffect = activeEffect
    try {
      shouldTrack = true
      activeEffect = this
      this._runnings++

      //__depsLength会被清0
      preCleanupEffect(this)
      return this.fn()
    } finally {
      //不太确定它是干啥的
      postCleanupEffect(this)
      this._runnings--

      //恢复状态
      activeEffect = lastEffect
      shouldTrack = lastShouldTrack
    }
  }

  stop() {
    if (this.active) {
      preCleanupEffect(this)
      postCleanupEffect(this)
      this.onStop?.()
      this.active = false
    }
  }
}

function triggerComputed(computed: ComputedRefImpl<any>) {
  return computed.value
}

function preCleanupEffect(effect: ReactiveEffect) {
  effect._trackId++
  effect._depsLength = 0
}

function postCleanupEffect(effect: ReactiveEffect) {
  //清理多余的副作用，可是为啥会有多余副作用呢？
  if (effect.deps && effect.deps.length > effect._depsLength) {
    for (let i = effect._depsLength; i < effect.deps.length; i++) {
      cleanupDepEffect(effect.deps[i], effect)
    }
    effect.deps.length = effect._depsLength
  }
}

function cleanupDepEffect(dep: Dep, effect: ReactiveEffect) {
  const trackId = dep.get(effect)
  if (trackId !== undefined && effect._trackId !== trackId) {
    dep.delete(effect)
    if (dep.size === 0) {
      dep.cleanup()
    }
  }
}

export interface DebuggerOptions {
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
}

export interface ReactiveEffectOptions extends DebuggerOptions {
  lazy?: boolean
  scheduler?: EffectScheduler
  scope?: EffectScope
  allowRecurse?: boolean
  onStop?: () => void
}

export interface ReactiveEffectRunner<T = any> {
  (): T
  effect: ReactiveEffect
}

/**
 * Registers the given function to track reactive updates.
 *
 * The given function will be run once immediately. Every time any reactive
 * property that's accessed within it gets updated, the function will run again.
 *
 * @param fn - The function that will track reactive updates.
 * @param options - Allows to control the effect's behaviour.
 * @returns A runner that can be used to control the effect after creation.
 */
export function effect<T = any>(
  fn: () => T,
  options?: ReactiveEffectOptions,
): ReactiveEffectRunner {
  if ((fn as ReactiveEffectRunner).effect instanceof ReactiveEffect) {
    fn = (fn as ReactiveEffectRunner).effect.fn
  }

  const _effect = new ReactiveEffect(fn, NOOP, () => {
    if (_effect.dirty) {
      _effect.run()
    }
  })
  if (options) {
    extend(_effect, options)
    if (options.scope) recordEffectScope(_effect, options.scope)
  }
  if (!options || !options.lazy) {
    _effect.run()
  }
  const runner = _effect.run.bind(_effect) as ReactiveEffectRunner
  runner.effect = _effect
  return runner
}

/**
 * Stops the effect associated with the given runner.
 *
 * @param runner - Association with the effect to stop tracking.
 */
export function stop(runner: ReactiveEffectRunner) {
  runner.effect.stop()
}

export let shouldTrack = true
export let pauseScheduleStack = 0

const trackStack: boolean[] = []

/**
 * Temporarily pauses tracking.
 */
export function pauseTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

/**
 * Re-enables effect tracking (if it was paused).
 */
export function enableTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = true
}

/**
 * Resets the previous global effect tracking state.
 */
export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

export function pauseScheduling() {
  pauseScheduleStack++
}

export function resetScheduling() {
  pauseScheduleStack--
  while (!pauseScheduleStack && queueEffectSchedulers.length) {
    queueEffectSchedulers.shift()!()
  }
}

export function trackEffect(
  effect: ReactiveEffect,
  dep: Dep,
  debuggerEventExtraInfo?: DebuggerEventExtraInfo,
) {
  if (dep.get(effect) !== effect._trackId) {
    dep.set(effect, effect._trackId)
    const oldDep = effect.deps[effect._depsLength]
    if (oldDep !== dep) {
      if (oldDep) {
        cleanupDepEffect(oldDep, effect)
      }
      effect.deps[effect._depsLength++] = dep
    } else {
      effect._depsLength++
    }
    if (__DEV__) {
      effect.onTrack?.(extend({ effect }, debuggerEventExtraInfo!))
    }
  }
}

const queueEffectSchedulers: EffectScheduler[] = []

export function triggerEffects(
  dep: Dep,
  dirtyLevel: DirtyLevels,
  debuggerEventExtraInfo?: DebuggerEventExtraInfo,
) {
  pauseScheduling()
  //effects
  for (const effect of dep.keys()) {
    if (
      effect._dirtyLevel < dirtyLevel &&
      dep.get(effect) === effect._trackId
    ) {
      const lastDirtyLevel = effect._dirtyLevel
      effect._dirtyLevel = dirtyLevel
      if (lastDirtyLevel === DirtyLevels.NotDirty) {
        effect._shouldSchedule = true

        //执行job->执行cb
        effect.trigger()
      }
    }
  }
  scheduleEffects(dep)
  resetScheduling()
}

export function scheduleEffects(dep: Dep) {
  for (const effect of dep.keys()) {
    if (
      effect.scheduler &&
      effect._shouldSchedule &&
      (!effect._runnings || effect.allowRecurse) &&
      dep.get(effect) === effect._trackId
    ) {
      effect._shouldSchedule = false
      queueEffectSchedulers.push(effect.scheduler)
    }
  }
}
