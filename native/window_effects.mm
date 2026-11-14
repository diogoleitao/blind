// What Electron can't do to a window: blur what's behind it at a chosen radius, through the private
// CGSSetWindowBackgroundBlurRadius, as iTerm2 does. See docs/adr/0003-blur-through-a-private-macos-api.md.

#import <AppKit/AppKit.h>
#include <dlfcn.h>
#include <napi.h>

typedef int32_t CGSConnectionID;
typedef CGSConnectionID (*MainConnectionIDFunction)(void);
typedef int32_t (*SetWindowBackgroundBlurRadiusFunction)(CGSConnectionID, uint32_t, uint32_t);

// Looked up at run time, so a macOS without them leaves blur unavailable rather than the addon failing to load.
static MainConnectionIDFunction mainConnectionID() {
  return reinterpret_cast<MainConnectionIDFunction>(dlsym(RTLD_DEFAULT, "CGSMainConnectionID"));
}

static SetWindowBackgroundBlurRadiusFunction setWindowBackgroundBlurRadius() {
  return reinterpret_cast<SetWindowBackgroundBlurRadiusFunction>(
      dlsym(RTLD_DEFAULT, "CGSSetWindowBackgroundBlurRadius"));
}

// Whether this macOS has the private functions blur needs.
static Napi::Value BlurAvailable(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), mainConnectionID() && setWindowBackgroundBlurRadius());
}

// Takes a window's native handle, as BrowserWindow.getNativeWindowHandle() gives it, and a radius; answers whether
// macOS took the radius. Callers never pass 0, which is reported to stop macOS blurring the window for good.
static Napi::Value SetBlurRadius(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "setBlurRadius(handle: Buffer, radius: number)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto handle = info[0].As<Napi::Buffer<uint8_t>>();
  if (handle.Length() < sizeof(void*)) {
    Napi::TypeError::New(env, "The handle is too short to hold a view").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto connection = mainConnectionID();
  auto setRadius = setWindowBackgroundBlurRadius();
  NSView* view = (__bridge NSView*)(*reinterpret_cast<void**>(handle.Data()));
  NSWindow* window = view.window;
  if (!connection || !setRadius || !window) return Napi::Boolean::New(env, false);
  uint32_t radius = info[1].As<Napi::Number>().Uint32Value();
  return Napi::Boolean::New(env, setRadius(connection(), (uint32_t)window.windowNumber, radius) == 0);
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("blurAvailable", Napi::Function::New(env, BlurAvailable));
  exports.Set("setBlurRadius", Napi::Function::New(env, SetBlurRadius));
  return exports;
}

NODE_API_MODULE(window_effects, Init)
