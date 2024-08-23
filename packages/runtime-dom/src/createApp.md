createApp 与 createRenderer
createApp  runtime-dom/index.ts
->01.renderer = ensureRenderer() <=> renderer = createRenderer()
  02.renderer.createApp(rootComponent: Component,rootProps?: Data | null,)
总结: createApp动态创建了createApp和render方法

render代码指向
import { render } from "vue"
render -> renderer.render

h<=>createVNode,基本等价，但是有做对应的简化,createVNode更加基础

createRenderer [renderer.ts]
  createBaseRenderer
    {createApp, render}

createApp [index.ts]
  app = createRenderer.createApp 
    app.mount = () => app.mount()
      app
    
createApp({}).mount("#app")

render调用的方法实现来源于nodeOps的nodeOps配置

//createApp的过程也包含render

createApp
  ->ensureRenderer
    //初始化createApp和render
    ->createRenderer
    ->baseCreateRenderer
      -> return {render, createApp:createAppApi(render)}
  ->app = createApp()
  ->app.mount = (id) => app.mount(dom)
    -> createVNode
    -> render(vnode, rootContainer, namespace)
  ->return app



render
  ->patch
    -> processComponent


processComponent
  -> mountComponent()
   -> setupRenderEffect
     //收集componentUpdateFn中的响应式，将effect加入响应式的依赖
    -> effect=  new ReactiveEffect(
      componentUpdateFn,
      NOOP,
      () => queueJob(update),
      instance.scope, // track it in component's effect scope
    )
    //componentUpdateFn
  
[问]initialVNode为何还能异步
//componentUpdateFn mounted分支
// ->
  


  



//effect 316
// [问]什么时候会产生存在effect，但是_trackId不同呢





