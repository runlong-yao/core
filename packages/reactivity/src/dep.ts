import type { ReactiveEffect } from './effect'
import type { ComputedRefImpl } from './computed'

//一个对象的key对应一个dep的Map
//dep是一个Map，存储了ReactiveEffect和清理方法

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
