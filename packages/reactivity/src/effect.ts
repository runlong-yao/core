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

//记录当前的ReactiveEffect
export let activeEffect: ReactiveEffect | undefined

//建立effectScope的对象:self
//依赖于self的对象: child
//self依赖的对象: parent

/**
 * 副作用管理类
 */
//computed 返回的是一个ref对象;computed收集的是fn中的依赖;会影响其它引用computed的监听方法
//watch 返回一个stop方法;watch收集的是第一个参数传递的依赖;执行第二参数的方法

export class ReactiveEffect<T = any> {
  active = true

  /**
   * 当前effect依赖的响应式对象集合
   */
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

  //cleanup的时候_trackId会增加，
  //应该是用来标记清楚的，防止effect运行无效代码
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

  //建立effectScope的对象:self
  //依赖于self的对象: child
  //self依赖的对象: parent

  /**
   *
   * @param fn
   * @param trigger 当self发生改变时需要运行trigger,来触发child的重新计算
   * @param scheduler
   * @param scope
   */
  constructor(
    //ref值的计算方法
    public fn: () => T,
    public trigger: () => void,
    public scheduler?: EffectScheduler,
    scope?: EffectScope,
  ) {
    recordEffectScope(this, scope)
  }

  public get dirty() {
    if (this._dirtyLevel === DirtyLevels.MaybeDirty) {
      pauseTracking()
      //逐个调用依赖，检查自身是否为脏数据
      for (let i = 0; i < this._depsLength; i++) {
        const dep = this.deps[i]
        if (dep.computed) {
          triggerComputed(dep.computed)
          if (this._dirtyLevel >= DirtyLevels.Dirty) {
            break
          }
        }
      }
      //检查过后不是脏数据，修改状态从MaybeDirty=>NotDirty
      if (this._dirtyLevel < DirtyLevels.Dirty) {
        this._dirtyLevel = DirtyLevels.NotDirty
      }
      resetTracking()
    }

    //已经改变
    return this._dirtyLevel >= DirtyLevels.Dirty
  }

  public set dirty(v) {
    //effect的dirtyLevel只有脏和不脏两种？
    this._dirtyLevel = v ? DirtyLevels.Dirty : DirtyLevels.NotDirty
  }

  /**
   * 返回计算值并(重新)收集依赖
   * @returns
   */
  run() {
    this._dirtyLevel = DirtyLevels.NotDirty
    if (!this.active) {
      return this.fn()
    }
    let lastShouldTrack = shouldTrack
    let lastEffect = activeEffect
    try {
      shouldTrack = true
      activeEffect = this
      this._runnings++
      preCleanupEffect(this)
      //执行getter方法
      return this.fn()
    } finally {
      postCleanupEffect(this)
      this._runnings--
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

//deps

//trackEffect会对_depsLength
//_depsLength
//逻辑上会保留effect.deps，[猜测]是为了避免多余的dep存effect,effect存dep的操作

function postCleanupEffect(effect: ReactiveEffect) {
  if (effect.deps && effect.deps.length > effect._depsLength) {
    for (let i = effect._depsLength; i < effect.deps.length; i++) {
      cleanupDepEffect(effect.deps[i], effect)
    }
    effect.deps.length = effect._depsLength
  }
}

/**
 * 清除RefBase中dep存储的effect
 * @param dep
 * @param effect
 */

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

  //当所有的触发都完成，以此运行这些任务
  while (!pauseScheduleStack && queueEffectSchedulers.length) {
    queueEffectSchedulers.shift()!()
  }
}

/**
 * [问]什么时候会产生存在effect，但是_trackId不同呢
 * ref.dep和effect(一般是activeEffect)建立联系
 * ref.dep收集调用ref.value的effect(换句话说就是被哪些effect依赖)
 * effect.deps记录了依赖于哪些ref.dep
 * @param effect
 * @param dep
 * @param debuggerEventExtraInfo
 */
//在ref的dep中记录调用方的effect
//在effect的deps中记录ref的dep
export function trackEffect(
  effect: ReactiveEffect,
  // Dep = Map<ReactiveEffect, number> & {
  //   cleanup: () => void
  //   computed?: ComputedRefImpl<any>
  // }
  dep: Dep,
  debuggerEventExtraInfo?: DebuggerEventExtraInfo,
) {
  //不存在effect时
  if (dep.get(effect) !== effect._trackId) {
    
    dep.set(effect, effect._trackId)
   
    const oldDep = effect.deps[effect._depsLength]

    //防止已经添加
    if (oldDep !== dep) {
      //清除oldDep
      if (oldDep) {
        cleanupDepEffect(oldDep, effect)
      }
  
      effect.deps[effect._depsLength++] = dep
    } else {
      //已经加过了
      effect._depsLength++
    }
    if (__DEV__) {
      effect.onTrack?.(extend({ effect }, debuggerEventExtraInfo!))
    }
  }
}

//effect
const queueEffectSchedulers: EffectScheduler[] = []

/**
 * const a = ref()
 * const b = computed(() => a.value)
 * 
 * a.value = 1 
 * set value of ref
 * trigger ref.dep effects(set dirty & do effect.trigger )
 *     
 */

export function triggerEffects(
  dep: Dep,
  dirtyLevel: DirtyLevels,
  debuggerEventExtraInfo?: DebuggerEventExtraInfo,
) {
  pauseScheduling()
  //dep中存储的是依赖于dep所在ref的effect
  for (const effect of dep.keys()) {
    if (
      effect._dirtyLevel < dirtyLevel &&
      dep.get(effect) === effect._trackId
    ) {
      //记录原始状态，用于后续处理判断
      const lastDirtyLevel = effect._dirtyLevel
      //为所有依赖于dep的effect设置dirtyLevel
      effect._dirtyLevel = dirtyLevel

      //从原本不脏转变过来的，需要在下一个tick执行
      if (lastDirtyLevel === DirtyLevels.NotDirty) {
        effect._shouldSchedule = true
        if (__DEV__) {
          effect.onTrigger?.(extend({ effect }, debuggerEventExtraInfo))
        }
        //只会出触发computed的trigger
        effect.trigger()
      }
    }
  }
  scheduleEffects(dep)
  resetScheduling()
}



export function scheduleEffects(dep: Dep) {
  //执行了所有有scheduler的effect，比如watch。computed是没有的
  //可以认为这部分主要处理的就是watch之类的
  for (const effect of dep.keys()) {
    if (
      
      effect.scheduler &&
      effect._shouldSchedule &&
      (!effect._runnings ||
        //允许递归
        effect.allowRecurse) &&
      dep.get(effect) === effect._trackId
    ) {
      effect._shouldSchedule = false
      queueEffectSchedulers.push(effect.scheduler)
    }
  }
}
