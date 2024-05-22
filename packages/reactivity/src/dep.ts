import type { ReactiveEffect } from './effect'
import type { ComputedRefImpl } from './computed'

/**
 * ReactiveEffect: ReacticeEffect对象
 * number: 每次设置时ReactiveEffect._trackId
 */
export type Dep = Map<ReactiveEffect, number> & {
  cleanup: () => void
  computed?: ComputedRefImpl<any>
}

export const createDep = (
  cleanup: () => void,
  computed?: ComputedRefImpl<any>,
): Dep => {
  const dep = new Map() as Dep
  dep.cleanup = cleanup
  dep.computed = computed
  return dep
}
