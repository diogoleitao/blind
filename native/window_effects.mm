// What Electron can't do to a window: blur what's behind it at a chosen radius, through the private
// CGSSetWindowBackgroundBlurRadius, as iTerm2 does (see docs/adr/0003-blur-through-a-private-macos-api.md). Also
// shows a window without macOS's zoom animation.

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

// The window of the view in `handle`, a window's native handle as BrowserWindow.getNativeWindowHandle() gives it; nil
// for a view in no window. Anything but a handle throws a TypeError naming `usage`, and gives nil too.
static NSWindow* windowFromHandle(Napi::Env env, const Napi::Value& handle, const char* usage) {
  if (!handle.IsBuffer() || handle.As<Napi::Buffer<uint8_t>>().Length() < sizeof(void*)) {
    Napi::TypeError::New(env, usage).ThrowAsJavaScriptException();
    return nil;
  }
  NSView* view = (__bridge NSView*)(*reinterpret_cast<void**>(handle.As<Napi::Buffer<uint8_t>>().Data()));
  return view.window;
}

// Takes a window's native handle and a radius; answers whether macOS took the radius. Callers never pass 0, which is
// reported to stop macOS blurring the window for good.
static Napi::Value SetBlurRadius(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const char* usage = "setBlurRadius(handle: Buffer, radius: number)";
  NSWindow* window = windowFromHandle(env, info[0], usage);
  if (env.IsExceptionPending()) return env.Undefined();
  if (!info[1].IsNumber()) {
    Napi::TypeError::New(env, usage).ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto connection = mainConnectionID();
  auto setRadius = setWindowBackgroundBlurRadius();
  if (!connection || !setRadius || !window) return Napi::Boolean::New(env, false);
  uint32_t radius = info[1].As<Napi::Number>().Uint32Value();
  return Napi::Boolean::New(env, setRadius(connection(), (uint32_t)window.windowNumber, radius) == 0);
}

// Takes a window's native handle and turns off the animation macOS plays when the window is shown, so it appears in a
// single frame. A public AppKit property; answers whether there was a window to set it on.
static Napi::Value TurnOffShowAnimation(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  NSWindow* window = windowFromHandle(env, info[0], "turnOffShowAnimation(handle: Buffer)");
  if (env.IsExceptionPending()) return env.Undefined();
  if (!window) return Napi::Boolean::New(env, false);
  window.animationBehavior = NSWindowAnimationBehaviorNone;
  return Napi::Boolean::New(env, true);
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("blurAvailable", Napi::Function::New(env, BlurAvailable));
  exports.Set("setBlurRadius", Napi::Function::New(env, SetBlurRadius));
  exports.Set("turnOffShowAnimation", Napi::Function::New(env, TurnOffShowAnimation));
  return exports;
}

NODE_API_MODULE(window_effects, Init)
