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









