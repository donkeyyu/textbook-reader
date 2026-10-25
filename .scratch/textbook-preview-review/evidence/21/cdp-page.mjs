// Ego 0.6.0.16 resets viewports in its high-level Page calls.
// This adapter keeps CDP input and observations in one fixed test viewport.
export function driver(raw) {
  async function evaluate(fn, arg) {
    const expression = `(${fn.toString()})(${JSON.stringify(arg) ?? 'undefined'})`;
    const result = await raw.cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
    return result.result.value;
  }
  async function waitForFunction(fn, arg, options = {}) {
    for (let at = Date.now(); Date.now() - at < (options.timeout ?? 10000);) {
      if (await evaluate(fn, arg)) return;
      await new Promise(r=>setTimeout(r,100));
    }
    throw new Error(`Timeout: ${fn}`);
  }
  const api = {
    evaluate, waitForFunction,
    waitForSelector: async (selector,options={}) => waitForFunction(({selector,hidden})=>hidden?!document.querySelector(selector):!!document.querySelector(selector),{selector,hidden:options.state==='hidden'},options),
    click: async (selector) => {
      await evaluate((s)=>document.querySelector(s).scrollIntoView({block:'nearest',inline:'nearest'}),selector);
      const {x,y} = await evaluate((s)=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},selector);
      await raw.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
      await raw.cdp('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
      await raw.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});await evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    },
    focus: async (selector)=>evaluate((s)=>document.querySelector(s).focus(),selector),
    fill: async (selector,value)=>{await api.focus(selector);await evaluate(({selector,value})=>{const input=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},{selector,value});},
    selectOption: async (selector,value)=>evaluate(({selector,value})=>{const input=document.querySelector(selector);input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));},{selector,value}),
    press: async (selector,key)=>{await api.focus(selector);if (key==='ControlOrMeta+z') { await raw.cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',modifiers:4,windowsVirtualKeyCode:90});await raw.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',modifiers:4,windowsVirtualKeyCode:90});return; } if(key==='ControlOrMeta+End'){await evaluate((s)=>{const n=document.querySelector(s);const r=document.createRange();r.selectNodeContents(n);r.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(r);},selector);return;} const code={Enter:13,Space:32,Escape:27,ArrowUp:38,ArrowDown:40,Home:36,End:35}[key];const value=key==='Space'?' ':key;await raw.cdp('Input.dispatchKeyEvent',{type:'keyDown',key:value,code:key,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:key==='Space'?{text:' ',unmodifiedText:' '}:{}),windowsVirtualKeyCode:code,nativeVirtualKeyCode:code});await raw.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:value,code:key,windowsVirtualKeyCode:code,nativeVirtualKeyCode:code});await evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));},
    reload: async ()=>{const token=Date.now();await evaluate((token)=>{window.qaReloadToken=token;},token);await raw.cdp('Page.reload');await waitForFunction((token)=>window.qaReloadToken!==token&&!!document.querySelector('.paper-scroller'),token);},
    viewport: async(width,height)=>{await raw.cdp('Page.bringToFront');await raw.cdp('Emulation.setFocusEmulationEnabled',{enabled:true});await raw.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height,{width,height});},
    keyboard: {insertText: async(text)=>raw.cdp('Input.insertText',{text})},
    raw,
  };
  return api;
}
