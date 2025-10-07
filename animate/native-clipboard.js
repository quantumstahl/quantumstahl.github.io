(function (global) {
  const C = global.Capacitor || {};

  function isNative() {
    return !!(C.isNativePlatform && C.isNativePlatform());
  }

  // Minimal brygga direkt mot native
  function nativeCall(plugin, method, opts) {
    if (!isNative()) return Promise.reject(new Error('Not native'));
    if (typeof C.nativePromise === 'function') {
      return C.nativePromise(plugin, method, opts || {});
    }
    if (typeof C.nativeCallback === 'function') {
      return new Promise((resolve, reject) => {
        C.nativeCallback(plugin, method, opts || {}, (res, err) => err ? reject(err) : resolve(res));
      });
    }
    return Promise.reject(new Error('No native bridge'));
  }

  // Exponera en proxy under Plugins så din “plugin-lista/toast” ser den
  C.Plugins = C.Plugins || {};
  if (!C.Plugins.ClipboardImages) {
    C.Plugins.ClipboardImages = {
      copyImagePNG: (opts) => nativeCall('ClipboardImages', 'copyImagePNG', opts),
      read:         (opts) => nativeCall('ClipboardImages', 'read',         opts),
    };
  }

  async function copyCanvasToClipboardPNG(canvas) {
    const dataURL = canvas.toDataURL('image/png');
    const base64 = dataURL.split(',')[1];

    if (isNative()) {
      try {
        await C.Plugins.ClipboardImages.copyImagePNG({ base64PNG: base64 });
        return { ok: true, via: 'native' };
      } catch (e) { /* fallthrough to web */ }
    }

    if (global.navigator && navigator.clipboard && global.ClipboardItem) {
      const blob = await (await fetch(dataURL)).blob();
      const item = new ClipboardItem({ [blob.type]: blob });
      await navigator.clipboard.write([item]);
      return { ok: true, via: 'web-clipboard' };
    }

    const a = document.createElement('a');
    a.href = dataURL; a.download = 'maxpaint.png'; a.click();
    return { ok: false, via: 'download' };
  }

  async function pasteFromClipboard() {

      
    if (isNative()) {
      try {
        return await C.Plugins.ClipboardImages.read();
      } catch (e) { alert(e); }
    }

  }

  global.nativeClipboard = { copyCanvasToClipboardPNG, pasteFromClipboard };
  global.copyCanvasToClipboardPNG = copyCanvasToClipboardPNG;
  global.pasteFromClipboard = pasteFromClipboard;
})(window);

