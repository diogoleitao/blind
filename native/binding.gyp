{
  "targets": [
    {
      "target_name": "window_effects",
      "sources": ["window_effects.mm"],
      "include_dirs": ["<!(node -p \"require('node-addon-api').include_dir\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "NAPI_VERSION=8"],
      "xcode_settings": {
        "CLANG_ENABLE_OBJC_ARC": "YES",
        "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
        "MACOSX_DEPLOYMENT_TARGET": "12.0"
      },
      "link_settings": {
        "libraries": ["-framework AppKit"]
      }
    }
  ]
}
